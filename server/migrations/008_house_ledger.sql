-- Ledger da casa: uma linha por jogo liquidado, com pot, prémio e rake.
-- Permite ao backoffice medir o RTP REAL (sum(prize)/sum(pot)) vs o configurado,
-- e audita os 5% de rake que antes não ficavam registados em lado nenhum.

CREATE TABLE IF NOT EXISTS house_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  room_id UUID NOT NULL,
  pot BIGINT NOT NULL DEFAULT 0,
  prize BIGINT NOT NULL DEFAULT 0,
  rake BIGINT NOT NULL DEFAULT 0,
  winner_user_id UUID NULL,
  winner_is_bot BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS house_ledger_game_idx ON house_ledger(game_id);
CREATE INDEX IF NOT EXISTS house_ledger_created_idx ON house_ledger(created_at);
