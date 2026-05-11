# IMPLEMENTATION ORCH-0778 — ORCH-0777 Web Export Stripe Native Import Gate

Status: implemented and verified
Date: 2026-05-10
Working tree: `.worktrees/orch-0778-orch0777-web-export-stripe-import/`

## Summary

ORCH-0778 fixes discovery `D-0776D-QA-1`: ORCH-0777 placed Stripe React Native PaymentSheet imports on the Expo web bundle path, causing `npx expo export --platform web` to fail on `react-native/Libraries/Utilities/codegenNativeComponent`.

The fix moves Stripe React Native imports behind Expo platform files:

- `mingla-business/src/payments/StripeNativeProvider.native.tsx`
- `mingla-business/src/payments/stripePaymentSheet.native.ts`

Web resolves to safe no-op/unsupported modules:

- `mingla-business/src/payments/StripeNativeProvider.web.tsx`
- `mingla-business/src/payments/stripePaymentSheet.web.ts`

The checkout payment route now preserves native PaymentSheet behavior and gives web users an honest unsupported-payment message without creating fake checkout success or importing native Stripe code.

## Scope Note

The requested worktree did not exist when implementation began, and main had the ORCH-0777 checkout state as pending local files. I created the named worktree from current `HEAD`, then copied only the ORCH-0777 checkout/frontend files needed to reproduce and fix the import boundary inside the isolated worktree. I did not copy ORCH-0777 Supabase migrations, edge functions, B2 QR credential RLS, scanner logic, live-fire config, Resend/Twilio implementation, or operator config.

## Files Changed

ORCH-0778 direct changes:

- `mingla-business/app/_layout.tsx`
  - Replaced root static Stripe provider usage with `StripeNativeProvider`.
- `mingla-business/app/checkout/[eventId]/payment.tsx`
  - Replaced static `useStripe` import with `useStripePaymentSheet`.
  - Native keeps the production checkout path: create checkout session, initialize PaymentSheet, present PaymentSheet, poll server status, record server-issued tickets.
  - Web returns an unsupported-payment state and does not create a checkout session or fake success.
- `mingla-business/src/payments/StripeNativeProvider.tsx`
- `mingla-business/src/payments/StripeNativeProvider.web.tsx`
- `mingla-business/src/payments/StripeNativeProvider.native.tsx`
- `mingla-business/src/payments/stripePaymentSheet.ts`
- `mingla-business/src/payments/stripePaymentSheet.web.ts`
- `mingla-business/src/payments/stripePaymentSheet.native.ts`
- `.github/scripts/strict-grep/orch-0778-web-stripe-native-import-gate.mjs`
  - New regression guard: `@stripe/stripe-react-native` may only be imported by the two `.native` payment boundary files.
- `mingla-business/package.json`
  - Added `test:orch-0778`.

Seeded ORCH-0777 checkout/frontend inputs present in this worktree because the requested worktree was absent:

- `mingla-business/app/checkout/[eventId]/buyer.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/src/components/checkout/CartContext.tsx`
- `mingla-business/src/components/checkout/TicketQrCarousel.tsx`
- `mingla-business/src/services/ticketCheckoutService.ts`
- `mingla-business/src/services/__tests__/ticketCheckoutService.test.ts`
- `mingla-business/src/utils/phone.ts`
- `mingla-business/src/utils/__tests__/phone.test.ts`

