# Implementation Rework Report: ORCH-1021 Decisive Curated + Single-Card Scheduling

Date: 2026-05-30  
Status: implemented and verified  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1021-[curated-stop-timezone-false-open]`  
Branch: `ORCH-1021-curated-stop-timezone-false-open`

## 1. Outcome

Mingla now treats scheduling-time availability as a hard decision for both curated cards and single cards:

- `open` means safe to schedule.
- `closed` means not safe; the user must choose another time.
- `unknown` means not safe; the flow does not schedule from unverified hours.

The prior false-open parser bug for noon-close ranges is fixed: `9:00 - 12:00 PM` and `11:00 - 12:00 PM` now infer AM open time and close at noon, while the previously fixed `10:00 - 5:00 PM`, `5:00 - 10:00 PM`, `12:00 - 5:00 PM`, and overnight `9:00 - 1:00 AM` cases remain covered.

## 2. Changed Runtime Behavior

| Surface | Old behavior | New behavior |
|---|---|---|
| SavedTab regular cards | Closed card showed "appears" copy and offered `Schedule Anyway`; unknown hours silently scheduled. | Closed and unknown both show `Not Safe to Schedule` and block scheduling. |
| ProposeDateTimeModal regular cards | Unknown hours set `isPlaceOpen=true`, enabling the footer schedule button. | Unknown hours set `isPlaceOpen=false`, show definitive copy, and keep the schedule button unavailable. |
| Expanded-card ActionButtons regular cards | Unknown hours showed an advisory and offered `schedule_anyway`; closed copy used the older generic close path. | Closed and unknown both block with a shared decisive message. |
| Expanded-card ActionButtons curated cards | Used an inline weaker stop validator, ignored unknown stops, said `may be closed`, and offered `Schedule Anyway`. | Routes through `checkAllCuratedStopsOpen`; any closed or unknown stop blocks scheduling and names the unavailable stops. |
| Single-card timezone offsets | `discover-cards` did not carry `place_pool.utc_offset_minutes` into single-card payloads. | Single-card payloads include `utcOffsetMinutes`; mobile scheduling helpers pass camel/snake offsets into `isPlaceOpenAt`. |

## 3. Files Changed

- `app-mobile/src/utils/openingHoursUtils.ts`
- `app-mobile/src/utils/singleCardAvailability.ts`
- `app-mobile/src/utils/__tests__/openingHoursUtils.test.ts`
- `app-mobile/src/utils/__tests__/singleCardAvailability.test.ts`
- `app-mobile/src/utils/__tests__/schedulingSourceContract.test.ts`
- `app-mobile/src/components/activity/SavedTab.tsx`
- `app-mobile/src/components/activity/ProposeDateTimeModal.tsx`
- `app-mobile/src/components/expandedCard/ActionButtons.tsx`
- `app-mobile/src/hooks/useIsPlaceOpen.ts`
- `app-mobile/src/types/curatedExperience.ts`
- `app-mobile/src/types/expandedCardTypes.ts`
- `app-mobile/src/types/recommendation.ts`
- `supabase/functions/discover-cards/index.ts`

## 4. Regression Tests Added

| Test | Contract proved |
|---|---|
| `openingHoursUtils.test.ts` | Noon-close shorthand is not treated as overnight; existing omitted-meridiem and overnight behaviors remain correct. |
| `singleCardAvailability.test.ts` | Single-card helper returns `open`, `closed`, and `unknown` correctly; unknown/closed are not safe; timezone offsets affect venue-local evaluation. |
| `schedulingSourceContract.test.ts` | SavedTab, ProposeDateTimeModal, and ActionButtons no longer expose `Schedule Anyway`, `schedule_anyway`, `may be closed`, or `appears to be closed` in scheduling paths; single-card paths use the shared helper. |

## 5. Verification

| Command | Result |
|---|---|
| `deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/openingHoursUtils.test.ts app-mobile/src/utils/__tests__/singleCardAvailability.test.ts app-mobile/src/utils/__tests__/schedulingSourceContract.test.ts` | PASS: 13 passed, 0 failed. |
| `deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.adversarial.test.ts` | PASS: 8 passed, 0 failed. |
| `cd supabase && deno test --allow-read functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts` | PASS: 2 passed, 0 failed. |
| `deno check --no-lock supabase/functions/generate-curated-experiences/index.ts` | PASS: exit 0. |
| `deno check --no-lock supabase/functions/discover-cards/index.ts` | PASS: exit 0. |
| `node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs --self-test` | PASS. |
| `node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs` | PASS: scanned 423 files; no direct openingHours day-key lookup found. |
| `git diff --check` | PASS. |
| `cd app-mobile && npx tsc --noEmit --pretty false` | FAIL due existing repo-wide issues outside this scope, including Deno test globals and shared package React type resolution. Follow-up grep showed no remaining TypeScript errors in the ORCH-1021 touched files. |

## 6. Deployment Notes

No migration was added.

After this branch merges to `main`, redeploy `discover-cards` so single-card deck payloads include `utcOffsetMinutes`. Preserve the prior ORCH-1021 curated deploy note: `generate-curated-experiences` must also be deployed from merged `main` if its `utcOffsetMinutes` passthrough is not already live.

## 7. Residual Risk

The scheduling decision now fails closed when hours are missing or unparseable. That is intentionally stricter than the old behavior and may block some real venues whose Google hours are incomplete, but it matches Seth's requested safety contract: Mingla should not say scheduling is safe unless it can prove the stop or place is open.
