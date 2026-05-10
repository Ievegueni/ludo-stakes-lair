-- Suporte para aposta debitada à entrada e settle automático do pot.
ALTER TABLE room_players
  ADD COLUMN IF NOT EXISTS bet_paid BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS settled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS winner_user_id UUID REFERENCES users(id);
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS prize BIGINT;

CREATE INDEX IF NOT EXISTS idx_games_settled ON games(settled);
