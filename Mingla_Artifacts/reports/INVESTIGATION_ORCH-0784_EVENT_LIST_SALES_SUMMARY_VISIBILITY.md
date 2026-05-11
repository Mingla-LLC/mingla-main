# INVESTIGATION ORCH-0784 - Event List Sales Summary Visibility

Date: 2026-05-11
Mode: Forensics / INVESTIGATE
Working tree: `/Users/sethogieva/Desktop/mingla-main`
Branch: `Seth`
Status: CONFIRMED
Severity: S1 organizer commerce-trust UX/data-source bug

## Executive Verdict

ORCH-0784 is confirmed. The defect is not one single missing query; it is a split between the two organizer overview surfaces:

1. `mingla-business/src/components/event/EventListCard.tsx` is already using the server-backed `useEventOrders` path, but its presentation hides sold count whenever an event has no finite capacity (`totalCapacity <= 0`) and renders true zero revenue as `-`.
2. `mingla-business/app/(tabs)/home.tsx` still derives Upcoming-row sold/revenue metrics from local persisted `useOrderStore`, not the ORCH-0777 server-backed order truth. It also has no amount-made field at all on Upcoming rows.

This explains the operator screenshots:

- Home Upcoming shows `The party block` as `0 / 20 sold`.
- Events tab shows the same event as `3/20` and `$150`.
- Events tab shows `Test event`, `A life in vegas`, and `Runtime Share Test...` with a right-rail dash instead of explicit sold/revenue summaries.

This should stay in ORCH-0784. I do not recommend reopening ORCH-0777: the ORCH-0777 checkout/order service and protected organizer detail/order/guest surfaces still match their closed evidence. ORCH-0784 is a missed overview-list contract plus a Home source gap. ORCH-0782 remains separate because it owns organizer resend-ticket CTA and notification rollup recompute, not list summary visibility.

## Phase 0 Historical Context

Read and used:

- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0777_TICKET_CHECKOUT_SALES_REGISTRATION_AND_PHONE_REQUIRED.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`
- `Mingla_Artifacts/reports/QA_ORCH-0777_REAL_DEVICE_ORDER_VISIBILITY_AND_NOTIFICATION_REVIVAL.md`
- `Mingla_Artifacts/CLOSE_NOTE_ORCH-0777.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `Mingla_Artifacts/DECISION_LOG.md`
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`
- Operator screenshots:
  - `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 Pro - 2026-05-11 at 04.22.09.png`
  - `/Users/sethogieva/Desktop/Simulator Screenshot - iPhone 17 Pro - 2026-05-11 at 04.21.56.png`

Historical facts:

- ORCH-0777 made production checkout issue server orders/tickets and required organizer sales/revenue/order/guest/scanner truth to come from server records, not local checkout stubs.
- ORCH-0777 QA proved `The party block` had 3 paid orders at $50 each, for $150, and `A life in vegas` had server-visible free ticket rows with $0 revenue.
- ORCH-0777 close accepted the checkout/order visibility path and created ORCH-0782 only for resend-ticket CTA and notification rollup, not for sales-summary cards.

## Current Code Truth

### Events Tab Cards

File: `mingla-business/src/components/event/EventListCard.tsx`

The card uses server orders:

- Imports `useEventOrders`.
- Calls `useEventOrders(kind === "live" ? event.id : null)`.
- Computes `soldCount` from `paid` and `refunded_partial` server order lines by summing `quantity - refundedQuantity`.
- Computes `revenueSummary` with `summarizeEventMoney(...)` using `orderEntries`.

The hiding behavior is in presentation:

- `totalCapacity(event)` returns `0` for all-unlimited ticket sets because it tracks unlimited tickets but returns `0` when there is no finite capacity.
- The progress/sold row only renders when `totalCapacity > 0`.
- For non-draft events where `totalCapacity <= 0`, the alternate render branch returns `null`; no sold count is shown.
- The revenue display renders a formatted amount only when `revenueGbp > 0`.
- With zero revenue and no currency mismatch, it renders `-`.

Result:

- Finite nonzero events can show `3/20` and `$150`.
- Finite zero-sale events can show `0/capacity`, but revenue is still `-`.
- Unlimited/no-finite-capacity events can hide sold count entirely.
- Unlimited zero-revenue events collapse to `-`, even when `$0`/`£0` is the honest answer.
- Currency mismatch is already distinguished as `Currency review`; that should remain.

### Home Upcoming Rows

File: `mingla-business/app/(tabs)/home.tsx`

Home still reads sales metrics from local persisted order state:

- Imports `useOrderStore`.
- Reads `orderEntries = useOrderStore((s) => s.entries)`.
- Reads `getSoldCountForEvent = useOrderStore((s) => s.getSoldCountForEvent)`.
- Computes live hero revenue by filtering local `orderEntries`.
- Computes each Upcoming row sold count with `getSoldCountForEvent(event.id)`.

Home does not use `useEventOrders` or `useEventSoldCounts` for row summaries.

Home row presentation:

- Draft rows intentionally show `-` / `resume`.
- Non-draft rows show only one right-side metric: sold count.
- There is no amount-made field on Upcoming rows.
- `formatSoldOutOfCapacity` returns just `soldLabel` when capacity is `null`, so all-unlimited events show bare `0 sold`, not `0 / Unlimited sold` or another explicit unlimited contract.

Result:

- Home can show stale or empty local counts while Events/Event Detail show server-backed sales.
- Home cannot show amount made per Upcoming row because the UI has no revenue slot there.
- The screenshot mismatch for `The party block` is explained by this: Home is reading local state, Events card is reading server orders.

### Event Detail Baseline

File: `mingla-business/app/event/[id]/index.tsx`

Event Detail is closer to the ORCH-0777 contract:

- Uses `useEventOrders(event?.id ?? null)`.
- Derives `totalSoldCount` from server order entries.
- Derives per-tier sold counts from server order entries.
- Computes money summary from server order entries plus door-sale entries.
- Renders the Orders tile as `${totalSoldCount} sold`.
- Renders the revenue KPI as formatted currency, including zero.

This is why the overview-list bug should not be generalized as "orders are missing everywhere."

## Root Cause Chain

1. ORCH-0777 moved checkout and major organizer order surfaces to server-backed order truth.
2. The ORCH-0777 strict guard bans `useOrderStore` in key production organizer sales surfaces, including Event Detail, order routes, guest routes, reconciliation, `EventListCard`, and `EditPublishedScreen`.
3. That guard does not include `mingla-business/app/(tabs)/home.tsx`.
4. Home retained local `useOrderStore` metrics from the earlier ORCH-0754 no-fabricated-home work.
5. Therefore server orders can exist while Home Upcoming still shows `0`.
6. Events cards do fetch server orders, but the render contract ties sold count to finite capacity and ties revenue visibility to `revenue > 0`.
7. Therefore unlimited, no-capacity, and zero-revenue states render as missing or ambiguous, even when the underlying state is valid.

## Behavior Matrix

| Surface | Limited + nonzero sales | Limited + zero sales | Unlimited/no finite capacity + nonzero sales | Unlimited/no finite capacity + zero sales | Draft |
| --- | --- | --- | --- | --- | --- |
| Home Upcoming | Local `sold/capacity`; may be stale; no amount made | Local `0/capacity`; no amount made | Local bare sold count; no amount made | Local bare `0 sold`; no amount made | Correctly `- / resume` |
| Events card | Server `sold/capacity` plus amount if revenue > 0 | Server `0/capacity`, but revenue `-` | Amount may show only if > 0; sold count hidden | Right rail collapses to `-` | Correctly draft/resume semantics in draft bucket |
| Event Detail | Server sold/revenue baseline | Server `0`/formatted zero baseline | Server sold baseline | Server zero baseline | Not the active draft surface |

## Buyer Count Definition

Current code consistently treats the visible count as tickets sold, not unique buyers or order count:

- `EventListCard` sums line quantities minus refunded quantities.
- Event Detail `totalSoldCount` uses the same ticket-quantity rule.
- `orderStore.getSoldCountForEvent` uses the same rule for local records.
- Labels say `sold`, `Tickets sold`, or `${n} sold`.

For ORCH-0784, the safest spec language is "tickets sold" unless product explicitly wants unique buyer count added as a separate label. Changing to unique buyers would be a product-contract change and would require a different query/label/test set.

## Door Sales, Refunds, Currency, Hidden Tickets

Refunds:

- Online sold counts currently include `paid` and `refunded_partial` orders and subtract `refundedQuantity`.
- Fully refunded/cancelled orders do not contribute to live sold count.
- This behavior is consistent across server EventListCard/Event Detail logic and local `orderStore` selectors.

Door sales:

- Event Detail includes door-sale entries in `moneySummary`, but its main revenue KPI uses `onlineRevenue`; the Door Sales tile separately shows door sold/revenue.
- EventListCard passes `doorSales: []` into `summarizeEventMoney`.
- Home excludes door sales.
- ORCH-0784 spec must explicitly decide whether list "amount made" means online checkout revenue only or gross event revenue including door sales. The current list-card implementation is online-only.

Currency mismatch:

- `summarizeEventMoney` excludes stale mismatched-currency positive rows from expected-currency totals and returns `mismatches`.
- `EventListCard` already renders `Currency review` when mismatches exist and zero expected-currency revenue exists.
- The fix should keep this honesty and only replace true zero/no-mismatch dashes with explicit formatted zero.

Hidden/private tickets:

- Total sold count from order rows includes all order lines regardless of current ticket visibility.
- Event Detail ticket-type section filters hidden ticket rows for display, but the event-level sold count includes all server order lines.
- ORCH-0784 should preserve event-level totals across hidden/private ticket types.

Comps/free tickets:

- Free checkout rows count toward sold when represented as paid/free server orders with quantity.
- Revenue remains explicit zero.
- I found no evidence that list summaries currently include a separate comp-ticket store outside server order rows.

## Test and Guard Gap

Existing verification run during this investigation:

- `node .github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs` passed.
- `node .github/scripts/strict-grep/i-proposed-z-home-no-fabricated-events.mjs` passed.

Why those passes did not catch ORCH-0784:

- ORCH-0777 guard protects EventListCard from `useOrderStore`, but it does not guard Home row sales/revenue metrics.
- ORCH-0754 Home guard only blocks fabricated upcoming rows and hardcoded event metrics; it does not require server-backed sales summaries or amount-made display.
- Current Jest coverage validates server order adapters and money currency behavior, but there is no focused card/Home summary rendering contract for limited/unlimited, zero/nonzero sales states.

Required future regression coverage:

- Add an ORCH-0784 guard/test job, for example `test:orch-0784`.
- EventListCard tests should cover:
  - finite capacity, zero sales: shows `0/capacity` and explicit formatted zero revenue;
  - finite capacity, nonzero sales: shows `sold/capacity` and formatted amount;
  - all-unlimited, zero sales: shows explicit sold count and explicit formatted zero revenue;
  - all-unlimited, nonzero sales: shows explicit sold count and formatted amount;
  - currency mismatch: shows `Currency review`, not fake zero;
  - draft rows keep `resume` semantics.
- Home tests/strict guard should cover:
  - Home no longer uses `useOrderStore` for non-draft sales/revenue list summaries;
  - Home reads server-backed event-order summaries for visible non-draft events;
  - each non-draft Upcoming row renders both tickets-sold and amount-made text;
  - unlimited/no finite capacity rows render explicit sold state, not ambiguous dash/missing value;
  - drafts retain `- / resume`.

## Required Fix Scope

Implementation should be scoped to Mingla Business organizer overview surfaces:

- `mingla-business/src/components/event/EventListCard.tsx`
- `mingla-business/app/(tabs)/home.tsx`
- likely `mingla-business/src/hooks/useEventOrders.ts` or a new small summary hook/helper if Home needs batched server summaries
- focused ORCH-0784 tests/strict-grep and package script registration

No Supabase migration is indicated by this investigation. No checkout/Stripe/payment finalization change is indicated. No ORCH-0782 resend-ticket or notification-rollup work is indicated.

## Recommended Product Contract for SPEC

For every non-draft organizer list item on Home Upcoming and Events tab:

- Always show tickets sold.
- Always show amount made.
- Use server-backed order truth for online checkout summaries.
- Render true zero as formatted zero (`$0`, `£0`, etc.), not `-`.
- Render finite capacity as `sold / capacity`.
- Render unlimited/no finite capacity with an explicit sold label, for example `3 sold` or `3 / Unlimited` if product prefers capacity symmetry.
- Preserve `Currency review` when expected-currency totals cannot honestly include mismatched positive rows.
- Keep drafts as `- / resume`.
- Do not expose buyer PII, ticket QR payloads, or notification-provider internals on list cards.

Open SPEC decision:

- Decide whether "amount made" on list rows is online checkout revenue only, or gross revenue including door sales. Current Events/Home list implementations are online-only. Event Detail separately exposes door-sale revenue.

## Downstream Handoff

Next owner should write a Claude `mingla-forensics` SPEC for ORCH-0784, then route to Codex `implementor-mingla`, then Claude `mingla-forensics` TEST mode, then Codex `orchestrator-mingla` CLOSE.

Exact handoff message:

`[$forensics](/Users/sethogieva/Desktop/mingla-main/.codex/skills/forensic-mingla/SKILL.md) SPEC ORCH-0784 from investigation report Mingla_Artifacts/reports/INVESTIGATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md. Working tree: /Users/sethogieva/Desktop/mingla-main on branch Seth. Confirmed root causes: Home Upcoming rows still use local useOrderStore and have no amount-made UI, while EventListCard is server-backed but hides sold count for totalCapacity <= 0 and renders true zero revenue as "-". Write a precise implementor-ready spec for Mingla Business only. Hard guards: no product-code edits in SPEC, no PII/secrets/QR payloads, do not reopen ORCH-0777, do not absorb ORCH-0782 resend-ticket/notification-rollup work, preserve draft resume semantics, preserve currency-mismatch honesty, and require repo-running ORCH-0784 regression tests for limited/unlimited and zero/nonzero ticket states.`
