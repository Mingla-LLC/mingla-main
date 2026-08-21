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
  applyTierPatch,
  loadEventTicketState,
  requireActiveTaxRegistration,
} from "./agentTicketPricing.ts";
import {
  assertAgentReadBrand,
  assertAgentReadEvent,
  resolveAccessibleAgentBrands,
} from "./agentTenantScope.ts";
// issue #2291 — ONE contract for what a channel_payload must contain. Ari is
// the only writer that has no human between it and the send path, so it is the
// writer that most needs to be told "no" before the row is stored.
import { campaignPayloadIssues } from "./campaignPayloadContract.ts";

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
  "Change an event's date/time through the canonical atomic live-event owner.",
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
    brand_id: UUID,
    clear_cover: { type: "boolean" },
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
    const event = await requireEvent(args, client, userId);
    if (event.brandId !== args.brand_id) {
      throw new ToolError("INVALID_ARGS", "brand_id does not own this event");
    }
    if (
      args.clear_cover !== true &&
      (!isString(args.selection_ref) || !isString(args.cover_media_url) ||
        !isString(args.cover_media_type) ||
        !isString(args.cover_media_poster_url))
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "Choose a cover in the proposal card before confirming",
      );
    }
    return await executeEventWrite("set_event_cover", args, client, context);
  },
);

const setEventGuestPrivacy = writeTool(
  "set_event_guest_privacy",
  "Set guest-list privacy on an owned event via biz_set_event_guest_privacy.",
  {
    event_id: UUID,
    private_guest_list: { type: "boolean" },
    hide_remaining_count: { type: "boolean" },
  },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    if (
      typeof args.private_guest_list !== "boolean" &&
      typeof args.hide_remaining_count !== "boolean"
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "At least one guest privacy setting is required",
      );
    }
    return await executeEventWrite(
      "set_event_guest_privacy",
      args,
      client,
      context,
    );
  },
);

const discardEventDraft = writeTool(
  "discard_event_draft",
  "Discard an event draft. Destructive — type-to-confirm in the card.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeEventWrite(
      "discard_event_draft",
      args,
      client,
      context,
    );
  },
  "DISCARD",
);

// ----------------------------------------------------------------------------
// B. Tickets / pricing
// ----------------------------------------------------------------------------

const upsertTicketTier = writeTool(
  "upsert_ticket_tier",
  "Create or sparsely update a complete canonical ticket tier. Currency is derived by the server; paid tiers require payout readiness.",
  {
    event_id: UUID,
    tier_id: { type: "string", minLength: 1, maxLength: 100 },
    name: STR,
    price_cents: { type: "integer", minimum: 0 },
    is_free: { type: "boolean" },
    is_unlimited: { type: "boolean" },
    capacity: { type: "integer", minimum: 1, nullable: true },
    visibility: { type: "string", enum: ["public", "hidden", "disabled"] },
    display_order: { type: "integer", minimum: 0 },
    approval_required: { type: "boolean" },
    waitlist_enabled: { type: "boolean" },
    min_purchase_qty: { type: "integer", minimum: 1 },
    max_purchase_qty: { type: "integer", minimum: 1, nullable: true },
    allow_transfers: { type: "boolean" },
    description: { type: "string", maxLength: 280, nullable: true },
    sale_start_at: { type: "string", format: "date-time", nullable: true },
    sale_end_at: { type: "string", format: "date-time", nullable: true },
    available_at: { type: "string", enum: ["online", "door", "both"] },
  },
  ["event_id"],
  async (args, client, userId, context) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    const operationId = context?.operationId;
    if (!isUuid(operationId)) {
      throw new ToolError(
        "EXECUTION_CONTEXT_REQUIRED",
        "Ticket writes require a confirmed server operation id",
      );
    }
    const { event, tiers } = await loadEventTicketState(client, eventId);
    const requestedId =
      typeof args.tier_id === "string" && args.tier_id.length > 0
        ? args.tier_id
        : null;
    const existing = requestedId === null
      ? null
      : tiers.find((tier) => tier.id === requestedId) ?? null;
    if (requestedId !== null && existing === null) {
      throw new ToolError(
        "INVALID_ARGS",
        "That tier is stale or belongs to another event",
      );
    }
    const next = applyTierPatch(
      existing,
      args,
      operationId,
      tiers.reduce((max, tier) => Math.max(max, tier.displayOrder), -1) + 1,
    );
    if (!next.isFree && (existing === null || existing.isFree)) {
      await assertCanCollect(client, brandId);
    }
    return await callRpc(client, "ari_execute_ticket_pricing_operation", {
      p_operation_id: operationId,
      p_tool_name: "upsert_ticket_tier",
      p_args: args,
    });
  },
);

