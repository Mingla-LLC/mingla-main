/**
 * ORCH-0896 [Stripe forwardRef RedBox under React 19.1] — side-effect module.
 *
 * Silences the React 19.1 console.error fired at module-load time by
 * @stripe/stripe-react-native@^0.65.1's PaymentMethodMessagingElement.js,
 * which uses `forwardRef(function(_ref){...})` (single-arg) instead of the
 * React 19-required two-arg `forwardRef((props, ref) => ...)`. React 19's
 * stricter dev-mode arity check escalates this into a Console Error overlay
 * that crowds out real diagnostic logs and (per operator screenshot) shows
 * up as a RedBox-style "Console Error / Log 1 of 1" on every launch.
 *
 * Why this file exists (not just LogBox.ignoreLogs at _layout.tsx top level):
 *
 * ES module imports are hoisted — the engine evaluates ALL `import` statements
 * in source order BEFORE any top-level statement in the importing module
 * runs. So when app-mobile/app/_layout.tsx had:
 *
 *     import { LogBox } from "react-native";
 *     import { StripeNativeProvider } from "@mingla/payments-native";  // ← fires the warning
 *     LogBox.ignoreLogs([/forwardRef.../]);                            // ← too late
 *
 * the Stripe import evaluated `@stripe/stripe-react-native` and emitted the
 * console.error BEFORE LogBox.ignoreLogs ran. Filter registered, but only
 * for FUTURE matching errors — the one already-emitted error reached the
 * dev-menu overlay.
 *
 * The fix is to put LogBox.ignoreLogs in a side-effect file and import THAT
 * file BEFORE @mingla/payments-native. Module evaluation order: imports
 * evaluate in source order, and a side-effect file's top-level statements
 * fire at its import position. So:
 *
 *     import "../src/diagnostics/silenceStripeForwardRef";              // ← filter now armed
 *     import { StripeNativeProvider } from "@mingla/payments-native";   // ← warning silenced
 *
 * This file ships in both app-mobile and mingla-business — both apps use
 * the same @mingla/payments-native package which transitively imports the
 * problematic Stripe RN module.
 *
 * Remove this file (and the import in _layout.tsx) once @stripe/stripe-react-native
 * ships 0.66+ with the malformed forwardRef call fixed. Tracked under
 * ORCH-0896 [Stripe forwardRef RedBox] in WORLD_MAP carry-forward list
 * (originally flagged DISC-QA-0892-A-RETEST-2-2 during ORCH-0892-A close).
 */

import { LogBox } from "react-native";

// Match Stripe RN 0.65.1's exact message + the React 19.1 trailing question.
// Anchored to the unique forwardRef-arity phrase so this filter does not
// mask any Mingla-side forwardRef issues.
LogBox.ignoreLogs([
  /forwardRef render functions accept exactly two parameters/,
]);
