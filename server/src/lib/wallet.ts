import type { PoolClient } from "pg";

/**
 * Operações atómicas sobre carteiras dos jogadores. Todas exigem que o
 * caller já tenha aberto uma transacção (`BEGIN`) e passe um client
 * dedicado — assim a cobrança/reembolso ficam dentro do mesmo escopo do
 * INSERT/DELETE do room_player.
 *
 * Convenção: `chargeBet` lança erro com `{ status, message }` quando o
 * saldo é insuficiente, para o caller fazer ROLLBACK.
 */

export class InsufficientBalanceError extends Error {
  status = 400;
  constructor(
    public required: number,
    public available: number,
  ) {
    super("insufficient balance");
  }
}

/**
 * Debita a aposta: primeiro o saldo bónus, depois o real.
 *  - Bloqueia a wallet (FOR UPDATE) e valida real + bónus
 *  - Regista transaction type='bet' (valor total)
 *  - Marca room_players.bet_paid=true e guarda a parte bónus em bet_bonus
 *
 * Idempotente: se `bet_paid` já é true, não faz nada (devolve `{ skipped: true }`).
 */
export async function chargeBet(
  client: PoolClient,
  userId: string,
  roomId: string,
  amount: number,
  description: string,
): Promise<{ skipped: boolean }> {
  const existing = await client.query<{ bet_paid: boolean }>(
    "SELECT bet_paid FROM room_players WHERE room_id = $1 AND user_id = $2",
    [roomId, userId],
  );
  if (existing.rows[0]?.bet_paid) {
    return { skipped: true };
  }

  const wallet = await client.query<{ balance: string; bonus_balance: string }>(
    "SELECT balance, bonus_balance FROM wallets WHERE user_id = $1 FOR UPDATE",
    [userId],
  );
  const balance = Number(wallet.rows[0]?.balance ?? 0);
  const bonus = Number(wallet.rows[0]?.bonus_balance ?? 0);
  if (balance + bonus < amount) {
    throw new InsufficientBalanceError(amount, balance + bonus);
  }
  const fromBonus = Math.min(bonus, amount);
  await client.query(
    `UPDATE wallets SET balance = balance - $1, bonus_balance = bonus_balance - $2,
       updated_at = now() WHERE user_id = $3`,
    [amount - fromBonus, fromBonus, userId],
  );
  await client.query(
    "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
    [
      userId,
      "bet",
      amount,
      fromBonus > 0 ? `${description} (${fromBonus.toLocaleString()} Kz de bónus)` : description,
    ],
  );
  await client.query(
    "UPDATE room_players SET bet_paid = true, bet_bonus = $3 WHERE room_id = $1 AND user_id = $2",
    [roomId, userId, fromBonus],
  );
  return { skipped: false };
}

/**
 * Reembolsa a aposta de um jogador numa sala, devolvendo a parte bónus ao
 * bónus. Não é idempotente — chamar apenas com `bet_paid = true` e antes de
 * apagar o room_player.
 */
export async function refundBet(
  client: PoolClient,
  userId: string,
  roomId: string,
  amount: number,
  description: string,
): Promise<void> {
  const r = await client.query<{ bet_bonus: string }>(
    "SELECT bet_bonus FROM room_players WHERE room_id = $1 AND user_id = $2",
    [roomId, userId],
  );
  const fromBonus = Math.min(amount, Number(r.rows[0]?.bet_bonus ?? 0));
  await client.query(
    `UPDATE wallets SET balance = balance + $1, bonus_balance = bonus_balance + $2,
       updated_at = now() WHERE user_id = $3`,
    [amount - fromBonus, fromBonus, userId],
  );
  await client.query(
    "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)",
    [userId, "refund", amount, description],
  );
}

/** Credita saldo bónus (missões, prémios do ranking). */
export async function creditBonus(
  client: PoolClient,
  userId: string,
  amount: number,
  description: string,
): Promise<void> {
  await client.query(
    "UPDATE wallets SET bonus_balance = bonus_balance + $1, updated_at = now() WHERE user_id = $2",
    [amount, userId],
  );
  await client.query(
    "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, 'bonus', $2, $3)",
    [userId, amount, description],
  );
}
