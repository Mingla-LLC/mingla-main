-- ORCH-0588 Slice 1 — signal_definitions + signal_definition_versions
-- Admin-editable signal configs. Versioned for history (mirrors rule_set_versions pattern).

CREATE TABLE public.signal_definitions (
  id text PRIMARY KEY,
  label text NOT NULL,
  kind text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_definitions_kind_valid CHECK (kind IN ('type-grounded', 'quality-grounded'))
);

CREATE TABLE public.signal_definition_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id text NOT NULL REFERENCES public.signal_definitions(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  notes text
);

ALTER TABLE public.signal_definitions
  ADD CONSTRAINT signal_definitions_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.signal_definition_versions(id);

CREATE INDEX signal_definition_versions_signal_id_idx
  ON public.signal_definition_versions (signal_id, created_at DESC);

ALTER TABLE public.signal_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_definition_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY signal_definitions_service_all ON public.signal_definitions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY signal_definitions_auth_read ON public.signal_definitions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY signal_definition_versions_service_all ON public.signal_definition_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY signal_definition_versions_auth_read ON public.signal_definition_versions
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.signal_definitions IS
  'ORCH-0588: signal registry (fine_dining, romantic, etc.). One row per active signal.';
COMMENT ON TABLE public.signal_definition_versions IS
  'ORCH-0588: versioned configs for each signal. Admin edits create new versions, never mutate. Mirrors rule_set_versions pattern.';

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.signal_definition_versions CASCADE;
-- DROP TABLE IF EXISTS public.signal_definitions CASCADE;
