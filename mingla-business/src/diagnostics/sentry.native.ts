/**
 * Sentry platform shim — NATIVE side (iOS / Android).
 *
 * Re-exports the real `@sentry/react-native` SDK. Metro auto-resolves this
 * file on iOS + Android via the `.native.ts` extension; web bundles fall
 * through to `./sentry.ts` (no-op stubs).
 *
 * Why this split exists (root-cause fix from ORCH-0886, 2026-05-19):
 * importing `@sentry/react-native` at module top in `app/_layout.tsx`
 * transitively pulls in `@sentry/browser`, whose deep integrations touch
 * `window` at module-load time. Expo Router's static-SSR pass evaluates
 * the bundle in Node (no `window`) and crashes with `window is not defined`
 * before any React renders. Web does not need real Sentry yet (no web users
 * beyond Vercel preview + buyer-anon routes), so we stub it on web.
 *
 * Mirrors the same precedent used for `StripeProviderWrapper.native.tsx`
 * vs `StripeProviderWrapper.tsx`.
 *
 * Public surface — must stay in sync with `./sentry.ts`:
 *   - init(options)
 *   - captureException(error, context?)
 *   - addBreadcrumb(breadcrumb)
 * If a future caller uses another Sentry API, add the stub to `./sentry.ts`
 * AND re-export it here from `@sentry/react-native`.
 */

export {
  init,
  captureException,
  addBreadcrumb,
} from "@sentry/react-native";