const setPricingSwitches = writeTool(
  "set_pricing_switches",
  "Sparsely set event tax and fee decisions; omitted keys are unchanged and inherit writes SQL NULL.",
  {
    event_id: UUID,
    tax: {
      type: "string",
      enum: [
        "inherit",
        "pass_to_buyer",
        "included_in_price",
        "absorb_by_brand",
      ],
    },
    mingla_fee: {
      type: "string",
      enum: ["inherit", "pass_to_buyer", "absorb_by_brand"],
    },
    service_fee: {
      type: "string",
      enum: ["inherit", "pass_to_buyer", "absorb_by_brand"],
    },
  },
  ["event_id"],
  async (args, client, userId, context) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    const supplied = ["tax", "mingla_fee", "service_fee"].filter((key) =>
      args[key] !== undefined
    );
    if (supplied.length === 0) {
      throw new ToolError(
        "INVALID_ARGS",
        "Choose at least one pricing setting",
      );
    }
    if (args.tax === "pass_to_buyer" || args.tax === "included_in_price") {
      await requireActiveTaxRegistration(client, brandId);
    }
    return await callRpc(client, "ari_execute_ticket_pricing_operation", {
      p_operation_id: requireAgentOperationId(context),
      p_tool_name: "set_pricing_switches",
      p_args: args,
    });
  },
);

const setBrandPricingDefaults = writeTool(
  "set_brand_pricing_defaults",
  "Sparsely set concrete brand tax and fee defaults. Omitted keys remain unchanged.",
  {
    brand_id: UUID,
    tax: {
      type: "string",
      enum: ["pass_to_buyer", "included_in_price", "absorb_by_brand"],
    },
    mingla_fee: { type: "string", enum: ["pass_to_buyer", "absorb_by_brand"] },
    service_fee: { type: "string", enum: ["pass_to_buyer", "absorb_by_brand"] },
  },
  ["brand_id"],
  async (args, client, userId, context) => {
    const brandId = requireBrand(args, client, userId);
    const supplied = ["tax", "mingla_fee", "service_fee"].filter((key) =>
      args[key] !== undefined
    );
    if (supplied.length === 0) {
      throw new ToolError(
        "INVALID_ARGS",
        "Choose at least one pricing default",
      );
    }
    if (args.tax === "pass_to_buyer" || args.tax === "included_in_price") {
      await requireActiveTaxRegistration(client, brandId);
    }
    return await callRpc(client, "ari_execute_ticket_pricing_operation", {
      p_operation_id: requireAgentOperationId(context),
      p_tool_name: "set_brand_pricing_defaults",
      p_args: args,
    });
  },
);

// ----------------------------------------------------------------------------
// C. Experiences
// ----------------------------------------------------------------------------

async function executeExperienceWrite(
  name: string,
  args: Record<string, unknown>,
  client: any,
  context: Parameters<AgentToolDefinition["executor"]>[3],
): Promise<unknown> {
  return await callRpc(client, "ari_execute_experience_operation", {
    p_operation_id: requireAgentOperationId(context),
    p_tool_name: name,
    // The confirmed public tool payload is the receipt identity. Internal RPC
    // patches are derived only after agent_operation_receipt_begin binds this
    // exact object inside the canonical database transaction.
    p_args: args,
  });
}

