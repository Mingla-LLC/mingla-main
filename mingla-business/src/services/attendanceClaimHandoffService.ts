/**
 * attendanceClaimHandoffService — issue #3524.
 *
 * The buyer-web client for `attendance-claim-handoff`. It asks the server to
 * mint a short-lived desktop→phone exchange code and returns the URL the QR
 * encodes.
 *
 * THE CLAIM TOKEN GOES UP AND NEVER COMES BACK DOWN. The request carries the
 * token out of the email fragment, because that is the credential that proves
 * this caller was sent the confirmation. The response carries only a URL holding
 * a DIFFERENT credential, good for ten minutes and one use. Nothing in this file
 * renders, logs or stores either one.
 *
 * Errors are returned, never thrown: this runs on a page whose one job is to get
 * a guest into the app, and an unhandled rejection there is a blank sheet. The
 * caller renders a state for every result.
 */

import { supabase } from "./supabase";

export type AttendanceClaimHandoffRequest = {
  version: 1;
  kind: "order" | "rsvp";
  eventId: string;
  sourceId: string;
  token: string;
};

export type AttendanceClaimHandoffResult =
  | { ok: true; handoffUrl: string; expiresInSeconds: number }
  /**
   * `reason` drives which sheet state the guest sees:
   *   rate       — too many codes for this ticket; wait.
   *   expired    — the emailed link itself aged out (30 days).
   *   ineligible — the order is already claimed, or the event is over.
   *   invalid    — the fragment is not a usable claim.
   *   network    — we could not reach the server at all.
   */
  | {
    ok: false;
    reason: "rate" | "expired" | "ineligible" | "invalid" | "network";
    retryAfterSeconds: number | null;
  };

const FAILURE_BY_ERROR: Record<
  string,
  "rate" | "expired" | "ineligible" | "invalid"
> = {
  handoff_rate_limited: "rate",
  claim_expired: "expired",
  handoff_ineligible: "ineligible",
  handoff_invalid: "invalid",
};

export const mintAttendanceClaimHandoff = async (
  input: AttendanceClaimHandoffRequest,
): Promise<AttendanceClaimHandoffResult> => {
  try {
    const { data, error } = await supabase.functions.invoke(
      "attendance-claim-handoff",
      {
        body: {
          version: 1,
          kind: input.kind,
          eventId: input.eventId,
          sourceId: input.sourceId,
          token: input.token,
        },
      },
    );
    // `functions.invoke` reports a non-2xx as an error and does not hand back the
    // parsed body, so read the shape we do get and fall back to `invalid` rather
    // than guessing. `invalid` is the safe default: it tells the guest the link
    // cannot be used and offers them the identity rail, which always works.
    if (error) {
      const payload = (data ?? {}) as { error?: unknown };
      const code = typeof payload.error === "string" ? payload.error : null;
      const reason = code !== null ? FAILURE_BY_ERROR[code] : undefined;
      return {
        ok: false,
        reason: reason ?? "network",
        retryAfterSeconds: null,
      };
    }
    const payload = (data ?? {}) as {
      ok?: unknown;
      handoffUrl?: unknown;
      expiresInSeconds?: unknown;
      error?: unknown;
    };
    if (payload.ok === true && typeof payload.handoffUrl === "string") {
      return {
        ok: true,
        handoffUrl: payload.handoffUrl,
        expiresInSeconds: typeof payload.expiresInSeconds === "number"
          ? payload.expiresInSeconds
          : 600,
      };
    }
    const code = typeof payload.error === "string" ? payload.error : null;
    const reason = code !== null ? FAILURE_BY_ERROR[code] : undefined;
    return { ok: false, reason: reason ?? "invalid", retryAfterSeconds: null };
  } catch {
    return { ok: false, reason: "network", retryAfterSeconds: null };
  }
};
