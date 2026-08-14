// #424 children A–O — Ari domain tools. Each executor reuses an existing RPC
// or edge function under the caller JWT (I-ARI-USER-JWT-ONLY). No parallel
// Ari-only write path.

// deno-lint-ignore-file no-explicit-any
import type { AgentToolDefinition } from "./agentToolHelpers.ts";
import {
  assertCanCollect,
  callRpc,
  invokeFn,
  isString,
  isUuid,
  newIdempotencyKey,
  requireAgentOperationId,
  resolveEventBrand,
  ToolError,
} from "./agentToolHelpers.ts";
import {
  assertAgentReadBrand,
  assertAgentReadEvent,
  resolveAccessibleAgentBrands,
} from "./agentTenantScope.ts";

const UUID = { type: "string", format: "uuid" };
const STR = { type: "string", minLength: 1, maxLength: 500 };

function writeTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  executor: AgentToolDefinition["executor"],
  confirmPhrase?: string,
): AgentToolDefinition {
  const props = confirmPhrase
    ? {
      ...properties,
      confirm_phrase: { type: "string", enum: [confirmPhrase] },
    }
    : properties;
  const req = confirmPhrase && !required.includes("confirm_phrase")
    ? [...required, "confirm_phrase"]
    : required;
  return {
    name,
    description,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: props,
      required: req,
    },
    executor: confirmPhrase
      ? async (args, client, userId, context) => {
        if (args.confirm_phrase !== confirmPhrase) {
          throw new ToolError(
            "INVALID_ARGS",
            `confirm_phrase must be ${confirmPhrase}`,
          );
        }
        return await executor(args, client, userId, context);
      }
      : executor,
  };
}

async function requireEvent(
  args: Record<string, unknown>,
  client: any,
  _userId: string,
): Promise<{ eventId: string; brandId: string }> {
  if (!isUuid(args.event_id)) {
    throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
  }
  const brandId = await resolveEventBrand(client, args.event_id);
  return { eventId: args.event_id, brandId };
}

function requireBrand(
  args: Record<string, unknown>,
  _client: any,
  _userId: string,
): string {
  if (!isUuid(args.brand_id)) {
    throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
  }
  return args.brand_id;
}

async function executeEventWrite(
  name: string,
  args: Record<string, unknown>,
  client: any,
  context: Parameters<AgentToolDefinition["executor"]>[3],
): Promise<unknown> {
  return await callRpc(client, "ari_execute_event_operation", {
    p_operation_id: requireAgentOperationId(context),
    p_tool_name: name,
    p_args: args,
  });
}

// ----------------------------------------------------------------------------
// A. Events
// ----------------------------------------------------------------------------

const publishEvent = writeTool(
  "publish_event",
  "Publish the complete stored event draft through the canonical publish owner.",
  {
    event_id: UUID,
    brand_id: UUID,
    visibility: { type: "string", enum: ["public", "unlisted", "private"] },
  },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeEventWrite("publish_event", args, client, context);
  },
);

const unpublishEvent = writeTool(
  "unpublish_event",
  "Take a live event back to draft (unpublish). Same events row the UI edits.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeEventWrite("unpublish_event", args, client, context);
  },
);

const cancelEvent = writeTool(
  "cancel_event",
  "Cancel a live event via business_cancel_event. Destructive — type-to-confirm in the card.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeEventWrite("cancel_event", args, client, context);
  },
  "CANCEL",
);

const endEventSales = writeTool(
  "end_event_sales",
  "Stop ticket sales on a live event via business_end_event_ticket_sales.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeEventWrite("end_event_sales", args, client, context);
  },
);

const duplicateEvent = writeTool(
  "duplicate_event",
  "Duplicate an owned event as a new draft (same brand, title + ' (copy)').",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeEventWrite("duplicate_event", args, client, context);
  },
);

const patchEventWhen = writeTool(
  "patch_event_when",
  "Change an event's date/time via business_patch_event_when.",
  {
    event_id: UUID,
    when_payload: { type: "object" },
    reason: { type: "string", minLength: 10, maxLength: 200 },
    client_revision: { type: "integer", minimum: 0 },
  },
  ["event_id", "when_payload", "reason"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeEventWrite("patch_event_when", args, client, context);
  },
);

const setEventCover = writeTool(
  "set_event_cover",
  "Set cover media on an owned event. URL comes from the proposal-card cover picker, never invented.",
  {
    event_id: UUID,
    cover_media_url: { type: "string" },
    cover_media_type: { type: "string", enum: ["image", "gif", "video"] },
    cover_media_poster_url: { type: "string" },
    selection_ref: STR,
    cover_media_provider: { type: "string" },
    cover_media_source_url: { type: "string" },
    cover_media_credit: { type: "string" },
    cover_media_credit_url: { type: "string" },
    cover_media_alt: { type: "string" },
  },
  ["event_id", "brand_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    if (!isString(args.selection_ref) || !isString(args.cover_media_url) ||
      !isString(args.cover_media_type) || !isString(args.cover_media_poster_url)) {
      throw new ToolError("INVALID_ARGS", "Choose a cover in the proposal card before confirming");
    }
    return await executeEventWrite("set_event_cover", args, client, context);
  },
);

