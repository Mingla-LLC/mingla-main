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
import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "./agentDomainTools.ts";
import {
  assertAgentReadBrand,
  resolveAccessibleAgentBrands,
} from "./agentTenantScope.ts";
import type { AgentTool, AgentToolDefinition } from "./agentToolHelpers.ts";
import {
  callRpc,
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
): {
  cover_media_url: string;
  cover_media_type: string;
  cover_media_poster_url: string;
} | null {
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
  if (
    isString(args.default_currency) && args.default_currency.trim().length >= 3
  ) {
    return args.default_currency.toUpperCase().slice(0, 3);
  }
  const { data } = await client
    .from("agent_user_profile")
    .select("preferred_currency")
    .eq("user_id", userId)
    .maybeSingle();
  const pref = (data as { preferred_currency?: string | null } | null)
    ?.preferred_currency;
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
      name: {
        type: "string",
        description: "Public-facing brand name (1-80 chars)",
      },
      slug: {
        type: "string",
        description:
          "URL slug, lowercase hyphenated. Auto-derived from name if omitted.",
      },
      description: {
        type: "string",
        description: "Optional short description (<=500 chars)",
      },
      contact_email: {
        type: "string",
        description: "Optional brand contact email",
      },
      default_currency: {
        type: "string",
        description:
          "3-letter ISO currency code (e.g. USD, GBP, NGN). If omitted, uses the user's preferred currency.",
      },
      cover_media_url: {
        type: "string",
        description:
          "Cover media URL — set by the Add cover picker, NOT by you. Leave unset; the user attaches it via the card.",
      },
      cover_media_type: {
        type: "string",
        enum: ["image", "gif", "video"],
        description:
          "Cover media type. Set by the picker alongside cover_media_url.",
      },
      cover_media_poster_url: {
        type: "string",
        description:
          "Stable cover still — set by the Add cover picker alongside GIF/video media.",
      },
    },
  },
  executor: async (args, client, userId, _context) => {
    const name = args.name;
    if (!isString(name) || name.length > 80) {
      throw new ToolError("INVALID_ARGS", "name is required (1-80 chars)");
    }
    const slug = isString(args.slug) ? args.slug : deriveSlug(name);
    if (!slug) {
      throw new ToolError(
        "INVALID_ARGS",
        "Could not derive a valid slug from name",
      );
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
      .select(
        "id, name, slug, default_currency, cover_media_url, cover_media_poster_url, cover_media_type, created_at",
      )
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
          console.warn(
            "[create_brand] set default_brand_id failed:",
            defaultErr.message,
          );
        } else {
          setAsDefault = true;
        }
      }
    } catch (e) {
      // Non-fatal — brand is already created. Surface, do not throw.
      console.warn(
        "[create_brand] default-brand check failed:",
        (e as Error)?.message ?? e,
      );
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
    required: ["brand_id", "title", "when_mode", "visibility"],
    properties: {
      brand_id: {
        type: "string",
        description: "UUID of a brand owned by the user",
      },
      title: { type: "string", description: "Event name (1-120 chars)" },
      when_mode: {
        type: "string",
        enum: ["single", "multi_date", "recurring"],
        description:
          "Schedule topology. Single/recurring use start_at; multi_date uses multi_dates.",
      },
      start_at: {
        type: "string",
        description:
          "ISO 8601 datetime in the future (e.g., 2026-05-17T21:00:00Z)",
      },
      end_at: {
        type: "string",
        description: "Optional ISO 8601 end datetime after start_at",
      },
      multi_dates: {
        type: "array",
        minItems: 2,
        maxItems: 24,
        items: {
          type: "object",
          required: ["date", "start_time", "end_time"],
          properties: {
            id: { type: "string" },
            date: { type: "string", description: "Local YYYY-MM-DD date" },
            start_time: { type: "string", description: "Local HH:mm start" },
            end_time: { type: "string", description: "Local HH:mm end" },
            overrides: { type: "object" },
          },
          additionalProperties: false,
        },
      },
      recurrence_rule: {
        type: "object",
        properties: {
          preset: {
            type: "string",
            enum: [
              "daily",
              "weekly",
              "biweekly",
              "monthly_dom",
              "monthly_dow",
            ],
          },
          byDay: {
            type: "string",
            enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
          },
          byMonthDay: { type: "integer", minimum: 1, maximum: 28 },
          bySetPos: { type: "integer", enum: [1, 2, 3, 4, -1] },
          termination: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["count", "until"] },
              count: { type: "integer", minimum: 1, maximum: 52 },
              until: {
                type: "string",
                description: "Final local YYYY-MM-DD date",
              },
            },
            required: ["kind"],
            additionalProperties: false,
          },
        },
        required: ["preset", "termination"],
        additionalProperties: false,
      },
      description: {
        type: "string",
        description: "Optional event description (<=2000 chars)",
      },
      location_text: {
        type: "string",
        description: "Optional venue name or address (<=200 chars)",
      },
      is_online: {
        type: "boolean",
        description: "True if the event is online-only",
      },
      online_url: { type: "string", description: "URL if is_online" },
      timezone: {
        type: "string",
        description: "IANA timezone (e.g., America/New_York). Defaults to UTC.",
      },
      visibility: {
        type: "string",
        enum: ["public", "unlisted", "private"],
        description:
          "Requested visibility stored in the private draft; the event remains draft-only until publish.",
      },
      city: { type: "string", description: "Event city" },
      currency: { type: "string", description: "Optional ISO 4217 currency" },
      party_types: { type: "array", items: { type: "string" } },
      vibe_tags: { type: "array", items: { type: "string" } },
      music_genres: { type: "array", items: { type: "string" } },
      tickets: {
        type: "array",
        items: { type: "object" },
        description: "Optional canonical ticket draft rows",
      },
    },
  },
  executor: async (args, client, _userId, context) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (!isString(args.title) || args.title.length > 120) {
      throw new ToolError("INVALID_ARGS", "title is required (1-120 chars)");
    }
    if (!["public", "unlisted", "private"].includes(String(args.visibility))) {
      throw new ToolError(
        "INVALID_ARGS",
        "visibility must be public, unlisted, or private",
      );
    }
    const whenMode = args.when_mode;
    if (!["single", "multi_date", "recurring"].includes(String(whenMode))) {
      throw new ToolError(
        "INVALID_ARGS",
        "when_mode must be single, multi_date, or recurring",
      );
    }
    if (whenMode === "multi_date") {
      if (
        !Array.isArray(args.multi_dates) || args.multi_dates.length < 2 ||
        args.multi_dates.length > 24
      ) {
        throw new ToolError(
          "INVALID_ARGS",
          "multi_dates must contain 2-24 dated occurrences",
        );
      }
    } else {
      if (!isString(args.start_at)) {
        throw new ToolError(
          "INVALID_ARGS",
          "start_at is required for single and recurring events",
        );
      }
      const startDate = new Date(args.start_at);
      if (
        Number.isNaN(startDate.getTime()) ||
        startDate.getTime() < Date.now() - 60 * 1000
      ) {
        throw new ToolError(
          "INVALID_ARGS",
          "start_at must be a valid future ISO datetime",
        );
      }
      if (
        whenMode === "recurring" &&
        (args.recurrence_rule === null ||
          typeof args.recurrence_rule !== "object")
      ) {
        throw new ToolError(
          "INVALID_ARGS",
          "recurrence_rule is required for recurring events",
        );
      }
    }
    const operationId = requireAgentOperationId(context);
    return await callRpc(client, "ari_execute_event_operation", {
      p_operation_id: operationId,
      p_tool_name: "create_event",
      p_args: args,
    });
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
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Max brands to return (1-50, default 20)",
      },
    },
  },
  executor: async (args, client, userId) => {
    const limit = typeof args.limit === "number"
      ? Math.min(50, Math.max(1, args.limit))
      : 20;
    const scope = await resolveAccessibleAgentBrands(client, userId).catch(
      (error) => {
        throw new ToolError(
          "TENANT_SCOPE_UNAVAILABLE",
          error instanceof Error ? error.message : "Brand scope unavailable",
        );
      },
    );
    return {
      brands: scope.slice(0, limit).map((
        { cover_media_url: _cover, effective_rank, ...brand },
      ) => ({ ...brand, effective_rank })),
    };
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
      brand_id: {
        type: "string",
        description: "Optional brand UUID to filter to one brand's events",
      },
      upcoming_only: {
        type: "boolean",
        description: "Default true — only show future events",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Max events to return (1-50, default 20)",
      },
    },
  },
  executor: async (args, client, userId) => {
    const limit = typeof args.limit === "number"
      ? Math.min(50, Math.max(1, args.limit))
      : 20;
    const scope = await resolveAccessibleAgentBrands(client, userId).catch(
      (error) => {
        throw new ToolError(
          "TENANT_SCOPE_UNAVAILABLE",
          error instanceof Error ? error.message : "Brand scope unavailable",
        );
      },
    );
    if (args.brand_id !== undefined && !isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (isUuid(args.brand_id)) {
      await assertAgentReadBrand(client, userId, args.brand_id);
    }
    const allowedBrandIds = isUuid(args.brand_id)
      ? [args.brand_id]
      : scope.map((brand) => brand.id);
    if (allowedBrandIds.length === 0) return { events: [] };
    const events = await callRpc(client, "business_list_events_for_ari", {
      p_brand_ids: allowedBrandIds,
      p_limit: limit,
      p_upcoming_only: args.upcoming_only !== false,
    });
    return { events: Array.isArray(events) ? events : [] };
  },
};

