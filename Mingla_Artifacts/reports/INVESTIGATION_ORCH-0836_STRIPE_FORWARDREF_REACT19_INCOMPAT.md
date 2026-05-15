# INVESTIGATION — ORCH-0836: Stripe RN 0.65.1 `forwardRef` warning at app boot on React 19.1.0

**Mode:** INVESTIGATE (bundled with ORCH-0835)
**Investigator:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Confidence:** **Proven** at source level (the malformed forwardRef call site is verbatim in the installed package). Causality to the separate PaymentSheet hang: **proven UNRELATED**.

---

## SYMPTOM SUMMARY

| | What happened |
|---|---|
| **Expected** | App boots without React warnings, Stripe imports cleanly |
| **Actual (operator's real iPhone, EAS build with Stripe RN 0.65.1)** | At boot, RN logs: `ERROR forwardRef render functions accept exactly two parameters: props and ref. %s Did you forget to use the ref parameter?` with call stack pointing at `packages/payments-native/StripeNativeProvider.tsx:27` (the `import { StripeProvider } from "@stripe/stripe-react-native"` line) |
| **Operator's hypothesis (Plan Z3)** | The warning IS the bug — if `StripeProvider` is broken at render time on React 19, that could cascade into `PaymentSheet` failing to mount → the 60s hang we've been seeing |

---

## ROOT CAUSE — 🔴 PROVEN

### File + line

`app-mobile/node_modules/@stripe/stripe-react-native/lib/module/components/PaymentMethodMessagingElement.js` (single-line minified output of `src/components/PaymentMethodMessagingElement.tsx`)

### Exact code (verbatim)

```js
var PaymentMethodMessagingElement = exports.PaymentMethodMessagingElement =
  (0, _react.forwardRef)(function (_ref) {
    var appearance = _ref.appearance,
        configuration = _ref.configuration,
        onStateChange = _ref.onStateChange,
        props = (0, _objectWithoutProperties2.default)(_ref, _excluded);
    var viewRef = (0, _react.useRef)(null);
    // ... renders <_NativePaymentMethodMessagingElement.default ... {ref: viewRef} />
  });
```

### What it does

The forwardRef render function accepts only **one** parameter (`_ref` = props). It does not accept the `ref` parameter at all — the component uses its own internal `viewRef` and never forwards the outer ref. React's contract is that the render function for `forwardRef` MUST accept exactly two parameters: `(props, ref)`.

### What it should do

```js
forwardRef(function (_ref, ref) { /* use ref */ })
```

OR — if the outer ref genuinely isn't needed — drop `forwardRef` entirely and use a plain `React.FC`.

### Causal chain (warning is real)

1. App boot → `app/_layout.tsx` mounts `<StripeNativeProvider>` from `packages/payments-native/StripeNativeProvider.tsx:27`.
2. That file does `import { StripeProvider } from "@stripe/stripe-react-native"` — destructuring a single named export.
3. CommonJS module evaluation: Node's resolver evaluates the **entire** `@stripe/stripe-react-native/lib/commonjs/index.js` module (not just the requested export). The index file at line 1 does:
   ```js
   var _PaymentMethodMessagingElement = require("./components/PaymentMethodMessagingElement");
   ```
   → triggers evaluation of `PaymentMethodMessagingElement.js`.
4. `PaymentMethodMessagingElement.js` executes the malformed `forwardRef(function (_ref) { ... })` call at module top level.
5. React 19.1.0's `forwardRef` runtime validates the render-function arity. React 18.x logged this same complaint in DEV only and never enforced; **React 19 enforces it more strictly in dev mode** and surfaces it via the global `console.error` channel that RN routes to Metro logs.
6. Metro shows: `ERROR forwardRef render functions accept exactly two parameters...` with the call stack walking back to the import line at `StripeNativeProvider.tsx:27`.

### Verification step

```bash
grep -n "forwardRef" /Users/sethogieva/Desktop/mingla-main/app-mobile/node_modules/@stripe/stripe-react-native/lib/module/components/*.js
```

Yields three matches: `CardForm.js`, `CardField.js`, `PaymentMethodMessagingElement.js`. The first two use `forwardRef(function (_ref, ref) {...})` (correct two-param shape). The third uses `forwardRef(function (_ref) {...})` (malformed one-param shape). Diff is direct evidence of the bug.

Stripe RN's source TSX confirms this — line in `src/components/PaymentMethodMessagingElement.tsx` (visible via the bundled sourceMap path `_jsxFileName="/Users/tjclawson/stripe/stripe-react-native/src/components/PaymentMethodMessagingElement.tsx"`) is a long-standing bug in their codebase that React 18 tolerated. React 19's stricter dev mode surfaces it.

---

## CAUSAL CHAIN TO THE PAYMENTSHEET HANG — 🔴 PROVEN: NO RELATIONSHIP

The operator's Plan Z3 hypothesis was: "if StripeProvider is broken at render time on React 19, that could cascade into PaymentSheet failing to mount." This is **falsified** by three independent pieces of evidence.

### Evidence 1 — Mingla never renders `<PaymentMethodMessagingElement>`

```bash
grep -rn "PaymentMethodMessagingElement" /Users/sethogieva/Desktop/mingla-main/app-mobile/src/ /Users/sethogieva/Desktop/mingla-main/packages/ /Users/sethogieva/Desktop/mingla-main/mingla-business/src/
```

Zero matches across consumer mobile, business mobile, and the shared packages. The malformed component is exported from Stripe RN's index but never instantiated by Mingla code. The warning fires once at module-load (when React's forwardRef factory validates arity) and is then quiescent. It does not re-fire on subsequent renders, and it does not block any code path.

