# IMPLEMENTATION - ORCH-0943 Collab Apply Coord Corruption

**Status:** implemented, partially verified  
**Date:** 2026-05-23  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Base HEAD observed:** `d600f05671a4f32bc4904f2e38afc7dfb0c5b294` (dispatch named `16a671ea`, but local checkout had advanced before implementation)  
**Inputs:** `Mingla_Artifacts/specs/SPEC_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md`, `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md`, `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md`, current mobile source files, `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

## Summary

Implemented Fix A, Fix B1, Fix D audit, Fix 5 invariant and strict-grep gate. Fix C SQL is included verbatim below for operator-gated execution; no SQL was run and no Supabase mutation happened.

Live simulator, operator iPhone, and production SQL verification remain downstream tester/operator gates. Scoped TypeScript verification did not produce a clean repo signal because the app-mobile TypeScript command hits pre-existing compiler/config/dependency errors outside ORCH-0943.

## File Receipts

| File | Old | New |
| --- | --- | --- |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | R3.8 GPS-sync effect always upserted `{ custom_lat, custom_lng }` when collab/session/userLocation/user were present. | Effect now reads `boardSessionResult.preferences?.use_gps_location`, returns unless it is exactly `true`, and includes that field in the dependency array. GPS-mode behavior is preserved. |
| `app-mobile/src/components/PreferencesSheet.tsx` | Non-GPS Apply could proceed only after `selectedCoords` was set by UI state; free typed text could not be resolved at Apply. Payloads read `selectedCoords` directly. | Apply auto-resolves typed custom-location text through `geocodingService.autocomplete`, canonicalizes text, validates bounds, blocks with `toastManager.warning('Tap a suggestion to set your location.', 3000)` on failure, and threads local `effectiveSelectedCoords` into both solo and collab payloads to avoid React batching staleness. `hasLocation` now permits non-empty text so Apply can trigger auto-resolve. |
| `app-mobile/src/hooks/useSessionManagement.ts` | Audit target at line 422. | No code edit. Classification: FULL payload. `creatorPrefsPayload` includes `use_gps_location`, `custom_location`, `custom_lat`, and `custom_lng` together before `upsert_participant_prefs`. |
| `app-mobile/src/components/__tests__/orch-0943-prefs-apply-coord-coherence.test.tsx` | Did not exist. | Added structural T-01..T-06 source test at the spec path. |
| `app-mobile/scripts/ci/orch-0943-regression-check.mjs` | Did not exist. | Added runnable T-01..T-06 regression check. |
| `app-mobile/scripts/ci/orch-0943-adversarial-check.mjs` | Did not exist. | Added runnable T-A01..T-A10 adversarial check. |
| `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` | Did not exist. | Added gate scanning `app-mobile/src` call sites for unsafe partial coord writes. |
| `.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs` | Did not exist. | Added self-test fixtures: full payload pass, guarded partial pass, unguarded partial fail, custom_location-only pass, live code pass. |
| `.github/workflows/strict-grep-mingla-business.yml` | No ORCH-0943 job. | Added registry comment and ORCH-0943 job with self-test plus live-code gate. Existing ORCH-0939/0931 jobs were not modified. |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | No ORCH-0943 custom-coords invariant. | Added `I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE` block verbatim from spec. |

## Success Criteria Map

| SC | Result | Evidence |
| --- | --- | --- |
| SC-01 | PASS | `RecommendationsContext.tsx:1444-1445` reads `boardSessionResult.preferences?.use_gps_location` and returns unless true. |
| SC-02 | PASS | `RecommendationsContext.tsx:1462` dependency array includes `boardSessionResult.preferences?.use_gps_location`. |
| SC-03 | PASS | `PreferencesSheet.tsx:819` calls `geocodingService.autocomplete(searchLocation)` inside `handleApplyPreferences`. |
| SC-04 | PASS | `PreferencesSheet.tsx:692` and `:716` use `useGpsLocation || searchLocation.trim().length > 0`. |
| SC-05 | PASS | `PreferencesSheet.tsx:840-843` resets saving state, shows required toast, and returns before any save. |
| SC-06 | PASS | `PreferencesSheet.tsx:884-885` solo payload and `:908-909` collab locals read `effectiveSelectedCoords`, not stale `selectedCoords`. T-02 passed. |
| SC-07 | PASS | `useSessionManagement.ts:405-426` classified FULL payload; no edit required. |
| SC-08 | PASS | `INVARIANT_REGISTRY.md:3760` contains new invariant. |
| SC-09 | PASS | `node .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` exit 0. |
| SC-10 | PASS | `node --test .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs` exit 0. |
| SC-11 | PASS | Workflow contains ORCH-0943 job and both run lines at `strict-grep-mingla-business.yml:1312-1323`. |
| SC-12 | PASS | Audit SQL and backfill SQL included verbatim in this report. No write SQL executed. |
| SC-13 | PARTIAL PASS | 121/122 workflow strict-grep commands passed. The remaining parser `i-proposed-x-web-deprecation.mjs /tmp/expo-export-web.stderr` failed only because the required Expo stderr file was absent; rerun against an empty temp stderr file exited 0. |
| SC-14 | PARTIAL | Spec literal scoped tsc command exited 2 due app-mobile compiler/config baseline noise (`--jsx` absent, DOM/RN global conflicts, JSON module errors). Adjusted file-scoped command also exited 2 on pre-existing dependency errors in `src/components/Toast.tsx` and `src/services/deckService.ts`; no ORCH-0943 edited-file type error was surfaced. |
| SC-15 | PASS | Added ORCH-0943 regression and adversarial scripts plus the spec-path `.tsx` structural test. |
| SC-16 | PASS | `git diff --name-only -- supabase/ mingla-business/ mingla-admin/ packages/` returned empty. Pre-existing untracked files in those dirs were not touched. |
| SC-17 | PASS | No memory files touched. |
| SC-18 | PENDING TESTER | Requires iPro Max sim live flow and read-only SQL. |
| SC-19 | PENDING TESTER | Requires live free-text Apply flow with Metro log or toast screenshot. |
| SC-20 | PENDING OPERATOR/TESTER | Requires operator audit/backfill execution and post-backfill SQL result. |

## Test Results

| Command | Exit | Result |
| --- | ---: | --- |
| `node app-mobile/scripts/ci/orch-0943-regression-check.mjs` | 0 | PASS T-01..T-06 |
| `node app-mobile/scripts/ci/orch-0943-adversarial-check.mjs` | 0 | PASS T-A01..T-A10 |
| `node --test .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs` | 0 | PASS 5/5 |
| `node .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs` | 0 | PASS live codebase |
| `git diff --check` | 0 | PASS |
| `npx tsc --noEmit src/contexts/RecommendationsContext.tsx src/components/PreferencesSheet.tsx src/hooks/useSessionManagement.ts` from `app-mobile/` | 2 | BLOCKED by baseline compiler/config errors, including `--jsx` absent and RN/DOM type conflicts. |
| `npx tsc --noEmit --jsx react-jsx --esModuleInterop --allowSyntheticDefaultImports --target es2015 --moduleResolution bundler --module esnext --resolveJsonModule --skipLibCheck src/contexts/RecommendationsContext.tsx src/components/PreferencesSheet.tsx src/hooks/useSessionManagement.ts` from `app-mobile/` | 2 | BLOCKED by pre-existing dependency errors in `src/components/Toast.tsx` and `src/services/deckService.ts`. |
| Workflow strict-grep command sweep from `.github/workflows/strict-grep-mingla-business.yml` | 1 | 121/122 PASS; only `i-proposed-x-web-deprecation.mjs /tmp/expo-export-web.stderr` failed with missing required input file. |
| `tmpfile=$(mktemp /tmp/orch0943-expo-export-web.stderr.XXXXXX); node .github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs "$tmpfile"; code=$?; rm -f "$tmpfile"; exit $code` | 0 | Parser gate PASS when provided a stderr artifact. |

## Fails-On-Revert Evidence

Base commit cited for revert baseline: `d600f05671a4f32bc4904f2e38afc7dfb0c5b294`.

| Revert | Method | Command | Exit | Expected failure |
| --- | --- | --- | ---: | --- |
| Fix A R3.8 guard | Temporarily applied reverse patch from `/tmp/orch0943-fixA.patch`, ran regression, restored patch. | `git apply -R /tmp/orch0943-fixA.patch && node app-mobile/scripts/ci/orch-0943-regression-check.mjs; ... git apply /tmp/orch0943-fixA.patch` | 1 | T-05 failed because R3.8 no longer read/guarded `use_gps_location`; T-06 also failed because the source block anchor was removed with the Fix A comment. Restore exit 0. |
| Fix B1 auto-resolve | Temporarily applied reverse patch from `/tmp/orch0943-fixB1.patch`, ran regression, restored patch. | `git apply -R /tmp/orch0943-fixB1.patch && node app-mobile/scripts/ci/orch-0943-regression-check.mjs; ... git apply /tmp/orch0943-fixB1.patch` | 1 | T-01, T-02, T-03, and T-04 failed. Restore exit 0. |

## Fix C Audit SQL

```sql
-- ORCH-0943 Fix C audit: detect all corrupted participant prefs across all sessions
WITH session_prefs AS (
  SELECT
    cs.id AS session_id,
    cs.name AS session_name,
    user_key AS user_id_text,
    cs.participant_prefs -> user_key ->> 'custom_location' AS s_text,
    NULLIF(cs.participant_prefs -> user_key ->> 'custom_lat', '')::float8 AS s_lat,
    NULLIF(cs.participant_prefs -> user_key ->> 'custom_lng', '')::float8 AS s_lng,
    (cs.participant_prefs -> user_key ->> 'use_gps_location')::boolean AS s_use_gps
  FROM collaboration_sessions cs,
       jsonb_object_keys(cs.participant_prefs) AS user_key
  WHERE cs.participant_prefs IS NOT NULL
),
joined AS (
  SELECT
    sp.*,
    p.custom_location AS solo_text,
    p.custom_lat AS solo_lat,
    p.custom_lng AS solo_lng,
    p.use_gps_location AS solo_use_gps
  FROM session_prefs sp
  LEFT JOIN preferences p ON p.profile_id = sp.user_id_text::uuid
)
SELECT
  session_id,
  session_name,
  user_id_text,
  s_use_gps,
  s_text       AS session_text,
  s_lat        AS session_lat,
  s_lng        AS session_lng,
  solo_text,
  solo_lat,
  solo_lng,
  solo_use_gps,
  CASE
    WHEN s_use_gps IS NOT TRUE
     AND s_text IS NOT NULL AND TRIM(s_text) <> ''
     AND solo_text IS NOT NULL AND TRIM(solo_text) <> ''
     AND s_text <> solo_text
    THEN 'TEXT_DRIFTED_FROM_SOLO'
    WHEN s_use_gps IS NOT TRUE
     AND s_lat IS NOT NULL AND s_lng IS NOT NULL
     AND solo_lat IS NOT NULL AND solo_lng IS NOT NULL
     AND (ABS(s_lat - solo_lat) > 0.0001 OR ABS(s_lng - solo_lng) > 0.0001)
    THEN 'COORDS_DRIFTED_FROM_SOLO'
    WHEN s_use_gps IS NOT TRUE
     AND s_text IS NOT NULL AND TRIM(s_text) <> ''
     AND (s_lat IS NULL OR s_lng IS NULL)
    THEN 'TEXT_WITHOUT_COORDS'
    ELSE 'OK'
  END AS corruption_class
