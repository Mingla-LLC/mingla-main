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
//
// issue #1971 — every trip write commits through `ari_execute_trip_operation`,
// which is the same canonical command boundary Business web/iOS/Android call.
// No Ari executor may touch events / event_dates / trip_days / trip_inclusions /
// ticket_types / trip_pricing_tiers / trip_intake_schemas directly for these
// operations (I-PROPOSED-1971-TRIP-GRAPH-ONE-COMMAND).
// ----------------------------------------------------------------------------

const TRIP_REVISION = {
  type: "string",
  description:
    "The trip's current updated_at, exactly as the last read returned it. A stale value fails with trip_revision_conflict and writes nothing.",
};
const TRIP_LIVE_REASON = {
  type: "string",
  minLength: 10,
  maxLength: 200,
  description:
    "Audit reason. Required when the trip is scheduled or live; ignored on a draft.",
};

async function executeTripWrite(
  name: string,
  args: Record<string, unknown>,
  client: any,
  context: Parameters<AgentToolDefinition["executor"]>[3],
): Promise<unknown> {
  return await callRpc(client, "ari_execute_trip_operation", {
    p_operation_id: requireAgentOperationId(context),
    p_tool_name: name,
    p_args: args,
  });
}

/**
 * Shared executor body for the four trip graph-group tools. Each tool still
 * calls `writeTool("<literal name>", ...)` directly: the #1970 registry sync and
 * the #2000 ledger gate discover tool names by scanning for that literal, so a
 * factory that CONSTRUCTED the writeTool call would register a tool neither gate
 * can see. Sharing the executor, not the registration, keeps both true.
 */
function tripGraphGroupSchema(
  itemSchema: Record<string, unknown>,
): Record<string, unknown> {
  return {
    event_id: UUID,
    expected_updated_at: TRIP_REVISION,
    reason: TRIP_LIVE_REASON,
    items: { type: "array", items: itemSchema },
  };
}

const TRIP_GRAPH_REQUIRED = ["event_id", "expected_updated_at", "items"];

function tripGraphExecutor(
  name: string,
): AgentToolDefinition["executor"] {
  return async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    if (!Array.isArray(args.items)) {
      throw new ToolError("INVALID_ARGS", "items must be an array");
    }
    return await executeTripWrite(name, args, client, context);
  };
}

const createTrip = writeTool(
  "create_trip",
  "Create a draft trip under an owned brand. Produces the complete canonical draft graph — event, placeholder Standard package and its pricing tier — so it opens identically in the manual trip wizard.",
  {
    brand_id: UUID,
    title: STR,
    description: { type: "string" },
    provenance: {
      type: "object",
      description:
        "Opaque origin marker (issue #1753 owns quote-to-draft mapping). Never invent one.",
    },
  },
  ["brand_id", "title"],
  async (args, client, userId, context) => {
    requireBrand(args, client, userId);
    return await executeTripWrite("create_trip", args, client, context);
  },
);

const updateTrip = writeTool(
  "update_trip",
  "Edit an owned trip's title/description. A draft edits in place; a scheduled or live trip routes through the audited live-edit authority and needs a 10-200 character reason.",
  {
    event_id: UUID,
    expected_updated_at: TRIP_REVISION,
    title: STR,
    description: { type: "string" },
    reason: TRIP_LIVE_REASON,
  },
  ["event_id", "expected_updated_at"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    if (!isString(args.title) && typeof args.description !== "string") {
      throw new ToolError("INVALID_ARGS", "Nothing to update");
    }
    return await executeTripWrite("update_trip", args, client, context);
  },
);

const manageTripDays = writeTool(
  "manage_trip_days",
  "Replace the trip's ordered itinerary in one atomic write. Send the COMPLETE list you want to end up with — omitted days are removed. Never invent media URLs.",
  tripGraphGroupSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      ordinal: { type: "integer", minimum: 1 },
      title: STR,
      narrative: { type: "string" },
      date: { type: "string" },
      media: { type: "array", items: { type: "object" } },
    },
    required: ["ordinal", "title"],
  }),
  TRIP_GRAPH_REQUIRED,
  tripGraphExecutor("manage_trip_days"),
);

const manageTripInclusions = writeTool(
  "manage_trip_inclusions",
  "Replace the trip's what's-included and what's-not lists in one atomic write. Send the COMPLETE list you want to end up with.",
  tripGraphGroupSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["included", "excluded"] },
      item: STR,
      ordinal: { type: "integer", minimum: 0 },
    },
    required: ["kind", "item", "ordinal"],
  }),
  TRIP_GRAPH_REQUIRED,
  tripGraphExecutor("manage_trip_inclusions"),
);

const manageTripTiers = writeTool(
  "manage_trip_tiers",
  "Create, update or remove trip packages, including deposit and instalment metadata. Money-bearing: always show the currency and the before/after amounts in the proposal. A package that has sold cannot be removed.",
  tripGraphGroupSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      ticket_type_id: { type: "string", format: "uuid" },
      tier_name: STR,
      price_cents: { type: "integer", minimum: 0 },
      capacity: { type: "integer", minimum: 1 },
      display_order: { type: "integer", minimum: 0 },
      deleted: { type: "boolean" },
      tier_metadata: { type: "object" },
    },
    required: [],
  }),
  TRIP_GRAPH_REQUIRED,
  tripGraphExecutor("manage_trip_tiers"),
);

const manageTripTravelerIntake = writeTool(
  "manage_trip_traveler_intake",
  "Replace the traveller-question schema for a trip package. Name the package and which required questions were added or removed; never read or repeat a traveller's answers.",
  tripGraphGroupSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      ticket_type_id: { type: "string", format: "uuid" },
      schema: { type: "object" },
    },
    required: ["ticket_type_id"],
  }),
  TRIP_GRAPH_REQUIRED,
  tripGraphExecutor("manage_trip_traveler_intake"),
);

const publishTrip = writeTool(
  "publish_trip",
  "Publish a draft trip. The server loads the complete stored graph and publishes that — you cannot supply or reconstruct the payload.",
  { event_id: UUID, expected_updated_at: TRIP_REVISION },
  ["event_id", "expected_updated_at"],
  async (args, client, userId, context) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    const { data: paid } = await client.from("ticket_types").select("id").eq(
      "event_id",
      eventId,
    ).gt("price_cents", 0).limit(1);
    if (paid && paid.length > 0) await assertCanCollect(client, brandId);
    return await executeTripWrite("publish_trip", args, client, context);
  },
);

const deleteTrip = writeTool(
  "delete_trip",
  "Soft-delete an owned trip. Refused while ANY order is outstanding on any payment rail — card, door, or manual. The confirmation performs the authoritative transactional recheck.",
  { event_id: UUID, expected_updated_at: TRIP_REVISION },
  ["event_id", "expected_updated_at"],
  async (args, client, userId, context) => {
    await requireEvent(args, client, userId);
    return await executeTripWrite("delete_trip", args, client, context);
  },
);

const getTripOrderMoney = writeTool(
  "get_trip_order_money",
  "Read a trip's aggregate order and instalment totals (finance-manager+). Counts, gross, refunded and per-package sold only — never a buyer's name, email, phone, address or payment instrument.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId) => {
    const { eventId } = await requireEvent(args, client, userId);
    return await callRpc(client, "biz_get_trip_order_money_snapshot", {
      p_event_id: eventId,
    });
  },
);

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
// E. RSVP
//
// issue #1977 — RSVP writes commit through `ari_execute_rsvp_operation`, the
// same canonical graph/guest/contribution boundary Business uses. No Ari
// executor may shallow-insert `events` or call `refund-order` for chip-ins.
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

// #1975 — Stay/venue tools are STRICT adapters over the exact canonical
// Edge/RPC envelopes used by Business web/iOS/Android. No invented action,
// header, or RPC signature. Caller JWT only; the database re-authorizes the
// exact resource, role/capability, optimistic version, and idempotency.

// #2592 B4 — ONE strict E.164 shape for every Ari reservation guest contact.
// This is the EXACT pattern the owning authorities already enforce: `STRICT_E164`
// in `supabase/functions/stay-reservations/index.ts`, and the SQL
// `reservation_phone_must_be_e164` guard on `biz_reservation_create`
// (`20270325001857_issue_1857_phone_country_authority.sql`).
//
// `normalizeE164()` from `_shared/e164Country.ts` is deliberately NOT reused as
// the validator: it NORMALISES and accepts 2-digit national numbers (`+2000`),
// which both owners reject. Reusing it would make this tool accept payloads the
// owning Edge and RPC refuse, which is the same class of contract lie #2592 is
// repairing.
const STRICT_E164_RE = /^\+[1-9][0-9]{7,14}$/;
const E164_PATTERN = "^\\+[1-9][0-9]{7,14}$";

const STAY_GUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: STR,
    email: { type: "string" },
    phone: {
      type: "string",
      pattern: E164_PATTERN,
      description: "Strict E.164, e.g. +14155550123.",
    },
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
  if (hasPhone) {
    // #2592 B4 — the refusal below CLAIMS E.164; nothing used to check it, so a
    // free-text phone reached `stay-reservations`, which rejects it there.
    const phone = (guest.phone as string).trim();
    if (!STRICT_E164_RE.test(phone)) {
      throw new ToolError(
        "INVALID_ARGS",
        "guest.phone must be E.164 (e.g. +14155550123)",
      );
    }
    out.phone = phone;
  }
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
    expected_version: {
      type: "integer",
      minimum: 1,
      description:
        "Current group version. REQUIRED for approve_request and decline_request; MUST be omitted for cancel.",
    },
    // Cancellation must reference an existing canonical cancel_preview result.
    preview_id: {
      ...UUID,
      description:
        "cancel_preview id. REQUIRED for cancel; MUST be omitted otherwise.",
    },
    preview_hash: {
      type: "string",
      minLength: 64,
      maxLength: 64,
      description:
        "cancel_preview hash. REQUIRED for cancel; MUST be omitted otherwise.",
    },
    reason: {
      type: "string",
      minLength: 3,
      maxLength: 500,
      description:
        "Cancellation reason. REQUIRED for cancel; MUST be omitted otherwise.",
    },
  },
  ["operation", "group_id"],
  async (args, client, _userId, context) => {
    const operationId = requireAgentOperationId(context);
    if (!isUuid(args.group_id)) {
      throw new ToolError("INVALID_ARGS", "group_id must be a uuid");
    }
    // #2592 B3 — `operation` discriminates a union whose per-branch
    // requirements the provider typed schema cannot express: only the keywords
    // in `PROVIDER_SCHEMA_FIELDS` (`_shared/agentGemini.ts`) reach the model,
    // and `oneOf`, `allOf`, and `if`/`then` are not among them — emitting one
    // would fail EVERY Ari turn closed with MODEL_SCHEMA_INVALID. The union is
    // therefore refused HERE, deterministically, before any dispatch:
    //   1. the discriminator itself is validated — without this, an unknown
    //      operation fell through to the `cancel` branch and could execute a
    //      cancellation the caller never named;
    //   2. each branch rejects the OTHER branch's fields, so a versioned
    //      approve cannot smuggle a preview binding and vice versa.
    if (
      args.operation !== "approve_request" &&
      args.operation !== "decline_request" &&
      args.operation !== "cancel"
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "operation must be approve_request, decline_request, or cancel",
      );
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
      if (
        args.preview_id !== undefined || args.preview_hash !== undefined ||
        args.reason !== undefined
      ) {
        throw new ToolError(
          "INVALID_ARGS",
          "preview_id, preview_hash, and reason belong to cancel only",
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
    if (args.expected_version !== undefined) {
      throw new ToolError(
        "INVALID_ARGS",
        "cancel is bound to a preview, not a version — omit expected_version",
      );
    }
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
    guest_phone_e164: {
      type: "string",
      pattern: E164_PATTERN,
      description: "Strict E.164, e.g. +14155550123.",
    },
    guest_email: { type: "string" },
    table_id: UUID,
    occasion: { type: "string" },
    guest_notes: { type: "string" },
    tags: { type: "array", items: STR },
    // A manual booking starts in a non-terminal, sensible state only.
    status: { type: "string", enum: ["requested", "confirmed", "seated"] },
  },
  ["brand_id", "venue_id", "reserved_for", "party_size"],
  async (args, client, userId, context) => {
    requireAgentOperationId(context);
    requireBrand(args, client, userId);
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
      !STRICT_E164_RE.test((args.guest_phone_e164 as string).trim())
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "guest_phone_e164 must be E.164 (e.g. +14155550123)",
      );
    }
    // #2592 B1 — the canonical RPC is VENUE-keyed. Its first parameter is
    // `p_venue_id` (see `biz_reservation_create` in
    // `20261130000002_orch_1255_ops_rekey.sql`, re-stated identically in
    // `20270325001857_issue_1857_phone_country_authority.sql`), and it derives
    // the brand from `venue_listings`. There is no `p_brand_id` parameter at
    // all, so the previous call could never resolve: PostgREST matches an RPC
    // by its named-argument set, and this tool required a `venue_id` it then
    // dropped on the floor. Bind the venue explicitly, and bind it to the
    // brand this proposal was authorised against so the brand on the
    // confirmation card is the brand the reservation is written to. The read
    // is on the caller's own JWT-scoped client (I-ARI-USER-JWT-ONLY); the RPC
    // still re-gates manager+ on the derived brand.
    const { data: venueRow, error: venueError } = await client
      .from("venue_listings")
      .select("id, brand_id")
      .eq("id", args.venue_id)
      .maybeSingle();
    if (venueError) throw new ToolError("READ_FAILED", venueError.message);
    if (
      !venueRow ||
      (venueRow as Record<string, unknown>).brand_id !== args.brand_id
    ) {
      throw new ToolError(
        "BRAND_ACCESS_DENIED",
        "That brand or resource is unavailable",
      );
    }
    return await callRpc(client, "biz_reservation_create", {
      p_venue_id: args.venue_id,
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
      // #2592 B5 — the schema says `items: STR`, but nothing enforced element
      // type at runtime, so a non-string element reached a `text[]` parameter.
      // Coerce to exactly what STR declares: trimmed, 1..500-character strings.
      p_tags: Array.isArray(args.tags)
        ? (args.tags as unknown[])
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length >= 1 && tag.length <= 500)
        : [],
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
    try {
      return await callRpc(client, "issue_1975_reservation_transition", {
        p_reservation_id: args.reservation_id,
        p_to_status: args.to_status,
        p_expected_version: args.expected_version,
        p_table_id: isUuid(args.table_id) ? args.table_id : null,
        p_reason: isString(args.reason) ? args.reason : null,
      });
    } catch (error) {
      // #2592 A2 — a stale `expected_version` is a DETERMINISTIC caller
      // mistake, and it must never be re-sent unchanged.
      //
      // Every other optimistic-concurrency site in this repo raises the same
      // SQLSTATE '40001' and lets its OWNING Edge function translate the stable
      // message literal into HTTP 409 (`manage-stay-inventory`,
      // `stay-reservations`, `manage-brand-discovery-currency` all do exactly
      // this). `issue_1975_reservation_transition` is the one such site Ari
      // calls straight through `callRpc`, with no owning Edge in front of it —
      // so the conflict arrived as the generic `RPC_FAILED`, which
      // `toolErrorHttpStatus` maps to 500. A 500 is the one classification the
      // Ari envelope contract treats as `safe_to_retry: true`, and it tells
      // both the model and the operator "server fault, try again" about a
      // request that will fail identically forever.
      //
      // The translation happens here instead, in the same shape and with the
      // same 409 semantics as the Edge-owned siblings, and the message carries
      // the ACTUAL current version so the next attempt is a fresh read rather
      // than the same stale number.
      const message = error instanceof ToolError
        ? error.message
        : String((error as { message?: unknown })?.message ?? error);
      if (message.includes("reservation_version_conflict")) {
        const actual = message.match(/actual_(\d+)/)?.[1];
        throw new ToolError(
          "VERSION_CONFLICT",
          actual === undefined
            ? "This reservation changed since you looked. Read it again and retry with its current version."
            : `This reservation changed since you looked — it is now at version ${actual}. Read it again and retry with that version, not ${args.expected_version}.`,
        );
      }
      throw error;
    }
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
    expected_version: {
      type: "integer",
      minimum: 1,
      description:
        "Current Stay version. REQUIRED for every action except 'get'.",
    },
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
    // #2592 B2 — this tool's own description states that every non-`get`
    // action is a versioned mutation, but `expected_version` sat outside the
    // schema's `required` list and was only forwarded when present, so a
    // confirmed mutation could dispatch with no `expectedVersion` at all and
    // lose optimistic concurrency entirely.
    //
    // It cannot move into the flat `required` list without also making it
    // mandatory for `get`, and the conditional forms that would express it
    // (`oneOf`, `allOf`, `if`/`then`) are not in `PROVIDER_SCHEMA_FIELDS`
    // (`_shared/agentGemini.ts`) — emitting one fails EVERY Ari turn closed
    // with MODEL_SCHEMA_INVALID. So the conditional requirement is enforced
    // here, deterministically, and `expectedVersion` is now ALWAYS forwarded
    // for a mutation rather than conditionally.
    if (
      !Number.isInteger(args.expected_version) ||
      Number(args.expected_version) < 1
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "expected_version (current Stay version) is required for every action except get",
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

// issue #1978 — the venue category vocabulary the canonical create RPC accepts
// (`biz_create_venue_listing`: 'restaurant' | 'play' | 'creative_and_arts').
const VENUE_CATEGORIES = ["restaurant", "play", "creative_and_arts"] as const;

// issue #1978 — one canonical opening-hours row shape, identical to
// manage_brand_hours and to the seven rows the create RPC parses out of
// `p_hours` (weekday 0..6, HH:MM open/close, is_closed).
const VENUE_HOUR_ROW = {
  type: "object",
  additionalProperties: false,
  required: ["weekday", "is_closed"],
  properties: {
    weekday: { type: "integer", minimum: 0, maximum: 6 },
    open_time: { type: "string", description: "Local HH:MM when open." },
    close_time: { type: "string", description: "Local HH:MM when closed." },
    is_closed: { type: "boolean" },
  },
} as const;

// issue #1978 — the venue create/adopt submission. This reproduces the EXACT
// 22-argument envelope the Business wizard sends through
// `venueListingsService.createVenueListing` → `biz_create_venue_listing`
// (event_manager+; lands `pending_review`, never public). Cover media and the
// place choice arrive from the proposal-card pickers — Ari never invents a
// cover url, poster, coordinate, or place id. Publication remains the automatic
// downstream result of admin verification; there is deliberately no publish
// tool.
const createVenueListing = writeTool(
  "create_venue_listing",
  "Submit a venue listing for admin review via biz_create_venue_listing (event_manager+). Lands pending_review; it becomes public only after admin verification — never claim you published it.",
  {
    brand_id: UUID,
    name: STR,
    slug: { type: "string", minLength: 1, maxLength: 32 },
    description: { type: "string", maxLength: 4000 },
    google_place_id: { type: "string", maxLength: 300 },
    lat: { type: "number", minimum: -90, maximum: 90 },
    lng: { type: "number", minimum: -180, maximum: 180 },
    city: { type: "string", maxLength: 200 },
    country_code: { type: "string", maxLength: 8 },
    address: { type: "string", maxLength: 500 },
    venue_category: { type: "string", enum: [...VENUE_CATEGORIES] },
    contact_email: { type: "string", maxLength: 320 },
    contact_phone: { type: "string", maxLength: 64 },
    cover_media_url: { type: "string", maxLength: 2000 },
    cover_media_poster_url: { type: "string", maxLength: 2000 },
    cover_media_type: { type: "string", enum: ["image", "video", "gif"] },
    hours: { type: "array", minItems: 7, maxItems: 7, items: VENUE_HOUR_ROW },
    place_pool_id: UUID,
    coordinate_precision: {
      type: "string",
      enum: ["exact", "approximate"],
    },
    theme_color: { type: "string", maxLength: 64 },
    theme_font: { type: "string", maxLength: 64 },
    theme_animation: { type: "string", maxLength: 64 },
  },
  ["brand_id", "name", "slug", "lat", "lng", "venue_category", "hours"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isString(args.slug)) {
      throw new ToolError("INVALID_ARGS", "slug is required (1-32 chars)");
    }
    if (typeof args.lat !== "number" || typeof args.lng !== "number") {
      throw new ToolError("INVALID_ARGS", "lat and lng must be numbers");
    }
    if (
      !VENUE_CATEGORIES.includes(args.venue_category as never)
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "venue_category must be restaurant, play, or creative_and_arts",
      );
    }
    if (!Array.isArray(args.hours) || args.hours.length !== 7) {
      throw new ToolError("INVALID_ARGS", "hours must contain exactly 7 rows");
    }
    // The empty-string sentinels are canonical: the create RPC coalesces '' to
    // NULL per column (media/theme/precision inherit or clear), so a stale
    // client can never block a submission over an optional field.
    return await callRpc(client, "biz_create_venue_listing", {
      p_brand_id: args.brand_id,
      p_name: args.name,
      p_slug: args.slug,
      p_description: args.description ?? "",
      p_google_place_id: args.google_place_id ?? "",
      p_lat: args.lat,
      p_lng: args.lng,
      p_city: args.city ?? "",
      p_country_code: args.country_code ?? "",
      p_address: args.address ?? "",
      p_venue_category: args.venue_category,
      p_contact_email: args.contact_email ?? "",
      p_contact_phone: args.contact_phone ?? "",
      p_cover_media_url: args.cover_media_url ?? "",
      p_cover_media_poster_url: args.cover_media_poster_url ?? "",
      p_cover_media_type: args.cover_media_type ?? "",
      p_hours: args.hours,
      p_place_pool_id: args.place_pool_id ?? null,
      p_coordinate_precision: args.coordinate_precision ?? "",
      p_theme_color: args.theme_color ?? "",
      p_theme_font: args.theme_font ?? "",
      p_theme_animation: args.theme_animation ?? "",
    });
  },
);

// issue #1978 — resubmit a feedback-blocked claim. Venue-keyed to match the
// canonical `biz_resubmit_venue_claim(p_venue_id)` (brand_owner only); returns
// the venue to admin review. There is no separate "initial claim" object — a
// new/adopted listing is already created as pending_review by create above.
const submitVenueClaim = writeTool(
  "submit_venue_claim",
  "Resubmit a feedback-blocked venue claim via biz_resubmit_venue_claim (brand_owner only). Sends the venue back to admin review.",
  { venue_id: UUID },
  ["venue_id"],
  async (args, client, _userId) => {
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    return await callRpc(client, "biz_resubmit_venue_claim", {
      p_venue_id: args.venue_id,
    });
  },
);

// issue #1978 — reversible feedback toggle. Row-keyed to match the canonical
// `biz_mark_feedback_item_fixed(p_feedback_id, p_fixed)` (brand_owner only),
// carrying the fixed/open boolean so Ari can reproduce Business's reversible
// behaviour instead of a one-way "mark fixed".
const markClaimFeedbackFixed = writeTool(
  "mark_claim_feedback_fixed",
  "Mark a venue-claim feedback item fixed or open via biz_mark_feedback_item_fixed (brand_owner only). Reversible; fixed defaults to true.",
  { feedback_id: UUID, fixed: { type: "boolean" } },
  ["feedback_id"],
  async (args, client, _userId) => {
    if (!isUuid(args.feedback_id)) {
      throw new ToolError("INVALID_ARGS", "feedback_id must be a uuid");
    }
    return await callRpc(client, "biz_mark_feedback_item_fixed", {
      p_feedback_id: args.feedback_id,
      p_fixed: args.fixed ?? true,
    });
  },
);

// issue #1978 — PII-minimised venue reads so Ari can discover safe identifiers
// (venue_id, place_pool_id, claim state) instead of guessing UUIDs. No contact
// email/phone, exact coordinates, address, rejection free text, or admin ids.
const listVenueListings = writeTool(
  "list_venue_listings",
  "List a brand's venue listings (scanner+). PII-minimised: identity, category, claim status, follow-up flag — never contact details, coordinates, address, or rejection text.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    const { data, error } = await client
      .from("venue_listings")
      .select(
        "id, name, slug, city, venue_category, claim_status, claim_follow_up_at, place_pool_id, created_at",
      )
      .eq("brand_id", args.brand_id)
      .order("created_at", { ascending: true });
    if (error) throw new ToolError("READ_FAILED", error.message);
    return {
      venues: (data ?? []).map((row: Record<string, unknown>) => ({
        venue_id: row.id,
        name: row.name,
        slug: row.slug,
        city: row.city,
        venue_category: row.venue_category,
        claim_status: row.claim_status,
        needs_follow_up: row.claim_follow_up_at !== null,
        place_pool_id: row.place_pool_id,
        created_at: row.created_at,
      })),
    };
  },
);

