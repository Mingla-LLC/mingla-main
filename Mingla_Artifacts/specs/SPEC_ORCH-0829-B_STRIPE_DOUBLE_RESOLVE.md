# SPEC — ORCH-0829-B: Stripe PaymentSheet double-resolve fix

**Mode:** SPEC
**Investigator + spec author:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829_CHECKOUT_FLOW_BUGS_FREE_CALENDAR_STRIPE.md` (Bug Z, `probable`)
**Sibling:** ORCH-0829-A (confirmation modal + calendar union, separate spec)

---

## 1. Layman Summary

Paid business-event tickets currently hang in the Stripe PaymentSheet then surface a red dev banner: `StripeSdk.presentPaymentSheet(): Tried to resolve a promise more than once.` The investigation traced this to a double-completion in Stripe's native iOS Swift code (TWO `present(from:completion:)` frames in the stack — known Stripe RN regression on iOS 26 + SDK 0.50.3). Our consumer code calls `presentPaymentSheet()` exactly once, so the bug is upstream of us.

Two-phase fix: **(B1) ship a JS-side `useRef`-based once-only guard in `useStripePaymentSheet` immediately** (idempotent against any future SDK regression of the same shape, ships with zero risk of breaking other surfaces); **(B2) evaluate Stripe RN SDK upgrade** as a second pass. The two-step lets us unblock paid checkout TODAY without an EAS rebuild while we de-risk the SDK upgrade in parallel.

---

## 2. Scope and Non-Goals

### 2.1 In scope

| # | Scope item | Source |
|---|---|---|
| S1 | JS-side once-only guard in `useStripePaymentSheet.ts` wrapping `presentPaymentSheet` so the second native completion is silently dropped instead of reaching the JS promise resolver twice | Investigation R-Z fix strategy (defensive fallback) |
| S2 | Same guard pattern applied to `initPaymentSheet` (lower probability but same shape — defensive) | Investigation regression prevention |
| S3 | Diagnostic logs around `present()` lifecycle: invocation, first resolve, suppressed-second-resolve, errors | Investigation R-Z diagnostic gap |
| S4 | Stripe RN version audit + upgrade evaluation matrix: try 0.51.x, 0.52.x, 0.53.x, latest stable. For each, document whether iOS 26 PaymentSheet completion works and whether other features (Apple Pay, Klarna, etc.) regress. RESULT goes in the implementation report; NO upgrade ship in this spec unless one version is conclusively safer than 0.50.3 | Operator's prior META-ORCH-0827 chase context |
| S5 | `returnURL` configured for `initPaymentSheet` so Apple Pay / iDEAL methods become available (observation from investigation log line 2369) | Investigation Observation |
| S6 | Regression check covering: useRef guard exists, diagnostic logs present, returnURL configured | Regression prevention |

### 2.2 Non-goals (explicit)

| # | Non-goal | Rationale |
|---|---|---|
| N1 | Confirmation modal | Covered by ORCH-0829-A |
| N2 | Calendar union | Covered by ORCH-0829-A |
| N3 | Stripe RN SDK actually upgraded in this spec | Upgrade is HIGH risk — operator's prior chase (0.51.0 + 0.65.1) failed with different blockers each. Spec deliverable is the evaluation matrix; the actual upgrade (if any) is a follow-up ORCH after operator reviews the matrix. |
| N4 | Server-side Stripe API version changes | Stripe API version pinned in `_shared/stripe.ts` per I-PROPOSED-Q; no change |
| N5 | Native-iOS modifications via pod / CocoaPods patches | If matrix concludes "no SDK version is safe and only a native patch works," that's a META-ORCH escalation, not in this spec |
| N6 | Switching from `presentPaymentSheet` to `confirmPaymentSheetPayment` lower-level API | Larger rewrite, only justified if (B1) JS-side guard proves insufficient |

### 2.3 Assumptions

- A1: Stripe RN 0.50.3 is the currently shipped version (verified per `app-mobile/package.json:33`).
- A2: The JS-side guard alone fixes the user-visible bug (no red banner, no hang) because the second completion's call into the TurboModule promise resolver is what triggers the React Native runtime error — suppressing the second JS-side resolution prevents the runtime from raising.
- A3: Stripe's native side may continue to invoke the completion handler twice; our guard silences the JS-side symptom but doesn't fix the underlying native double-callback. The matrix evaluation may find an SDK version that fixes the native side properly.
- A4: ORCH-0829-A's confirmation modal ships first (operator preferred sequencing). Bug Z's fix is independent — can ship in parallel or after.

---

## 3. Per-Layer Specification

### 3.1 Database, edge function, RLS, hook layers — N/A

No changes outside the React Native code in `packages/payments-native/` and a small `returnURL` config addition in `app-mobile/src/payments/nativeCheckoutFlow.ts`.

### 3.2 Package layer — `packages/payments-native/useStripePaymentSheet.ts`

#### 3.2.1 Once-only guard

Replace the existing hook with:

```ts
import { useRef } from "react";
import { useStripe } from "@stripe/stripe-react-native";

