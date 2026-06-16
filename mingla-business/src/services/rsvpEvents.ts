/**
 * ORCH-1150 — RSVP event service callers.
 *
 * Forked from businessEvents.publishBusinessEventDraft. RSVP NEVER routes
 * through business_publish_event_draft (I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC):
 *   - publishRsvpDraft → business_publish_rsvp_draft
 *   - updateLiveRsvp   → biz_update_live_rsvp
 *
 * ORCH-1150: do NOT merge back into the event/ticket service path. See SPEC §5.1.
 */

import { supabase } from "./supabase";
import {
  eventFromPublishResponse,
  type PublishedBusinessEvent,
  type PublishRpcResponse,
} from "./businessEvents";
import { draftToServerUpdate, publishedVisibilityForDraft } from "../utils/serverDraftEventMapper";
import { logAppsFlyerEvent } from "./appsFlyerService";
import type { DraftEvent } from "../store/draftEventStore";

export const publishRsvpDraft = async (
  draft: DraftEvent,
  clientRevision: number | null = draft.clientRevision ?? null,
): Promise<PublishedBusinessEvent> => {
  const payload = draftToServerUpdate(draft, {});
  // I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC: this MUST call the RSVP publish RPC,
  // never business_publish_event_draft (that would re-introduce the
  // event_ticket_required 0-ticket block).
  const { data, error } = await supabase.rpc("business_publish_rsvp_draft", {
    p_event_id: draft.id,
    p_draft_payload: {
      ...payload,
      visibility: publishedVisibilityForDraft(draft.visibility),
    },
    p_client_revision: clientRevision,
  });

  if (error !== null) throw error;
  const response = data as PublishRpcResponse | null;
  if (response === null) {
    throw new Error("RSVP publish did not return a durable event.");
  }
  if (response.event.slug.startsWith("draft-")) {
    throw new Error("RSVP publish returned a draft placeholder slug.");
  }

  logAppsFlyerEvent("mingla_rsvp_published", {
    event_id: response.event.id,
    brand_id: response.brand.id,
  });

  return eventFromPublishResponse(response);
};

export interface UpdateLiveRsvpResult {
  ok: boolean;
  reason?: string;
  goingCount?: number;
  notifiedCount?: number;
}

export const updateLiveRsvp = async (
  eventId: string,
  payload: Record<string, unknown>,
  reason: string,
): Promise<UpdateLiveRsvpResult> => {
  const { data, error } = await supabase.rpc("biz_update_live_rsvp", {
    p_event_id: eventId,
    p_payload: payload,
    p_reason: reason,
  });
  if (error !== null) throw error;
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    going_count?: number;
    notified_count?: number;
  };
  return {
    ok: res.ok ?? false,
    reason: res.reason,
    goingCount: res.going_count,
    notifiedCount: res.notified_count,
  };
};
