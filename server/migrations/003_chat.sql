-- Per-game chat messages (text + gifts) synchronised across clients via realtime
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  color TEXT NOT NULL,
  text TEXT,
  gift_emoji TEXT,
  gift_name TEXT,
  gift_price BIGINT,
  gift_to_name TEXT,
  gift_to_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_game ON chat_messages(game_id, created_at);

DROP TRIGGER IF EXISTS chat_messages_realtime ON chat_messages;
CREATE TRIGGER chat_messages_realtime
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION notify_realtime();
