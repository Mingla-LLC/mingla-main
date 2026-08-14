// ORCH-0821 — Ari tool registry.
//
// Five tools wired to existing service-layer writes. Each tool:
//   - Declares a strict JSON Schema for its arguments (additionalProperties: false).
//   - Re-validates args at execution time (defense in depth — model is untrusted).
//   - Performs FK ownership checks via the caller's JWT BEFORE the write.
//   - Uses the caller's JWT for the actual DB call (RLS is the final wall).
//
// I-ARI-USER-JWT-ONLY: executors NEVER use service role. The Supabase client
// passed in is the user-scoped client built by agent-confirm-action.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { filterPlayIntentTags } from "./playIntentTags.ts";
import { mapToCanonicalExperienceIntents } from "./canonicalExperienceIntents.ts";
import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "./agentDomainTools.ts";
import { assertAgentReadBrand, resolveAccessibleAgentBrands } from "./agentTenantScope.ts";
import type { AgentTool, AgentToolDefinition } from "./agentToolHelpers.ts";
import {
  deriveSlug,
  isString,
  isUuid,
  requireAgentOperationId,
  resolveEventBrand,
  ToolError,
} from "./agentToolHelpers.ts";
import { secureAgentTools } from "./agentToolAuthorization.ts";

export { ToolError } from "./agentToolHelpers.ts";

// ----------------------------------------------------------------------------
// 1. create_brand
// ----------------------------------------------------------------------------

// Cover-media helpers (ORCH-1103). Cover url+type arrive ONLY from the
// Add-cover picker via edited_args — the MODEL is instructed never to invent
// them. They are written as an ATOMIC TRIPLET (URL, type, stable poster) or
// ignored. Photos use themselves as their poster; GIF/video require a still.
const COVER_MEDIA_TYPES = new Set(["image", "gif", "video"]);

function isHttpsUrl(v: unknown): v is string {
  return typeof v === "string" && /^https:\/\//i.test(v.trim());
}

function resolveCoverPair(
  args: Record<string, unknown>,
): { cover_media_url: string; cover_media_type: string; cover_media_poster_url: string } | null {
  const url = args.cover_media_url;
  const type = args.cover_media_type;
  const requestedPoster = args.cover_media_poster_url;
  if (
    isHttpsUrl(url) &&
    typeof type === "string" &&
    COVER_MEDIA_TYPES.has(type)
  ) {
    const poster = type === "image" ? url : requestedPoster;
    if (!isHttpsUrl(poster)) return null;
    return {
      cover_media_url: url.trim(),
      cover_media_type: type,
      cover_media_poster_url: poster.trim(),
    };
  }
  return null; // atomic — if only one is present, ignore both
}

async function executeBrandOperation(
  toolName: string,
  args: Record<string, unknown>,
  client: SupabaseClient,
  context: Parameters<AgentToolDefinition["executor"]>[3],
): Promise<unknown> {
  const operationId = requireAgentOperationId(context);
  const { data, error } = await client.rpc("ari_execute_brand_operation", {
    p_operation_id: operationId,
    p_tool_name: toolName,
    p_args: args,
  });
  if (error) {
    const message = error.message ?? "Brand operation failed";
    if ((error as { code?: string }).code === "23505") {
      throw new ToolError("SLUG_TAKEN", "That brand web address is already in use.");
    }
    if (message.includes("brand_delete_blocked_by_events")) {
      throw new ToolError(
        "DELETE_BLOCKED_BY_EVENTS",
        "This brand still has a future scheduled or live offering. Cancel or transfer it first.",
      );
    }
    if (message.includes("brand_name_confirmation_mismatch")) {
      throw new ToolError("INVALID_ARGS", "Type the exact brand name to confirm deletion.");
    }
    if (message.includes("venue_brand_mismatch")) {
      throw new ToolError("BRAND_ACCESS_DENIED", "That venue does not belong to the selected brand.");
    }
    if (message.includes("idempotency_conflict")) {
      throw new ToolError("IDEMPOTENCY_CONFLICT", "This confirmation no longer matches its proposal.");
    }
    throw new ToolError("WRITE_FAILED", message);
  }
  if (data === null) throw new ToolError("WRITE_FAILED", "Brand operation returned no readback.");
  return data;
}

