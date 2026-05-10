import type { PoolClient } from 'pg';

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
  constructor(public required: number, public available: number) {
    super('insufficient balance');
  }
}

/**
 * Debita a aposta da carteira do utilizador:
 *  - Bloqueia a wallet (FOR UPDATE)
 *  - Valida saldo
 *  - Decrementa saldo
 *  - Regista transaction type='bet'
 *  - Marca room_players.bet_paid=true
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
  // Idempotência — se já está pago, não cobra de novo
  const existing = await client.query<{ bet_paid: boolean }>(
    'SELECT bet_paid FROM room_players WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  if (existing.rows[0]?.bet_paid) {
    return { skipped: true };
  }

  const wallet = await client.query<{ balance: string }>(
    'SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  const balance = Number(wallet.rows[0]?.balance ?? 0);
  if (balance < amount) {
    throw new InsufficientBalanceError(amount, balance);
  }
  await client.query(
    'UPDATE wallets SET balance = balance - $1, updated_at = now() WHERE user_id = $2',
    [amount, userId],
  );
  await client.query(
    'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
    [userId, 'bet', amount, description],
  );
  await client.query(
    'UPDATE room_players SET bet_paid = true WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return { skipped: false };
}

/**
 * Reembolsa um jogador. Idempotente NÃO — chamar apenas quando se sabe
 * que `bet_paid` está true.
 */
export async function refundBet(
  client: PoolClient,
  userId: string,
  amount: number,
  description: string,
): Promise<void> {
  await client.query(
    'UPDATE wallets SET balance = balance + $1, updated_at = now() WHERE user_id = $2',
    [amount, userId],
  );
  await client.query(
    'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4)',
    [userId, 'refund', amount, description],
  );
}