const getVenueListingStatus = writeTool(
  "get_venue_listing_status",
  "Read one venue listing's review status (scanner+). Returns the minimised identity, lifecycle label, public eligibility, and follow-up flag; no raw feedback notes.",
  { venue_id: UUID },
  ["venue_id"],
  async (args, client, _userId) => {
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    const { data, error } = await client
      .from("venue_listings")
      .select(
        "id, name, slug, city, venue_category, claim_status, claim_follow_up_at, place_pool_id, created_at",
      )
      .eq("id", args.venue_id)
      .maybeSingle();
    if (error) throw new ToolError("READ_FAILED", error.message);
    if (!data) {
      throw new ToolError(
        "BRAND_ACCESS_DENIED",
        "That brand or resource is unavailable",
      );
    }
    const row = data as Record<string, unknown>;
    return {
      venue_id: row.id,
      name: row.name,
      slug: row.slug,
      city: row.city,
      venue_category: row.venue_category,
      claim_status: row.claim_status,
      needs_follow_up: row.claim_follow_up_at !== null,
      // Public only after admin verification — never a business-owned toggle.
      public: row.claim_status === "verified",
      place_pool_id: row.place_pool_id,
      created_at: row.created_at,
    };
  },
);

const listVenueClaimFeedback = writeTool(
  "list_venue_claim_feedback",
  "Read the active-round admin feedback for one venue (brand_owner only). Returns the current round's items; never created_by, contact fields, or historical rounds.",
  { venue_id: UUID },
  ["venue_id"],
  async (args, client, _userId) => {
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    const { data, error } = await client
      .from("venue_claim_active_feedback")
      .select(
        "id, round, category, note, overall_message, status, resolved_at",
      )
      .eq("venue_id", args.venue_id)
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new ToolError("READ_FAILED", error.message);
    return {
      venue_id: args.venue_id,
      feedback: (data ?? []).map((row: Record<string, unknown>) => ({
        feedback_id: row.id,
        round: row.round,
        category: row.category,
        note: row.note,
        overall_message: row.overall_message,
        status: row.status,
        resolved_at: row.resolved_at,
      })),
    };
  },
);

// ----------------------------------------------------------------------------
// H. Venue ops
// ----------------------------------------------------------------------------

// #1979 — venue_ops_action is a THIN, EXACT proxy over venue-order-staff. Its
// advertised vocabulary and its wire envelope match the endpoint's real actions
// 1:1 (index.ts switch): create | settle | tab_open | tab_close | transition |
// refund_decision | item_availability | pause | set_ordering_enabled. The
// pre-#1979 tool advertised list_tables/open_tab/close_tab/add_item/
// send_to_kitchen/seat_waitlist/list_waitlist and wrapped everything in a
// generic {action, payload} — an empty intersection with the endpoint, so every
// call returned `unknown_action` before any domain mutation. The fields are
// forwarded per-action in the endpoint's own camelCase shape; brand_id/venue_id
// stay snake_case because the #2019 authorization seam resolves the venue by
// venue_id and proves it belongs to the caller's brand before the executor runs.
const venueOpsAction = writeTool(
  "venue_ops_action",
  "Staff venue order-pad / tabs / kitchen queue / ordering controls via venue-order-staff. " +
    "action is one of create | settle | tab_open | tab_close | transition | refund_decision | " +
    "item_availability | pause | set_ordering_enabled. Role-gated (event_manager+). " +
    "Menu 86, waitlist, and availability live in their own tools, not here.",
  {
    brand_id: UUID,
    venue_id: UUID,
    action: {
      type: "string",
      enum: [
        "create",
        "settle",
        "tab_open",
        "tab_close",
        "transition",
        "refund_decision",
        "item_availability",
        "pause",
        "set_ordering_enabled",
      ],
    },
    session_id: UUID,
    order_id: UUID,
    menu_item_id: UUID,
    spot_code: STR,
    mode: { type: "string", enum: ["preview"] },
    method: { type: "string", enum: ["venue_collected", "bill_to_phone"] },
    settlement_method: {
      type: "string",
      enum: ["venue_collected", "bill_to_phone"],
    },
    to: {
      type: "string",
      enum: [
        "acknowledged",
        "in_progress",
        "ready",
        "delivered",
        "cancelled",
      ],
    },
    decision: { type: "string", enum: ["approved", "declined"] },
    reason: { type: "string", maxLength: 280 },
    note: { type: "string", maxLength: 280 },
    is_available: { type: "boolean" },
    paused: { type: "boolean" },
    enabled: { type: "boolean" },
    idempotency_key: { type: "string", minLength: 1, maxLength: 200 },
    buyer: { type: "object" },
    lines: { type: "array", items: { type: "object" } },
  },
  ["brand_id", "venue_id", "action"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    const action = String(args.action);
    const requireUuid = (value: unknown, field: string): string => {
      if (!isUuid(value)) {
        throw new ToolError("INVALID_ARGS", `${field} must be a uuid`);
      }
      return value;
    };
    const requireBool = (value: unknown, field: string): boolean => {
      if (typeof value !== "boolean") {
        throw new ToolError("INVALID_ARGS", `${field} must be a boolean`);
      }
      return value;
    };
    const body: Record<string, unknown> = { action };
    switch (action) {
      case "create":
        body.venueId = args.venue_id;
        if (isUuid(args.session_id)) body.sessionId = args.session_id;
        if (isString(args.spot_code)) body.spotCode = args.spot_code;
        if (args.buyer !== undefined) body.buyer = args.buyer;
        if (Array.isArray(args.lines)) body.lines = args.lines;
        if (args.mode === "preview") body.mode = "preview";
        // The confirmed pending-action id is the natural idempotency key; fall
        // back to a fresh key only when the tool is exercised outside a proposal.
        body.idempotencyKey = isString(args.idempotency_key)
          ? args.idempotency_key
          : newIdempotencyKey();
        break;
      case "settle":
        body.orderId = requireUuid(args.order_id, "order_id");
        if (
          args.method !== "venue_collected" && args.method !== "bill_to_phone"
        ) {
          throw new ToolError(
            "INVALID_ARGS",
            "method must be venue_collected or bill_to_phone",
          );
        }
        body.method = args.method;
        if (args.buyer !== undefined) body.buyer = args.buyer;
        break;
      case "tab_open":
        body.sessionId = requireUuid(args.session_id, "session_id");
        break;
      case "tab_close":
        body.sessionId = requireUuid(args.session_id, "session_id");
        if (
          args.settlement_method !== "venue_collected" &&
          args.settlement_method !== "bill_to_phone"
        ) {
          throw new ToolError(
            "INVALID_ARGS",
            "settlement_method must be venue_collected or bill_to_phone",
          );
        }
        body.settlementMethod = args.settlement_method;
        if (args.buyer !== undefined) body.buyer = args.buyer;
        break;
      case "transition":
        body.orderId = requireUuid(args.order_id, "order_id");
        if (typeof args.to !== "string") {
          throw new ToolError("INVALID_ARGS", "to is required");
        }
        body.to = args.to;
        if (isString(args.reason)) body.reason = args.reason;
        break;
      case "refund_decision":
        body.orderId = requireUuid(args.order_id, "order_id");
        if (args.decision !== "approved" && args.decision !== "declined") {
          throw new ToolError(
            "INVALID_ARGS",
            "decision must be approved or declined",
          );
        }
        body.decision = args.decision;
        if (isString(args.note)) body.note = args.note;
        break;
      case "item_availability":
        body.menuItemId = requireUuid(args.menu_item_id, "menu_item_id");
        body.isAvailable = requireBool(args.is_available, "is_available");
        break;
      case "pause":
        body.venueId = args.venue_id;
        body.paused = requireBool(args.paused, "paused");
        break;
      case "set_ordering_enabled":
        body.venueId = args.venue_id;
        body.enabled = requireBool(args.enabled, "enabled");
        break;
      default:
        throw new ToolError("INVALID_ARGS", `unknown action ${action}`);
    }
    return await invokeFn(client, "venue-order-staff", body);
  },
);

// #1979 — the ONLY approved venue SMS is the waitlist "table's ready" send, and
// send-venue-sms accepts EXACTLY { waitlistId }. It derives the destination,
// venue name, market, provider, consent, and the locked template from the
// waitlist row server-side (COMMS-0129 / #1541). The pre-#1979 tool advertised
// an arbitrary { to_phone, body } — a destination/body the endpoint neither
// reads nor allows, bypassing the resource, consent, and template boundaries.
// The wire body is waitlistId ONLY; brand_id is carried for the #2019 role gate.
const sendVenueSms = writeTool(
  "send_venue_sms",
  "Send the approved venue waitlist 'table's ready' SMS via send-venue-sms (smsAdapter only). " +
    "The locked template, destination, and consent are derived from the waitlist row server-side — " +
    "Ari never supplies a phone number or message body. Role-gated (event_manager+).",
  { brand_id: UUID, venue_id: UUID, waitlist_id: UUID },
  ["brand_id", "waitlist_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.waitlist_id)) {
      throw new ToolError("INVALID_ARGS", "waitlist_id must be a uuid");
    }
    return await invokeFn(client, "send-venue-sms", {
      waitlistId: args.waitlist_id,
    });
  },
);