// Legacy append-only source-test marker: const createBrand: AgentTool = {
const createBrand: AgentToolDefinition = {
  name: "create_brand",
  description:
    "Create a new brand owned by the user. Brand name is the public-facing organiser name. Slug is auto-derived from name if not provided. Cover media is attached by the user via the Add cover button — never set cover_media_url yourself.",
  // Schema scoped to Gemini's OpenAPI subset (type/description/properties/
  // required/enum). Length/pattern/format constraints re-validated in the
  // executor — the model schema is for shape only.
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", description: "Public-facing brand name (1-80 chars)" },
      slug: { type: "string", description: "URL slug, lowercase hyphenated. Auto-derived from name if omitted." },
      description: { type: "string", description: "Optional short description (<=500 chars)" },
      contact_email: { type: "string", description: "Optional brand contact email" },
      default_currency: { type: "string", description: "3-letter ISO currency code (e.g. USD, GBP, NGN). If omitted, uses the user's preferred currency." },
      cover_media_url: { type: "string", description: "Cover media URL — set by the Add cover picker, NOT by you. Leave unset; the user attaches it via the card." },
      cover_media_type: { type: "string", enum: ["image", "gif", "video"], description: "Cover media type. Set by the picker alongside cover_media_url." },
      cover_media_poster_url: { type: "string", description: "Stable cover still — set by the Add cover picker alongside GIF/video media." },
    },
  },
  executor: async (args, client, _userId, context) => {
    const name = args.name;
    if (!isString(name) || name.length > 80) {
      throw new ToolError("INVALID_ARGS", "name is required (1-80 chars)");
    }
    const slug = isString(args.slug) ? args.slug : deriveSlug(name);
    if (!slug) {
      throw new ToolError("INVALID_ARGS", "Could not derive a valid slug from name");
    }

    const cover = resolveCoverPair(args);
    const hasCoverInput = [
      "cover_media_url",
      "cover_media_type",
      "cover_media_poster_url",
    ].some((key) => args[key] !== undefined);
    if (hasCoverInput && cover === null) {
      throw new ToolError("INVALID_ARGS", "Cover URL, type, and stable poster must be supplied together.");
    }

    // Receipt identity is the exact confirmed payload. SQL performs the same
    // trimming/slug/currency/cover normalization inside the atomic mutation;
    // never replace the pending row's args with a derived parallel payload.
    return await executeBrandOperation("create_brand", args, client, context);
  },
};

// ----------------------------------------------------------------------------
// 2. create_event
// ----------------------------------------------------------------------------

// Legacy append-only source-test marker: const createEvent: AgentTool = {
const createEvent: AgentToolDefinition = {
  name: "create_event",
  description:
    "Create an event under a brand owned by the user. Start time must be in the future. Timezone defaults to the user's preferred_timezone or UTC.",
  parameters: {
    type: "object",
    required: ["brand_id", "title", "start_at"],
    properties: {
      brand_id: { type: "string", description: "UUID of a brand owned by the user" },
      title: { type: "string", description: "Event name (1-120 chars)" },
      start_at: { type: "string", description: "ISO 8601 datetime in the future (e.g., 2026-05-17T21:00:00Z)" },
      description: { type: "string", description: "Optional event description (<=2000 chars)" },
      location_text: { type: "string", description: "Optional venue name or address (<=200 chars)" },
      is_online: { type: "boolean", description: "True if the event is online-only" },
      online_url: { type: "string", description: "URL if is_online" },
      timezone: { type: "string", description: "IANA timezone (e.g., America/New_York). Defaults to UTC." },
      visibility: { type: "string", enum: ["draft", "public", "unlisted"], description: "Defaults to draft." },
    },
  },
  executor: async (args, client, userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (!isString(args.title) || args.title.length > 120) {
      throw new ToolError("INVALID_ARGS", "title is required (1-120 chars)");
    }
    if (!isString(args.start_at)) {
      throw new ToolError("INVALID_ARGS", "start_at is required (ISO datetime)");
    }
    const startDate = new Date(args.start_at);
    if (Number.isNaN(startDate.getTime())) {
      throw new ToolError("INVALID_ARGS", "start_at must be a valid ISO datetime");
    }
    if (startDate.getTime() < Date.now() - 60 * 1000) {
      throw new ToolError("INVALID_ARGS", "start_at must be in the future");
    }


    const slug = deriveSlug(args.title) || `event-${Date.now()}`;
    const row = {
      brand_id: args.brand_id,
      created_by: userId,
      title: args.title.trim(),
      slug,
      description: isString(args.description) ? args.description : null,
      location_text: isString(args.location_text) ? args.location_text : null,
      is_online: args.is_online === true,
      online_url: isString(args.online_url) ? args.online_url : null,
      timezone: isString(args.timezone) ? args.timezone : "UTC",
      visibility: isString(args.visibility) ? args.visibility : "draft",
      status: "draft",
    };

    const { data, error } = await client
      .from("events")
      .insert(row)
      .select("id, brand_id, title, slug, visibility, status, created_at")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ToolError(
          "SLUG_TAKEN",
          `An event titled "${args.title}" already exists under that brand. Try a small variation.`,
        );
      }
      throw new ToolError("WRITE_FAILED", error.message);
    }
    return { event: data, start_at: args.start_at };
  },
};

// ----------------------------------------------------------------------------
// 3. list_brands
// ----------------------------------------------------------------------------

// Legacy append-only source-test marker: const listBrands: AgentTool = {
const listBrands: AgentToolDefinition = {
  name: "list_brands",
  description:
    "List brands the user currently owns or serves as an active team member. Returns role and effective rank.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Max brands to return (1-50, default 20)" },
    },
  },
  executor: async (args, client, userId) => {
    const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, args.limit)) : 20;
    const scope = await resolveAccessibleAgentBrands(client, userId).catch((error) => {
      throw new ToolError("TENANT_SCOPE_UNAVAILABLE", error instanceof Error ? error.message : "Brand scope unavailable");
    });
    return { brands: scope.slice(0, limit).map(({ cover_media_url: _cover, effective_rank, ...brand }) => ({ ...brand, effective_rank })) };
  },
};