const setEventGuestPrivacy = writeTool(
  "set_event_guest_privacy",
  "Set guest-list privacy on an owned event via biz_set_event_guest_privacy.",
  { event_id: UUID, private_guest_list: { type: "boolean" }, hide_remaining_count: { type: "boolean" } },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    if (typeof args.private_guest_list !== "boolean" && typeof args.hide_remaining_count !== "boolean") {
      throw new ToolError("INVALID_ARGS", "At least one guest privacy setting is required");
    }
    return await executeEventWrite("set_event_guest_privacy", args, client, context);
  },
);

const discardEventDraft = writeTool(
  "discard_event_draft",
  "Discard an event draft. Destructive — type-to-confirm in the card.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeEventWrite("discard_event_draft", args, client, context);
  },
  "DISCARD",
);

// ----------------------------------------------------------------------------
// B. Tickets / pricing
// ----------------------------------------------------------------------------

const upsertTicketTier = writeTool(
  "upsert_ticket_tier",
  "Create or update a ticket tier on an owned event. Paid tiers require pg_brand_can_collect.",
  {
    event_id: UUID,
    ticket_type_id: UUID,
    name: STR,
    price_cents: { type: "integer", minimum: 0 },
    quantity: { type: "integer", minimum: 1 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
  },
  ["event_id", "name", "price_cents"],
  async (args, client, userId) => {
    const price = Number(args.price_cents);
    if (!Number.isFinite(price) || price < 0) {
      throw new ToolError("INVALID_ARGS", "price_cents must be ≥ 0");
    }
    if (
      args.quantity !== undefined &&
      (typeof args.quantity !== "number" || args.quantity < 1)
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "quantity must be ≥ 1 when set (omit for unlimited)",
      );
    }
    const { eventId, brandId } = await requireEvent(args, client, userId);
    if (price > 0) await assertCanCollect(client, brandId);
    const currency = typeof args.currency === "string"
      ? args.currency.toUpperCase()
      : "USD";
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ToolError("INVALID_ARGS", "currency must be a 3-letter code");
    }
    const row: Record<string, unknown> = {
      event_id: eventId,
      name: args.name,
      price_cents: price,
      quantity_total: typeof args.quantity === "number" ? args.quantity : null,
      currency,
    };
    if (isUuid(args.ticket_type_id)) {
      const { data, error } = await client
        .from("ticket_types")
        .update(row)
        .eq("id", args.ticket_type_id)
        .eq("event_id", eventId)
        .select("id, name, price_cents")
        .single();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return data;
    }
    const { data, error } = await client
      .from("ticket_types")
      .insert(row)
      .select("id, name, price_cents")
      .single();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data;
  },
);

const setPricingSwitches = writeTool(
  "set_pricing_switches",
  "Set all-in / absorb-fee / pass-tax switches via business_set_pricing_switches.",
  {
    event_id: UUID,
    pass_tax: { type: "boolean" },
    pass_mingla_fee: { type: "boolean" },
    pass_service_fee: { type: "boolean" },
  },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId } = await requireEvent(args, client, userId);
    await callRpc(client, "business_set_pricing_switches", {
      p_event_id: eventId,
      p_pass_tax: args.pass_tax ?? true,
      p_pass_mingla_fee: args.pass_mingla_fee ?? true,
      p_pass_service_fee: args.pass_service_fee ?? true,
    });
    return { event_id: eventId, ok: true };
  },
);

// ----------------------------------------------------------------------------
// C. Experiences
// ----------------------------------------------------------------------------

const publishExperience = writeTool(
  "publish_experience",
  "Publish a draft experience via issue_1719_publish_experience_with_poster.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    const { data: paid } = await client.from("ticket_types").select("id").eq(
      "event_id",
      eventId,
    ).gt("price_cents", 0).limit(1);
    if (paid && paid.length > 0) await assertCanCollect(client, brandId);
    return await callRpc(client, "issue_1719_publish_experience_with_poster", {
      p_event_id: eventId,
      p_draft_payload: {},
      p_client_revision: null,
    });
  },
);

const updateExperience = writeTool(
  "update_experience",
  "Update title/description on an owned experience (events row).",
  { event_id: UUID, title: STR, description: { type: "string" } },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId } = await requireEvent(args, client, userId);
    const patch: Record<string, unknown> = {};
    if (isString(args.title)) patch.title = args.title;
    if (typeof args.description === "string") {
      patch.description = args.description;
    }
    if (Object.keys(patch).length === 0) {
      throw new ToolError("INVALID_ARGS", "Nothing to update");
    }
    const { data, error } = await client.from("events").update(patch).eq(
      "id",
      eventId,
    ).select("id, title").single();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data;
  },
);

