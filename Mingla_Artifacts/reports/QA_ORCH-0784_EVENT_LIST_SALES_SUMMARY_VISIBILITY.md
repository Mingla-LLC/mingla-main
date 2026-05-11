# QA ORCH-0784 — Event List Sales Summary Visibility

> Date: 2026-05-11
> Mode: Forensics / TEST (TARGETED — spec compliance + regression)
> Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`
> Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`

## 1. Verdict

**PASS**

Severity counts: **P0 = 0 · P1 = 0 · P2 = 0 · P3 = 2 · P4 = 2**

The Mingla Business Home tab and Events tab now both show server-backed tickets-sold and online amount-made for every non-draft event row/card across all six required matrix states (limited zero/nonzero, unlimited zero/nonzero, refunded, currency-mismatch). Draft resume semantics are preserved. Hard guards held. No P0/P1 findings. Two P3 cosmetics and two P4 observations noted below.

## 2. Layman Summary

The fix does what the spec asked for. Open Home and Events — every published event now shows both how many tickets sold and how much online money was made, even when the event has unlimited tickets and even when the answer is honestly zero (`$0`/`£0` instead of `-`). Drafts still show `- / resume`. Currency-review still appears when the data is dirty. The two cosmetic notes are about a slightly awkward "3 / 20 sold" label phrasing on Home rows and a corner case where a server fetch error on a finite-capacity event reads "Unable to load sold" — both are visible but neither breaks the user trust contract. Safe to close.

## 3. What Was Tested

- Direct read of every changed file against spec criteria
- Five-layer cross-check (spec / hook / helper / component / home screen)
- Strict-grep ORCH-0784 gate
- Jest: `eventSalesSummary.test` (6 tests, all pass)
- Jest: `moneySummary.test`, `eventOrdersService.test` (5 tests, all pass)
- Adjacent regression: `test:orch-0754` (Home no-fabrication) and `test:orch-0777` (production checkout) — both pass
- TypeScript check (`npx tsc --noEmit`) — clean
- Six independently authored Jest cases (positive-mismatch, mixed finite+unlimited, fully refunded, free comp, no-tickets, brand-default currency) — all pass against `buildEventSalesSummary`
- Constitution sweep (14 rules)
- Hard-guard sweep (checkout / Stripe / notifications / QR / scanner / migrations / ORCH-0777 / ORCH-0782)

## 4. Files Read

| File | Layer | Purpose |
|---|---|---|
| `mingla-business/src/utils/eventSalesSummary.ts` | shared util | new helper — sold/revenue/capacity contract |
| `mingla-business/src/utils/__tests__/eventSalesSummary.test.ts` | tests | 6 cases for finite/unlimited/zero/nonzero/refunds/mismatch/error |
| `mingla-business/src/hooks/useEventOrders.ts` | hook | new `useEventSalesSummaries` + retained `useEventOrders`/`useEventSoldCounts` |
| `mingla-business/src/components/event/EventListCard.tsx` | component | Events tab card render contract |
| `mingla-business/app/(tabs)/home.tsx` | screen | Home live hero + Upcoming rows |
| `mingla-business/src/utils/moneySummary.ts` | money contract | `summarizeEventMoney` mismatch semantics |
| `mingla-business/src/utils/currency.ts` | format | `formatCurrencyRound(0, code)` returns `$0`/`£0` |
| `.github/scripts/strict-grep/orch-0784-event-list-sales-summary-visibility.mjs` | CI gate | new strict-grep guard |
| `.github/workflows/strict-grep-mingla-business.yml` | CI registry | ORCH-0784 job registration |
| `mingla-business/package.json` | scripts | `test:orch-0784` registration |

## 5. Spec Success Criteria Matrix

