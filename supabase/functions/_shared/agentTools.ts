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
import { mapToCanonicalExperienceIntents } from "./canonicalExperienceIntents.ts";

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

// Cover-media helpers (ORCH-1103). Cover url+type arrive ONLY from the
// Add-cover picker via edited_args — the MODEL is instructed never to invent
// them. They are written as an ATOMIC PAIR (both present + valid) or ignored.
const COVER_MEDIA_TYPES = new Set(["image", "gif", "video"]);

function isHttpsUrl(v: unknown): v is string {
  return typeof v === "string" && /^https:\/\//i.test(v.trim());
}

function resolveCoverPair(
  args: Record<string, unknown>,
): { cover_media_url: string; cover_media_type: string } | null {
  const url = args.cover_media_url;
  const type = args.cover_media_type;
  if (
    isHttpsUrl(url) &&
    typeof type === "string" &&
    COVER_MEDIA_TYPES.has(type)
  ) {
    return { cover_media_url: url.trim(), cover_media_type: type };
  }
  return null; // atomic — if only one is present, ignore both
}

/**
 * Resolve the create-time default currency WITHOUT writing a literal "GBP".
 * Order: (a) explicit valid 3-letter arg → uppercased; (b) the user's
 * agent_user_profile.preferred_currency; (c) null → OMIT the column so the
 * `brands` column DEFAULT applies. ORCH-1103 de-GBP ([[orch-1034]]): the
 * string "GBP" is NEVER written by this executor. (Strict-grep gate G-1.)
 */
async function resolveCreateCurrency(
  args: Record<string, unknown>,
  client: SupabaseClient,
  userId: string,
): Promise<string | null> {
  if (isString(args.default_currency) && args.default_currency.trim().length >= 3) {
    return args.default_currency.toUpperCase().slice(0, 3);
  }
  const { data } = await client
    .from("agent_user_profile")
    .select("preferred_currency")
    .eq("user_id", userId)
    .maybeSingle();
  const pref = (data as { preferred_currency?: string | null } | null)?.preferred_currency;
  if (isString(pref) && pref.trim().length >= 3) {
    return pref.toUpperCase().slice(0, 3);
  }
  return null; // let the column default decide — do NOT write a literal code
}