const publishExperience = writeTool(
  "publish_experience",
  "Publish a draft experience from its complete fresh server graph. Missing publish requirements fail without partial writes.",
  {
    event_id: UUID,
    expected_revision: { type: "string", format: "date-time" },
    patch: { type: "object" },
  },
  ["event_id", "expected_revision"],
  async (args, client, userId, context) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    const { data: paid } = await client.from("ticket_types").select("id").eq(
      "event_id",
      eventId,
    ).gt("price_cents", 0).limit(1);
    if (paid && paid.length > 0) await assertCanCollect(client, brandId);
    return await executeExperienceWrite(
      "publish_experience",
      args,
      client,
      context,
    );
  },
);

const updateExperience = writeTool(
  "update_experience",
  "Compose a typed patch over the fresh canonical experience graph. Draft and scheduled/live lifecycles use their existing server owners.",
  {
    event_id: UUID,
    expected_revision: { type: "string", format: "date-time" },
    title: STR,
    description: { type: "string", maxLength: 500 },
    experience_intents: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "string",
        enum: ["adventurous", "first-date", "romantic", "group-fun"],
      },
    },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    location_mode: { type: "string", enum: ["single", "per_stop"] },
    pricing_mode: { type: "string", enum: ["whole", "per_stop"] },
    whole_price_cents: { type: "integer", minimum: 0 },
    is_free: { type: "boolean" },
    capacity: { type: "integer", minimum: 1, nullable: true },
    timezone: { type: "string" },
    whenMode: { type: "string", enum: ["single", "multi_date", "recurring"] },
    when: { type: "object" },
    multiDates: { type: "array", items: { type: "object" } },
    recurrence_rules: { type: "object", nullable: true },
    cover: { type: "object" },
    edit_reason: { type: "string", minLength: 10, maxLength: 200 },
  },
  ["event_id", "expected_revision"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    const patchKeys = Object.keys(args).filter((key) =>
      !["event_id", "expected_revision", "edit_reason"].includes(key)
    );
    if (patchKeys.length === 0) {
      throw new ToolError("INVALID_ARGS", "Nothing to update");
    }
    return await executeExperienceWrite(
      "update_experience",
      args,
      client,
      context,
    );
  },
);

const manageExperienceStops = writeTool(
  "manage_experience_stops",
  "Atomically replace the ordered experience stops and canonical intents using persisted media references only.",
  {
    event_id: UUID,
    expected_revision: { type: "string", format: "date-time" },
    stops: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: { type: "object" },
    },
    experience_intents: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "string",
        enum: ["adventurous", "first-date", "romantic", "group-fun"],
      },
    },
    edit_reason: { type: "string", minLength: 10, maxLength: 200 },
  },
  ["event_id", "expected_revision", "stops", "experience_intents"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeExperienceWrite(
      "manage_experience_stops",
      args,
      client,
      context,
    );
  },
);

const unpublishExperience = writeTool(
  "unpublish_experience",
  "Take an eligible future unsold scheduled experience back to a private draft while preserving its editable graph.",
  {
    event_id: UUID,
    expected_revision: { type: "string", format: "date-time" },
  },
  ["event_id", "expected_revision"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeExperienceWrite(
      "unpublish_experience",
      args,
      client,
      context,
    );
  },
);

