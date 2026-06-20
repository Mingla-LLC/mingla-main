/**
 * ORCH-1150 — RSVP publish + edit-live React Query mutation hooks.
 *
 * Forked from the business-event publish hook; RSVP NEVER routes through the
 * event publish RPC (I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC).
 *
 * ORCH-1150: do NOT merge back into the event/ticket path. See SPEC §5.1/§5.2.
 */

import { useMutation } from "@tanstack/react-query";

import {
  publishRsvpDraft,
  updateLiveRsvp,
  type UpdateLiveRsvpResult,
} from "../services/rsvpEvents";
import type { PublishedBusinessEvent } from "../services/businessEvents";
import type { DraftEvent } from "../store/draftEventStore";
import type { RsvpUpdatePayload } from "../utils/serverDraftEventMapper";

export function usePublishRsvpDraft() {
  return useMutation<
    PublishedBusinessEvent,
    Error,
    { draft: DraftEvent; clientRevision?: number | null }
  >({
    mutationFn: ({ draft, clientRevision }) =>
      publishRsvpDraft(draft, clientRevision ?? draft.clientRevision ?? null),
  });
}

export function useUpdateLiveRsvp() {
  return useMutation<
    UpdateLiveRsvpResult,
    Error,
    {
      eventId: string;
      // ORCH-1172 R3 — diff-based payload: `title` always present, host-control
      // toggles only when changed (RPC COALESCEs absent keys to existing).
      payload: Partial<RsvpUpdatePayload> & Pick<RsvpUpdatePayload, "title">;
      reason: string;
    }
  >({
    mutationFn: ({ eventId, payload, reason }) =>
      updateLiveRsvp(eventId, payload, reason),
  });
}