import { normalizePaymentSheetResult } from "./normalizePaymentSheetResult";
import type {
  PaymentSheetInitInput,
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./types";

export const useStripePaymentSheet = (): StripePaymentSheetController => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // ORCH-0829-B: Stripe RN 0.50.3 on iOS 26 occasionally invokes the
  // PaymentSheet completion handler TWICE for the same call. The second
  // invocation surfaces as "Tried to resolve a promise more than once."
  // and breaks the PaymentSheet UX. We guard at the JS layer using a
  // per-hook-instance ref so the second resolution is silently dropped.
  // This does NOT fix Stripe's native side — it suppresses the symptom
  // while we evaluate an SDK upgrade. See investigation R-Z and S4
  // matrix in the implementation report.
  const inFlightInitRef = useRef<Promise<PaymentSheetResult> | null>(null);
  const inFlightPresentRef = useRef<Promise<PaymentSheetResult> | null>(null);

  return {
    isPaymentSheetSupported: true,
    initPaymentSheet: async (
      input: PaymentSheetInitInput,
    ): Promise<PaymentSheetResult> => {
      if (inFlightInitRef.current !== null) {
        console.log(
          "[useStripePaymentSheet] initPaymentSheet already in flight; returning existing promise",
        );
        return inFlightInitRef.current;
      }
      const p = (async (): Promise<PaymentSheetResult> => {
        console.log("[useStripePaymentSheet] initPaymentSheet → native call");
        try {
          const result = normalizePaymentSheetResult(
            await initPaymentSheet(input),
          );
          console.log(
            "[useStripePaymentSheet] initPaymentSheet ← resolved error=",
            result.error?.code ?? "none",
          );
          return result;
        } finally {
          inFlightInitRef.current = null;
        }
      })();
      inFlightInitRef.current = p;
      return p;
    },
    presentPaymentSheet: async (): Promise<PaymentSheetResult> => {
      if (inFlightPresentRef.current !== null) {
        console.log(
          "[useStripePaymentSheet] presentPaymentSheet already in flight; returning existing promise (double-invoke suppressed)",
        );
        return inFlightPresentRef.current;
      }
      const p = (async (): Promise<PaymentSheetResult> => {
        console.log("[useStripePaymentSheet] presentPaymentSheet → native call");
        try {
          const result = normalizePaymentSheetResult(
            await presentPaymentSheet(),
          );
          console.log(
            "[useStripePaymentSheet] presentPaymentSheet ← resolved error=",
            result.error?.code ?? "none",
          );
          return result;
        } finally {
          inFlightPresentRef.current = null;
        }
      })();
      inFlightPresentRef.current = p;
      return p;
    },
  };
};
```

**Behavior contract:**
- First `presentPaymentSheet()` call: stores the promise in `inFlightPresentRef`, awaits native, normalizes, clears ref on settle.
- Second `presentPaymentSheet()` call while first is still pending: returns the SAME promise reference (callers awaiting both get the same resolution).
- Third call AFTER first settles: starts fresh (ref was cleared by the `finally`).

This handles BOTH the Stripe native double-completion scenario AND any future case where the consumer accidentally calls present twice from React re-renders.

#### 3.2.2 Type contract — UNCHANGED

`StripePaymentSheetController` interface stays the same. Consumers (`nativeCheckoutFlow.ts`) call exactly as before. No breaking change.

### 3.3 Consumer layer — `app-mobile/src/payments/nativeCheckoutFlow.ts`

#### 3.3.1 Add `returnURL` to `initPaymentSheet` call

Per investigation Observation (Metro log line 2369 — Stripe SDK warning about missing returnURL):

```ts
const initResult = await initPaymentSheet({
  merchantDisplayName: MERCHANT_DISPLAY_NAME,
  paymentIntentClientSecret: data.clientSecret,
  allowsDelayedPaymentMethods: false,
  // ORCH-0829-B: enables payment methods that redirect (Apple Pay, iDEAL,
  // Klarna) by giving Stripe a URL to return to after the redirect.
  // Must match the scheme registered in app.json (`com.mingla.app.v2`).
  returnURL: "com.mingla.app.v2://stripe-redirect",
});
```

Verify against `app-mobile/app.json` URL scheme registration during IMPLEMENT pre-flight — if the scheme differs, use the registered one. If no scheme is registered for Stripe redirects, register one as part of this work.

### 3.4 Matrix evaluation (deliverable in implementation report)

The implementor produces a matrix in the IMPLEMENTATION report listing each Stripe RN version tried, with:

| Version | npm install success | EAS build success | Sim PaymentSheet open | Sim PaymentSheet completion | Other regressions noted | Verdict |
|---|---|---|---|---|---|---|
| 0.50.3 (current) | Y | Y | Y | **No (double-resolve)** | Apple Pay needs returnURL warning | Baseline |
| 0.51.x | ? | ? | ? | ? | ? | ? |
| 0.52.x | ? | ? | ? | ? | ? | ? |
| 0.53.x | ? | ? | ? | ? | ? | ? |
| Latest stable | ? | ? | ? | ? | ? | ? |

The matrix is documentation — NO version change is committed in this spec. The follow-up ORCH (if any) acts on the matrix conclusion.

If 0.50.3 + JS guard works in live-fire (no red banner, payment completes), the operator may decide to defer the matrix work; that's an operator call after IMPLEMENT returns.

### 3.5 Regression-check layer

New script: `app-mobile/scripts/ci/orch-0829b-regression-check.mjs`.

Contracts:
- T-B1: `useStripePaymentSheet.ts` contains `useRef` import + `inFlightPresentRef` + `inFlightInitRef`
- T-B2: `useStripePaymentSheet.ts` `presentPaymentSheet` wrapper checks ref before calling native
- T-B3: Both wrappers clear the ref in a `finally` block (no leak on error)
- T-B4: Diagnostic logs present (`[useStripePaymentSheet] presentPaymentSheet → native call` + `← resolved`)
- T-B5: `nativeCheckoutFlow.ts` `initPaymentSheet` call includes `returnURL` field
- T-B6: `useStripePaymentSheet.ts` does NOT call `presentPaymentSheet` outside the wrapped function (no leak of the raw API to consumers)

Wired into `package.json` as `test:orch-0829b`.

---

## 4. Success Criteria

| # | Criterion | Layer | Test |
|---|---|---|---|
| C1 | Tap a paid ticket → Stripe PaymentSheet opens within 800ms | Component | T-01 live-fire |
| C2 | Complete payment with Stripe test card 4242 4242 4242 4242 → toast "Ticket secured!" + sheet closes + NO "Tried to resolve a promise more than once" error banner | Full stack | T-02 live-fire |
| C3 | Cancel payment (swipe down PaymentSheet) → no error banner; `runNativeCheckout` returns `{outcome: "canceled"}`; no toast | Component | T-03 live-fire |
| C4 | Decline payment with Stripe test card 4000 0000 0000 9995 (insufficient funds) → error message in toast; no double-resolve banner | Full stack | T-04 live-fire |
| C5 | Metro log shows `[useStripePaymentSheet] presentPaymentSheet → native call` exactly ONCE per user tap, and `← resolved error=` exactly ONCE | Component | T-05 live-fire grep |
| C6 | If a synthetic double-invoke is forced (manual second call to `presentPaymentSheet()` from a console / test harness), the log shows `presentPaymentSheet already in flight; returning existing promise (double-invoke suppressed)` and only one `← resolved` line | Hook | T-06 manual diagnostic |
| C7 | `initPaymentSheet` no longer emits the `returnURL` warning in Metro log | Component | T-07 live-fire grep |
| C8 | Matrix table populated in implementation report with at least 3 SDK versions evaluated (or operator-accepted "deferred matrix") | Report | T-08 inspection |
| C9 | Regression check passes 100% | CI | `npm run test:orch-0829b` |
| C10 | `tsc --noEmit` clean on touched files | Type | `npx tsc --noEmit` |

---

## 5. Invariants

### 5.1 Preserved

| Invariant | How |
|---|---|
| Const #3 No silent failures | Cancel + decline paths surface to user; only successful-promise-duplicate is silently suppressed (intentional) |
| Const #5 Server state server-side | Refs are in-flight gating, not data — fine to live in hook closure |
| Const #11 One auth instance | Stripe session unchanged |
| I-PROPOSED-Q (Stripe API version pinned) | Server side unchanged |
| I-PROPOSED-R (Idempotency-Key on Stripe API calls) | Edge function unchanged |

### 5.2 New invariants

| ID | Description | Enforcement |
|---|---|---|
| `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` | All callers of Stripe `presentPaymentSheet` MUST use the wrapped `useStripePaymentSheet` hook from `@mingla/payments-native`. Direct imports of `useStripe().presentPaymentSheet` from app code are forbidden (use the wrapper). | Regression T-B1, T-B6 + sibling strict-grep CI gate (P3 sibling ORCH) |

### 5.3 Notes on suppressed-second-resolution behavior

This is intentional silence — the second native completion fires for a Stripe SDK reason that doesn't affect the user's payment outcome (Stripe's actual payment completion is signaled on the first invocation). Suppressing the JS-side duplicate is the correct defense. Document in the hook's JSDoc that the suppression is BY DESIGN.

If a future Stripe SDK regression invokes the completion with DIFFERENT outcomes on first vs second call (e.g., first = success, second = error), our guard returns the FIRST result. That's the right behavior for payment success-or-cancel but worth a P3 sibling ORCH to add a diagnostic that flags any divergence between first and (suppressed) second result.

---

## 6. Test Cases

| Test ID | Scenario | Input | Expected | Layer | Auto |
|---|---|---|---|---|---|
| T-01 | PaymentSheet opens | Maestro tap paid ticket → Confirm in claim modal | Sheet visible within 800ms | Full stack | Manual |
| T-02 | Successful payment | Stripe test card 4242 4242 4242 4242 + CVC 123 + future expiry | Toast "Ticket secured!" + no red banner | Full stack | Manual |
| T-03 | User cancel | Swipe PaymentSheet down before paying | No toast, no error banner, sheet closes cleanly | Full stack | Manual |
| T-04 | Card decline | Test card 4000 0000 0000 9995 | Toast with error message, no double-resolve banner | Full stack | Manual |
| T-05 | One present call per tap | T-01 happy path | Metro log: exactly one `→ native call` + one `← resolved` per user tap | Component | Manual grep |
| T-06 | Double-invoke suppressed | Manual second `presentPaymentSheet()` call from JS console while first is pending | Log: `already in flight; returning existing promise (double-invoke suppressed)`; only one `← resolved` | Hook | Manual via JS console / debug build |
| T-07 | No returnURL warning | Cold app launch + tap paid ticket | Metro log: NO `[@stripe/stripe-react-native] You have not provided the 'returnURL' field` warning | Component | Manual grep |
| T-08 | Matrix populated | Implementation report | Section "Stripe RN Version Matrix" lists ≥3 evaluated versions with per-version verdict | Report | Inspection |
| T-B1..T-B6 | Source contracts | Files on disk | Regression check 6/6 PASS | Source | `npm run test:orch-0829b` |
| T-09 | tsc | `cd app-mobile && npx tsc --noEmit` | Exit 0 / no new errors | Type | `tsc` |

---

## 7. Implementation Order

1. **Step 1 — Read current `useStripePaymentSheet.ts` end-to-end** + `nativeCheckoutFlow.ts` to confirm no other consumers of the raw `useStripe()` API exist in app-mobile.
2. **Step 2 — Stripe RN version matrix evaluation (research, not commit).** Try each version on a feature branch (NOT Seth): `0.51.x`, `0.52.x`, `0.53.x`, latest stable. For each, run `npm install`, attempt `eas build`, attempt sim PaymentSheet open + close. Record findings in the implementation report Matrix section. Revert to 0.50.3 on Seth before continuing.
3. **Step 3 — Once-only guard in `useStripePaymentSheet.ts`** per §3.2.1. Diagnostic logs included.
4. **Step 4 — `returnURL` added to `nativeCheckoutFlow.ts` initPaymentSheet call** per §3.3.1. Verify scheme in `app-mobile/app.json` first.
5. **Step 5 — Regression check `orch-0829b-regression-check.mjs`** per §3.5.
6. **Step 6 — Local gates.** `npm run test:orch-0829b` PASS; `tsc --noEmit` clean.
7. **Step 7 — Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md` with old→new receipts + matrix + verification matrix for C1–C10.