const deleteExperience = writeTool(
  "delete_experience",
  "Soft-delete an owned experience.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId } = await requireEvent(args, client, userId);
    const { error } = await client.from("events").update({
      deleted_at: new Date().toISOString(),
    }).eq("id", eventId);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return { id: eventId, deleted: true };
  },
);

// ----------------------------------------------------------------------------
// D. Trips
// ----------------------------------------------------------------------------

const createTrip = writeTool(
  "create_trip",
  "Create a draft trip under an owned brand.",
  { brand_id: UUID, title: STR, description: { type: "string" } },
  ["brand_id", "title"],
  async (args, client, userId) => {
    const brandId = await requireBrand(args, client, userId);
    const { data, error } = await client
      .from("events")
      .insert({
        brand_id: brandId,
        created_by: userId,
        title: args.title,
        description: args.description ?? null,
        event_type: "trip",
        status: "draft",
      })
      .select("id, title, status")
      .single();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data;
  },
);

const updateTrip = writeTool(
  "update_trip",
  "Update an owned trip's title/description.",
  { event_id: UUID, title: STR, description: { type: "string" } },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId } = await requireEvent(args, client, userId);
    const patch: Record<string, unknown> = {};
    if (isString(args.title)) patch.title = args.title;
    if (typeof args.description === "string") {
      patch.description = args.description;
    }
    if (Object.keys(patch).length === 0) {
      throw new ToolError("INVALID_ARGS", "Nothing to update");
    }
    const { data, error } = await client.from("events").update(patch).eq(
      "id",
      eventId,
    ).select("id, title").single();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data;
  },
);

const publishTrip = writeTool(
  "publish_trip",
  "Publish a draft trip via issue_1719_publish_trip_with_poster.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    const { data: paid } = await client.from("ticket_types").select("id").eq(
      "event_id",
      eventId,
    ).gt("price_cents", 0).limit(1);
    if (paid && paid.length > 0) await assertCanCollect(client, brandId);
    return await callRpc(client, "issue_1719_publish_trip_with_poster", {
      p_event_id: eventId,
      p_draft_payload: {},
      p_client_revision: null,
    });
  },
);

const deleteTrip = writeTool(
  "delete_trip",
  "Soft-delete an owned trip.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId } = await requireEvent(args, client, userId);
    const { error } = await client.from("events").update({
      deleted_at: new Date().toISOString(),
    }).eq("id", eventId);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return { id: eventId, deleted: true };
  },
);

// ----------------------------------------------------------------------------
// E. RSVP
// ----------------------------------------------------------------------------

const createRsvp = writeTool(
  "create_rsvp",
  "Create a draft RSVP under an owned brand.",
  { brand_id: UUID, title: STR },
  ["brand_id", "title"],
  async (args, client, userId) => {
    const brandId = await requireBrand(args, client, userId);
    const { data, error } = await client
      .from("events")
      .insert({
        brand_id: brandId,
        created_by: userId,
        title: args.title,
        event_type: "rsvp",
        status: "draft",
      })
      .select("id, title, status")
      .single();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data;
  },
);

const publishRsvp = writeTool(
  "publish_rsvp",
  "Publish a draft RSVP via business_publish_rsvp_draft.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId } = await requireEvent(args, client, userId);
    return await callRpc(client, "business_publish_rsvp_draft", {
      p_event_id: eventId,
    });
  },
);

const setRsvpGuestStatus = writeTool(
  "set_rsvp_guest_status",
  "Approve or decline an RSVP guest via host_set_rsvp_status. Use guest_ids for bulk approve.",
  {
    event_id: UUID,
    guest_id: UUID,
    guest_ids: { type: "array", items: UUID },
    status: { type: "string", enum: ["approved", "denied", "pending"] },
  },
  ["event_id", "status"],
  async (args, client, userId) => {
    const { eventId } = await requireEvent(args, client, userId);
    if (Array.isArray(args.guest_ids) && args.guest_ids.length > 0) {
      if (args.status !== "approved") {
        throw new ToolError(
          "INVALID_ARGS",
          "guest_ids bulk path only approves. Pass status=approved, or a single guest_id to deny/pend.",
        );
      }
      return await callRpc(client, "host_bulk_approve_rsvps", {
        p_event_id: eventId,
      });
    }
    if (!isUuid(args.guest_id)) {
      throw new ToolError("INVALID_ARGS", "guest_id or guest_ids required");
    }
    return await callRpc(client, "host_set_rsvp_status", {
      p_rsvp_id: args.guest_id,
      p_status: args.status,
    });
  },
);

const refundRsvpContribution = writeTool(
  "refund_rsvp_contribution",
  "Refund an RSVP chip-in via rsvp-contribution-create refund path / refund-order. Destructive.",
  {
    event_id: UUID,
    order_id: UUID,
    amount_cents: { type: "integer", minimum: 1 },
  },
  ["event_id", "order_id"],
  async (args, client, userId) => {
    await requireEvent(args, client, userId);
    if (!isUuid(args.order_id)) {
      throw new ToolError("INVALID_ARGS", "order_id must be a uuid");
    }
    return await invokeFn(client, "refund-order", {
      order_id: args.order_id,
      amount_cents: args.amount_cents ?? null,
    }, { "Idempotency-Key": newIdempotencyKey() });
  },
  "REFUND",
);

