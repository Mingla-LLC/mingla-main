# TEST REPORT ORCH-0754 — Business Home Upcoming Stub Data

Date: 2026-05-08
Owner: `$tester`
Mode: TARGETED / SPEC-COMPLIANCE
Verdict: CONDITIONAL PASS

## Summary

ORCH-0754's product behavior is verified: Business Home no longer contains the fabricated upcoming rows or the hardcoded live-event metric signatures from the investigation. The Home screen now derives its first-screen event story from current-brand drafts, live/upcoming events, and order-store metrics.

The only condition is the existing repo-wide `npm run lint` failure. It is not caused by the ORCH-0754 files and does not mention `mingla-business/app/(tabs)/home.tsx`, `mingla-business/src/utils/brandEventSummary.ts`, the ORCH test, package script, or strict-grep gate. Treat this as an external lint debt blocker for broader release hygiene, not an ORCH-0754 rework blocker.

## Claim Verification

| Claim / criterion | Result | Evidence |
|---|---:|---|
| Forbidden fake Home signatures removed | PASS | Direct `rg` against `home.tsx` returned exit code `1` with no matches. Strict gate also passed. |
| Home uses current-brand draft and live event stores | PASS | `home.tsx:126-128` calls `useDraftsForBrand(currentBrand?.id ?? null)`, `useLiveEventsForBrand(currentBrand?.id ?? null)`, and subscribes to order entries. |
| Home summary is derived from helper | PASS | `home.tsx:212-217` builds `eventSummary` with `buildBrandEventSummary(liveEvents, drafts)` and derives `primaryLiveEvent` from `eventSummary.primaryLiveItem`. |
| Active KPI uses event summary, not brand stats | PASS | `home.tsx:340-345` renders `eventSummary.counts.active` and `formatActiveEventsSub(eventSummary.counts)`. |
| KPI subcopy includes zero buckets when active > 0 | PASS | `home.tsx:104-112` emits `live · upcoming · draft(s)` for all positive active states; zero active emits `No active events`. |
| Upcoming section renders real active items only | PASS | `home.tsx:366-375` branches on `eventSummary.activeItems`; no static row source remains. |
| Empty upcoming copy matches spec | PASS | `home.tsx:367-373` renders `No upcoming events` and `Build an event to see it here.` |
| Draft rows preserve resume behavior and copy | PASS | `home.tsx:376-414` opens `/event/{draft.id}/edit`, labels `Resume draft`, shows `Draft`, `Step X of 7`, and `resume`. |
| Live/upcoming rows open event detail and use shared date display | PASS | `home.tsx:418-461` opens `/event/{event.id}`, shows `Live`/`Upcoming`, and renders `formatDraftDateLine(event)`. |
| Live hero uses summary live event and honest metrics | PASS | `home.tsx:217-241` derives metrics from primary live event and order store; `home.tsx:279-329` renders `Live now`, event title/date, revenue, tickets sold, capacity, and scanned `—`. |
| All-unlimited capacity displays `Unlimited`; missing capacity displays `—` | PASS | `home.tsx:80-95` implements unlimited/missing capacity formatting. |
| Helper is pure | PASS | `brandEventSummary.ts:1-3` imports only types and `deriveLiveStatus`; no React, Zustand hooks, navigation, or components. |
| Helper tests cover required cases | PASS | `brandEventSummary.test.ts:120-214` covers draft-only, upcoming-only, live-window, past/cancelled exclusion, and mixed ordering. |
| I-PROPOSED-Z is registered and runnable | PASS | Script `i-proposed-z-home-no-fabricated-events.mjs:13-24`; README `strict-grep/README.md:30,108`; workflow `strict-grep-mingla-business.yml:250-259`; package script `package.json:18`. |
| Scope remained within approved surface | PASS | Changed ORCH product files are Home, helper/test, strict-grep registry/workflow, and business package script; no Supabase, public, admin, mobile, Stripe, checkout, scanner, finance, or backend adapter changes were found in the ORCH-0754 touched set. |

## Static Findings

No P0/P1 ORCH-0754 findings.