// #1979 — venue availability & reservation configuration. Reads come from the
// server slot engine (pg_venue_available_slots) and the canonical settings row;
// writes ride the manager-plus RLS on venue_reservation_settings / venue_blackouts
// under the caller JWT (I-ARI-USER-JWT-ONLY), the same tables the Business UI writes.
const manageVenueAvailability = writeTool(
  "manage_venue_availability",
  "Venue reservation availability config and blackouts: read_config | read_slots | update_config | " +
    "list_blackouts | upsert_blackout | delete_blackout. Opening hours / service periods are NOT " +
    "editable here (use the hours tool). Role-gated (event_manager+).",
  {
    brand_id: UUID,
    venue_id: UUID,
    action: {
      type: "string",
      enum: [
        "read_config",
        "read_slots",
        "update_config",
        "list_blackouts",
        "upsert_blackout",
        "delete_blackout",
      ],
    },
    date: { type: "string" },
    party_size: { type: "integer", minimum: 1, maximum: 100 },
    reservations_enabled: { type: "boolean" },
    fee_enabled: { type: "boolean" },
    fee_amount_cents: { type: "integer", minimum: 0 },
    fee_currency: { type: "string", minLength: 3, maxLength: 3 },
    cancel_cutoff_hours: { type: "integer", minimum: 0, maximum: 720 },
    no_show_fee_policy: { type: "string", enum: ["forfeit", "none"] },
    blackout_id: UUID,
    date_start: { type: "string" },
    date_end: { type: "string" },
    reason: { type: "string", maxLength: 280 },
    applies_to: { type: "string", enum: ["all", "zone", "table"] },
    zone: {
      type: "string",
      enum: ["indoor", "outdoor", "private_room", "bar", "patio"],
    },
    table_id: UUID,
  },
  ["brand_id", "action"],
  async (args, client, userId) => {
    const brandId = await requireBrand(args, client, userId);
    const action = String(args.action);
    switch (action) {
      case "read_config": {
        // ORCH-1255 rekeyed venue_reservation_settings PK to venue_id.
        if (!isUuid(args.venue_id)) {
          throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
        }
        const { data, error } = await client
          .from("venue_reservation_settings")
          .select(
            "brand_id, venue_id, reservations_enabled, fee_enabled, fee_amount_cents, fee_currency, fee_refundable, cancel_cutoff_hours, no_show_fee_policy, updated_at",
          )
          .eq("venue_id", args.venue_id)
          .eq("brand_id", brandId)
          .maybeSingle();
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return data ?? {
          brand_id: brandId,
          venue_id: args.venue_id,
          reservations_enabled: false,
        };
      }
      case "read_slots": {
        if (!isString(args.date)) {
          throw new ToolError("INVALID_ARGS", "date is required (YYYY-MM-DD)");
        }
        if (typeof args.party_size !== "number") {
          throw new ToolError("INVALID_ARGS", "party_size is required");
        }
        return await callRpc(client, "pg_venue_available_slots", {
          p_date: args.date,
          p_party_size: args.party_size,
          p_venue_id: isUuid(args.venue_id) ? args.venue_id : null,
          p_brand_id: brandId,
        });
      }
      case "update_config": {
        // ORCH-1255: PK is venue_id (not brand_id). Match Business hook upserts.
        if (!isUuid(args.venue_id)) {
          throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
        }
        const patch: Record<string, unknown> = {
          brand_id: brandId,
          venue_id: args.venue_id,
        };
        if (typeof args.reservations_enabled === "boolean") {
          patch.reservations_enabled = args.reservations_enabled;
        }
        if (typeof args.fee_enabled === "boolean") {
          patch.fee_enabled = args.fee_enabled;
        }
        if (typeof args.fee_amount_cents === "number") {
          patch.fee_amount_cents = args.fee_amount_cents;
        }
        if (isString(args.fee_currency)) {
          patch.fee_currency = args.fee_currency.toUpperCase();
        }
        if (typeof args.cancel_cutoff_hours === "number") {
          patch.cancel_cutoff_hours = args.cancel_cutoff_hours;
        }
        if (
          args.no_show_fee_policy === "forfeit" ||
          args.no_show_fee_policy === "none"
        ) {
          patch.no_show_fee_policy = args.no_show_fee_policy;
        }
        if (Object.keys(patch).length === 2) {
          throw new ToolError("INVALID_ARGS", "Nothing to update");
        }
        const { data, error } = await client
          .from("venue_reservation_settings")
          .upsert(patch, { onConflict: "venue_id" })
          .select(
            "brand_id, venue_id, reservations_enabled, fee_enabled, fee_amount_cents, fee_currency, cancel_cutoff_hours, no_show_fee_policy, updated_at",
          )
          .single();
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return data;
      }
      case "list_blackouts": {
        const { data, error } = await client
          .from("venue_blackouts")
          .select(
            "id, date_start, date_end, reason, applies_to, zone, table_id, created_at",
          )
          .eq("brand_id", brandId)
          .order("date_start", { ascending: true })
          .limit(200);
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return data ?? [];
      }
      case "upsert_blackout": {
        if (!isString(args.date_start) || !isString(args.date_end)) {
          throw new ToolError(
            "INVALID_ARGS",
            "date_start and date_end are required",
          );
        }
        const row: Record<string, unknown> = {
          brand_id: brandId,
          date_start: args.date_start,
          date_end: args.date_end,
          reason: isString(args.reason) ? args.reason : null,
          applies_to: typeof args.applies_to === "string"
            ? args.applies_to
            : "all",
          zone: typeof args.zone === "string" ? args.zone : null,
          table_id: isUuid(args.table_id) ? args.table_id : null,
        };
        if (isUuid(args.blackout_id)) {
          const { data, error } = await client
            .from("venue_blackouts")
            .update(row)
            .eq("id", args.blackout_id)
            .eq("brand_id", brandId)
            .select("id, date_start, date_end, applies_to, zone, table_id")
            .maybeSingle();
          if (error) throw new ToolError("RPC_FAILED", error.message);
          if (!data) {
            throw new ToolError(
              "BRAND_ACCESS_DENIED",
              "That blackout is unavailable",
            );
          }
          return data;
        }
        const { data, error } = await client
          .from("venue_blackouts")
          .insert(row)
          .select("id, date_start, date_end, applies_to, zone, table_id")
          .single();
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return data;
      }
      case "delete_blackout": {
        if (!isUuid(args.blackout_id)) {
          throw new ToolError("INVALID_ARGS", "blackout_id must be a uuid");
        }
        const { error } = await client
          .from("venue_blackouts")
          .delete()
          .eq("id", args.blackout_id)
          .eq("brand_id", brandId);
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return { blackout_id: args.blackout_id, deleted: true };
      }
      default:
        throw new ToolError("INVALID_ARGS", `unknown action ${action}`);
    }
  },
);

// #1979 — venue menus, items, item availability/86, and modifier groups. All
// writes ride the manager-plus RLS on menus / menu_items / menu_modifier_groups /
// menu_modifiers under the caller JWT. price_cents is minor units (or null for
// "price on request"); currency is welded to the parent's ISO code server-side.
const manageVenueMenu = writeTool(
  "manage_venue_menu",
  "Venue menus, items, item availability/86, and modifier groups: list_menus | upsert_menu | " +
    "delete_menu | upsert_menu_item | delete_menu_item | set_item_availability | list_modifier_groups | " +
    "save_modifier_group | delete_modifier_group. Role-gated (event_manager+).",
  {
    brand_id: UUID,
    venue_id: UUID,
    action: {
      type: "string",
      enum: [
        "list_menus",
        "upsert_menu",
        "delete_menu",
        "upsert_menu_item",
        "delete_menu_item",
        "set_item_availability",
        "list_modifier_groups",
        "save_modifier_group",
        "delete_modifier_group",
      ],
    },
    menu_id: UUID,
    menu_item_id: UUID,
    modifier_group_id: UUID,
    name: { type: "string", minLength: 1, maxLength: 160 },
    description: { type: "string", maxLength: 600 },
    price_cents: { type: "integer", minimum: 0, maximum: 100000000 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    is_available: { type: "boolean" },
    sort_order: { type: "integer", minimum: 0 },
    selection_mode: { type: "string", enum: ["single", "multi"] },
    min_select: { type: "integer", minimum: 0, maximum: 20 },
    max_select: { type: "integer", minimum: 1, maximum: 20 },
    modifiers: {
      type: "array",
      maxItems: 50,
      items: { type: "object" },
    },
  },
  ["brand_id", "action"],
  async (args, client, userId) => {
    const brandId = await requireBrand(args, client, userId);
    const action = String(args.action);
    switch (action) {
      case "list_menus": {
        const { data, error } = await client
          .from("menus")
          .select("id, name, description, sort_order, is_active")
          .eq("brand_id", brandId)
          .order("sort_order", { ascending: true })
          .limit(200);
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return data ?? [];
      }
      case "upsert_menu": {
        if (!isString(args.name)) {
          throw new ToolError("INVALID_ARGS", "name is required");
        }
        const row: Record<string, unknown> = {
          brand_id: brandId,
          name: args.name,
          description: isString(args.description) ? args.description : null,
          sort_order: typeof args.sort_order === "number" ? args.sort_order : 0,
        };
        if (isUuid(args.menu_id)) {
          const { data, error } = await client
            .from("menus")
            .update(row)
            .eq("id", args.menu_id)
            .eq("brand_id", brandId)
            .select("id, name, sort_order, is_active")
            .maybeSingle();
          if (error) throw new ToolError("RPC_FAILED", error.message);
          if (!data) {
            throw new ToolError(
              "BRAND_ACCESS_DENIED",
              "That menu is unavailable",
            );
          }
          return data;
        }
        const { data, error } = await client
          .from("menus")
          .insert(row)
          .select("id, name, sort_order, is_active")
          .single();
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return data;
      }
      case "delete_menu": {
        if (!isUuid(args.menu_id)) {
          throw new ToolError("INVALID_ARGS", "menu_id must be a uuid");
        }
        const { error } = await client
          .from("menus")
          .delete()
          .eq("id", args.menu_id)
          .eq("brand_id", brandId);
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return { menu_id: args.menu_id, deleted: true };
      }
      case "upsert_menu_item": {
        if (!isString(args.name)) {
          throw new ToolError("INVALID_ARGS", "name is required");
        }
        const currency = isString(args.currency)
          ? args.currency.toUpperCase()
          : null;
        if (!isUuid(args.menu_item_id) && !isUuid(args.menu_id)) {
          throw new ToolError(
            "INVALID_ARGS",
            "menu_id is required to create a menu item",
          );
        }
        const patch: Record<string, unknown> = {
          brand_id: brandId,
          name: args.name,
          description: isString(args.description) ? args.description : null,
          price_cents: typeof args.price_cents === "number"
            ? args.price_cents
            : null,
        };
        if (typeof args.is_available === "boolean") {
          patch.is_available = args.is_available;
        }
        if (isUuid(args.menu_item_id)) {
          if (currency) patch.currency = currency;
          const { data, error } = await client
            .from("menu_items")
            .update(patch)
            .eq("id", args.menu_item_id)
            .eq("brand_id", brandId)
            .select("id, name, price_cents, currency, is_available")
            .maybeSingle();
          if (error) throw new ToolError("RPC_FAILED", error.message);
          if (!data) {
            throw new ToolError(
              "BRAND_ACCESS_DENIED",
              "That item is unavailable",
            );
          }
          return data;
        }
        // Weld the item's currency to its parent menu's brand default when the
        // caller did not pin one, so a public price never renders currency-less.
        patch.menu_id = args.menu_id;
        patch.currency = currency ??
          await resolveBrandCurrency(client, brandId);
        const { data, error } = await client
          .from("menu_items")
          .insert(patch)
          .select("id, name, price_cents, currency, is_available")
          .single();
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return data;
      }
      case "delete_menu_item": {
        if (!isUuid(args.menu_item_id)) {
          throw new ToolError("INVALID_ARGS", "menu_item_id must be a uuid");
        }
        const { error } = await client
          .from("menu_items")
          .delete()
          .eq("id", args.menu_item_id)
          .eq("brand_id", brandId);
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return { menu_item_id: args.menu_item_id, deleted: true };
      }
      case "set_item_availability": {
        if (!isUuid(args.menu_item_id)) {
          throw new ToolError("INVALID_ARGS", "menu_item_id must be a uuid");
        }
        if (typeof args.is_available !== "boolean") {
          throw new ToolError("INVALID_ARGS", "is_available must be a boolean");
        }
        const { data, error } = await client
          .from("menu_items")
          .update({ is_available: args.is_available })
          .eq("id", args.menu_item_id)
          .eq("brand_id", brandId)
          .select("id, is_available")
          .maybeSingle();
        if (error) throw new ToolError("RPC_FAILED", error.message);
        if (!data) {
          throw new ToolError(
            "BRAND_ACCESS_DENIED",
            "That item is unavailable",
          );
        }
        return data;
      }
      case "list_modifier_groups": {
        if (!isUuid(args.menu_item_id)) {
          throw new ToolError("INVALID_ARGS", "menu_item_id must be a uuid");
        }
        const { data, error } = await client
          .from("menu_modifier_groups")
          .select(
            "id, name, selection_mode, min_select, max_select, is_active, sort_order",
          )
          .eq("brand_id", brandId)
          .eq("menu_item_id", args.menu_item_id)
          .order("sort_order", { ascending: true });
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return data ?? [];
      }
      case "save_modifier_group": {
        if (!isUuid(args.menu_item_id)) {
          throw new ToolError("INVALID_ARGS", "menu_item_id must be a uuid");
        }
        if (!isString(args.name)) {
          throw new ToolError("INVALID_ARGS", "name is required");
        }
        const selectionMode = args.selection_mode === "multi"
          ? "multi"
          : "single";
        const groupRow: Record<string, unknown> = {
          brand_id: brandId,
          menu_item_id: args.menu_item_id,
          name: args.name,
          selection_mode: selectionMode,
          min_select: typeof args.min_select === "number" ? args.min_select : 0,
          max_select: typeof args.max_select === "number"
            ? args.max_select
            : null,
          sort_order: typeof args.sort_order === "number" ? args.sort_order : 0,
        };
        let groupId: string;
        if (isUuid(args.modifier_group_id)) {
          const { data, error } = await client
            .from("menu_modifier_groups")
            .update(groupRow)
            .eq("id", args.modifier_group_id)
            .eq("brand_id", brandId)
            .select("id")
            .maybeSingle();
          if (error) throw new ToolError("RPC_FAILED", error.message);
          if (!data) {
            throw new ToolError(
              "BRAND_ACCESS_DENIED",
              "That modifier group is unavailable",
            );
          }
          groupId = String(data.id);
        } else {
          const { data, error } = await client
            .from("menu_modifier_groups")
            .insert(groupRow)
            .select("id")
            .single();
          if (error) throw new ToolError("RPC_FAILED", error.message);
          groupId = String(data.id);
        }
        // Full replacement of the group's modifiers when a list is supplied, so
        // the confirmation card's removed/added preview matches the stored set.
        if (Array.isArray(args.modifiers)) {
          const { error: delErr } = await client
            .from("menu_modifiers")
            .delete()
            .eq("group_id", groupId)
            .eq("brand_id", brandId);
          if (delErr) throw new ToolError("RPC_FAILED", delErr.message);
          const currency = await resolveBrandCurrency(client, brandId);
          const rows = (args.modifiers as Array<Record<string, unknown>>).map(
            (mod, index) => ({
              group_id: groupId,
              brand_id: brandId,
              name: typeof mod.name === "string" ? mod.name : "",
              price_delta_cents: Number.isInteger(mod.price_delta_cents)
                ? Number(mod.price_delta_cents)
                : 0,
              currency,
              sort_order: Number.isInteger(mod.sort_order)
                ? Number(mod.sort_order)
                : index,
            }),
          );
          if (rows.length > 0) {
            const { error: insErr } = await client
              .from("menu_modifiers")
              .insert(rows);
            if (insErr) throw new ToolError("RPC_FAILED", insErr.message);
          }
        }
        return {
          modifier_group_id: groupId,
          modifier_count: Array.isArray(args.modifiers)
            ? args.modifiers.length
            : null,
        };
      }
      case "delete_modifier_group": {
        if (!isUuid(args.modifier_group_id)) {
          throw new ToolError(
            "INVALID_ARGS",
            "modifier_group_id must be a uuid",
          );
        }
        const { error } = await client
          .from("menu_modifier_groups")
          .delete()
          .eq("id", args.modifier_group_id)
          .eq("brand_id", brandId);
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return { modifier_group_id: args.modifier_group_id, deleted: true };
      }
      default:
        throw new ToolError("INVALID_ARGS", `unknown action ${action}`);
    }
  },
);

/** Resolve the brand's default ISO currency for currency-welded menu writes. */
async function resolveBrandCurrency(
  client: any,
  brandId: string,
): Promise<string> {
  const { data } = await client
    .from("brands")
    .select("default_currency")
    .eq("id", brandId)
    .maybeSingle();
  const code = typeof data?.default_currency === "string"
    ? data.default_currency.toUpperCase()
    : "";
  // Do not manufacture a currency — #1974 forbids literal USD (and any ISO
  // fallback) in domain tools; the brand row must already carry a real code.
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ToolError(
      "INVALID_ARGS",
      "brand has no default_currency; pass currency explicitly",
    );
  }
  return code;
}

