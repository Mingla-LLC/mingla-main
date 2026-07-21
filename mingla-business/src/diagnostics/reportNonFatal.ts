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
      captureException(
        error,
        fingerprint
          ? { tags: { scope }, extra, fingerprint }
          : { tags: { scope }, extra },
      );
    }
  } catch {
    // Silent by design (#1044) — see the header. Telemetry must never break a
    // caller, and must never become the noise it exists to prevent.
  }
}
