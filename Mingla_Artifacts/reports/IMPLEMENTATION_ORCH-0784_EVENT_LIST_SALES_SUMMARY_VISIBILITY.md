# Implementation Report: Event List Sales Summary Visibility (ORCH-0784)

> Date: 2026-05-11
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
> Status: implemented and verified

## 1. Layman Summary

Mingla Business Home and Events now use server-backed order summaries for non-draft event list metrics. Organizers see tickets sold and online amount made on the overview surfaces, including unlimited-ticket events and honest `$0` / `£0` zero-revenue states, without opening each event.

## 2. Request And Context

- **Request:** Implement ORCH-0784 from the completed forensics report and spec.
- **Source:** user-dispatched `$implementor` prompt, backed by ORCH-0784 investigation/spec artifacts.
- **Affected surfaces:** Mingla Business Home tab, Events tab `EventListCard`, event-order hooks, summary utility/tests, strict-grep CI.
- **Related issues/artifacts:** ORCH-0777 order truth remains closed; ORCH-0782 resend-ticket/notification-rollup remains separate.

## 3. Scope

- **In scope:** server-backed online sales summaries, finite/unlimited sold labels, explicit zero revenue labels, Home live/upcoming row metrics, Events card metrics, ORCH-0784 regression tests/gates.
- **Out of scope:** checkout, Stripe, notifications, resend-ticket, notification rollup, QR/scanner, Supabase migrations/RLS, admin, public web, door-sales inclusion.
- **Assumptions:** count means tickets sold, not unique buyers; amount made means online checkout revenue only.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md` | Contract | Required Home + Events list summaries, explicit zero, server truth, tests |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md` | Evidence | Root causes split between Home source and Events presentation |
| `mingla-business/app/(tabs)/home.tsx` | Target surface | Home used local `useOrderStore` and lacked row revenue |
| `mingla-business/src/components/event/EventListCard.tsx` | Target surface | Events card hid sold count for no finite capacity and zero revenue |
| `mingla-business/src/hooks/useEventOrders.ts` | Server order hook | Existing `useEventSoldCounts` was GBP/default-only and not Home-ready |
| `mingla-business/src/utils/moneySummary.ts` | Money contract | Existing mismatch handling should be preserved |
| `mingla-business/src/utils/currency.ts` | Formatting | `formatCurrencyRound(0, currency)` renders explicit zero |
| `.github/workflows/strict-grep-mingla-business.yml` | CI registry | Needed ORCH-0784 strict-grep job |

## 5. Blast Radius

- **Direct changes:** Home, EventListCard, event-order hook, shared summary util, focused tests, strict-grep gate, package script, workflow job.
- **Cascade changes:** Home live hero now uses the same server-backed summary map as Upcoming rows.
- **Parity surfaces:** Business only. Admin, public web, app-mobile consumer unchanged.
- **Cache impact:** added React Query summary queries via existing `fetchEventOrders`; no persisted cache.
- **State boundaries:** removed Home's non-draft sales dependence on local `useOrderStore`; drafts still use draft store.
- **Auth/RLS/security:** unchanged. Aggregate labels only; no PII/QR/order identifiers rendered.
- **Deploy path:** business app bundle/OTA only; no migration or Edge Function deploy.

## 6. Old To New Receipts

### `mingla-business/src/utils/eventSalesSummary.ts`

- **Before:** no shared list-summary helper.
- **After:** added canonical `buildEventSalesSummary`, capacity summarization, ticket-sold calculation, explicit zero revenue labels, mismatch honesty, and query-error labels.
- **Why:** keeps Home and EventListCard from implementing divergent sales/revenue rules.

### `mingla-business/src/hooks/useEventOrders.ts`

- **Before:** `useEventSoldCounts` returned sold/revenue with default GBP and no event currency/capacity/mismatch context.
- **After:** added `useEventSalesSummaries(events, brandDefaultCurrency)` that fetches server orders and returns currency-aware summaries by event ID.
- **Why:** Home needs one top-level server-backed summary hook for visible non-draft events.

### `mingla-business/src/components/event/EventListCard.tsx`

- **Before:** sold count rendered only when `totalCapacity > 0`; zero revenue rendered `-`; past cards hid revenue strip.
- **After:** non-draft cards always render shared sold + revenue labels; finite events keep progress bars; unlimited/no-finite events show explicit sold text; zero revenue formats as currency zero.
- **Why:** Events tab must not hide valid sales/revenue states.

### `mingla-business/app/(tabs)/home.tsx`

- **Before:** Home imported `useOrderStore`, used local sold/revenue metrics, and Upcoming rows only showed sold count.
- **After:** Home consumes `useEventSalesSummaries`, live hero uses server-backed metrics, and non-draft rows show sold + amount labels with accessibility text.
- **Why:** Home must agree with real server checkout/order truth.

### Tests and Gates

- **Before:** no ORCH-0784 regression test or strict-grep gate.
- **After:** added `eventSalesSummary.test`, `.github/scripts/strict-grep/orch-0784-event-list-sales-summary-visibility.mjs`, `test:orch-0784`, and CI workflow registration.
- **Why:** the old unlimited/zero/Home-local regressions now fail automatically.

## 7. Implementation Details

