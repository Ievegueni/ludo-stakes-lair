-- Salas privadas — não aparecem na listagem pública, só por código
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_rooms_public_waiting ON rooms(status, is_private) WHERE status = 'waiting' AND is_private = false;
