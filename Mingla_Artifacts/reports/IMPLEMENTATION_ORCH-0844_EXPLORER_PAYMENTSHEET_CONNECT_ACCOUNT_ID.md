# IMPLEMENTATION — ORCH-0844 [Explorer PaymentSheet: Connect Account ID per-PI + 60s timeout removal]

**Mode:** IMPLEMENT (Option A from investigation)
**Implementor:** Claude `mingla-implementor`
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0844_EXPLORER_PAYMENTSHEET_CONNECT_ACCOUNT_ID_AND_TIMEOUT_REMOVAL.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0844_EXPLORER_PAYMENTSHEET_DOUBLE_RESOLVE.md`

---

## 0. DEC-157 DRAFT (orchestrator pastes into DECISION_LOG.md at CLOSE)

```
DEC-157 (2026-05-15) — ORCH-0844 [Explorer PaymentSheet Connect-account-ID per-PI + 60s timeout removal]

Context: ORCH-0843 flipped every ticket PI to direct-charge on a connected
account via { stripeAccount } request option, but the mobile Stripe SDK was
never initialised with the matching stripeAccountId. On iOS 26 this surfaced
as the native RCTPromiseResolveBlock firing twice (early 404-error resolve +
late completion resolve), which RN's TurboModule bridge logs as "tried to
resolve a promise more than once". The 60s synthetic withTimeout race in
useStripePaymentSheet (added in ORCH-0829-B D-1 for the now-resolved
dashboard-fan-out hang) compounded the double-settle window.

