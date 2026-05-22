/**
 * ORCH-0896 [Stripe forwardRef RedBox under React 19.1] — side-effect module
 * (mingla-business mirror of app-mobile/src/diagnostics/silenceStripeForwardRef.ts).
 *
 * Silences the React 19.1 console.error fired at module-load time by
 * @stripe/stripe-react-native@^0.65.1's PaymentMethodMessagingElement.js,
 * which uses single-arg `forwardRef(function(_ref){...})` instead of React
 * 19's required two-arg form. React 19's stricter dev-mode arity check
 * escalates the warning into a Console Error overlay that crowds out real
 * diagnostic logs.
 *
 * Why this file exists (not just LogBox.ignoreLogs at _layout.tsx top level):
 *
 * ES module imports are hoisted — the engine evaluates ALL `import`
 * statements in source order BEFORE any top-level statement runs. So calling
 * LogBox.ignoreLogs AFTER the StripeProviderWrapper import is too late: the
 * warning already fired during the Stripe RN module's load.
 *
 * Solution: this side-effect file's top-level LogBox.ignoreLogs call runs
 * at its import position. Import this file FIRST (before
 * src/payments/StripeProviderWrapper) and the filter is armed in time.
 *
 * Remove once @stripe/stripe-react-native ships 0.66+ with the malformed
 * forwardRef call fixed. Tracked under ORCH-0896 [Stripe forwardRef RedBox]
 * in WORLD_MAP carry-forward list.
 */

import { LogBox } from "react-native";

LogBox.ignoreLogs([
  /forwardRef render functions accept exactly two parameters/,
]);
