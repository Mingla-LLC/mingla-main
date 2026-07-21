/**
 * #426 PR2 — Report non-fatal errors without aborting the caller flow.
 *
 * Always emits a console warning (I-NO-SILENT-FAILURES). When Sentry is
 * configured (native), also captures the exception for observability.
 *
 * #1044 [auth-failure-sentry-capture] — two additive hardenings, both required
 * because this helper is now called from the native sign-in catch blocks:
 *
 *  1. THE WHOLE BODY IS THROW-PROOF. `captureException` could in principle throw
 *     (non-serializable `extra`, SDK internal fault). From an auth catch block a
 *     throw would escape into the caller and change what the user sees — that is
 *     unacceptable on the entry point to the product. Telemetry must NEVER be
 *     able to break a caller. The swallow is deliberately SILENT: a reporting
 *     helper that loudly logs its own failure becomes the noise it exists to
 *     prevent. The `console.warn` above it stays (it is the half of
 *     I-NO-SILENT-FAILURES that still works on web, where captureException is a
 *     no-op stub).
 *
 *  2. OPTIONAL `fingerprint` — controls Sentry grouping. Google's error messages
 *     vary by device locale and GMS version, so message-based grouping would
 *     shatter one systemic outage into dozens of issues (#1038 would have been
 *     hard to spot even WITH capture enabled). Optional and defaulted to today's
 *     exact behaviour, so the three pre-existing callers are unaffected.
 *
 * Mirrored, deliberately, by `app-mobile/src/diagnostics/reportNonFatal.ts`.
 */

import { captureException } from "./sentry";

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