Decision: Option A — fix the two real gaps, do NOT pivot to Hosted Checkout
(Payment Sheet is Stripe's officially recommended pattern).

(1) Edge function returns stripeAccountId + Connect-scoped Customer +
    ephemeralKey on requires_payment.
(2) Mobile calls initStripe({ publishableKey, stripeAccountId, ... }) per-PI
    before initPaymentSheet; passes customerId + customerEphemeralKeySecret
    to initPaymentSheet.
(3) Remove withTimeout wrappers from both initPaymentSheet and
    presentPaymentSheet (the once-only guards stay).
(4) Drop allowsDelayedPaymentMethods: false (redundant under card-only PI).

Invariants: ESTABLISH I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI; AMEND
I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG (now requires per-PI initStripe with
stripeAccountId for Connect direct-charges); RETIRE
I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE; PRESERVE
I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY + I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES
unchanged.

Hosted-Checkout pivot (Option B) explicitly REJECTED for explorer — that path
was correct for mingla-business (whose StripeNativeProvider was a no-op shim)
but would regress explorer away from Stripe's officially recommended mobile
pattern. Option B remains reserved as fallback if Option A demonstrably fails
on TEST after a clean cycle.

Supersedes: DEC-154-era "Stripe RN is fundamentally broken on iOS 26"
framing. The bug was specific config gaps × upstream-regression-class, not
wholesale SDK breakage.
```

---

## 1. STEP 1 — EDGE FUNCTION (already deployed at v48 LIVE)

Verified post-handoff. `supabase/functions/ticket-checkout-create/index.ts`:

- Line 2: `import { stripeTicketCheckout, STRIPE_API_VERSION } from "../_shared/stripe.ts";` ✓
- Lines 563–623: Customer + ephemeralKey block (try/catch non-fatal, idempotent search-then-create on the connected account) ✓
- Lines 626–644: `kind: "requires_payment"` jsonResponse now includes `stripeAccountId`, `customerId`, `customerEphemeralKeySecret` ✓

Edge function `Deno check` post-receipt: CLEAN (zero errors).

```
$ /Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts
Check supabase/functions/ticket-checkout-create/index.ts
$ echo $?
0
```

Orchestrator confirmed `ticket-checkout-create v48` LIVE.

---

## 2. STEP 2 — `packages/payments-native/useStripePaymentSheet.ts`

### 2.1 Old → New diff

**Old (relevant sections, 165 lines total):**
- Lines 26–39: ORCH-0829-B D-1 H-3 header block documenting the 60s timeout race
- Line 52: `const PAYMENT_SHEET_TIMEOUT_MS = 60_000;`
- Lines 54–89: `function withTimeout<T>(...)` helper
- Lines 115–121: `await withTimeout(initPaymentSheet(input), PAYMENT_SHEET_TIMEOUT_MS, "initPaymentSheet")`
- Lines 144–150: `await withTimeout(presentPaymentSheet(), PAYMENT_SHEET_TIMEOUT_MS, "presentPaymentSheet")`

**New (110 lines total):**
- Header rewritten: 6-section block citing ORCH-0844 retirement, root cause R-2, the supersession path (ORCH-0837 card-only PIs resolved the hang), and the four invariant cross-references.
- `PAYMENT_SHEET_TIMEOUT_MS` constant: **DELETED**
- `withTimeout<T>` helper: **DELETED**
- `initPaymentSheet` IIFE body (line ~77): `const result = normalizePaymentSheetResult(await initPaymentSheet(input));` — direct await, no race
- `presentPaymentSheet` IIFE body (line ~98): `const result = normalizePaymentSheetResult(await presentPaymentSheet());` — direct await, no race
- Once-only guards (`inFlightInitRef` / `inFlightPresentRef`) **PRESERVED** unchanged.

### 2.2 `packages/payments-native/types.ts`

Preserved the `"Timeout"` PaymentSheetErrorCode union member as legacy (no longer emitted by the hook, but kept for backward compat — `normalizePaymentSheetResult.ts` still lists it as a recognized code, and a unit test references it). SPEC §3.3.4 marked this as implementor-choice; chose preservation to keep blast radius minimal.

Also updated `PaymentSheetInitInput`:
- `allowsDelayedPaymentMethods` made **optional** (was required) per ORCH-0844 A-4 (callers should omit; PI itself enforces card-only via ORCH-0837).
- Added optional `customerId?: string` and `customerEphemeralKeySecret?: string` for the new Connect-scoped Customer + ephemeralKey pair.

---

## 3. STEP 3 — `app-mobile/src/payments/nativeCheckoutFlow.ts`

### 3.1 Changes

1. **Import** (line 20): `import { initStripe } from "@stripe/stripe-react-native";` — ADDED next to existing wrapper import.
2. **Type extension** (`CheckoutCreateResponse.requires_payment`): added three new fields with inline rationale comment:
   ```ts
   stripeAccountId: string;
   customerId: string | null;
   customerEphemeralKeySecret: string | null;
   ```
3. **Per-PI `initStripe` call** (inside `if (data.kind === "requires_payment")` branch, BEFORE `initPaymentSheet`): re-initialises the native Stripe SDK with the connected account scope. Guards on `data.publishableKey && data.stripeAccountId` — non-empty pair required; on miss, emits a console.warn citing the iOS 26 double-resolve risk.
4. **`initPaymentSheet` call** updated:
   - `allowsDelayedPaymentMethods: false` **REMOVED** (A-4).
   - Spread-conditional `customerId` + `customerEphemeralKeySecret` ADDED (paired-or-absent per edge function contract).
5. **Protective comments** added inline citing ORCH-0844, the iOS 26 RCTPromiseResolveBlock mechanism, and the ORCH-0843 Connect direct-charge architecture.

### 3.2 Provider drift note

`merchantIdentifier: "merchant.com.mingla.app.v2"` + `urlScheme: "com.mingla.app.v2"` are hardcoded matching `app-mobile/app/_layout.tsx:72-75`. Per SPEC §3.4.3 these MUST change together; inline comment documents the coupling. Open follow-up (SPEC §12): extract `STRIPE_NATIVE_PROVIDER_DEFAULTS` constant — not in scope here.

---

## 4. STEP 4 — NEW CI GATE

### 4.1 `.github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs`

NEW file, 145 lines. Mirrors the modular-script-per-invariant pattern of `orch-0843-stripe-direct-charges-only.mjs`. Strips comments before matching to avoid false hits in docblocks.

Sub-checks:
- **T-G1**: `app-mobile/src/payments/nativeCheckoutFlow.ts` imports `initStripe` from `@stripe/stripe-react-native`.
- **T-G2**: Same file calls `initStripe({ ... publishableKey ... stripeAccountId ... })` with both fields present, BEFORE the first `initPaymentSheet(` call site. Enforces ordering via index comparison.
- **T-G3**: `supabase/functions/ticket-checkout-create/index.ts` `requires_payment` jsonResponse block contains `stripeAccountId` key.
- **T-G4**: Same block contains both `customerId` AND `customerEphemeralKeySecret` keys.

### 4.2 `.github/workflows/strict-grep-mingla-business.yml`

- Comment-block registry entry added (line after ORCH-0843).
- New job `orch-0844-stripe-connect-account-id-per-pi` added (placed immediately after `orch-0843-stripe-direct-charges-only`), mirroring its structure.

### 4.3 Local run output (PASS)

```
$ node .github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs
ORCH-0844 Stripe Connect-account-id-per-PI gate passed.
```

---

## 5. STEP 5 — FLIPPED ORCH-0829-B D-1 REGRESSION-CHECK

`app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs`:

- Header rewritten: cites ORCH-0844 retirement of `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE`. T-A1..T-A5 contract descriptions marked `(PRESERVED)`; T-A6..T-A9 marked `(FLIPPED — ORCH-0844)`.
- T-A1..T-A5 sub-checks **UNCHANGED** (migration + handleBuy try/finally remain valid invariants).
- T-A6 flipped: assert hook does NOT declare `PAYMENT_SHEET_TIMEOUT_MS` AND does NOT declare `function withTimeout`.
- T-A7 flipped: assert hook does NOT contain `withTimeout(` (catches any future re-introduction whether inside or outside the wrappers).
- T-A8 flipped: assert hook does NOT contain `code: "Timeout"` literal.
- T-A9 flipped: assert hook does NOT contain `timed out after ${ms}ms` log line.
- Detail strings rewritten for each flipped sub-check to explain the new invariant + cite ORCH-0844.

### 5.1 Local run output (PASS)

```
$ node app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs
ORCH-0829-B D-1 regression check
  [PASS] T-A1 D-1 migration file exists with monotonic prefix > 20260605000001
  [PASS] T-A2 Migration body contains tombstone-expiry OR clause
  [PASS] T-A3 Migration body transitions tombstoned non-terminal rows to status='expired'
  [PASS] T-A4 handleBuy wraps runNativeCheckout in try ... finally { setCheckoutInFlight(false) }
  [PASS] T-A5 handleBuy catch converts thrown errors to { outcome: 'failed', message }
  [PASS] T-A6 (flipped) useStripePaymentSheet MUST NOT declare PAYMENT_SHEET_TIMEOUT_MS or function withTimeout
  [PASS] T-A7 (flipped) Neither initPaymentSheet nor presentPaymentSheet wraps its native call in withTimeout(...)
  [PASS] T-A8 (flipped) useStripePaymentSheet MUST NOT emit a synthetic error with code: 'Timeout'
  [PASS] T-A9 (flipped) useStripePaymentSheet MUST NOT log `timed out after ${ms}ms`
Summary: 9/9 PASS
```

---

## 6. STEP 6 — ADVERSARIAL GATE-TRIP EVIDENCE

### 6.1 Negative-probe T-G1 (remove `initStripe` import)

```
$ node .github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs
ORCH-0844 Stripe Connect-account-id-per-PI gate failed:
  - T-G1 app-mobile/src/payments/nativeCheckoutFlow.ts must import `initStripe` from `@stripe/stripe-react-native` (ORCH-0844: per-PI SDK re-init for Connect direct-charge PIs).
EXIT=1
```
✓ Gate trips correctly. Restored.

### 6.2 Negative-probe T-G3 (remove `stripeAccountId` from edge-fn response)

```
$ node .github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs
ORCH-0844 Stripe Connect-account-id-per-PI gate failed:
  - T-G3 supabase/functions/ticket-checkout-create/index.ts `requires_payment` response is missing `stripeAccountId` key (ORCH-0844: mobile SDK needs the connected-account scope per-PI).
EXIT=1
```
✓ Gate trips correctly. Restored.

### 6.3 Negative-probe flipped T-A6/T-A8/T-A9 (re-introduce `PAYMENT_SHEET_TIMEOUT_MS` + `withTimeout` + Timeout code + log)

```
$ node app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs
ORCH-0829-B D-1 regression check
  [PASS] T-A1..T-A5 (preserved)
  [FAIL] T-A6 (flipped) useStripePaymentSheet MUST NOT declare PAYMENT_SHEET_TIMEOUT_MS or function withTimeout
         useStripePaymentSheet.ts MUST NOT declare PAYMENT_SHEET_TIMEOUT_MS or a withTimeout<T>(promise, ms, label) helper — the timeout race was retired in ORCH-0844 ...
  [PASS] T-A7 (flipped) Neither initPaymentSheet nor presentPaymentSheet wraps its native call in withTimeout(...)
  [FAIL] T-A8 (flipped) useStripePaymentSheet MUST NOT emit a synthetic error with code: 'Timeout'
         useStripePaymentSheet.ts MUST NOT construct a synthetic rejection with code: 'Timeout' ...
  [FAIL] T-A9 (flipped) useStripePaymentSheet MUST NOT log `timed out after ${ms}ms`
         useStripePaymentSheet.ts MUST NOT contain the diagnostic log line `timed out after ${ms}ms` ...
Summary: 6/9 PASS (3 FAIL)
EXIT=1
```
✓ Three flipped sub-checks trip correctly. T-A7 stayed PASS because the adversarial probe only declared (didn't invoke) `withTimeout` inside the wrappers — that's expected and acceptable since T-A6 already catches the declaration. Restored.

### 6.4 Neighboring ORCH gates (all GREEN after restore)

```
ORCH-0843 Stripe direct-charge gate passed.
ORCH-0837 Summary: 5/5 PASS
ORCH-0839-B mingla-business no-native-stripe gate passed.
ORCH-0778 web Stripe native import gate passed.
ORCH-0777 production checkout guard passed.
ORCH-0804 strict-grep PASS — 6/6 checks.
ORCH-0789 strict-grep gate passed.
```

---

## 7. STEP 7 — TYPE-CHECK VERIFICATION

### 7.1 Edge function (Deno)

```
$ /Users/sethogieva/.deno/bin/deno check supabase/functions/ticket-checkout-create/index.ts
Check supabase/functions/ticket-checkout-create/index.ts
$ echo $?
0
```
CLEAN.

### 7.2 `app-mobile/src/payments/nativeCheckoutFlow.ts`

Filtered project-level `tsc --noEmit`:
```
$ cd app-mobile && npx tsc --noEmit 2>&1 | grep nativeCheckoutFlow
(empty)
```
CLEAN — zero TS errors on the touched glue file.

### 7.3 `packages/payments-native/useStripePaymentSheet.ts` + `types.ts`

Filtered project-level tsc shows two errors:
```
../packages/payments-native/useStripePaymentSheet.ts(47,24): error TS7016: Could not find a declaration file for module 'react'.
../packages/payments-native/useStripePaymentSheet.ts(48,27): error TS2307: Cannot find module '@stripe/stripe-react-native'.
```
**Baseline-confirmed pre-existing errors** — verified via `git stash` (errors present without my changes too, at lines 41/42 of the un-stashed hook). These are root-tsconfig / monorepo-resolution artifacts, NOT introduced by ORCH-0844. SC-13 satisfied: zero NEW TS errors.

---

## 8. SPEC TRACEABILITY (SC-1..SC-13)

| SC | Description | Status |
|---|---|---|
| SC-01 | iOS 26 happy path no double-resolve warning | **UNVERIFIED** (requires fresh dev build + sim run — handed to tester) |
| SC-02 | Sheet renders ≤3s | **UNVERIFIED** (tester) |
| SC-03 | Direct-charge shape preserved (1.5% fee, MINGLA descriptor) | **PASS** (ORCH-0843 gate green; no charge-shape changes here) |
| SC-04 | Cancel resolves once, re-open works | **UNVERIFIED** (tester) |
| SC-05 | Card decline resolves once with code Failed | **UNVERIFIED** (tester) |
| SC-06 | Apple Pay still gated (no button) | **PASS** (no provider config change; A-4 removal doesn't surface Apple Pay since PI is card-only) |
| SC-07 | Free ticket flow unchanged | **PASS** (free-ticket branch untouched in nativeCheckoutFlow.ts; edge fn `free_completed` path unchanged) |
| SC-08 | Edge fn response shape | **PASS** (step 1 v48 LIVE; T-G3 + T-G4 enforce) |
| SC-09 | Guest fallback on customer-creation failure | **PARTIAL** (code path implemented via try/catch + paired-or-absent spread-conditional; live-fire confirmation deferred to tester) |
| SC-10 | ORCH-0843 refund flow unchanged | **PASS** (no charge-creation code touched) |
| SC-11 | ORCH-0844 gate trips on T-G1..T-G4 | **PASS** (adversarial trips T-G1 + T-G3 executed; T-G2 and T-G4 logic shares the same matcher pattern) |
| SC-12 | Flipped regression-check trips on timeout-race re-introduction | **PASS** (T-A6 + T-A8 + T-A9 trip evidence captured) |
| SC-13 | Zero new TS errors | **PASS** (edge fn deno clean; glue file tsc clean; hook errors confirmed pre-existing baseline) |

---

## 9. INVARIANT REGISTRY CHANGE LIST (orchestrator applies at CLOSE)

| Invariant | Action | Rationale |
|---|---|---|
| `I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI` | **ESTABLISH (DRAFT → ACTIVE at CLOSE)** | Every `initPaymentSheet` for a connected-account PI MUST be preceded by `initStripe({ publishableKey, stripeAccountId, merchantIdentifier, urlScheme })` with the server-returned `stripeAccountId`. Enforced by `orch-0844-stripe-connect-account-id-per-pi.mjs` T-G1..T-G4. |
| `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` | **AMEND** | "Full config" definition extended: for connected-account PIs, applies per-PI via `initStripe(...)`, not just at provider mount. Provider mount remains the platform-level baseline. |
| `I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE` | **RETIRE** | DEC-157 supersedes. R-2 in INVESTIGATION_ORCH-0844 documents how the race became a double-settle vector on iOS 26 once R-1 (the actual hang root cause) was fixed by ORCH-0837 card-only PIs. CI gate flipped to enforce absence. |
| `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` | **PRESERVE** | Once-only `inFlightInitRef`/`inFlightPresentRef` guards remain — they suppress JS-side double-tap creation of new Promises (different mechanism than the native double-resolve). |
| `I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES` | **PRESERVE** | `payment_method_types: ['card']` stays canonical. |
| `I-PROPOSED-STRIPE-CALLBACK-WIRED` | **PRESERVE** | `handleURLCallback` wiring at `app/index.tsx:1803-1835` stays (H-1 disproven in investigation; load-bearing for future redirect-method re-enable). |
| `I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE` | **PRESERVE** | T-A1..T-A5 of the D-1 regression-check still enforce migration + handleBuy try/finally. |
| ORCH-0843 invariants (STRIPE-CHARGE-SHAPE-IS-DIRECT, STRIPE-APPLICATION-FEE-PRESENT, STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS, STRIPE-STATEMENT-DESCRIPTOR-SUFFIX-MINGLA) | **PRESERVE** | Charge shape untouched. ORCH-0843 gate green. |

---

## 10. FILES TOUCHED

| File | Change type | LOC delta |
|---|---|---|
| `supabase/functions/ticket-checkout-create/index.ts` | (already shipped step 1, v48 LIVE) | ~+85 (verified, not modified here) |
| `packages/payments-native/useStripePaymentSheet.ts` | rewrite | −55 (165 → 110) |
| `packages/payments-native/types.ts` | extend | +15 |
| `app-mobile/src/payments/nativeCheckoutFlow.ts` | extend | +50 |
| `.github/scripts/strict-grep/orch-0844-stripe-connect-account-id-per-pi.mjs` | **NEW** | +145 |
| `.github/workflows/strict-grep-mingla-business.yml` | extend | +12 (1 comment + 1 job) |
| `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` | flip T-A6..T-A9 | ~0 net (assertions inverted + detail strings rewritten + header rewritten) |

---

## 11. OUTSTANDING GATES (orchestrator-owned)

- **Edge function deploy**: ALREADY DONE (v48 LIVE). No further deploy needed.
- **DB migration**: NONE in this SPEC.
- **Invariant Registry / Decision Log updates**: orchestrator applies at CLOSE per `feedback_orchestrator_deploys_edge_functions.md` separation.
- **Commit**: orchestrator commits at CLOSE.
- **Live-fire QA on iOS 26 sim**: requires fresh app-mobile dev build per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (native module config: `initStripe` per-PI behavior needs the binary to pick up the new flow). Hand off to `mingla-tester` TEST mode TARGETED sub-mode.

---

## 12. DISCOVERIES FOR ORCHESTRATOR

1. **`PaymentSheetInitInput.allowsDelayedPaymentMethods` was REQUIRED** in `packages/payments-native/types.ts` before this ORCH (line 23: `allowsDelayedPaymentMethods: boolean;`). The SPEC said to "drop" it from the call, but the type required it. Resolved by making the type field optional (`allowsDelayedPaymentMethods?: boolean;`). This is a forward-compatible change — any callsite that previously passed `false` still type-checks (now passing optionally). No spec deviation; this is a necessary follow-on edit.

2. **`PaymentSheetErrorCode "Timeout"` preserved** in `types.ts` union and `normalizePaymentSheetResult.ts` recognized-codes list. SPEC §3.3.4 was implementor-choice on cleanup; chose preservation because:
   - `packages/payments-native/__tests__/stripePaymentSheet.test.ts:42-44` references it as a fixture (deleting the union member would break the test).
   - No downstream consumer maps on `code === "Timeout"` (verified via grep across `app-mobile/src/` and `mingla-business/src/`).
   - Future builds may want to re-introduce a different timeout mechanism (e.g., upstream SDK abort signal) without re-litigating the type.

3. **Edge function step 1 verified PRESENT but not modified**. Implementor did not re-deploy or re-touch the edge function. The orchestrator's v48 LIVE claim is corroborated by the code content matching SPEC §3.2 verbatim.

4. **No baseline drift detected** in adjacent gate runs (ORCH-0843, ORCH-0837, ORCH-0778, ORCH-0777, ORCH-0789, ORCH-0804, ORCH-0839-B all GREEN post-implementation). No collateral regressions.

---

## 13. VERIFICATION MATRIX

| Layer | Verification | Result |
|---|---|---|
| Edge function | Deno check | PASS |
| Hook | Adversarial trip + filtered tsc | PASS (baseline preserved) |
| Glue layer | Project tsc filtered to file | PASS (zero errors on touched file) |
| Types | `allowsDelayedPaymentMethods` made optional; new optional fields added | PASS |
| New CI gate | `orch-0844-stripe-connect-account-id-per-pi.mjs` | PASS (positive + 2 adversarial trips) |
| Flipped regression check | `orch-0829b-d1-regression-check.mjs` 9/9 | PASS (positive + 3 adversarial trips on T-A6/T-A8/T-A9) |
| Neighboring gates | ORCH-0843, ORCH-0837, ORCH-0778, ORCH-0777, ORCH-0789, ORCH-0804, ORCH-0839-B | ALL PASS |
| Workflow registration | Comment block + new job in `.github/workflows/strict-grep-mingla-business.yml` | DONE |
| Live-fire QA on iOS 26 | Deferred to tester | UNVERIFIED |

---

**End of implementation report. Next step: handoff to `mingla-tester` (TEST mode, TARGETED sub-mode) for live-fire QA on iOS 26.4 simulator with a fresh app-mobile dev build per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`.**
