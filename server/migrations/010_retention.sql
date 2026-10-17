-- Retenção: saldo bónus, missões diárias, ranking semanal, XP e cosméticos.

-- Saldo bónus: não levantável. Serve para apostar e comprar cosméticos.
-- O prémio da parte do pote paga com bónus volta como bónus, para o bónus
-- nunca virar dinheiro real via contas em conluio.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS bonus_balance BIGINT NOT NULL DEFAULT 0;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS bet_bonus BIGINT NOT NULL DEFAULT 0;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit', 'withdraw', 'bet', 'win', 'refund', 'gift', 'gift_received',
                  'bonus', 'purchase'));

-- Ledger: pot/prize/rake continuam a ser só dinheiro real; o bónus fica à parte.
ALTER TABLE house_ledger ADD COLUMN IF NOT EXISTS bonus_pot BIGINT NOT NULL DEFAULT 0;
ALTER TABLE house_ledger ADD COLUMN IF NOT EXISTS bonus_prize BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS house_ledger_winner_idx ON house_ledger(winner_user_id, created_at);

-- Missões diárias (dia no fuso de Luanda). Definições vivem no código.
CREATE TABLE IF NOT EXISTS mission_progress (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  mission TEXT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, day, mission)
);

-- Prémios do ranking semanal. PK garante um pagamento por posição/semana
-- mesmo com várias instâncias do servidor.
CREATE TABLE IF NOT EXISTS weekly_prizes (
  week_start DATE NOT NULL,
  rank INT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wins INT NOT NULL,
  amount BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, rank)
);

-- XP para o nível (matchmaking) e cosméticos equipados.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp INT NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS equipped_frame TEXT;

CREATE TABLE IF NOT EXISTS user_items (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