const deleteExperience = writeTool(
  "delete_experience",
  "Discard a draft experience only. The user must type its exact current title; scheduled/live experiences are never deleted by this action.",
  { event_id: UUID, confirm_title: STR },
  ["event_id", "confirm_title"],
  async (args, client, userId, context) => {
    const { eventId } = await requireEvent(args, client, userId);
    const { data: current, error } = await client.from("events").select(
      "title, status",
    ).eq("id", eventId).maybeSingle();
    if (error || !current) {
      throw new ToolError(
        "BRAND_ACCESS_DENIED",
        "That experience is unavailable",
      );
    }
    if (current.status !== "draft") {
      throw new ToolError(
        "EXPERIENCE_NOT_DISCARDABLE",
        "Only a draft can be discarded; unpublish or cancel this experience instead",
      );
    }
    if (args.confirm_title !== current.title) {
      throw new ToolError(
        "INVALID_ARGS",
        "Type the exact experience title to confirm discard",
      );
    }
    return await executeExperienceWrite(
      "delete_experience",
      args,
      client,
      context,
    );
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

// #1975 — Stay/venue tools are STRICT adapters over the exact canonical
// Edge/RPC envelopes used by Business web/iOS/Android. No invented action,
// header, or RPC signature. Caller JWT only; the database re-authorizes the
// exact resource, role/capability, optimistic version, and idempotency.

const STAY_GUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: STR,
    email: { type: "string" },
    phone: { type: "string" },
    phone_country_iso: { type: "string", minLength: 2, maxLength: 2 },
  },
};

/** Canonical stay-reservations guest object (camelCase, edge-validated shape). */
function buildStayGuest(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolError("INVALID_ARGS", "guest is required");
  }
  const guest = raw as Record<string, unknown>;
  if (!isString(guest.name)) {
    throw new ToolError("INVALID_ARGS", "guest.name is required");
  }
  const out: Record<string, unknown> = { name: guest.name.trim() };
  const hasEmail = isString(guest.email);
  const hasPhone = isString(guest.phone);
  if (hasEmail) out.email = (guest.email as string).trim();
  if (hasPhone) out.phone = (guest.phone as string).trim();
  if (isString(guest.phone_country_iso)) {
    if (!hasPhone) {
      throw new ToolError(
        "INVALID_ARGS",
        "guest.phone_country_iso requires guest.phone",
      );
    }
    out.phoneCountryIso = (guest.phone_country_iso as string).toUpperCase();
  }
  if (!hasEmail && !hasPhone) {
    throw new ToolError(
      "INVALID_ARGS",
      "guest needs at least an email or an E.164 phone",
    );
  }
  return out;
}

const quoteStay = writeTool(
  "quote_stay",
  "Quote a Stay reservation cart via stay-reservations (canonical quote envelope; ephemeral snapshot that creates no reservation, hold, or payment).",
  {
    brand_id: UUID,
    venue_id: UUID,
    // Canonical room/place discriminated-union cart. The Edge + owning SQL
    // validate each line's exact allocation, dates, and inventory.
    lines: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: { type: "object" },
    },
  },
  ["brand_id", "venue_id", "lines"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    if (
      !Array.isArray(args.lines) || args.lines.length < 1 ||
      args.lines.length > 50
    ) {
      throw new ToolError("INVALID_ARGS", "lines must contain 1-50 cart lines");
    }
    return await invokeFn(client, "stay-reservations", {
      action: "quote",
      payload: {
        venueId: args.venue_id,
        lines: args.lines,
        // A quote is ephemeral; a fresh server-derived key is safe and never
        // creates a reservation group, hold, or payment.
        idempotencyKey: newIdempotencyKey(),
      },
    });
  },
);