// ----------------------------------------------------------------------------
// F. Stays / venue reservations
// ----------------------------------------------------------------------------

const quoteStay = writeTool(
  "quote_stay",
  "Quote a stay reservation via stay-reservations (read quote, no write until create).",
  {
    brand_id: UUID,
    listing_id: UUID,
    check_in: { type: "string" },
    check_out: { type: "string" },
  },
  ["brand_id", "listing_id", "check_in", "check_out"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    await requireBrand(args, client, userId);
    return await invokeFn(client, "stay-reservations", {
      action: "quote",
      listing_id: args.listing_id,
      check_in: args.check_in,
      check_out: args.check_out,
    });
  },
);

const createStayReservation = writeTool(
  "create_stay_reservation",
  "Create a stay reservation via stay-reservations. Sends Idempotency-Key.",
  {
    brand_id: UUID,
    listing_id: UUID,
    check_in: { type: "string" },
    check_out: { type: "string" },
  },
  ["brand_id", "listing_id", "check_in", "check_out"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(
      client,
      "stay-reservations",
      {
        action: "create",
        listing_id: args.listing_id,
        check_in: args.check_in,
        check_out: args.check_out,
      },
      { "Idempotency-Key": newIdempotencyKey() },
    );
  },
);

const transitionStay = writeTool(
  "transition_stay",
  "Approve, decline, or cancel a stay reservation via stay-reservations (expectedVersion).",
  {
    reservation_id: UUID,
    action: { type: "string", enum: ["approve", "decline", "cancel"] },
    expected_version: { type: "integer" },
  },
  ["reservation_id", "action"],
  async (args, client, _userId) => {
    if (!isUuid(args.reservation_id)) {
      throw new ToolError("INVALID_ARGS", "reservation_id must be a uuid");
    }
    return await invokeFn(
      client,
      "stay-reservations",
      {
        action: args.action,
        reservation_id: args.reservation_id,
        expectedVersion: args.expected_version ?? 1,
      },
      { "Idempotency-Key": newIdempotencyKey() },
    );
  },
);

const createVenueReservation = writeTool(
  "create_venue_reservation",
  "Create a venue table reservation via biz_reservation_create.",
  {
    brand_id: UUID,
    venue_id: UUID,
    party_size: { type: "integer", minimum: 1 },
    start_at: { type: "string", format: "date-time" },
  },
  ["brand_id", "venue_id", "party_size", "start_at"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await callRpc(client, "biz_reservation_create", {
      p_venue_id: args.venue_id,
      p_party_size: args.party_size,
      p_start_at: args.start_at,
    });
  },
);

const transitionVenueReservation = writeTool(
  "transition_venue_reservation",
  "Transition a venue reservation via biz_reservation_transition.",
  {
    reservation_id: UUID,
    to_status: {
      type: "string",
      enum: ["approved", "declined", "cancelled", "seated", "completed"],
    },
  },
  ["reservation_id", "to_status"],
  async (args, client, _userId) => {
    if (!isUuid(args.reservation_id)) {
      throw new ToolError("INVALID_ARGS", "reservation_id must be a uuid");
    }
    return await callRpc(client, "biz_reservation_transition", {
      p_reservation_id: args.reservation_id,
      p_to_status: args.to_status,
    });
  },
);

// ----------------------------------------------------------------------------
// G. Venue listings / claims
// ----------------------------------------------------------------------------

const createVenueListing = writeTool(
  "create_venue_listing",
  "Create a venue listing via biz_create_venue_listing.",
  { brand_id: UUID, name: STR, city: STR },
  ["brand_id", "name"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await callRpc(client, "biz_create_venue_listing", {
      p_brand_id: args.brand_id,
      p_name: args.name,
      p_city: args.city ?? null,
    });
  },
);

const submitVenueClaim = writeTool(
  "submit_venue_claim",
  "Submit or resubmit a venue claim via biz_resubmit_venue_claim.",
  { brand_id: UUID, claim_id: UUID },
  ["brand_id", "claim_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await callRpc(client, "biz_resubmit_venue_claim", {
      p_claim_id: args.claim_id,
    });
  },
);

const markClaimFeedbackFixed = writeTool(
  "mark_claim_feedback_fixed",
  "Mark a venue-claim feedback item fixed via biz_mark_feedback_item_fixed.",
  { brand_id: UUID, feedback_item_id: UUID },
  ["brand_id", "feedback_item_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await callRpc(client, "biz_mark_feedback_item_fixed", {
      p_feedback_item_id: args.feedback_item_id,
    });
  },
);

// ----------------------------------------------------------------------------
// H. Venue ops
// ----------------------------------------------------------------------------

