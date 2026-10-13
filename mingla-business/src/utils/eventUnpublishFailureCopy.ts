/**
 * #3645 — the one sentence an organiser sees when an event cannot be moved
 * back to drafts.
 *
 * `unpublishBusinessEventToDraft` rejects with the bare PostgREST object
 * (`{ message, code, … }`), not an `Error`. Both callers used to read it as
 * `error instanceof Error ? error.message : "unpublish_failed"`, so the
 * server's `event_unpublish_has_commitments` refusal never matched and the
 * "cancel it instead" copy was unreachable. `readRpcFailureMessage` reads the
 * message off both shapes.
 */

import { readRpcFailureMessage } from "../services/rsvpRpcFailure";

export const EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY =
  "This event has buyer activity and cannot be unpublished. Cancel it instead.";

export const EVENT_UNPUBLISH_FAILED_COPY =
  "Could not unpublish this event. Try again.";

export const eventUnpublishFailureCopy = (error: unknown): string =>
  readRpcFailureMessage(error).includes("event_unpublish_has_commitments")
    ? EVENT_UNPUBLISH_HAS_COMMITMENTS_COPY
    : EVENT_UNPUBLISH_FAILED_COPY;
