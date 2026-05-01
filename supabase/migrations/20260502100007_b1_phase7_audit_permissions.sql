-- Cycle B1 Phase 7 — Permissions matrix + audit log (BUSINESS_PROJECT_PLAN §B.7).

CREATE TABLE IF NOT EXISTS public.permissions_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_matrix_role_nonempty CHECK (length(trim(role)) > 0),
  CONSTRAINT permissions_matrix_action_nonempty CHECK (length(trim(action)) > 0),
  CONSTRAINT permissions_matrix_role_action_unique UNIQUE (role, action)
);

CREATE INDEX IF NOT EXISTS idx_permissions_matrix_role ON public.permissions_matrix (role);

COMMENT ON TABLE public.permissions_matrix IS
  'Static role→action map for server-side checks (B1 §B.7); optional client read.';

ALTER TABLE public.permissions_matrix ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read permissions_matrix" ON public.permissions_matrix;
CREATE POLICY "Authenticated can read permissions_matrix"
  ON public.permissions_matrix
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  brand_id uuid REFERENCES public.brands (id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events (id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_nonempty CHECK (length(trim(action)) > 0),
  CONSTRAINT audit_log_target_type_nonempty CHECK (length(trim(target_type)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_brand_id ON public.audit_log (brand_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log (action);

COMMENT ON TABLE public.audit_log IS
  'Append-only audit trail; inserts via service role only (B1 §B.7).';

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own audit_log rows" ON public.audit_log;
CREATE POLICY "Users can read own audit_log rows"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.biz_audit_log_block_mutate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'audit_log is append-only for clients';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_block_update ON public.audit_log;
CREATE TRIGGER trg_audit_log_block_update
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_audit_log_block_mutate();

INSERT INTO public.permissions_matrix (role, action, allowed)
VALUES
  ('scanner', 'ticket.scan', true),
  ('event_manager', 'event.write', true),
  ('finance_manager', 'order.refund', true),
  ('brand_admin', 'brand.invite', true),
  ('account_owner', 'brand.delete', true)
ON CONFLICT (role, action) DO NOTHING;