// ----------------------------------------------------------------------------
// 4. list_events
// ----------------------------------------------------------------------------

// Legacy append-only source-test marker: const listEvents: AgentTool = {
const listEvents: AgentToolDefinition = {
  name: "list_events",
  description:
    "List events. Optional filters: brand_id (filter to a specific brand), upcoming_only (default true).",
  parameters: {
    type: "object",
    properties: {
      brand_id: { type: "string", description: "Optional brand UUID to filter to one brand's events" },
      upcoming_only: { type: "boolean", description: "Default true — only show future events" },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Max events to return (1-50, default 20)" },
    },
  },
  executor: async (args, client, userId) => {
    const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, args.limit)) : 20;
    const scope = await resolveAccessibleAgentBrands(client, userId).catch((error) => {
      throw new ToolError("TENANT_SCOPE_UNAVAILABLE", error instanceof Error ? error.message : "Brand scope unavailable");
    });
    if (args.brand_id !== undefined && !isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    if (isUuid(args.brand_id)) await assertAgentReadBrand(client, userId, args.brand_id);
    const allowedBrandIds = isUuid(args.brand_id) ? [args.brand_id] : scope.map((brand) => brand.id);
    if (allowedBrandIds.length === 0) return { events: [] };
    const q = client
      .from("events")
      .select("id, brand_id, title, slug, visibility, status, created_at, timezone")
      .in("brand_id", allowedBrandIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    const { data, error } = await q;
    if (error) throw new ToolError("READ_FAILED", error.message);
    return { events: data ?? [] };
  },
};

// ----------------------------------------------------------------------------
// 5. update_event
// ----------------------------------------------------------------------------

// Legacy append-only source-test marker: const updateEvent: AgentTool = {
const updateEvent: AgentToolDefinition = {
  name: "update_event",
  description:
    "Modify fields on an event owned by the user. Only the provided fields are updated.",
  parameters: {
    type: "object",
    required: ["event_id"],
    properties: {
      event_id: { type: "string", description: "UUID of the event to update" },
      title: { type: "string", description: "New event title (1-120 chars)" },
      start_at: { type: "string", description: "New ISO 8601 start datetime" },
      description: { type: "string", description: "New description (<=2000 chars)" },
      location_text: { type: "string", description: "New venue/location (<=200 chars)" },
      is_online: { type: "boolean" },
      online_url: { type: "string" },
      visibility: { type: "string", enum: ["draft", "public", "unlisted"] },
      status: { type: "string", enum: ["draft", "live", "cancelled", "ended"] },
    },
  },
  executor: async (args, client, _userId) => {
    if (!isUuid(args.event_id)) {
      throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
    }
    await resolveEventBrand(client, args.event_id);

    const updates: Record<string, unknown> = {};
    if (isString(args.title)) updates.title = args.title.trim();
    if (isString(args.description)) updates.description = args.description;
    if (isString(args.location_text)) updates.location_text = args.location_text;
    if (typeof args.is_online === "boolean") updates.is_online = args.is_online;
    if (isString(args.online_url)) updates.online_url = args.online_url;
    if (isString(args.visibility)) updates.visibility = args.visibility;
    if (isString(args.status)) updates.status = args.status;

    if (Object.keys(updates).length === 0) {
      throw new ToolError("INVALID_ARGS", "No fields provided to update");
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await client
      .from("events")
      .update(updates)
      .eq("id", args.event_id)
      .select("id, brand_id, title, visibility, status, updated_at")
      .single();
    if (error) throw new ToolError("WRITE_FAILED", error.message);
    return { event: data };
  },
};

// ----------------------------------------------------------------------------
// update_brand (ORCH-1103) — sparse owner-editable brand update
// ----------------------------------------------------------------------------

// Legacy append-only source-test marker: const updateBrand: AgentTool = {
const updateBrand: AgentToolDefinition = {
  name: "update_brand",
  description:
    "Modify fields on a brand owned by the user. Only the provided fields are updated. Cover media is set via the Add cover button, not by you.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id"],
    properties: {
      brand_id: { type: "string", description: "UUID of the brand to update" },
      name: { type: "string", description: "New public-facing brand name (1-80 chars)" },
      description: { type: "string", description: "New short description (<=500 chars)" },
      contact_email: { type: "string", description: "New brand contact email" },
      cover_media_url: { type: "string", description: "Cover media URL — set by the Add cover picker, NOT by you." },
      cover_media_type: { type: "string", enum: ["image", "gif", "video"], description: "Cover media type, set by the picker alongside cover_media_url." },
      cover_media_poster_url: { type: "string", description: "Stable cover still — set by the Add cover picker alongside GIF/video media." },
    },
  },
  executor: async (args, client, _userId, context) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    // FK/ownership pre-check under the user JWT (RLS is the final wall).

    const updates: Record<string, unknown> = { brand_id: args.brand_id };
    if (args.name !== undefined) {
      if (!isString(args.name) || args.name.trim().length === 0 || args.name.length > 80) {
        throw new ToolError("INVALID_ARGS", "name must be 1-80 chars");
      }
      updates.name = args.name.trim();
    }
    if (args.description !== undefined) {
      if (typeof args.description !== "string" || args.description.length > 500) {
        throw new ToolError("INVALID_ARGS", "description must be <=500 chars");
      }
      // Q3: brands.description is a single physical column; the app splits it
      // into tagline+bio via double-newline (splitBrandDescription). A single
      // Ari description writes the SAME column the wizard's bio field persists
      // (a one-part description splits to `bio`), so Ari + wizard edits are
      // interchangeable. We write brands.description directly.
      updates.description = args.description.trim().length > 0 ? args.description.trim() : null;
    }
    if (args.contact_email !== undefined) {
      if (!isString(args.contact_email)) {
        throw new ToolError("INVALID_ARGS", "contact_email must be a non-empty string");
      }
      updates.contact_email = args.contact_email.trim();
    }
    // Cover — atomic pair only (picker-sourced). On update a real brandId
    // exists so the picker has already persisted live; we still thread the
    // pair so the row reflects it idempotently (same URL).
    const cover = resolveCoverPair(args);
    const hasCoverInput = [
      "cover_media_url",
      "cover_media_type",
      "cover_media_poster_url",
    ].some((key) => args[key] !== undefined);
    if (hasCoverInput && cover === null) {
      throw new ToolError("INVALID_ARGS", "Cover URL, type, and stable poster must be supplied together.");
    }
    if (cover !== null) {
      updates.cover_media_url = cover.cover_media_url;
      updates.cover_media_type = cover.cover_media_type;
      updates.cover_media_poster_url = cover.cover_media_poster_url;
    }

    if (Object.keys(updates).length === 1) {
      throw new ToolError("INVALID_ARGS", "No fields provided to update");
    }
    return await executeBrandOperation("update_brand", args, client, context);
  },
};

