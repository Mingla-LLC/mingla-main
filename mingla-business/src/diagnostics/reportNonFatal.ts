/**
 * #426 PR2 — Report non-fatal errors without aborting the caller flow.
 *
 * Always emits a console warning (I-NO-SILENT-FAILURES). When Sentry is
 * configured (native), also captures the exception for observability.
 */

import { captureException } from "./sentry";

export function reportNonFatal(
  scope: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[${scope}]`, message, extra ?? "");
  if (error instanceof Error) {
    captureException(error, { tags: { scope }, extra });
  }
}
