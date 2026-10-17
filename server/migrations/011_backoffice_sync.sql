-- Alinha o jogo com o backoffice.

-- Ajustes manuais de saldo feitos por admins (FINANCE/SUPER_ADMIN).
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit', 'withdraw', 'bet', 'win', 'refund', 'gift', 'gift_received',
                  'bonus', 'purchase', 'adjust'));

-- Suspensão de contas pelo backoffice. O backoffice também incrementa
-- users.token_version para terminar as sessões abertas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- Taxa fixada na criação da sala: quem entra joga com a taxa que viu, mesmo
-- que o admin a mude a meio.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS rake_pct NUMERIC(5, 2) NOT NULL DEFAULT 5;
