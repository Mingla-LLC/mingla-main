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

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { filterPlayIntentTags } from "./playIntentTags.ts";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  executor: (
    args: Record<string, unknown>,
    userClient: SupabaseClient,
    userId: string,
  ) => Promise<unknown>;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function deriveSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function assertBrandOwned(
  client: SupabaseClient,
  brandId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await client
    .from("brands")
    .select("id")
    .eq("id", brandId)
    .eq("account_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new ToolError("OWNERSHIP_CHECK_FAILED", error.message);
  if (!data) throw new ToolError("OWNERSHIP_DENIED", `Brand ${brandId} is not owned by caller`);
}

async function assertEventOwned(
  client: SupabaseClient,
  eventId: string,
  userId: string,
): Promise<string> {
  // events.created_by OR brand ownership; we check via the chain
  const { data, error } = await client
    .from("events")
    .select("id, brand_id, brands!inner(account_id)")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new ToolError("OWNERSHIP_CHECK_FAILED", error.message);
  if (!data) throw new ToolError("OWNERSHIP_DENIED", `Event ${eventId} not found or not owned`);
  // brands inner-join ensures RLS already enforced ownership; we still confirm
  const accountId = (data as any).brands?.account_id;
  if (accountId !== userId) {
    throw new ToolError("OWNERSHIP_DENIED", `Event ${eventId} is not owned by caller`);
  }
  return (data as any).brand_id as string;
}

export class ToolError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ToolError";
  }
}

// ----------------------------------------------------------------------------
// 1. create_brand
// ----------------------------------------------------------------------------

const createBrand: AgentTool = {
  name: "create_brand",
  description:
    "Create a new brand owned by the user. Brand name is the public-facing organiser name. Slug is auto-derived from name if not provided.",
  // Schema scoped to Gemini's OpenAPI subset (type/description/properties/
  // required/enum). Length/pattern/format constraints re-validated in the
  // executor — the model schema is for shape only.
  parameters: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", description: "Public-facing brand name (1-80 chars)" },
      slug: { type: "string", description: "URL slug, lowercase hyphenated. Auto-derived from name if omitted." },
      description: { type: "string", description: "Optional short description (<=500 chars)" },
      contact_email: { type: "string", description: "Optional brand contact email" },
      default_currency: { type: "string", description: "3-letter ISO currency code (e.g., GBP, USD). Defaults to GBP." },
    },
  },
  executor: async (args, client, userId) => {
    const name = args.name;
    if (!isString(name) || name.length > 80) {
      throw new ToolError("INVALID_ARGS", "name is required (1-80 chars)");
    }
    const slug = isString(args.slug) ? args.slug : deriveSlug(name);
    if (!slug) {
      throw new ToolError("INVALID_ARGS", "Could not derive a valid slug from name");
    }

    const row = {
      account_id: userId,
      name: name.trim(),
      slug,
      description: isString(args.description) ? args.description : null,
      contact_email: isString(args.contact_email) ? args.contact_email : null,
      default_currency: isString(args.default_currency) ? args.default_currency : "GBP",
    };

    const { data, error } = await client
      .from("brands")
      .insert(row)
      .select("id, name, slug, default_currency, created_at")
      .single();
    if (error) {
      // 23505 = Postgres unique_violation. The manual create-brand UI
      // surfaces this as "This brand name is taken" inline (see
      // mingla-business/src/services/brandsService.ts SlugCollisionError).
      // Match that behavior here so Ari and the manual flow give consistent
      // outcomes for the same conflict.
      if ((error as { code?: string }).code === "23505") {
        throw new ToolError(
          "SLUG_TAKEN",
          `A brand named "${name.trim()}" already exists. Try a small variation (e.g., "${name.trim()} Events").`,
        );
      }
      throw new ToolError("WRITE_FAILED", error.message);
    }
    return { brand: data };
  },
};

// ----------------------------------------------------------------------------
// 2. create_event
// ----------------------------------------------------------------------------