/** Redact a stored guest name to a safe label (never phone/email to the model). */
function safeGuestLabel(name: unknown): string {
  if (typeof name !== "string" || name.trim().length === 0) return "Guest";
  const parts = name.trim().split(/\s+/);
  const first = parts[0];
  const initial = parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : "";
  return `${first}${initial}`;
}

// #1979 — venue waitlist read/add/lost/convert. list returns a SAFE guest label
// only (phone/email are never returned to the model). Notification is NOT here:
// a "text the guest" request resolves to send_venue_sms.send_table_ready. Convert
// reuses the row-locked atomic RPC. Role-gated (event_manager+).
const manageVenueWaitlist = writeTool(
  "manage_venue_waitlist",
  "Venue waitlist: list_waitlist | add_waitlist_entry | mark_waitlist_lost | convert_waitlist_to_reservation. " +
    "Guest contact is masked in reads; to notify a guest use send_venue_sms. Role-gated (event_manager+).",
  {
    brand_id: UUID,
    venue_id: UUID,
    action: {
      type: "string",
      enum: [
        "list_waitlist",
        "add_waitlist_entry",
        "mark_waitlist_lost",
        "convert_waitlist_to_reservation",
      ],
    },
    waitlist_id: UUID,
    guest_name: { type: "string", minLength: 1, maxLength: 120 },
    guest_phone_e164: { type: "string", minLength: 2, maxLength: 20 },
    party_size: { type: "integer", minimum: 1, maximum: 100 },
    preferred_zone: {
      type: "string",
      enum: ["indoor", "outdoor", "private_room", "bar", "patio"],
    },
    quoted_wait_minutes: { type: "integer", minimum: 0 },
    reserved_for: { type: "string", format: "date-time" },
    table_id: UUID,
  },
  ["brand_id", "action"],
  async (args, client, userId) => {
    const brandId = await requireBrand(args, client, userId);
    const action = String(args.action);
    switch (action) {
      case "list_waitlist": {
        const { data, error } = await client
          .from("venue_waitlist")
          .select(
            "id, guest_name, party_size, preferred_zone, quoted_wait_minutes, status, created_at, notified_at, expires_at",
          )
          .eq("brand_id", brandId)
          .in("status", ["waiting", "notified"])
          .order("created_at", { ascending: true })
          .limit(200);
        if (error) throw new ToolError("RPC_FAILED", error.message);
        return ((data ?? []) as Array<Record<string, unknown>>).map((
          row,
          index,
        ) => ({
          id: row.id,
          position: index + 1,
          guest_label: safeGuestLabel(row.guest_name),
          party_size: row.party_size,
          preferred_zone: row.preferred_zone,
          quoted_wait_minutes: row.quoted_wait_minutes,
          status: row.status,
          created_at: row.created_at,
          notified_at: row.notified_at,
          expires_at: row.expires_at,
        }));
      }
      case "add_waitlist_entry": {
        if (typeof args.party_size !== "number") {
          throw new ToolError("INVALID_ARGS", "party_size is required");
        }
        const row: Record<string, unknown> = {
          brand_id: brandId,
          party_size: args.party_size,
          guest_name: isString(args.guest_name) ? args.guest_name : null,
          guest_phone_e164: isString(args.guest_phone_e164)
            ? args.guest_phone_e164
            : null,
          preferred_zone: typeof args.preferred_zone === "string"
            ? args.preferred_zone
            : null,
          quoted_wait_minutes: typeof args.quoted_wait_minutes === "number"
            ? args.quoted_wait_minutes
            : null,
        };
        const { data, error } = await client
          .from("venue_waitlist")
          .insert(row)
          .select("id, party_size, preferred_zone, status")
          .single();
        if (error) throw new ToolError("RPC_FAILED", error.message);
        // Never echo stored contact back into the model-visible result.
        return {
          id: data.id,
          guest_label: safeGuestLabel(args.guest_name),
          party_size: data.party_size,
          preferred_zone: data.preferred_zone,
          status: data.status,
        };
      }
      case "mark_waitlist_lost": {
        if (!isUuid(args.waitlist_id)) {
          throw new ToolError("INVALID_ARGS", "waitlist_id must be a uuid");
        }
        const { data, error } = await client
          .from("venue_waitlist")
          .update({ status: "lost" })
          .eq("id", args.waitlist_id)
          .eq("brand_id", brandId)
          .in("status", ["waiting", "notified"])
          .select("id, status")
          .maybeSingle();
        if (error) throw new ToolError("RPC_FAILED", error.message);
        if (!data) {
          throw new ToolError(
            "INVALID_ARGS",
            "Only an active (waiting/notified) entry can be marked lost",
          );
        }
        return data;
      }
      case "convert_waitlist_to_reservation": {
        if (!isUuid(args.waitlist_id)) {
          throw new ToolError("INVALID_ARGS", "waitlist_id must be a uuid");
        }
        if (!isString(args.reserved_for)) {
          throw new ToolError("INVALID_ARGS", "reserved_for is required");
        }
        const res = await callRpc<Record<string, unknown>>(
          client,
          "biz_waitlist_convert_to_reservation",
          {
            p_waitlist_id: args.waitlist_id,
            p_reserved_for: args.reserved_for,
            p_table_id: isUuid(args.table_id) ? args.table_id : null,
          },
        );
        // Return a redacted reservation reference — no guest contact.
        return {
          reservation_id: (res as { id?: string })?.id ?? null,
          status: (res as { status?: string })?.status ?? null,
          reserved_for: (res as { reserved_for?: string })?.reserved_for ??
            null,
        };
      }
      default:
        throw new ToolError("INVALID_ARGS", `unknown action ${action}`);
    }
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
    // #1980 — EXACT composer "Send now" contract. `marketing-send` self-detects
    // the direct path from `campaign_id` + a non-service-role JWT and verifies
    // ownership; it reads NO `sendNow` flag (the pre-repair extra key was dead).
    // Idempotency is owned inside the function per-recipient
    // (marketing_messages upsert on (campaign_id, recipient_*)), so no
    // Idempotency-Key header is sent — matching sendNow() in
    // mingla-business/src/services/marketing/marketingCampaignService.ts.
    return await invokeFn(client, "marketing-send", {
      campaign_id: args.campaign_id,
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

// #1743 / #1980 — the four intelligence engines are FOUR separate app-lane edge
// functions, not one. `tool_key` selects the engine; the body is the exact
// app-lane contract from runGrowthTool() in
// mingla-business/src/services/growthToolsService.ts: {action:"run",
// lane:"app", brand_id, input}. The pre-repair tool sent {brand_id, tool_key}
// to growth-tools-run only — no action, no lane, wrong function for 3 of 4
// tools — so the WEB-lane validation rejected every call.
const GROWTH_TOOL_FUNCTION: Readonly<Record<string, string>> = Object.freeze({
  site_check: "growth-tools-run",
  turnout_forecast: "growth-tools-events",
  trip_quote: "growth-tools-trips",
  pricing_audit: "growth-tools-pricing",
});

const runGrowthTool = writeTool(
  "run_growth_tool",
  "Run one of the four Growth Tools (site_check, turnout_forecast, trip_quote, pricing_audit) via its app-lane engine. `input` is the tool's intake object. Read the report afterwards with get_brand_analytics.",
  {
    brand_id: UUID,
    tool_key: {
      type: "string",
      enum: ["site_check", "turnout_forecast", "trip_quote", "pricing_audit"],
    },
    input: { type: "object" },
  },
  // #2593 — `input` IS the intake object the engine runs on, and the
  // description has always said so. It was optional, and the executor
  // substituted `{}` for a missing one, so a model that forgot the intake
  // silently ran the engine on nothing instead of being told to ask for it.
  ["brand_id", "tool_key", "input"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    const fn = GROWTH_TOOL_FUNCTION[String(args.tool_key)];
    if (fn === undefined) {
      throw new ToolError(
        "INVALID_ARGS",
        "tool_key must be one of site_check, turnout_forecast, trip_quote, pricing_audit",
      );
    }
    const input = args.input;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new ToolError(
        "INVALID_ARGS",
        "input is required and must be the Growth Tool's intake object.",
      );
    }
    return await invokeFn(client, fn, {
      action: "run",
      lane: "app",
      brand_id: args.brand_id,
      input: input as Record<string, unknown>,
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
    // #1982 — canonical readiness gate. Ari NEVER completes hosted KYC in chat
    // — it only reads the gate and hands the owner off to the native Payouts
    // flow.
    //
    // #2593 — the bare-boolean read is CORRECT and is now pinned. Production
    // carries exactly ONE overload, `pg_brand_can_collect(uuid) RETURNS
    // boolean` (created 20261220000000, replaced in place by 20270129001384),
    // whose body is `(pg_brand_can_charge(..) OR EXISTS(..)) AND NOT EXISTS(..)`
    // — every leg is an EXISTS, so it can never evaluate to SQL NULL and
    // PostgREST can never surface an object. Sibling readers still carry an
    // `{ can_collect: true }` fallback for a shape this RPC cannot return; that
    // tolerance is dead code, not a contract, so it is not reintroduced here.
    //
    // What IS restored is loudness: a non-boolean must never be folded into a
    // silent `can_collect: false`, because that answer tells an already-onboarded
    // owner to go redo KYC. Contract violation fails closed and says so.
    const can = await callRpc<unknown>(client, "pg_brand_can_collect", {
      p_brand_id: args.brand_id,
    });
    if (typeof can !== "boolean") {
      throw new ToolError(
        "RPC_FAILED",
        "Payout readiness is unavailable right now. Open Brand → Payouts to check directly.",
      );
    }
    const canCollect = can;
    return {
      brand_id: args.brand_id,
      can_collect: canCollect,
      guide: canCollect
        ? "Payouts are enabled — this brand can collect money."
        : "Open Brand → Payouts to finish Stripe or Paystack KYC. Ari cannot complete hosted KYC in chat.",
    };
  },
);

// #1976 — canonical partner-split status. The link lives in
// `partner_brand_links` (ORCH-1081/-1384), NOT the non-existent `brand_partners`
// table the pre-repair tool queried (every call threw
// "relation brand_partners does not exist"). Status is derived from the raw
// timestamp columns, mirroring `deriveLinkStatus` in
// mingla-business/src/services/partnerBrandLinksService.ts — the SAME four-value
// union the Team screen renders. The owner-side RLS policy
// (`partner_brand_links_owner_select`) admits the brand owner's read.
function derivePartnerLinkStatus(row: {
  cancelled_at: string | null;
  first_split_at: string | null;
  owner_stripe_connected_at: string | null;
  accepted_at: string | null;
}): "awaiting_owner" | "awaiting_stripe" | "active" | "cancelled" {
  if (row.cancelled_at !== null) return "cancelled";
  if (row.first_split_at !== null) return "active";
  if (row.owner_stripe_connected_at !== null) return "active";
  if (row.accepted_at !== null) return "awaiting_stripe";
  return "awaiting_owner";
}

const getPartnerStatus = writeTool(
  "get_partner_status",
  "Read partner-split link status for a brand (partner_brand_links). Never exposes the partner's account id.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    await requireBrand(args, client, userId);
    const { data, error } = await client
      .from("partner_brand_links")
      .select(
        "id, invited_owner_email, invited_at, accepted_at, owner_stripe_connected_at, first_split_at, cancelled_at, cancelled_reason",
      )
      .eq("brand_id", args.brand_id)
      .order("invited_at", { ascending: false })
      .limit(20);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    // PII minimization: return the derived status + the invited email/reason
    // only. The partner's account id is never surfaced to the model.
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      invited_owner_email: row.invited_owner_email,
      status: derivePartnerLinkStatus(
        row as unknown as Parameters<typeof derivePartnerLinkStatus>[0],
      ),
      cancelled_reason: row.cancelled_reason ?? null,
    }));
  },
);

// #2593 — classify partner_disconnect_link failures on STRUCTURED fields, not
// on prose. Every failure the RPC raises (migration 20270102000000) is
// `RAISE EXCEPTION '<sentinel>' USING ERRCODE = 'P0001'`, and PostgREST surfaces
// that as a PLAIN OBJECT `{ code, message, details, hint }` — never an `Error`
// instance, so nothing below uses `instanceof`. Two things changed:
//   1. the SQLSTATE must be the RPC's own `P0001`, so an infrastructure or RLS
//      failure can no longer be dressed up as a clean user-facing refusal; and
//   2. the sentinel is matched as a WHOLE TOKEN across the structured fields
//      rather than by substring, so `guest_roster_forbidden` (or any future
//      `<sentinel>_v2`) can never be read as this RPC's answer.
// Message text stays the transport for the sentinel because that is what
// PostgREST does with `RAISE EXCEPTION`, but it is no longer the classifier.
const PARTNER_DISCONNECT_SENTINELS: ReadonlyArray<
  readonly [string, string, string]
> = Object.freeze([
  [
    "forbidden",
    "BRAND_ACCESS_DENIED",
    "You do not have permission to disconnect this partner.",
  ],
  ["link_not_found", "INVALID_ARGS", "That partner link no longer exists."],
  [
    "link_not_active",
    "INVALID_ARGS",
    "Only an active partner link can be disconnected.",
  ],
]);

export function classifyPartnerDisconnectError(error: unknown): ToolError {
  const row = (error ?? {}) as Record<string, unknown>;
  const message = typeof row.message === "string" ? row.message : "";
  if (row.code === "P0001") {
    const fields = [row.message, row.details, row.hint].filter(
      (value): value is string => typeof value === "string",
    );
    for (const [sentinel, code, copy] of PARTNER_DISCONNECT_SENTINELS) {
      const token = new RegExp(`(^|[^a-z0-9_])${sentinel}([^a-z0-9_]|$)`);
      if (fields.some((value) => token.test(value))) {
        return new ToolError(code, copy);
      }
    }
  }
  return new ToolError(
    "RPC_FAILED",
    message || "partner_disconnect_link failed",
  );
}

const disconnectPartner = writeTool(
  "disconnect_partner",
  "Disconnect an active partner split via partner_disconnect_link. Destructive confirm.",
  { brand_id: UUID, partner_id: UUID },
  ["brand_id", "partner_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.partner_id)) {
      throw new ToolError("INVALID_ARGS", "partner_id must be a uuid");
    }
    // #1976 — the canonical dual-stamp verb (link cancelled_at + partner team
    // removed_at in ONE transaction, I-PROPOSED-1384-DISCONNECT-STAMPS-BOTH).
    // partner_id is the partner_brand_links row id, already bound to this brand
    // by the authorization seam. Never a direct table UPDATE.
    const { error } = await client.rpc("partner_disconnect_link", {
      p_link_id: args.partner_id,
    });
    if (error) throw classifyPartnerDisconnectError(error);
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

// #1976 — balances + payout ledger read. Same edge as Host
// (`brand-stripe-balances`) plus the same `brand_payout_releases` table Host
// reads in brandPayoutLedgerService. CSV export remains a guided handoff.
const getBrandBalancesReports = writeTool(
  "get_brand_balances_reports",
  "Read Stripe available/pending balances and recent payout-release ledger rows for a brand. Finance-gated. CSV export stays in Brand → Payments → Reports.",
  { brand_id: UUID, limit: { type: "integer", minimum: 1, maximum: 50 } },
  ["brand_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    await requireBrand(args, client, userId);
    const balances = await invokeFn<Record<string, unknown>>(
      client,
      "brand-stripe-balances",
      { brand_id: args.brand_id },
    );
    const limit = typeof args.limit === "number" && args.limit >= 1
      ? Math.min(50, Math.floor(args.limit))
      : 20;
    const { data, error } = await client
      .from("brand_payout_releases")
      .select(
        "id, event_id, provider, currency, status, releasable_at, released_at, gross_cents, refunded_cents, net_release_cents, organiser_cash_delivered_cents",
      )
      .eq("brand_id", args.brand_id)
      .order("releasable_at", { ascending: false })
      .limit(limit);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return {
      brand_id: args.brand_id,
      balances: {
        currency: (balances.currency as string | undefined) ?? null,
        available_minor: (balances.available_minor as number | undefined) ??
          (balances.availableMinor as number | undefined) ?? null,
        pending_minor: (balances.pending_minor as number | undefined) ??
          (balances.pendingMinor as number | undefined) ?? null,
        retrieved_at: (balances.retrieved_at as string | undefined) ??
          (balances.retrievedAt as string | undefined) ?? null,
      },
      payout_releases: data ?? [],
      guide:
        "CSV exports (Stripe payouts / tax / all transactions) open in Brand → Payments → Reports.",
    };
  },
);

// #1976 — partner-side brand-link list (partnerBrandLinksService.listPartnerBrandLinks).
// RLS binds partner_account_id = auth.uid(); never surface the partner account id.
const listPartnerBrandLinks = writeTool(
  "list_partner_brand_links",
  "List the caller's partner-brand links (partner_brand_links). Optional include_cancelled. Never exposes partner_account_id.",
  {
    include_cancelled: { type: "boolean" },
  },
  [],
  async (args, client, userId) => {
    let query = client
      .from("partner_brand_links")
      .select(
        "id, brand_id, invited_owner_email, invited_at, accepted_at, owner_stripe_connected_at, first_split_at, cancelled_at, cancelled_reason, brand:brands(id, name, slug, default_currency)",
      )
      .eq("partner_account_id", userId)
      .order("invited_at", { ascending: false });
    if (args.include_cancelled !== true) {
      query = query.is("cancelled_at", null);
    }
    const { data, error } = await query;
    if (error) throw new ToolError("RPC_FAILED", error.message);
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      brand_id: row.brand_id,
      invited_owner_email: row.invited_owner_email,
      status: derivePartnerLinkStatus(
        row as unknown as Parameters<typeof derivePartnerLinkStatus>[0],
      ),
      cancelled_reason: row.cancelled_reason ?? null,
      brand: row.brand ?? null,
    }));
  },
);

