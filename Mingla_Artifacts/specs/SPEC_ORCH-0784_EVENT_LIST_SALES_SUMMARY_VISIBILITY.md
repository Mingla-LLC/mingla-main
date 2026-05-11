# Spec: Event List Sales Summary Visibility (ORCH-0784)

> Date: 2026-05-11
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
> Status: READY FOR IMPLEMENTOR
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

## 1. Plain-English Goal

Organizers should be able to glance at Home and Events and trust the commerce numbers without opening every event. Every non-draft event row/card must show how many tickets have sold and how much online checkout revenue has been made, even when ticket capacity is unlimited and even when the honest value is zero.

Today, the Events tab has server-backed order data but hides sales summaries in unlimited/no-capacity and zero-revenue states. Home still reads local `useOrderStore` metrics and has no amount-made field on Upcoming rows, so it can disagree with Events and Event Detail after real server checkout.

## 2. User Story

As a Mingla Business organizer, I want every published event row on Home and Events to show tickets sold and amount made, so that I can quickly understand sales performance without opening each event and without wondering whether zero means "no data" or "$0".

## 3. Scope

- **In scope:** Mingla Business Home live/upcoming sales summaries, Events tab `EventListCard` sales summaries, server-backed online order summary hook/helper, explicit zero revenue rendering, unlimited-ticket display, currency mismatch honesty, and ORCH-0784 regression gates.
- **Non-goals:** no checkout, Stripe, PaymentIntent, notification, resend-ticket, notification-rollup, QR, scanner, Supabase schema, RLS, migration, admin, public web, buyer checkout, or door-sale/reconciliation rewrite.
- **Assumptions:** "people who bought" means tickets sold, not unique buyers. "Amount made" means online checkout revenue only for ORCH-0784. Door-sale revenue remains separate on Event Detail/Door Sales until a dedicated finance/reconciliation spec changes that.
- **Dependencies:** ORCH-0777 server order service remains the source of production order truth. ORCH-0782 remains the owner for resend-ticket CTA and notification rollup.

## 4. Evidence Trace

| Requirement | Comes from finding / source | Confidence |
|---|---|---|
| Home non-draft list summaries must stop using local `useOrderStore` | Investigation root cause: Home imports `useOrderStore`, reads `entries`, and uses `getSoldCountForEvent` for Upcoming rows | High |
| Home Upcoming rows must add amount-made UI | Investigation: Home row render only has a right-side sold column and no revenue slot | High |
| EventListCard must show sold count even when capacity is unlimited/no finite capacity | Investigation: `totalCapacity(event)` returns `0` for all-unlimited and sold row is gated by `totalCapacity > 0` | High |
| EventListCard/Home must render true zero revenue as formatted zero | Investigation: EventListCard renders `-` when `revenueGbp <= 0` and no mismatch | High |
| Currency mismatch must remain honest | Investigation: `summarizeEventMoney` already returns mismatches and EventListCard already has `Currency review` branch | High |
| Draft rows must retain resume semantics | Operator screenshots and investigation mark draft `- / resume` as correct | High |

## 5. Success Criteria

1. Every non-draft Home Upcoming row shows tickets sold and online amount made.
2. The Home live hero, if it shows sales/revenue, uses server-backed online order truth rather than local `useOrderStore`.
3. Every non-draft Events tab card shows tickets sold and online amount made.
4. Limited finite-capacity events show `sold / capacity`.
5. Unlimited/no-finite-capacity events show an explicit sold count such as `3 sold`, never a dash or a missing sold summary.
6. True zero revenue renders as formatted zero in the event currency/brand default currency, for example `$0` or `£0`, not `-`.
7. Positive mismatched-currency rows still render `Currency review` rather than being silently repainted as the expected currency.
8. Draft rows keep the existing `- / resume` behavior and are not queried as production order summaries.
9. The fix ships with repo-running ORCH-0784 regression tests/strict-grep in the same scoped commit/push.

## 6. Invariants

### Must Preserve