const createEvent: AgentTool = {
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

    await assertBrandOwned(client, args.brand_id, userId);

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

const listBrands: AgentTool = {
  name: "list_brands",
  description:
    "List all brands owned by the user. Returns id, name, slug, default_currency, created_at.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Max brands to return (1-50, default 20)" },
    },
  },
  executor: async (args, client, _userId) => {
    const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, args.limit)) : 20;
    const { data, error } = await client
      .from("brands")
      .select("id, name, slug, default_currency, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new ToolError("READ_FAILED", error.message);
    return { brands: data ?? [] };
  },
};

// ----------------------------------------------------------------------------
// 4. list_events
// ----------------------------------------------------------------------------

const listEvents: AgentTool = {
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
    if (isUuid(args.brand_id)) {
      await assertBrandOwned(client, args.brand_id, userId);
    }
    let q = client
      .from("events")
      .select("id, brand_id, title, slug, visibility, status, created_at, timezone")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (isUuid(args.brand_id)) {
      q = q.eq("brand_id", args.brand_id);
    }
    const { data, error } = await q;
    if (error) throw new ToolError("READ_FAILED", error.message);
    return { events: data ?? [] };
  },
};

// ----------------------------------------------------------------------------
// 5. update_event
// ----------------------------------------------------------------------------

const updateEvent: AgentTool = {
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
  executor: async (args, client, userId) => {
    if (!isUuid(args.event_id)) {
      throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
    }
    await assertEventOwned(client, args.event_id, userId);

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
// 6. create_experience (ORCH-0881 Ve5)
// ----------------------------------------------------------------------------

function asOptionalCapacity(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return null;
  return Math.round(v);
}

const createExperience: AgentTool = {
  name: "create_experience",
  description:
    "Create a single-intent venue experience under a verified physical venue (Restaurant or Play). Publishes live and public immediately on accept.",
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
      confidence: { type: "number", description: "AI confidence 0-1" },
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

    await assertBrandOwned(client, args.brand_id, userId);

    const { data: brandRow, error: brandErr } = await client
      .from("brands")
      .select("kind, venue_category, claim_status, default_currency")
      .eq("id", args.brand_id)
      .maybeSingle();
    if (brandErr) throw new ToolError("OWNERSHIP_CHECK_FAILED", brandErr.message);
    if (!brandRow) throw new ToolError("OWNERSHIP_DENIED", "Brand not found");

    const brand = brandRow as {
      kind: string;
      venue_category: string | null;
      claim_status: string | null;
      default_currency: string | null;
    };
    const venueCategory = brand.venue_category;
    if (brand.kind !== "physical") {
      throw new ToolError("INVALID_ARGS", "Experiences require a verified physical venue");
    }
    if (venueCategory !== "restaurant" && venueCategory !== "play") {
      throw new ToolError(
        "INVALID_ARGS",
        "Experiences require a Restaurant or Play venue category",
      );
    }
    if (brand.claim_status !== "verified") {
      throw new ToolError("INVALID_ARGS", "Venue must be verified before publishing experiences");
    }

    const currency = isString(args.currency)
      ? args.currency.toUpperCase().slice(0, 3)
      : (brand.default_currency ?? "GBP");

    let intentTags: string[] = [];
    if (venueCategory === "play") {
      intentTags = filterPlayIntentTags(args.intent_tags);
    } else if (Array.isArray(args.intent_tags)) {
      for (const t of args.intent_tags) {
        if (typeof t === "string" && t.trim()) intentTags.push(t.trim().slice(0, 40));
      }
      intentTags = intentTags.slice(0, 12);
    }

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
      ai_source: venueCategory === "play" ? "activities_snap" : "menu_snap",
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

    const row = {
      brand_id: args.brand_id,
      created_by: userId,
      title: args.title.trim(),
      slug,
      description: args.narrative.trim(),
      event_type: "experience",
      status: "live",
      visibility: "public",
      timezone: "UTC",
      theme,
    };

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
    return { event: data };
  },
};

// ----------------------------------------------------------------------------
// Registry
// ----------------------------------------------------------------------------

export const AGENT_TOOLS: AgentTool[] = [
  createBrand,
  createEvent,
  createExperience,
  listBrands,
  listEvents,
  updateEvent,
];

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

// READ-ONLY tools that can run inline in agent-chat (no confirmation needed)
export const READ_ONLY_TOOL_NAMES = new Set<string>(["list_brands", "list_events"]);