No EAS rebuild in scope (the JS-side guard is hot-reload-friendly). If Step 2 matrix concludes an SDK upgrade is necessary AND the operator authorizes a follow-up ORCH, that follow-up handles the EAS rebuild.

---

## 8. Regression Prevention

| Bug class | Prevention |
|---|---|
| Future Stripe SDK regression of the same shape | JS-side guard is permanent — independent of SDK version |
| App-side accidental double-invoke from React re-render | Same guard catches it |
| Missing `returnURL` on initPaymentSheet | T-07 + diagnostic warning would re-fire if config drift |
| Direct use of `useStripe().presentPaymentSheet` bypassing the wrapper | T-B6 + future sibling strict-grep CI gate (P3 register) |

---

## 9. Discoveries for Orchestrator (NOT in this spec)

1. Strict-grep CI gate enforcing `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` (forbid raw `useStripe().presentPaymentSheet` outside the package) — P3 sibling
2. Diagnostic for divergent first-vs-suppressed-second completion outcomes — P3 sibling
3. The Stripe RN upgrade itself, IF the matrix concludes a version is safer — follow-up ORCH

---

## 10. Open Questions Resolved by This Spec

| Q | Resolution |
|---|---|
| Fix the JS layer OR upgrade the SDK first? | Both, in two phases. Ship the JS guard NOW (this spec). Matrix evaluation included for operator to make the upgrade call as a follow-up. |
| Should the guard apply to `initPaymentSheet` too? | Yes (S2). Lower probability of double-invoke but same shape; defensive cost is trivial. |
| Add `returnURL` in this spec or sibling? | This spec (S5). It's a one-line change in the same file family + closes the Stripe SDK warning visible in the investigation log. |
| Switch to `confirmPaymentSheetPayment` lower-level API? | Non-goal N6. Only justified if the JS guard proves insufficient on live-fire. |

---

End of spec.
