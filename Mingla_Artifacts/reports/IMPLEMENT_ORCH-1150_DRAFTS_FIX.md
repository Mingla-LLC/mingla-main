# IMPLEMENT — ORCH-1150 [snap-autodraft-navigate] · AMENDMENT A (drafts-visibility fix) + tester-test repair

**Skill:** mingla-implementor (business side) · **Date:** 2026-06-15
**Worktree:** `~/Desktop/mingla-orchs/orch-1150-[snap-autodraft-navigate]` on branch `orch-1150-snap-autodraft-navigate`
**SPEC:** AMENDMENT A (§A.4–A.16) · **INVESTIGATE:** F-1 CONFIRMED ROOT CAUSE
**Fix commit:** `fb156cdfc`
**Status:** implemented + self-verified. Migration WRITTEN not applied (orchestrator owns prod apply). Live-fire SC-A4/TA-7 tester-owned.

## 1. Summary
Draft-only brands couldn't see their drafts after a snap: the Hub tab-count was published-only, so the Experiences tab was absent and the ORCH-1145 nav-lock redirect bounced /hub/experiences to /hub/events — the 20+ drafts were real in the DB but unreachable. Fix: draft offerings now count toward Hub tab visibility (all 3 types) via 3 NEW additive draft columns on pg_brand_offering_counts (published columns unchanged), a published-OR-draft gate in useHubTabs, and a counts invalidation after confirmAll so the tab appears on arrival. Also repaired the tester adversarial test for CI-green.

## 2. SC coverage
- SC-A1 (DB cols): PASS — live read-only prod probe on Leggo This: published events=13/trips=0/experiences=0 (identical to today), drafts events_draft=0/trips_draft=5/experiences_draft=21; deleted excluded both.
- SC-A2 (gate): PASS — useHubTabs.draftsCount.test.ts TA-1/TA-5 executed + TA-2.
- SC-A3 (invalidation): PASS — orch1150SnapAutoDraft.test.ts TA-4/SC-A3 asserts BOTH listByBrand + offeringCounts keys.
- SC-A4 (live-fire): DEFERRED — tester-owned (sim/device).
- SC-A5 (no public leak): PASS by construction — public brand page + RPC untouched; published cols unchanged.
- SC-A6 (nav-lock preserved): PASS — empty-type case has no tab; _layout.tsx untouched.
All at fb156cdfc.

## 3. Files changed
- NEW supabase/migrations/20261004000001_orch_1150_offering_counts_include_drafts.sql (+78)
- mingla-business/src/hooks/useBrandOfferingCounts.ts (+21: 3 *_draft fields, EMPTY_COUNTS, mapper ?? 0)
- mingla-business/src/hooks/useHubTabs.ts (+24: draft-inclusive OR gate ?? 0; HubVisibleTabsCounts param type)
- mingla-business/src/hooks/usePendingExperiences.ts (+9: import brandKeys; invalidate offeringCounts)
- NEW mingla-business/src/hooks/__tests__/useHubTabs.draftsCount.test.ts (+120: 8 executed tests)
- .github/scripts/strict-grep/orch-1150-snap-auto-draft.mjs (+160: 3 file checks + 8 self-test cases → 14/14)
- mingla-business/app/experience/__tests__/orch1150SnapAutoDraft.test.ts (+30: useBrands mock + TA-4/SC-A3, additions only)
- mingla-business/app/experience/__tests__/orch1150SnapAutoDraft.tester.adversarial.test.ts (+18: useBrands mock; name-from-parts, additions only)
- mingla-business/package.json (test:orch-1150 runs both 1150 jest files + draftsCount)

## 4. Data-model
NONE applied. Migration FILE only. pg_brand_offering_counts widens RETURNS TABLE 3→6 cols; DROP before CREATE (return-shape widen); deleted_at IS NULL → WHERE (all six); $function$; before GRANT; re-GRANT authenticated.

## 5. Edge functions
NONE.

## 6. Regression tests + fails-on-revert
fails-on-revert verified at fb156cdfc (TRUE LINE DELETION of the `|| (counts.*_draft ?? 0) > 0` clauses):
- jest useHubTabs.draftsCount.test.ts → 4 failed (TA-1, TA-1b, TA-5, SC-A6), 4 passed (published-only/empty cases).
- strict-grep gate → FAILS with all 3 "draft-inclusive clause is missing".
- Restored → jest 8/8; test:orch-1150 40/40 across 4 suites; gate self-test 14/14 + gate PASS.

