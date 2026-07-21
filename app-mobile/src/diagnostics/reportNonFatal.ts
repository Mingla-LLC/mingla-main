/**
 * #1044 [auth-failure-sentry-capture] — consumer mirror of
 * `mingla-business/src/diagnostics/reportNonFatal.ts`. Same name, same
 * signature, same parameter order, same body semantics, so both apps share ONE
 * idiom for "report this without aborting the caller".
 *
 * WHY THE IMPORT DIFFERS FROM THE BUSINESS MIRROR — the one deliberate
 * divergence. mingla-business renders on web as well as native, so it routes
 * Sentry through a `sentry.ts` / `sentry.native.ts` platform split: importing
 * `@sentry/react-native` transitively pulls in `@sentry/browser`, whose deep
 * integrations touch `window` at module load and crash Expo Router's static-SSR
 * pass in Node (root-cause fix, ORCH-0886). app-mobile is native-only — no web
 * bundle, no SSR pass, no such split exists here — so it imports
 * `captureException` straight from `@sentry/react-native`. That is the existing
 * precedent in this app (`src/components/profile/circle/YourCircleSection.tsx`).
 * Do NOT add a platform shim here; that would be new infrastructure this app
 * has no use for.
 *
 * Behaviour:
 *  - `console.warn` ALWAYS (I-NO-SILENT-FAILURES).
 *  - `captureException` only for real `Error` instances.
 *  - Optional `fingerprint` controls Sentry grouping. #1044 groups auth failures
 *    by provider + code, because Google's messages vary by device locale and GMS
 *    version and message-based grouping would shatter one systemic outage into
 *    dozens of issues — the failure mode that would have made #1038 hard to spot
 *    even with capture enabled.
 *  - The WHOLE body is wrapped in a silent internal try/catch. This helper is
 *    called from the sign-in catch blocks; a throw out of telemetry would escape
 *    into the auth path and change what the user sees. Telemetry must NEVER be
 *    able to break a caller. The swallow is silent by design — a reporting helper
 *    that loudly logs its own failure becomes the noise it exists to prevent.
 *
 * HARD CONSTRAINTS for anyone editing this file:
 *  - MUST NOT call `Sentry.init` — I-SENTRY-SINGLE-INIT. The single init lives in
 *    `app/_layout.tsx` and is CI-gated by `scripts/ci/check-single-sentry-init.sh`.
 *  - MUST NOT re-export the SDK.
 *  - MUST NOT import `logger` — its breadcrumb buffer is `__DEV__`-only
 *    (`src/utils/breadcrumbs.ts`), so in production it reports nothing. That
 *    illusion of instrumentation is half of why #1038 stayed invisible.
 */

import { captureException } from "@sentry/react-native";

export function reportNonFatal(
  scope: string,
  error: unknown,
  extra?: Record<string, unknown>,
  fingerprint?: string[],
): void {
  try {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${scope}]`, message, extra ?? "");
    if (error instanceof Error) {
      const captureResult = captureException(
        error,
        fingerprint
          ? { tags: { scope }, extra, fingerprint }
          : { tags: { scope }, extra },
      );
      // #1044 — close the ASYNC escape hatch. The try/catch above only contains
      // SYNCHRONOUS throws. `captureException` is synchronous today (it returns
      // a string event id), so this branch does not run; but if a future SDK
      // returned a Promise, a rejection would escape the helper as an UNHANDLED
      // REJECTION — the one failure mode the guard above cannot see. Attach a
      // no-op rejection handler and do NOT await it, so the reporter stays
      // non-blocking and enqueue-only (SPEC §4.6.2).
      //
      // Narrowed to genuine `Promise` instances on purpose: invoking `.then` on
      // an arbitrary object handed back by a third-party SDK would run foreign
      // code from inside a telemetry helper whose whole contract is that it
      // cannot affect its caller. `constructor === Promise` rather than
      // `instanceof Promise` because this body is also executed as PLAIN JS by
      // the regression harnesses (they slice it and run it through
      // `new Function`), so it must contain no TypeScript-only syntax — and
      // `captureException` is declared to return `string`, which makes
      // `instanceof` itself a type error (TS2358).
      if (captureResult && captureResult.constructor === Promise) {
        void Promise.resolve(captureResult).catch(() => {});
      }
    }
  } catch {
    // Silent by design (#1044) — see the header. Telemetry must never break a
    // caller, and must never become the noise it exists to prevent.
  }
}