// #1976 — partner split earnings read (partnerSplitsService.listPartnerSplits).
// RLS admits partner self-read and brand finance/admin. No mutations (webhook-only writes).
const listPartnerSplits = writeTool(
  "list_partner_splits",
  "List partner_splits earnings rows for the caller (status, share, currency). Optional brand/currency/date filters. Read-only.",
  {
    brand_id: UUID,
    currency: { type: "string", minLength: 3, maxLength: 3 },
    from: { type: "string", minLength: 10, maxLength: 40 },
    to: { type: "string", minLength: 10, maxLength: 40 },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  },
  [],
  async (args, client, _userId) => {
    if (args.brand_id !== undefined && !isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    const limit = typeof args.limit === "number" && args.limit >= 1
      ? Math.min(200, Math.floor(args.limit))
      : 50;
    let query = client
      .from("partner_splits")
      .select(
        "id, order_id, brand_id, mingla_fee_cents, partner_share_cents, transfer_currency, status, created_at, transferred_at, reversed_at, provider",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (isUuid(args.brand_id)) query = query.eq("brand_id", args.brand_id);
    if (typeof args.currency === "string" && args.currency.length === 3) {
      query = query.eq("transfer_currency", args.currency.toLowerCase());
    }
    if (typeof args.from === "string") query = query.gte("created_at", args.from);
    if (typeof args.to === "string") query = query.lte("created_at", args.to);
    const { data, error } = await query;
    if (error) throw new ToolError("RPC_FAILED", error.message);
    // PII minimization: never return partner_account_id even if selected.
    return data ?? [];
  },
);

// ----------------------------------------------------------------------------
// K. Refunds / cancels / installments
// ----------------------------------------------------------------------------

// #1981 — `refund-order` requires a NON-EMPTY `lines` array (each
// {order_line_item_id, quantity, amount_cents}) plus a 10–200 char `reason`,
// and an Idempotency-Key header. The pre-repair tool sent {order_id,
// amount_cents} — no lines, no reason — so the function 400'd
// `refund_lines_required` on every call. Ari supplies the lines it read back
// from the order; the RPC re-validates line ownership + over-refund.
const REFUND_LINE = {
  type: "object",
  additionalProperties: false,
  required: ["order_line_item_id", "quantity", "amount_cents"],
  properties: {
    order_line_item_id: UUID,
    quantity: { type: "integer", minimum: 1 },
    amount_cents: { type: "integer", minimum: 1 },
  },
};

const refundOrder = writeTool(
  "refund_order",
  "Refund specific order line items via refund-order. Finance-role gated. Requires the line items to refund and a reason. Idempotency-Key required.",
  {
    brand_id: UUID,
    order_id: UUID,
    lines: { type: "array", minItems: 1, items: REFUND_LINE },
    reason: { type: "string", minLength: 10, maxLength: 200 },
  },
  ["brand_id", "order_id", "lines", "reason"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.order_id)) {
      throw new ToolError("INVALID_ARGS", "order_id must be a uuid");
    }
    if (!Array.isArray(args.lines) || args.lines.length === 0) {
      throw new ToolError(
        "INVALID_ARGS",
        "At least one refund line is required.",
      );
    }
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (reason.length < 10 || reason.length > 200) {
      throw new ToolError(
        "INVALID_ARGS",
        "A refund reason of 10–200 characters is required.",
      );
    }
    return await invokeFn(
      client,
      "refund-order",
      { order_id: args.order_id, lines: args.lines, reason },
      { "Idempotency-Key": newIdempotencyKey() },
    );
  },
  "REFUND",
);

const cancelOrder = writeTool(
  "cancel_order",
  "Cancel a FREE order via cancel-order (paid orders must be refunded, not cancelled). Finance-role gated. Requires a reason. Idempotency-Key required.",
  {
    brand_id: UUID,
    order_id: UUID,
    reason: { type: "string", minLength: 10, maxLength: 200 },
  },
  ["brand_id", "order_id", "reason"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.order_id)) {
      throw new ToolError("INVALID_ARGS", "order_id must be a uuid");
    }
    // #1981 — cancel-order requires reason (10–200) + Idempotency-Key header.
    // The pre-repair tool sent {order_id} only, so the function 400'd
    // `reason_invalid_length` on every call.
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (reason.length < 10 || reason.length > 200) {
      throw new ToolError(
        "INVALID_ARGS",
        "A cancellation reason of 10–200 characters is required.",
      );
    }
    return await invokeFn(
      client,
      "cancel-order",
      { order_id: args.order_id, reason },
      { "Idempotency-Key": newIdempotencyKey() },
    );
  },
  "CANCEL",
);

const cancelTripBooking = writeTool(
  "cancel_trip_booking",
  "Cancel a trip booking (operator) via cancel-trip-booking. Previews the refund, then commits at that exact amount. Finance-role gated. Requires a reason.",
  {
    brand_id: UUID,
    booking_id: UUID,
    reason: { type: "string", minLength: 10, maxLength: 200 },
  },
  ["brand_id", "booking_id", "reason"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.booking_id)) {
      throw new ToolError("INVALID_ARGS", "booking_id must be a uuid");
    }
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (reason.length < 10 || reason.length > 200) {
      throw new ToolError(
        "INVALID_ARGS",
        "A cancellation reason of 10–200 characters is required.",
      );
    }
    // #1981 — cancel-trip-booking is a preview→commit engine (ORCH-0875 Tr4).
    // Commit MUST carry `expectedRefundTotalCents` (SC-22 freshness); the
    // pre-repair tool sent {booking_id} and 400'd `order_id_required`. We
    // preview under the caller JWT to pin the amount, then commit that exact
    // value in operator mode. Both take camelCase `orderId` (= booking_id).
    const preview = await invokeFn<{ refundTotalCents?: number }>(
      client,
      "cancel-trip-booking",
      { mode: "preview", orderId: args.booking_id },
    );
    // #2593 — FAIL CLOSED on the amount. This used to default a missing or
    // non-numeric `refundTotalCents` to `0` and commit anyway, which is the
    // exact opposite of the freshness contract two lines above: a preview that
    // could not price the cancellation would silently commit a ZERO refund and
    // the buyer would be owed money nobody moved. There is no safe default for
    // a money amount — if the preview did not price it, nothing is committed.
    const expectedRefundTotalCents = preview?.refundTotalCents;
    if (
      typeof expectedRefundTotalCents !== "number" ||
      !Number.isInteger(expectedRefundTotalCents) ||
      expectedRefundTotalCents < 0
    ) {
      throw new ToolError(
        "REFUND_PREVIEW_UNPRICED",
        "The cancellation preview did not return an exact refund amount, so nothing was cancelled. Try again in a moment.",
      );
    }
    return await invokeFn(
      client,
      "cancel-trip-booking",
      {
        mode: "operator",
        orderId: args.booking_id,
        reason,
        expectedRefundTotalCents,
      },
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

// #1981 — same Host edge as Trip Money → Charge now.
const chargeInstallmentNow = writeTool(
  "charge_installment_now",
  "Charge a due trip installment now via manual-charge-installment. Finance-gated. Type CHARGE to confirm.",
  {
    brand_id: UUID,
    installment_id: UUID,
    at_risk_override: { type: "boolean" },
  },
  ["brand_id", "installment_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.installment_id)) {
      throw new ToolError("INVALID_ARGS", "installment_id must be a uuid");
    }
    return await invokeFn(client, "manual-charge-installment", {
      installmentId: args.installment_id,
      atRiskOverride: args.at_risk_override === true,
    });
  },
  "CHARGE",
);