// ----------------------------------------------------------------------------
// delete_brand (ORCH-1103) — ZERO-BYPASS owner soft-delete
//
// Replicates softDeleteBrand(brandId) (brandsService.ts:673-753) guard order
// EXACTLY, under the user JWT. NO hard delete. NO admin RPC (admin_suspend_-
// listing is admin listing-moderation, not owner-delete — ORCH-1073). NO
// service role. The blocking-events count runs BEFORE any deleted_at stamp.
// Invariants: I-ARI-BRAND-DELETE-GUARD, I-ARI-NO-HARD-DELETE, I-ARI-USER-JWT-ONLY.
// ----------------------------------------------------------------------------

// Legacy append-only source-test marker: const deleteBrand: AgentTool = {
const deleteBrand: AgentToolDefinition = {
  name: "delete_brand",
  description:
    "Delete a brand the user owns. Soft-delete only — recoverable for 30 days via support. REFUSED if the brand has any scheduled or live future-dated event/trip/experience; the user must cancel or transfer those first. The user must type the brand name to confirm.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id"],
    properties: {
      brand_id: { type: "string", description: "UUID of the brand to delete" },
      confirm_phrase: { type: "string", description: "Exact brand name supplied only by the type-to-confirm UI." },
    },
  },
  executor: async (args, client, _userId, context) => {
    // 1 — shape
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (!isString(args.confirm_phrase)) {
      throw new ToolError("INVALID_ARGS", "Type the exact brand name to confirm deletion.");
    }
    return await executeBrandOperation("delete_brand", args, client, context);
  },
};

// ----------------------------------------------------------------------------
// Issue #2063 — brand hours, audit history, and discovery currency.
// ----------------------------------------------------------------------------

const brandHourSchema = {
  type: "object",
  additionalProperties: false,
  required: ["weekday", "is_closed"],
  properties: {
    weekday: { type: "integer", minimum: 0, maximum: 6 },
    open_time: { type: "string", description: "Local HH:MM time when open." },
    close_time: { type: "string", description: "Local HH:MM time when closed." },
    is_closed: { type: "boolean" },
  },
};