| Invariant | Enforcement in this spec | Verification |
|---|---|---|
| ORCH-0777 production organizer sales surfaces use server order truth | Home and Events list summaries use `fetchEventOrders`/server-backed hook path, not local order store | ORCH-0784 strict-grep + focused Jest tests |
| Drafts are not production order surfaces | Draft rows keep `- / resume`; summary queries exclude draft IDs | component tests / strict source assertion |
| Currency honesty | Use `summarizeEventMoney`; preserve `Currency review` when mismatches exist | money summary and card summary tests |
| No PII or QR exposure | List summaries show aggregate tickets/revenue only | code review + no buyer/ticket payload in render tests |
| ORCH-0782 boundary | No resend-ticket CTA or notification rollup changes | diff review |

### New Invariants

| Invariant | Owner | Enforcement | Verification |
|---|---|---|---|
| Non-draft Home and Events rows always show sold and online amount made | `home.tsx`, `EventListCard.tsx` | Shared sales-summary formatter/helper and visible UI slots | `npm run test:orch-0784` |
| True zero online revenue is visible as currency zero | shared summary/formatter usage | Do not branch zero revenue to `-` | ORCH-0784 Jest tests |
| Home non-draft sales summaries must not read `useOrderStore` | `home.tsx` | new strict-grep guard | ORCH-0784 strict-grep |

## 7. Database / RLS / Migration

None.

No Supabase schema, RLS policy, function, trigger, view, or migration change is required. The current bug is client source/presentation, not missing server data. If implementor discovers a server-order shape issue while implementing, they must stop and route a new forensics investigation instead of expanding ORCH-0784.

## 8. Edge Functions / RPCs / Webhooks

None.

Do not edit checkout Edge Functions, Stripe webhook routing, ticket confirmation dispatch, resend-ticket behavior, QR pepper flows, scanner RPCs, or notification rollup behavior.

## 9. Service Layer

### Event sales summary helper

- **Path:** Prefer `mingla-business/src/hooks/useEventOrders.ts` for hook-level summaries plus a pure helper in `mingla-business/src/utils/eventSalesSummary.ts` if needed for tests.
- **Purpose:** Provide one canonical aggregate for list-row sales summaries.
- **Input:** event ID(s), event currency, brand default currency, event ticket capacity data, and fetched `OrderRecord[]`.
- **Output shape:**

```ts
export interface EventSalesSummary {
  eventId: string;
  soldCount: number;
  onlineRevenue: number;
  displayCurrency: string;
  mismatches: EventMoneySummary["mismatches"];
  finiteCapacity: number | null;
  hasUnlimitedTickets: boolean;
  soldLabel: string;
  revenueLabel: string;
}
```

- **Sold count rule:** sum `quantity - refundedQuantity` across `paid` and `refunded_partial` online orders, never below zero.
- **Revenue rule:** use `summarizeEventMoney({ expectedCurrency, orders, doorSales: [] })` and `onlineRevenue`.
- **Currency rule:** `expectedCurrency = event.currency ?? brand.defaultCurrency ?? "GBP"`.
- **Capacity rule:** finite capacity is the sum of non-unlimited ticket capacities. If no finite capacity exists and at least one ticket is unlimited, `finiteCapacity = null` and `hasUnlimitedTickets = true`.
- **Label rule:** finite capacity renders `${soldCount} / ${finiteCapacity}`; unlimited/no finite capacity renders `${soldCount} sold`.
- **Zero rule:** when `mismatches.length === 0`, `revenueLabel` is always `formatCurrencyRound(onlineRevenue, displayCurrency)` or equivalent existing currency formatter. Zero must format as `$0`/`£0`, never `-`.
- **Mismatch rule:** when `mismatches.length > 0` and expected-currency online revenue is zero, render `Currency review`; when expected-currency revenue is positive, render the positive expected-currency amount and let detail surfaces retain deeper mismatch warning.

### Update or replace `useEventSoldCounts`