// #1981 — same Host edge as Trip Money → Send reminder.
const sendInstallmentReminder = writeTool(
  "send_installment_reminder",
  "Send a buyer trip-installment reminder via send-installment-reminder. Finance-gated.",
  { brand_id: UUID, order_id: UUID },
  ["brand_id", "order_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.order_id)) {
      throw new ToolError("INVALID_ARGS", "order_id must be a uuid");
    }
    return await invokeFn(client, "send-installment-reminder", {
      orderId: args.order_id,
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

// #1984 — event order reconciliation (Business getEventOrderRevenue parity,
// without buyer PII). Aggregates from the same orders + line items the orders
// screen reads under caller JWT / RLS.
const getEventOrderReconciliation = writeTool(
  "get_event_order_reconciliation",
  "Read sold count, gross, refunded, and net revenue for an event from orders. No buyer PII.",
  { event_id: UUID },
  ["event_id"],
  async (args, client, userId) => {
    if (!isUuid(args.event_id)) {
      throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
    }
    await assertAgentReadEvent(client, userId, args.event_id);
    await requireEvent(args, client, userId);
    const { data, error } = await client
      .from("orders")
      .select(
        `payment_status, total_cents, refunded_amount_cents, currency,
         order_line_items ( id, quantity ),
         refunds ( status, refund_line_items ( order_line_item_id, quantity ) )`,
      )
      .eq("event_id", args.event_id);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    let soldCount = 0;
    let revenueCents = 0;
    let refundedCents = 0;
    let currency: string | null = null;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const status = String(row.payment_status ?? "");
      // Mirror eventOrdersService.getEventOrderRevenue: paid + partial refund.
      if (status !== "paid" && status !== "partial_refund") continue;
      if (currency === null && typeof row.currency === "string") {
        currency = row.currency;
      }
      revenueCents += Number(row.total_cents ?? 0);
      refundedCents += Number(row.refunded_amount_cents ?? 0);
      const refundedQtyByLine: Record<string, number> = {};
      const refunds = Array.isArray(row.refunds)
        ? row.refunds as Array<Record<string, unknown>>
        : [];
      for (const refund of refunds) {
        if (refund.status !== "succeeded") continue;
        const rlis = Array.isArray(refund.refund_line_items)
          ? refund.refund_line_items as Array<Record<string, unknown>>
          : [];
        for (const rli of rlis) {
          const lineId = String(rli.order_line_item_id ?? "");
          if (!lineId) continue;
          refundedQtyByLine[lineId] = (refundedQtyByLine[lineId] ?? 0) +
            Number(rli.quantity ?? 0);
        }
      }
      const lines = Array.isArray(row.order_line_items)
        ? row.order_line_items as Array<Record<string, unknown>>
        : [];
      for (const line of lines) {
        const lineId = String(line.id ?? "");
        const qty = Number(line.quantity ?? 0);
        soldCount += Math.max(0, qty - (refundedQtyByLine[lineId] ?? 0));
      }
    }
    return {
      event_id: args.event_id,
      sold_count: soldCount,
      revenue_cents: revenueCents,
      refunded_cents: refundedCents,
      net_revenue_cents: revenueCents - refundedCents,
      currency,
    };
  },
);

// ----------------------------------------------------------------------------
// M. Team / scanners / Brand People
// ----------------------------------------------------------------------------

const inviteBrandMember = writeTool(
  "invite_brand_member",
  "Invite a brand team member via invite-brand-member. Requires the invitee's name (the invite email + accept flow reject an empty name).",
  {
    brand_id: UUID,
    email: STR,
    name: { type: "string", minLength: 1, maxLength: 100 },
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
  ["brand_id", "email", "name", "role"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    // #1983 — invite-brand-member validates invitee_name (1–100 chars) and
    // 400s `validation:["invitee_name"]` on empty. The pre-repair tool hard-
    // coded "" so every invite failed. Ari must collect the real name.
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (name.length < 1 || name.length > 100) {
      throw new ToolError("INVALID_ARGS", "The invitee's name is required.");
    }
    return await invokeFn(client, "invite-brand-member", {
      brand_id: args.brand_id,
      invitee_email: args.email,
      invitee_name: name,
      role: args.role,
    });
  },
);

const inviteScanner = writeTool(
  "invite_scanner",
  "Invite a scanner via the dedicated invite-scanner endpoint. Brand-scope grants scan access to every event; event-scope is limited to one event. Optionally grant at-door payment acceptance.",
  {
    brand_id: UUID,
    email: STR,
    name: { type: "string", minLength: 1, maxLength: 100 },
    scope: { type: "string", enum: ["brand", "event"] },
    event_id: UUID,
    can_accept_payments: { type: "boolean" },
  },
  ["brand_id", "email", "name", "scope"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    // #1983 — scanners have their OWN endpoint + table (scanner_invitations)
    // and permission model (canScan/canAcceptPayments). The pre-repair tool
    // POSTed invite-brand-member with role="scanner" — wrong table, no
    // scan/payment scopes. Route to invite-scanner with the exact contract.
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (name.length < 1 || name.length > 100) {
      throw new ToolError("INVALID_ARGS", "The scanner's name is required.");
    }
    const scope = args.scope === "event" ? "event" : "brand";
    if (scope === "event" && !isUuid(args.event_id)) {
      throw new ToolError(
        "INVALID_ARGS",
        "event_id is required (and must be a uuid) for an event-scoped scanner.",
      );
    }
    return await invokeFn(client, "invite-scanner", {
      brand_id: args.brand_id,
      event_id: scope === "event" ? args.event_id : null,
      scope,
      invitee_email: args.email,
      invitee_name: name,
      can_accept_payments: args.can_accept_payments === true,
    });
  },
);

const revokeBrandMember = writeTool(
  "revoke_brand_member",
  "Revoke a brand team member by soft-deleting their brand_team_members row (sets removed_at). Admin-gated by RLS.",
  { brand_id: UUID, member_id: UUID },
  ["brand_id", "member_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.member_id)) {
      throw new ToolError("INVALID_ARGS", "member_id must be a uuid");
    }
    // #1983 — membership lives in brand_team_members (soft-delete via
    // removed_at), NOT the non-existent brand_members table the pre-repair
    // tool hard-DELETEd. The brand_team_members UPDATE RLS policy already
    // gates this on biz_is_brand_admin_plus_for_caller, so a plain scoped
    // UPDATE is the safe verb — a hard DELETE would orphan audit history.
    const { data, error } = await client
      .from("brand_team_members")
      .update({ removed_at: new Date().toISOString() })
      .eq("id", args.member_id)
      .eq("brand_id", args.brand_id)
      .is("removed_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    if (data === null) {
      throw new ToolError(
        "INVALID_ARGS",
        "That team member was not found, is already removed, or you lack permission.",
      );
    }
    return { member_id: args.member_id, revoked: true };
  },
);

// #1982 — Team screen list (listBrandTeamMembers + listBrandInvitations).
// Role changes are invite-time only on Host; invite_brand_member already covers that.
const listBrandTeam = writeTool(
  "list_brand_team",
  "List active brand team members and pending brand invitations (roles included). Admin-gated by RLS.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    await requireBrand(args, client, userId);
    const [members, invitations] = await Promise.all([
      client
        .from("brand_team_members")
        .select("id, user_id, role, invited_at, accepted_at")
        .eq("brand_id", args.brand_id)
        .is("removed_at", null),
      client
        .from("brand_invitations")
        .select(
          "id, email, invitee_name, role, status, expires_at, accepted_at, revoked_at",
        )
        .eq("brand_id", args.brand_id)
        .order("expires_at", { ascending: false }),
    ]);
    if (members.error) throw new ToolError("RPC_FAILED", members.error.message);
    if (invitations.error) {
      throw new ToolError("RPC_FAILED", invitations.error.message);
    }
    return {
      brand_id: args.brand_id,
      members: members.data ?? [],
      invitations: invitations.data ?? [],
    };
  },
);

// #1982 — same Host verb as scannerInvitationsService.revokeScannerInvitation.
const revokeScannerInvitation = writeTool(
  "revoke_scanner_invitation",
  "Revoke a pending scanner invitation (scanner_invitations.status=revoked). Event-manager gated by RLS.",
  { brand_id: UUID, invitation_id: UUID },
  ["brand_id", "invitation_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.invitation_id)) {
      throw new ToolError("INVALID_ARGS", "invitation_id must be a uuid");
    }
    const { data, error } = await client
      .from("scanner_invitations")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", args.invitation_id)
      .eq("brand_id", args.brand_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    if (data === null) {
      throw new ToolError(
        "INVALID_ARGS",
        "That scanner invitation was not found, is not pending, or you lack permission.",
      );
    }
    return { invitation_id: args.invitation_id, revoked: true };
  },
);

// #1982 — Brand People book list/detail/add via the same RPCs Host uses.
const manageBrandPeople = writeTool(
  "manage_brand_people",
  "List, inspect, or manually add Brand People via biz_get_brand_people_book / biz_get_brand_person / biz_add_brand_person. Marketing-gated.",
  {
    brand_id: UUID,
    action: { type: "string", enum: ["list", "get", "add"] },
    person_id: UUID,
    search: { type: "string", maxLength: 200 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    display_name: { type: "string", minLength: 1, maxLength: 200 },
    email: { type: "string", maxLength: 320 },
    phone_e164: { type: "string", maxLength: 32 },
    phone_country_iso: { type: "string", minLength: 2, maxLength: 2 },
    client_request_id: UUID,
  },
  ["brand_id", "action"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    const action = String(args.action);
    if (action === "list") {
      await assertAgentReadBrand(client, userId, args.brand_id);
      const limit = typeof args.limit === "number" && args.limit >= 1
        ? Math.min(100, Math.floor(args.limit))
        : 25;
      return await callRpc(client, "biz_get_brand_people_book", {
        p_brand_id: args.brand_id,
        p_search: typeof args.search === "string" ? args.search : null,
        p_cursor: null,
        p_limit: limit,
      });
    }
    if (action === "get") {
      await assertAgentReadBrand(client, userId, args.brand_id);
      if (!isUuid(args.person_id)) {
        throw new ToolError("INVALID_ARGS", "person_id must be a uuid");
      }
      return await callRpc(client, "biz_get_brand_person", {
        p_brand_id: args.brand_id,
        p_person_id: args.person_id,
      });
    }
    if (action === "add") {
      const displayName = typeof args.display_name === "string"
        ? args.display_name.trim()
        : "";
      if (displayName.length < 1) {
        throw new ToolError("INVALID_ARGS", "display_name is required to add a person");
      }
      const clientRequestId = isUuid(args.client_request_id)
        ? args.client_request_id
        : newIdempotencyKey();
      return await callRpc(client, "biz_add_brand_person", {
        p_brand_id: args.brand_id,
        p_display_name: displayName,
        p_email: typeof args.email === "string" ? args.email : null,
        p_phone_e164: typeof args.phone_e164 === "string" ? args.phone_e164 : null,
        p_phone_country_iso: typeof args.phone_country_iso === "string"
          ? args.phone_country_iso
          : null,
        p_client_request_id: clientRequestId,
      });
    }
    throw new ToolError("INVALID_ARGS", "action must be list, get, or add");
  },
);

// ----------------------------------------------------------------------------
// #1972 reopen — event group chat, door sale, orders, waitlist, scanner admin
// ----------------------------------------------------------------------------

const manageEventGroupChat = writeTool(
  "manage_event_group_chat",
  "Read and moderate an event group chat (conversations/messages). Actions: get, list_messages, list_participants, post, set_broadcast_only, remove_participant, delete_message. Text posts only — media stays a guided handoff.",
  {
    brand_id: UUID,
    event_id: UUID,
    action: {
      type: "string",
      enum: [
        "get",
        "list_messages",
        "list_participants",
        "post",
        "set_broadcast_only",
        "remove_participant",
        "delete_message",
      ],
    },
    conversation_id: UUID,
    message_id: UUID,
    participant_user_id: UUID,
    content: { type: "string", minLength: 1, maxLength: 4000 },
    is_broadcast_only: { type: "boolean" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  ["brand_id", "event_id", "action"],
  async (args, client, userId) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    if (brandId !== args.brand_id) {
      throw new ToolError("INVALID_ARGS", "brand_id does not match the event");
    }
    const action = String(args.action);
    if (action === "get") {
      await assertAgentReadEvent(client, userId, eventId);
      const { data, error } = await client
        .from("conversations")
        .select("id, name, is_broadcast_only, is_enabled, events!event_id(title)")
        .eq("event_id", eventId)
        .in("linked_entity_type", ["trip", "event"])
        .maybeSingle();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (data === null) return { conversation: null };
      const eventName =
        (data as { events?: { title?: string | null } | null }).events?.title
          ?.trim() || data.name?.trim() || "Group chat";
      return {
        conversation: {
          id: data.id,
          name: data.name ?? "Group chat",
          event_name: eventName,
          is_broadcast_only: Boolean(data.is_broadcast_only),
          is_enabled: Boolean(data.is_enabled),
        },
      };
    }
    if (action === "list_messages") {
      await assertAgentReadEvent(client, userId, eventId);
      if (!isUuid(args.conversation_id)) {
        throw new ToolError("INVALID_ARGS", "conversation_id must be a uuid");
      }
      const limit = typeof args.limit === "number"
        ? Math.min(100, Math.max(1, Math.floor(args.limit)))
        : 80;
      const { data, error } = await client
        .from("messages")
        .select(
          "id, sender_id, content, created_at, message_type, file_url, file_name",
        )
        .eq("conversation_id", args.conversation_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { messages: data ?? [] };
    }
    if (action === "list_participants") {
      await assertAgentReadEvent(client, userId, eventId);
      if (!isUuid(args.conversation_id)) {
        throw new ToolError("INVALID_ARGS", "conversation_id must be a uuid");
      }
      const { data, error } = await client
        .from("conversation_participants")
        .select("user_id, joined_at")
        .eq("conversation_id", args.conversation_id)
        .order("joined_at", { ascending: true });
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return {
        participants: (data ?? []).map((row: { user_id: string; joined_at: string }) => ({
          user_id: row.user_id,
          joined_at: row.joined_at,
        })),
      };
    }
    if (action === "post") {
      if (!isUuid(args.conversation_id)) {
        throw new ToolError("INVALID_ARGS", "conversation_id must be a uuid");
      }
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (content.length < 1) {
        throw new ToolError("INVALID_ARGS", "content is required for a text post");
      }
      const { data, error } = await client
        .from("messages")
        .insert({
          conversation_id: args.conversation_id,
          sender_id: userId,
          content,
          message_type: "text",
        })
        .select("id")
        .single();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { message_id: data.id, posted: true };
    }
    if (action === "set_broadcast_only") {
      if (!isUuid(args.conversation_id)) {
        throw new ToolError("INVALID_ARGS", "conversation_id must be a uuid");
      }
      if (typeof args.is_broadcast_only !== "boolean") {
        throw new ToolError("INVALID_ARGS", "is_broadcast_only is required");
      }
      const { data, error } = await client
        .from("conversations")
        .update({
          is_broadcast_only: args.is_broadcast_only,
          updated_at: new Date().toISOString(),
        })
        .eq("id", args.conversation_id)
        .eq("event_id", eventId)
        .select("id");
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (!data || data.length === 0) {
        throw new ToolError(
          "INVALID_ARGS",
          "Not allowed to toggle broadcast-only on this conversation.",
        );
      }
      return { conversation_id: args.conversation_id, is_broadcast_only: args.is_broadcast_only };
    }
    if (action === "remove_participant") {
      if (!isUuid(args.conversation_id) || !isUuid(args.participant_user_id)) {
        throw new ToolError(
          "INVALID_ARGS",
          "conversation_id and participant_user_id must be uuids",
        );
      }
      const { data, error } = await client
        .from("conversation_participants")
        .delete()
        .eq("conversation_id", args.conversation_id)
        .eq("user_id", args.participant_user_id)
        .select("user_id");
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (!data || data.length === 0) {
        throw new ToolError(
          "INVALID_ARGS",
          "Not allowed to remove this participant or already removed.",
        );
      }
      return { removed_user_id: args.participant_user_id, removed: true };
    }
    if (action === "delete_message") {
      if (!isUuid(args.message_id)) {
        throw new ToolError("INVALID_ARGS", "message_id must be a uuid");
      }
      const { data, error } = await client
        .from("messages")
        .update({
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", args.message_id)
        .select("id");
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (!data || data.length === 0) {
        throw new ToolError(
          "INVALID_ARGS",
          "Not allowed to delete this message or already deleted.",
        );
      }
      return { message_id: args.message_id, deleted: true };
    }
    throw new ToolError("INVALID_ARGS", "Unsupported group-chat action");
  },
);

const manageEventDoorSale = writeTool(
  "manage_event_door_sale",
  "List or record in-person door sales on door_sales_ledger (cash/card_reader/nfc/manual). 'list' is a read; 'create' records a sale.",
  {
    brand_id: UUID,
    event_id: UUID,
    action: { type: "string", enum: ["list", "create"] },
    payment_method: {
      type: "string",
      enum: ["cash", "card_reader", "nfc", "manual"],
    },
    amount_cents: { type: "integer", minimum: 0, maximum: 10_000_000 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    notes: { type: "string", maxLength: 500 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  ["brand_id", "event_id", "action"],
  async (args, client, userId) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    if (brandId !== args.brand_id) {
      throw new ToolError("INVALID_ARGS", "brand_id does not match the event");
    }
    if (args.action === "list") {
      await assertAgentReadEvent(client, userId, eventId);
      const limit = typeof args.limit === "number"
        ? Math.min(100, Math.max(1, Math.floor(args.limit)))
        : 50;
      const { data, error } = await client
        .from("door_sales_ledger")
        .select(
          "id, event_id, payment_method, amount_cents, currency, reconciled, notes, created_at, scanner_user_id",
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { event_id: eventId, sales: data ?? [] };
    }
    if (args.action === "create") {
      const method = args.payment_method;
      if (
        method !== "cash" && method !== "card_reader" && method !== "nfc" &&
        method !== "manual"
      ) {
        throw new ToolError(
          "INVALID_ARGS",
          "payment_method must be cash, card_reader, nfc, or manual",
        );
      }
      if (
        typeof args.amount_cents !== "number" ||
        !Number.isInteger(args.amount_cents) ||
        args.amount_cents < 0
      ) {
        throw new ToolError("INVALID_ARGS", "amount_cents must be a non-negative integer");
      }
      const currency = typeof args.currency === "string"
        ? args.currency.trim().toUpperCase()
        : "GBP";
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new ToolError("INVALID_ARGS", "currency must be a 3-letter ISO code");
      }
      const { data, error } = await client
        .from("door_sales_ledger")
        .insert({
          event_id: eventId,
          scanner_user_id: userId,
          payment_method: method,
          amount_cents: args.amount_cents,
          currency,
          notes: typeof args.notes === "string" ? args.notes : null,
        })
        .select("id, payment_method, amount_cents, currency, created_at")
        .single();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { sale: data, recorded: true };
    }
    throw new ToolError("INVALID_ARGS", "action must be list or create");
  },
);

const listEventOrders = writeTool(
  "list_event_orders",
  "List event orders (id, status, totals, line counts) without buyer PII. Mirrors Host eventOrdersService.fetchEventOrders for operators.",
  {
    brand_id: UUID,
    event_id: UUID,
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  ["brand_id", "event_id"],
  async (args, client, userId) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    if (brandId !== args.brand_id) {
      throw new ToolError("INVALID_ARGS", "brand_id does not match the event");
    }
    await assertAgentReadEvent(client, userId, eventId);
    const limit = typeof args.limit === "number"
      ? Math.min(100, Math.max(1, Math.floor(args.limit)))
      : 50;
    const { data, error } = await client
      .from("orders")
      .select(
        "id, event_id, total_cents, currency, payment_method, payment_status, confirmed_at, created_at, cancelled_at, refunded_amount_cents, order_line_items(id, quantity, total_cents)",
      )
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new ToolError("RPC_FAILED", error.message);
    const orders = (data ?? []).map((row: Record<string, unknown>) => {
      const lines = Array.isArray(row.order_line_items) ? row.order_line_items : [];
      return {
        id: row.id,
        event_id: row.event_id,
        total_cents: row.total_cents,
        currency: row.currency,
        payment_method: row.payment_method,
        payment_status: row.payment_status,
        confirmed_at: row.confirmed_at,
        created_at: row.created_at,
        cancelled_at: row.cancelled_at,
        refunded_amount_cents: row.refunded_amount_cents ?? 0,
        line_count: lines.length,
        quantity_total: lines.reduce(
          (sum: number, line: { quantity?: number }) =>
            sum + (typeof line.quantity === "number" ? line.quantity : 0),
          0,
        ),
      };
    });
    return { event_id: eventId, orders };
  },
);

const manageEventWaitlist = writeTool(
  "manage_event_waitlist",
  "Read an event ticket waitlist (event_waitlist_get) or toggle waitlist_enabled on a ticket type. Recent entries omit raw contact when possible.",
  {
    brand_id: UUID,
    event_id: UUID,
    action: { type: "string", enum: ["list", "set_enabled"] },
    ticket_type_id: UUID,
    waitlist_enabled: { type: "boolean" },
  },
  ["brand_id", "event_id", "action"],
  async (args, client, userId) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    if (brandId !== args.brand_id) {
      throw new ToolError("INVALID_ARGS", "brand_id does not match the event");
    }
    if (args.action === "list") {
      await assertAgentReadEvent(client, userId, eventId);
      const rows = await callRpc(client, "event_waitlist_get", {
        p_event_id: eventId,
        p_recent_limit: 25,
      });
      const tickets = (Array.isArray(rows) ? rows : []).map(
        (row: Record<string, unknown>) => ({
          ticket_type_id: row.ticket_type_id,
          ticket_type_name: row.ticket_type_name,
          waitlist_enabled: row.waitlist_enabled,
          waiting_count: row.waiting_count,
          invited_count: row.invited_count,
          recent: Array.isArray(row.recent)
            ? row.recent.map((entry: Record<string, unknown>) => ({
              id: entry.id,
              qty_requested: entry.qty_requested,
              status: entry.status,
              created_at: entry.created_at,
              // Drop email/phone/name — roster-style PII minimization.
            }))
            : [],
        }),
      );
      return { event_id: eventId, tickets };
    }
    if (args.action === "set_enabled") {
      if (!isUuid(args.ticket_type_id)) {
        throw new ToolError("INVALID_ARGS", "ticket_type_id must be a uuid");
      }
      if (typeof args.waitlist_enabled !== "boolean") {
        throw new ToolError("INVALID_ARGS", "waitlist_enabled is required");
      }
      const { data, error } = await client
        .from("ticket_types")
        .update({ waitlist_enabled: args.waitlist_enabled })
        .eq("id", args.ticket_type_id)
        .eq("event_id", eventId)
        .is("deleted_at", null)
        .select("id, waitlist_enabled")
        .maybeSingle();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (data === null) {
        throw new ToolError(
          "INVALID_ARGS",
          "Ticket type not found for this event, or you lack permission.",
        );
      }
      return { ticket_type_id: data.id, waitlist_enabled: data.waitlist_enabled };
    }
    throw new ToolError("INVALID_ARGS", "action must be list or set_enabled");
  },
);

const manageEventScanners = writeTool(
  "manage_event_scanners",
  "List scanner invitations for an event, or revoke a pending invitation. Invite remains invite_scanner.",
  {
    brand_id: UUID,
    event_id: UUID,
    action: { type: "string", enum: ["list", "revoke"] },
    invitation_id: UUID,
  },
  ["brand_id", "event_id", "action"],
  async (args, client, userId) => {
    const { eventId, brandId } = await requireEvent(args, client, userId);
    if (brandId !== args.brand_id) {
      throw new ToolError("INVALID_ARGS", "brand_id does not match the event");
    }
    if (args.action === "list") {
      await assertAgentReadEvent(client, userId, eventId);
      const { data, error } = await client
        .from("scanner_invitations")
        .select(
          "id, brand_id, event_id, scope, email, invitee_name, permissions, status, expires_at, accepted_at, revoked_at, created_at",
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { event_id: eventId, invitations: data ?? [] };
    }
    if (args.action === "revoke") {
      if (!isUuid(args.invitation_id)) {
        throw new ToolError("INVALID_ARGS", "invitation_id must be a uuid");
      }
      const { data, error } = await client
        .from("scanner_invitations")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", args.invitation_id)
        .eq("brand_id", brandId)
        .eq("event_id", eventId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (data === null) {
        throw new ToolError(
          "INVALID_ARGS",
          "That scanner invitation was not found, is not pending, or you lack permission.",
        );
      }
      return { invitation_id: args.invitation_id, revoked: true };
    }
    throw new ToolError("INVALID_ARGS", "action must be list or revoke");
  },
);

// ----------------------------------------------------------------------------
// #1980 — marketing audiences, templates, campaign reports
// ----------------------------------------------------------------------------

const manageMarketingAudiences = writeTool(
  "manage_marketing_audiences",
  "List marketing audiences for the signed-in account, or ensure a brand/event buyers audience exists (same Host ensureBrandBuyersAudience / ensureEventBuyersAudience).",
  {
    brand_id: UUID,
    action: {
      type: "string",
      enum: ["list", "ensure_brand_buyers", "ensure_event_buyers"],
    },
    event_id: UUID,
  },
  ["action"],
  async (args, client, userId) => {
    const action = String(args.action);
    if (action === "list") {
      const { data, error } = await client
        .from("marketing_audiences")
        .select("id, brand_id, name, query_definition, is_system_generated, created_at")
        .eq("account_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { audiences: data ?? [] };
    }
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    await requireBrand(args, client, userId);
    if (action === "ensure_brand_buyers") {
      const { data: existing, error: selErr } = await client
        .from("marketing_audiences")
        .select("id, query_definition")
        .eq("brand_id", args.brand_id)
        .eq("is_system_generated", true);
      if (selErr) throw new ToolError("RPC_FAILED", selErr.message);
      for (const row of existing ?? []) {
        const qd = (row as { query_definition?: { kind?: string; brand_id?: string } })
          .query_definition;
        if (qd?.kind === "brand_buyers" && qd.brand_id === args.brand_id) {
          return { audience_id: row.id, ensured: false };
        }
      }
      const { data: inserted, error: insErr } = await client
        .from("marketing_audiences")
        .insert({
          account_id: userId,
          brand_id: args.brand_id,
          name: "All brand buyers",
          query_definition: {
            kind: "brand_buyers",
            brand_id: args.brand_id,
            payment_statuses: ["paid", "partial_refund"],
          },
          is_system_generated: true,
        })
        .select("id")
        .maybeSingle();
      if (insErr) throw new ToolError("RPC_FAILED", insErr.message);
      if (inserted === null) {
        throw new ToolError("RPC_FAILED", "Audience insert returned no row");
      }
      return { audience_id: inserted.id, ensured: true };
    }
    if (action === "ensure_event_buyers") {
      if (!isUuid(args.event_id)) {
        throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
      }
      const { data: existing, error: selErr } = await client
        .from("marketing_audiences")
        .select("id, query_definition")
        .eq("brand_id", args.brand_id)
        .eq("is_system_generated", true);
      if (selErr) throw new ToolError("RPC_FAILED", selErr.message);
      for (const row of existing ?? []) {
        const qd = (row as { query_definition?: { kind?: string; event_id?: string } })
          .query_definition;
        if (qd?.kind === "event_buyers" && qd.event_id === args.event_id) {
          return { audience_id: row.id, ensured: false };
        }
      }
      const { data: inserted, error: insErr } = await client
        .from("marketing_audiences")
        .insert({
          account_id: userId,
          brand_id: args.brand_id,
          name: "Event buyers",
          query_definition: {
            kind: "event_buyers",
            event_id: args.event_id,
            payment_statuses: ["paid", "partial_refund"],
          },
          is_system_generated: true,
        })
        .select("id")
        .maybeSingle();
      if (insErr) throw new ToolError("RPC_FAILED", insErr.message);
      if (inserted === null) {
        throw new ToolError("RPC_FAILED", "Audience insert returned no row");
      }
      return { audience_id: inserted.id, ensured: true };
    }
    throw new ToolError("INVALID_ARGS", "Unsupported audience action");
  },
);

const manageMarketingTemplates = writeTool(
  "manage_marketing_templates",
  "List, create, update, or delete the caller's marketing email templates (not starter packs).",
  {
    brand_id: UUID,
    action: { type: "string", enum: ["list", "create", "update", "delete"] },
    template_id: UUID,
    name: { type: "string", minLength: 1, maxLength: 200 },
    subject_template: { type: "string", maxLength: 500 },
    body_template: { type: "string", minLength: 1, maxLength: 20000 },
  },
  ["action"],
  async (args, client, userId) => {
    const action = String(args.action);
    if (action === "list") {
      const { data, error } = await client
        .from("marketing_templates")
        .select(
          "id, account_id, brand_id, name, channel, subject_template, body_template, updated_at",
        )
        .eq("is_starter_pack", false)
        .eq("account_id", userId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { templates: data ?? [] };
    }
    if (action === "create") {
      const name = typeof args.name === "string" ? args.name.trim() : "";
      const body = typeof args.body_template === "string" ? args.body_template : "";
      if (name.length < 1 || body.length < 1) {
        throw new ToolError("INVALID_ARGS", "name and body_template are required");
      }
      if (args.brand_id !== undefined && args.brand_id !== null) {
        await requireBrand(args, client, userId);
      }
      const { data, error } = await client
        .from("marketing_templates")
        .insert({
          account_id: userId,
          brand_id: isUuid(args.brand_id) ? args.brand_id : null,
          name,
          channel: "email",
          subject_template: typeof args.subject_template === "string"
            ? args.subject_template
            : null,
          body_template: body,
          is_starter_pack: false,
        })
        .select(
          "id, account_id, brand_id, name, channel, subject_template, body_template, updated_at",
        )
        .maybeSingle();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (data === null) {
        throw new ToolError("RPC_FAILED", "Template insert returned no row");
      }
      return { template: data, created: true };
    }
    if (action === "update") {
      if (!isUuid(args.template_id)) {
        throw new ToolError("INVALID_ARGS", "template_id must be a uuid");
      }
      const name = typeof args.name === "string" ? args.name.trim() : "";
      const body = typeof args.body_template === "string" ? args.body_template : "";
      if (name.length < 1 || body.length < 1) {
        throw new ToolError("INVALID_ARGS", "name and body_template are required");
      }
      const { data, error } = await client
        .from("marketing_templates")
        .update({
          name,
          subject_template: typeof args.subject_template === "string"
            ? args.subject_template
            : null,
          body_template: body,
          ...(args.brand_id !== undefined
            ? { brand_id: isUuid(args.brand_id) ? args.brand_id : null }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", args.template_id)
        .eq("account_id", userId)
        .eq("is_starter_pack", false)
        .select(
          "id, account_id, brand_id, name, channel, subject_template, body_template, updated_at",
        )
        .maybeSingle();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (data === null) {
        throw new ToolError(
          "INVALID_ARGS",
          "Template not found, is a starter pack, or you lack permission.",
        );
      }
      return { template: data, updated: true };
    }
    if (action === "delete") {
      if (!isUuid(args.template_id)) {
        throw new ToolError("INVALID_ARGS", "template_id must be a uuid");
      }
      const { data, error } = await client
        .from("marketing_templates")
        .delete()
        .eq("id", args.template_id)
        .eq("account_id", userId)
        .eq("is_starter_pack", false)
        .select("id");
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (!data || data.length === 0) {
        throw new ToolError(
          "INVALID_ARGS",
          "Template not found, is a starter pack, or you lack permission.",
        );
      }
      return { template_id: args.template_id, deleted: true };
    }
    throw new ToolError("INVALID_ARGS", "Unsupported template action");
  },
);

const getCampaignReport = writeTool(
  "get_campaign_report",
  "Read campaign delivery/engagement report (accepted/delivered/opened/clicked aggregates + top links). No recipient emails returned.",
  { brand_id: UUID, campaign_id: UUID },
  ["campaign_id"],
  async (args, client, userId) => {
    if (!isUuid(args.campaign_id)) {
      throw new ToolError("INVALID_ARGS", "campaign_id must be a uuid");
    }
    const { data: campaign, error: campaignErr } = await client
      .from("marketing_campaigns")
      .select(
        "id, brand_id, name, channel, status, scheduled_for, sent_at, recipient_count, created_at",
      )
      .eq("id", args.campaign_id)
      .maybeSingle();
    if (campaignErr) throw new ToolError("RPC_FAILED", campaignErr.message);
    if (campaign === null) {
      throw new ToolError("INVALID_ARGS", "Campaign not found or access denied.");
    }
    if (isUuid(args.brand_id) && args.brand_id !== campaign.brand_id) {
      throw new ToolError("INVALID_ARGS", "brand_id does not match the campaign");
    }
    if (isUuid(campaign.brand_id)) {
      await assertAgentReadBrand(client, userId, campaign.brand_id);
    }
    const { data: messages, error: messageErr } = await client
      .from("marketing_messages")
      .select("id, status, sent_at, click_count, delivered_at, opened_at")
      .eq("campaign_id", args.campaign_id)
      .limit(500);
    if (messageErr) throw new ToolError("RPC_FAILED", messageErr.message);
    const rows = messages ?? [];
    const acceptedStatuses = new Set([
      "sent",
      "delivered",
      "opened",
      "clicked",
      "unsubscribed",
    ]);
    const counts: Record<string, number> = {};
    for (const msg of rows) {
      const status = String((msg as { status?: string }).status ?? "");
      counts[status] = (counts[status] ?? 0) + 1;
    }
    const accepted = Object.entries(counts).reduce(
      (sum, [status, n]) => sum + (acceptedStatuses.has(status) ? n : 0),
      0,
    );
    const delivered = rows.filter((m) =>
      (m as { delivered_at?: string | null }).delivered_at != null
    ).length;
    const opened = rows.filter((m) =>
      (m as { opened_at?: string | null }).opened_at != null
    ).length;
    const clicked = rows.filter((m) =>
      ((m as { click_count?: number }).click_count ?? 0) > 0
    ).length;
    const { data: clicks, error: clickErr } = await client
      .from("marketing_clicks")
      .select("destination_url, clicked_at, message_id")
      .eq("campaign_id", args.campaign_id)
      .limit(2000);
    if (clickErr) throw new ToolError("RPC_FAILED", clickErr.message);
    const linkCounts = new Map<string, number>();
    let totalClicks = 0;
    const unique = new Set<string>();
    for (const click of clicks ?? []) {
      if ((click as { clicked_at?: string | null }).clicked_at == null) continue;
      totalClicks += 1;
      const url = String((click as { destination_url?: string }).destination_url ?? "");
      linkCounts.set(url, (linkCounts.get(url) ?? 0) + 1);
      const mid = (click as { message_id?: string | null }).message_id;
      if (typeof mid === "string") unique.add(mid);
    }
    const topLinks = Array.from(linkCounts.entries())
      .map(([destination_url, n]) => ({ destination_url, clicks: n }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 5);
    return {
      campaign,
      recipient_stats: {
        total: rows.length,
        accepted,
        delivered,
        opened,
        clicked,
        bounced: counts.bounced ?? 0,
        failed: counts.failed ?? 0,
        has_event_coverage: delivered > 0 || opened > 0 ||
          (counts.bounced ?? 0) > 0,
      },
      click_stats: {
        total_clicks: totalClicks,
        unique_clickers: unique.size,
        top_links: topLinks,
      },
    };
  },
);

// ----------------------------------------------------------------------------
// #1983 — profile avatar, Ari history, notifications inbox, support inbox
// ----------------------------------------------------------------------------

const editProfileAvatar = writeTool(
  "edit_profile_avatar",
  "Update the signed-in operator's display name and/or avatar_url on creator_accounts. Avatar URL must come from the proposal-card picker (never invented).",
  {
    display_name: { type: "string", minLength: 1, maxLength: 80 },
    avatar_url: { type: "string", maxLength: 2000 },
    clear_avatar: { type: "boolean" },
  },
  [],
  async (args, client, userId) => {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof args.display_name === "string") {
      const name = args.display_name.trim();
      if (name.length < 1) {
        throw new ToolError("INVALID_ARGS", "display_name can't be empty");
      }
      patch.display_name = name;
    }
    if (args.clear_avatar === true) {
      patch.avatar_url = null;
    } else if (typeof args.avatar_url === "string") {
      const url = args.avatar_url.trim();
      if (url.length < 1) {
        throw new ToolError("INVALID_ARGS", "avatar_url can't be empty");
      }
      patch.avatar_url = url;
    }
    if (Object.keys(patch).length === 1) {
      throw new ToolError(
        "INVALID_ARGS",
        "Provide display_name, avatar_url, and/or clear_avatar.",
      );
    }
    const { data, error } = await client
      .from("creator_accounts")
      .update(patch)
      .eq("id", userId)
      .select("id, display_name, avatar_url")
      .maybeSingle();
    if (error) throw new ToolError("RPC_FAILED", error.message);
    if (data === null) {
      throw new ToolError(
        "INVALID_ARGS",
        "Creator account not found for this user.",
      );
    }
    return { profile: data, updated: true };
  },
);

const manageAriHistory = writeTool(
  "manage_ari_history",
  "List Ari conversations, delete one conversation, or delete all Ari data for the signed-in operator (agent_conversations + agent_user_profile).",
  {
    action: {
      type: "string",
      enum: ["list", "delete_conversation", "delete_all"],
    },
    conversation_id: UUID,
  },
  ["action"],
  async (args, client, userId) => {
    const action = String(args.action);
    if (action === "list") {
      const { data, error } = await client
        .from("agent_conversations")
        .select("id, title, brand_id, created_at, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { conversations: data ?? [] };
    }
    if (action === "delete_conversation") {
      if (!isUuid(args.conversation_id)) {
        throw new ToolError("INVALID_ARGS", "conversation_id must be a uuid");
      }
      const { data, error } = await client
        .from("agent_conversations")
        .delete()
        .eq("id", args.conversation_id)
        .eq("user_id", userId)
        .select("id");
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (!data || data.length === 0) {
        throw new ToolError(
          "INVALID_ARGS",
          "Conversation not found or already deleted.",
        );
      }
      return { conversation_id: args.conversation_id, deleted: true };
    }
    if (action === "delete_all") {
      const conversationsResult = await client
        .from("agent_conversations")
        .delete()
        .eq("user_id", userId)
        .select("id");
      if (conversationsResult.error) {
        throw new ToolError("RPC_FAILED", conversationsResult.error.message);
      }
      const profileResult = await client
        .from("agent_user_profile")
        .delete()
        .eq("user_id", userId)
        .select("id");
      if (profileResult.error) {
        throw new ToolError("RPC_FAILED", profileResult.error.message);
      }
      return {
        deleted_conversations: (conversationsResult.data ?? []).length,
        deleted_profile: (profileResult.data ?? []).length > 0,
        deleted_all: true,
      };
    }
    throw new ToolError("INVALID_ARGS", "Unsupported Ari history action");
  },
);

const manageBusinessNotifications = writeTool(
  "manage_business_notifications",
  "List, mark-read, mark-all-read, or soft-delete Host business notifications (stripe.% / business.% only).",
  {
    action: {
      type: "string",
      enum: ["list", "mark_read", "mark_all_read", "soft_delete"],
    },
    notification_id: UUID,
    limit: { type: "integer", minimum: 1, maximum: 50 },
  },
  ["action"],
  async (args, client, userId) => {
    const action = String(args.action);
    if (action === "list") {
      const limit = typeof args.limit === "number"
        ? Math.min(50, Math.max(1, Math.floor(args.limit)))
        : 50;
      const { data, error } = await client
        .from("notifications")
        .select(
          "id, brand_id, type, title, body, deep_link, read_at, created_at",
        )
        .eq("user_id", userId)
        .or("type.like.stripe.%,type.like.business.%")
        .is("deleted_at", null)
        .is("in_app_suppressed_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new ToolError("RPC_FAILED", error.message);
      const rows = data ?? [];
      return {
        notifications: rows,
        unread_count: rows.filter((n) =>
          (n as { read_at?: string | null }).read_at == null
        ).length,
      };
    }
    if (action === "mark_read") {
      if (!isUuid(args.notification_id)) {
        throw new ToolError("INVALID_ARGS", "notification_id must be a uuid");
      }
      const { data, error } = await client
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", args.notification_id)
        .eq("user_id", userId)
        .select("id, read_at")
        .maybeSingle();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (data === null) {
        throw new ToolError("INVALID_ARGS", "Notification not found.");
      }
      return { notification_id: data.id, read_at: data.read_at };
    }
    if (action === "mark_all_read") {
      const nowIso = new Date().toISOString();
      const { data, error } = await client
        .from("notifications")
        .update({ read_at: nowIso })
        .eq("user_id", userId)
        .is("read_at", null)
        .or("type.like.stripe.%,type.like.business.%")
        .select("id");
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { marked: (data ?? []).length, read_at: nowIso };
    }
    if (action === "soft_delete") {
      if (!isUuid(args.notification_id)) {
        throw new ToolError("INVALID_ARGS", "notification_id must be a uuid");
      }
      const { data, error } = await client
        .from("notifications")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", args.notification_id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (data === null) {
        throw new ToolError("INVALID_ARGS", "Notification not found.");
      }
      return { notification_id: data.id, soft_deleted: true };
    }
    throw new ToolError("INVALID_ARGS", "Unsupported notification action");
  },
);

const manageSupportInbox = writeTool(
  "manage_support_inbox",
  "List/get the caller's support tickets, or reply with a text message on the ticket's conversation (same Host supportService + groupChat post).",
  {
    action: { type: "string", enum: ["list", "get", "reply"] },
    ticket_id: UUID,
    content: { type: "string", minLength: 1, maxLength: 4000 },
  },
  ["action"],
  async (args, client, userId) => {
    const action = String(args.action);
    if (action === "list") {
      const { data, error } = await client
        .from("support_tickets")
        .select(
          "id, subject, status, priority, conversation_id, brand_id, created_at, last_message_at, resolved_at",
        )
        .order("last_message_at", { ascending: false })
        .limit(50);
      if (error) throw new ToolError("RPC_FAILED", error.message);
      return { tickets: data ?? [] };
    }
    if (action === "get") {
      if (!isUuid(args.ticket_id)) {
        throw new ToolError("INVALID_ARGS", "ticket_id must be a uuid");
      }
      const { data, error } = await client
        .from("support_tickets")
        .select(
          "id, subject, status, priority, conversation_id, brand_id, created_at, last_message_at, resolved_at",
        )
        .eq("id", args.ticket_id)
        .maybeSingle();
      if (error) throw new ToolError("RPC_FAILED", error.message);
      if (data === null) {
        throw new ToolError("INVALID_ARGS", "Ticket not found or access denied.");
      }
      return { ticket: data };
    }
    if (action === "reply") {
      if (!isUuid(args.ticket_id)) {
        throw new ToolError("INVALID_ARGS", "ticket_id must be a uuid");
      }
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (content.length < 1) {
        throw new ToolError("INVALID_ARGS", "content is required");
      }
      const { data: ticket, error: ticketErr } = await client
        .from("support_tickets")
        .select("id, conversation_id")
        .eq("id", args.ticket_id)
        .maybeSingle();
      if (ticketErr) throw new ToolError("RPC_FAILED", ticketErr.message);
      if (ticket === null || !isUuid(ticket.conversation_id)) {
        throw new ToolError("INVALID_ARGS", "Ticket not found or access denied.");
      }
      const { data: message, error: msgErr } = await client
        .from("messages")
        .insert({
          conversation_id: ticket.conversation_id,
          sender_id: userId,
          content,
          message_type: "text",
        })
        .select("id")
        .single();
      if (msgErr) throw new ToolError("RPC_FAILED", msgErr.message);
      return {
        ticket_id: ticket.id,
        conversation_id: ticket.conversation_id,
        message_id: message.id,
        replied: true,
      };
    }
    throw new ToolError("INVALID_ARGS", "Unsupported support action");
  },
);

// ----------------------------------------------------------------------------
// #1978 reopen — venue gallery (URL sync; device pick stays a guided handoff)
// ----------------------------------------------------------------------------

const manageVenueGallery = writeTool(
  "manage_venue_gallery",
  "Read or sync a venue's gallery URL set via place_pool.business_gallery_urls / run-business-place-authoring-pipeline sync_gallery. URLs must come from the proposal-card picker — device media selection is a guided handoff.",
  {
    brand_id: UUID,
    venue_id: UUID,
    place_pool_id: UUID,
    action: { type: "string", enum: ["get", "sync"] },
    gallery_urls: {
      type: "array",
      items: { type: "string", maxLength: 2000 },
      maxItems: 20,
    },
  },
  ["brand_id", "venue_id", "action"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    if (!isUuid(args.venue_id)) {
      throw new ToolError("INVALID_ARGS", "venue_id must be a uuid");
    }
    const { data: venue, error: venueErr } = await client
      .from("venue_listings")
      .select("id, brand_id, place_pool_id")
      .eq("id", args.venue_id)
      .eq("brand_id", args.brand_id)
      .maybeSingle();
    if (venueErr) throw new ToolError("RPC_FAILED", venueErr.message);
    if (venue === null) {
      throw new ToolError(
        "INVALID_ARGS",
        "Venue not found for this brand, or you lack permission.",
      );
    }
    const placePoolId = isUuid(args.place_pool_id)
      ? args.place_pool_id
      : venue.place_pool_id;
    if (!isUuid(placePoolId)) {
      throw new ToolError(
        "INVALID_ARGS",
        "place_pool_id is required (venue has no linked place).",
      );
    }
    if (actionIsGet(args.action)) {
      await assertAgentReadBrand(client, userId, args.brand_id);
      const { data: place, error: placeErr } = await client
        .from("place_pool")
        .select("id, business_gallery_urls")
        .eq("id", placePoolId)
        .maybeSingle();
      if (placeErr) throw new ToolError("RPC_FAILED", placeErr.message);
      if (place === null) {
        throw new ToolError("INVALID_ARGS", "Place pool not found.");
      }
      const urls = Array.isArray(place.business_gallery_urls)
        ? place.business_gallery_urls.filter((u: unknown) =>
          typeof u === "string" && u.trim().length > 0
        )
        : [];
      return {
        venue_id: args.venue_id,
        place_pool_id: placePoolId,
        gallery_urls: urls,
        gallery_count: urls.length,
      };
    }
    if (String(args.action) !== "sync") {
      throw new ToolError("INVALID_ARGS", "action must be get or sync");
    }
    const raw = Array.isArray(args.gallery_urls) ? args.gallery_urls : null;
    if (raw === null) {
      throw new ToolError("INVALID_ARGS", "gallery_urls is required for sync");
    }
    const galleryUrls = raw
      .filter((u): u is string => typeof u === "string")
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .slice(0, 20);
    return await invokeFn(client, "run-business-place-authoring-pipeline", {
      action: "sync_gallery",
      brand_id: args.brand_id,
      venue_id: args.venue_id,
      place_pool_id: placePoolId,
      gallery_urls: galleryUrls,
    });
  },
);

function actionIsGet(action: unknown): boolean {
  return action === "get";
}

// #1984 — slim a guest roster row to the non-PII fields Ari needs to reason
// about status + next action. Drops contactLabel (partial email/phone),
// avatarUrl, delivery attempts, and order ids so raw PII never enters the
// model context. The DB already gates the read on event_manager+ rank.
function slimRosterRow(row: Record<string, unknown>): Record<string, unknown> {
  const party = (row.party ?? {}) as Record<string, unknown>;
  return {
    rosterKey: row.rosterKey,
    displayName: row.displayName,
    primaryStatus: row.primaryStatus,
    invitationStatus: row.invitationStatus,
    rsvpId: row.rsvpId ?? null,
    // #2593 — read the keys biz_guest_roster_list actually emits. The row is
    // built by biz_guest_roster_project (migration
    // 20270319000873_issue_0873_guest_status_roster.sql), which names them
    // `rsvpApprovalStatus` and `party.size`. The previous `approvalStatus` /
    // `party.rsvpPartySize` / `row.rsvpPartySize` keys exist nowhere in that
    // projection, so BOTH fields were permanently null and Ari reasoned about
    // approvals and party sizes it could not actually see (Constitution 3 + 9).
    approvalStatus: row.rsvpApprovalStatus ?? null,
    checkedIn: row.checkedIn ?? false,
    partySize: party.size ?? null,
    canApprove: row.canApprove ?? false,
    canDeny: row.canDeny ?? false,
    canRemind: row.canRemind ?? false,
    canRetry: row.canRetry ?? false,
  };
}

// #2593 (item 8) — the exact `p_filter` domain biz_guest_roster_list accepts.
// Anything outside this list raises `guest_roster_filter_invalid` (22023) in
// the RPC, so an unconstrained free-text string could only ever reach the
// database to be rejected there. Copied verbatim from the IF ... NOT IN (...)
// guard in migration 20270319000873_issue_0873_guest_status_roster.sql.
const ROSTER_FILTERS = [
  "all",
  "rsvpd",
  "ticketed",
  "not_yet",
  "suppressed",
  "needs_attention",
  "no_response",
  "confirmed",
  "checked_in",
  "not_checked_in",
  "delivery_failed",
  "removed",
  "going",
  "maybe",
  "awaiting_approval",
  "waitlisted",
  "declined",
  "denied",
  "bought_ticket",
  "refunded",
  "cancelled",
  "transferred",
] as const;
const ROSTER_FILTER_SET: ReadonlySet<string> = new Set(ROSTER_FILTERS);

// #2593 (item 4) — the roster cursor is OPAQUE and SIGNED. The RPC accepts a
// jsonb object whose key SET must be exactly these seven, then re-derives the
// HMAC signature and rejects a stale watermark or a forged cursor. So the only
// correct client behaviour is to hand back the previous `nextCursor` byte for
// byte. We validate the key set here purely so a mangled or model-invented
// cursor gets an actionable refusal instead of a raw Postgres sentinel.
const ROSTER_CURSOR_KEYS = [
  "activityAt",
  "name",
  "queryHash",
  "rank",
  "rosterKey",
  "signature",
  "watermark",
] as const;

const ROSTER_CURSOR = {
  type: "object",
  additionalProperties: false,
  required: [...ROSTER_CURSOR_KEYS],
  properties: {
    activityAt: { type: "string" },
    name: { type: "string" },
    queryHash: { type: "string" },
    rank: { type: "integer" },
    rosterKey: { type: "string" },
    signature: { type: "string" },
    watermark: { type: "integer" },
  },
};

function normalizeRosterCursor(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError(
      "INVALID_ARGS",
      "cursor must be the nextCursor object returned by the previous page.",
    );
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...ROSTER_CURSOR_KEYS].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new ToolError(
      "INVALID_ARGS",
      "cursor must be passed back exactly as it was returned — never edited or rebuilt.",
    );
  }
  return value as Record<string, unknown>;
}

const listGuestRoster = writeTool(
  "list_guest_roster",
  "List an owned event's guest roster (biz_guest_roster_list) with names/status only — never raw emails/phones. Supports filter, search and pagination: when the response has hasMore=true, call again with cursor set to the returned nextCursor, unchanged, and the same filter/search/sort/limit.",
  {
    event_id: UUID,
    filter: { type: "string", enum: [...ROSTER_FILTERS] },
    cursor: ROSTER_CURSOR,
    search: { type: "string", maxLength: 200 },
    sort: {
      type: "string",
      enum: ["action_priority", "name_asc", "name_desc", "recent_first"],
    },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
  ["event_id"],
  async (args, client, userId) => {
    await assertAgentReadEvent(client, userId, args.event_id);
    await requireEvent(args, client, userId);
    // #1984 — pass the FULL contract (filter/search/sort/limit) and cap the
    // page so a single call never dumps the whole roster into the model. The
    // pre-repair tool passed only p_event_id (valid via defaults) but returned
    // every field, including contactLabel PII. We slim rows below.
    const limit = typeof args.limit === "number"
      ? Math.min(Math.max(Math.trunc(args.limit), 1), 100)
      : 25;
    // #2593 (item 8) — the schema advertises the enum; the executor enforces
    // it, because the schema is a hint to the model and this is the gate.
    const filter = args.filter === undefined || args.filter === null
      ? "all"
      : String(args.filter);
    if (!ROSTER_FILTER_SET.has(filter)) {
      throw new ToolError(
        "INVALID_ARGS",
        `filter must be one of ${ROSTER_FILTERS.join(", ")}`,
      );
    }
    // #2593 (item 4) — pagination is now real. It used to hardcode
    // `p_cursor: null`, accept no cursor and return no nextCursor, so a caller
    // that saw hasMore=true had no way to ever reach page 2 — the description
    // advertised a capability the code could not perform.
    const cursor = normalizeRosterCursor(args.cursor);
    const result = await callRpc<Record<string, unknown>>(
      client,
      "biz_guest_roster_list",
      {
        p_event_id: args.event_id,
        p_filter: filter,
        p_search: typeof args.search === "string" ? args.search : null,
        p_sort: typeof args.sort === "string" ? args.sort : "action_priority",
        p_cursor: cursor,
        p_limit: limit,
      },
    );
    const rows = Array.isArray(result?.rows)
      ? (result.rows as Array<Record<string, unknown>>).map(slimRosterRow)
      : [];
    const nextCursor = result?.nextCursor ?? null;
    return {
      rows,
      summary: result?.summary ?? null,
      hasMore: nextCursor != null,
      nextCursor,
    };
  },
);

const exportBrandPeople = writeTool(
  "export_brand_people",
  "Kick off a Brand People (brand book) CSV export via brand-people-export. Returns a job to poll. PII — extra confirm.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    await requireBrand(args, client, userId);
    // #1743 — brand-people-export reads a camelCase body and branches on
    // `scope`. Brand-book export needs {scope:"brand_book", brandId,
    // clientRequestId}; the RPC requires a non-null p_client_request_id for
    // idempotency. The pre-repair tool sent {brand_id} (snake_case, no scope,
    // no request id) and 400'd `invalid_request` every time.
    return await invokeFn(client, "brand-people-export", {
      scope: "brand_book",
      brandId: args.brand_id,
      clientRequestId: crypto.randomUUID(),
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
    // Ledger `ari.operator.snapshot` requires brand_member: list every brand the
    // caller can already read. Owner-only filtering was the Wave-3 leftover that
    // kept delegated members out of the snapshot brand list and auto-select.
    const brands = scope.slice(0, 8).map(
      ({ id, name, role, effective_rank }) => ({
        id,
        name,
        role,
        effective_rank,
      }),
    );
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
  manageTripDays,
  manageTripInclusions,
  manageTripTiers,
  manageTripTravelerIntake,
  publishTrip,
  deleteTrip,
  getTripOrderMoney,
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
  manageStayInventory,
  publishStay,
  manageStayPolicyPriceMedia,
  createVenueListing,
  submitVenueClaim,
  markClaimFeedbackFixed,
  listVenueListings,
  getVenueListingStatus,
  listVenueClaimFeedback,
  venueOpsAction,
  sendVenueSms,
  manageVenueAvailability,
  manageVenueMenu,
  manageVenueWaitlist,
  draftCampaign,
  scheduleCampaign,
  sendCampaignNow,
  cancelCampaign,
  runGrowthTool,
  getPayoutStatus,
  getPartnerStatus,
  disconnectPartner,
  getTaxStatus,
  getBrandBalancesReports,
  listPartnerBrandLinks,
  listPartnerSplits,
  refundOrder,
  cancelOrder,
  cancelTripBooking,
  retryInstallment,
  chargeInstallmentNow,
  sendInstallmentReminder,
  getBrandAnalytics,
  getEventOrderReconciliation,
  inviteBrandMember,
  inviteScanner,
  revokeBrandMember,
  listBrandTeam,
  revokeScannerInvitation,
  manageBrandPeople,
  manageEventGroupChat,
  manageEventDoorSale,
  listEventOrders,
  manageEventWaitlist,
  manageEventScanners,
  manageMarketingAudiences,
  manageMarketingTemplates,
  getCampaignReport,
  editProfileAvatar,
  manageAriHistory,
  manageBusinessNotifications,
  manageSupportInbox,
  manageVenueGallery,
  listGuestRoster,
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
  "get_brand_balances_reports",
  "list_partner_brand_links",
  "list_partner_splits",
  "get_brand_analytics",
  "list_guest_roster",
  "list_brand_team",
  "list_event_orders",
  "get_campaign_report",
  "get_operator_snapshot",
  "get_event_order_reconciliation",
  // issue #1978 — venue discovery reads run inline; they never mutate.
  "list_venue_listings",
  "get_venue_listing_status",
  "list_venue_claim_feedback",
  // issue #1971 — the trip order/money snapshot is a fail-closed aggregate
  // read. finance_manager+ is enforced in SQL; it writes nothing.
  "get_trip_order_money",
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
  "charge_installment_now",
  "export_brand_people",
  "request_account_deletion",
  // #1975 — money-affecting Stay operations. create/transition hold priced
  // inventory or move cancellation/refund obligations; policy/price/fees are
  // versioned money changes. Confirmed (not read-only), never inline.
  "create_stay_reservation",
  "transition_stay",
  "manage_stay_policy_price_media",
  // issue #1971 — deposit and instalment metadata changes what a traveller is
  // charged and when. Confirmed, never inline.
  "manage_trip_tiers",
  // #1972 reopen — recording a door sale is money; list stays read-only above.
  "manage_event_door_sale",
]);