const createStayReservation = writeTool(
  "create_stay_reservation",
  "Create a Stay reservation group from an accepted quote via stay-reservations create_group. Money: it holds priced inventory and creates a request obligation (it does not itself charge a payment method).",
  {
    brand_id: UUID,
    quote_id: UUID,
    expected_version: { type: "integer", minimum: 1 },
    guest: STAY_GUEST_SCHEMA,
    attribution_click_id: { type: "string" },
  },
  ["brand_id", "quote_id", "expected_version", "guest"],
  async (args, client, _userId, context) => {
    const operationId = requireAgentOperationId(context);
    if (!isUuid(args.quote_id)) {
      throw new ToolError("INVALID_ARGS", "quote_id must be a uuid");
    }
    if (
      !Number.isInteger(args.expected_version) ||
      Number(args.expected_version) < 1
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "expected_version must be the accepted quote version",
      );
    }
    const payload: Record<string, unknown> = {
      quoteId: args.quote_id,
      // Stable operation-derived idempotency: same confirmed proposal + retry
      // returns the same group; it never creates a second reservation.
      idempotencyKey: operationId,
      guest: buildStayGuest(args.guest),
    };
    if (isString(args.attribution_click_id)) {
      payload.attributionClickId = (args.attribution_click_id as string).trim();
    }
    return await invokeFn(
      client,
      "stay-reservations",
      {
        action: "create_group",
        payload,
        expectedVersion: args.expected_version,
      },
      { "Idempotency-Key": operationId },
    );
  },
);

const transitionStay = writeTool(
  "transition_stay",
  "Approve, decline, or cancel a Stay reservation request via stay-reservations. Approve/decline use the canonical staff actions with the current group version; cancel executes only a server preview from cancel_preview (never re-derives money client-side).",
  {
    operation: {
      type: "string",
      enum: ["approve_request", "decline_request", "cancel"],
    },
    group_id: UUID,
    expected_version: { type: "integer", minimum: 1 },
    // Cancellation must reference an existing canonical cancel_preview result.
    preview_id: UUID,
    preview_hash: { type: "string", minLength: 64, maxLength: 64 },
    reason: { type: "string", minLength: 3, maxLength: 500 },
  },
  ["operation", "group_id"],
  async (args, client, _userId, context) => {
    const operationId = requireAgentOperationId(context);
    if (!isUuid(args.group_id)) {
      throw new ToolError("INVALID_ARGS", "group_id must be a uuid");
    }
    if (
      args.operation === "approve_request" ||
      args.operation === "decline_request"
    ) {
      if (
        !Number.isInteger(args.expected_version) ||
        Number(args.expected_version) < 1
      ) {
        throw new ToolError(
          "INVALID_ARGS",
          "expected_version (current group version) is required",
        );
      }
      return await invokeFn(
        client,
        "stay-reservations",
        {
          action: args.operation,
          payload: { groupId: args.group_id, idempotencyKey: operationId },
          expectedVersion: args.expected_version,
        },
        { "Idempotency-Key": operationId },
      );
    }
    // cancel — a two-stage contract: the proposal owner runs cancel_preview and
    // binds previewId/previewHash; only the confirmed, same-hash preview may
    // execute the canonical cancel. A direct cancel(groupId) path does not exist.
    if (
      !isUuid(args.preview_id) ||
      typeof args.preview_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(args.preview_hash)
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "cancellation requires preview_id and preview_hash from cancel_preview",
      );
    }
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (reason.length < 3) {
      throw new ToolError("INVALID_ARGS", "a cancellation reason is required");
    }
    return await invokeFn(
      client,
      "stay-reservations",
      {
        action: "cancel",
        payload: {
          previewId: args.preview_id,
          previewHash: args.preview_hash,
          idempotencyKey: operationId,
          reason,
        },
      },
      { "Idempotency-Key": operationId },
    );
  },
);

const VENUE_RESERVATION_SOURCES = [
  "mingla",
  "phone",
  "walk_in",
  "website",
  "instagram",
];