// ----------------------------------------------------------------------------
// 5. update_event
// ----------------------------------------------------------------------------

// issue #2009 (BINDING SPEC AMENDMENT 3A, Defect 1) — Ari's visibility write.
//
// The #2009 migration installs a BEFORE UPDATE OF visibility guard on `events`
// that refuses any write arriving as role `authenticated` or `anon` on an
// `event_type = 'event'` row. Ari runs caller-JWT-only (I-ARI-USER-JWT-ONLY),
// so its previous `.from("events").update({ visibility })` became
// `event_visibility_direct_update_blocked`. Amendment 1 §B is the sanctioned
// fix: route through the narrow RPC, which owns authorization, value mapping,
// stale handling, Private readiness, side effects, audit and the bounded echo.
//
// Ari still uses the CALLER's JWT — never a service-role client. The RPC is
// SECURITY DEFINER and does its own `auth.uid()` + brand-rank authorization, so
// escalating here would both break I-ARI-USER-JWT-ONLY and defeat that check.

/** The three Business labels `business_set_event_visibility` accepts. */
const ISSUE_2009_RPC_VISIBILITIES = new Set(["public", "unlisted", "private"]);

/**
 * Fixed bounded reason (Amendment 1 §B.6). The RPC requires 10..200 chars; this
 * is 64. It is deliberately NOT templated from model output — the reason lands
 * in an append-only audit row.
 */
