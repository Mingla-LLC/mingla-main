# IMPLEMENTATION — ORCH-1021 [Curated stop timezone false-open]

## Status

implemented and verified

## User Impact

Scheduling a curated plan can no longer say it is safe when a stop is closed or when a stop's hours cannot be parsed. The concrete regression Seth hit, Nasher Museum of Art at Duke University -> Parizade, is now covered by an automated test: Nasher-style `Saturday: 10:00 – 5:00 PM` hours are parsed and reported closed after 5 PM.

## Root Cause

ORCH-1019 moved curated scheduling to the canonical `extractWeekdayText` + `isPlaceOpenAt` path, but `isPlaceOpenAt` still required both sides of a time range to include AM/PM. Google commonly emits ranges such as `10:00 – 5:00 PM` and `5:00 – 10:00 PM`. Those returned `null`, and `checkAllCuratedStopsOpen` treated `null` as open-enough, so a closed or unparseable stop could still produce an "All Stops Are Open" verdict.

## Changes

- `app-mobile/src/utils/openingHoursUtils.ts`
  - Added range-local meridiem inference for omitted first endpoints.
  - `10:00 – 5:00 PM` now parses as 10 AM to 5 PM.
  - `5:00 – 10:00 PM` now parses as 5 PM to 10 PM.

- `app-mobile/src/utils/curatedStopsAvailability.ts`
  - Changed curated-stop verdict semantics so `null` is `unknown`, not open.
  - `allOpen` is now true only when every stop is proven open.
  - Closed reasons now say `Closed at <time>` instead of `May be closed`.
  - Unknown reasons now say `Hours unavailable at <time>` and block safe scheduling.

- `app-mobile/src/components/activity/SavedTab.tsx`
  - Replaced `All Stops Are Open!` with `Safe to Schedule`.
  - Replaced `Some Stops Are Closed` with `Not Safe to Schedule`.
  - The unsafe path covers both closed and unknown stops.

- `app-mobile/src/components/activity/CalendarTab.tsx`
  - Reschedule uses the same `Not Safe to Schedule` language and blocks on closed or unknown curated stops.

- `supabase/functions/generate-curated-experiences/index.ts`
  - Emits `utcOffsetMinutes: card.utc_offset_minutes ?? null` on every curated stop so newly generated cards can evaluate hours in the venue timezone.

## Tests

Passed:

```bash
deno test --no-check --sloppy-imports --allow-read app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.adversarial.test.ts
```

Result: 8 passed, 0 failed.

Passed:

```bash
cd supabase && deno test --allow-read functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts
```

Result: 2 passed, 0 failed.

Passed:

```bash
deno check --no-lock supabase/functions/generate-curated-experiences/index.ts
```

Passed:

```bash
node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs --self-test
node .github/scripts/strict-grep/i-curated-hours-via-canonical-reader.mjs
```

Result: self-test passed; scanned 422 files with 0 direct openingHours day-key lookups.

Passed:

```bash
git diff --check
```

## Deploy Notes

No DB migration. The mobile behavior waits for the next app build or authorized mobile release path. The generator timezone passthrough requires `generate-curated-experiences` edge function redeploy after PR merge so newly generated curated cards carry `utcOffsetMinutes`.

## Tester Focus

1. On iOS and Android, schedule Nasher Museum of Art at Duke University -> Parizade for a time after Nasher closes; the app must show `Not Safe to Schedule` and name Nasher with `Closed at <time>`.
2. Schedule the same plan for a time where both stops are open; the app may show `Safe to Schedule`.
3. Use a curated stop fixture with missing/unparseable hours; the app must not say safe, and must show `Hours unavailable at <time>`.
4. Confirm regular single-place scheduling still preserves the existing advisory behavior.