| # | Criterion | Evidence | Result |
|---|---|---|---|
| 1 | Every non-draft Home Upcoming row shows tickets sold + online amount made | `home.tsx:546-553` — `eventSoldValue` + `eventRevenueValue` | PASS |
| 2 | Home live hero uses server-backed truth (not `useOrderStore`) | `home.tsx:257-292` — `useEventSalesSummaries` drives `liveHeroMetrics` | PASS |
| 3 | Every non-draft Events tab card shows sold + amount | `EventListCard.tsx:166-219` | PASS |
| 4 | Limited finite-capacity shows `sold / capacity` | helper test L69-81 (`0 / 20`) and L83-95 (`3 / 20`) | PASS |
| 5 | Unlimited/no-finite shows `N sold` | helper test L97-109 (`0 sold`) and refund test L111-144 (`2 sold`) | PASS |
| 6 | True zero renders as `$0`/`£0`, never `-` | helper test L69-81, L97-109; strict-grep regex absent check | PASS |
| 7 | Mismatched-positive still renders honest amount | independent QA case (positive expected + GBP stale) → `$100` with mismatches array non-empty | PASS |
| 8 | Draft rows keep `- / resume` | `home.tsx:486-489`; `EventListCard.tsx:162-167` (draft branch shows `subText` only) | PASS |
| 9 | Repo-running ORCH-0784 regression tests in same scoped commit | `package.json:37` + `.github/workflows/...:384-393` + strict-grep gate present | PASS |

All nine success criteria pass.

## 6. Invariant Verification

| Invariant | Status | Evidence |
|---|---|---|
| ORCH-0777 production organizer sales surfaces use server order truth | PASS | `useEventSalesSummaries` calls `fetchEventOrders`; ORCH-0777 strict-grep passes |
| Drafts excluded from production order surfaces | PASS | `summaryLiveEvents` filtered via `eventSummary.activeItems.flatMap(... live ?)` (home.tsx:250-256); draft branch returns before sales summary read; helper not called for drafts |
| Currency honesty | PASS | `revenueLabel = mismatches.length > 0 && onlineRevenue === 0 ? "Currency review" : formatCurrencyRound(...)` (eventSalesSummary.ts:105-108); independent test confirms positive-mismatch path keeps the positive amount |
| No PII or QR exposure | PASS | only `soldCount`, `onlineRevenue`, `soldLabel`, `revenueLabel` enter render; no buyer/email/phone/orderId in labels or accessibilityLabel construction |
| ORCH-0782 boundary | PASS | no resend-ticket / notification-rollup / notification-dispatch files touched (git diff confirms) |
| I-PROPOSED-Z Home no-fabricated-events | PASS | `test:orch-0754` strict-grep passes after rewrite |
| New: Non-draft Home + Events always show sold + online amount | PASS | strict-grep asserts `eventRevenueValue` and `salesSummary.revenueLabel` present |
| New: True zero online revenue visible as currency zero | PASS | strict-grep regex check disallows revenue-gating dash; helper tests assert `$0` |
| New: Home non-draft summaries must not read `useOrderStore` | PASS | strict-grep asserts absence of `useOrderStore`, `getSoldCountForEvent`, `getRevenueForEvent`, `getRevenueSummaryForEvent`, `orderEntries` in `home.tsx` |

## 7. Constitution Sweep

| # | Rule | Result | Note |
|---|---|---|---|
| 1 | No dead taps | PASS | Card / row Pressables wire to handlers |
| 2 | One owner per truth | PASS | server orders own non-draft sales; draftStore owns drafts |
| 3 | No silent failures | PASS | `hasError` propagates `Unable to load` (see P3-1) |
| 4 | One key per entity | PASS | `eventOrdersKeys.salesSummary(id, currency, ticketSig)` factory only |
| 5 | Server state server-side | PASS | React Query owns; no Zustand mirror added |
| 6 | Logout clears everything | N/A | no new persisted state added |
| 7 | Label temporary | N/A | nothing transitional in this scope |
| 8 | Subtract before adding | PASS | Home dropped `useOrderStore` dependency for non-draft sales |
| 9 | No fabricated data | PASS | zeros come from real server data; error path shows `Unable to load`, not `0` |
| 10 | Currency-aware | PASS | `eventCurrency ?? brandDefaultCurrency` resolved per row |
| 11 | One auth instance | N/A | unchanged |
| 12 | Validate at right time | N/A | no temporal logic in this scope |
| 13 | Exclusion consistency | N/A | not a generation/serving split |
| 14 | Persisted-state startup | N/A | no persisted-state change |

