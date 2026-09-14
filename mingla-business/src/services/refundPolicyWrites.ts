/**
 * issue #3284 [bundle budget] — the ONLY way app code reaches the refund policy
 * writers.
 *
 * `refundPolicyService.ts` holds the Supabase writers for trip refund terms, the
 * trip booking deadline, and event and experience refund terms. Several lazy
 * business-web chunks save refund terms (event create and live edit, experience
 * create and edit, the trip wizard), and Metro places any module that two lazy
 * chunks import statically in the boot payload every visitor downloads
 * (`__common`, ORCH-1083). So callers import these wrappers, and the writers load
 * in their own chunk the first time a save runs, the same way EditPublishedScreen
 * loads the #2009 visibility owner.
 *
 * Each wrapper keeps its writer's signature and failure contract:
 * - `setOfferingRefundPolicy` never throws. A writer chunk that cannot load comes
 *   back as `network_error`, the result the writer itself returns when its request
 *   never reaches the server, so the organiser sees the same copy.
 * - `updateRefundPolicy` / `updateBookingDeadline` throw a RefundPolicyServiceError.
 *   A chunk that cannot load throws the writer's own fallback for a failed
 *   request (`internal_error`, "Couldn't save policy. Try again.").
 * The failure is reported through reportNonFatal (loaded on that path only).
 * Nothing is written, and the next save loads the chunk again.
 */

import type {
  RefundPolicy,
  RefundPolicyServiceError,
  SetOfferingRefundPolicyResult,
} from "./refundPolicyModel";

type RefundPolicyWriters = typeof import("./refundPolicyService");

async function withWriters<T>(
  write: (writers: RefundPolicyWriters) => Promise<T>,
  onLoadFailure: (detail: string) => T,
): Promise<T> {
  let writers: RefundPolicyWriters;
  try {
    writers = await import("./refundPolicyService");
  } catch (thrown) {
    // The reporter loads only on this failure path: statically it would pull the
    // native Sentry SDK into every screen that saves refund terms, including the
    // native render suites that mount them.
    await import("../diagnostics/reportNonFatal").then(
      ({ reportNonFatal }) => reportNonFatal("refundPolicyWrites", thrown),
      () => undefined,
    );
    return onLoadFailure(
      `writer chunk failed to load: ${
        thrown instanceof Error ? thrown.message : String(thrown)
      }`,
    );
  }
  return write(writers);
}

const throwTripWriterLoadFailure = (detail: string): never => {
  const error = new Error("Couldn't save policy. Try again.") as RefundPolicyServiceError;
  error.code = "internal_error";
  error.detail = detail;
  throw error;
};

/** Lazy `setOfferingRefundPolicy`: same arguments, same never-throwing result. */
export const setOfferingRefundPolicy = (
  eventId: string,
  policy: RefundPolicy | null,
  reason: string | null,
): Promise<SetOfferingRefundPolicyResult> =>
  withWriters<SetOfferingRefundPolicyResult>(
    (writers) => writers.setOfferingRefundPolicy(eventId, policy, reason),
    (detail) => ({ ok: false, reason: "network_error", detail }),
  );

/** Lazy trip `updateRefundPolicy`: same arguments, same typed throw. */
export const updateRefundPolicy = (
  eventId: string,
  policy: RefundPolicy | null,
): Promise<void> =>
  withWriters((writers) => writers.updateRefundPolicy(eventId, policy), throwTripWriterLoadFailure);

/** Lazy trip `updateBookingDeadline`: same arguments, same typed throw. */
export const updateBookingDeadline = (
  eventId: string,
  deadlineIso: string | null,
): Promise<void> =>
  withWriters(
    (writers) => writers.updateBookingDeadline(eventId, deadlineIso),
    throwTripWriterLoadFailure,
  );