- **Path:** `mingla-business/src/hooks/useEventOrders.ts`
- **Current issue:** `useEventSoldCounts(eventIds)` exists but returns `{ soldCount, revenue }` using `getEventOrderRevenue(orders)` with default GBP and lacks event/brand currency/mismatch/capacity context.
- **Required change:** either replace it with `useEventSalesSummaries(events, brandDefaultCurrency)` or extend it so Home can consume currency-aware `EventSalesSummary` by event ID.
- **Query behavior:** fetch server orders using the existing `fetchEventOrders` service. Exclude draft IDs. Use stable query keys that include event IDs and enough currency/capacity metadata to avoid stale summary labels after event edit.
- **Error behavior:** if an individual summary query errors, Home/Events must not fabricate zeros. The row should show an honest unavailable state for amount such as `Unable to load` only if the hook exposes error state. If implementor cannot add row-level error cleanly without UI churn, leave existing React Query behavior and rely on loading/refetch defaults, but do not convert query errors into `0`.
- **Performance guard:** do not introduce hooks inside row maps. Home needs one top-level hook for the visible non-draft event set or a parent-level batched query.

## 10. Hook / State / Cache Layer

### Home sales summary source

- **Path:** `mingla-business/app/(tabs)/home.tsx`
- **Remove:** `useOrderStore` as a source for non-draft live/upcoming sold count and revenue.
- **Required:** top-level server-backed summary hook for the visible Home non-draft event IDs, including the primary live event if the hero renders revenue/sold.
- **Draft handling:** do not query drafts. Drafts continue to show step/resume metadata from draft store.
- **Cache:** use React Query through the summary hook. Do not add a new persisted Zustand sales cache.
- **Sign-out cleanup:** no new cleanup required if no new persisted store is added.

### Events card source

- **Path:** `mingla-business/src/components/event/EventListCard.tsx`
- **Keep:** server-backed order source via `useEventOrders` or equivalent summary hook.
- **Change:** summary rendering must no longer depend on finite capacity being greater than zero.
- **Optional refactor:** if Home and Events share the pure summary formatter, EventListCard can keep its own per-card `useEventOrders` fetch and pass the fetched orders into the shared formatter.

## 11. Component / Screen Layer

### `EventListCard`

- **Path:** `mingla-business/src/components/event/EventListCard.tsx`
- **States:**

| State | Condition | Renders |
|---|---|---|
| Draft | `kind === "draft"` | existing `-` / `resume`; no revenue summary |
| Finite capacity, zero sales | capacity > 0, sold 0, revenue 0, no mismatch | `0 / capacity` and formatted zero revenue |
| Finite capacity, nonzero sales | capacity > 0, sold > 0 | `sold / capacity` and formatted amount |
| Unlimited/no finite, zero sales | capacity null/0 and unlimited/no finite | `0 sold` and formatted zero revenue |
| Unlimited/no finite, nonzero sales | capacity null/0 and sold > 0 | `N sold` and formatted amount |
| Currency mismatch | mismatch present and expected revenue unavailable/zero | sold label plus `Currency review` |

- **Layout:** preserve the current card density and right-rail affordances. The implementor may replace the existing progress-only row with a compact metrics row that always includes sold + revenue for non-drafts.
- **Progress bar:** keep progress bar only when finite capacity exists. Unlimited/no-finite events should not show a fake progress bar.
- **Accessibility:** card accessibility label should include event name, status, sold label, and amount label for non-draft events. Do not include buyer names/emails/phones/order IDs.

### Home Upcoming rows

- **Path:** `mingla-business/app/(tabs)/home.tsx`
- **States:**

| State | Condition | Renders |
|---|---|---|
| Draft | draft item | existing step/resume metadata and right-side `- / resume` |
| Non-draft finite | event has finite capacity | sold label `sold / capacity` and amount label |
| Non-draft unlimited/no finite | event has no finite capacity | sold label `N sold` and amount label |
| Non-draft zero revenue | revenue is 0 and no mismatch | formatted zero amount |
| Currency mismatch | summary mismatch state | `Currency review` amount label |