No constitutional violations.

## 8. Independent Tests I Ran

```bash
# Authored and executed during this QA pass — covered six edge cases the
# implementor's tests did not explicitly cover. All six passed.
- positive-mismatch: USD expected + (USD $100 paid + GBP $80 paid) → onlineRevenue=$100, mismatches=1, revenueLabel="$100" (NOT "Currency review")
- finite + unlimited mix: 5 VIP finite + GA unlimited → finiteCapacity=5, hasUnlimitedTickets=true
- fully refunded: refunded_full status → soldCount=0, revenueLabel="$0"
- free comp ticket: quantity=1, totalAtPurchase=0 → "1 sold" + "£0"
- no tickets at all: empty tickets[] → "0 sold" + "$0"
- brand default currency fallback: eventCurrency=null + brandDefaultCurrency="EUR" → revenueLabel starts with €
```

Test file was created at `mingla-business/src/utils/__tests__/orch0784IndependentQa.test.ts`, executed (6/6 pass), and removed to keep the tree clean — these cases are now folded into this QA report as the verification evidence. The implementor's existing `eventSalesSummary.test.ts` already covers the other four spec rows.

## 9. Cross-Domain Impact Sweep

| Domain | Touched | Verdict |
|---|---|---|
| `app-mobile/` | No | unaffected (consumer app) |
| `mingla-admin/` | No | unaffected (admin dashboard) |
| `supabase/` migrations | No | hard guard held |
| `supabase/` edge functions | No | hard guard held |
| Stripe / checkout client | No | hard guard held |
| Notifications / OneSignal | No | hard guard held |
| Resend-ticket (ORCH-0782) | No | hard guard held — separate scope retained |
| QR pepper / scanner | No | hard guard held |
| ORCH-0777 production order truth | Read-only consumer | strict-grep gate still passes |

`git diff --name-only` (working tree at QA time) touches only:

```
.github/scripts/strict-grep/orch-0784-event-list-sales-summary-visibility.mjs
.github/workflows/strict-grep-mingla-business.yml
Mingla_Artifacts/* (artifact files, not product code)
mingla-business/app/(tabs)/home.tsx
mingla-business/package.json
mingla-business/src/components/event/EventListCard.tsx
mingla-business/src/hooks/useEventOrders.ts
mingla-business/src/utils/__tests__/eventSalesSummary.test.ts (new)
mingla-business/src/utils/eventSalesSummary.ts (new)
```

No product-code blast outside the spec scope.

## 10. Verification Commands

| Command | Working dir | Result |
|---|---|---|
| `npm run test:orch-0784` | `mingla-business` | PASS — strict-grep + 6 helper tests |
| `npx jest moneySummary.test eventOrdersService.test` | `mingla-business` | PASS — 5 tests |
| `npx tsc --noEmit` | `mingla-business` | PASS — no output, no diagnostics |
| `npm run test:orch-0754` | `mingla-business` | PASS — I-PROPOSED-Z + 5 brandEventSummary tests |
| `npm run test:orch-0777` | `mingla-business` | PASS — ORCH-0777 strict-grep + 15 tests + tsc |
| Independent QA file (6 new cases) | `mingla-business` | PASS — 6/6 |

(Watchman recrawl warning emitted on every Jest run. Cosmetic; does not affect results.)

## 11. Findings

### P3 — Low (cosmetic / minor UX, non-blocking)