P2 external release hygiene: `cd mingla-business && npm run lint` fails with existing repo-wide lint debt. The output includes files such as `app/__styleguide.tsx`, `app/event/[id]/index.tsx`, account/event/brand component files, and utility/store warnings. It does not include the ORCH-0754 Home/helper/gate files. This keeps the QA verdict at CONDITIONAL PASS rather than full PASS.

## Command Evidence

Local shell note: commands were run with `PATH=/opt/homebrew/bin:$PATH` so local `node`, `npm`, and `npx` resolve. No package scripts were modified during QA.

### `cd mingla-business && npm run test:orch-0754`

Result: PASS.

```text
> mingla-business@1.0.0 test:orch-0754
> node ../.github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs && npx jest brandEventSummary.test

I-PROPOSED-Z PASS: Home contains no fabricated upcoming-event signatures.
PASS src/utils/__tests__/brandEventSummary.test.ts
  buildBrandEventSummary
    ✓ draft-only summaries keep drafts active and order by updated time (12 ms)
    ✓ upcoming live events are active and order by event date ascending (1 ms)
    ✓ live-window events become the primary live item
    ✓ past and cancelled live events stay out of active items (1 ms)
    ✓ mixed summaries order live, upcoming, then drafts

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
```

Jest emitted a Watchman recrawl warning before the PASS output; it did not fail the run.

### `cd mingla-business && npx jest brandEventSummary.test`

Result: PASS.

```text
PASS src/utils/__tests__/brandEventSummary.test.ts
  buildBrandEventSummary
    ✓ draft-only summaries keep drafts active and order by updated time (16 ms)
    ✓ upcoming live events are active and order by event date ascending (2 ms)
    ✓ live-window events become the primary live item
    ✓ past and cancelled live events stay out of active items (1 ms)
    ✓ mixed summaries order live, upcoming, then drafts (1 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Snapshots:   0 total
```

### `node .github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs`

Result: PASS.

```text
I-PROPOSED-Z PASS: Home contains no fabricated upcoming-event signatures.
```

### `cd mingla-business && npx tsc --noEmit`

Result: PASS. Exit code `0`; no output.

### Direct fake-signature grep

Command:

```bash
rg -n "STUB_UPCOMING_ROWS|StubUpcomingRow|Sunday Languor Brunch|The Long Lunch \(Series\)|1 live · 2 upcoming|Tonight · 21:00|Math\.round\(liveEvent\.soldGbp / 30\)|/ 400|currentBrand\?\.currentLiveEvent" "mingla-business/app/(tabs)/home.tsx"
```

Result: PASS. Exit code `1`; no output.

### `cd mingla-business && npm run lint`

Result: FAIL, external lint debt.

Representative output:

```text
/Users/sethogieva/Desktop/mingla-main/mingla-business/app/__styleguide.tsx
  164:18   error    React Hook "useSafeAreaInsets" is called conditionally
  165:18   error    React Hook "useRouter" is called conditionally

/Users/sethogieva/Desktop/mingla-main/mingla-business/app/event/[id]/index.tsx
  312:22  error    React Hook "useOrderStore" is called conditionally
  319:26  error    React Hook "useOrderStore" is called conditionally
  327:26  error    React Hook "useDoorSalesStore" is called conditionally

✖ 188 problems (80 errors, 108 warnings)
```

Lint caveat classification: external release blocker / CONDITIONAL PASS. No ORCH-0754 file appeared in the lint output.

## Scope Guard

Verified no ORCH-0754 evidence of changes to Supabase migrations/RLS/edge functions/RPCs/server reads, Brand Profile fake recent-event cleanup, Finance Reports stubs, Events tab behavior, public/mobile/admin surfaces, Stripe, scanner, checkout, order creation, finance, or backend adapters.

The broader worktree contains unrelated modified/untracked files outside ORCH-0754. They were ignored for this targeted QA except where lint output named them as external debt.

## Residual Risk

Runtime UI was not manually exercised in a simulator in this tester pass. Static code and automated gates verify the data-source contract, empty copy, row behavior, and regression guard. A final visual smoke test of Business Home with no events, draft-only, upcoming-only, and live-event local-store states would be useful before a broader business-app release.

## Closeout Readiness

ORCH-0754 is ready for `$orchestrator` review/close if orchestrator accepts the existing full-lint failure as unrelated external debt. No implementor rework is required for ORCH-0754 based on this QA pass.
