-- ============================================
-- Migração: Criar tabela transactions
-- Projeto: ziznxwaehnifcinosenv
-- Executar no SQL Editor do Supabase Dashboard
-- ============================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id text UNIQUE NOT NULL,
  up_key text NOT NULL DEFAULT 'seguro',
  amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  qr_code text,
  customer_name text,
  customer_cpf text,
  customer_email text,
  customer_phone text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_transactions_txn_id ON public.transactions(txn_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);

-- Row Level Security
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Apenas service_role pode acessar (Edge Functions usam service_role)
CREATE POLICY "service_role_full_access" ON public.transactions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
