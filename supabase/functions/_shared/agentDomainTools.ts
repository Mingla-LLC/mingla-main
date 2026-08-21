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

const RSVP_PARTY_TYPES = [
  "birthday-party",
  "rooftop-party",
  "club-night",
  "house-party",
  "warehouse-party",
  "beach-party",
  "pool-party",
  "boat-party",
  "themed-party",
  "corporate-event",
  "graduation-party",
  "holiday-party",
  "networking-event",
  "rave",
  "festival",
] as const;

function compactRsvpPayload(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const copy = (target: string, source = target): void => {
    if (args[source] !== undefined) payload[target] = args[source];
  };
  copy("title");
  copy("description");
  copy("timezone");
  copy("city");
  copy("partyTypes", "party_types");
  copy("vibeTags", "vibe_tags");
  copy("musicGenres", "music_genres");
  copy("requestedVisibility", "requested_visibility");
  copy("rsvpCapacity", "capacity");
  copy("rsvpAllowPlusOnes", "allow_plus_ones");
  copy("rsvpPlusOnesMax", "plus_ones_max");
  copy("rsvpWaitlistEnabled", "waitlist_enabled");
  copy("rsvpApprovalMode", "approval_mode");
  copy("rsvpDiscoverable", "discoverable");
  copy("privateGuestList", "private_guest_list");
  copy("hideRemainingCount", "hide_remaining_count");
  copy("hideAddressUntilTicket", "hide_address_until_rsvp");
  copy("rsvpContributionEnabled", "contribution_enabled");
  copy("rsvpContributionSuggestedCents", "suggested_cents");
  copy("rsvpContributionMinCents", "minimum_cents");
  if (
    args.date !== undefined || args.doors_open !== undefined ||
    args.ends_at !== undefined
  ) {
    payload.when = {
      ...(args.date !== undefined ? { date: args.date } : {}),
      ...(args.doors_open !== undefined ? { doorsOpen: args.doors_open } : {}),
      ...(args.ends_at !== undefined ? { endsAt: args.ends_at } : {}),
      ...(args.timezone !== undefined ? { timezone: args.timezone } : {}),
    };
  }
  if (args.format !== undefined) {
    payload.format = args.format;
    payload.is_online = args.format === "online" || args.format === "hybrid";
  }
  copy("location_text");
  copy("online_url");
  return payload;
}

const RSVP_WRITE_PROPERTIES = {
  title: { type: "string", minLength: 1, maxLength: 180 },
  description: { type: "string", maxLength: 5000 },
  timezone: { type: "string", minLength: 1, maxLength: 100 },
  format: { type: "string", enum: ["in_person", "online", "hybrid"] },
  date: { type: "string", minLength: 10, maxLength: 10 },
  doors_open: { type: "string", minLength: 5, maxLength: 5 },
  ends_at: { type: "string", minLength: 5, maxLength: 5 },
  location_text: { type: "string", maxLength: 500 },
  online_url: { type: "string", maxLength: 2000 },
  city: { type: "string", maxLength: 120 },
  party_types: {
    type: "array",
    maxItems: 15,
    items: { type: "string", enum: RSVP_PARTY_TYPES },
  },
  vibe_tags: { type: "array", maxItems: 16, items: { type: "string" } },
  music_genres: { type: "array", maxItems: 18, items: { type: "string" } },
  requested_visibility: {
    type: "string",
    enum: ["public", "unlisted", "private"],
  },
  capacity: { type: "integer", minimum: 1, maximum: 100000 },
  allow_plus_ones: { type: "boolean" },
  plus_ones_max: { type: "integer", minimum: 0, maximum: 20 },
  waitlist_enabled: { type: "boolean" },
  approval_mode: { type: "string", enum: ["auto", "manual"] },
  discoverable: { type: "boolean" },
  private_guest_list: { type: "boolean" },
  hide_remaining_count: { type: "boolean" },
  hide_address_until_rsvp: { type: "boolean" },
  contribution_enabled: { type: "boolean" },
  suggested_cents: { type: "integer", minimum: 1 },
  minimum_cents: { type: "integer", minimum: 1 },
} as const;

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

async function executeRsvpWrite(
  name: string,
  args: Record<string, unknown>,
  client: any,
  context: Parameters<AgentToolDefinition["executor"]>[3],
): Promise<unknown> {
  return await callRpc(client, "ari_execute_rsvp_operation", {
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
  "Create one private canonical RSVP draft. Dates, tickets, and public visibility are never created before publish.",
  { brand_id: UUID, ...RSVP_WRITE_PROPERTIES },
  ["brand_id", "title", "timezone", "format"],
  async (args, client, userId, context) => {
    await requireBrand(args, client, userId);
    return await executeRsvpWrite("create_rsvp", args, client, context);
  },
);

const updateRsvp = writeTool(
  "update_rsvp",
  "Update the same canonical RSVP draft or live RSVP. A live edit requires a 10–200 character reason.",
  {
    event_id: UUID,
    ...RSVP_WRITE_PROPERTIES,
    reason: { type: "string", minLength: 10, maxLength: 200 },
  },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    const payload = compactRsvpPayload(args);
    if (Object.keys(payload).length === 0) {
      throw new ToolError("INVALID_ARGS", "Nothing to update");
    }
    return await executeRsvpWrite("update_rsvp", args, client, context);
  },
);

const publishRsvp = writeTool(
  "publish_rsvp",
  "Publish the fresh stored canonical RSVP draft through business_publish_rsvp_draft. Never creates tickets.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeRsvpWrite("publish_rsvp", args, client, context);
  },
);

