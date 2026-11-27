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

import { Platform } from "react-native";
import { supabase } from "./supabase";
import {
  getStoredAdMatchData,
  getStoredClickAttribution,
} from "../analytics/webAnalytics";
import { chipInRefusalFromBody } from "@mingla/offering-rendering/chipInRefusal";
import {
  readRsvpErrorBody,
  readRsvpErrorCode,
  type RsvpInvokeError,
} from "./rsvpErrorCodes";
import { RsvpRpcError } from "./rsvpRpcFailure";
import {
  eventFromPublishResponse,
  type PublishedBusinessEvent,
  type PublishRpcResponse,
} from "./businessEvents";
import { type RsvpUpdatePayload } from "../utils/serverDraftEventMapper";
import { logAppsFlyerEvent } from "./appsFlyerService";
import type { DraftEvent } from "../store/draftEventStore";

const createRsvpRequestId = (): string => {
  const maybeCrypto = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (typeof maybeCrypto?.randomUUID === "function")
    return maybeCrypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (character) => {
      const random = Math.floor(Math.random() * 16);
      return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
    },
  );
};

export const publishRsvpDraft = async (
  draft: DraftEvent,
  clientRevision: number | null = draft.clientRevision ?? null,
  invites?: { selectionRevision: number | null; confirmed: boolean },
): Promise<PublishedBusinessEvent> => {
  void clientRevision;
  // I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC: this MUST call the RSVP publish RPC,
  // never the EVENT publish RPC (that would re-introduce the
  // event_ticket_required 0-ticket block).
  const { data, error } = await supabase.rpc("business_publish_rsvp_graph", {
    p_event_id: draft.id,
    p_client_request_id: createRsvpRequestId(),
    ...(invites?.selectionRevision !== null &&
    invites?.selectionRevision !== undefined
      ? {
          p_invite_selection_revision: invites.selectionRevision,
          p_invite_selection_confirmed: invites.confirmed,
        }
      : {}),
  });

  // issue #3047 — `error` here is a PostgREST PLAIN OBJECT, not an Error. Thrown
  // raw it reached the wizard's `error instanceof Error ? … : String(error)`
  // reader as the literal "[object Object]", so no guard reason could ever
  // match and the terminal 404 (PGRST202, this RPC absent from production) was
  // indistinguishable from any other failure. RsvpRpcError preserves the exact
  // message the guard matcher reads AND the code the terminal/transient split
  // needs.
  if (error !== null) throw new RsvpRpcError(error, "rsvp_publish_failed");
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
  /** issue #3827 — the server's `buyer_notice`, as answered (unparsed). */
  buyerNotice?: unknown;
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
  // issue #3047 — same PostgREST-plain-object hazard as publish above.
  if (error !== null) throw new RsvpRpcError(error, "rsvp_update_failed");
  const graph = (data ?? {}) as { updateResult?: unknown };
  const res = (graph.updateResult ?? {}) as {
    ok?: boolean;
    reason?: string;
    going_count?: number;
    notified_count?: number;
    buyer_notice?: unknown;
  };
  return {
    ok: res.ok ?? false,
    reason: res.reason,
    goingCount: res.going_count,
    notifiedCount: res.notified_count,
    // issue #3827 — what the server decided about telling going guests.
    buyerNotice: res.buyer_notice,
  };
};

// ===========================================================================
// ORCH-1150 — public guest RSVP write (Going / Not-going) via the anon-capable
// public-submit-rsvp edge fn. Used by the public /e/ page + the consumer deck
// card. NEVER navigates to /checkout — this writes an RSVP row, not an order.
// A logged-in user's JWT rides the supabase client (Authorization header) so
// the edge fn resolves user_id and the logged-in path applies. See SPEC §6 / §5.3.
// ===========================================================================

/**
 * issue #4508 1.9 — a plus-one is a phone number (`{ phone, phoneCountryIso }`);
 * name and email are optional and the form no longer asks for them.
 */
export type RsvpGuestContactInput =
  import("@mingla/offering-rendering").RsvpGuestPayload;

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
  /** #4541 — current answers to the form attached to this RSVP page. `undefined` = form read failed (no capability marker); `null` = read ok, no form. */
  brandForm?: import("@mingla/offering-rendering").RsvpBrandFormPayload | null;
  /** issue #3281 S6 — the free add-ons picked with a Going reply; absent sends none (the page never passes an empty list). */
  rsvpAddOns?: ReadonlyArray<{ addOnId: string; quantity: number }>;
}

export interface SubmitPublicRsvpResult {
  status: "going" | "not_going" | "waitlisted" | "maybe";
  approvalStatus: "pending" | "approved";
  /** ORCH-1163 — the persisted event_rsvps.id (success popup + Calendar QR). */
  rsvpId: string;
  /** ORCH-1163 §I — the signed mingla:v1:rsvp: QR (going only; null otherwise). */
  confirmationToken: string | null;
  acknowledgement:
    "accepted" | "pending_approval" | "waitlisted" | "maybe" | "not_going";
  credentials: import("@mingla/offering-rendering").RsvpPassCredential[];
  anonymousRecovery: import("@mingla/offering-rendering").RsvpAnonymousRecovery[];
  claim: { shortUrl: string | null; code: string | null } | null;
  /** issue #4508 — each person brought, with the link their text carries. */
  guests: import("@mingla/offering-rendering").RsvpSubmittedGuest[];
  /**
   * #4541 R1.3 — "After they RSVP": the guest's own form link, minted by the
   * server after a current (approved Going or Maybe) RSVP. null otherwise, and
   * always null from a server without the hand-off.
   */
  brandFormHandoff: { formId: string; token: string } | null;
}

