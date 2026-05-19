/**
 * Sentry platform shim — WEB side (and default fallback).
 *
 * No-op stubs that match the surface the codebase actually calls. Metro
 * picks `./sentry.native.ts` on iOS + Android (real SDK); web bundles
 * fall through to this file (stubs only).
 *
 * Why this stub exists (root-cause fix from ORCH-0886, 2026-05-19):
 * `@sentry/react-native` transitively imports `@sentry/browser`, whose
 * deep integrations touch `window` at module-load. That crashes Expo
 * Router's static-SSR pass in Node before any React renders. By routing
 * the import through this platform-split, web never loads the real SDK.
 *
 * Observable behavior change on web:
 * - No error reporting from the web bundle (Vercel preview + buyer-anon
 *   routes /b/{slug}, /checkout/{eventId}, /e/{brand}/{event} no longer
 *   send to Sentry). Acceptable trade-off today — no production web users
 *   yet. A future ORCH can add `@sentry/browser` as a direct web-only dep
 *   if buyer-route error coverage becomes needed.
 *
 * Mirrors the same precedent used for `StripeProviderWrapper.tsx` (web
 * Fragment passthrough vs the native real provider).
 *
 * Public surface — must stay in sync with `./sentry.native.ts`:
 *   - init(options)
 *   - captureException(error, context?)
 *   - addBreadcrumb(breadcrumb)
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

export function init(_options?: unknown): void {
  // no-op on web
}

export function captureException(_error: unknown, _context?: unknown): string {
  // no-op on web; real SDK returns the event id, we return empty string
  return "";
}

export function addBreadcrumb(_breadcrumb: unknown): void {
  // no-op on web
}
