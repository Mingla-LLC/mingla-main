# IMPLEMENTATION ORCH-0754 — Business Home Upcoming Stub Data

Status: implemented, partially verified
Date: 2026-05-08
Owner: `$implementor`

## Summary

Business Home no longer renders fabricated upcoming event rows or hardcoded live-event metrics. The Home tab now derives its first-screen event story from the current brand's local `liveEventStore`, `draftEventStore`, and `orderStore` data.

The focused ORCH-0754 regression test and strict-grep gate pass. Full `npm run lint` is still red because the repo already has unrelated lint errors outside the approved ORCH-0754 scope; Home has no reported lint errors after this implementation.

## Files Changed

- `mingla-business/src/utils/brandEventSummary.ts`
- `mingla-business/src/utils/__tests__/brandEventSummary.test.ts`
- `mingla-business/app/(tabs)/home.tsx`
- `.github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs`
- `.github/scripts/strict-grep/README.md`
- `.github/workflows/strict-grep-mingla-business.yml`
- `mingla-business/package.json`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md`

No optional `events.tsx` rewiring was done; the helper is ready for future cleanup without changing Events tab behavior in this scope.

## Spec Traceability

| Requirement | Result |
|---|---|
| Add pure `buildBrandEventSummary(liveEvents, drafts)` helper | Implemented in `brandEventSummary.ts` |
| Cover draft-only, upcoming-only, live-window, past/cancelled exclusion, mixed ordering | Implemented in `brandEventSummary.test.ts`, 5 tests passing |
| Home imports `useLiveEventsForBrand`, helper, `formatDraftDateLine` | Implemented |
| Home stops using persisted brand current-live snapshot for event truth | Implemented |
| Home stops using brand stats for Active events KPI | Implemented |
| Home stops calculating tickets sold from revenue | Implemented; sold count comes from `orderStore.getSoldCountForEvent` |
| Remove hardcoded time, capacity, scanned count, fake rows | Implemented; unavailable scanned metric renders `—` |
| Upcoming renders `eventSummary.activeItems` with honest empty state | Implemented |
| Live hero uses primary live summary item and real order/capacity data | Implemented |
| Add `test:orch-0754` script | Implemented |
| Register I-PROPOSED-Z strict-grep script/workflow/README | Implemented |

## Fake Signatures Removed

Removed from `mingla-business/app/(tabs)/home.tsx`:

- `STUB_UPCOMING_ROWS`
- `StubUpcomingRow`
- `Sunday Languor Brunch`
- `The Long Lunch (Series)`
- `1 live · 2 upcoming`
- `Tonight · 21:00`
- `Math.round(liveEvent.soldGbp / 30)`
- `/ 400`
- `currentBrand?.currentLiveEvent`

## Helper Details

`buildBrandEventSummary`:

- Maps live events through shared `deriveLiveStatus`.
- Collapses `cancelled` into `past` for this four-bucket Home/Event-list summary.
- Counts `all`, `active`, `live`, `upcoming`, `draft`, and `past`.
- Builds `activeItems` as live/upcoming/draft only.
- Builds `allItems` with past entries included.
- Sorts live first, upcoming by date ascending, past by date descending, drafts by `updatedAt` descending.

## Verification

Local shell note: `node`, `npm`, and `npx` are installed at `/opt/homebrew/bin`, so local verification was run with `PATH=/opt/homebrew/bin:$PATH`. The committed package/workflow commands use normal `node`/`npm` names.

### `cd mingla-business && npm run lint`

Result: FAIL, unrelated existing repo lint debt.

Exact command run locally:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npm run lint
```

Key exact output:

```text
> mingla-business@1.0.0 lint
> expo lint

env: load .env
env: export EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY

/Users/sethogieva/Desktop/mingla-main/mingla-business/app/__styleguide.tsx
  164:18   error    React Hook "useSafeAreaInsets" is called conditionally. React Hooks must be called in the exact same order in every component render  react-hooks/rules-of-hooks
  165:18   error    React Hook "useRouter" is called conditionally. React Hooks must be called in the exact same order in every component render          react-hooks/rules-of-hooks

/Users/sethogieva/Desktop/mingla-main/mingla-business/app/event/[id]/index.tsx
  312:22  error    React Hook "useOrderStore" is called conditionally. React Hooks must be called in the exact same order in every component render. Did you accidentally call a React Hook after an early return?         react-hooks/rules-of-hooks

✖ 188 problems (80 errors, 108 warnings)
  0 errors and 56 warnings potentially fixable with the `--fix` option.
```

Home file status in lint output: no `home.tsx` errors or warnings after the final implementation pass.

### `cd mingla-business && npm run test:orch-0754`

Result: PASS.

Exact command run locally:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npm run test:orch-0754
```

Exact output:

```text
> mingla-business@1.0.0 test:orch-0754
> node ../.github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs && npx jest brandEventSummary.test

I-PROPOSED-Z PASS: Home contains no fabricated upcoming-event signatures.
PASS src/utils/__tests__/brandEventSummary.test.ts
  buildBrandEventSummary
    ✓ draft-only summaries keep drafts active and order by updated time (6 ms)
    ✓ upcoming live events are active and order by event date ascending
    ✓ live-window events become the primary live item
    ✓ past and cancelled live events stay out of active items
    ✓ mixed summaries order live, upcoming, then drafts

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        1.654 s
Ran all test suites matching /brandEventSummary.test/i.
```

Watchman also emitted a recrawl warning before Jest output; it did not fail the test.

### `cd mingla-business && npx jest brandEventSummary.test`

Result: PASS.

Exact command run locally:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npx jest brandEventSummary.test
```

Exact output:

```text
PASS src/utils/__tests__/brandEventSummary.test.ts
  buildBrandEventSummary
    ✓ draft-only summaries keep drafts active and order by updated time (7 ms)
    ✓ upcoming live events are active and order by event date ascending (1 ms)
    ✓ live-window events become the primary live item
    ✓ past and cancelled live events stay out of active items
    ✓ mixed summaries order live, upcoming, then drafts

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        0.769 s, estimated 2 s
Ran all test suites matching /brandEventSummary.test/i.
```

Watchman also emitted a recrawl warning before Jest output; it did not fail the test.

### `node .github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs`

Result: PASS.

Exact command run locally:

```bash
PATH=/opt/homebrew/bin:$PATH node .github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs
```

Exact output:

```text
I-PROPOSED-Z PASS: Home contains no fabricated upcoming-event signatures.
```

### Direct grep proof

Command:

```bash
rg -n "STUB_UPCOMING_ROWS|StubUpcomingRow|Sunday Languor Brunch|The Long Lunch \(Series\)|1 live · 2 upcoming|Tonight · 21:00|Math\.round\(liveEvent\.soldGbp / 30\)|currentBrand\?\.currentLiveEvent" "mingla-business/app/(tabs)/home.tsx"
```

Result: PASS. Exit code `1`, no output, meaning no matches.

### Extra typecheck

Command:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit
```

Result: PASS. Exit code `0`, no output.

## Scope Guard

Confirmed no intentional changes to:

- Supabase migrations, RLS, edge functions, RPCs, or server event reads.
- Brand Profile fake recent events.
- Finance Reports brand-level event stubs.
- Public brand page.
- Mobile app.
- Admin app.
- Stripe, scanner, checkout, orders creation, finance, or backend status adapters.
- Persisted Brand snapshot architecture.

`git status` shows unrelated existing mobile/Supabase/artifact changes in the worktree; those were not touched for ORCH-0754.

## Deviations / Follow-up

- Full lint cannot pass until existing unrelated lint errors are fixed.
- `scanned` remains unavailable on Home and now renders `—` instead of fabricated `0`, per spec.
- Events tab still has its own inline categorization helper; the new pure helper can be reused later if orchestrator approves that cleanup.

## Next Lifecycle

Dispatch `$tester` for independent ORCH-0754 QA/retest.