const ISSUE_2009_ARI_EDIT_REASON =
  "Visibility changed through Ari after explicit user confirmation.";

/**
 * The RPC's stable codes mapped to the SAME honest copy the manual Business
 * editor shows (Amendment 1 §B.8). Ordered most-specific-first. Nothing here is
 * swallowed: an unmapped failure surfaces its real message under
 * VISIBILITY_WRITE_FAILED.
 */
const ISSUE_2009_VISIBILITY_COPY: Record<string, string> = {
  private_visibility_unavailable:
    "Private events are not ready to accept invited guests yet. Choose Public or Unlisted for now.",
  event_visibility_direct_update_blocked:
    "That visibility change did not go through the approved path, so nothing was changed.",
  event_visibility_effect_missing:
    "The visibility change could not be completed safely, so nothing was changed. Try again.",
  stale_event_visibility:
    "This event changed after Ari proposed the update, so nothing was changed. Ask again to see the current setting.",
  event_not_editable:
    "This event's visibility cannot be changed right now. Nothing was changed.",
  event_not_found: "That event is unavailable. Nothing was changed.",
  not_authenticated: "Sign in again to change this event's visibility.",
  invalid_edit_reason:
    "That visibility change was rejected. Nothing was changed.",
  invalid_visibility: "Choose Public or Unlisted.",
};

