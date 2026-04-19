-- ═══════════════════════════════════════════════════════════════════════════════
-- ORCH-0526 M1 — Rules Engine Schema (Path B per DEC-032)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Creates the 4-table foundation for DB-backed deterministic rules:
--   rule_sets           — drawer per rule (name + kind + scope)
--   rule_set_versions   — immutable snapshots per drawer
--   rule_entries        — leaf data per snapshot
--   rules_versions      — manifest tying together a snapshot of all drawers
--
-- ALTERs ai_validation_jobs (rules_version_id, unchanged, city_id, lock_token + stage CHECK extension)
-- ALTERs ai_validation_results (rule_set_version_id) for per-place rule attribution
--
-- DB-level immutability triggers enforce I-RULE-VERSION-IMMUTABLE structurally,
-- not by convention.
--
-- All 4 new tables get RLS via existing admin_users(active) gate pattern.
--
-- Bundled bug fixes addressed by this migration:
--   ORCH-0512 (stage discriminator)  — adds 'rules_only_complete' to chk_avj_stage
--   ORCH-0527 (unchanged counter)    — adds new column ai_validation_jobs.unchanged
--   ORCH-0529 (advisory lock)        — adds lock_token column (handler uses pg_try_advisory_xact_lock)
--   ORCH-0530 (city_id FK)           — adds city_id UUID FK alongside legacy city_filter string
--
-- Spec ref: outputs/SPEC_ORCH-0526_RULES_FILTER_TAB.md §3 (Schema)
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── Section 1: rule_sets ─────────────────────────────────────────────────────

CREATE TABLE public.rule_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_value TEXT,
  current_version_id UUID,  -- FK added in §2 after rule_set_versions exists
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rule_sets_name_unique UNIQUE (name),
  CONSTRAINT rule_sets_kind_check CHECK (kind IN (
    'blacklist', 'whitelist', 'promotion', 'demotion',
    'strip', 'keyword_set', 'time_window', 'numeric_range', 'min_data_guard'
  )),
  CONSTRAINT rule_sets_scope_kind_check CHECK (scope_kind IN ('global', 'category', 'vibe')),
  -- scope_value NULL when scope_kind='global'; otherwise the slug
  CONSTRAINT rule_sets_scope_value_consistency CHECK (
    (scope_kind = 'global' AND scope_value IS NULL) OR
    (scope_kind IN ('category', 'vibe') AND scope_value IS NOT NULL)
  )
);


-- ── Section 2: rule_set_versions ─────────────────────────────────────────────

CREATE TABLE public.rule_set_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id UUID NOT NULL REFERENCES public.rule_sets(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  change_summary TEXT,
  thresholds JSONB,  -- For inline rules + numeric_range + time_window. NULL for entry-list rules.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,

  CONSTRAINT rule_set_versions_unique UNIQUE (rule_set_id, version_number),
  CONSTRAINT rule_set_versions_version_positive CHECK (version_number > 0)
);

-- Now add the deferred FK on rule_sets.current_version_id pointing at rule_set_versions
-- DEFERRABLE INITIALLY DEFERRED so the seed migration can populate everything in one txn.
ALTER TABLE public.rule_sets
  ADD CONSTRAINT rule_sets_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.rule_set_versions(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;


-- ── Section 3: rule_entries ──────────────────────────────────────────────────

CREATE TABLE public.rule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_version_id UUID NOT NULL REFERENCES public.rule_set_versions(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  sub_category TEXT,  -- For EXCLUSION_KEYWORDS sub-categories (medical/grooming/kids/etc.)
  position INTEGER NOT NULL DEFAULT 0,
  reason TEXT,  -- Required for blacklist/demotion adds (enforced at admin_rules_save RPC, not CHECK)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rule_entries_unique_per_version UNIQUE (rule_set_version_id, value, sub_category)
);


-- ── Section 4: rules_versions (manifest) ─────────────────────────────────────

CREATE TABLE public.rules_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_label TEXT,
  snapshot JSONB NOT NULL,  -- {rule_set_id::text: rule_set_version_id::text, ...}
  summary TEXT,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deployed_by UUID,

  CONSTRAINT rules_versions_snapshot_not_empty CHECK (
    jsonb_typeof(snapshot) = 'object' AND snapshot != '{}'::jsonb
  )
);