- **UI contract:** the right side must show both sold and amount made. If horizontal space is tight, use two stacked compact labels rather than dropping amount made.
- **Copy:** use existing concise labels. Acceptable patterns: `0 sold` + `$0`; `3 / 20 sold` + `$150`; `Currency review`.
- **Accessibility:** row accessibility label should include event name, date, sold label, and amount label.

### Home live hero

- **Path:** `mingla-business/app/(tabs)/home.tsx`
- **Required:** if the hero continues to show revenue/sold metrics, those metrics must use the same server-backed summary hook as rows.
- **Do not:** leave live hero on `useOrderStore` while rows use server truth.

## 12. Business / Admin / Public Parity

- Business app changes: yes, Mingla Business Home and Events only.
- Admin changes: none.
- Public/web changes: none.
- Buyer checkout changes: none.
- App-mobile consumer changes: none.
- Operational dependency: none beyond deploying the Mingla Business bundle/OTA according to the normal release path.

## 13. Realtime / Notifications / Analytics

- Realtime: none. Use React Query refetch/cache behavior from the server-backed order hook.
- Notifications: none. Do not touch ORCH-0782 resend or notification rollup.
- Analytics: none required. If implementor adds an analytics event, it must not include PII or order IDs and must not be required for acceptance.

## 14. Implementation Order

1. Add pure sales-summary formatting helper and tests for finite/unlimited, zero/nonzero, refunds, and currency mismatch.
2. Update or replace `useEventSoldCounts` with a currency-aware `useEventSalesSummaries` hook suitable for Home.
3. Update `EventListCard` to use the shared summary logic and always render sold + amount for non-drafts.
4. Update Home live hero and Upcoming rows to consume server-backed summaries and render both sold + amount for non-drafts.
5. Add ORCH-0784 strict-grep script.
6. Register `test:orch-0784` in `mingla-business/package.json`.
7. Add/extend Jest tests so the current broken behavior fails before the fix and passes after.
8. Run focused verification commands and capture results in the implementation report.

## 15. Test Matrix

| ID | Scenario | Input/setup | Expected | Layer | Verification |
|---|---|---|---|---|---|
| T1 | Events card finite zero | finite capacity 20, no paid orders | `0 / 20` and formatted zero amount | component/helper | Jest |
| T2 | Events card finite nonzero | finite capacity 20, 3 paid tickets, $150 | `3 / 20` and `$150` | component/helper | Jest |
| T3 | Events card unlimited zero | unlimited ticket, no paid orders | `0 sold` and formatted zero amount | component/helper | Jest |
| T4 | Events card unlimited nonzero | unlimited ticket, paid orders | `N sold` and formatted amount | component/helper | Jest |
| T5 | Home finite server truth | local order store empty, server summary has 3/$150 | Home row shows server 3/$150, not local 0 | hook/screen guard | Jest/strict-grep |
| T6 | Home amount slot | non-draft Upcoming row | sold and amount labels both present | screen/source test | Jest or source guard |
| T7 | Draft row | draft Home/Event row | existing `- / resume` remains | component/source | Jest |
| T8 | Currency mismatch | USD expected, stale GBP positive order | `Currency review` when expected-currency total is otherwise zero | helper/component | Jest |
| T9 | Refund partial | paid order with refunded quantity | sold/revenue subtract refunded quantities/amount | helper | Jest |
| T10 | Strict source guard | Home source | non-draft summaries do not use `useOrderStore`; ORCH-0784 script registered | strict-grep | `npm run test:orch-0784` |

Minimum required automated commands:

```bash
cd mingla-business
npm run test:orch-0784
npx jest moneySummary.test eventOrdersService.test
npx tsc --noEmit
```

If component-render testing is blocked by missing React Native test infrastructure, implementor must add pure helper/source-guard coverage now and mark the row-level visual rendering as a tester manual gate. The exception must be explicit in the implementation report.

## 16. Regression Prevention

