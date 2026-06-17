/**
 * ORCH-1150 — RSVP event service callers.
 *
 * Forked from businessEvents.publishBusinessEventDraft. RSVP NEVER routes
 * through the EVENT publish RPC (I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC):
 *   - publishRsvpDraft → business_publish_rsvp_draft
 *   - updateLiveRsvp   → biz_update_live_rsvp
 *
 * ORCH-1150: do NOT merge back into the event/ticket service path. See SPEC §5.1.
 */

import { supabase } from "./supabase";
import { parseRsvpErrorCode, type RsvpInvokeError } from "./rsvpErrorCodes";
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
  // never the EVENT publish RPC (that would re-introduce the
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

// ===========================================================================
// ORCH-1150 — public guest RSVP write (Going / Not-going) via the anon-capable
// public-submit-rsvp edge fn. Used by the public /e/ page + the consumer deck
// card. NEVER navigates to /checkout — this writes an RSVP row, not an order.
// A logged-in user's JWT rides the supabase client (Authorization header) so
// the edge fn resolves user_id and the logged-in path applies. See SPEC §6 / §5.3.
// ===========================================================================

export interface SubmitPublicRsvpInput {
  eventId: string;
  rsvpStatus: "going" | "not_going" | "maybe";
  /** Required for an anon link guest; ignored for a logged-in app user. */
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  plusCount?: number;
}

export interface SubmitPublicRsvpResult {
  status: "going" | "not_going" | "waitlisted" | "maybe";
  approvalStatus: "pending" | "approved";
}

export const submitPublicRsvp = async (
  input: SubmitPublicRsvpInput,
): Promise<SubmitPublicRsvpResult> => {
  const { data, error } = await supabase.functions.invoke("public-submit-rsvp", {
    body: {
      eventId: input.eventId,
      rsvpStatus: input.rsvpStatus,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      plusCount: input.plusCount ?? 0,
    },
  });
  // supabase.functions.invoke surfaces a non-2xx as a FunctionsHttpError whose
  // context.body carries the { error } code — bubble the code so the UI can
  // show the right inline message (rsvp_contact_required / rsvp_full / …).
  if (error !== null) {
    throw new Error(parseRsvpErrorCode(error as RsvpInvokeError));
  }
  const res = (data ?? {}) as {
    status?: "going" | "not_going" | "waitlisted" | "maybe";
    approvalStatus?: "pending" | "approved";
  };
  return {
    status: res.status ?? input.rsvpStatus,
    approvalStatus: res.approvalStatus ?? "approved",
  };
};
