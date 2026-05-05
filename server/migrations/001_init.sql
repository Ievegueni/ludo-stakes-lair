-- NANTER schema (pure Postgres, no Supabase)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users (replaces supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT,
  display_name TEXT NOT NULL DEFAULT 'Jogador',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  balance BIGINT NOT NULL DEFAULT 10000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'bet', 'win', 'refund', 'gift')),
  amount BIGINT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);

-- Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE DEFAULT upper(substring(md5(random()::text) from 1 for 6)),
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet_amount BIGINT NOT NULL DEFAULT 100,
  max_players INT NOT NULL DEFAULT 4 CHECK (max_players >= 2 AND max_players <= 4),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Room players
CREATE TABLE IF NOT EXISTS room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  player_index INT NOT NULL CHECK (player_index >= 0 AND player_index <= 3),
  is_bot BOOLEAN NOT NULL DEFAULT false,
  bot_name TEXT,
  color TEXT NOT NULL CHECK (color IN ('red', 'blue', 'green', 'yellow')),
  is_ready BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, player_index),
  UNIQUE(room_id, color)
);

CREATE INDEX IF NOT EXISTS idx_room_players_room ON room_players(room_id);

-- Auto-create profile + wallet on signup
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, phone, display_name)
  VALUES (NEW.id, NEW.phone, 'Jogador');
  INSERT INTO wallets (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_user_created ON users;
CREATE TRIGGER on_user_created
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Realtime fan-out via NOTIFY: triggers on rooms & room_players push JSON
-- to channel 'nanter_realtime'. The server LISTENs and broadcasts via SSE.
CREATE OR REPLACE FUNCTION notify_realtime() RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
  row_data JSON;
  rec RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := OLD;
  ELSE
    rec := NEW;
  END IF;
  row_data := row_to_json(rec);
  payload := json_build_object(
    'table', TG_TABLE_NAME,
    'event', TG_OP,
    'row', row_data
  );
  PERFORM pg_notify('nanter_realtime', payload::text);
  RETURN rec;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rooms_realtime ON rooms;
CREATE TRIGGER rooms_realtime
  AFTER INSERT OR UPDATE OR DELETE ON rooms
  FOR EACH ROW EXECUTE FUNCTION notify_realtime();

DROP TRIGGER IF EXISTS room_players_realtime ON room_players;
CREATE TRIGGER room_players_realtime
  AFTER INSERT OR UPDATE OR DELETE ON room_players
  FOR EACH ROW EXECUTE FUNCTION notify_realtime();