const createVenueReservation = writeTool(
  "create_venue_reservation",
  "Create a FREE manual operator venue reservation via biz_reservation_create (created_via='operator', no charge). Requires effective rank event_manager or higher.",
  {
    brand_id: UUID,
    venue_id: UUID,
    reserved_for: { type: "string", format: "date-time" },
    party_size: { type: "integer", minimum: 1, maximum: 100 },
    source: { type: "string", enum: VENUE_RESERVATION_SOURCES },
    guest_name: { type: "string" },
    guest_phone_e164: { type: "string" },
    guest_email: { type: "string" },
    table_id: UUID,
    occasion: { type: "string" },
    guest_notes: { type: "string" },
    tags: { type: "array", items: STR },
    // A manual booking starts in a non-terminal, sensible state only.
    status: { type: "string", enum: ["requested", "confirmed", "seated"] },
  },
  ["brand_id", "venue_id", "reserved_for", "party_size"],
  async (args, client, _userId, context) => {
    requireAgentOperationId(context);
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    if (
      typeof args.reserved_for !== "string" ||
      Number.isNaN(Date.parse(args.reserved_for))
    ) {
      throw new ToolError("INVALID_ARGS", "reserved_for must be a date-time");
    }
    if (
      !Number.isInteger(args.party_size) ||
      Number(args.party_size) < 1 || Number(args.party_size) > 100
    ) {
      throw new ToolError("INVALID_ARGS", "party_size must be 1-100");
    }
    if (
      isString(args.guest_phone_e164) &&
      !/^\+[1-9][0-9]{7,14}$/.test((args.guest_phone_e164 as string).trim())
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "guest_phone_e164 must be E.164 (e.g. +14155550123)",
      );
    }
    return await callRpc(client, "biz_reservation_create", {
      p_brand_id: args.brand_id,
      p_reserved_for: args.reserved_for,
      p_party_size: args.party_size,
      p_source: isString(args.source) ? args.source : "phone",
      p_guest_name: isString(args.guest_name) ? args.guest_name : null,
      p_guest_phone_e164: isString(args.guest_phone_e164)
        ? (args.guest_phone_e164 as string).trim()
        : null,
      p_guest_email: isString(args.guest_email) ? args.guest_email : null,
      p_table_id: isUuid(args.table_id) ? args.table_id : null,
      p_occasion: isString(args.occasion) ? args.occasion : null,
      p_guest_notes: isString(args.guest_notes) ? args.guest_notes : null,
      p_tags: Array.isArray(args.tags) ? args.tags : [],
      p_status: isString(args.status) ? args.status : "confirmed",
    });
  },
);

const VENUE_RESERVATION_STATES = [
  "requested",
  "confirmed",
  "seated",
  "completed",
  "no_show",
  "cancelled_by_guest",
  "cancelled_by_venue",
  "waitlisted",
];

const transitionVenueReservation = writeTool(
  "transition_venue_reservation",
  "Transition a venue reservation via the versioned issue_1975_reservation_transition. Only legal next states execute; no_show records policy only and captures no money. Requires the observed reservation version.",
  {
    reservation_id: UUID,
    to_status: { type: "string", enum: VENUE_RESERVATION_STATES },
    expected_version: { type: "integer", minimum: 1 },
    table_id: UUID,
    reason: { type: "string", maxLength: 500 },
  },
  ["reservation_id", "to_status", "expected_version"],
  async (args, client, _userId, context) => {
    requireAgentOperationId(context);
    if (!isUuid(args.reservation_id)) {
      throw new ToolError("INVALID_ARGS", "reservation_id must be a uuid");
    }
    if (
      !Number.isInteger(args.expected_version) ||
      Number(args.expected_version) < 1
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "expected_version (current reservation version) is required",
      );
    }
    return await callRpc(client, "issue_1975_reservation_transition", {
      p_reservation_id: args.reservation_id,
      p_to_status: args.to_status,
      p_expected_version: args.expected_version,
      p_table_id: isUuid(args.table_id) ? args.table_id : null,
      p_reason: isString(args.reason) ? args.reason : null,
    });
  },
);

// #1975 — Stay authoring family. Reads (`get`) may run inline; every mutation
// is a confirmed proposal carrying the exact current version. The manage-stay-
// inventory Edge + owning SQL enforce the canonical read/inventory/finance
// capability split (issue_1387_has_brand_capability); we never widen authority.