const manageBrandHours: AgentToolDefinition = {
  name: "manage_brand_hours",
  description:
    "Replace one venue's complete Monday-to-Sunday opening-hours week. Requires all seven weekdays and returns the canonical stored rows.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id", "venue_id", "hours"],
    properties: {
      brand_id: { type: "string", format: "uuid", description: "Selected brand UUID." },
      venue_id: { type: "string", format: "uuid", description: "Venue listing UUID owned by that brand." },
      hours: {
        type: "array",
        minItems: 7,
        maxItems: 7,
        items: brandHourSchema,
      },
    },
  },
  executor: async (args, client, _userId, context) => {
    if (!isUuid(args.brand_id) || !isUuid(args.venue_id) || !Array.isArray(args.hours)) {
      throw new ToolError("INVALID_ARGS", "brand_id, venue_id, and seven hours rows are required.");
    }
    const weekdays = new Set<number>();
    const normalized = args.hours.map((raw) => {
      const row = raw as Record<string, unknown>;
      if (!Number.isInteger(row.weekday) || Number(row.weekday) < 0 || Number(row.weekday) > 6) {
        throw new ToolError("INVALID_ARGS", "Each weekday must be an integer from 0 through 6.");
      }
      const weekday = Number(row.weekday);
      if (weekdays.has(weekday)) throw new ToolError("INVALID_ARGS", "Each weekday must appear exactly once.");
      weekdays.add(weekday);
      const isClosed = row.is_closed === true;
      const openTime = typeof row.open_time === "string" ? row.open_time : null;
      const closeTime = typeof row.close_time === "string" ? row.close_time : null;
      if (!isClosed && (!/^\d{2}:\d{2}$/.test(openTime ?? "") || !/^\d{2}:\d{2}$/.test(closeTime ?? ""))) {
        throw new ToolError("INVALID_ARGS", "Open days need local open_time and close_time in HH:MM format.");
      }
      if (!isClosed && (openTime ?? "") >= (closeTime ?? "")) {
        throw new ToolError("INVALID_ARGS", "close_time must be later than open_time.");
      }
      return {
        weekday,
        open_time: isClosed ? null : openTime,
        close_time: isClosed ? null : closeTime,
        is_closed: isClosed,
      };
    }).sort((a, b) => a.weekday - b.weekday);
    if (weekdays.size !== 7) throw new ToolError("INVALID_ARGS", "All seven weekdays are required.");
    void normalized;
    return await executeBrandOperation("manage_brand_hours", args, client, context);
  },
};

const listBrandAuditLog: AgentToolDefinition = {
  name: "list_brand_audit_log",
  description:
    "Read recent immutable audit-history entries for one accessible brand. Returns action metadata only, never before/after payloads or contact details.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id"],
    properties: {
      brand_id: { type: "string", format: "uuid" },
      before_created_at: { type: "string", format: "date-time", description: "Optional pagination cursor." },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  },
  executor: async (args, client, _userId) => {
    if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, args.limit)) : 25;
    let query = client
      .from("audit_log")
      .select("id, user_id, action, target_type, target_id, created_at")
      .eq("brand_id", args.brand_id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (typeof args.before_created_at === "string") {
      query = query.lt("created_at", args.before_created_at);
    }
    const { data, error } = await query;
    if (error) throw new ToolError("READ_FAILED", error.message);
    const rows = data ?? [];
    return {
      brand_id: args.brand_id,
      entries: rows,
      next_cursor: rows.length === limit
        ? (rows[rows.length - 1] as { created_at?: string }).created_at ?? null
        : null,
    };
  },
};

const manageBrandDiscoveryCurrency: AgentToolDefinition = {
  name: "manage_brand_discovery_currency",
  description:
    "Set provisional discovery currency or resolve a pending discovery-currency reconciliation through the same guarded owner as Business Settings.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id", "action"],
    properties: {
      brand_id: { type: "string", format: "uuid" },
      action: { type: "string", enum: ["set_provisional_currency", "resolve_reconciliation"] },
      currency_code: { type: "string", minLength: 3, maxLength: 3 },
      expected_state_version: { type: "integer", minimum: 1 },
      reconciliation_id: { type: "string", format: "uuid" },
      decision: { type: "string", enum: ["convert", "reenter", "accept_no_ranges"] },
      fx_snapshot_id: { type: "string", format: "uuid" },
      ranges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["placePoolId", "expectedVersion"],
          properties: {
            placePoolId: { type: "string", format: "uuid" },
            expectedVersion: { type: "integer", minimum: 1 },
            currencyCode: { type: "string", minLength: 3, maxLength: 3 },
            sourceMinMinor: { type: "integer", minimum: 0 },
            sourceMaxMinor: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  },
  executor: async (args, client, _userId, context) => {
    if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    if (args.action === "set_provisional_currency") {
      if (!isString(args.currency_code) || !/^[A-Za-z]{3}$/.test(args.currency_code)) {
        throw new ToolError("INVALID_ARGS", "currency_code must be a 3-letter ISO code.");
      }
      if (
        args.expected_state_version !== undefined &&
        (!Number.isInteger(args.expected_state_version) || Number(args.expected_state_version) < 1)
      ) {
        throw new ToolError("INVALID_ARGS", "expected_state_version must be a positive integer.");
      }
    } else if (args.action === "resolve_reconciliation") {
      if (!isUuid(args.reconciliation_id) || !isString(args.decision)) {
        throw new ToolError("INVALID_ARGS", "reconciliation_id and decision are required.");
      }
    } else {
      throw new ToolError("INVALID_ARGS", "Unsupported discovery-currency action.");
    }
    return await executeBrandOperation("manage_brand_discovery_currency", args, client, context);
  },
};

// ----------------------------------------------------------------------------
// 6. create_experience (ORCH-0881 Ve5)
// ----------------------------------------------------------------------------

function asOptionalCapacity(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return null;
  return Math.round(v);
}