- **Structural safeguard:** `.github/scripts/strict-grep/orch-0784-event-list-sales-summary-visibility.mjs`.
- **Package script:** add `"test:orch-0784": "node ../.github/scripts/strict-grep/orch-0784-event-list-sales-summary-visibility.mjs && npx jest eventSalesSummary.test"` or the final focused Jest test names.
- **Workflow:** if strict-grep workflow requires per-script registration, add an ORCH-0784 job following existing strict-grep patterns.
- **Strict-grep requirements:**
  - Home must not import `useOrderStore` for non-draft sales/revenue summaries. If `useOrderStore` remains for unrelated legacy behavior, the script must assert it is not used for `getSoldCountForEvent`, `getRevenueForEvent`, `getRevenueSummaryForEvent`, or `orderEntries` in Home.
  - EventListCard must not render true zero revenue as `-`.
  - EventListCard must not gate sold count display only behind `totalCapacity > 0`.
  - `test:orch-0784` must exist in `mingla-business/package.json`.

## 17. Rollback And Deploy Safety

- **Migration order:** none.
- **Edge function deploy:** none.
- **Mobile OTA vs native build:** Mingla Business React Native/Expo code only. No native module changes expected; OTA/business app deploy path should be sufficient unless unrelated build config changes are introduced.
- **Business/admin web deploy:** business bundle only; admin unaffected.
- **Env vars/secrets:** none.
- **Partial rollback risk:** if Home is changed without EventListCard, surfaces will remain inconsistent. If EventListCard is changed without Home, screenshot mismatch persists. Implement both surfaces before close.

## 18. Common Mistakes

1. Do not solve Home by writing server orders into `useOrderStore`. That recreates the stale-cache problem and violates ORCH-0777's server truth direction.
2. Do not show `-` for zero revenue. A zero-dollar event is real information.
3. Do not show `0 / 0` for unlimited events. Use an explicit sold label.
4. Do not call the count "buyers" unless implementing unique-buyer logic. The current contract is tickets sold.
5. Do not include door sales in list "amount made" for this ORCH unless the orchestrator explicitly expands scope.
6. Do not weaken `Currency review` by converting mismatched positive rows into the event currency.
7. Do not touch ORCH-0782 notification/resend work.

## 19. Handoff To Implementor

Implement ORCH-0784 in Mingla Business only. First create a shared server-backed sales-summary helper/hook, then update `EventListCard` and Home live/upcoming rows so every non-draft item shows tickets sold and online amount made across limited, unlimited, zero-sale, and nonzero-sale states. Add `test:orch-0784`, strict-grep protection, and focused Jest coverage that would fail on the current `useOrderStore` Home path and Events-card zero/unlimited hiding behavior. Do not touch checkout, Stripe, notifications, QR/scanner, Supabase migrations, ORCH-0777 close scope, or ORCH-0782 resend/rollup scope.

## 20. Next Handoff

NEXT HANDOFF - paste into Codex implementor-mingla:

`[$implementor](/Users/sethogieva/Desktop/mingla-main/.codex/skills/implementor-mingla/SKILL.md) Implement ORCH-0784 from spec Mingla_Artifacts/specs/SPEC_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md and investigation Mingla_Artifacts/reports/INVESTIGATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md. Working tree: /Users/sethogieva/Desktop/mingla-main on branch Seth. Goal: Mingla Business Home live/upcoming rows and Events tab cards must always show server-backed tickets sold and online amount made for non-draft events across limited, unlimited/no-finite-capacity, zero-sale, nonzero-sale, refunded, and currency-mismatch states. Hard guards: no checkout/Stripe/notification/QR/scanner/Supabase migration edits, no PII/secrets/QR payloads, do not reopen ORCH-0777, do not absorb ORCH-0782 resend-ticket/notification-rollup work, preserve draft resume semantics, preserve currency-mismatch honesty, and ship repo-running ORCH-0784 regression tests in the same scoped commit/push. Expected output: implementation report at Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md with changed files, test evidence, residual manual gates if any, and downstream routing to Claude mingla-forensics TEST mode.`