const createBrand: AgentTool = {
  name: "create_brand",
  description:
    "Create a new brand owned by the user. Brand name is the public-facing organiser name. Slug is auto-derived from name if not provided. Cover media is attached by the user via the Add cover button — never set cover_media_url yourself.",
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
      default_currency: { type: "string", description: "3-letter ISO currency code (e.g. USD, GBP, NGN). If omitted, uses the user's preferred currency." },
      cover_media_url: { type: "string", description: "Cover media URL — set by the Add cover picker, NOT by you. Leave unset; the user attaches it via the card." },
      cover_media_type: { type: "string", enum: ["image", "gif", "video"], description: "Cover media type. Set by the picker alongside cover_media_url." },
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

    // ORCH-1103 — de-GBP: resolve currency or OMIT so the column default
    // applies. The executor never writes a hard-coded currency string.
    const resolvedCurrency = await resolveCreateCurrency(args, client, userId);
    const cover = resolveCoverPair(args);

    const row: Record<string, unknown> = {
      account_id: userId,
      name: name.trim(),
      slug,
      description: isString(args.description) ? args.description : null,
      contact_email: isString(args.contact_email) ? args.contact_email : null,
    };
    // Only set default_currency when explicitly resolved — otherwise omit the
    // key entirely so the `brands.default_currency` column DEFAULT decides.
    if (resolvedCurrency !== null) {
      row.default_currency = resolvedCurrency;
    }
    // ORCH-1103 — optional cover, atomic pair only (picker-sourced).
    if (cover !== null) {
      row.cover_media_url = cover.cover_media_url;
      row.cover_media_type = cover.cover_media_type;
    }

    const { data, error } = await client
      .from("brands")
      .insert(row)
      .select("id, name, slug, default_currency, cover_media_url, cover_media_type, created_at")
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

    const newBrandId = (data as { id: string }).id;

    // ORCH-1103 — set as default on the user's FIRST brand (wizard parity,
    // BrandCreationFlow.commitDefaultBrand). Non-fatal fire-and-forget per
    // I-PROPOSED-B: a failure here must NOT fail the create.
    let setAsDefault = false;
    try {
      const { count } = await client
        .from("brands")
        .select("id", { count: "exact", head: true })
        .eq("account_id", userId)
        .is("deleted_at", null);
      if (count === 1) {
        const { error: defaultErr } = await client
          .from("creator_accounts")
          .update({ default_brand_id: newBrandId })
          .eq("id", userId);
        if (defaultErr) {
          console.warn("[create_brand] set default_brand_id failed:", defaultErr.message);
        } else {
          setAsDefault = true;
        }
      }
    } catch (e) {
      // Non-fatal — brand is already created. Surface, do not throw.
      console.warn("[create_brand] default-brand check failed:", (e as Error)?.message ?? e);
    }

    return { brand: data, set_as_default: setAsDefault };
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
// update_brand (ORCH-1103) — sparse owner-editable brand update
// ----------------------------------------------------------------------------

const updateBrand: AgentTool = {
  name: "update_brand",
  description:
    "Modify fields on a brand owned by the user. Only the provided fields are updated. Cover media is set via the Add cover button, not by you.",
  parameters: {
    type: "object",
    required: ["brand_id"],
    properties: {
      brand_id: { type: "string", description: "UUID of the brand to update" },
      name: { type: "string", description: "New public-facing brand name (1-80 chars)" },
      description: { type: "string", description: "New short description (<=500 chars)" },
      contact_email: { type: "string", description: "New brand contact email" },
      default_currency: { type: "string", description: "New 3-letter ISO currency code" },
      cover_media_url: { type: "string", description: "Cover media URL — set by the Add cover picker, NOT by you." },
      cover_media_type: { type: "string", enum: ["image", "gif", "video"], description: "Cover media type, set by the picker alongside cover_media_url." },
    },
  },
  executor: async (args, client, userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    // FK/ownership pre-check under the user JWT (RLS is the final wall).
    await assertBrandOwned(client, args.brand_id, userId);

    const updates: Record<string, unknown> = {};
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
    if (args.default_currency !== undefined) {
      if (!isString(args.default_currency) || args.default_currency.trim().length < 3) {
        throw new ToolError("INVALID_ARGS", "default_currency must be a 3-letter ISO code");
      }
      updates.default_currency = args.default_currency.toUpperCase().slice(0, 3);
    }
    // Cover — atomic pair only (picker-sourced). On update a real brandId
    // exists so the picker has already persisted live; we still thread the
    // pair so the row reflects it idempotently (same URL).
    const cover = resolveCoverPair(args);
    if (cover !== null) {
      updates.cover_media_url = cover.cover_media_url;
      updates.cover_media_type = cover.cover_media_type;
    }

    if (Object.keys(updates).length === 0) {
      throw new ToolError("INVALID_ARGS", "No fields provided to update");
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await client
      .from("brands")
      .update(updates)
      .eq("id", args.brand_id)
      .is("deleted_at", null)
      .select("id, name, slug, default_currency, cover_media_url, cover_media_type, updated_at")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ToolError(
          "SLUG_TAKEN",
          `A brand with that name already exists. Try a small variation.`,
        );
      }
      throw new ToolError("WRITE_FAILED", error.message);
    }
    return { brand: data };
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

const BRAND_DELETE_BLOCKING_EVENT_STATUSES = ["scheduled", "live"] as const;
const BRAND_RECOVERY_WINDOW_DAYS = 30;

const deleteBrand: AgentTool = {
  name: "delete_brand",
  description:
    "Delete a brand the user owns. Soft-delete only — recoverable for 30 days via support. REFUSED if the brand has any scheduled or live future-dated event/trip/experience; the user must cancel or transfer those first. The user must type the brand name to confirm.",
  parameters: {
    type: "object",
    required: ["brand_id"],
    properties: {
      brand_id: { type: "string", description: "UUID of the brand to delete" },
    },
  },
  executor: async (args, client, userId) => {
    // 1 — shape
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    const brandId = args.brand_id;

    // 2 — ownership + not-already-deleted (under the user JWT)
    await assertBrandOwned(client, brandId, userId);

    // 3 — GUARD: blocking-events count BEFORE any write (softDeleteBrand step 1).
    // Type-agnostic by design (a brand with scheduled trips/experiences also
    // blocks delete). Mirrors the canonical guard's date-aware end_at filter.
    // orch-strict-grep-allow events-type-filter — intentionally NO event_type filter.
    const nowIso = new Date().toISOString();
    const { count, error: countError } = await client
      .from("events")
      .select("id, event_dates!inner(end_at)", { count: "exact", head: true })
      .eq("brand_id", brandId)
      .in("status", BRAND_DELETE_BLOCKING_EVENT_STATUSES)
      .is("deleted_at", null)
      .gt("event_dates.end_at", nowIso);
    if (countError) {
      throw new ToolError("OWNERSHIP_CHECK_FAILED", countError.message);
    }
    if (count !== null && count > 0) {
      // Recoverable refusal — surfaced as a clear Ari message (409), NOT a crash.
      throw new ToolError(
        "DELETE_BLOCKED_BY_EVENTS",
        `This brand has ${count} upcoming or live event${count === 1 ? "" : "s"}. Cancel or transfer them before deleting.`,
      );
    }

    // 4 — soft-delete (softDeleteBrand step 2). Rowcount-verified +
    // idempotent via .is("deleted_at", null).
    const { data, error: updateError } = await client
      .from("brands")
      .update({ deleted_at: nowIso })
      .eq("id", brandId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (updateError) {
      throw new ToolError("WRITE_FAILED", updateError.message);
    }
    if (!data) {
      throw new ToolError(
        "WRITE_FAILED",
        "Brand could not be deleted (already removed or not permitted).",
      );
    }

    // 5 — clear default_brand_id pointer (softDeleteBrand step 3, I-PROPOSED-B).
    // Non-fatal fire-and-forget — the brand is already soft-deleted.
    try {
      const { error: clearErr } = await client
        .from("creator_accounts")
        .update({ default_brand_id: null })
        .eq("default_brand_id", brandId);
      if (clearErr) {
        console.warn("[delete_brand] clear default_brand_id failed:", clearErr.message);
      }
    } catch (e) {
      console.warn("[delete_brand] clear default_brand_id threw:", (e as Error)?.message ?? e);
    }

    return {
      brand: { id: brandId },
      deleted: true,
      recovery_window_days: BRAND_RECOVERY_WINDOW_DAYS,
    };
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
      pricing_mode: "whole",
      whole_price_cents: suggestedMidCents,
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

    // ORCH-1146 (Phase 1): write the ONE ticket_types row the wizard reads back
    // for the free/capacity/price prefill (I-1 ONE-TICKET — never N). Mirrors
    // the RPC's single-ticket defaults (`20260824…:489-507`). The draft has no
    // date → still unsellable (I-2/I-4 preserved). is_free precedence: explicit
    // args.is_free wins (Phase-2 parser field); else derive from price absence.
    const isFree = typeof args.is_free === "boolean"
      ? args.is_free
      : (suggestedMidCents === null || suggestedMidCents <= 0);
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
      price_cents: isFree ? 0 : (suggestedMidCents ?? 0),
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

export const AGENT_TOOLS: AgentTool[] = [
  createBrand,
  createEvent,
  createExperience,
  listBrands,
  listEvents,
  updateEvent,
  updateBrand,
  deleteBrand,
];

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

// READ-ONLY tools that can run inline in agent-chat (no confirmation needed)
export const READ_ONLY_TOOL_NAMES = new Set<string>(["list_brands", "list_events"]);