-- ── Section 5: ALTER ai_validation_jobs (per spec §3.5) ──────────────────────

ALTER TABLE public.ai_validation_jobs
  ADD COLUMN rules_version_id UUID REFERENCES public.rules_versions(id) ON DELETE SET NULL,
  ADD COLUMN unchanged INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN city_id UUID REFERENCES public.seeding_cities(id) ON DELETE SET NULL,
  ADD COLUMN lock_token TEXT;

-- Extend stage CHECK to add 'rules_only_complete'.
-- Current allowed values verified live via MCP 2026-04-19:
--   'export','filter','search','website','classify','write','summary','complete','rules_only'
-- We add 'rules_only_complete' so the edge function preserves the rules-only discriminator
-- at job-end (ORCH-0512 retraction).
ALTER TABLE public.ai_validation_jobs DROP CONSTRAINT chk_avj_stage;
ALTER TABLE public.ai_validation_jobs ADD CONSTRAINT chk_avj_stage CHECK (
  stage IS NULL OR stage IN (
    'export', 'filter', 'search', 'website', 'classify', 'write',
    'summary', 'complete',
    'rules_only', 'rules_only_complete'
  )
);


-- ── Section 6: ALTER ai_validation_results ───────────────────────────────────

ALTER TABLE public.ai_validation_results
  ADD COLUMN rule_set_version_id UUID REFERENCES public.rule_set_versions(id) ON DELETE SET NULL;


-- ── Section 7: Immutability triggers (enforce I-RULE-VERSION-IMMUTABLE) ─────

CREATE OR REPLACE FUNCTION public.tg_rule_set_versions_block_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rule_set_versions is immutable; create a new version via admin_rules_save instead';
END;
$$;

CREATE TRIGGER rule_set_versions_no_update
  BEFORE UPDATE ON public.rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_rule_set_versions_block_update();

CREATE OR REPLACE FUNCTION public.tg_rule_entries_block_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rule_entries is immutable; create a new version via admin_rules_save instead';
END;
$$;

CREATE TRIGGER rule_entries_no_update
  BEFORE UPDATE ON public.rule_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_rule_entries_block_update();


-- ── Section 8: Indexes ───────────────────────────────────────────────────────

-- rule_sets: most common queries are by active flag, kind, scope
CREATE INDEX idx_rule_sets_active ON public.rule_sets (is_active) WHERE is_active = true;
CREATE INDEX idx_rule_sets_kind ON public.rule_sets (kind);
CREATE INDEX idx_rule_sets_scope ON public.rule_sets (scope_kind, scope_value);

-- rule_set_versions: lookups by rule + sorted by version
CREATE INDEX idx_rule_set_versions_rule ON public.rule_set_versions (rule_set_id, version_number DESC);
CREATE INDEX idx_rule_set_versions_created ON public.rule_set_versions (created_at DESC);

-- rule_entries: lookups by version (load all entries for a version) + value search
CREATE INDEX idx_rule_entries_version ON public.rule_entries (rule_set_version_id);
CREATE INDEX idx_rule_entries_value ON public.rule_entries (value);

-- rules_versions: order by deployment time (latest manifest)
CREATE INDEX idx_rules_versions_deployed ON public.rules_versions (deployed_at DESC);

-- New indexes on existing tables (support new RPC queries)
CREATE INDEX idx_avj_rules_version ON public.ai_validation_jobs (rules_version_id)
  WHERE rules_version_id IS NOT NULL;

-- Partial index supports advisory-lock contention check + city run history
CREATE INDEX idx_avj_city_lock ON public.ai_validation_jobs (city_id, status)
  WHERE status IN ('ready', 'running', 'paused');

-- Partial index supports per-rule analytics queries (reverse-time)
CREATE INDEX idx_avr_rule_set_version ON public.ai_validation_results (rule_set_version_id, created_at DESC)
  WHERE rule_set_version_id IS NOT NULL;


-- ── Section 9: RLS policies (admin-only — matches existing admin_ai_* gate) ─

ALTER TABLE public.rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_set_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules_versions ENABLE ROW LEVEL SECURITY;

-- Admin gate identical to existing admin_full_access_ai_validation_* policies
CREATE POLICY admin_full_access_rule_sets ON public.rule_sets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = lower(auth.email()) AND status = 'active'
    )
  );

