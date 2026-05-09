# IMPLEMENTATION REWORK ORCH-0754 — Business Home Upcoming Spec Alignment

Status: implemented, partially verified
Date: 2026-05-08
Owner: `$implementor`

## Summary

Reworked the ORCH-0754 Home implementation to resolve the four orchestrator review blockers before tester dispatch. The core fake-data removal from the first implementation remains intact; this pass aligns exact Home copy and display contracts with the approved spec.

Full repo lint still fails from unrelated existing lint debt outside `home.tsx`. Focused ORCH-0754 gates, strict fake-signature guard, Jest helper tests, and TypeScript all pass.

## Files Changed

- `mingla-business/app/(tabs)/home.tsx`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0754_BUSINESS_HOME_UPCOMING_SPEC_ALIGNMENT.md`

No helper/test changes were required; `buildBrandEventSummary` behavior was already covered and still passes.

## R1-R4 Traceability

| Finding | Required rework | Result |
|---|---|---|
| R1 Upcoming empty-state copy | Use `No upcoming events` and `Build an event to see it here.` | Implemented in the Upcoming empty card |
| R2 Live hero date line | Render `formatDraftDateLine(primaryLiveEvent)` in the hero | Implemented as `heroEventDate` below the event title |
| R3 Unlimited capacity label | All-unlimited events show `Unlimited`; missing capacity still shows `—` | Implemented via `hasUnlimitedTickets` + `formatCapacityLabel` |
| R4 KPI zero buckets | Active KPI subcopy always includes live/upcoming/draft buckets when active > 0 | Implemented: `0 live · 0 upcoming · 1 draft` style output |

## Verification

Local shell note: this shell does not expose `node`, `npm`, or `npx` by default. Commands were run locally with `PATH=/opt/homebrew/bin:$PATH`; package scripts and CI commands were not changed.

### `cd mingla-business && npm run test:orch-0754`

Command:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npm run test:orch-0754
```

Result: PASS.

Output:

```text
> mingla-business@1.0.0 test:orch-0754
> node ../.github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs && npx jest brandEventSummary.test

I-PROPOSED-Z PASS: Home contains no fabricated upcoming-event signatures.
PASS src/utils/__tests__/brandEventSummary.test.ts
  buildBrandEventSummary
    ✓ draft-only summaries keep drafts active and order by updated time (6 ms)
    ✓ upcoming live events are active and order by event date ascending (1 ms)
    ✓ live-window events become the primary live item
    ✓ past and cancelled live events stay out of active items
    ✓ mixed summaries order live, upcoming, then drafts

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
Time:        1.063 s
Ran all test suites matching /brandEventSummary.test/i.
```

Watchman emitted a recrawl warning before Jest output; it did not fail the test.

### `cd mingla-business && npx jest brandEventSummary.test`

Command:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npx jest brandEventSummary.test
```

Result: PASS.

Output:

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
Time:        0.773 s, estimated 1 s
Ran all test suites matching /brandEventSummary.test/i.
```

Watchman emitted a recrawl warning before Jest output; it did not fail the test.

### `node .github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs`

Command:

```bash
PATH=/opt/homebrew/bin:$PATH node .github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs
```

Result: PASS.

Output:

```text
I-PROPOSED-Z PASS: Home contains no fabricated upcoming-event signatures.
```

### `cd mingla-business && npx tsc --noEmit`

Command:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npx tsc --noEmit
```

Result: PASS. Exit code `0`, no output.

### `cd mingla-business && npm run lint`

Command:

```bash
cd mingla-business && PATH=/opt/homebrew/bin:$PATH npm run lint
```

Result: FAIL, unrelated existing repo-wide lint debt. `home.tsx` does not appear in the lint findings.

Key output:

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

### Direct Fake-Signature Grep

Command:

```bash
rg -n "STUB_UPCOMING_ROWS|StubUpcomingRow|Sunday Languor Brunch|The Long Lunch \(Series\)|1 live · 2 upcoming|Tonight · 21:00|Math\.round\(liveEvent\.soldGbp / 30\)|/ 400|currentBrand\?\.currentLiveEvent" "mingla-business/app/(tabs)/home.tsx"
```

Result: PASS. Exit code `1`, no output, meaning no matches.

## Scope Guard

No changes were made to:

- Supabase migrations, RLS, edge functions, RPCs, or server reads.
- Brand Profile fake recent events.
- Finance Reports event stubs.
- Events tab.
- Public brand page.
- Mobile app.
- Admin app.
- Stripe, scanner, checkout, orders creation, finance, or backend adapters.

## Next Lifecycle

Return to `$orchestrator` for review. If accepted, dispatch `$tester` for independent ORCH-0754 QA.
