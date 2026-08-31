/**
 * ORCH-1150 — RSVP event service callers.
 *
 * Forked from businessEvents.publishBusinessEventDraft. RSVP NEVER routes
 * through the EVENT publish RPC (I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC):
 *   - publishRsvpDraft → business_publish_rsvp_graph
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
import {
  type RsvpUpdatePayload,
} from "../utils/serverDraftEventMapper";
import { logAppsFlyerEvent } from "./appsFlyerService";
import type { DraftEvent } from "../store/draftEventStore";

const createRsvpRequestId = (): string => {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") return maybeCrypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
};

export const publishRsvpDraft = async (
  draft: DraftEvent,
  clientRevision: number | null = draft.clientRevision ?? null,
): Promise<PublishedBusinessEvent> => {
  void clientRevision;
  // I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC: this MUST call the RSVP publish RPC,
  // never the EVENT publish RPC (that would re-introduce the
  // event_ticket_required 0-ticket block).
  const { data, error } = await supabase.rpc("business_publish_rsvp_graph", {
    p_event_id: draft.id,
    p_client_request_id: createRsvpRequestId(),
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
  // ORCH-1172 — the publish-style payload built by buildRsvpUpdatePayload (was
  // a raw camelCase patch that the RPC rejected with rsvp_title_required —
  // BUG-A). The typed contract keeps create + edit on one payload shape.
  // ORCH-1172 R3 — accepts the DIFF payload (buildRsvpUpdatePayloadDiff): `title`
  // is always present (RPC-required) but the 9 host-control toggles are emitted
  // only when changed. The RPC COALESCEs every ABSENT column / theme leaf to its
  // existing stored value, so a partial payload is safe + never clobbers.
  payload: Partial<RsvpUpdatePayload> & Pick<RsvpUpdatePayload, "title">,
  reason: string,
): Promise<UpdateLiveRsvpResult> => {
  const { data, error } = await supabase.rpc("business_update_rsvp_graph", {
    p_event_id: eventId,
    p_payload: payload,
    p_reason: reason,
    p_client_request_id: createRsvpRequestId(),
  });
  if (error !== null) throw error;
  const graph = (data ?? {}) as { updateResult?: unknown };
  const res = (graph.updateResult ?? {}) as {
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

/** ORCH-1163 §H — a per-plus-one contact (name+email+phone, all required). */
export interface RsvpGuestContactInput {
  name: string;
  email: string;
  phone: string;
  phoneCountryIso?: string | null;
}

export interface SubmitPublicRsvpInput {
  eventId: string;
  rsvpStatus: "going" | "not_going" | "maybe";
  /** Required for an anon link guest; ignored for a logged-in app user. */
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  guestPhoneCountryIso?: string | null;
  plusCount?: number;
  /** ORCH-1163 §H — per-plus-one contacts; length must equal plusCount. */
  guests?: RsvpGuestContactInput[];
}

export interface SubmitPublicRsvpResult {
  status: "going" | "not_going" | "waitlisted" | "maybe";
  approvalStatus: "pending" | "approved";
  /** ORCH-1163 — the persisted event_rsvps.id (success popup + Calendar QR). */
  rsvpId: string;
  /** ORCH-1163 §I — the signed mingla:v1:rsvp: QR (going only; null otherwise). */
  confirmationToken: string | null;
  acknowledgement: "accepted" | "pending_approval" | "waitlisted" | "maybe" | "not_going";
  credentials: import("@mingla/offering-rendering").RsvpPassCredential[];
  anonymousRecovery: import("@mingla/offering-rendering").RsvpAnonymousRecovery[];
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
      guestPhoneCountryIso: input.guestPhoneCountryIso,
      plusCount: input.plusCount ?? 0,
      guests: input.guests ?? [],
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
    rsvpId?: string;
    confirmationToken?: string | null;
    acknowledgement?: SubmitPublicRsvpResult["acknowledgement"];
    credentials?: import("@mingla/offering-rendering").RsvpPassCredential[];
    anonymousRecovery?: import("@mingla/offering-rendering").RsvpAnonymousRecovery[];
  };
  return {
    status: res.status ?? input.rsvpStatus,
    approvalStatus: res.approvalStatus ?? "approved",
    rsvpId: res.rsvpId ?? "",
    confirmationToken: res.confirmationToken ?? null,
    acknowledgement: res.acknowledgement ??
      (res.approvalStatus === "pending" ? "pending_approval" :
        (res.status === "waitlisted" || res.status === "maybe" || res.status === "not_going")
          ? res.status : "accepted"),
    credentials: res.credentials ?? [],
    anonymousRecovery: res.anonymousRecovery ?? [],
  };
};

// ===========================================================================
// ORCH-1291 [rsvp-chip-in] — voluntary contribution create via the anon-capable
// rsvp-contribution-create edge fn. The chip-in is a SECOND, voluntary action
// AFTER a free RSVP — it NEVER routes through the RSVP write. Mirrors
// submitPublicRsvp's anon posture (a logged-in JWT rides the client;
// guestName/guestEmail cover the anon buyer). NEVER a ticket/order.
// ===========================================================================

export interface SubmitRsvpContributionInput {
  eventId: string;
  amountCents: number;
  rsvpId?: string | null;
  guestName?: string;
  guestEmail?: string;
  surface: "native" | "web" | "mobile-web";
  callerIdempotencyKey: string;
}

export type SubmitRsvpContributionResult =
  | {
      kind: "requires_native_payment";
      contributionId: string;
      clientSecret: string;
      paymentIntentId: string;
      stripeAccountId: string;
      publishableKey: string | null;
      amountCents: number;
      buyerTotalCents: number;
      currency: string;
      brandName?: string;
    }
  | {
      kind: "requires_web_redirect";
      contributionId: string;
      hostedCheckoutUrl: string;
      amountCents: number;
      buyerTotalCents: number;
      currency: string;
    }
  | {
      kind: "requires_paystack_redirect";
      contributionId: string;
      authorizationUrl: string;
      returnUrl: string;
      reference: string;
      amountCents: number;
      buyerTotalCents: number;
      currency: string;
    };

export const submitRsvpContribution = async (
  input: SubmitRsvpContributionInput,
): Promise<SubmitRsvpContributionResult> => {
  const { data, error } = await supabase.functions.invoke("rsvp-contribution-create", {
    body: {
      eventId: input.eventId,
      amountCents: input.amountCents,
      rsvpId: input.rsvpId ?? null,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      surface: input.surface,
      returnContract: "host_v1",
      callerIdempotencyKey: input.callerIdempotencyKey,
    },
  });
  // Bubble the edge fn's { error } code (amount_below_min / brand_cannot_collect /
  // amount_invalid / …) so the panel maps it to the right gift-framed copy.
  if (error !== null) {
    throw new Error(parseRsvpErrorCode(error as RsvpInvokeError));
  }
  const res = (data ?? {}) as Partial<SubmitRsvpContributionResult> & { kind?: string };
  if (
    res.kind !== "requires_native_payment" &&
    res.kind !== "requires_web_redirect" &&
    res.kind !== "requires_paystack_redirect"
  ) {
    throw new Error("contribution_create_failed");
  }
  return res as SubmitRsvpContributionResult;
};
