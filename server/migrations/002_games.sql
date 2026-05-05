-- Synchronized game state for multiplayer
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE UNIQUE,
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_games_room ON games(room_id);

DROP TRIGGER IF EXISTS games_realtime ON games;
CREATE TRIGGER games_realtime
  AFTER INSERT OR UPDATE OR DELETE ON games
  FOR EACH ROW EXECUTE FUNCTION notify_realtime();
