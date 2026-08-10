-- ISSUE-1734 [Growth tools shared platform — dual-lane backbone] — the single
-- additive migration (SPEC #1734 P-52; supersedes the P-9/P-12 partial lists).
--
-- WHAT THIS DOES (all additive; the anonymous web funnel is byte-stable):
--   1. tool_leads gains 6 columns: lane ('web'|'app', NOT NULL DEFAULT 'web'),
--      user_id, brand_id, client_ref, input_hash (P-9) + subject_ref (P-40).
--   2. Three named CHECKs (pg_constraint-guarded for idempotency):
--      tool_leads_lane_check, tool_leads_lane_identity_check (P-9),
--      tool_leads_subject_ref_lane_check (P-41 — a web row can never carry a
--      subject; format pinned to '<venue|competitor|event>:<uuid>').
--   3. Four partial indexes serving the app-lane quota counter (P-19), the
--      input-hash cache (P-22), the client_ref resume read (P-27) and the
--      latest-by-subject read (P-42/P-43).
--   4. Self-asserts: every pre-existing row satisfies every new CHECK.
--   5. public.tool_competitors — the per-venue competitor watch list (P-45):
--      real FKs (list data dies with its venue/brand — unlike the log-shaped
--      tool_leads, which keeps soft refs), structural dedup (unique index on
--      venue + lowercased website), structural cap-5 (BEFORE INSERT trigger
--      with per-venue FOR UPDATE serialization), RLS deny-all (P-46).
--   6. Admin RPC drop-and-recreate (P-50, D-S1a resolved): admin_tool_leads_list
--      gains `p_lane` filter + `lane` output column (appended LAST);
--      admin_tool_lead_get gains lane/brand_id/user_id/subject_ref (appended
--      LAST, in that order). Guard-first is_admin_user() shape preserved
--      EXACTLY (i-admin-gate-first-statement gate must stay green); lockdown
--      (revoke public+anon / grant authenticated) re-applied against the NEW
--      signatures; apply-time privilege self-asserts updated.
--
-- IDENTITY MODEL: tool_leads.user_id / brand_id are SOFT references —
-- deliberately NO FK (precedent: place_match_id on this same table; run
-- history is a log and must survive brand/user deletion). Enforcement of who
-- may write them lives in the edge functions' P-3 auth chain
-- (_shared/growthToolsAuth.ts): user_id comes exclusively from
-- auth.getUser(token), brand_id must pass biz_is_brand_member_for_read.
--
-- ACCESS MODEL: tool_leads RLS stays deny-all with ZERO policies (P-13 — the
-- row co-locates report_token / email / ip_hash; the authenticated "my run"
-- read is the edge function's column-allowlisted select, never RLS).
-- tool_competitors is ALSO deny-all with ZERO policies (P-46 — one enforcement
-- door, in code, behind the P-3 chain; the list read ships joined tool_leads
-- data which is itself deny-all, so table RLS would still leave the edge path
-- as the real door — two doors = drift).
--
-- SAFE-MIGRATION: purely additive, idempotent (IF NOT EXISTS + pg_constraint
-- guards + drop-function-if-exists). Applied to prod via the Management-API
-- surgical lane + schema_migrations stamp (COMMS-0122 — NO blind `db push`).
-- ROLLBACK block at the bottom.
--
-- Enforces (DRAFT until CLOSE): I-PROPOSED-1734-ATTRIBUTION-WEB-ONLY-AND-PRESERVED,
--   I-PROPOSED-1734-SUBJECT-REF-APP-LANE-ONLY,
--   I-PROPOSED-1734-COMPETITOR-WATCH-SERVER-SIDE,
--   I-PROPOSED-1734-RUN-HISTORY-APPEND-ONLY (no destructive DDL here — append
--   posture preserved), I-1045-ANON-NO-SELECT (deny-all unchanged).

--------------------------------------------------------------------------------
-- 1. tool_leads — the 6 new columns (P-9 + P-40). All nullable except lane
--    (NOT NULL DEFAULT 'web' — every existing row backfills to the web lane by
--    default, which is exactly what they are).
--------------------------------------------------------------------------------
ALTER TABLE public.tool_leads ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'web';
ALTER TABLE public.tool_leads ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.tool_leads ADD COLUMN IF NOT EXISTS brand_id uuid;
ALTER TABLE public.tool_leads ADD COLUMN IF NOT EXISTS client_ref uuid;
ALTER TABLE public.tool_leads ADD COLUMN IF NOT EXISTS input_hash text;
ALTER TABLE public.tool_leads ADD COLUMN IF NOT EXISTS subject_ref text;

COMMENT ON COLUMN public.tool_leads.lane IS
    'ISSUE-1734: which lane produced this row. web = anonymous marketing funnel (default; all pre-1734 rows); app = signed-in Business app. Lane is body-explicit (lane:"app"), never header-sniffed.';
COMMENT ON COLUMN public.tool_leads.user_id IS
    'ISSUE-1734: app lane only. SOFT reference to auth.users (NO FK — run history is a log and survives account deletion, same posture as place_match_id). Written exclusively from auth.getUser(token) in the P-3 chain — never from a client field.';
COMMENT ON COLUMN public.tool_leads.brand_id IS
    'ISSUE-1734: app lane only. SOFT reference to brands (NO FK — survives brand deletion). Must have passed biz_is_brand_member_for_read for the verified user before insert.';
COMMENT ON COLUMN public.tool_leads.client_ref IS
    'ISSUE-1734: app lane only. Client-minted per-attempt UUID for the P-27 resume poll (growth-tools-report {lane:"app", client_ref}).';
COMMENT ON COLUMN public.tool_leads.input_hash IS
    'ISSUE-1734: app lane only. sha256(tool + "\n" + canonicalJson(normalizedInput)) hex — the P-22 cache key. Unchanged inputs re-serve the stored report (no quota, no model call).';
COMMENT ON COLUMN public.tool_leads.subject_ref IS
    'ISSUE-1734: app lane only. Opaque grouping key ''<venue|competitor|event>:<uuid>'' — venue:<venue_listings.id> (grader/pricing standing checks), competitor:<tool_competitors.id> (watch runs), event: format-reserved (no v1 writer). Composed SERVER-side after entity ownership is proven (P-41); never client-composed, never joined in SQL (soft-ref posture).';

--------------------------------------------------------------------------------
-- 2. tool_leads — the 3 CHECKs, each pg_constraint-guarded (ADD CONSTRAINT has
--    no IF NOT EXISTS). Adding a CHECK validates all existing rows — the
--    37-row backfill is proven at apply time, twice (here + section 4).
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tool_leads_lane_check'
      AND conrelid = 'public.tool_leads'::regclass
  ) THEN
    ALTER TABLE public.tool_leads
      ADD CONSTRAINT tool_leads_lane_check CHECK (lane IN ('web', 'app'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tool_leads_lane_identity_check'
      AND conrelid = 'public.tool_leads'::regclass
  ) THEN
    -- Lane and identity are mutually consistent AT THE SCHEMA LAYER: an
    -- identity-less app row or an identity-carrying web row is impossible,
    -- not just untested (the F-5 funnel-pollution risk closed structurally).
    ALTER TABLE public.tool_leads
      ADD CONSTRAINT tool_leads_lane_identity_check CHECK (
        (lane = 'web' AND user_id IS NULL AND brand_id IS NULL)
        OR
        (lane = 'app' AND user_id IS NOT NULL AND brand_id IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tool_leads_subject_ref_lane_check'
      AND conrelid = 'public.tool_leads'::regclass
  ) THEN
    -- P-41: a web row with a subject is impossible; format pinned to the P-40
    -- normative regex (full 36-char UUID shape).
    ALTER TABLE public.tool_leads
      ADD CONSTRAINT tool_leads_subject_ref_lane_check CHECK (
        (subject_ref IS NULL OR lane = 'app')
        AND (
          subject_ref IS NULL
          OR subject_ref ~ '^(venue|competitor|event):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
      );
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 3. tool_leads — the 4 partial indexes (P-9 + P-42). All scoped lane='app';
--    web-lane query plans are untouched.
--------------------------------------------------------------------------------
-- P-19 brand-keyed quota counter: count(*) per brand per tool per 24h.
CREATE INDEX IF NOT EXISTS idx_tool_leads_app_quota
    ON public.tool_leads (brand_id, tool, created_at DESC) WHERE lane = 'app';
-- P-22 input-hash cache: newest report_ready row for (brand, tool, hash).
CREATE INDEX IF NOT EXISTS idx_tool_leads_app_cache
    ON public.tool_leads (brand_id, tool, input_hash, created_at DESC) WHERE lane = 'app';
-- P-27 resume poll by client_ref.
CREATE INDEX IF NOT EXISTS idx_tool_leads_app_client_ref
    ON public.tool_leads (client_ref) WHERE client_ref IS NOT NULL;
-- P-42/P-43 latest-by-subject read + the watch_list latest join.
CREATE INDEX IF NOT EXISTS idx_tool_leads_app_subject
    ON public.tool_leads (brand_id, tool, subject_ref, created_at DESC)
    WHERE lane = 'app' AND subject_ref IS NOT NULL;

--------------------------------------------------------------------------------
-- 4. Self-asserts (P-9/P-52 item 4): apply FAILS if any pre-existing row
--    violates the new contract. All pre-1734 rows must read lane='web' with
--    NULL identity and NULL subject.
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad FROM public.tool_leads
  WHERE NOT (
    (lane = 'web' AND user_id IS NULL AND brand_id IS NULL)
    OR
    (lane = 'app' AND user_id IS NOT NULL AND brand_id IS NOT NULL)
  );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ISSUE-1734: % tool_leads rows violate tool_leads_lane_identity_check', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.tool_leads
  WHERE lane NOT IN ('web', 'app');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ISSUE-1734: % tool_leads rows violate tool_leads_lane_check', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.tool_leads
  WHERE subject_ref IS NOT NULL
    AND (
      lane <> 'app'
      OR subject_ref !~ '^(venue|competitor|event):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ISSUE-1734: % tool_leads rows violate tool_leads_subject_ref_lane_check', v_bad;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- 5. public.tool_competitors — the competitor watch list (P-45/P-46).
--    LIST data (live product state), so unlike tool_leads it takes REAL FKs:
--    delete the venue or the brand and the watch list dies with it. The RUN
--    HISTORY does not (P-48 — orphaned 'competitor:<dead-id>' tool_leads rows
--    survive as spend/quota records; nothing queries a dead subject in-app).
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_competitors (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id         uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    venue_listing_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
    -- Length CHECKs mirror the grader's own input validation (name 2-80,
    -- city 2-60) so a stored competitor is always a runnable engine input.
    name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
    city             text NOT NULL CHECK (length(btrim(city)) BETWEEN 2 AND 60),
    -- Stored as the user gave it; full URL normalization + SSRF guarding
    -- happens at RUN time in the engine (isPrivateHost path) — the engine
    -- remains the gatekeeper of what gets fetched.
    website          text NOT NULL CHECK (length(btrim(website)) > 0),
    place_pool_id    uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
    created_by       uuid NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tool_competitors IS
    'ISSUE-1734: per-venue competitor watch list (max 5/venue, trigger-enforced). RLS deny-all, ZERO policies — service-role only; ALL CRUD flows through growth-tools-run app-lane actions behind the P-3 auth chain (single audited door). brand_id is denormalized beside venue_listing_id so ownership checks are one select (consistency asserted by the cap-guard trigger). Holds competitor PUBLIC business facts only (name/city/website) — no PII class enters this table.';
COMMENT ON COLUMN public.tool_competitors.created_by IS
    'ISSUE-1734: SOFT reference to the auth user who added the row (NO FK — survives member departure). Set from the P-3 verified userId, never a client field.';

-- Deny-all: RLS on, NO policies (P-46).
ALTER TABLE public.tool_competitors ENABLE ROW LEVEL SECURITY;

-- Watch-list read order per venue.
CREATE INDEX IF NOT EXISTS idx_tool_competitors_venue
    ON public.tool_competitors (venue_listing_id, created_at);
-- Structural dedup: the same website twice on one venue would split one
-- competitor's history across two subject ids and break the diff (P-45).
-- Edge maps the violation to 409 {error:"duplicate_competitor"}.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_competitors_venue_site
    ON public.tool_competitors (venue_listing_id, lower(btrim(website)));

-- Structural cap-5 (P-45): BEFORE INSERT trigger. The FOR UPDATE on the venue
-- row serializes concurrent adds per venue — the cap cannot be raced past.
-- The cap constant also lives as a code const in the edge action (friendly
-- 409 before the DB is hit); this trigger is the backstop that makes even a
-- service-role coding bug unable to exceed 5. NOT env-tunable in v1.
CREATE OR REPLACE FUNCTION public.tool_competitors_cap_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
AS $$
BEGIN
  PERFORM 1 FROM public.venue_listings v WHERE v.id = NEW.venue_listing_id FOR UPDATE;  -- serialize per venue
  IF NOT FOUND THEN RAISE EXCEPTION 'venue_not_found'; END IF;
  IF (SELECT v.brand_id FROM public.venue_listings v WHERE v.id = NEW.venue_listing_id) IS DISTINCT FROM NEW.brand_id
    THEN RAISE EXCEPTION 'brand_mismatch'; END IF;
  IF (SELECT count(*) FROM public.tool_competitors t WHERE t.venue_listing_id = NEW.venue_listing_id) >= 5
    THEN RAISE EXCEPTION 'competitor_watch_cap'; END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_tool_competitors_cap_guard ON public.tool_competitors;
CREATE TRIGGER trg_tool_competitors_cap_guard
    BEFORE INSERT ON public.tool_competitors
    FOR EACH ROW EXECUTE FUNCTION public.tool_competitors_cap_guard();

--------------------------------------------------------------------------------
-- 6. Admin RPC drop-and-recreate (P-50; supersedes P-12; preserves the exact
--    guard-first + lockdown + self-assert shape of 20270119001354).
--    D-S1a RESOLVED: app runs appear in the console, lane-badged, default All
--    (p_lane null = All — the house p_tool filter shape; unknown values match
--    nothing, no exception).
--------------------------------------------------------------------------------
-- Drop BOTH the old 5-arg and (idempotently) any prior 6-arg list signature.
drop function if exists public.admin_tool_leads_list(text, boolean, text, int, int);
drop function if exists public.admin_tool_leads_list(text, boolean, text, int, int, text);

create function public.admin_tool_leads_list(
  p_tool      text    default null,
  p_has_email boolean default null,
  p_search    text    default null,
  p_limit     int     default 100,
  p_offset    int     default 0,
  p_lane      text    default null
)
  returns table(
    id             uuid,
    tool           text,
    status         text,
    created_at     timestamptz,
    email          text,
    has_report     boolean,
    input          jsonb,
    pid            text,
    utm            jsonb,
    place_match_id uuid,
    total_count    bigint,
    lane           text
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  -- (I-ADMIN-GATE-FIRST-STATEMENT) guard FIRST — DB-level admin enforcement
  -- (SPEC-REVIEW amendment), on top of the authenticated-only EXECUTE grant.
  if not public.is_admin_user() then raise exception 'not_authorized'; end if;

  return query
  select
    tl.id,
    tl.tool,
    tl.status,
    tl.created_at,
    tl.email,
    (tl.report is not null)             as has_report,
    tl.input,
    tl.pid,
    tl.utm,
    tl.place_match_id,
    count(*) over ()                    as total_count,
    tl.lane
  from public.tool_leads tl
  where (p_tool is null or tl.tool = p_tool)
    and (p_lane is null or tl.lane = p_lane)
    and (
      p_has_email is null
      or (p_has_email and tl.email is not null)
      or (not p_has_email and tl.email is null)
    )
    and (
      p_search is null
      or btrim(p_search) = ''
      or tl.email ilike '%' || p_search || '%'
      or tl.input->>'name' ilike '%' || p_search || '%'
      or tl.input->>'title' ilike '%' || p_search || '%'
    )
  order by tl.created_at desc
  limit v_limit offset v_offset;
end;
$$;

drop function if exists public.admin_tool_lead_get(uuid);

create function public.admin_tool_lead_get(p_id uuid)
  returns table(
    id             uuid,
    tool           text,
    status         text,
    created_at     timestamptz,
    email          text,
    input          jsonb,
    report         jsonb,
    pid            text,
    utm            jsonb,
    place_match_id uuid,
    report_token   text,
    lane           text,
    brand_id       uuid,
    user_id        uuid,
    subject_ref    text
  )
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $$
begin
  -- (I-ADMIN-GATE-FIRST-STATEMENT) guard FIRST.
  if not public.is_admin_user() then raise exception 'not_authorized'; end if;

  return query
  select
    tl.id,
    tl.tool,
    tl.status,
    tl.created_at,
    tl.email,
    tl.input,
    tl.report,
    tl.pid,
    tl.utm,
    tl.place_match_id,
    tl.report_token,
    tl.lane,
    tl.brand_id,
    tl.user_id,
    tl.subject_ref
  from public.tool_leads tl
  where tl.id = p_id;
end;
$$;

comment on function public.admin_tool_leads_list(text, boolean, text, int, int, text) is
  'ISSUE-1354 + ISSUE-1734: admin list of tool_leads (all rows, filter by tool + '
  'has-email + search + lane; p_lane null = All, ''web''/''app'' filter exactly, '
  'unknown values match nothing). SECURITY DEFINER, search_path pinned, '
  'is_admin_user() guard FIRST + EXECUTE granted to authenticated only. NEVER '
  'returns report / report_token / ip_hash. tool_leads stays RLS deny-all.';

comment on function public.admin_tool_lead_get(uuid) is
  'ISSUE-1354 + ISSUE-1734: admin detail of one tool_lead (input + report + '
  'report_token + lane/brand_id/user_id/subject_ref for the modal). SECURITY '
  'DEFINER, search_path pinned, is_admin_user() guard FIRST + EXECUTE granted to '
  'authenticated only. NEVER returns ip_hash. tool_leads stays RLS deny-all.';

-- Least-privilege lockdown re-applied against the NEW signatures (a drop
-- discards grants): revoke from public + anon, grant to authenticated only.
revoke all    on function public.admin_tool_leads_list(text, boolean, text, int, int, text) from public;
revoke all    on function public.admin_tool_leads_list(text, boolean, text, int, int, text) from anon;
grant execute on function public.admin_tool_leads_list(text, boolean, text, int, int, text) to authenticated;

revoke all    on function public.admin_tool_lead_get(uuid) from public;
revoke all    on function public.admin_tool_lead_get(uuid) from anon;
grant execute on function public.admin_tool_lead_get(uuid) to authenticated;

-- Self-assert: apply FAILS unless the privilege lockdown holds on the NEW
-- signatures (anon cannot execute; authenticated can).
do $$
begin
  if has_function_privilege('anon', 'public.admin_tool_leads_list(text, boolean, text, int, int, text)', 'EXECUTE') then
    raise exception 'ISSUE-1734: admin_tool_leads_list still EXECUTE-able by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_tool_leads_list(text, boolean, text, int, int, text)', 'EXECUTE') then
    raise exception 'ISSUE-1734: authenticated lost EXECUTE on admin_tool_leads_list (admin UI would break)';
  end if;
  if has_function_privilege('anon', 'public.admin_tool_lead_get(uuid)', 'EXECUTE') then
    raise exception 'ISSUE-1734: admin_tool_lead_get still EXECUTE-able by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_tool_lead_get(uuid)', 'EXECUTE') then
    raise exception 'ISSUE-1734: authenticated lost EXECUTE on admin_tool_lead_get (admin UI would break)';
  end if;
end $$;

--------------------------------------------------------------------------------
-- ROLLBACK (manual, if ever needed — forward-only pipeline, documented per
-- safe-migration protocol):
--   DROP TRIGGER IF EXISTS trg_tool_competitors_cap_guard ON public.tool_competitors;
--   DROP FUNCTION IF EXISTS public.tool_competitors_cap_guard();
--   DROP INDEX IF EXISTS public.uq_tool_competitors_venue_site;
--   DROP INDEX IF EXISTS public.idx_tool_competitors_venue;
--   DROP TABLE IF EXISTS public.tool_competitors;
--   DROP INDEX IF EXISTS public.idx_tool_leads_app_subject;
--   DROP INDEX IF EXISTS public.idx_tool_leads_app_client_ref;
--   DROP INDEX IF EXISTS public.idx_tool_leads_app_cache;
--   DROP INDEX IF EXISTS public.idx_tool_leads_app_quota;
--   ALTER TABLE public.tool_leads DROP CONSTRAINT IF EXISTS tool_leads_subject_ref_lane_check;
--   ALTER TABLE public.tool_leads DROP CONSTRAINT IF EXISTS tool_leads_lane_identity_check;
--   ALTER TABLE public.tool_leads DROP CONSTRAINT IF EXISTS tool_leads_lane_check;
--   ALTER TABLE public.tool_leads DROP COLUMN IF EXISTS subject_ref;
--   ALTER TABLE public.tool_leads DROP COLUMN IF EXISTS input_hash;
--   ALTER TABLE public.tool_leads DROP COLUMN IF EXISTS client_ref;
--   ALTER TABLE public.tool_leads DROP COLUMN IF EXISTS brand_id;
--   ALTER TABLE public.tool_leads DROP COLUMN IF EXISTS user_id;
--   ALTER TABLE public.tool_leads DROP COLUMN IF EXISTS lane;
--   DROP FUNCTION IF EXISTS public.admin_tool_leads_list(text, boolean, text, int, int, text);
--   DROP FUNCTION IF EXISTS public.admin_tool_lead_get(uuid);
--   -- then recreate the 5-arg RPCs from 20270119001354_issue_1354_tool_leads_admin_rpc.sql verbatim.