/** #4238 W2-5: stored browser ad context for the server RSVP sign-up. */
const rsvpAdContext = (): Record<string, unknown> => {
  const match = getStoredAdMatchData();
  return {
    clickId: getStoredClickAttribution().clickId,
    fbp: match.fbp,
    fbc: match.fbc,
    scid: match.scid,
    ttp: match.ttp,
    clientUserAgent: match.clientUserAgent,
    trackingOptOut: match.trackingOptOut,
  };
};

export const submitPublicRsvp = async (
  input: SubmitPublicRsvpInput,
): Promise<SubmitPublicRsvpResult> => {
  const { data, error } = await supabase.functions.invoke(
    "public-submit-rsvp",
    {
      body: {
        eventId: input.eventId,
        rsvpStatus: input.rsvpStatus,
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        guestPhone: input.guestPhone,
        guestPhoneCountryIso: input.guestPhoneCountryIso,
        plusCount: input.plusCount ?? 0,
        guests: input.guests ?? [],
        // issue #3281 S6 — undefined (dropped from the JSON) unless the page has
        // picks, so an RSVP without add-ons sends exactly the body it sent before.
        rsvpAddOns: input.rsvpAddOns,
        // #4541 — explicit capability marker. Missing answers are meaningful;
        // the atomic SQL wrapper decides whether the current form requires them.
        // `undefined` = the form read did not succeed: send no marker so the
        // server completes the RSVP as "to answer" (fail-open for old clients).
        ...(input.brandForm === undefined
          ? {}
          : { brandFormStep: 1, brandForm: input.brandForm }),
        // #4238 W2-5: the browser's ad match keys + click id, web only, so the
        // server's free sign-up pairs with the browser's (event_id = rsvpId).
        // Native sends none and the server reports nothing (D20).
        ...(Platform.OS === "web" ? { ad_context: rsvpAdContext() } : {}),
      },
    },
  );
  // supabase.functions.invoke surfaces a non-2xx as a FunctionsHttpError whose
  // context.body carries the { error } code — bubble the code so the UI can
  // show the right inline message (rsvp_contact_required / rsvp_full / …).
  if (error !== null) {
    // #3380 — read the code from the response body (see readRsvpErrorCode).
    throw new Error(await readRsvpErrorCode(error as RsvpInvokeError));
  }
  const res = (data ?? {}) as {
    status?: "going" | "not_going" | "waitlisted" | "maybe";
    approvalStatus?: "pending" | "approved";
    rsvpId?: string;
    confirmationToken?: string | null;
    acknowledgement?: SubmitPublicRsvpResult["acknowledgement"];
    credentials?: import("@mingla/offering-rendering").RsvpPassCredential[];
    anonymousRecovery?: import("@mingla/offering-rendering").RsvpAnonymousRecovery[];
    claim?: { shortUrl?: string | null; code?: string | null } | null;
    guests?: unknown;
    brandFormHandoff?: { formId?: unknown; token?: unknown } | null;
  };
  const handoff = res.brandFormHandoff;
  return {
    status: res.status ?? input.rsvpStatus,
    approvalStatus: res.approvalStatus ?? "approved",
    rsvpId: res.rsvpId ?? "",
    confirmationToken: res.confirmationToken ?? null,
    acknowledgement:
      res.acknowledgement ??
      (res.approvalStatus === "pending"
        ? "pending_approval"
        : res.status === "waitlisted" ||
            res.status === "maybe" ||
            res.status === "not_going"
          ? res.status
          : "accepted"),
    credentials: res.credentials ?? [],
    anonymousRecovery: res.anonymousRecovery ?? [],
    claim:
      res.claim === null || res.claim === undefined
        ? null
        : {
            shortUrl: res.claim.shortUrl ?? null,
            code: res.claim.code ?? null,
          },
    // #4541 R1.3: public-submit-rsvp's 200 body carries
    // `brandFormHandoff: {formId, token} | null`.
    brandFormHandoff:
      typeof handoff?.formId === "string" && typeof handoff.token === "string" && handoff.token.length > 0
        ? { formId: handoff.formId, token: handoff.token }
        : null,
    // On demand: the parser loads on demand, not with the boot payload.
    guests: (
      await import("@mingla/offering-rendering/rsvpGuestParse")
    ).parseSubmittedGuests(res.guests),
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
  const { data, error } = await supabase.functions.invoke(
    "rsvp-contribution-create",
    {
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
    },
  );
  // Bubble the edge fn's { error } code (amount_below_min / brand_cannot_collect /
  // amount_invalid / …) so the panel maps it to the right gift-framed copy.
  // #3645 — read the response BODY (the sync parse only ever saw the generic
  // "non-2xx" message, so every refusal read "Couldn't process that"), and
  // carry `minCents` / `reason` so the panel names the floor the server used.
  if (error !== null) {
    const refusal = await readRsvpErrorBody(error as RsvpInvokeError);
    throw chipInRefusalFromBody(refusal.code, refusal.body);
  }
  const res = (data ?? {}) as Partial<SubmitRsvpContributionResult> & {
    kind?: string;
  };
  if (
    res.kind !== "requires_native_payment" &&
    res.kind !== "requires_web_redirect" &&
    res.kind !== "requires_paystack_redirect"
  ) {
    throw new Error("contribution_create_failed");
  }
  return res as SubmitRsvpContributionResult;
};
