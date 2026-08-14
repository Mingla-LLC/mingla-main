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
import { mapToCanonicalExperienceIntents } from "./canonicalExperienceIntents.ts";
import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "./agentDomainTools.ts";
import { assertAgentReadBrand, resolveAccessibleAgentBrands } from "./agentTenantScope.ts";
import type { AgentTool, AgentToolDefinition } from "./agentToolHelpers.ts";
import { deriveSlug, isString, isUuid, resolveEventBrand, ToolError } from "./agentToolHelpers.ts";
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
      row.cover_media_poster_url = cover.cover_media_poster_url;
    }

    const { data, error } = await client
      .from("brands")
      .insert(row)
      .select("id, name, slug, default_currency, cover_media_url, cover_media_poster_url, cover_media_type, created_at")
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
    required: ["brand_id"],
    properties: {
      brand_id: { type: "string", description: "UUID of the brand to update" },
      name: { type: "string", description: "New public-facing brand name (1-80 chars)" },
      description: { type: "string", description: "New short description (<=500 chars)" },
      contact_email: { type: "string", description: "New brand contact email" },
      default_currency: { type: "string", description: "New 3-letter ISO currency code" },
      cover_media_url: { type: "string", description: "Cover media URL — set by the Add cover picker, NOT by you." },
      cover_media_type: { type: "string", enum: ["image", "gif", "video"], description: "Cover media type, set by the picker alongside cover_media_url." },
      cover_media_poster_url: { type: "string", description: "Stable cover still — set by the Add cover picker alongside GIF/video media." },
    },
  },
  executor: async (args, client, _userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    // FK/ownership pre-check under the user JWT (RLS is the final wall).

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
      updates.cover_media_poster_url = cover.cover_media_poster_url;
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
      .select("id, name, slug, default_currency, cover_media_url, cover_media_poster_url, cover_media_type, updated_at")
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

// Legacy append-only source-test marker: const deleteBrand: AgentTool = {
const deleteBrand: AgentToolDefinition = {
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
  executor: async (args, client, _userId) => {
    // 1 — shape
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    const brandId = args.brand_id;

    // 2 — ownership + not-already-deleted (under the user JWT)

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

// Legacy append-only source-test marker: const createExperience: AgentTool = {
const createExperience: AgentToolDefinition = {
  name: "create_experience",
  description:
    "Create one private experience draft through the same transactional graph owner used by the Business wizard. Returns the stored graph; it does not publish.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id", "title", "narrative"],
    properties: {
      brand_id: { type: "string", format: "uuid", description: "UUID of the venue brand" },
      title: { type: "string", minLength: 1, maxLength: 120, description: "Experience title (1-120 chars)" },
      narrative: { type: "string", minLength: 1, maxLength: 500, description: "Experience description (1-500 chars)" },
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
        maxItems: 5,
        description:
          "Snap path only: the menu items / activities as ordered stops. Each becomes one experience_stops row; the experience price is the sum of stop prices.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 120, description: "Stop / item name (1-120 chars)" },
            place_name: { type: "string", maxLength: 120 },
            description: { type: "string", maxLength: 280, description: "Optional one-line blurb (≤280)" },
            ai_description: { type: "string", maxLength: 280 },
            price_cents: { type: "integer", minimum: 0, description: "Printed price in cents (null → 0)" },
            address: { type: "string" },
            city: { type: "string" },
            region: { type: "string" },
            country_code: { type: "string" },
            place_id: { type: "string" },
            lat: { type: "number" },
            lng: { type: "number" },
            coordinate_precision: { type: "string", enum: ["exact", "approximate"] },
            start_time: { type: "string" },
            image_urls: { type: "array", maxItems: 5, items: { type: "string" } },
          },
        },
      },
      experience_intents: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: { type: "string", enum: ["adventurous", "first-date", "romantic", "group-fun"] },
      },
      location_mode: { type: "string", enum: ["single", "per_stop"] },
      pricing_mode: { type: "string", enum: ["whole", "per_stop"] },
      whole_price_cents: { type: "integer", minimum: 0 },
      capacity: { type: "integer", minimum: 1 },
      timezone: { type: "string" },
      whenMode: { type: "string", enum: ["single", "multi_date", "recurring"] },
      when: { type: "object" },
      multiDates: { type: "array", items: { type: "object" } },
      recurrence_rules: { type: ["array", "object", "null"] },
      cover: { type: "object" },
    },
  },
  executor: async (args, client, _userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (!isString(args.title) || args.title.length > 120) {
      throw new ToolError("INVALID_ARGS", "title is required (1-120 chars)");
    }
    if (!isString(args.narrative) || args.narrative.length > 500) {
      throw new ToolError("INVALID_ARGS", "narrative is required (1-2000 chars)");
    }
    const rawStops = Array.isArray(args.stops)
      ? args.stops as Array<Record<string, unknown>>
      : [];
    if (rawStops.length > 5) {
      throw new ToolError("INVALID_ARGS", "stops must contain at most 5 items");
    }
    if (rawStops.some((stop) => Array.isArray(stop.image_urls) && stop.image_urls.length > 5)) {
      throw new ToolError("INVALID_ARGS", "each stop may contain at most 5 images");
    }
    const stopArgs = rawStops.length > 0
      ? rawStops.map((stop, index) => ({
        stop_order: index,
        place_name: typeof stop.place_name === "string" ? stop.place_name : stop.name,
        ai_description: typeof stop.ai_description === "string" ? stop.ai_description : stop.description,
        address: typeof stop.address === "string" ? stop.address : "",
        city: stop.city ?? null,
        region: stop.region ?? null,
        country_code: stop.country_code ?? null,
        place_id: stop.place_id ?? null,
        lat: stop.lat ?? null,
        lng: stop.lng ?? null,
        coordinate_precision: stop.coordinate_precision ?? null,
        start_time: stop.start_time ?? null,
        price_cents: typeof stop.price_cents === "number" ? Math.max(0, Math.round(stop.price_cents)) : 0,
        image_urls: Array.isArray(stop.image_urls) ? stop.image_urls : [],
      }))
      : [];
    const suggestedMid = typeof args.suggested_price_min_cents === "number" &&
        typeof args.suggested_price_max_cents === "number"
      ? Math.round((args.suggested_price_min_cents + args.suggested_price_max_cents) / 2)
      : null;
    const stopTotal = stopArgs.reduce((sum, stop) => sum + Number(stop.price_cents ?? 0), 0);
    const payload: Record<string, unknown> = {
      title: args.title.trim(),
      description: args.narrative.trim(),
      experience_intents: mapToCanonicalExperienceIntents(
        Array.isArray(args.experience_intents) ? args.experience_intents : args.intent_tags,
        null,
      ),
      stops: stopArgs,
      location_mode: args.location_mode ?? (stopArgs.length > 0 ? "per_stop" : "single"),
      pricing_mode: args.pricing_mode ?? (stopArgs.length > 0 ? "per_stop" : "whole"),
      whole_price_cents: typeof args.whole_price_cents === "number" ? args.whole_price_cents : suggestedMid,
      is_free: typeof args.is_free === "boolean" ? args.is_free : (stopArgs.length > 0 ? stopTotal === 0 : suggestedMid === null || suggestedMid === 0),
      capacity: args.capacity ?? args.capacity_max ?? null,
      currency: args.currency ?? null,
      timezone: args.timezone ?? null,
      whenMode: args.whenMode ?? "single",
      when: args.when ?? null,
      multiDates: args.multiDates ?? null,
      recurrence_rules: args.recurrence_rules ?? null,
      cover: args.cover ?? {},
    };
    const { data, error } = await client.rpc("business_create_experience_graph", {
      p_brand_id: args.brand_id,
      p_payload: payload,
    });
    if (error) throw new ToolError("WRITE_FAILED", error.message);
    return data;
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
  ...DOMAIN_TOOLS,
]);

export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}

// READ-ONLY tools that can run inline in agent-chat (no confirmation needed)
export const READ_ONLY_TOOL_NAMES = new Set<string>([
  "list_brands",
  "list_events",
  ...DOMAIN_READ_ONLY,
]);