const venueOpsAction = writeTool(
  "venue_ops_action",
  "Staff-only venue order-pad / tables / tabs / waitlist action via venue-order-staff. Role-gated.",
  {
    brand_id: UUID,
    venue_id: UUID,
    action: {
      type: "string",
      enum: [
        "list_tables",
        "open_tab",
        "close_tab",
        "add_item",
        "send_to_kitchen",
        "seat_waitlist",
        "list_waitlist",
      ],
    },
    payload: { type: "object" },
  },
  ["brand_id", "venue_id", "action"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(client, "venue-order-staff", {
      venue_id: args.venue_id,
      action: args.action,
      payload: args.payload ?? {},
    });
  },
);

const sendVenueSms = writeTool(
  "send_venue_sms",
  "Send a venue SMS via send-venue-sms (smsAdapter only — never a raw SMS provider).",
  { brand_id: UUID, venue_id: UUID, to_phone: STR, body: STR },
  ["brand_id", "venue_id", "to_phone", "body"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(client, "send-venue-sms", {
      venue_id: args.venue_id,
      to: args.to_phone,
      body: args.body,
    });
  },
);

// ----------------------------------------------------------------------------
// I. Marketing
// ----------------------------------------------------------------------------

const draftCampaign = writeTool(
  "draft_campaign",
  "Create a marketing campaign draft (RLS insert). Does not send.",
  {
    brand_id: UUID,
    title: STR,
    body: { type: "string" },
    channel: { type: "string", enum: ["email", "sms", "rcs"] },
  },
  ["brand_id", "title"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    const channel = args.channel === "sms" || args.channel === "rcs"
      ? args.channel
      : "email";
    let audienceId: string | null = null;
    const { data: audiences, error: audErr } = await client
      .from("marketing_audiences")
      .select("id, query_definition")
      .eq("brand_id", args.brand_id)
      .eq("is_system_generated", true);
    if (audErr) throw new ToolError("RPC_FAILED", audErr.message);
    for (
      const row of (audiences ?? []) as Array<
        { id: string; query_definition: { kind?: string } }
      >
    ) {
      if (row.query_definition?.kind === "brand_buyers") {
        audienceId = row.id;
        break;
      }
    }
    if (!audienceId) {
      const { data: created, error: createAudErr } = await client
        .from("marketing_audiences")
        .insert({
          account_id: userId,
          brand_id: args.brand_id,
          name: "All brand buyers",
          is_system_generated: true,
          query_definition: {
            kind: "brand_buyers",
            brand_id: args.brand_id,
            payment_statuses: ["paid", "partial_refund"],
          },
        })
        .select("id")
        .single();
      if (createAudErr || !created) {
        throw new ToolError(
          "RPC_FAILED",
          createAudErr?.message ?? "audience create failed",
        );
      }
      audienceId = created.id as string;
    }
    const { data, error } = await client
      .from("marketing_campaigns")
      .insert({
        account_id: userId,
        brand_id: args.brand_id,
        audience_id: audienceId,
        name: args.title,
        channel,
        channel_payload: {
          kind: channel,
          body: typeof args.body === "string" ? args.body : "",
        },
        status: "draft",
      })
      .select("id, name, status, channel")
      .single();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data;
  },
);

const scheduleCampaign = writeTool(
  "schedule_campaign",
  "Schedule a draft campaign for later send.",
  { campaign_id: UUID, scheduled_for: { type: "string", format: "date-time" } },
  ["campaign_id", "scheduled_for"],
  async (args, client, _userId) => {
    if (!isUuid(args.campaign_id)) {
      throw new ToolError("INVALID_ARGS", "campaign_id must be a uuid");
    }
    const { data, error } = await client
      .from("marketing_campaigns")
      .update({
        status: "scheduled",
        scheduled_for: args.scheduled_for,
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.campaign_id)
      .in("status", ["draft", "scheduled"])
      .select("id, status, scheduled_for")
      .maybeSingle();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    if (!data) {
      throw new ToolError(
        "INVALID_ARGS",
        "Campaign is not a draft/scheduled row",
      );
    }
    return data;
  },
);

const sendCampaignNow = writeTool(
  "send_campaign_now",
  "Send a campaign immediately via marketing-send. Irreversible — type-to-confirm SEND.",
  { campaign_id: UUID },
  ["campaign_id"],
  async (args, client, _userId) => {
    if (!isUuid(args.campaign_id)) {
      throw new ToolError("INVALID_ARGS", "campaign_id must be a uuid");
    }
    return await invokeFn(client, "marketing-send", {
      campaign_id: args.campaign_id,
      sendNow: true,
    });
  },
  "SEND",
);

const cancelCampaign = writeTool(
  "cancel_campaign",
  "Cancel a scheduled campaign.",
  { campaign_id: UUID },
  ["campaign_id"],
  async (args, client, _userId) => {
    if (!isUuid(args.campaign_id)) {
      throw new ToolError("INVALID_ARGS", "campaign_id must be a uuid");
    }
    const { data, error } = await client
      .from("marketing_campaigns")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", args.campaign_id)
      .eq("status", "scheduled")
      .select("id, status")
      .maybeSingle();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    if (!data) {
      throw new ToolError(
        "INVALID_ARGS",
        "Only a scheduled campaign can be cancelled",
      );
    }
    return data;
  },
);

const runGrowthTool = writeTool(
  "run_growth_tool",
  "Run a Growth Tool via growth-tools-run. Read report afterwards with get_brand_analytics.",
  { brand_id: UUID, tool_key: STR },
  ["brand_id", "tool_key"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(client, "growth-tools-run", {
      brand_id: args.brand_id,
      tool_key: args.tool_key,
    });
  },
);

// ----------------------------------------------------------------------------
// J. Payouts / partners / tax (read + destructive disconnect)
// ----------------------------------------------------------------------------

const getPayoutStatus = writeTool(
  "get_payout_status",
  "Read payout readiness (pg_brand_can_collect) and guide KYC. Never bypasses Stripe/Paystack.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    await requireBrand(args, client, userId);
    const can = await callRpc(client, "pg_brand_can_collect", {
      p_brand_id: args.brand_id,
    });
    return {
      brand_id: args.brand_id,
      can_collect: can === true || (can as any)?.can_collect === true,
      guide:
        "Open Brand → Payouts to finish Stripe or Paystack KYC. Ari cannot complete hosted KYC in chat.",
    };
  },
);