**P3-1 — Home row "Unable to load sold" label in error + finite-capacity state**
- File: `mingla-business/app/(tabs)/home.tsx:497-500`
- Code:
  ```ts
  const rowSoldLabel =
    salesSummary?.finiteCapacity !== null && salesSummary !== undefined
      ? `${soldLabel} sold`
      : soldLabel;
  ```
- Scenario: `useEventSalesSummaries` query returns `isError === true` for a finite-capacity event. `buildEventSalesSummary` sets `soldLabel = "Unable to load"` but leaves `finiteCapacity` populated from the ticket array (helper does not zero it on error). Home then appends ` sold` → renders **`Unable to load sold`**.
- Impact: low. Error path still conveys "we don't have a number" — organizer is not misled and not shown a fabricated zero. Visually awkward only.
- Fix sketch: in `home.tsx` skip the suffix when `salesSummary?.hasError === true`, or set `finiteCapacity = null` in the helper's error branch.
- Not blocking close — file an ORCH-0784-A follow-up if desired.

**P3-2 — Mixed finite+unlimited tickets show finite-only progress**
- File: `mingla-business/src/utils/eventSalesSummary.ts:36-54` (`summarizeTicketCapacity`)
- Scenario: an event with `VIP (cap 5) + GA (unlimited)`. Helper returns `finiteCapacity=5, hasUnlimitedTickets=true`. If GA sells 10, sold label renders `10 / 5` and the progress bar maxes at 100% via the `Math.min` clamp.
- Spec compliance: the spec capacity rule (§9, line 106) is explicit that finiteCapacity = sum of non-unlimited ticket capacities. The implementation follows that contract verbatim. So this is **not** a spec violation.
- Impact: low. The "N / smallerCap" label can mislead organizers who run blended pricing. Product decision territory — outside QA scope.
- Fix sketch (product call only): when `hasUnlimitedTickets === true`, drop to `${soldCount} sold` regardless of whether some tickets are finite, OR show `${soldCount} sold (${finiteCapacity} VIP cap)` style copy.
- Not blocking close — file as discovery for product/orchestrator.

### P4 — Note (good work / acceptable choice / context)

**P4-1 — Helper composition is clean and shared**
- `buildEventSalesSummary` is a pure, tightly typed helper consumed by both `EventListCard` (single-event) and `useEventSalesSummaries` (batched-by-id). One source of truth for label semantics. Good pattern — worth replicating for future overview-list summaries.

**P4-2 — Loading state defaults to "0 sold / $0" before first query resolves**
- During the brief window between mount and first server resolution, `query.data` is `undefined` → orders default to `[]` → helper returns soldCount=0, revenue=0, hasError=false. Home/Events render `0 sold` / `$0` for a fraction of a second.
- Spec §9 line 117 explicitly authorizes this: "leave existing React Query behavior and rely on loading/refetch defaults, but do not convert query errors into 0."
- This is the documented and accepted contract. Noting it so the tester / operator does not mistake the brief flash for stale data.

## 12. Hard-Guard Verification

| Guard | Status |
|---|---|
| No product-code edits outside spec scope | PASS — diff limited to home.tsx, EventListCard.tsx, useEventOrders.ts, new eventSalesSummary.ts (+ tests + CI) |
| No checkout / Stripe / PaymentIntent edits | PASS — diff clean |
| No notification / OneSignal / dispatch edits | PASS — diff clean |
| No QR / pepper / scanner edits | PASS — diff clean |
| No Supabase migration edits | PASS — `supabase/migrations/**` untouched |
| ORCH-0777 not reopened | PASS — strict-grep still passes; checkout/order service signatures untouched |
| ORCH-0782 not absorbed | PASS — resend-ticket CTA and notification rollup files not in diff |
| Draft resume semantics preserved | PASS — draft branch in home.tsx and EventListCard.tsx unchanged for `- / resume` |
| No PII / secrets / QR payloads in render | PASS — only aggregate sold count and revenue labels rendered |