- **Architecture decisions:** use a pure summary utility for deterministic tests and a hook wrapper for React Query integration.
- **Data flow:** `fetchEventOrders` -> `useEventSalesSummaries` / `useEventOrders` -> `buildEventSalesSummary` -> Home/EventListCard labels.
- **Mutation/query behavior:** no mutations; no invalidations added; existing order fetch service reused.
- **State handling:** no new Zustand/AsyncStorage state; Home no longer uses local order store for non-draft sales summaries.
- **Error handling:** query errors produce `Unable to load` labels instead of fabricated zero labels.
- **Copy/accessibility:** non-draft list rows/cards include sold and amount labels in accessibility text; drafts retain resume semantics.
- **Analytics/notifications/realtime:** none.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Home rows show sold + online amount | Yes | `home.tsx`, ORCH-0784 gate | PASS |
| Home no longer uses local order store for summaries | Yes | strict-grep | PASS |
| Events cards show sold + amount for non-drafts | Yes | `EventListCard.tsx`, ORCH-0784 gate | PASS |
| Unlimited/no finite capacity shows explicit sold count | Yes | `eventSalesSummary.test` | PASS |
| Zero revenue shows formatted zero | Yes | `eventSalesSummary.test` | PASS |
| Currency mismatch stays honest | Yes | `eventSalesSummary.test`, `moneySummary.test` | PASS |
| Draft resume semantics preserved | Yes | source review + unchanged draft branch | PASS |
| Regression tests ship with behavior | Yes | `test:orch-0784` | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| One owner per truth | Yes | Yes | React Query/server orders own non-draft sales summaries |
| No fabricated data | Yes | Yes | Home no longer pulls stale local order summaries |
| Currency honesty | Yes | Yes | mismatches render `Currency review` when expected-currency revenue is zero |
| No PII/QR exposure | Yes | Yes | aggregate counts/revenue only |
| ORCH-0782 boundary | Yes | Yes | no resend/notification-rollup files touched |

## 10. Parity Check

- **Mobile:** app-mobile unaffected.
- **Business app:** Home and Events list summaries updated.
- **Admin:** unaffected.
- **Public/web:** unaffected.
- **Solo/collab:** not relevant.
- **Gaps:** no simulator visual smoke was run in this implementation pass; targeted automated gates passed.

## 11. Cache And Persisted State Safety

- **Query keys changed:** added event-order sales-summary query keys in `eventOrdersKeys`.
- **Invalidations added:** none.
- **Data shape changes:** no server data shape changes; added client summary shape only.
- **AsyncStorage/Zustand impact:** no new persisted state; removed Home sales dependency on `useOrderStore`.
- **Cold start behavior:** summaries fetch through React Query when auth/session is ready; drafts do not query orders.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| ORCH-0784 scoped gate | `npm run test:orch-0784` | PASS | strict-grep + 6 Jest summary tests |
| Money/order adjacent tests | `npx jest moneySummary.test eventOrdersService.test` | PASS | 5 tests |
| TypeScript | `npx tsc --noEmit` | PASS | no output |
| Home fabricated-event guard | `npm run test:orch-0754` | PASS | also reran strict-grep directly after final patch |
| ORCH-0777 checkout/order guard | `node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` | PASS | preserved EventListCard server-order invariant |
| Diff whitespace | `git diff --check` | PASS | no whitespace errors |

Note: Jest emitted a Watchman recrawl warning on test runs. It did not affect test results.

## 13. Regression Surface

1. Home row density: the right column now displays two compact labels; tester should visually confirm on iPhone-size screens.
2. Events card right rail: revenue now appears for past/non-draft cards too, per spec; tester should confirm layout does not crowd the manage button.
3. React Query summary fanout: Home fetches visible non-draft event order summaries; acceptable for current list sizes, but future high-volume dashboards may need a batched server endpoint.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| No visual simulator smoke in this pass | Automated tests prove contract but not pixel fit | Tester runs Home/Events visual QA | Home + EventListCard |
| Per-event summary query fanout | Could grow with large event lists | Future batched aggregate endpoint if needed | `useEventSalesSummaries` |

## 15. Discoveries For Orchestrator

- Untracked file `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md` existed in the worktree and was not touched by this implementation.

## 16. Deploy Notes

- **Migrations:** none.
- **Edge functions:** none.
- **Mobile OTA/native:** business app JS change only; no native module changes.
- **Business/admin web:** business bundle only; admin unaffected.
- **Env vars/secrets:** none.

## Suggested Commit Message

```text
business: keep event list sales summaries visible

Resolves: ORCH-0784
Evidence: npm run test:orch-0784; npx jest moneySummary.test eventOrdersService.test; npx tsc --noEmit
Deploy: business app bundle/OTA only; no migrations or edge deploys
```

## Ready-To-Test Checklist

1. On Home, confirm non-draft live/upcoming rows show sold and amount labels for finite, unlimited, zero-sale, and nonzero-sale events.
2. On Events tab, confirm cards show sold and amount labels for finite, unlimited, zero-sale, nonzero-sale, and past non-draft events.
3. Confirm drafts still show `- / resume` and do not show sales/revenue.
4. Confirm a currency-mismatch fixture still shows `Currency review` rather than fake zero.