const getPartnerStatus = writeTool(
  "get_partner_status",
  "Read partner-split link status for a brand.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    await requireBrand(args, client, userId);
    const { data, error } = await client
      .from("brand_partners")
      .select("id, status, partner_brand_id")
      .eq("brand_id", args.brand_id)
      .limit(20);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data ?? [];
  },
);

const disconnectPartner = writeTool(
  "disconnect_partner",
  "Disconnect a partner split. Destructive confirm.",
  { brand_id: UUID, partner_id: UUID },
  ["brand_id", "partner_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    const { error } = await client
      .from("brand_partners")
      .update({
        status: "disconnected",
        disconnected_at: new Date().toISOString(),
      })
      .eq("id", args.partner_id)
      .eq("brand_id", args.brand_id);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return { partner_id: args.partner_id, disconnected: true };
  },
  "DISCONNECT",
);

const getTaxStatus = writeTool(
  "get_tax_status",
  "Read tax-registration status and tell the operator to open Stripe/Paystack Connect tax. Never files tax.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    await requireBrand(args, client, userId);
    return {
      brand_id: args.brand_id,
      guide:
        "Open Brand → Tax / Connect tax to register. Ari cannot complete hosted tax onboarding in chat.",
    };
  },
);

// ----------------------------------------------------------------------------
// K. Refunds / cancels / installments
// ----------------------------------------------------------------------------

const refundOrder = writeTool(
  "refund_order",
  "Refund an order via refund-order. Finance-role gated. Idempotency-Key required.",
  {
    brand_id: UUID,
    order_id: UUID,
    amount_cents: { type: "integer", minimum: 1 },
  },
  ["brand_id", "order_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.order_id)) {
      throw new ToolError("INVALID_ARGS", "order_id must be a uuid");
    }
    return await invokeFn(
      client,
      "refund-order",
      { order_id: args.order_id, amount_cents: args.amount_cents ?? null },
      { "Idempotency-Key": newIdempotencyKey() },
    );
  },
  "REFUND",
);

const cancelOrder = writeTool(
  "cancel_order",
  "Cancel an order via cancel-order. Finance-role gated.",
  { brand_id: UUID, order_id: UUID },
  ["brand_id", "order_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(
      client,
      "cancel-order",
      { order_id: args.order_id },
      { "Idempotency-Key": newIdempotencyKey() },
    );
  },
  "CANCEL",
);

const cancelTripBooking = writeTool(
  "cancel_trip_booking",
  "Cancel a trip booking via cancel-trip-booking.",
  { brand_id: UUID, booking_id: UUID },
  ["brand_id", "booking_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(
      client,
      "cancel-trip-booking",
      { booking_id: args.booking_id },
      { "Idempotency-Key": newIdempotencyKey() },
    );
  },
  "CANCEL",
);

const retryInstallment = writeTool(
  "retry_installment",
  "Retry a failed installment via biz_retry_installment.",
  { brand_id: UUID, installment_id: UUID },
  ["brand_id", "installment_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await callRpc(client, "biz_retry_installment", {
      p_installment_id: args.installment_id,
    });
  },
);

// ----------------------------------------------------------------------------
// L. Analytics (read)
// ----------------------------------------------------------------------------