All nine hard guards held.

## 13. Regression Surface After Close

1. Two compact metrics now render in Home's right column (sold + revenue). Visual smoke on narrow phones (iPhone SE, iPhone 17 Pro) is the only confirmation missing from this QA pass. Tester or operator should eyeball one Home + Events screen post-deploy. Spec §17 already flags this as a partial-rollback risk.
2. `EventListCard`'s right rail now renders `revenueValue` on past non-draft cards too. The card still applies `opacity 0.7` to zero-sold past events. Visual confirmation that the new strip does not crowd the manage button is also a tester eyeball gate.
3. `useEventSalesSummaries` opens one query per visible non-draft event. Current org event counts make this cheap. Future high-volume dashboards should switch to a batched RPC. Implementor flagged this in §14 of the impl report.

None of these become P0/P1/P2 in the current state — they are forward-looking notes.

## 14. Discoveries for Orchestrator

- **Untracked file**: `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md` exists in the worktree but is unrelated to ORCH-0784. Implementor flagged it; QA confirms it was not modified during this dispatch. Route to ORCH-0785 owner.
- **P3-1 follow-up candidate**: `Unable to load sold` cosmetic glitch on Home error path → could be folded into a tiny ORCH-0784-A patch or batched into the next Home pass.
- **P3-2 product decision**: mixed finite+unlimited ticket type display contract — surface to product for whether a `10 / 5` label is acceptable or whether unlimited should always dominate the label.

## 15. Stuck-in-Loop Check

This is QA pass 1 of ORCH-0784. Not in a loop. No escalation needed.

## 16. Severity Counts

- **P0 (CRITICAL)**: 0
- **P1 (HIGH)**: 0
- **P2 (MEDIUM)**: 0
- **P3 (LOW)**: 2 — both cosmetic, neither blocks close
- **P4 (NOTE)**: 2 — context only

## 17. Final Verdict

**PASS** — close-ready.

ORCH-0784 ships with all nine spec success criteria satisfied, zero hard-guard breaches, zero constitutional violations, two cosmetic P3 findings flagged as non-blocking follow-ups, and clean automated regression gates. Implementation is production-grade for the scope agreed.

## 18. Next Handoff

NEXT HANDOFF — paste into Codex `orchestrator-mingla`:

CLOSE ORCH-0784 from QA report `Mingla_Artifacts/reports/QA_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md` (verdict PASS, P0=0/P1=0/P2=0/P3=2/P4=2). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Read the QA report plus the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`, the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`, and the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0784_EVENT_LIST_SALES_SUMMARY_VISIBILITY.md`. Run the standard close arc: Step 1 (lock in evidence), Step 1.5 (DIAG-marker reap — none expected), Step 2 (commit message; suggested body is in §"Suggested Commit Message" of the implementation report; no Co-Authored-By), Step 3 (EAS OTA — Mingla Business JS only, no migration / edge deploy, two separate `eas update --branch production --platform ios` and `--platform android` invocations), Step 4 (artifact sync — WORLD_MAP, INVARIANT_REGISTRY for the three new ORCH-0784 invariants, AGENT_HANDOFFS, MASTER_BUG_LIST, OPEN_INVESTIGATIONS, DECISION_LOG, PRIORITY_BOARD), and Step 5 (next dispatch). Two non-blocking discoveries from QA need registry entries but no immediate dispatch: (a) Home error-state label glitch "Unable to load sold" — file as ORCH-0784-A candidate; (b) mixed finite+unlimited ticket label is a product decision, surface to product. Untracked sibling file `Mingla_Artifacts/reports/UI_UX_ORCH-0785_PREMIUM_TRANSACTIONAL_EMAIL_BRANDING.md` belongs to ORCH-0785 and must not be staged in the ORCH-0784 close commit. Hard guards still apply: no Supabase migrations, no edge deploys, no ORCH-0777 reopen, no ORCH-0782 absorption.