const updateRsvpContributionSettings = writeTool(
  "update_rsvp_contribution_settings",
  "Update chip-in settings through the same RSVP draft/live owner. Values are minor units in the event currency.",
  {
    event_id: UUID,
    contribution_enabled: { type: "boolean" },
    suggested_cents: { type: "integer", minimum: 1 },
    minimum_cents: { type: "integer", minimum: 1 },
    reason: { type: "string", minLength: 10, maxLength: 200 },
  },
  ["event_id", "contribution_enabled"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeRsvpWrite(
      "update_rsvp_contribution_settings",
      args,
      client,
      context,
    );
  },
);

const setRsvpGuestStatus = writeTool(
  "set_rsvp_guest_status",
  "Approve or deny exactly selected RSVP roster keys, or explicitly act on all pending guests.",
  {
    event_id: UUID,
    decision: { type: "string", enum: ["approve", "deny"] },
    scope: { type: "string", enum: ["selected", "all_pending"] },
    roster_keys: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "string", minLength: 6, maxLength: 50 },
    },
    roster_watermark: { type: "integer", minimum: 0 },
  },
  ["event_id", "decision", "scope"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    if (
      args.scope === "selected" &&
      (!Array.isArray(args.roster_keys) || args.roster_keys.length === 0)
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "roster_keys are required for selected scope",
      );
    }
    if (args.scope === "all_pending" && args.roster_keys !== undefined) {
      throw new ToolError(
        "INVALID_ARGS",
        "roster_keys must be omitted for all_pending scope",
      );
    }
    return await executeRsvpWrite(
      "set_rsvp_guest_status",
      args,
      client,
      context,
    );
  },
);

const refundRsvpContribution = writeTool(
  "refund_rsvp_contribution",
  "Refund an RSVP chip-in through the contribution source-refund path. The server derives exact refundable cents.",
  {
    event_id: UUID,
    contribution_id: UUID,
    mode: { type: "string", enum: ["discretionary", "cancellation"] },
    reason: { type: "string", minLength: 3, maxLength: 200 },
  },
  ["event_id", "contribution_id", "mode", "reason"],
  async (args, client, userId, context) => {
    const { eventId } = await requireEvent(args, client, userId);
    if (!isUuid(args.contribution_id)) {
      throw new ToolError("INVALID_ARGS", "contribution_id must be a uuid");
    }
    return await invokeFn(
      client,
      "rsvp-contribution-refund",
      {
        eventId,
        contributionId: args.contribution_id,
        mode: args.mode,
        reason: args.reason,
        operationId: requireAgentOperationId(context),
        operationArgs: args,
      },
      { "Idempotency-Key": requireAgentOperationId(context) },
    );
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
  "List the server-minimized RSVP roster. Returns display names and attendance/approval state, never contact or payment PII.",
  {
    event_id: UUID,
    search: { type: "string", maxLength: 120 },
    cursor: { type: "object" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  ["event_id"],
  async (args, client, userId) => {
    await assertAgentReadEvent(client, userId, args.event_id);
    await requireEvent(args, client, userId);
    return await callRpc(client, "business_list_rsvp_roster", {
      p_event_id: args.event_id,
      p_search: args.search ?? null,
      p_cursor: args.cursor ?? null,
      p_limit: args.limit ?? 50,
    });
  },
);

const listRsvpContributions = writeTool(
  "list_rsvp_contributions",
  "List refundable RSVP contributions with safe labels and exact server-derived amounts. Never returns orders or provider references.",
  {
    event_id: UUID,
    status: {
      type: "string",
      enum: ["paid", "partially_refunded", "refunded"],
    },
    cursor: { type: "object" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  ["event_id"],
  async (args, client, userId) => {
    await assertAgentReadEvent(client, userId, args.event_id);
    await requireEvent(args, client, userId);
    return await callRpc(client, "business_list_rsvp_contributions", {
      p_event_id: args.event_id,
      p_status: args.status ?? null,
      p_cursor: args.cursor ?? null,
      p_limit: args.limit ?? 50,
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
  manageExperienceStops,
  unpublishExperience,
  deleteExperience,
  createTrip,
  updateTrip,
  publishTrip,
  deleteTrip,
  createRsvp,
  updateRsvp,
  publishRsvp,
  updateRsvpContributionSettings,
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
  listRsvpContributions,
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
  "list_rsvp_contributions",
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