### Evidence 2 — PaymentSheet flow uses a hook, not a forwardRef'd component

`useStripePaymentSheet()` in `packages/payments-native/useStripePaymentSheet.ts` calls `usePaymentSheet()` from `@stripe/stripe-react-native`. That hook resolves to `lib/module/hooks/usePaymentSheet.js`, which:
- Imports `_react.useState`, `_react.useCallback`, and the `_NativeStripeSdkModule` spec
- Returns `{ initPaymentSheet, presentPaymentSheet, loading, ... }` functions that bridge JS → native via TurboModule

The path JS → `initPaymentSheet` → native module → UIKit modal does NOT touch `PaymentMethodMessagingElement` at any layer. Confirmed by reading `hooks/usePaymentSheet.js` and `components/StripeProvider.js`. The `StripeProvider` component itself is a plain `function StripeProvider({...})` (no `forwardRef`, no broken arity) — visible verbatim in `lib/module/components/StripeProvider.js`.

### Evidence 3 — The warning is `console.error`, not a thrown exception

React's `forwardRef` arity check uses `console.error(...)`. It does NOT throw, does NOT return null/undefined from the factory, and does NOT poison the component instance. The instance is created normally; only the warning is emitted. Subsequent renders proceed.

### Conclusion

The forwardRef warning is **real** (Stripe RN 0.65.1 has a long-standing source bug) and **annoying** (clutters Metro logs at boot), but it has **zero causal relationship** to the PaymentSheet hang documented in ORCH-0829-B / ORCH-0834-rescoped. The hang is a separate problem that must be investigated on its own merits. The Z3 path is a dead end.

---

## CLASSIFICATION

### 🔵 Observation O-1: Stripe RN 0.65.1 ships a malformed `forwardRef` on `PaymentMethodMessagingElement`

This is a defect in the third-party package, not in Mingla code. We cannot fix it from our side without forking Stripe RN. The correct path is to (a) ignore the warning since the component is unused, or (b) report it upstream to Stripe.

### 🔵 Observation O-2: Expo doctor flagged `@stripe/stripe-react-native expected 0.50.3 found 0.65.1`

```
expo doctor: @stripe/stripe-react-native expected 0.50.3 found 0.65.1
```

Expo SDK 54 has not validated 0.65.1 in its `bundledNativeModules.json`. This is a **contributing concern** but not a root cause — Expo SDK 54's validator is a soft warning (npx expo doctor would error-exit only on real ABI breaks). The bigger risk is that future Expo SDK upgrades may add lockstep validators that block our build. Track as a hidden flaw to monitor on the next Expo upgrade.

### 🟡 Hidden Flaw H-1: the operator's Plan A (SDK upgrade 0.50.3 → 0.65.1) did NOT fix the PaymentSheet hang

This was the entire premise of ORCH-0834-rescoped's Stripe upgrade portion. Operator's Metro log proves the hang persists on 0.65.1. The hang investigation needs to continue under a separate ORCH (likely ORCH-0837) — the candidate paths from the prior dispatch (Z1 revert + bridgeless toggle, Z2 keep 0.65.1 + bridgeless toggle) remain valid; Z3 is killed. **The investigation owes the operator a layman-terms summary that the SDK upgrade was the wrong lever, and a re-decision on Z1 vs Z2 vs X2 (CardField rewrite).**

---

## FIVE-LAYER CROSS-CHECK