const getBrandAnalytics = writeTool(
  "get_brand_analytics",
  "Read brand conversion / reservation / venue intelligence rollups. No warehouse.",
  { brand_id: UUID, question: { type: "string" } },
  ["brand_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    await requireBrand(args, client, userId);
    const [conv, intel] = await Promise.all([
      callRpc(client, "brand_conversion_rollup", { p_brand_id: args.brand_id })
        .catch((e) => ({ error: String(e) })),
      callRpc(client, "venue_intelligence_overview", {
        p_brand_id: args.brand_id,
      }).catch((e) => ({ error: String(e) })),
    ]);
    return {
      brand_id: args.brand_id,
      question: args.question ?? null,
      conversion: conv,
      venue: intel,
    };
  },
);

// ----------------------------------------------------------------------------
// M. Team / scanners / Brand People
// ----------------------------------------------------------------------------

const inviteBrandMember = writeTool(
  "invite_brand_member",
  "Invite a brand member via existing invitations table / service.",
  {
    brand_id: UUID,
    email: STR,
    role: {
      type: "string",
      enum: [
        "brand_admin",
        "event_manager",
        "finance_manager",
        "marketing_manager",
      ],
    },
  },
  ["brand_id", "email", "role"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(client, "invite-brand-member", {
      brand_id: args.brand_id,
      invitee_email: args.email,
      invitee_name: "",
      role: args.role,
    });
  },
);

const inviteScanner = writeTool(
  "invite_scanner",
  "Invite a scanner for a brand.",
  { brand_id: UUID, email: STR },
  ["brand_id", "email"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(client, "invite-brand-member", {
      brand_id: args.brand_id,
      invitee_email: args.email,
      invitee_name: "",
      role: "scanner",
    });
  },
);

const revokeBrandMember = writeTool(
  "revoke_brand_member",
  "Revoke a brand member or scanner.",
  { brand_id: UUID, member_id: UUID },
  ["brand_id", "member_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    const { error } = await client
      .from("brand_members")
      .delete()
      .eq("id", args.member_id)
      .eq("brand_id", args.brand_id);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return { member_id: args.member_id, revoked: true };
  },
);

const listGuestRoster = writeTool(
  "list_guest_roster",
  "List guest roster for an owned event via biz_guest_roster_list. No PII dump into the model beyond names/status.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId) => {
    await assertAgentReadEvent(client, userId, args.event_id);
    await requireEvent(args, client, userId);
    return await callRpc(client, "biz_guest_roster_list", {
      p_event_id: args.event_id,
    });
  },
);

const setGuestApproval = writeTool(
  "set_guest_approval",
  "Approve or decline a guest on the brand people roster.",
  { event_id: UUID, guest_id: UUID, approved: { type: "boolean" } },
  ["event_id", "guest_id", "approved"],
  async (args, client, userId) => {
    await requireEvent(args, client, userId);
    return await callRpc(client, "biz_guest_roster_access", {
      p_event_id: args.event_id,
      p_guest_id: args.guest_id,
      p_approved: args.approved,
    });
  },
);

const exportBrandPeople = writeTool(
  "export_brand_people",
  "Export Brand People CSV via brand-people-export. PII — extra confirm.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    return await invokeFn(client, "brand-people-export", {
      brand_id: args.brand_id,
    });
  },
  "EXPORT",
);

// ----------------------------------------------------------------------------
// N. Account / support / deletion
// ----------------------------------------------------------------------------

const updateAriPrefs = writeTool(
  "update_ari_prefs",
  "Update conversational Ari prefs (timezone, currency, communication style) on agent_user_profile.",
  {
    preferred_timezone: { type: "string" },
    preferred_currency: { type: "string", minLength: 3, maxLength: 3 },
    communication_style: { type: "string", enum: ["concise", "detailed"] },
  },
  [],
  async (args, client, userId) => {
    const patch: Record<string, unknown> = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    if (typeof args.preferred_timezone === "string") {
      patch.preferred_timezone = args.preferred_timezone;
    }
    if (typeof args.preferred_currency === "string") {
      patch.preferred_currency = args.preferred_currency;
    }
    if (
      args.communication_style === "concise" ||
      args.communication_style === "detailed"
    ) {
      patch.communication_style = args.communication_style;
    }
    const { data, error } = await client
      .from("agent_user_profile")
      .upsert(patch)
      .select("preferred_timezone, preferred_currency, communication_style")
      .single();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data;
  },
);

const updateNotificationPrefs = writeTool(
  "update_notification_prefs",
  "Update notification type preferences for the signed-in operator.",
  {
    email_enabled: { type: "boolean" },
    push_enabled: { type: "boolean" },
    sms_enabled: { type: "boolean" },
  },
  [],
  async (args, client, userId) => {
    const rows = [
      {
        user_id: userId,
        channel: "email",
        type: "order",
        opt_in: args.email_enabled ?? true,
      },
      {
        user_id: userId,
        channel: "push",
        type: "order",
        opt_in: args.push_enabled ?? true,
      },
      {
        user_id: userId,
        channel: "sms",
        type: "order",
        opt_in: args.sms_enabled ?? false,
      },
    ];
    const { data, error } = await client
      .from("business_notification_type_preferences")
      .upsert(rows)
      .select("channel, type, opt_in");
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return data;
  },
);