## 7. Old→New (brief)
- useBrandOfferingCounts: +3 required *_draft fields + mapper ?? 0 (A.5.1).
- useHubTabs: published-only push → published-OR-draft push for all 3; HubVisibleTabsCounts param (draft optional) so legacy callers/venueGate fixture type-check (A.5.2).
- usePendingExperiences: invalidateExperienceList now also invalidates brandKeys.offeringCounts (A.6/DISC-1150-A).
- TASK 2: adversarial test name-from-parts (gate stays strict, no test exclusion); both 1150 tests mock ../useBrands (root-cause fix for the brandKeys→expo-constants ESM ts-jest break); gate extended.

## 8. Cross-surface
Affected: Business iOS/Android/Web-preview (shared RN + shared RPC, automatic parity). Not affected: Consumer iOS/Android, Buyer/anon Web (public page published-only, untouched), Admin Web.

## 9. Smoke
No sim/device (live-fire tester-owned). Verified: full tsc 0 errors; eslint 0 errors; test:orch-1150 40/40; gate 14/14 + PASS; fails-on-revert proven; live read-only prod probe confirms SC-A1.

## 10. Known issues / deferred
SC-A4/TA-7 live-fire is tester-owned. No [TRANSITIONAL] code.

## 11. Operator action
1. Apply migration to prod via Supabase Management API (browser UA). Backend-first before OTA. SQL in §12.
2. OTA business dev channel (npx -y eas-cli@latest update, per-platform, runtime biz 1.0.0).
3. CLOSE: flip I-PROPOSED-1150-DRAFTS-COUNT-FOR-HUB-TAB-VISIBILITY ACTIVE.
No edge deploy.

## 12. Migration SQL (VERBATIM)
```sql
BEGIN;

DROP FUNCTION IF EXISTS public.pg_brand_offering_counts(uuid);

CREATE FUNCTION public.pg_brand_offering_counts(p_brand_id uuid)
RETURNS TABLE (
  events bigint,
  trips bigint,
  experiences bigint,
  events_draft bigint,
  trips_draft bigint,
  experiences_draft bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    count(*) FILTER (WHERE event_type = 'event'      AND published_at IS NOT NULL) AS events,
    count(*) FILTER (WHERE event_type = 'trip'       AND published_at IS NOT NULL) AS trips,
    count(*) FILTER (WHERE event_type = 'experience' AND published_at IS NOT NULL) AS experiences,
    count(*) FILTER (WHERE event_type = 'event'      AND published_at IS NULL)     AS events_draft,
    count(*) FILTER (WHERE event_type = 'trip'       AND published_at IS NULL)     AS trips_draft,
    count(*) FILTER (WHERE event_type = 'experience' AND published_at IS NULL)     AS experiences_draft
  FROM public.events
  WHERE brand_id = p_brand_id
    AND deleted_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_brand_offering_counts(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) TO authenticated;

COMMIT;
```
Read-only prod verification (SC-A1): Leggo This 22a18413-bfbf-4087-9ba7-45f70deba0f3 → published 13/0/0 (identical), drafts 0/5/21; deleted excluded both.

## 13. DO-NOT-TOUCH confirmation
UNTOUCHED this turn: hub/_layout.tsx, hub/events.tsx, hub/experiences.tsx, hub/trips.tsx, b/[brandSlug]/index.tsx + public RPC, snap.tsx (base-SPEC work only, last commit c5402aa39), create_experience executor, parser Gemini cores, Ari path, DISC-1150-C useState(defaultFilter) lines. This-turn working set = exactly the AMENDMENT A allowlist (§3).

## 14. Discoveries for orchestrator
1. PARALLEL ORCH-1150 ID COLLISION: sibling worktree orch-1150-[rsvp-event-wizard] has migration 20261004000000_orch_1150_rsvp_events.sql — a second unrelated session also numbered 1150 (stale-anchor collision, COMMS-0033 pattern). My 20261004000001 is monotonically above it (no migration conflict) but the two 1150s will collide on World Map/artifact naming at CLOSE. Recommend renumbering one (shipped-first rule).
2. DISC-1150-C still open (latent): useState(defaultFilter) never re-syncs after counts load; left UNTOUCHED per A.13.
3. DISC-1150-A resolved: confirmAll→counts invalidation gap closed.
4. ts-jest break root cause: reproduced only after importing brandKeys (→useBrands→supabase→expo-constants ESM); fixed by mocking ../useBrands in both 1150 tests.
