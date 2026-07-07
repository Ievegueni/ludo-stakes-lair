-- Sistema anti-rage-quit: tracking de desistencias e cooldown progressivo.
-- Jogadores que desistem frequentemente recebem cooldown antes de poder jogar de novo.

-- Contador de desistencias recentes por jogador
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS resign_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resign_streak INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resign_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ;

-- Historico de desistencias (para auditoria e decay)
CREATE TABLE IF NOT EXISTS resign_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  bet_lost BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resign_log_user ON resign_log(user_id, created_at DESC);
