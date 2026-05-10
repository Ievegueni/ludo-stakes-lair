-- Denúncias de jogadores (reports). Tabela partilhada: jogo INSERT, backoffice
-- READ/UPDATE. Categorias e estados são strings com CHECK constraints — fáceis
-- de evoluir sem migrar ENUMs.

CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id         UUID REFERENCES games(id) ON DELETE SET NULL,
  category        TEXT NOT NULL CHECK (category IN ('cheating','abuse','spam','harassment','other')),
  reason          TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 1000),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  resolution      TEXT, -- nota do moderador
  resolved_by_id  UUID, -- admin id (não FK porque admins é tabela do backoffice)
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Evita o jogador denunciar-se a si próprio
  CONSTRAINT reports_no_self CHECK (reporter_id <> reported_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON reports(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_reporter
  ON reports(reporter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_reported
  ON reports(reported_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_game
  ON reports(game_id) WHERE game_id IS NOT NULL;

-- Anti-spam: o mesmo reporter→reported só pode denunciar uma vez por dia.
-- (uniqueness parcial: apenas reports não-resolved/dismissed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_pending
  ON reports(reporter_id, reported_id)
  WHERE status IN ('pending','reviewing');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION reports_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reports_updated_at_trg ON reports;
CREATE TRIGGER reports_updated_at_trg
  BEFORE UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION reports_set_updated_at();