const manageStayInventory = writeTool(
  "manage_stay_inventory",
  "Manage Stay settings/offerings/units/availability via manage-stay-inventory. 'get' reads inline; every other action is a confirmed mutation carrying the exact current version.",
  {
    brand_id: UUID,
    venue_id: UUID,
    action: {
      type: "string",
      enum: [
        "get",
        "save_settings",
        "create_offering",
        "update_offering",
        "replace_units",
        "change_status",
        "upsert_room_nights",
        "upsert_place_schedule",
        "materialize_place_windows",
        "upsert_place_windows",
        "bulk_create",
        "resolve_currency_reconciliation",
      ],
    },
    payload: { type: "object" },
    expected_version: { type: "integer", minimum: 1 },
  },
  ["brand_id", "venue_id", "action"],
  async (args, client, userId, context) => {
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    if (args.action === "get") {
      await assertAgentReadBrand(client, userId, args.brand_id);
      return await invokeFn(client, "manage-stay-inventory", {
        action: "get",
        venueId: args.venue_id,
        payload: (args.payload as Record<string, unknown>) ?? {},
      });
    }
    requireAgentOperationId(context);
    const body: Record<string, unknown> = {
      action: args.action,
      venueId: args.venue_id,
      payload: (args.payload as Record<string, unknown>) ?? {},
    };
    if (args.expected_version !== undefined) {
      body.expectedVersion = args.expected_version;
    }
    return await invokeFn(client, "manage-stay-inventory", body);
  },
);

const publishStay = writeTool(
  "publish_stay",
  "Publish a Stay and its ready draft offerings via manage-stay-inventory publish_stay. Requires the current settings version; all readiness/verification/bank/currency gates are enforced by the owner (no force publish).",
  {
    brand_id: UUID,
    venue_id: UUID,
    expected_version: { type: "integer", minimum: 1 },
  },
  ["brand_id", "venue_id", "expected_version"],
  async (args, client, _userId, context) => {
    requireAgentOperationId(context);
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    if (
      !Number.isInteger(args.expected_version) ||
      Number(args.expected_version) < 1
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "expected_version (current settings version) is required",
      );
    }
    return await invokeFn(client, "manage-stay-inventory", {
      action: "publish_stay",
      venueId: args.venue_id,
      expectedVersion: args.expected_version,
    });
  },
);

