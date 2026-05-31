# IMPLEMENTOR REWORK PROMPT - ORCH-1021 Decisive Curated + Single-Card Scheduling

You are Codex `implementor-mingla` working in:

`/Users/sethogieva/Desktop/mingla-orchs/ORCH-1021-[curated-stop-timezone-false-open]`

Branch:

`ORCH-1021-curated-stop-timezone-false-open`

## Goal

Make scheduling decisive and reliable for both curated cards and single cards. Mingla must not tell Seth or a user that a plan/card is safe when the venue is closed or when hours cannot be confirmed. No "maybe", no "appears", no silent unknown-hours scheduling, and no "schedule anyway" path for a time Mingla cannot prove is open.

## Inputs to read first

1. `Mingla_Artifacts/reports/QA_ORCH-1021_CURATED_STOP_TIMEZONE_FALSE_OPEN.md`
2. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1021_CURATED_STOP_TIMEZONE_FALSE_OPEN.md`
3. `app-mobile/src/utils/openingHoursUtils.ts`
4. `app-mobile/src/utils/curatedStopsAvailability.ts`
5. `app-mobile/src/components/activity/SavedTab.tsx`
6. `app-mobile/src/components/activity/ProposeDateTimeModal.tsx`
7. `app-mobile/src/components/activity/ProposeDateTimeFooter.tsx`
8. `app-mobile/src/components/expandedCard/ActionButtons.tsx`
9. `supabase/functions/discover-cards/index.ts`
10. `supabase/functions/generate-curated-experiences/index.ts`

## Proven current behavior

- ORCH-1021 fixed Seth's concrete Nasher Museum of Art -> Parizade repro for `10:00 - 5:00 PM` and `5:00 - 10:00 PM`.
- Tester found a remaining P1 parser bug: `Saturday: 9:00 - 12:00 PM` is treated as open overnight before 9 AM and late at night.
- Single-card scheduling uses the same shared hours reader:
  - `SavedTab.tsx` regular-card branch calls `isPlaceOpenAt(...)`.
  - `ProposeDateTimeModal.tsx` regular-card availability calls `isPlaceOpenAt(...)`.
  - `ActionButtons.tsx` single-card scheduling calls `isPlaceOpenAt(...)`.
- Single-card UX is not yet decisive:
  - `SavedTab.tsx` lets a closed single card use `"Schedule Anyway"` and silently proceeds when `isPlaceOpenAt` returns `null`.
  - `ProposeDateTimeModal.tsx` treats unknown hours as `isPlaceOpen=true`, so the footer enables scheduling after an advisory.
  - `ActionButtons.tsx` treats unknown hours as an assumption and offers `"Schedule Anyway"`.
  - `ActionButtons.tsx` still has a curated inline stop-check path with `"may be closed"` and `"Schedule Anyway"`; do not leave a second curated validator with weaker semantics.
- Single-card payloads do not currently preserve `place_pool.utc_offset_minutes` through `discover-cards` into mobile scheduling, even though venue-local checking depends on `utcOffsetMinutes` when available.

## Required product contract

Use this contract for scheduling-time availability, not for passive "open now" badges:

| Status | Meaning | User-facing result |
|---|---|---|
| `open` | The venue is proven open at the selected scheduled time in the venue timezone when known, otherwise the existing documented device-local fallback. | Safe to schedule. |
| `closed` | The venue is proven closed at the selected scheduled time. | Not safe to schedule; user must choose a different time. |
| `unknown` | Hours are missing, unparseable, or insufficient for the selected time. | Not safe to schedule; user must choose a different time or verify outside Mingla. Do not schedule from this flow. |

Copy direction:

- Safe state title: `Safe to Schedule`.
- Unsafe state title: `Not Safe to Schedule`.
- Single-card closed body should be direct, e.g. `This place is closed at <time>. Please choose a different time.`
- Single-card unknown body should be direct, e.g. `Mingla could not confirm this place is open at <time>. Please choose a different time.`
- Curated unsafe body should keep naming the blocked stops and should distinguish `Closed at <time>` from `Hours unavailable at <time>`.
- Do not use "maybe", "may be closed", "appears to be closed", or "Schedule Anyway" in scheduling-time closed/unknown paths.
- Keep passive open/closed badges separate; this rework is about scheduling decisions.

## Required implementation

1. Fix `openingHoursUtils.ts` meridiem inference.
   - `9:00 - 12:00 PM` and `11:00 - 12:00 PM` must infer AM open time and close at noon.
   - Preserve already-fixed behavior for `10:00 - 5:00 PM`, `5:00 - 10:00 PM`, `12:00 - 5:00 PM`, and overnight AM-close ranges such as `9:00 - 1:00 AM`.

2. Add or extend a pure shared helper for single-card scheduling availability.
   - It must return `open | closed | unknown`, `isSafeToSchedule`, and a deterministic reason string for closed/unknown.
   - It must be Deno-testable with no React Native dependency.
   - It must accept both camel and snake case timezone offsets (`utcOffsetMinutes`, `utc_offset_minutes`) if present.
   - It may live beside `curatedStopsAvailability.ts`, or `curatedStopsAvailability.ts` may be generalized cleanly if that fits the local style.

3. Update single-card scheduling paths to use the shared helper/contract.
   - `SavedTab.tsx` regular-card branch: closed and unknown must block scheduling. No silent null proceed. No "Schedule Anyway".
   - `ProposeDateTimeModal.tsx` regular-card flow: unknown must not set `isPlaceOpen=true`; the footer must not enable schedule when the status is closed or unknown. The visible message must be definitive.
   - `ActionButtons.tsx` single-card flow: closed and unknown must block scheduling. No "Schedule Anyway".

4. Remove or align the weaker curated stop-check inside `ActionButtons.tsx`.
   - There must not be two curated scheduling validators with different semantics.
   - If this path still handles curated cards, route it through `checkAllCuratedStopsOpen` or equivalent shared logic.
   - It must not emit `"may be closed"` or offer `"Schedule Anyway"` for closed/unknown stops.

5. Preserve and pass venue timezone offsets for single cards when available.
   - `discover-cards/index.ts` must select/map `utc_offset_minutes` for single-card payloads.
   - Mobile card types/adapters touched by these scheduling paths must preserve `utcOffsetMinutes` or `utc_offset_minutes`.
   - Scheduling validators must pass the offset into `isPlaceOpenAt`.
   - Do not invent a client-side longitude-based offset heuristic.

6. Keep ORCH-1021 curated timezone passthrough for generated curated cards.
   - Preserve `generate-curated-experiences` `utcOffsetMinutes` behavior and its tests.

## Required tests

All behavior fixes must include repo-running regression tests in the same commit.

Minimum tests:

1. Deno test for `openingHoursUtils.ts` proving:
   - `Saturday: 9:00 - 12:00 PM` is closed before 9 AM, open during the morning window, closed at noon, and closed late at night.
   - `Saturday: 11:00 - 12:00 PM` is open at 11:30 AM and closed after noon.
   - `Saturday: 10:00 - 5:00 PM` remains open before 5 PM and closed after 5 PM.
   - `Saturday: 5:00 - 10:00 PM` remains closed before 5 PM and open in the evening.
   - `Saturday: 12:00 - 5:00 PM` remains noon-to-5 PM.
   - An overnight AM-close range still behaves correctly.

2. Deno test for the single-card scheduling helper proving:
   - `open` -> `isSafeToSchedule=true`.
   - `closed` -> `isSafeToSchedule=false` with `Closed at <time>`.
   - missing/unparseable hours -> `unknown`, `isSafeToSchedule=false`, with `Hours unavailable at <time>` or equivalent definitive copy.
   - timezone offset is passed through and affects the evaluated venue-local day/time.

3. Source-contract or component-level test proving no scheduling-time closed/unknown path in `SavedTab.tsx`, `ProposeDateTimeModal.tsx`, or `ActionButtons.tsx` still exposes `Schedule Anyway`, `may be closed`, or `appears to be closed`.

4. Existing ORCH-1019/1021 curated tests must remain and pass:
   - `curatedStopsAvailability.test.ts`
   - `curatedStopsAvailability.adversarial.test.ts`
   - `utc_offset_passthrough.test.ts`

## Verification commands to run before returning

Run these at minimum from the ORCH worktree:

```bash
deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.adversarial.test.ts
```

Run your new Deno tests for `openingHoursUtils` and single-card scheduling.

```bash
cd supabase && deno test --allow-read functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts
```

```bash
deno check --no-lock supabase/functions/generate-curated-experiences/index.ts
```

If `discover-cards/index.ts` is touched, also run the relevant Deno check/test gate for that function if one exists; otherwise run:

```bash
deno check --no-lock supabase/functions/discover-cards/index.ts
```

```bash
node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs --self-test && node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs
```

```bash
git diff --check
```

## Output

Write the implementation report:

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1021_DECISIVE_CURATED_AND_SINGLE_SCHEDULING.md`

Commit and push the scoped implementation changes to:

`ORCH-1021-curated-stop-timezone-false-open`

Then route back to `tester-mingla` for retest. The tester must verify both curated cards and single-card scheduling paths.

/goal: ORCH-1021 rework is implemented, tested, committed, pushed, and documented with decisive scheduling behavior for curated and single cards.
