-- Issue #3355 rework 1 (tester P1-1) — the repository's events-discount-codes
-- Feature Guide entry matches production.
--
-- Production applied PR #4099's complete release record through the #4179
-- release bridge (Discounts R1, merged 2026-10-24 20:23 UTC as 0dbcfcfb2d,
-- live check 2026-10-24 20:49 UTC on issue #3872), so the entry is claimed
-- live there. A from-zero replay of this repository never sees that bridge
-- run and still reads the 2026-10 "planned" seed, which made Ari say discount
-- codes are "not available yet" (and led Wave F to a rule that upgraded
-- planned entries; that rule is removed in the same pull request).
--
-- Forward-only, through docs/runbooks/feature-guide.md: the same proof the
-- release bridge records (merge commit, pull request, release record and the
-- live check with its 90-day expiry), then the claim, verification date and
-- last-verified time. It acts ONLY while the entry is still claimed planned,
-- so on production (already live, with its own proof) it changes nothing and
-- never overwrites a person's evidence. Limitations keep "Available to pilot
-- brands until general availability" (unchanged).
--
-- Static SQL. Idempotent: a second run finds the entry already live.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_capability_evidence') IS NULL
     OR to_regclass('public.product_truth_audit') IS NULL THEN
    RAISE EXCEPTION 'issue3355_discount_guide_foundation_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.product_capabilities
     WHERE capability_key = 'events-discount-codes'
  ) THEN
    RAISE EXCEPTION 'issue3355_discount_guide_capability_missing';
  END IF;
END;
$foundation$;

CREATE TEMP TABLE issue_3355_discount_guide_target ON COMMIT DROP AS
SELECT c.id
  FROM public.product_capabilities c
 WHERE c.capability_key = 'events-discount-codes'
   AND c.claimed_status = 'planned'
 FOR UPDATE;

CREATE TEMP TABLE issue_3355_discount_guide_proof ON COMMIT DROP AS
SELECT *
  FROM (VALUES
    ('source',
     'https://github.com/Mingla-LLC/mingla-main/commit/0dbcfcfb2dd0358fdfc4bdcb8314fb32b68b1d08',
     'Merge commit of PR #4099 (Discounts R1: Host saving and editor).',
     '2026-10-24T20:23:01Z'::timestamptz, NULL::timestamptz),
    ('pull_request',
     'https://github.com/Mingla-LLC/mingla-main/pull/4099',
     'PR #4099 merged 24 Oct 2026 20:23 UTC.',
     '2026-10-24T20:23:01Z'::timestamptz, NULL::timestamptz),
    ('release_record',
     'https://github.com/Mingla-LLC/mingla-main/issues/3872#issuecomment-6389131230',
     'Release record of PR #4099 (merge 0dbcfcfb2) is complete.',
     '2026-10-24T20:25:44Z'::timestamptz, NULL::timestamptz),
    ('live_check',
     'https://github.com/Mingla-LLC/mingla-main/issues/3872#issuecomment-6389366354',
     'Live check by a teammate: in production the Host Discounts editor created (then paused) a code for the pilot brand, and the checkout quote accepted it. Pilot brands only until general availability.',
     '2026-10-24T20:49:27Z'::timestamptz, '2027-01-22T20:49:27Z'::timestamptz)
  ) AS proof(kind, url, details, observed_at, expires_at);

UPDATE public.product_capability_evidence e
   SET is_current = false
  FROM issue_3355_discount_guide_target t, issue_3355_discount_guide_proof p
 WHERE e.capability_id = t.id
   AND e.evidence_kind = p.kind
   AND e.is_current;

WITH recorded AS (
  INSERT INTO public.product_capability_evidence(
    capability_id, evidence_kind, evidence_url, verdict, details,
    observed_at, expires_at
  )
  SELECT t.id, p.kind, p.url, 'verified', p.details, p.observed_at, p.expires_at
    FROM issue_3355_discount_guide_target t
   CROSS JOIN issue_3355_discount_guide_proof p
  RETURNING id, capability_id, evidence_kind
)
INSERT INTO public.product_truth_audit(action, capability_id, evidence_id, metadata)
SELECT 'evidence_recorded', r.capability_id, r.id,
       jsonb_build_object('source', 'issue_3355_feature_guide_discount_codes_live',
         'issue', 3355, 'pr', 4099, 'evidence_kind', r.evidence_kind,
         'verdict', 'verified')
  FROM recorded r;

WITH saved AS (
  UPDATE public.product_capabilities c
     SET claimed_status = 'live',
         verification_due_at = '2027-01-22T20:49:27Z',
         last_verified_at = '2026-10-24T20:49:27Z',
         revision = c.revision + 1,
         updated_at = now()
    FROM issue_3355_discount_guide_target t
   WHERE c.id = t.id
  RETURNING c.id, c.revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', id,
       jsonb_build_object('source', 'issue_3355_feature_guide_discount_codes_live',
         'issue', 3355, 'capability_key', 'events-discount-codes',
         'revision', revision, 'claimed_status', 'live')
  FROM saved;

COMMIT;