const manageStayPolicyPriceMedia = writeTool(
  "manage_stay_policy_price_media",
  "Set a Stay offering's policy/price/fees or manage its media via manage-stay-inventory. Policy/price/fees are money changes; media actions accept only pre-authorized uploaded objects (never an invented URL or storage key). Requires the exact offering version.",
  {
    brand_id: UUID,
    venue_id: UUID,
    action: {
      type: "string",
      enum: [
        "set_policy",
        "set_price",
        "replace_fees",
        "attach_media",
        "reorder_media",
        "remove_media",
      ],
    },
    payload: { type: "object" },
    expected_version: { type: "integer", minimum: 1 },
  },
  ["brand_id", "venue_id", "action", "payload", "expected_version"],
  async (args, client, _userId, context) => {
    requireAgentOperationId(context);
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    if (
      !Number.isInteger(args.expected_version) ||
      Number(args.expected_version) < 1
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "expected_version (current offering version) is required",
      );
    }
    return await invokeFn(client, "manage-stay-inventory", {
      action: args.action,
      venueId: args.venue_id,
      payload: (args.payload as Record<string, unknown>) ?? {},
      expectedVersion: args.expected_version,
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

/**
 * issue #2291 — plain-text fallback for the email payload's `body_text`,
 * byte-identical to the composer's own `stripHtml` at
 * `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`, so an
 * Ari-drafted row and an operator-drafted row have the same shape.
 *
 * Cosmetic by design: `renderMarketingEmail` regenerates the text/plain part
 * from `body_html` and never reads this key. It is written for parity with the
 * composer, not because anything downstream consumes it.
 */
function stripHtmlToText(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

const draftCampaign = writeTool(
  "draft_campaign",
  // issue #2291 — the description is part of the fix. Ari wrote `body` into a
  // key the email path never reads because nothing told it email needs a
  // subject line and an HTML body under `body_html`.
  "Create a marketing campaign draft (RLS insert). Does not send. " +
    "`body` is the message content: for email it is the HTML body and `subject` " +
    "is the subject line (both required); for sms it is the plain-text body and " +
    "`subject` is ignored. Only 'email' and 'sms' can be sent.",
  {
    brand_id: UUID,
    title: STR,
    body: { type: "string" },
    subject: { type: "string" },
    channel: { type: "string", enum: ["email", "sms"] },
  },
  ["brand_id", "title"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    // issue #2291 (M2) — `rcs` was accepted here and by the DB CHECK, but
    // `dispatchByKind` in marketing-send has no rcs arm and throws
    // `unknown_channel_kind:rcs`. An rcs draft could only ever be claimed and
    // then flipped to 'failed'. Refuse it at the writer instead of storing a
    // campaign that is guaranteed to fail.
    if (
      args.channel !== undefined && args.channel !== "email" &&
      args.channel !== "sms"
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        `channel must be "email" or "sms" — ${
          String(args.channel)
        } cannot be dispatched`,
      );
    }
    const channel = args.channel === "sms" ? "sms" : "email";
    // Build the CHANNEL-CORRECT payload. Before #2291 this wrote a single
    // `body` key for every channel — correct for sms (marketing-send's sms
    // branch reads `body`), silently empty for email (the email branch reads
    // `subject` + `body_html`).
    const rawBody = typeof args.body === "string" ? args.body : "";
    const channelPayload = channel === "sms"
      ? { kind: "sms", body: rawBody }
      : {
        kind: "email",
        subject: typeof args.subject === "string" ? args.subject : "",
        body_html: rawBody,
        body_text: stripHtmlToText(rawBody),
        embedded_events: [] as string[],
      };
    // Validate BEFORE the audience side-effects below, so a bad call cannot
    // leave a stray system audience behind.
    const payloadIssues = campaignPayloadIssues(channelPayload);
    if (payloadIssues.length > 0) {
      throw new ToolError("INVALID_ARGS", payloadIssues.join("; "));
    }
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
        channel_payload: channelPayload,
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
    // issue #2291 — CONTENT GATE. `schedule_campaign` carries NO confirm phrase
    // (only `send_campaign_now` does), and cron `orch_0815_b_marketing_send`
    // dispatches whatever is 'scheduled' every minute under the service role.
    // So arming a campaign here is, in practice, sending it — with no human in
    // the loop. Fixing only `draft_campaign` would leave this independently
    // exploitable against the empty-bodied drafts the composer already
    // persists (11 of them in production at the time of writing), because
    // those carry the RIGHT keys with EMPTY values and the key mismatch never
    // enters into it.
    const { data: existing, error: loadErr } = await client
      .from("marketing_campaigns")
      .select("channel_payload")
      .eq("id", args.campaign_id)
      .maybeSingle();
    if (loadErr) throw new ToolError("RPC_FAILED", loadErr.message);
    if (!existing) throw new ToolError("INVALID_ARGS", "Campaign not found");
    const payloadIssues = campaignPayloadIssues(
      (existing as { channel_payload?: unknown }).channel_payload,
    );
    if (payloadIssues.length > 0) {
      throw new ToolError(
        "INVALID_ARGS",
        `This campaign cannot be scheduled yet: ${payloadIssues.join("; ")}`,
      );
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
  setBrandPricingDefaults,
  publishExperience,
  updateExperience,
  manageExperienceStops,
  unpublishExperience,
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
  manageStayInventory,
  publishStay,
  manageStayPolicyPriceMedia,
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
  // #1975 — money-affecting Stay operations. create/transition hold priced
  // inventory or move cancellation/refund obligations; policy/price/fees are
  // versioned money changes. Confirmed (not read-only), never inline.
  "create_stay_reservation",
  "transition_stay",
  "manage_stay_policy_price_media",
]);