FROM joined
WHERE
  s_use_gps IS NOT TRUE
  AND (
    (s_text IS NOT NULL AND TRIM(s_text) <> '' AND solo_text IS NOT NULL AND s_text <> solo_text)
    OR (s_lat IS NOT NULL AND s_lng IS NOT NULL AND solo_lat IS NOT NULL AND solo_lng IS NOT NULL AND (ABS(s_lat - solo_lat) > 0.0001 OR ABS(s_lng - solo_lng) > 0.0001))
    OR (s_text IS NOT NULL AND TRIM(s_text) <> '' AND (s_lat IS NULL OR s_lng IS NULL))
  )
ORDER BY corruption_class, session_id;
```

## Fix C Backfill SQL

```sql
-- ORCH-0943 Fix C backfill: restore session participant_prefs to solo baseline
-- for non-GPS-mode rows where solo is coherent. Run AFTER reviewing the audit
-- output above and confirming each session_id + user_id pair should be restored.
-- Operator may exclude rows from this UPDATE by adding WHERE clauses.
UPDATE collaboration_sessions cs
SET participant_prefs = jsonb_set(
  jsonb_set(
    jsonb_set(
      cs.participant_prefs,
      ARRAY[sp.user_id_text, 'custom_location'],
      to_jsonb(sp.solo_text),
      true
    ),
    ARRAY[sp.user_id_text, 'custom_lat'],
    to_jsonb(sp.solo_lat),
    true
  ),
  ARRAY[sp.user_id_text, 'custom_lng'],
  to_jsonb(sp.solo_lng),
  true
)
FROM (
  SELECT
    cs2.id AS session_id,
    user_key AS user_id_text,
    p.custom_location AS solo_text,
    p.custom_lat AS solo_lat,
    p.custom_lng AS solo_lng,
    (cs2.participant_prefs -> user_key ->> 'use_gps_location')::boolean AS s_use_gps
  FROM collaboration_sessions cs2,
       jsonb_object_keys(cs2.participant_prefs) AS user_key
  LEFT JOIN preferences p ON p.profile_id = user_key::uuid
  WHERE cs2.participant_prefs IS NOT NULL
    AND p.custom_location IS NOT NULL
    AND p.custom_lat IS NOT NULL
    AND p.custom_lng IS NOT NULL
    AND (cs2.participant_prefs -> user_key ->> 'use_gps_location')::boolean IS NOT TRUE
    AND (
      (cs2.participant_prefs -> user_key ->> 'custom_location') <> p.custom_location
      OR (cs2.participant_prefs -> user_key ->> 'custom_lat')::float8 <> p.custom_lat
      OR (cs2.participant_prefs -> user_key ->> 'custom_lng')::float8 <> p.custom_lng
    )
) sp
WHERE cs.id = sp.session_id;
```

## Out Of Scope Declaration

No edits were made to `useBoardSession.ts:updatePreferences`, `OnboardingFlow.tsx:1578`, `supabase/`, `mingla-business/`, `mingla-admin/`, `packages/`, memory files, or existing ORCH-0929/0939/0931/0942 strict-grep gate scripts. No `supabase db push`, EAS OTA, PR, merge, or push was performed.

`git status --short` after implementation showed the ORCH-0943 tracked edits and new files plus many pre-existing untracked operator artifacts. New ORCH-0943 files are:

```text
 M .github/workflows/strict-grep-mingla-business.yml
 M Mingla_Artifacts/INVARIANT_REGISTRY.md
 M app-mobile/src/components/PreferencesSheet.tsx
 M app-mobile/src/contexts/RecommendationsContext.tsx
?? .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs
?? .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs
?? app-mobile/scripts/ci/orch-0943-adversarial-check.mjs
?? app-mobile/scripts/ci/orch-0943-regression-check.mjs
?? app-mobile/src/components/__tests__/orch-0943-prefs-apply-coord-coherence.test.tsx
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md
```

Pre-existing untracked artifacts included the investigation/spec inputs and ORCH-0931/0918 evidence/spec duplicates; they were not modified by this implementation.

## Downstream

Route to orchestrator REVIEW, then tester live verification on iPro Max sim, Pixel emulator, and operator physical iPhone. Operator owns the read-only audit SQL, gated backfill write SQL, and post-backfill zero-corruption confirmation.
