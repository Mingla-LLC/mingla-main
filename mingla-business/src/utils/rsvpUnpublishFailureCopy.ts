/**
 * #3645 — the one sentence a host sees when a published RSVP cannot go back to
 * draft. `unpublishRsvpToDraft` rejects with the PostgREST failure (wrapped in
 * `RsvpRpcError`), so the message is read with `readRpcFailureMessage`, which
 * understands both an `Error` and the bare PostgREST object.
 */

import {
  isMissingRpcFailure,
  readRpcFailureMessage,
} from "../services/rsvpRpcFailure";

export const RSVP_UNPUBLISH_HAS_COMMITMENTS_COPY =
  "Guests have already responded, so this RSVP can't go back to draft. Cancel it instead.";

export const RSVP_UNPUBLISH_STARTED_COPY =
  "This RSVP has already started, so it can't go back to draft.";

export const RSVP_UNPUBLISH_NOT_ALLOWED_COPY =
  "You don't have permission to return this RSVP to draft.";

/** The app reached a database that does not have the function yet. */
export const RSVP_UNPUBLISH_UNAVAILABLE_COPY =
  "Returning an RSVP to draft isn't available yet. Nothing was changed. Please try again later.";

export const RSVP_UNPUBLISH_FAILED_COPY =
  "Couldn't return this RSVP to draft. Try again.";

export const rsvpUnpublishFailureCopy = (error: unknown): string => {
  const message = readRpcFailureMessage(error);
  if (message.includes("rsvp_unpublish_has_commitments")) {
    return RSVP_UNPUBLISH_HAS_COMMITMENTS_COPY;
  }
  if (message.includes("rsvp_unpublish_not_future")) {
    return RSVP_UNPUBLISH_STARTED_COPY;
  }
  if (message.includes("insufficient_event_permission")) {
    return RSVP_UNPUBLISH_NOT_ALLOWED_COPY;
  }
  if (isMissingRpcFailure(error)) return RSVP_UNPUBLISH_UNAVAILABLE_COPY;
  return RSVP_UNPUBLISH_FAILED_COPY;
};
