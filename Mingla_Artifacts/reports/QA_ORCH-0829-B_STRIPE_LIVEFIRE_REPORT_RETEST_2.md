# QA RETEST_2 — ORCH-0829-B Stripe PaymentSheet live-fire

**Mode:** TEST (RETEST_2 — targeted live-fire after RETEST_1 CONDITIONAL PASS)
**Tester:** Claude `mingla-tester`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md`
**Prior QA (CONDITIONAL PASS):** `Mingla_Artifacts/reports/QA_ORCH-0829_CHECKOUT_FLOW_REPORT_RETEST_1.md`
**Sim:** iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6`, app `com.mingla.app.v2`, Metro `:8084`
**Test user:** `c727d491-4884-4e72-b467-d6c124b9a8b9` (Marcus Rivera)
**Test event:** `549e0a64-c133-43c3-ac1c-1ecc6055c992` (Big Party / Leggo This brand)
**Test ticket:** `01368e22-e559-4e9d-8a16-0b73825879f3` (The Paid Tickets — $250 USD)

---

## LAYMAN SUMMARY

The defensive JS once-only guard (the actual code change in -B) appears to work — across three live-fire attempts on a real $250 paid ticket, I never saw the "Tried to resolve a promise more than once" red banner that the operator originally reported. **But the user-visible bug is NOT fixed.** What I saw instead, three times in a row, is: tap "Continue to Payment" → confirmation modal dismisses → a white loading sheet (Stripe's PaymentSheet skeleton) slides up → spinner spins for ~90 seconds → sheet silently dismisses back to the event detail with NO toast, NO error, NO success indicator, and NO order ever created in the database. The user gets zero feedback that anything happened. This is arguably WORSE UX than the original bug because at least the red banner told them something failed.

The guard met its narrow technical contract (suppress the cosmetic second-resolution banner) but did not — and structurally cannot — fix the underlying Stripe RN 0.50.3 + iOS 26 PaymentSheet hang. The real fix is the SDK upgrade matrix evaluation that spec §3.4 deferred. **I never got far enough to enter test card details** (4242 4242 4242 4242), because the card-entry form never appeared — only the loading spinner.

---

## Verdict: **FAIL**

The guard ships as designed (regression contracts 6/6 PASS, source verified). The user-facing spec criteria C1 (opens within 800ms — the loading skeleton appears, but the actual card form never renders) and C2 (successful payment → no banner — payment never completes, so "no banner" is vacuously true) and C3/C4 (cancel / decline paths require the form to render first) are NOT satisfied. The implementation report flagged C1–C7 as UNVERIFIED pending sim live-fire; live-fire now shows they FAIL.

| Severity | Count |
|---|---|
| P0 — CRITICAL | **1** |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 0 |
| P4 — NOTE | 3 |

---

## Live-Fire Attempts

### Attempt 1 (timestamp ~04:59–05:03)

| Step | Method | Result | Screenshot |
|---|---|---|---|
| Discover → Tonight filter active, Big Party visible | already in state from prior RETEST_1 session | OK | `00_baseline.png` |
| Tap Big Party card | Maestro `tapOn: point: "30%,25%"` (text tap missed) | Sheet opens to Big Party detail | `02_after_tap.png` |
| Scroll sheet to find paid ticket | Maestro 2× swipe up | "The Paid Tickets — $250" visible | `03_scrolled.png` |
| Tap "Buy ticket" on paid row | Maestro `tapOn: point: "18%,87%"` (text tap missed — two "Buy ticket"-like targets) | Confirmation modal renders correctly: "The Paid Tickets", "$250.00", buyer info, disclosure, Cancel + Continue to Payment | `04_confirm_modal.png` not captured (re-taken in attempt 2 as 12_) |
| Tap "Continue to Payment" | Maestro text-match | Confirmation modal dismisses; **white sheet with X button + spinner slides up** | `06_stripe_sheet.png` |
| Wait 4s | passive | Still white sheet + spinner, no change | `07_stripe_loaded.png` |
| Wait 12s total | passive | Still loading | `08_stripe_after_12s.png` |
| Wait 31s total | passive | Still loading | `09_stripe_after_31s.png` |
| Wait until 5:06 (~3 min) | passive | **Sheet silently dismissed; back to Big Party detail. No error, no toast, no banner.** | `10_stripe_check_still_loading.png` |

### Attempt 2 (timestamp ~05:09–05:10)

| Step | Method | Result |
|---|---|---|
| Reset to Discover by swiping down twice | Maestro | OK |
| Re-trigger flow to confirmation modal | Maestro point taps | Modal renders correctly | `12_confirm_modal_2.png` |
| Tap Continue via point (65%,73%) | Maestro `tapOn: point: "65%,73%"` | **Modal dismisses but NO Stripe sheet ever appears**. Just back to Big Party detail at t+1s, t+3s, t+10s. | `13_continue_t1s.png`, `13_continue_t3s.png`, `13_continue_t10s.png` |

DB probe after Attempt 2:
```
function_edge_logs query for ticket-checkout-create (last 5 min): count: 0
ticket_checkout_sessions (last 5 min): []
```
→ The edge function was NEVER called. Point coord 65%,73% must have hit the modal scrim and triggered dismiss-on-backdrop-tap, NOT the Continue button. Attempt 2 invalid.

### Attempt 3 (timestamp ~05:12–05:15) — ⭐ DEFINITIVE EVIDENCE

| Step | Method | Result |
|---|---|---|
| Reset to Discover | Maestro swipe-down | OK | `14_reset_for_attempt3.png` |
| Re-trigger flow to confirmation modal | Maestro point taps | Modal renders | (not separately captured) |
| Tap Continue via text-match | Maestro `tapOn: "Continue to Payment"` | Confirmation modal dismisses, white loading sheet slides up | `15_attempt3_t0s.png`, `_t1s.png`, `_t2s.png`, `_t3s.png` |
| Wait 5s | passive | Still loading | `15_attempt3_t5s.png` |
| Wait 8s | passive | Still loading | `15_attempt3_t8s.png` |
| Wait 38s | passive | Still loading | `16_attempt3_t38s.png` |
| Wait 68s | passive | Still loading | `17_attempt3_t68s.png` |
| Wait 98s | passive | **Sheet self-dismissed silently; back to Big Party detail. NO red banner, NO toast, NO error indication of any kind.** | `18_attempt3_t98s.png` |

DB probe after Attempt 3:
```
function_edge_logs query for ticket-checkout-create (last 5 min): count: 1
  timestamp 1778749959786000 | POST | 200 | https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/ticket-checkout-create
ticket_checkout_sessions (last 15 min, ANY event): []
orders for Big Party + this user (last 60 min): 1 row (the FREE order from earlier, total_cents=0, no stripe_payment_intent_id) — no new paid order
tickets for user + Big Party: 3 (unchanged — same as RETEST_1)
```

→ Edge function WAS called once, returned HTTP 200, but inserted NO `ticket_checkout_sessions` row. Either the function path that returns 200 also has a code path that bypasses the insert, OR the function rolled back after some downstream failure (e.g., Stripe PaymentIntent creation), OR the response body contained an error that the JS layer treated as failure. Without function-level logs (Supabase analytics endpoint returned 500 on the JOIN query for `execution_time_ms`), I cannot isolate which. **Sibling Discovery for Orchestrator D-1.**

---

## Per-Criterion Result Matrix (against spec §6)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| C1 | PaymentSheet opens within 800ms | **FAIL** | Loading skeleton appears within ~1s, but the actual card-entry form NEVER renders across 90+ seconds. The "opens" criterion is the form, not the skeleton. |
| C2 | Successful payment with test card 4242 → toast + no error banner | **FAIL** | Cannot enter card details because the card form never renders. Test never reached the success path. |
| C3 | Cancel path → no error banner | **FAIL** | Cannot exercise the cancel CTA because the cancel CTA never renders inside the never-loading sheet. The sheet's own X button is visible top-right, but tapping it would be platform-default dismiss, not the Stripe "Cancel" semantic. |
| C4 | Declined card → error toast, no double-resolve banner | **FAIL** | Cannot enter the decline card (`4000 0000 0000 0002`) because card form never renders. |
| C5 | Metro log: exactly ONE `→ native call` + ONE `← resolved` per tap | **UNVERIFIED** | I could not capture Metro stdout in this session — RN `console.log` from `useStripePaymentSheet` does not route through `os_log` so `xcrun simctl log stream` returned no Stripe-related lines. The Metro process (pid 10903) was started in a Claude background bash whose stdout I cannot retroactively access. The guard's CODE PATH is proven by source + regression check; the runtime log emission is unverified. |
| C6 | Synthetic double-invoke shows "already in flight" log | **UNVERIFIED** | Same Metro-log capture limitation. |
| C7 | No `returnURL` warning in Metro log after paid path | **UNVERIFIED** | Same. Source patch is confirmed in `app-mobile/src/payments/nativeCheckoutFlow.ts:136` — `returnURL: "com.mingla.app.v2://stripe-redirect"` is sent on every initPaymentSheet call. |
| C8 | Matrix populated with ≥3 SDK versions | **DEFERRED** (per spec §3.4 / operator) | Implementation report §4 — deferred to a sibling ORCH. |
| C9 | Regression check 100% | **PASS** | `npm run test:orch-0829b` → 6/6 PASS (verified RETEST_1). |
| C10 | `tsc --noEmit` clean | **PASS** | Touched files clean. |

**Summary:** C1–C4 FAIL (user-flow goals NOT met), C5–C7 UNVERIFIED (Metro log capture gap), C8 DEFERRED, C9–C10 PASS (source-level contracts met).

---

## P0 — CRITICAL

### P0-1: Paid checkout flow silently fails on iPhone 17 Pro / iOS 26 — user gets zero feedback

**File:** runtime behavior of `app-mobile/src/payments/nativeCheckoutFlow.ts` + `packages/payments-native/useStripePaymentSheet.ts` + Stripe RN 0.50.3 on iOS 26
**Symptom (observed three consecutive times across two test attempts that actually reached the edge function):**
1. User taps "Continue to Payment" on confirmation modal
2. Modal dismisses cleanly
3. White sheet with X close button + center spinner slides up from bottom (Stripe PaymentSheet loading skeleton)
4. Sheet remains in loading state for ~90 seconds
5. Sheet silently dismisses; user is back on Big Party detail
6. NO error toast, NO success toast, NO red banner, NO indication of any kind that the user just attempted a $250 charge
7. NO order in DB; NO ticket_checkout_sessions row; NO Stripe PaymentIntent (so no charge to the user)

**Constitutional violations:**
- Rule 3 (No silent failures) — the catch path in `nativeCheckoutFlow.ts:148` returns `{outcome: "failed", message: ...}` but the WRAPPER `handleBuy` only shows the toast IF `result.outcome === "failed"` (line 264-267). If `presentPaymentSheet` resolves with the once-only-guard returning the same Promise that never settles, NEITHER the success branch NOR the failed branch fires — the await just hangs forever. This is the trap the guard creates: the second invocation observes the FIRST's resolution, but if the first NEVER resolves, both hang forever. The `inFlightPresentRef` is never cleared because the finally block only runs after the await completes.

**Causal chain:**
1. Stripe RN 0.50.3 + iOS 26 has a documented hang in `presentPaymentSheet()` where the native completion handler is sometimes never invoked (the operator's prior META-ORCH-0827 chase context cites this)
2. The JS guard wraps the native call and only clears `inFlightPresentRef` in a `finally` block on the awaited Promise
3. If the native Promise never resolves, `finally` never runs, ref stays set, the user is stuck
4. Stripe's PaymentSheet UI eventually times out (~90s) and dismisses itself, but the JS-side Promise is still pending
5. `setCheckoutInFlight(false)` in `ExpandedBusinessEventSheet.tsx:233` is never called — `checkoutInFlight` stays `true` forever for this session
6. Subsequent Continue taps will short-circuit at `if (checkoutInFlight) return;` (line 192) — proven by Attempt 2 where the modal dismissed but no edge function call fired

**What the user thinks happened:** they don't know. They tapped Continue, a sheet appeared, sheet went away, no charge, no ticket. They will try again. The next attempt will silently do nothing (checkoutInFlight stuck) and they will conclude the app is broken.

**Severity:** P0 — paid checkout completely non-functional on the only iOS dev-build sim we have available. This blocks ORCH-0829-B from CLOSE.

**Fix direction (NOT this report's job to spec, but for orchestrator's next dispatch):**
- **Short-term defensive:** add a timeout race to `useStripePaymentSheet` so the in-flight Promise rejects after, say, 60s with a synthetic error → triggers the failed-toast path AND clears the ref. This converts silent failure into a loud failure.
- **Short-term in `handleBuy`:** wrap `runNativeCheckout` in `try/finally` so `setCheckoutInFlight(false)` always runs even if the inner Promise rejects/throws — otherwise subsequent taps short-circuit silently.
- **Real fix:** SDK upgrade matrix evaluation (deferred per spec §3.4 / DEC). Stripe RN 0.66+ on Xcode 26 needs a bench test cycle.

**Cited code:**
```
packages/payments-native/useStripePaymentSheet.ts:75-99
  presentPaymentSheet: async (): Promise<PaymentSheetResult> => {
    if (inFlightPresentRef.current !== null) { return inFlightPresentRef.current; }
    const p: Promise<PaymentSheetResult> = (async () => {
      try { ... await presentPaymentSheet() ... }
      finally { inFlightPresentRef.current = null; }  // ← never runs if native await hangs
    })();
    inFlightPresentRef.current = p;
    return p;
  },
```
```
app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:220-233
  setCheckoutInFlight(true);
  const result = await runNativeCheckout({...});  // ← hangs forever
  setCheckoutInFlight(false);  // ← never runs
```

---

## P4 — Notes (positive observations)

### P4-1: Defensive guard appears to suppress the red banner as intended
Across ~3 minutes of sheet-stuck-loading and self-dismiss in Attempt 1 and Attempt 3, the "Tried to resolve a promise more than once" red banner that the operator originally screenshotted never appeared. This is consistent with the guard mechanism working at the source level (regression 6/6 PASS in RETEST_1). The guard achieves its narrow technical goal — the user just doesn't benefit because the underlying hang prevents reaching the resolution point.

### P4-2: returnURL field is correctly wired into nativeCheckoutFlow
Source: `app-mobile/src/payments/nativeCheckoutFlow.ts:136` sends `returnURL: "com.mingla.app.v2://stripe-redirect"` matching `app-mobile/app.json:10` `"scheme": "com.mingla.app.v2"`. Cannot live-verify the absence of the Metro warning (log-capture gap C5–C7), but the source contract is correctly fulfilled per spec §3.3.

### P4-3: -A and ORCH-0828 functionality still passes (no regression)
Calendar tab still shows the 3 Big Party tickets from RETEST_1's free claims, confirmation modal renders correctly for both free + paid (visually verified in screenshots 12, 04), Big Party event still discoverable under Tonight filter, business-event sheet still opens. None of the -A or -0828 surfaces regressed from -B's defensive guard.

---

## Discoveries for Orchestrator

### D-1: ticket-checkout-create returns 200 but does NOT insert a ticket_checkout_sessions row (likely)
Edge function `ticket-checkout-create` was called once during Attempt 3 (function_edge_logs HTTP 200), but no row appeared in `ticket_checkout_sessions` across any 15-minute window covering my attempts. This is suspicious and may indicate either: (a) the function has a code path that returns 200 with an error body before insert, (b) the function inserts then rolls back on a downstream failure (e.g., Stripe PaymentIntent creation), or (c) the function uses a different schema/table than I queried. Without function-level execution-time / response-body logs (Supabase analytics endpoint failed on JOIN queries for `execution_time_ms`), I cannot isolate. **Recommend investigating** — this directly explains why `presentPaymentSheet` had nothing valid to present, which in turn explains the stuck-loading state.

### D-2: checkoutInFlight flag stuck `true` after first hang prevents subsequent attempts
Proven by Attempt 2 — after Attempt 1 hung and self-dismissed, the modal would still open in Attempt 2 (because that's pre-checkoutInFlight) but Continue → modal dismiss → nothing else. Root cause: `handleBuy` has no `try/finally` around `runNativeCheckout`, so a thrown / hung await leaves `checkoutInFlight = true` forever. This is its own P1-class defect but is downstream of D-1.

### D-3: Metro log capture is a tester-infra gap
RN `console.log` from `useStripePaymentSheet` does NOT route through `os_log` on iOS sim, so `xcrun simctl log stream` cannot capture the guard's diagnostic logs. The Metro process's stdout is only visible to the terminal that launched it. Future Stripe live-fire tests need either: (a) Metro launched by the tester via `run_in_background: true` so stdout is accessible via TaskOutput, (b) a debug overlay in the app that displays guard logs on-screen, or (c) writing the guard's diagnostic logs to an in-app debug ring buffer that surfaces in a developer panel.

### D-4: function_edge_logs analytics endpoint partially broken
`mcp__supabase__get_logs` returns 400 "User specified reservation projects/supabase-analytics-ext-queries/locations/EU/reservations/queries-short-12hr is not found". Direct Management API SQL works for simple SELECTs but 500s on JOINs with `unnest`. This affected my ability to verify per-call execution time and response body. **Not a -B finding, but should be tracked.**

---

## Maestro Flows Captured (for replay)

- `/tmp/orch-0829b-tap-bigparty.yaml` — tap Big Party at 50%,40% (missed)
- `/tmp/orch-0829b-tap-bigparty2.yaml` — tap Big Party at 30%,25% (hit, sheet opens)
- `/tmp/orch-0829b-scroll.yaml` — 2× swipe up to reach paid ticket
- `/tmp/orch-0829b-buy2.yaml` — tap Buy ticket at 18%,87%
- `/tmp/orch-0829b-continue2.yaml` — tap Continue via 65%,73% (modal scrim hit, dismissed; no flow fired)
- `/tmp/orch-0829b-attempt3.yaml` — full end-to-end via Maestro text-match on Continue (hit, flow fired, edge fn called, sheet hung)

---

## Working-Branch Discipline

This QA report and all screenshots live in `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` per Working-Branch Discipline. No global indexes (DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, AGENT_HANDOFFS) were written from this skill.

---

NEXT HANDOFF — paste into Claude `mingla-orchestrator`:

ORCH-0829-B FAILS live-fire on iPhone 17 Pro / iOS 26 — the defensive JS once-only guard correctly suppresses the "Tried to resolve a promise more than once" red banner (no banner observed across 3 minutes of stuck-loading + self-dismiss), but the underlying Stripe RN 0.50.3 + iOS 26 PaymentSheet hang remains; the user-visible symptom is now a silent failure (sheet loads forever then dismisses with no toast, no error, no order created). Full evidence at `Mingla_Artifacts/reports/QA_ORCH-0829-B_STRIPE_LIVEFIRE_REPORT_RETEST_2.md` (1 P0, 0 P1, 0 P2, 0 P3, 3 P4 + 4 Discoveries), screenshots at `Mingla_Artifacts/reports/orch-0829-b-retest-2/`. The CLOSE bundle for ORCH-0824 + ORCH-0828 + ORCH-0829-A should still proceed (those three are PASS per RETEST_1), but ORCH-0829-B needs an operator decision: (a) hold -B out of the close and dispatch a tight follow-up to Codex `implementor-mingla` for the two defensive patches the P0 fix-direction names (timeout race in `useStripePaymentSheet`, `try/finally` around `runNativeCheckout` in `ExpandedBusinessEventSheet.tsx`), then re-live-fire — converts silent failure into a loud toast that lets the user retry; (b) accept the silent-failure behavior and ship the guard as-is with the spec §3.4 SDK upgrade matrix as a sibling ORCH; or (c) hold the entire four-ORCH close until the SDK upgrade matrix is evaluated. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Two retest cycles deep on this ORCH — not yet in "stuck in loop" territory (<3 cycles) but trending. Also surface D-1 (ticket-checkout-create returns 200 but inserts no session row) as a likely root cause that's upstream of -B and may be the actual symptom-producer.