| Layer | What it says | Matches reality? |
|---|---|---|
| **Docs** | Stripe RN 0.65.1 changelog says "Compatible with new architecture when bridgeless mode is disabled" — does not mention React 19 strictness | Inconsistent with React 19 dev-mode enforcement |
| **Schema** | N/A — pure client-side JS issue |  |
| **Code (Stripe RN package)** | `PaymentMethodMessagingElement.js` line 1 verbatim has `forwardRef(function(_ref){...})` — one parameter | **Proven defect** |
| **Code (Mingla consumers)** | Zero renders of `<PaymentMethodMessagingElement>` across app-mobile, packages, mingla-business | **Proven unused** |
| **Code (PaymentSheet path)** | `useStripePaymentSheet` → `usePaymentSheet` → `initPaymentSheet`/`presentPaymentSheet` — TurboModule-only path, no `PaymentMethodMessagingElement` involvement | **Proven decoupled** |
| **Runtime (operator's iPhone, post-EAS build)** | Warning fires at boot. `initPaymentSheet` resolves with `error= none`. `presentPaymentSheet → native call` then 60s silence then synthetic timeout error fires | **Hang is unrelated to warning** |
| **Data** | N/A |  |

No layer disagrees with the "warning is unrelated to hang" conclusion. All four code-layer probes converge.

---

## BLAST RADIUS

| Surface | Impact |
|---|---|
| **Consumer mobile** | Warning at boot only. Zero functional impact. |
| **Business mobile** | Same — also imports Stripe RN. Same warning will fire there on next build. |
| **PaymentSheet flow** | Hang is unrelated; will persist regardless of how the warning is addressed. |
| **Apple Pay** | Unchanged — Apple Pay is added via the StripeProvider's `merchantIdentifier` prop, not via PaymentMethodMessagingElement. |
| **Google Pay** | Unchanged — same reason. |
| **3DS** | Unchanged — same reason. |

---

## FIX STRATEGY DIRECTION (not a spec)

Two paths, both acceptable. Operator picks based on noise tolerance.

**Path A — Suppress the warning (zero code change):**
- Acknowledge in the implementation report and CLOSE memo that the warning is a known Stripe RN 0.65.1 source bug and is functionally inert.
- Continue using Stripe RN 0.65.1.
- File an upstream bug at https://github.com/stripe/stripe-react-native pointing at `src/components/PaymentMethodMessagingElement.tsx`.

**Path B — Suppress the warning + monkeypatch (one-line change):**
- Stripe RN's `index.ts` exports `PaymentMethodMessagingElement` — we could add a `console.error` filter at app entry that drops the specific forwardRef warning. RN provides `LogBox.ignoreLogs([/forwardRef render functions accept exactly two parameters/])` at app boot (`app/_layout.tsx`). One line, no impact on other errors.
- Same upstream report as Path A.

**Recommended: Path B** — one-line `LogBox.ignoreLogs` filter keeps Metro logs clean for ongoing debugging without altering behavior. Document in the implementation report that this is suppressing a third-party warning only.

**Critical follow-up (NOT in this spec's scope):** the PaymentSheet hang investigation must continue under a new ORCH-0837 because Plan A (SDK upgrade) did not fix it and Plan Z3 (this investigation) proved the warning is unrelated. The operator's prior three paths (Z1, Z2, X2) remain on the table; orchestrator should re-present them with the new context that Z3 is killed.

---

## REGRESSION PREVENTION

A CI gate that greps `node_modules/@stripe/stripe-react-native/lib/module/components/PaymentMethodMessagingElement.js` for `forwardRef(function ?\(_ref\)` and fails if found would catch this if Stripe ships a 0.66.x that fixes it (we'd want to remove the LogBox filter). Lightweight, lives in `app-mobile/scripts/ci/`.

---

## DISCOVERIES FOR ORCHESTRATOR

1. **Z3 is dead.** Reopen the Z1/Z2/X2 decision for the PaymentSheet hang under a new ORCH-0837.
2. **Expo SDK 54 has not validated Stripe RN 0.65.1.** Future Expo upgrade may force a Stripe RN downgrade or a different version. Track on the Cycle B5 / Mingla Brain upgrade plan.
3. **Stripe RN ships a real bug in PaymentMethodMessagingElement.** Worth filing upstream regardless of which path we take locally.

---

## CONFIDENCE

**Proven** at source level for the root cause (forwardRef arity defect in `PaymentMethodMessagingElement.js`).
**Proven** at source level for the negative conclusion (warning is decoupled from PaymentSheet hang).

The operator may, if desired, validate Path B by adding the LogBox filter and re-running the EAS build to confirm (a) the warning is gone, and (b) the PaymentSheet hang persists unchanged — which would close out this investigation by lived experience. But the source-side proof is sufficient on its own.