const createSupportTicket = writeTool(
  "create_support_ticket",
  "Open a support ticket via create_support_ticket RPC.",
  { subject: STR, brand_id: UUID },
  ["subject"],
  async (args, client, _userId) => {
    return await callRpc(client, "create_support_ticket", {
      p_subject: args.subject,
      p_brand_id: args.brand_id ?? null,
    });
  },
);

const requestAccountDeletion = writeTool(
  "request_account_deletion",
  "Delete the operator account via delete-user. Requires typed legal name + DELETE.",
  { legal_name: STR },
  ["legal_name"],
  async (args, client, _userId) => {
    return await invokeFn(client, "delete-user", {
      legal_name: args.legal_name,
      confirm: "DELETE",
    });
  },
  "DELETE",
);

// ----------------------------------------------------------------------------
// O. Intelligence snapshot (read) — enables the create→ticket→publish→blast chain
// ----------------------------------------------------------------------------

const getOperatorSnapshot = writeTool(
  "get_operator_snapshot",
  "Compact owned offerings + payout-ready flag for chaining next steps. No PII rosters.",
  { brand_id: UUID },
  [],
  async (args, client, userId) => {
    const scope = await resolveAccessibleAgentBrands(client, userId).catch(
      (error) => {
        throw new ToolError(
          "TENANT_SCOPE_UNAVAILABLE",
          error instanceof Error ? error.message : "Brand scope unavailable",
        );
      },
    );
    let brandId: string | null = isUuid(args.brand_id) ? args.brand_id : null;
    if (args.brand_id !== undefined && !brandId) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (brandId) {
      await assertAgentReadBrand(client, userId, brandId);
    }
    // Preserve this tool's pre-existing owner-only detail semantics after the
    // broader accessibility guard; delegated roles are not silently promoted.
    const brands = scope.filter((brand) => brand.role === "owner").slice(0, 8)
      .map(({ id, name, role, effective_rank }) => ({
        id,
        name,
        role,
        effective_rank,
      }));
    if (!brandId && brands.length === 1) brandId = brands[0].id;
    let offerings: unknown[] = [];
    let canCollect: unknown = null;
    if (brandId) {
      const { data: ev } = await client
        .from("events")
        .select("id, title, status, event_type")
        .eq("brand_id", brandId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(8);
      offerings = ev ?? [];
      canCollect = await callRpc(client, "pg_brand_can_collect", {
        p_brand_id: brandId,
      }).catch(() => null);
    }
    return {
      brands,
      offerings,
      payout_ready: canCollect === true ||
        (canCollect as any)?.can_collect === true,
      next_step_hint: !brands.length
        ? "create_brand"
        : offerings.length === 0
        ? "create_event"
        : "publish_event or upsert_ticket_tier or draft_campaign",
    };
  },
);

export const DOMAIN_TOOLS: AgentToolDefinition[] = [
  publishEvent,
  unpublishEvent,
  cancelEvent,
  endEventSales,
  duplicateEvent,
  patchEventWhen,
  setEventCover,
  setEventGuestPrivacy,
  discardEventDraft,
  upsertTicketTier,
  setPricingSwitches,
  publishExperience,
  updateExperience,
  deleteExperience,
  createTrip,
  updateTrip,
  publishTrip,
  deleteTrip,
  createRsvp,
  publishRsvp,
  setRsvpGuestStatus,
  refundRsvpContribution,
  quoteStay,
  createStayReservation,
  transitionStay,
  createVenueReservation,
  transitionVenueReservation,
  createVenueListing,
  submitVenueClaim,
  markClaimFeedbackFixed,
  venueOpsAction,
  sendVenueSms,
  draftCampaign,
  scheduleCampaign,
  sendCampaignNow,
  cancelCampaign,
  runGrowthTool,
  getPayoutStatus,
  getPartnerStatus,
  disconnectPartner,
  getTaxStatus,
  refundOrder,
  cancelOrder,
  cancelTripBooking,
  retryInstallment,
  getBrandAnalytics,
  inviteBrandMember,
  inviteScanner,
  revokeBrandMember,
  listGuestRoster,
  setGuestApproval,
  exportBrandPeople,
  updateAriPrefs,
  updateNotificationPrefs,
  createSupportTicket,
  requestAccountDeletion,
  getOperatorSnapshot,
];

export const DOMAIN_READ_ONLY = new Set<string>([
  "quote_stay",
  "get_payout_status",
  "get_partner_status",
  "get_tax_status",
  "get_brand_analytics",
  "list_guest_roster",
  "get_operator_snapshot",
]);

export const MONEY_CONFIRM_TOOLS = new Set<string>([
  "cancel_event",
  "discard_event_draft",
  "refund_rsvp_contribution",
  "send_campaign_now",
  "disconnect_partner",
  "refund_order",
  "cancel_order",
  "cancel_trip_booking",
  "export_brand_people",
  "request_account_deletion",
]);