interface Issue2009VisibilityTarget {
  id: string;
  brand_id: string;
  title: string | null;
  event_type: string | null;
  status: string | null;
  visibility: string | null;
  updated_at: string | null;
}

interface Issue2009VisibilityEcho {
  eventId: string;
  requestedVisibility: string;
  storedVisibility: string;
  previousStoredVisibility: string;
  updatedAt: string;
  changed: boolean;
  revokedShareCount: number;
}

/**
 * Read the authoritative row under the CALLER's JWT before deciding anything.
 * `updated_at` read here is the optimistic-concurrency pin handed to the RPC.
 */
async function loadIssue2009VisibilityTarget(
  client: SupabaseClient,
  eventId: string,
): Promise<Issue2009VisibilityTarget> {
  const { data, error } = await client
    .from("events")
    .select("id, brand_id, title, event_type, status, visibility, updated_at")
    .eq("id", eventId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new ToolError("RESOURCE_CHECK_FAILED", error.message);
  if (!data) {
    throw new ToolError("BRAND_ACCESS_DENIED", "That resource is unavailable");
  }
  return data as unknown as Issue2009VisibilityTarget;
}

/**
 * issue #2009 (pass-1 TEST REPORT P2-2) — the exit-leg sentence.
 *
 * The RPC raises `private_visibility_unavailable` for BOTH legs: entering
 * Private, and leaving an event that is already Private. The map above holds
 * the entering sentence, approved verbatim and unchanged. Telling someone who
 * asked Ari to make a Private event Public to "Choose Public or Unlisted for
 * now" is advice they have already followed, so the exit leg gets its own.
 */
const ISSUE_2009_PRIVATE_EXIT_COPY =
  "This event is Private, and it can't be moved out of Private yet. Nothing was changed. Contact support and they'll switch it to Public or Unlisted.";

/**
 * Map a PostgREST failure onto the stable #2009 code. Never swallow it.
 *
 * `previousVisibility` is the value the authoritative row was READ at before
 * the RPC ran; it is the only thing that distinguishes the two legs of the
 * Private boundary, because the code is identical on both.
 */
function issue2009VisibilityToolError(
  error: unknown,
  previousVisibility?: string | null,
): ToolError {
  // [[postgrest_errors_are_not_error_instances]] — a PostgREST failure arrives
  // as a PLAIN OBJECT, not an Error, so read `.message` off the shape itself.
  const raw =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? (error as { message: string }).message
      : "";
  for (const [code, copy] of Object.entries(ISSUE_2009_VISIBILITY_COPY)) {
    if (!raw.includes(code)) continue;
    const directed = code === "private_visibility_unavailable" &&
        previousVisibility === "private"
      ? ISSUE_2009_PRIVATE_EXIT_COPY
      : copy;
    return new ToolError(code.toUpperCase(), directed);
  }
  return new ToolError(
    "VISIBILITY_WRITE_FAILED",
    raw || "The visibility change failed. Nothing was changed.",
  );
}

/**
 * The ONLY visibility write path for a standard ticketed event. Caller JWT in,
 * bounded echo out, echo verified before success is reported.
 */
async function setIssue2009EventVisibility(
  client: SupabaseClient,
  target: Issue2009VisibilityTarget,
  requested: string,
): Promise<unknown> {
  const { data, error } = await client.rpc("business_set_event_visibility", {
    p_event_id: target.id,
    p_requested_visibility: requested,
    p_reason: ISSUE_2009_ARI_EDIT_REASON,
    p_expected_updated_at: target.updated_at,
  });
  if (error) throw issue2009VisibilityToolError(error, target.visibility);

  // Amendment 1 §B.6 — verify the bounded echo BEFORE reporting success. An
  // echo for another event, or one that did not land on the value we asked
  // for, is a failure; Ari never claims a save it cannot confirm.
  const echo = data as Issue2009VisibilityEcho | null;
  const expectedStored = requested === "unlisted" ? "hidden" : requested;
  if (
    !echo ||
    echo.eventId !== target.id ||
    echo.storedVisibility !== expectedStored
  ) {
    throw new ToolError(
      "VISIBILITY_ECHO_MISMATCH",
      "The visibility change could not be confirmed, so nothing is reported as saved. Check the event and try again.",
    );
  }

  return {
    event: {
      id: target.id,
      brand_id: target.brand_id,
      title: target.title,
      visibility: echo.storedVisibility,
      status: target.status,
      updated_at: echo.updatedAt,
    },
    visibility: {
      requested: echo.requestedVisibility,
      stored: echo.storedVisibility,
      previousStored: echo.previousStoredVisibility,
      changed: echo.changed,
      revokedShareCount: echo.revokedShareCount,
    },
  };
}

// Legacy append-only source-test marker: const updateEvent: AgentTool = {
const updateEvent: AgentToolDefinition = {
  name: "update_event",
  description:
    "Modify fields on an event owned by the user. Only the provided fields are updated.",
  parameters: {
    type: "object",
    // issue #1972 requires the next server revision for a field edit, but it is
    // enforced in the EXECUTOR rather than here: the issue #2009 visibility leg
    // is a separate action that carries its own optimistic-concurrency pin
    // (`p_expected_updated_at`) and must stay reachable without a revision.
    required: ["event_id"],
    properties: {
      event_id: { type: "string", description: "UUID of the event to update" },
      title: { type: "string", description: "New event title (1-120 chars)" },
      start_at: { type: "string", description: "New ISO 8601 start datetime" },
      description: {
        type: "string",
        description: "New description (<=2000 chars)",
      },
      location_text: {
        type: "string",
        description: "New venue/location (<=200 chars)",
      },
      is_online: { type: "boolean" },
      online_url: { type: "string" },
      // issue #2009 + #1931 — `private` is NOT offerable: the database refuses
      // the Private boundary for EVERY writer until #2144, so advertising it
      // would be a dead tap. `draft` stays only as the idempotent no-op the
      // routing block below recognises.
      visibility: { type: "string", enum: ["draft", "public", "unlisted"] },
      end_at: { type: "string", description: "Optional ISO 8601 end datetime" },
      timezone: { type: "string", description: "IANA timezone for the event" },
      client_revision: { type: "integer", minimum: 0 },
      reason: {
        type: "string",
        description:
          "Required 10–200 character reason when editing a scheduled or live event",
      },
    },
  },
  executor: async (args, client, _userId, context) => {
    if (!isUuid(args.event_id)) {
      throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
    }

    // ---- issue #1972 — the typed fields this tool may change ---------------
    // `status` is deliberately absent: lifecycle changes have dedicated,
    // guarded operations (publish / unpublish / cancel / end_sales), and the
    // raw `events.status` write this tool used to expose was the #1972 Pass-4
    // finding 2 defect. `visibility` is absent for the same reason in reverse —
    // issue #2009 made `business_set_event_visibility` its sole authority, so
    // it is routed below rather than carried in the canonical patch.
    const mutableKeys = [
      "title",
      "start_at",
      "end_at",
      "description",
      "location_text",
      "is_online",
      "online_url",
      "timezone",
    ];
    const residualKeys = mutableKeys.filter((key) => args[key] !== undefined);

    // ---- issue #2009 (Amendment 3A, Defect 1) — visibility routing ---------
    // Everything below happens BEFORE any write, so a mixed call cannot
    // partially execute: either the narrow visibility RPC runs, or the #1972
    // canonical dispatcher runs, or the call is refused having written nothing.
    const requestedVisibility = isString(args.visibility)
      ? args.visibility.trim().toLowerCase()
      : null;
    let visibilityWasIdempotentDraft = false;

    if (requestedVisibility !== null) {
      const target = await loadIssue2009VisibilityTarget(client, args.event_id);

      if (target.event_type !== "event") {
        // RSVP, trips and experiences are outside #2009 (SC-22) and outside
        // #1972, whose canonical dispatcher is standard-event only. #1972 bound
        // this tool to `event_type='event'` in EVENT_TYPE_BY_TOOL, so
        // `authorizeAgentTool` has ALREADY denied a non-'event' offering before
        // this executor ran. This is the fail-closed second wall, deliberately
        // NOT the pre-#2009 direct column write: those offering classes keep
        // their own owners (`biz_update_live_rsvp` and friends), and none of
        // them is this tool.
        throw new ToolError(
          "BRAND_ACCESS_DENIED",
          "That brand or resource is unavailable",
        );
      } else if (requestedVisibility === "draft") {
        // Amendment 1 §B.4 — literal `draft` is accepted ONLY as an idempotent
        // field on an event that is already a draft, and is then omitted from
        // the sparse update. Ari cannot unpublish through visibility; that is
        // `unpublish_event`, whose contract #2009 does not touch.
        if (target.visibility !== "draft") {
          throw new ToolError(
            "VISIBILITY_DRAFT_REQUIRES_UNPUBLISH",
            "Ari cannot move a published event back to draft by changing visibility. Ask to unpublish it instead. Nothing was changed.",
          );
        }
        visibilityWasIdempotentDraft = true;
      } else if (ISSUE_2009_RPC_VISIBILITIES.has(requestedVisibility)) {
        // Amendment 1 §B.3 — a visibility proposal is a SEPARATE action.
        // Refused before every write; no partial direct update, no partial
        // canonical dispatch, no success. `residualKeys` is a superset of the
        // sparse `updates` keys this replaced (it also covers start_at, end_at
        // and timezone), so it refuses strictly MORE mixed calls than before.
        if (residualKeys.length > 0) {
          throw new ToolError(
            "VISIBILITY_CHANGE_MUST_BE_SEPARATE",
            "Ask Ari to change visibility separately from other event edits. Nothing was changed.",
          );
        }
        return await setIssue2009EventVisibility(
          client,
          target,
          requestedVisibility,
        );
      } else {
        throw new ToolError("INVALID_VISIBILITY", "Choose Public or Unlisted.");
      }
    }

    if (residualKeys.length === 0) {
      if (visibilityWasIdempotentDraft) {
        // Nothing to write, and nothing failed — report the authoritative row.
        const target = await loadIssue2009VisibilityTarget(
          client,
          args.event_id,
        );
        return {
          event: {
            id: target.id,
            brand_id: target.brand_id,
            title: target.title,
            visibility: target.visibility,
            status: target.status,
            updated_at: target.updated_at,
          },
        };
      }
      throw new ToolError("INVALID_ARGS", "No fields provided to update");
    }

    // ---- issue #1972 — one exactly-once canonical owner for standard events -
    // Optimistic concurrency is mandatory here. The #2009 visibility leg above
    // needs no `client_revision` because it carries its OWN pin
    // (`p_expected_updated_at`) into `business_set_event_visibility`.
    if (
      !Number.isInteger(args.client_revision) ||
      Number(args.client_revision) < 1
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "client_revision must be the next server revision",
      );
    }
    const operationId = requireAgentOperationId(context);
    return await callRpc(client, "ari_execute_event_operation", {
      p_operation_id: operationId,
      p_tool_name: "update_event",
      p_args: args,
    });
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
      name: {
        type: "string",
        description: "New public-facing brand name (1-80 chars)",
      },
      description: {
        type: "string",
        description: "New short description (<=500 chars)",
      },
      contact_email: { type: "string", description: "New brand contact email" },
      default_currency: {
        type: "string",
        description: "New 3-letter ISO currency code",
      },
      cover_media_url: {
        type: "string",
        description:
          "Cover media URL — set by the Add cover picker, NOT by you.",
      },
      cover_media_type: {
        type: "string",
        enum: ["image", "gif", "video"],
        description:
          "Cover media type, set by the picker alongside cover_media_url.",
      },
      cover_media_poster_url: {
        type: "string",
        description:
          "Stable cover still — set by the Add cover picker alongside GIF/video media.",
      },
    },
  },
  executor: async (args, client, _userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    // FK/ownership pre-check under the user JWT (RLS is the final wall).

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (
        !isString(args.name) || args.name.trim().length === 0 ||
        args.name.length > 80
      ) {
        throw new ToolError("INVALID_ARGS", "name must be 1-80 chars");
      }
      updates.name = args.name.trim();
    }
    if (args.description !== undefined) {
      if (
        typeof args.description !== "string" || args.description.length > 500
      ) {
        throw new ToolError("INVALID_ARGS", "description must be <=500 chars");
      }
      // Q3: brands.description is a single physical column; the app splits it
      // into tagline+bio via double-newline (splitBrandDescription). A single
      // Ari description writes the SAME column the wizard's bio field persists
      // (a one-part description splits to `bio`), so Ari + wizard edits are
      // interchangeable. We write brands.description directly.
      updates.description = args.description.trim().length > 0
        ? args.description.trim()
        : null;
    }
    if (args.contact_email !== undefined) {
      if (!isString(args.contact_email)) {
        throw new ToolError(
          "INVALID_ARGS",
          "contact_email must be a non-empty string",
        );
      }
      updates.contact_email = args.contact_email.trim();
    }
    if (args.default_currency !== undefined) {
      if (
        !isString(args.default_currency) ||
        args.default_currency.trim().length < 3
      ) {
        throw new ToolError(
          "INVALID_ARGS",
          "default_currency must be a 3-letter ISO code",
        );
      }
      updates.default_currency = args.default_currency.toUpperCase().slice(
        0,
        3,
      );
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
      .select(
        "id, name, slug, default_currency, cover_media_url, cover_media_poster_url, cover_media_type, updated_at",
      )
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
        `This brand has ${count} upcoming or live event${
          count === 1 ? "" : "s"
        }. Cancel or transfer them before deleting.`,
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
        console.warn(
          "[delete_brand] clear default_brand_id failed:",
          clearErr.message,
        );
      }
    } catch (e) {
      console.warn(
        "[delete_brand] clear default_brand_id threw:",
        (e as Error)?.message ?? e,
      );
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
      brand_id: {
        type: "string",
        format: "uuid",
        description: "UUID of the venue brand",
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        description: "Experience title (1-120 chars)",
      },
      narrative: {
        type: "string",
        minLength: 1,
        maxLength: 500,
        description: "Experience description (1-500 chars)",
      },
      suggested_price_min_cents: {
        type: "integer",
        description: "Optional minimum price in cents",
      },
      suggested_price_max_cents: {
        type: "integer",
        description: "Optional maximum price in cents",
      },
      currency: { type: "string", description: "3-letter ISO currency code" },
      intent_tags: {
        type: "array",
        items: { type: "string" },
        description: "Intent tags (restaurant or Play vocabulary)",
      },
      capacity_min: {
        type: "integer",
        description: "Play: minimum group size",
      },
      capacity_max: {
        type: "integer",
        description: "Play: maximum group size",
      },
      suggested_time_of_day: {
        type: "string",
        description: "Play: e.g. Friday evening",
      },
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
            name: {
              type: "string",
              maxLength: 120,
              description: "Stop / item name (1-120 chars)",
            },
            place_name: { type: "string", maxLength: 120 },
            description: {
              type: "string",
              maxLength: 280,
              description: "Optional one-line blurb (≤280)",
            },
            ai_description: { type: "string", maxLength: 280 },
            price_cents: {
              type: "integer",
              minimum: 0,
              description: "Printed price in cents (null → 0)",
            },
            address: { type: "string" },
            city: { type: "string" },
            region: { type: "string" },
            country_code: { type: "string" },
            place_id: { type: "string" },
            lat: { type: "number" },
            lng: { type: "number" },
            coordinate_precision: {
              type: "string",
              enum: ["exact", "approximate"],
            },
            start_time: { type: "string" },
            image_urls: {
              type: "array",
              maxItems: 5,
              items: { type: "string" },
            },
          },
        },
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
  executor: async (args, client, _userId, context) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    if (!isString(args.title) || args.title.length > 120) {
      throw new ToolError("INVALID_ARGS", "title is required (1-120 chars)");
    }
    if (!isString(args.narrative) || args.narrative.length > 500) {
      throw new ToolError(
        "INVALID_ARGS",
        "narrative is required (1-2000 chars)",
      );
    }
    const { data, error } = await client.rpc(
      "ari_execute_experience_operation",
      {
        p_operation_id: requireAgentOperationId(context),
        p_tool_name: "create_experience",
        p_args: args,
      },
    );
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
