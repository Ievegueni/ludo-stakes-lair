-- Contas novas deixam de receber 10 000 Kz grátis (multi-contas = dinheiro grátis).
ALTER TABLE wallets ALTER COLUMN balance SET DEFAULT 0;

-- Gifts passam a creditar o destinatário (tipo próprio para o extracto).
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit', 'withdraw', 'bet', 'win', 'refund', 'gift', 'gift_received'));

-- O ledger da casa é registo de auditoria: não pode desaparecer quando o
-- cleanup apaga salas/jogos terminados (antes era ON DELETE CASCADE).
ALTER TABLE house_ledger DROP CONSTRAINT IF EXISTS house_ledger_game_id_fkey;

-- pg_notify rejeita payloads >= 8000 bytes e a excepção abortava a transacção
-- inteira (ex.: /start com avatar no estado). Agora, se a linha for grande,
-- envia só os ids — o cliente vai buscar o resto por HTTP.
CREATE OR REPLACE FUNCTION notify_realtime() RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
  payload TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN rec := OLD; ELSE rec := NEW; END IF;
  payload := json_build_object('table', TG_TABLE_NAME, 'event', TG_OP, 'row', row_to_json(rec))::text;
  IF octet_length(payload) >= 7900 THEN
    payload := json_build_object(
      'table', TG_TABLE_NAME, 'event', TG_OP, 'truncated', true,
      'row', json_build_object('id', rec.id)
    )::text;
  END IF;
  PERFORM pg_notify('nanter_realtime', payload);
  RETURN rec;
END;
$$ LANGUAGE plpgsql;

-- Logout no servidor: tokens levam a versão; incrementar invalida-os.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
