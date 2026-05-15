# QA — ORCH-0829-A + ORCH-0829-B Combined Verdict

**Mode:** TEST (TARGETED)
**Tester:** Claude `mingla-tester`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Specs:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0829-A_CHECKOUT_CONFIRM_AND_CALENDAR.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md`
**Implementation reports:**
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-A_CHECKOUT_CONFIRM_AND_CALENDAR.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829_CHECKOUT_FLOW_BUGS_FREE_CALENDAR_STRIPE.md`
**Sim:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6`, app `com.mingla.app.v2`, Metro `:8084`

---

## LAYMAN SUMMARY

The implementation is mostly correct and the confirmation modal works beautifully. **But one P0 blocks the Calendar tab from showing business-event tickets:** the consumer's database role is missing `SELECT` permission on the `tickets` table, so the query that powers the Calendar's new "Tickets" section dies with `permission denied for table tickets`. This is a one-line SQL migration the user needs to apply (`GRANT SELECT ON public.tickets TO authenticated;`). It is NOT a code defect in the implementation — the implementor's calendar query is correct and the RLS *policy* on tickets is correct; what's missing is the table-level GRANT that PostgreSQL checks BEFORE evaluating RLS. The implementation work itself is high quality.

Three of the most critical tests PASSed on live-fire (free confirmation modal opens with correct buyer info, Cancel actually does NOT create an order verified via DB, Confirm DOES create an order verified via DB count 2→3). The Calendar test FAILED on the P0 above. Stripe paid-flow tests (T-04, T-06–T-07) NOT YET EXERCISED — would require a successful test-card payment; orthogonal to the P0.

**Verdict: FAIL** — one P0 blocks the calendar surface that's a primary deliverable of -A.

---

## Verdict: FAIL

| Severity | Count |
|---|---|
| P0 — CRITICAL | **1** |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 1 |
| P4 — NOTE | 3 |

---

## P0 Finding — `GRANT SELECT ON public.tickets TO authenticated` is missing

**File / Layer:** Database schema (NOT in app code)
**Severity:** P0 (Bug Y fix is non-functional in production)
**Evidence:**

1. Live-fire screenshot `Mingla_Artifacts/reports/orch-0829-qa/11_calendar.png` shows Calendar tab with empty Active(0) + Archives(0) AND a red error banner at bottom: `[QUERY] ERROR businessEventOrders.c727…`
2. Metro log `/private/tmp/claude-501/.../tasks/bii9x3noq.output:2941`:
   ```
   ERROR  [QUERY] ERROR businessEventOrders.c727d491-4884-4e72-b467-d6c124b9a8b9 | undefined: permission denied for table tickets
   ```
3. Metro log `:2953`:
   ```
   ERROR  [CalendarService] fetchUserBusinessEventOrders error: {"code": "42501", "details": null, "hint": null, "message": "permission denied for table tickets"}
   ```
4. DB probe via Supabase Management API confirms authenticated grants on `tickets`:
   ```
   anon: DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE
   authenticated: DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE
   postgres + service_role: all including SELECT
   ```
   **`SELECT` is granted to `postgres` and `service_role` only. NOT to `authenticated`.**
5. Comparison probe — same authenticated role HAS `SELECT` on `orders`, `events`, `event_dates`, `brands` (all the other tables in the same query). Only `tickets` lacks it.

**What's happening:** PostgreSQL evaluates table-level GRANTs BEFORE RLS row-level policies. The RLS policy "Buyer or brand team can select tickets" exists and would PASS for the consumer's own tickets (the EXISTS subquery on `orders.buyer_user_id = auth.uid()` is correct). But that policy never gets evaluated because the SELECT privilege is denied first. Error code 42501 (insufficient_privilege) is the proof.

**Causal chain:**
1. Operator taps Calendar tab
2. `useBusinessEventOrders(user.id)` query fires
3. `CalendarService.fetchUserBusinessEventOrders` calls Supabase via the authenticated user session
4. PostgREST translates to `SELECT … FROM orders … LEFT JOIN tickets ON …`
5. PostgreSQL checks GRANTs: SELECT denied on `tickets` for authenticated role
6. Throws `permission denied for table tickets` (42501)
7. `CalendarService` re-throws, React Query reports `[QUERY] ERROR businessEventOrders`
8. Calendar UI shows empty + visible red error banner

**Fix (NOT applied by tester — see discipline rule #13):**
A new migration file at `supabase/migrations/<monotonic-prefix>_orch_0829a_tickets_select_grant.sql`:

```sql
-- ORCH-0829-A: grant SELECT on public.tickets to the authenticated role
-- so consumer buyers can read their own tickets via the RLS policy
-- "Buyer or brand team can select tickets" (which already exists but
-- was unreachable due to missing table-level GRANT).
GRANT SELECT ON public.tickets TO authenticated;
```

Migration filename must use a timestamp prefix strictly greater than the current maximum prefix in `supabase/migrations/`. Operator runs `supabase db push` to apply.

**Verification step after fix:**
Re-run T-05 in this report. Calendar tab should show the just-claimed Big Party ticket in a new "Tickets" section above Active.

---

## Per-Spec Criterion Results

### ORCH-0829-A criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| C1 | Confirmation modal opens within 200ms with ticket name, "Free" price, buyer info | **PASS** | Screenshot `08_after_getfree_coord.png` — modal shows "The Free Ticket", "Free", Marcus Rivera, sethogieva@icloud.com, +19843822876 |
| C2 | Confirm fires `handleBuy` → toast | **PASS** | DB probe: orders count 2 → 3 after Confirm tap (screenshot `10_after_claim.png`, toast not captured in screenshot timing but order creation proves the flow executed) |
| C3 | Cancel does NOT create order | **PASS** | DB probe: orders count unchanged at 2 after Cancel tap (`09_after_cancel.png` + DB count) |
| C4 | Paid ticket → confirmation modal with formatted price + "Continue to Payment" | NOT EXERCISED | Free path proved the modal mechanism; paid path is the same code with different inputs (T-A5 source contract). Strictly orthogonal to P0. |
| C5 | Calendar shows business-event ticket within 5s (free) / 10s (paid) | **FAIL — P0 blocks** | `11_calendar.png` shows empty Calendar + visible "[QUERY] ERROR businessEventOrders" banner |
| C6 | Pre-existing calendar entries continue to render | PASS (no regression) | Calendar shows Active(0) and Archives(0) cleanly — implies legacy flow untouched. (Account has zero scheduled-saved-cards entries to render either way.) |
| C7 | Sort by `scheduledAt` desc | NOT TESTABLE (P0 blocks rendering business events) | — |
| C8 | Signed-out → no Supabase call | PASS by source contract (hook config) — `enabled: !!userId` + queryFn early-returns `[]`. | Source review |
| C9 | Regression check 100% | **PASS** | `npm run test:orch-0829a` → 15/15 PASS |
| C10 | `tsc --noEmit` clean on touched files | **PASS** | No errors in touched files (pre-existing unrelated errors only) |

ORCH-0829-A summary: 5 PASS, 1 FAIL (P0), 2 NOT EXERCISED (orthogonal), 2 NOT TESTABLE (blocked by P0).

### ORCH-0829-B criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| C1 | PaymentSheet opens within 800ms | NOT EXERCISED | Free path tested; paid path orthogonal to P0 and would require Stripe test-card login state |
| C2 | Successful payment with test card → no error banner | NOT EXERCISED | Same |
| C3 | Cancel path → no error banner | NOT EXERCISED | Same |
| C4 | Declined card → error toast, no double-resolve banner | NOT EXERCISED | Same |
| C5 | Metro log exactly ONE `→ native call` + ONE `← resolved` per tap | NOT EXERCISED | Would require paid checkout |
| C6 | Synthetic double-invoke shows "already in flight" log | NOT EXERCISED | Would require diagnostic harness |
| C7 | No `returnURL` warning in Metro log | NOT TESTABLE (pre-fix warning at log line 2369 persists from earlier bundle; post-fix bundle has not been exercised via paid path) | Pre-existing log line 2369 |
| C8 | Matrix populated ≥3 SDK versions | ACCEPTED-DEFERRED per spec policy + operator decision | Matrix documented in IMPLEMENTATION report with 0.50.3 + 0.51.0 + 0.65.1 verdicts and remaining versions explicitly marked DEFERRED |
| C9 | Regression check 100% | **PASS** | `npm run test:orch-0829b` → 6/6 PASS |
| C10 | `tsc --noEmit` clean | **PASS** | Pre-existing structural noise only (packages/ react types) |

ORCH-0829-B summary: 2 PASS, 0 FAIL, 1 ACCEPTED-DEFERRED, 1 NOT TESTABLE (depends on paid path live-fire), 6 NOT EXERCISED. **-B is not blocked by the -A P0** — once the GRANT is added and live-fire continues, -B's PaymentSheet path can be exercised with a Stripe test card.

---

## What WAS Verified on Live-Fire

| Test | Description | Result | Screenshot |
|---|---|---|---|
| T-01 | Free tap → confirm modal opens | PASS | 08_after_getfree_coord.png |
| T-02 | Confirm → order created (DB 2→3) | PASS | 10_after_claim.png + DB probe |
| T-03 | Cancel → no order created (DB unchanged) | PASS | 09_after_cancel.png + DB probe |
| Sheet open | ORCH-0828 REWORK regression check (Big Party tap → sheet at 90% snap) | PASS | 06_after_bigparty_tap.png + Metro logs |
| Tonight filter | ORCH-0828 REWORK regression check | PASS | 04_tonight.png |
| Service log | searchMerged body includes timezone + localStartEndDateTime + segmentSlug | PASS | Metro log line 2363 |

---

## Constitution Check (14 Rules)

| # | Rule | Status | Notes |
|---|---|---|---|
| 1 | No dead taps | PASS | Confirmation modal gives user agency |
| 2 | One owner per truth | PASS | Each calendar source has one owner |
| 3 | No silent failures | **PARTIAL FAIL related to P0** | The 42501 error fires visibly via Sentry-style banner — Constitution is preserved (error is NOT silent), but the broken state IS user-visible. Restoring the GRANT eliminates the error. |
| 4 | One key per entity | PASS | `["businessEventOrders", userId]` matches throughout |
| 5 | Server state server-side | PASS | React Query for both sources |
| 6 | Logout clears | N/A |
| 7 | Label temporary | N/A |
| 8 | Subtract before adding | PASS |
| 9 | No fabricated data | PASS — Calendar correctly shows EMPTY when query fails (does not fabricate tickets) |
| 10 | Currency-aware | PASS — `Intl.NumberFormat` with event's currency in confirmation modal |
| 11 | One auth instance | PASS |
| 12 | Validate at right time | PASS — timezone-aware date format |
| 13 | Exclusion consistency | PASS |
| 14 | Persisted-state startup | N/A |

---

## Discoveries for Orchestrator

1. **P3 — `Get free ticket` button text not found in accessibility tree.** Maestro `tapOn: "Get free ticket"` failed with "Element not found"; had to fall back to coordinate tap `20%,88%`. The button is a `Pressable` from the shared `@mingla/event-rendering` `PublicEventPage`. Add `accessibilityLabel="Get free ticket"` on the Pressable for both UX (VoiceOver) and test-automation reasons. Sibling P3 ORCH.

2. **P4 — ORCH-0828 REWORK regression PASSED in this same session.** Live-fire confirms Tonight filter shows Big Party (was the original Bug A in ORCH-0828); inline `<BottomSheet>` opens cleanly at 90% snap (Bug B); service log includes the new diagnostic fields. **ORCH-0828 REWORK can close once ORCH-0829-A's P0 is fixed.**

3. **P4 — Order creation flow E2E works.** From confirmation modal Confirm tap → `runNativeCheckout` → `ticket-checkout-create` edge function → `orders.payment_status='paid'` row visible in DB within 1-2s. The free-ticket finalize path is solid (no Stripe involved).

4. **P4 — Cache staleness symptom (H1 from brutal-retest) reproduced once.** On initial cold-load, the "All" filter showed only Ticketmaster cards (no Big Party). Tapping Tonight then back to All restored Big Party. This is the known `nightOutCache` Hidden Flaw H1 — sibling ORCH already documented in the brutal-retest investigation §9 N1.

---

## Recommended Next Step

Operator runs `supabase db push` after the implementor adds the missing migration:

```sql
-- File: supabase/migrations/<MAX_PREFIX+1>_orch_0829a_tickets_select_grant.sql
GRANT SELECT ON public.tickets TO authenticated;
```

Then a single-criterion retest (T-05 + verify error banner gone) and the verdict flips to PASS. The other deferred criteria (T-04 paid modal, T-06–T-09 Stripe paid flow) can be exercised in the same retest pass since they're independent of the GRANT.

This is a 5-minute implementor fix + 5-minute operator DB push + 10-minute live-fire retest. ORCH-0829-A + ORCH-0829-B + ORCH-0828 can all close in the same window.

---

## Live-fire Artifacts

All under `Mingla_Artifacts/reports/orch-0829-qa/`:
- `01_post_restart.png` — Explore tab after cold restart
- `02_discover_landing.png` — Discover after Maestro tap (sim home screen — Maestro coord miss)
- `03_relaunched.png` — Discover loaded with All chip (no Big Party — cache staleness P4)
- `04_tonight.png` — Tonight chip → Big Party visible (ORCH-0828 REWORK confirmed live)
- `05_bigparty_tapped.png` — All chip toggle (Maestro coord miss)
- `06_after_bigparty_tap.png` — Business sheet open at 90% snap with PublicEventPage content (Big Party, Leggo This, About, Tickets)
- `07_after_getfree_tap.png` — Pre-tap state (text-based tapOn failed)
- `08_after_getfree_coord.png` — **Confirmation modal open** with "The Free Ticket / Free / Name + Email + Phone / Claim Free Ticket"
- `09_after_cancel.png` — Modal dismissed, sheet still open (T-03)
- `10_after_claim.png` — Sheet closed back to Discover (T-02)
- `11_calendar.png` — **Calendar empty + red error banner (P0 evidence)**
- `12_paid_visible.png` — Likes/Calendar tab (paid path NOT exercised; P0 still visible)

---

## End-state

ORCH-0829-A: code complete; ONE migration required to make Bug Y fix functional in production.
ORCH-0829-B: code complete; paid path requires retest after -A's GRANT lands.
ORCH-0828: still frozen pending checkout flow PASS (per operator's earlier freeze decision); REWORK code confirmed working in live-fire this session.

End of report.
