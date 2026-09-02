-- Issue #3055 — deliver #1977's certification-requirement delta at a reachable
-- version, with a delta-shaped guard instead of an absolute row count.
--
-- WHY THIS FILE EXISTS
-- 20270530001977 carries three changes to public.ari_cert_capability_requirements
-- and has NEVER run anywhere: it is version-shadowed (sorts below production's
-- applied head 20270616003047 and below 23 other applied versions, so
-- `db push --linked` skips it), and it additionally aborted on
-- `IF v_count <> 120` while production holds 132 rows. Its ROUTINES were
-- re-published byte-identically at reachable versions by #3044 (20270615003044)
-- and #3047 (20270616003047). Its certification-requirement delta was not, and
-- is the outstanding work this file delivers. Decision (b) on #3055:
-- 20270530001977 is retired as a delivery vehicle rather than made applicable,
-- because renaming it would make it a second owner of twelve already-live
-- routines.
--
-- PROBED AGAINST PRODUCTION gqnoajqerqhnvulmnyvv on 2026-09-02 (read-only):
--   count(*)                          = 132
--   ari.guests.set_approval           = PRESENT   (this file retires it)
--   ari.rsvp.update                   = ABSENT    (this file inserts it, 'write')
--   ari.rsvp.contribution_settings    = 'unsupported' (this file promotes to 'write')
--   ari_cert_evidence rows            = 0, ari_cert_runs = 0
--     → no in-flight certification run can be invalidated by this change.
--   ari_cert_begin_run / ari_cert_finalize_run contain no 120 literal and no
--     pinned requirements digest in production, so no digest is broken.
--
-- WHY NOT A COUNT LITERAL
-- docs/contracts/ari-capability-ledger.json — the contract of record — holds 132
-- capabilities. Production holds 132 rows. The counts MATCH while the sets do
-- NOT: production has ari.guests.set_approval and lacks ari.rsvp.update. A
-- `<> 132` guard would have passed on a genuinely drifted set. An absolute count
-- is simultaneously too brittle (it rots on the next unrelated capability) and
-- too weak (it cannot see a same-count swap). This file asserts the DELTA it is
-- responsible for: net-zero movement against a baseline captured before its own
-- statements, plus the three membership facts. After this migration the requirement
-- set is exactly the ledger's 132 ids — verified set-equal offline before shipping.
--
-- Self-wrapped transaction — this is applied via the Management API
-- /database/query endpoint, which does NOT wrap a multi-statement body. Without
-- its own transaction the delete could land without the insert, leaving the
-- certified set one row short with the trigger already re-armed.
--
-- Creates no new function, table, view or type, so there is no inherited
-- anon/authenticated grant to revoke. It mutates rows in an existing table whose
-- grants and RLS are owned by 20270504002060.

BEGIN;

-- Baseline captured BEFORE this file touches the requirement table.
-- Transaction-local (set_config(..., true)); cannot leak to another migration.
DO $issue_3055_baseline$
DECLARE v_baseline integer;
BEGIN
  IF to_regclass('public.ari_cert_capability_requirements') IS NULL THEN
    RAISE EXCEPTION 'issue_3055_cert_requirements_table_missing';
  END IF;
  SELECT count(*) INTO v_baseline FROM public.ari_cert_capability_requirements;
  PERFORM set_config('mingla.issue_3055_cert_baseline', v_baseline::text, true);
END;
$issue_3055_baseline$;

-- The requirement set is protected by an immutability trigger. #1977 drops it,
-- applies the reviewed delta, and re-arms it in the same transaction; this file
-- does the same. Definition re-created here is byte-identical to the one live in
-- production (verified via pg_get_triggerdef).
DROP TRIGGER IF EXISTS ari_cert_capability_requirements_immutable_trigger
  ON public.ari_cert_capability_requirements;

-- 1. Retire the duplicate approval requirement in favour of
--    set_rsvp_guest_status's selected scope. Idempotent: a no-op where #1977
--    already applied it (i.e. any full-chain CI database).
DELETE FROM public.ari_cert_capability_requirements
WHERE capability_id = 'ari.guests.set_approval';

-- 2. Promote contribution settings from unsupported/read to write.
UPDATE public.ari_cert_capability_requirements
SET evidence_mode = 'write'
WHERE capability_id = 'ari.rsvp.contribution_settings'
  AND evidence_mode IN ('unsupported', 'read');

-- 3. Insert the RSVP update write requirement, so the set stays the same size.
INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES ('ari.rsvp.update', 'write')
ON CONFLICT (capability_id) DO UPDATE
SET evidence_mode = EXCLUDED.evidence_mode;

CREATE TRIGGER ari_cert_capability_requirements_immutable_trigger
BEFORE UPDATE OR DELETE ON public.ari_cert_capability_requirements
FOR EACH ROW EXECUTE FUNCTION public.ari_cert_evidence_immutable();

DO $issue_3055_cert_delta$
DECLARE
  v_baseline integer := NULLIF(current_setting('mingla.issue_3055_cert_baseline', true), '')::integer;
  v_final integer;
  v_missing text;
BEGIN
  -- A zero needs its denominator: refuse to pass vacuously if the baseline was
  -- never captured, instead of comparing against NULL and asserting nothing.
  IF v_baseline IS NULL THEN
    RAISE EXCEPTION 'issue_3055_certification_baseline_not_captured';
  END IF;
  IF v_baseline < 1 THEN
    RAISE EXCEPTION 'issue_3055_certification_baseline_empty:%', v_baseline;
  END IF;

  SELECT count(*) INTO v_final FROM public.ari_cert_capability_requirements;

  -- (4) NET ZERO against the captured baseline — never against a literal.
  IF v_final <> v_baseline THEN
    RAISE EXCEPTION
      'issue_3055_certification_requirement_net_delta:baseline=% final=% delta=%',
      v_baseline, v_final, v_final - v_baseline;
  END IF;

  -- (2) + (3) Both write requirements present with evidence_mode='write'.
  SELECT string_agg(format('%s=>%s', expected.capability_id, expected.evidence_mode),
                    ', ' ORDER BY expected.capability_id)
    INTO v_missing
  FROM (VALUES
    ('ari.rsvp.update', 'write'),
    ('ari.rsvp.contribution_settings', 'write')
  ) expected(capability_id, evidence_mode)
  LEFT JOIN public.ari_cert_capability_requirements actual
    USING (capability_id, evidence_mode)
  WHERE actual.capability_id IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3055_certification_requirement_drift:missing=%', v_missing;
  END IF;

  -- (1) The retired duplicate is gone. Together with (2) this is the same-count
  -- swap an absolute count literal cannot detect.
  IF EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.guests.set_approval'
  ) THEN
    RAISE EXCEPTION
      'issue_3055_certification_requirement_drift:retired_still_present=ari.guests.set_approval';
  END IF;

  -- The immutability trigger must be re-armed before this transaction commits.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ari_cert_capability_requirements'
      AND t.tgname = 'ari_cert_capability_requirements_immutable_trigger'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'issue_3055_certification_immutability_trigger_not_rearmed';
  END IF;
END;
$issue_3055_cert_delta$;

COMMIT;