Reference artifacts copied into the worktree so downstream QA has the dispatch context:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0778_ORCH0777_WEB_EXPORT_STRIPE_NATIVE_IMPORT_GATE.md`
- `Mingla_Artifacts/reports/QA_ORCH-0776D_EVENT_COVER_VIDEO_CANCELLED_AT_AND_DETAIL_DEPLOY.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_SALES_AND_BUYER_NOTIFICATIONS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0777_PRODUCTION_TICKET_CHECKOUT_REWORK.md`

## Root Cause

`D-0776D-QA-1` proved web export failed because `app/checkout/[eventId]/payment.tsx` statically imported `@stripe/stripe-react-native`. That package imports native-only React Native form modules, which import `react-native/Libraries/Utilities/codegenNativeComponent`; Metro cannot include that native-only module in the web bundle.

The root layout also needed the same boundary once ORCH-0777 introduced a Stripe provider. Leaving either route/layout import static would keep the web bundle vulnerable.

## Platform-Gating Design

`app/_layout.tsx` imports `StripeNativeProvider` from `src/payments/StripeNativeProvider`.

- Native resolution uses `StripeNativeProvider.native.tsx`, which imports `StripeProvider` from `@stripe/stripe-react-native` and passes the configured publishable key.
- Web resolution uses `StripeNativeProvider.web.tsx`, which renders children directly and imports no Stripe native code.

`payment.tsx` imports `useStripePaymentSheet` from `src/payments/stripePaymentSheet`.

- Native resolution uses `stripePaymentSheet.native.ts`, which calls Stripe React Native `useStripe()` and returns `initPaymentSheet` / `presentPaymentSheet`.
- Web resolution uses `stripePaymentSheet.web.ts`, which reports `isPaymentSheetSupported: false` and returns unsupported errors.

The base files provide TypeScript-compatible exports without importing Stripe React Native. The `.native` files are the only allowed native import points.

## Native Behavior Preservation

Native iOS/Android still use the ORCH-0777 production flow:

1. `createTicketCheckout({ eventId, buyer, lines })`
2. Require `checkout.kind === "requires_payment"`
3. `initPaymentSheet({ merchantDisplayName: "Mingla", paymentIntentClientSecret, allowsDelayedPaymentMethods: false })`
4. `presentPaymentSheet()`
5. Poll `pollTicketCheckoutStatus(checkoutSessionId, buyerStatusToken)`
6. Record server-issued order and ticket data, then route to `/confirm`

The only new branch is `if (!isPaymentSheetSupported)`, which is false on native and true on web.

## Web Behavior

Web checkout payment is explicitly unsupported for paid ticket PaymentSheet. The payment card says:

> Ticket payments are not available on web yet. Please complete checkout in the Mingla Business mobile app.

Pressing Pay on web sets the same error message and returns before `createTicketCheckout`, so web does not create a backend checkout session, does not mark an order paid, and does not route to confirmation.

## Regression Gate

Added command:

```bash
npm run test:orch-0778
```

The script scans `mingla-business/app` and `mingla-business/src` for static or dynamic imports of `@stripe/stripe-react-native`. It allows exactly:

- `mingla-business/src/payments/StripeNativeProvider.native.tsx`
- `mingla-business/src/payments/stripePaymentSheet.native.ts`

Why it fails before the fix:

- ORCH-0777 `payment.tsx` imported `useStripe` directly from `@stripe/stripe-react-native`.
- ORCH-0777 root layout imported `StripeProvider` directly from `@stripe/stripe-react-native`.

Why it passes after the fix:

- Both route/layout files import only local platform-boundary modules.
- The only direct Stripe React Native imports live in `.native` files.

## Verification

Commands run from `.worktrees/orch-0778-orch0777-web-export-stripe-import/mingla-business` unless noted.

| Command | Result | Notes |
|---|---:|---|
| `npm install` | PASS | Installed 1116 packages. npm reported 8 audit findings (6 moderate, 2 high); not introduced or remediated by this ORCH. |
| `npm run test:orch-0778` | PASS | `ORCH-0778 web Stripe native import gate passed.` |
| `npx expo export --platform web` | PASS | Exported 44 static routes including `/checkout/[eventId]/payment`; no `codegenNativeComponent` failure. Sentry config warning and Stripe ConnectJS SSR warning were non-fatal. |
| `npx tsc --noEmit` | PASS | Clean after dependency install and native provider typing fix. |
| `npx jest phone.test ticketCheckoutService.test --runInBand` | PASS | 2 suites, 3 tests passed. Watchman recrawl warning only. |
| `git diff --check` from worktree root | PASS | No whitespace errors. |

Attempted but not used as the final regression gate:

| Command | Result | Notes |
|---|---:|---|
| `npm run test:orch-0777` | NOT RUNNABLE IN THIS RECOVERED WORKTREE | During worktree recovery, this failed with `ENOENT` for `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` because the requested worktree did not exist and only checkout/frontend ORCH-0777 inputs were brought into this isolated worktree. I did not broaden ORCH-0778 by copying ORCH-0777 migrations/functions/B2 files. Downstream QA should run the full ORCH-0777 gate on the canonical ORCH-0777 integration state if that gate is required for close. |

## Invariants And Guards

| Guard | Status | Evidence |
|---|---:|---|
| Preserve native iOS/Android Stripe behavior | PASS | Native `.native` hook still delegates to Stripe React Native `useStripe()` and the payment screen still initializes/presents PaymentSheet. |
| Do not fake checkout success | PASS | Web unsupported branch returns before checkout creation; native success still requires server-backed status with order data. |
| Do not broaden into ORCH-0777 live-fire/config/B2 | PASS | No Supabase migrations, edge functions, scanner logic, Stripe webhook config, Resend/Twilio, or B2 QR credential RLS changes were made. |
| Web export no longer fails on Stripe native import | PASS | `npx expo export --platform web` completed successfully. |
| Repo-running regression gate included | PASS | `npm run test:orch-0778`. |

## Residual Risks

- This implementation was done in a recovered worktree because the requested worktree path did not exist at dispatch time. The ORCH-0778 code path is verified, but downstream QA should be aware that ORCH-0777 backend/live-fire files were intentionally not copied into this branch.
- Web paid checkout remains unsupported by design. A future ORCH can add a Stripe web checkout flow; this fix only prevents native Stripe modules from entering the web bundle.
- Native simulator/manual PaymentSheet smoke was not run in this turn. Static and TypeScript evidence show native delegates to the same Stripe React Native APIs, but tester should run iOS/Android checkout smoke as part of independent QA.

## Tester Focus

1. Re-run `npm run test:orch-0778`.
2. Re-run `npx expo export --platform web` and confirm the previous `codegenNativeComponent` failure is gone.
3. Inspect the bundled source/import graph enough to confirm `@stripe/stripe-react-native` is reachable only through `.native` files.
4. Smoke native iOS/Android paid checkout to ensure PaymentSheet still initializes and presents.
5. Confirm web paid checkout is honest unsupported behavior and does not route to confirmation or create fake success.