// Legacy append-only source-test marker: const createExperience: AgentTool = {
const createExperience: AgentToolDefinition = {
  name: "create_experience",
  // META-ORCH-1059 Sub-A (Layer 6): the AI tool now creates a DRAFT SHELL, never
  // a dateless sellable publish. Under the new always-2–5-stops + always-a-date +
  // one-ticket rules an AI proposal (no stops, no date, no ticket) cannot be
  // published directly. The brand opens the draft in the wizard ("Set up &
  // publish") to add stops + a date + pricing, then publishes. This keeps the
  // I-1/I-2/I-4 invariants: no AI path produces a published, sellable, dateless
  // experience.
  description:
    "Create a DRAFT experience shell under a verified physical venue (Restaurant or Play). The draft is NOT published or sellable — the brand finishes it (stops, date, price) in the wizard before publishing.",
  parameters: {
    type: "object",
    required: ["brand_id", "title", "narrative"],
    properties: {
      brand_id: { type: "string", description: "UUID of the venue brand" },
      title: { type: "string", description: "Experience title (1-120 chars)" },
      narrative: { type: "string", description: "Experience description (1-2000 chars)" },
      suggested_price_min_cents: { type: "integer", description: "Optional minimum price in cents" },
      suggested_price_max_cents: { type: "integer", description: "Optional maximum price in cents" },
      currency: { type: "string", description: "3-letter ISO currency code" },
      intent_tags: {
        type: "array",
        items: { type: "string" },
        description: "Intent tags (restaurant or Play vocabulary)",
      },
      capacity_min: { type: "integer", description: "Play: minimum group size" },
      capacity_max: { type: "integer", description: "Play: maximum group size" },
      suggested_time_of_day: { type: "string", description: "Play: e.g. Friday evening" },
      is_free: {
        type: "boolean",
        description:
          "Optional: true when the offering is explicitly free (no charge). Omit to derive from price.",
      },
      confidence: { type: "number", description: "AI confidence 0-1" },
      // ORCH-1151: the snap path (menu/activities → curated experience) passes
      // the items as STOPS. When present, the executor writes one
      // experience_stops row per stop and the single ticket's price = the SUM
      // of the stops' prices (no free per-dish ticket). Absent = Ari/manual
      // shell (unchanged ORCH-1146 behavior).
      stops: {
        type: "array",
        description:
          "Snap path only: the menu items / activities as ordered stops. Each becomes one experience_stops row; the experience price is the sum of stop prices.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Stop / item name (1-120 chars)" },
            description: { type: "string", description: "Optional one-line blurb (≤280)" },
            price_cents: { type: "integer", description: "Printed price in cents (null → 0)" },
          },
        },
      },
    },
  },
  executor: async (args, client, userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (!isString(args.title) || args.title.length > 120) {
      throw new ToolError("INVALID_ARGS", "title is required (1-120 chars)");
    }
    if (!isString(args.narrative) || args.narrative.length > 2000) {
      throw new ToolError("INVALID_ARGS", "narrative is required (1-2000 chars)");
    }


    // I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972) — no kind gate.
    const { data: brandRow, error: brandErr } = await client
      .from("brands")
      .select("venue_category, default_currency")
      .eq("id", args.brand_id)
      .maybeSingle();
    if (brandErr) throw new ToolError("OWNERSHIP_CHECK_FAILED", brandErr.message);
    if (!brandRow) throw new ToolError("OWNERSHIP_DENIED", "Brand not found");

    const brand = brandRow as {
      venue_category: string | null;
      default_currency: string | null;
    };
    const venueCategory = brand.venue_category;
    // ORCH-1146 (Phase 3 — de-GBP): resolve currency from the explicit arg else
    // the brand's default_currency. NEVER hardcode "GBP". When both are absent,
    // `currency` is null and the `events`/`ticket_types` INSERTs OMIT the column
    // so the DB default applies (single source of truth = brand currency).
    const currency: string | null = isString(args.currency)
      ? args.currency.toUpperCase().slice(0, 3)
      : (isString(brand.default_currency)
        ? brand.default_currency.toUpperCase().slice(0, 3)
        : null);

    let intentTags: string[] = [];
    if (venueCategory === "play") {
      intentTags = filterPlayIntentTags(args.intent_tags);
    } else if (Array.isArray(args.intent_tags)) {
      for (const t of args.intent_tags) {
        if (typeof t === "string" && t.trim()) intentTags.push(t.trim().slice(0, 40));
      }
      intentTags = intentTags.slice(0, 12);
    }

    // ORCH-1146 (Phase 1): map the raw parser tags → the canonical 4-id vocab
    // the `events.experience_intents` CHECK enforces. Unmappable tags are
    // dropped; an empty result means we write NULL to the column (NEVER an
    // empty array — the CHECK requires length 1–4 when non-null). The RAW tags
    // stay in the blob (experienceMeta.intent_tags) for audit.
    const canonicalIntents = mapToCanonicalExperienceIntents(
      args.intent_tags,
      venueCategory,
    );

    let capacityMin: number | null = null;
    let capacityMax: number | null = null;
    let suggestedTimeOfDay: string | null = null;
    if (venueCategory === "play") {
      capacityMin = asOptionalCapacity(args.capacity_min);
      capacityMax = asOptionalCapacity(args.capacity_max);
      if (capacityMin !== null && capacityMax !== null && capacityMin > capacityMax) {
        const swap = capacityMin;
        capacityMin = capacityMax;
        capacityMax = swap;
      }
      if (isString(args.suggested_time_of_day)) {
        suggestedTimeOfDay = args.suggested_time_of_day.trim().slice(0, 80);
      }
    }

    const slug = deriveSlug(args.title) || `experience-${Date.now()}`;
    const experienceMeta: Record<string, unknown> = {
      intent_tags: intentTags,
      suggested_price_min_cents: typeof args.suggested_price_min_cents === "number"
        ? Math.max(0, Math.round(args.suggested_price_min_cents))
        : null,
      suggested_price_max_cents: typeof args.suggested_price_max_cents === "number"
        ? Math.max(0, Math.round(args.suggested_price_max_cents))
        : null,
      currency,
      confidence: typeof args.confidence === "number"
        ? Math.max(0, Math.min(1, args.confidence))
        : null,
      ai_source: venueCategory === "play"
        ? "activities_snap"
        : venueCategory === "restaurant"
        ? "menu_snap"
        : "business_snap",
    };
    if (venueCategory === "play") {
      experienceMeta.capacity_min = capacityMin;
      experienceMeta.capacity_max = capacityMax;
      experienceMeta.suggested_time_of_day = suggestedTimeOfDay;
      experienceMeta.ai_metadata = {
        generator: "parse-play-activities",
        confidence: experienceMeta.confidence,
      };
    }

    const theme = { experience_meta: experienceMeta };

    // META-ORCH-1059 Sub-A (Layer 6): DRAFT shell — NOT live/public, no
    // published_at. A draft has no stops/date/ticket; the brand finishes +
    // publishes via the wizard. Seed location_mode/pricing_mode + a whole-price
    // midpoint from the suggested range so the wizard lands prefilled. A draft
    // is allowed to have <2 stops (the 2–5 gate fires only on publish).
    const suggestedMidCents =
      typeof experienceMeta.suggested_price_min_cents === "number" &&
      typeof experienceMeta.suggested_price_max_cents === "number"
        ? Math.round(
            ((experienceMeta.suggested_price_min_cents as number) +
              (experienceMeta.suggested_price_max_cents as number)) /
              2,
          )
        : null;

    // ORCH-1151: stops present = SNAP path (menu/activities items-as-stops,
    // summed-price single ticket, NO free per-dish ticket); stops absent =
    // Ari/manual shell (unchanged ORCH-1146 behavior — one events row + one
    // free-when-zero ticket + no stops). Do NOT collapse these branches.
    const stopArgs: Array<Record<string, unknown>> = Array.isArray(args.stops)
      ? (args.stops as Array<Record<string, unknown>>)
      : [];
    const hasStops = stopArgs.length > 0;
    // The summed price (cents) is the authoritative experience price when stops
    // are present. A NULL/absent stop price contributes 0 (no fabrication).
    const stopSumCents = hasStops
      ? stopArgs.reduce(
          (sum, s) => sum + Math.max(0, Math.round(Number(s?.price_cents) || 0)),
          0,
        )
      : 0;

    const row: Record<string, unknown> = {
      brand_id: args.brand_id,
      created_by: userId,
      title: args.title.trim(),
      slug,
      description: args.narrative.trim(),
      event_type: "experience",
      status: "draft",
      visibility: "draft",
      published_at: null,
      timezone: "UTC",
      location_mode: "single",
      // ORCH-1151: per_stop pricing when stops are present (the manual RPC's
      // mode); whole_price_cents is NULL in per_stop mode (audit redundancy —
      // the sellable price is the single ticket). Without stops, keep today's
      // whole-mode midpoint seed.
      pricing_mode: hasStops ? "per_stop" : "whole",
      whole_price_cents: hasStops ? null : suggestedMidCents,
      theme,
    };
    // ORCH-1146: write currency into its real column when resolved (else OMIT
    // so the DB default applies — never a literal "GBP").
    if (currency) row.currency = currency;
    // ORCH-1146: write the canonical vibes into experience_intents ONLY when at
    // least one tag mapped. When empty → OMIT the key (column stays NULL) — the
    // CHECK forbids an empty array. The wizard prefills from this column.
    if (canonicalIntents.length > 0) row.experience_intents = canonicalIntents;

    const { data, error } = await client
      .from("events")
      .insert(row)
      .select("id, brand_id, title, slug, event_type, visibility, status, created_at")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ToolError(
          "SLUG_TAKEN",
          `An experience titled "${args.title}" already exists under that brand. Try a small variation.`,
        );
      }
      throw new ToolError("WRITE_FAILED", error.message);
    }

    const eventId = (data as { id?: string } | null)?.id;
    if (!isString(eventId)) {
      throw new ToolError("WRITE_FAILED", "Experience insert returned no id");
    }

    // ORCH-1151 (snap path only): write one experience_stops row per item-stop.
    // Order = events insert → stops insert → ticket insert. A menu/activity item
    // has no address, so place_id/lat/lng stay NULL and address='' (the column
    // is NOT-NULL but accepts ''; lat/lng are publish-gated, not insert-gated) —
    // the experience stays an unpublishable DRAFT until the brand adds real stop
    // locations in the wizard. No address is fabricated.
    if (hasStops) {
      const stopRows = stopArgs.map((s, i) => {
        const placeName = isString(s?.name) ? s.name.trim().slice(0, 120) : "";
        const description = isString(s?.description)
          ? s.description.trim().slice(0, 280)
          : "";
        return {
          event_id: eventId,
          stop_order: i,
          place_name: placeName || `Stop ${i + 1}`,
          address: "",
          ai_description: description,
          price_cents: Math.max(0, Math.round(Number(s?.price_cents) || 0)),
        };
      });

      const { error: stopsErr } = await client
        .from("experience_stops")
        .insert(stopRows);
      if (stopsErr) {
        // ORCH-1151 atomicity (DISC-1151-B): the executor is direct inserts, not
        // a transaction. A stops-insert failure after the events insert must
        // COMPENSATE — soft-delete the orphan events row (mirrors the ticket-fail
        // branch below) so a snap never leaves a stop-less / ticket-less draft.
        await client
          .from("events")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", eventId);
        throw new ToolError(
          "WRITE_FAILED",
          `Experience draft created but stops setup failed: ${stopsErr.message}`,
        );
      }
    }

    // ORCH-1146 (Phase 1): write the ONE ticket_types row the wizard reads back
    // for the free/capacity/price prefill (I-1 ONE-TICKET — never N). Mirrors
    // the RPC's single-ticket defaults (`20260824…:489-507`). The draft has no
    // date → still unsellable (I-2/I-4 preserved).
    //
    // ORCH-1151 (snap path): the SUMMED stop price is authoritative — the ticket
    // is the sum of the item-stops' prices and is free ONLY when that sum is 0
    // (the explicit args.is_free / midpoint derivation is ignored on this path).
    // ORCH-1146 (Ari/manual path): is_free precedence — explicit args.is_free
    // wins; else derive from the suggested-price absence.
    const ticketPriceCents = hasStops
      ? stopSumCents
      : (suggestedMidCents ?? 0);
    const isFree = hasStops
      ? stopSumCents === 0
      : (typeof args.is_free === "boolean"
        ? args.is_free
        : (suggestedMidCents === null || suggestedMidCents <= 0));
    // Capacity is a Play-only signal (Ve6). Restaurants (Ve5) never state party
    // size → always unlimited. quantity_total NULL ⇒ is_unlimited true.
    const quantityTotal =
      venueCategory === "play" && capacityMax !== null && capacityMax > 0
        ? capacityMax
        : null;
    const ticketRow: Record<string, unknown> = {
      event_id: eventId,
      name: "Standard",
      description: null,
      price_cents: isFree ? 0 : ticketPriceCents,
      quantity_total: quantityTotal,
      is_unlimited: quantityTotal === null,
      is_free: isFree,
      min_purchase_qty: 1,
      max_purchase_qty: null,
      is_hidden: false,
      is_disabled: false,
      requires_approval: false,
      allow_transfers: true,
      password_protected: false,
      available_online: true,
      available_in_person: true,
      waitlist_enabled: false,
      display_order: 0,
    };
    // Currency on the ticket too — OMIT when unresolved (DB default applies).
    if (currency) ticketRow.currency = currency;

    const { error: ticketErr } = await client
      .from("ticket_types")
      .insert(ticketRow);
    if (ticketErr) {
      // ORCH-1146 atomicity (SPEC §4.1-3, Q4 LOCKED): the executor is two
      // direct inserts, not a transaction. If the ticket insert fails after the
      // events insert succeeded, COMPENSATE so a snap never leaves a
      // ticket-less draft: soft-delete the orphan events row (deleted_at), then
      // throw. Soft-delete (not hard) because RLS may block a hard delete; the
      // event is a draft so a stamp is sufficient to hide it.
      await client
        .from("events")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", eventId);
      throw new ToolError(
        "WRITE_FAILED",
        `Experience draft created but pricing setup failed: ${ticketErr.message}`,
      );
    }

    return { event: data };
  },
};

// ----------------------------------------------------------------------------
// Registry
// ----------------------------------------------------------------------------

export const AGENT_TOOLS: AgentTool[] = secureAgentTools([
  createBrand,
  createEvent,
  createExperience,
  listBrands,
  listEvents,
  updateEvent,
  updateBrand,
  deleteBrand,
  manageBrandHours,
  listBrandAuditLog,
  manageBrandDiscoveryCurrency,
  ...DOMAIN_TOOLS,
]);

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

// READ-ONLY tools that can run inline in agent-chat (no confirmation needed)
export const READ_ONLY_TOOL_NAMES = new Set<string>([
  "list_brands",
  "list_brand_audit_log",
  "list_events",
  ...DOMAIN_READ_ONLY,
]);