CREATE POLICY admin_full_access_rule_set_versions ON public.rule_set_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = lower(auth.email()) AND status = 'active'
    )
  );

CREATE POLICY admin_full_access_rule_entries ON public.rule_entries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = lower(auth.email()) AND status = 'active'
    )
  );

CREATE POLICY admin_full_access_rules_versions ON public.rules_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE email = lower(auth.email()) AND status = 'active'
    )
  );


-- ── Section 10: Column comments (in-DB documentation) ───────────────────────

COMMENT ON TABLE public.rule_sets IS
  'ORCH-0526: Logical rule definitions (one row per "drawer"). 18 seeded in M2 from ai-verify-pipeline/index.ts constants. current_version_id points to the active rule_set_versions row.';

COMMENT ON TABLE public.rule_set_versions IS
  'ORCH-0526: Immutable version snapshots per rule_set. Edits create new versions; never UPDATE in place. Trigger rule_set_versions_no_update enforces immutability at the engine level (I-RULE-VERSION-IMMUTABLE).';

COMMENT ON TABLE public.rule_entries IS
  'ORCH-0526: Leaf data per rule_set_version. value is the entry literal (lowercased on insert by RPC). sub_category populated only for EXCLUSION_KEYWORDS. reason required for blacklist/demotion adds (DEC-034 Q3, enforced at admin_rules_save RPC).';

COMMENT ON TABLE public.rules_versions IS
  'ORCH-0526: Manifest tying together a snapshot of ALL rule_set_versions at a point in time. snapshot JSONB shape: {rule_set_id::text: rule_set_version_id::text}. ai_validation_jobs.rules_version_id FKs to here.';

COMMENT ON COLUMN public.ai_validation_jobs.rules_version_id IS
  'ORCH-0526: Pins the run to a specific rules manifest. NULL for pre-cutover legacy runs (transition guard).';
COMMENT ON COLUMN public.ai_validation_jobs.unchanged IS
  'ORCH-0527: Count of places left untouched by a rules-only run. DO NOT misuse `approved` for this purpose; that field is for AI-approved counts only.';
COMMENT ON COLUMN public.ai_validation_jobs.city_id IS
  'ORCH-0530: UUID FK to seeding_cities. Survives city renames; query by this for historical accuracy. The legacy city_filter text column is kept for backward compatibility + display.';
COMMENT ON COLUMN public.ai_validation_jobs.lock_token IS
  'ORCH-0529: Advisory lock key (text-encoded bigint) acquired via pg_try_advisory_xact_lock at handler entry. Auto-released at transaction end.';
COMMENT ON COLUMN public.ai_validation_results.rule_set_version_id IS
  'ORCH-0526 V6 gap close: per-place rule attribution. NULL when stage_resolved=5 (AI verdict) — only populated for rules-only verdicts (stage_resolved=2).';


-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF M1 — Schema ready for seed (M2) and RPCs (M3).
--
-- Verification checklist (run post-deploy):
--   SELECT COUNT(*) FROM rule_sets;                     -- expect 0 (seeded by M2)
--   SELECT COUNT(*) FROM rule_set_versions;             -- expect 0
--   SELECT COUNT(*) FROM rule_entries;                  -- expect 0
--   SELECT COUNT(*) FROM rules_versions;                -- expect 0
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='ai_validation_jobs'
--     AND column_name IN ('rules_version_id','unchanged','city_id','lock_token');
--                                                       -- expect 4 rows
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='ai_validation_results' AND column_name='rule_set_version_id';
--                                                       -- expect 1 row
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chk_avj_stage';
--                                                       -- expect 'rules_only_complete' in the CHECK list
--   -- Immutability trigger smoke test (DO NOT run in prod — dev only):
--   -- INSERT INTO rule_sets (name, kind, scope_kind) VALUES ('test', 'blacklist', 'global');
--   -- INSERT INTO rule_set_versions (rule_set_id, version_number) SELECT id, 1 FROM rule_sets WHERE name='test';
--   -- UPDATE rule_set_versions SET version_number=2; -- should RAISE 'rule_set_versions is immutable'
-- ═══════════════════════════════════════════════════════════════════════════════
