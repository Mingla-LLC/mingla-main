// #2830 / #2829 W9b — Ari's closed Mingla Sites tool surface: Ari as the
// website designer.
//
// Every call uses the caller-scoped Supabase client. Core re-derives the
// user's effective rank and site/brand binding before signing any CMS request.
//
// Schemas are GENERATED from packages/site-contracts (ariToolSchemas.ts):
// the block catalogue, every design's layouts, the token model and the font
// slots — so Ari can never offer a block, layout, field or colour the runtime
// would refuse (this replaced a hand-written 8-block union, a menu-order
// maximum of 4 and a two-value typography enum that had drifted from the
// runtime).
//
// Every write is a typed PROPOSAL the owner confirms on a card (the existing
// pending-action confirmation); it is revision-checked, it carries a work-log
// entry ("why" + at least one citation), and it changes only the DRAFT.
// Publishing and restoring need rank >= 50 and their own separate
// confirmation. No tool can mark a review as real except the confirm-real
// card, which only brand admins and owners can confirm.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AgentToolDefinition } from "./agentToolHelpers.ts";
import {
  isUuid,
  requireAgentOperationId,
  ToolError,
} from "./agentToolHelpers.ts";
import { assertAgentReadBrand } from "./agentTenantScope.ts";
import {
  SITES_SAFE_CUSTOMER_CODES,
  type SitesSafeCustomerCode,
} from "./sitesContracts.ts";
import {
  ariBlockCatalog,
  ariBlockProblems,
  blocksSchema,
  fontChoicesSchema,
  MAX_WORK_LOG_DECISION,
  tokenOverridesSchema,
  workLogCitesProblem,
  workLogCitesSchema,
} from "./siteContracts/ariToolSchemas.ts";
import {
  DESIGN_KEYS,
  DESIGNS,
  designFontSlots,
  designSwatches,
  type DesignKey,
} from "./siteContracts/designs.ts";
import { PLAN_OFFERING_KEYS } from "./siteContracts/sitePlan.ts";
import { MAX_NAV_ITEMS, MAX_NAV_LABEL_LENGTH, MAX_PAGE_TITLE_LENGTH } from "./siteContracts/limits.ts";

const UUID = { type: "string", format: "uuid" };
const REVISION = { type: "string", minLength: 1, maxLength: 200 };
const DIGEST = {
  type: "string",
  minLength: 64,
  maxLength: 64,
  description: "Lowercase SHA-256 digest from the validated draft receipt.",
};
const PAGE_PATH = {
  type: "string",
  maxLength: 200,
  description: 'The page\'s address as list_site_pages returns it ("" is the home page, "about", "resources/faqs"). Always send it.',
};
const DESIGN = { type: "string", enum: [...DESIGN_KEYS] };
const WHY = {
  type: "string",
  minLength: 1,
  maxLength: MAX_WORK_LOG_DECISION,
  description: "Why this change, in one or two plain sentences the owner will read under “Why it looks like this”.",
};
const CITES = workLogCitesSchema();
const plainText = (maxLength: number, description?: string) => ({
  type: "string",
  maxLength,
  ...(description ? { description } : {}),
});
const closedObject = (
  properties: Record<string, unknown>,
  required: string[] = [],
  description?: string,
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
  ...(description ? { description } : {}),
});

/** The confirm-real card's statement, word for word (§6 W9). */
export const REVIEW_CONFIRMATION_STATEMENT =
  "I confirm this review is real and I have permission to show it";

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  executor: AgentToolDefinition["executor"],
): AgentToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
    executor,
  };
}

function requiredIds(args: Record<string, unknown>): {
  brandId: string;
  siteId: string;
} {
  if (!isUuid(args.brand_id) || !isUuid(args.site_id)) {
    throw new ToolError("INVALID_ARGS", "brand_id and site_id must be UUIDs");
  }
  return { brandId: args.brand_id, siteId: args.site_id };
}

type SitesControlOutcome =
  | { kind: "ok"; data: unknown }
  | { kind: "refused"; code: string; status: number; message: string }
  | {
    kind: "unavailable";
    reason:
      | "fetch"
      | "relay"
      | "http_unrecognized"
      | "body_unrecognized"
      | "threw";
    status: number | null;
  };

const SITES_SAFE_CODE_SET = new Set<string>(SITES_SAFE_CUSTOMER_CODES);

// Copied verbatim from sitesFailure (sitesContracts.ts) so a refusal reaches
// Ari with the Sites service's own customer-safe wording, never echoed text.
const SITES_TOOL_MESSAGES: Record<SitesSafeCustomerCode, string> = {
  FORBIDDEN: "This Website action is not available for your role.",
  NOT_FOUND: "Website information is not available.",
  INVALID_STATE: "The website is not ready for that action.",
  VALIDATION_FAILED: "Review the highlighted Website fields and try again.",
  REVISION_CONFLICT: "The draft changed. Refresh it before trying again.",
  SESSION_EXPIRED: "This Mingla Studio session has expired.",
  OPERATION_IN_PROGRESS: "This Website operation is still working.",
  PUBLISH_FAILED_LAST_GOOD_PRESERVED:
    "Publishing failed. Your last verified website is still live.",
  MEDIA_REJECTED: "That image could not be accepted.",
  MEDIA_PROCESSING: "That image is still being prepared.",
  SERVICE_TEMPORARILY_UNAVAILABLE:
    "Website tools are temporarily unavailable. Please try again.",
  IDEMPOTENCY_CONFLICT: "That request was already used for another action.",
};

/*
 * #2829 W9b — the named refusals of the plan, content and designer routes.
 * brand-site-control writes each one's customer-safe sentence from its own
 * closed table (sitePlan.ts, siteContent.ts, siteAri.ts); Ari passes that
 * sentence and only bounded detail (which claims, which fields) on.
 */
/*
 * Each named refusal travels as an Ari envelope code every installed app
 * already knows (an unknown code reads as a broken connection — the #3645
 * precedent); the exact sentence and detail travel in the message, which is
 * what the owner and the model read.
 */
const SITES_NAMED_CODES: Readonly<Record<string, string>> = {
  // plan (sitePlan.ts)
  NOT_ENTITLED: "FORBIDDEN",
  PLAN_LOCKED: "CONFLICT",
  PLAN_NOT_READY: "DOMAIN_ACTION_REFUSED",
  PLAN_PAUSED: "DOMAIN_ACTION_REFUSED",
  NO_ADMIN: "DOMAIN_ACTION_REFUSED",
  // content (siteContent.ts)
  REVIEW_NOT_CONFIRMED: "VALIDATION_FAILED",
  TITLE_REQUIRED: "VALIDATION_FAILED",
  QUOTE_REQUIRED: "VALIDATION_FAILED",
  SLUG_TAKEN: "CONFLICT",
  SLUG_INVALID: "VALIDATION_FAILED",
  CATEGORY_IN_USE: "DOMAIN_ACTION_REFUSED",
  CONTENT_LIMIT_EXCEEDED: "DOMAIN_ACTION_REFUSED",
  OFFERING_NOT_FOUND: "VALIDATION_FAILED",
  TRIP_NOT_ENDED: "DOMAIN_ACTION_REFUSED",
  VIDEO_TOO_LONG: "VALIDATION_FAILED",
  // designer (siteAri.ts)
  CLAIM_NOT_BACKED: "VALIDATION_FAILED",
  CITATION_REQUIRED: "VALIDATION_FAILED",
  CITATION_INVALID: "VALIDATION_FAILED",
  VARIANT_NOT_IN_DESIGN: "VALIDATION_FAILED",
  MEDIA_NOT_FOUND: "VALIDATION_FAILED",
  MEDIA_WRONG_KIND: "VALIDATION_FAILED",
  OWNER_SOURCE_REQUIRED: "VALIDATION_FAILED",
  REVIEW_SOURCE_MISMATCH: "VALIDATION_FAILED",
  PAGE_NOT_FOUND: "VALIDATION_FAILED",
  PATH_COLLISION: "CONFLICT",
};

const SITE_SERVICE_UNAVAILABLE_MESSAGE =
  "Ari could not reach Website tools right now.";

function safeRefusal(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as {
    ok?: unknown;
    error?: { code?: unknown; message?: unknown; claims?: unknown; problems?: unknown; problem?: unknown; variants?: unknown; latest_revision?: unknown };
  };
  const code = candidate.error?.code;
  if (candidate.ok !== false || typeof code !== "string") return null;
  if (SITES_SAFE_CODE_SET.has(code)) {
    const detail = refusalDetail(candidate.error);
    return { code, message: `${SITES_TOOL_MESSAGES[code as SitesSafeCustomerCode]}${detail}` };
  }
  const envelope = Object.prototype.hasOwnProperty.call(SITES_NAMED_CODES, code) ? SITES_NAMED_CODES[code] : undefined;
  if (envelope && typeof candidate.error?.message === "string") {
    return { code: envelope, message: `${candidate.error.message.slice(0, 300)}${refusalDetail(candidate.error)}` };
  }
  return null;
}

/** Bounded detail Core passed (claims, fields, layouts, latest revision) for Ari to act on. */
function refusalDetail(error: Record<string, unknown> | undefined): string {
  if (!error) return "";
  const list = (value: unknown, max: number) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, max).map((item) => item.slice(0, 300)) : [];
  const parts = [
    ...list(error.claims, 12),
    ...list(error.problems, 12),
    ...(typeof error.problem === "string" ? [error.problem.slice(0, 300)] : []),
  ];
  const variants = list(error.variants, 20);
  if (variants.length) parts.push(`This design draws: ${variants.join(", ")}.`);
  if (typeof error.latest_revision === "string" && error.latest_revision) {
    parts.push(`Latest revision: ${error.latest_revision.slice(0, 200)}.`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function isResponseLike(
  value: unknown,
): value is { json: () => Promise<unknown>; status: number } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { json?: unknown; status?: unknown };
  return typeof candidate.json === "function" &&
    typeof candidate.status === "number";
}

/*
 * #3184 — why a non-2xx must be read through `error.context`.
 *
 * `functions.invoke` never throws and never reads the body of a non-2xx
 * response: it returns `{ data: null, error: FunctionsHttpError }` with the
 * unread Response on `error.context`. brand-site-control answers expected
 * refusals (404 NOT_FOUND for a brand with no website, 403, 409) with a safe
 * JSON body, so treating every `error` as an outage laundered each of them
 * into SITE_SERVICE_UNAVAILABLE and a 500. Only a fetch or relay failure, or
 * a non-2xx without a safe Sites body, is a real outage. Errors are matched by
 * `name`, not class identity, because esm.sh URLs do not share classes.
 */
async function readControl(
  client: SupabaseClient,
  input: Record<string, unknown>,
): Promise<SitesControlOutcome> {
  let outcome: SitesControlOutcome;
  try {
    const { data, error } = await client.functions.invoke(
      "brand-site-control",
      { body: input },
    );
    if (error) {
      const failure = error as { name?: unknown; context?: unknown };
      const context = failure.context;
      if (failure.name === "FunctionsHttpError" && isResponseLike(context)) {
        let body: unknown = null;
        try {
          body = await context.json();
        } catch {
          body = null;
        }
        const refusal = safeRefusal(body);
        const status = context.status;
        if (refusal) {
          outcome = { kind: "refused", code: refusal.code, message: refusal.message, status };
        } else {
          outcome = {
            kind: "unavailable",
            reason: "http_unrecognized",
            status,
          };
        }
      } else if (failure.name === "FunctionsRelayError") {
        const status = (context as { status?: unknown } | null | undefined)
          ?.status;
        outcome = {
          kind: "unavailable",
          reason: "relay",
          status: typeof status === "number" ? status : null,
        };
      } else {
        outcome = { kind: "unavailable", reason: "fetch", status: null };
      }
    } else {
      const response = data as { ok?: unknown; data?: unknown } | null;
      const refusal = safeRefusal(response);
      outcome = response?.ok === true
        ? { kind: "ok", data: response.data }
        : refusal
        ? { kind: "refused", code: refusal.code, message: refusal.message, status: 200 }
        : { kind: "unavailable", reason: "body_unrecognized", status: null };
    }
  } catch {
    outcome = { kind: "unavailable", reason: "threw", status: null };
  }
  if (outcome.kind === "unavailable") {
    console.warn(
      "[agentSiteTools] sites control unavailable",
      JSON.stringify({
        fn: "agentSiteTools",
        reason: outcome.reason,
        http_status: outcome.status,
      }),
    );
  }
  return outcome;
}

function settleControl(outcome: SitesControlOutcome): unknown {
  if (outcome.kind === "ok") return outcome.data;
  if (outcome.kind === "refused") {
    throw new ToolError(outcome.code, outcome.message);
  }
  throw new ToolError(
    "SITE_SERVICE_UNAVAILABLE",
    SITE_SERVICE_UNAVAILABLE_MESSAGE,
  );
}

/**
 * #3614 — which site does this brand actually have?
 *
 * Answered through the CALLER's client on purpose. `brand_sites` is
 * UNIQUE (brand_id) and carries exactly one read policy,
 * `biz_brand_effective_rank(brand_id, auth.uid()) >= 20` — the same floor
 * `brand_site_internal_authorize` enforces before it will address a site. So
 * this read grants nothing that the call it is disambiguating did not already
 * require, and a caller who may not see the row simply gets null.
 *
 * Never throws: it exists only to qualify a refusal that has already happened,
 * so an unreadable answer must leave that refusal exactly as it was rather than
 * replace it with a second, less honest one. The `catch` also covers a client
 * that has no PostgREST surface at all (the Sites suites exercise one).
 */
async function authoritativeSiteId(
  client: SupabaseClient,
  brandId: string,
): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("brand_sites")
      .select("id")
      .eq("brand_id", brandId)
      .limit(1);
    if (error) return null;
    const row = Array.isArray(data)
      ? (data[0] as { id?: unknown } | undefined)
      : (data as { id?: unknown } | null);
    const id = row?.id;
    return isUuid(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * #3614 — a Website refusal that is really a WRONG ADDRESS.
 *
 * Every Website tool asks the model for `site_id`. On 2026-09-28 the model
 * answered with the About PAGE's id: `get_site_page` returns a page as
 * `{ id, role, slug, … }` and `get_brand_site` returns the site as `{ id, … }`,
 * so both results carry a bare `id` and only one of them addresses a site.
 * brand-site-control loads the site with `SELECT … INTO STRICT`, so an id that
 * is not a site RAISES inside `brand_site_internal_authorize`, and that route
 * answers every error from that RPC with FORBIDDEN 403. The operator's
 * confirmed draft edit was therefore terminalized as
 * "This Website action is not available for your role" — for an operator whose
 * role was never in question — and every later turn in the same conversation
 * aborted, because the model kept re-reading the poisoned id out of the
 * history.
 *
 * A refusal Ari cannot substantiate must not be passed on. brand-site-control
 * returns 403 ONLY from its own pre-flight gates, before it signs anything for
 * the CMS (a refusal the CMS itself reported comes back as 409), so on a 403
 * nothing has happened yet and asking again costs nothing. If the brand's real
 * site is a DIFFERENT site, the refusal was about the address and not the role:
 * re-address the call ONCE and let brand-site-control authorize it again from
 * scratch, against the brand the operator confirmed on the card. If the brand's
 * site is the one we just addressed, or cannot be read, the refusal stands
 * verbatim — this never converts a real "no" into a yes.
 */
async function invokeSiteControl(
  client: SupabaseClient,
  brandId: string,
  siteId: string,
  build: (siteId: string) => Record<string, unknown>,
): Promise<unknown> {
  const outcome = await readControl(client, build(siteId));
  if (
    outcome.kind === "refused" && outcome.code === "FORBIDDEN" &&
    outcome.status === 403
  ) {
    const resolved = await authoritativeSiteId(client, brandId);
    if (resolved !== null && resolved !== siteId) {
      // Id-free on purpose (same rule as the outage monitor above).
      console.warn(
        "[agentSiteTools] sites address corrected",
        JSON.stringify({
          fn: "agentSiteTools",
          reason: "site_id_is_not_this_brands_site",
        }),
      );
      return settleControl(await readControl(client, build(resolved)));
    }
  }
  return settleControl(outcome);
}

async function cmsTool(
  name: string,
  args: Record<string, unknown>,
  client: SupabaseClient,
  operationId: string,
): Promise<unknown> {
  const { brandId, siteId } = requiredIds(args);
  return await invokeSiteControl(client, brandId, siteId, (id) => ({
    route: `/v1/sites/${id}/ari`,
    method: "POST",
    operation_id: operationId,
    action: name,
    brand_id: brandId,
    // The CMS reads the address out of `args` too, so a re-addressed call must
    // not carry the model's id in its payload.
    args: { ...args, site_id: id },
  }));
}

/** A designer write: the confirmed proposal goes to Studio with its work-log entry. */
function designerWrite(name: string): AgentToolDefinition["executor"] {
  return async (args, client, _userId, context) =>
    await cmsTool(name, args, client, requireAgentOperationId(context));
}

/**
 * #2829 W9b — records "websites are opening brand by brand" interest for
 * Mingla admins. Never throws: the honest answer stands whether or not the
 * record could be written (a failure is logged, id-free).
 */
async function recordSiteInterest(client: SupabaseClient, brandId: string): Promise<boolean> {
  const outcome = await readControl(client, {
    route: `/v1/brands/${brandId}/site-interest`,
    method: "POST",
  });
  if (outcome.kind !== "ok") {
    console.warn(
      "[agentSiteTools] site interest not recorded",
      JSON.stringify({ fn: "agentSiteTools", outcome: outcome.kind }),
    );
    return false;
  }
  return (outcome.data as { recorded?: unknown } | null)?.recorded === true;
}

const NOT_AVAILABLE_REPLY =
  "Websites are opening brand by brand, and this brand doesn’t have one yet. We’ve noted that you asked.";

const getBrandSite = tool(
  "get_brand_site",
  "Read one accessible brand's Mingla website: status, address and draft summary. When the brand has no website it returns website_state not_set_up (a brand admin or owner can have Ari create a draft with create_site_draft) or not_available (websites are opening brand by brand; the interest is recorded for Mingla). Never reveals a Website to ranks below marketing manager.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    }
    await assertAgentReadBrand(client, userId, args.brand_id);
    const brandId = args.brand_id;
    const site = await readControl(client, {
      route: `/v1/brands/${brandId}/site`,
      method: "GET",
    });
    if (site.kind === "ok") return site.data;
    if (site.kind === "unavailable") {
      throw new ToolError(
        "SITE_SERVICE_UNAVAILABLE",
        SITE_SERVICE_UNAVAILABLE_MESSAGE,
      );
    }
    if (site.code !== "NOT_FOUND") {
      throw new ToolError(site.code, site.message);
    }
    /*
     * #3184 — a brand with no website is a successful read, not an error.
     *
     * brand-site-control answers 404 NOT_FOUND when the brand has no
     * brand_sites row, which is the normal state for almost every brand.
     * Reporting it as a failure made every website question a 500. The
     * availability read decides which honest answer Ari gives: websites are
     * not available for this brand (interest recorded), or not set up yet (a
     * brand admin or owner can have Ari create the draft).
     *
     * The result never carries a top-level handoff_route or choices key:
     * agent-chat spreads a read result into the stored structured content,
     * replay lifts structured.handoff_route into the response, and the app
     * auto-navigates on it. The Website route is informational only and stays
     * nested under setup_screen.
     */
    const availability = await readControl(client, {
      route: `/v1/brands/${brandId}/site-availability`,
      method: "GET",
    });
    if (availability.kind === "unavailable") {
      throw new ToolError(
        "SITE_SERVICE_UNAVAILABLE",
        SITE_SERVICE_UNAVAILABLE_MESSAGE,
      );
    }
    if (availability.kind === "refused") {
      if (availability.code === "NOT_FOUND") {
        throw new ToolError(
          "SITE_SERVICE_UNAVAILABLE",
          SITE_SERVICE_UNAVAILABLE_MESSAGE,
        );
      }
      throw new ToolError(availability.code, availability.message);
    }
    const state = availability.data as
      | { available?: unknown; site?: unknown }
      | null;
    if (state?.available === false) {
      return {
        website_state: "not_available",
        brand_id: brandId,
        can_create_from_chat: false,
        reply: NOT_AVAILABLE_REPLY,
        interest_recorded: await recordSiteInterest(client, brandId),
        setup_role: null,
        setup_screen: null,
      };
    }
    if (state?.available === true && state.site === null) {
      return {
        website_state: "not_set_up",
        brand_id: brandId,
        can_create_from_chat: true,
        create_tool: "create_site_draft",
        setup_role: "brand_admin_or_owner",
        setup_screen: {
          name: "Website",
          location: "Brand profile → Website",
          route: `/brand/${brandId}/website`,
        },
      };
    }
    if (
      state?.available === true && state.site !== null &&
      typeof state.site === "object"
    ) {
      // The site appeared between the two reads; never fabricate its fields.
      throw new ToolError(
        "REVISION_CONFLICT",
        SITES_TOOL_MESSAGES.REVISION_CONFLICT,
      );
    }
    throw new ToolError(
      "SITE_SERVICE_UNAVAILABLE",
      SITE_SERVICE_UNAVAILABLE_MESSAGE,
    );
  },
);

const getSitePlan = tool(
  "get_site_plan",
  "Read the brand's website plan and complete field-level context audit: the eight parts, every missing/invalid/stale/conflicting/verified/not-applicable field with provenance, gap counts, the owner's answers, plan revision and who is working on it.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    await assertAgentReadBrand(client, userId, args.brand_id);
    return settleControl(await readControl(client, { route: `/v1/brands/${args.brand_id}/site-plan`, method: "GET" }));
  },
);

const startBrandCompletenessJob = tool(
  "start_brand_completeness_job",
  "Start or resume Ari's durable Fix all Website gaps job for this brand. Returns the current field audit plus completed and pending step keys. Reuse the returned job id for checkpoints; never repeat a completed write.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    }
    await assertAgentReadBrand(client, userId, args.brand_id);
    const { data, error } = await client.rpc(
      "ari_start_brand_completeness_job",
      { p_brand_id: args.brand_id },
    );
    if (error) {
      throw new ToolError(
        error.message.includes("not_authorized")
          ? "BRAND_ACCESS_DENIED"
          : "SITE_SERVICE_UNAVAILABLE",
        error.message.includes("not_authorized")
          ? "That brand is unavailable."
          : "Ari could not start the Website completion job right now.",
      );
    }
    return data;
  },
);

const listSiteDesigns = tool(
  "list_site_designs",
  "List the website designs Mingla offers: each one's key, name, description, the colour swatches it draws and its font slots.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    await assertAgentReadBrand(client, userId, args.brand_id);
    return DESIGN_KEYS.map((key) => {
      const design = DESIGNS[key];
      return {
        key,
        name: design.label,
        description: design.description,
        swatches: designSwatches(design).map((swatch) => ({ label: swatch.label, role: swatch.role, step: swatch.step ?? null })),
        font_slots: designFontSlots(design),
      };
    });
  },
);

const getBlockCatalog = tool(
  "get_block_catalog",
  "Read the block catalogue: every block type a page can carry, what it is for, its fields, and the layouts each design draws for it. Use these exact types, fields and layouts in propose_site_composition.",
  { brand_id: UUID, design: DESIGN },
  ["brand_id"],
  async (args, client, userId) => {
    if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    await assertAgentReadBrand(client, userId, args.brand_id);
    return ariBlockCatalog(typeof args.design === "string" ? args.design as DesignKey : undefined);
  },
);

const getSiteTokens = tool(
  "get_site_tokens",
  "Read the website's design, the owner's colours, shape, motion and fonts, and its readability warnings (each with a nearby passing shade to OFFER the owner; Mingla never changes colours itself). Returns the revision propose_site_tokens needs.",
  { brand_id: UUID, site_id: UUID },
  ["brand_id", "site_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await cmsTool("get_site_tokens", args, client, crypto.randomUUID());
  },
);

const runSiteDesignChecks = tool(
  "run_site_design_checks",
  "Run the six design checks on the current draft (words, photos, readability, links, truth, phone layout). Results are warnings in plain English; a site's first publish needs them run on the exact draft being published.",
  { brand_id: UUID, site_id: UUID },
  ["brand_id", "site_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await cmsTool("run_site_design_checks", args, client, crypto.randomUUID());
  },
);

const listSitePages = tool(
  "list_site_pages",
  "List every page of the website's draft with its address (page_path), kind, title, whether it is shown, and its revision.",
  { brand_id: UUID, site_id: UUID },
  ["brand_id", "site_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await cmsTool(
      "list_site_pages",
      args,
      client,
      crypto.randomUUID(),
    );
  },
);

const getSitePage = tool(
  "get_site_page",
  "Read one draft page (its blocks, layouts and revision) by its address.",
  { brand_id: UUID, site_id: UUID, page_path: PAGE_PATH },
  // page_path is checked by Studio, not listed as required: the home page's
  // address is "" and the shared required-argument check refuses "".
  ["brand_id", "site_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await cmsTool("get_site_page", args, client, crypto.randomUUID());
  },
);

const validateDraft = tool(
  "validate_site_draft",
  "Validate the current structured draft and return a safe readiness receipt (the draft digest Publish needs). Performs no publication.",
  { brand_id: UUID, site_id: UUID },
  ["brand_id", "site_id"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await cmsTool(
      "validate_site_draft",
      args,
      client,
      crypto.randomUUID(),
    );
  },
);

// ---------------------------------------------------------------------------
// Writes: typed proposals the owner confirms.
// ---------------------------------------------------------------------------

const PLAN_ANSWERS = closedObject({
  offerings_selected: {
    type: "array",
    maxItems: PLAN_OFFERING_KEYS.length,
    items: { type: "string", enum: [...PLAN_OFFERING_KEYS] },
    description: "What the brand offers (an empty list means nothing yet)",
  },
  venue_descriptor: plainText(60, "A short word for the venue, e.g. “bar”"),
  story: closedObject({
    who: plainText(300, "Who comes with you, in the owner's words"),
    why: plainText(300, "Why come with you, in the owner's words"),
    main_action: plainText(300, "What someone should do when they find you"),
  }),
});

const PLAN_DESIGN_EVIDENCE = {
  source_type: {
    type: "string",
    enum: ["mingla", "owner", "public_research", "imported"],
  },
  source_url: {
    type: "string",
    maxLength: 1000,
    description: "HTTPS source when the design recommendation came from public research.",
  },
};

const saveSitePlanDesign = tool(
  "save_site_plan_design",
  "Save Atelier or Voyage as the owner's pre-draft Website design choice against the plan revision. This does not create a draft. Changing it clears an older plan approval so the owner can review the changed plan.",
  {
    brand_id: UUID,
    expected_plan_revision: {
      type: "integer",
      minimum: 0,
      description: "The plan revision get_site_plan returned",
    },
    design_key: DESIGN,
    ...PLAN_DESIGN_EVIDENCE,
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "expected_plan_revision", "design_key", "why", "cites"],
  async (args, client, _userId, context) => {
    requireAgentOperationId(context);
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    }
    const saved = settleControl(await readControl(client, {
      route: `/v1/brands/${args.brand_id}/site-plan/design`,
      method: "POST",
      revision: args.expected_plan_revision,
      design_key: args.design_key,
      source_type: args.source_type ?? "owner",
      source_url: args.source_url ?? null,
    }));
    const logged = await logWorkIfSite(client, args.brand_id, {
      part: "plan",
      tool: "save_site_plan_design",
      why: args.why,
      cites: args.cites,
      target: "plan:design",
    });
    return { plan: saved, draft_created: false, work_log_saved: logged };
  },
);

const CONTEXT_PATCH = closedObject({
  name: plainText(80, "Public-facing brand name"),
  description: { type: "string", maxLength: 500, nullable: true },
  contact_email: { type: "string", maxLength: 254, nullable: true },
  contact_phone: {
    type: "string",
    nullable: true,
    pattern: "^\\+[1-9][0-9]{7,14}$",
    description: "Canonical E.164 phone. Ask for the country when it is unknown; never invent a dial code.",
  },
  address: { type: "string", maxLength: 240, nullable: true },
  city: { type: "string", maxLength: 120, nullable: true },
  country_code: {
    type: "string",
    nullable: true,
    pattern: "^[A-Z]{2}$",
  },
  social_links: {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: Object.fromEntries(
      ["website", "instagram", "tiktok", "x", "facebook", "youtube", "linkedin", "threads"]
        .map((key) => [key, { type: "string", maxLength: 500, pattern: "^https://" }]),
    ),
  },
  custom_links: {
    type: "array",
    nullable: true,
    maxItems: 10,
    items: closedObject(
      { label: plainText(80), url: { type: "string", maxLength: 1000, pattern: "^https://" } },
      ["label", "url"],
    ),
  },
  theme: {
    type: "object",
    nullable: true,
    additionalProperties: false,
    properties: {
      color: { type: "string", nullable: true, pattern: "^#[0-9a-fA-F]{6}$" },
      font: {
        type: "string",
        nullable: true,
        enum: [
          "inter", "poppins", "space_grotesk", "plus_jakarta_sans", "manrope",
          "playfair_display", "dm_serif_display", "fraunces", "lora",
          "bebas_neue", "anton", "unbounded", "caveat", "dancing_script",
        ],
      },
      animation: {
        type: "string",
        nullable: true,
        enum: [
          "none", "confetti", "fireworks", "balloons", "sparkles",
          "glitter_shower", "snowfall", "falling_petals", "hearts",
          "shimmer_reveal",
        ],
      },
    },
  },
});

const CONTEXT_EXCEPTION_FIELDS = [
  "venue_descriptor",
  "contact_email",
  "contact_phone",
  "address",
  "city_country",
  "social_links",
  "profile_photo",
  "cover_media",
  "theme",
] as const;

const updateBrandContext = tool(
  "update_brand_context",
  "Fill one confirmed bundle of Website brand-context fields or record explicit owner-approved not-applicable exceptions. Supports contact phone, links, address/city/country and Mingla theme in addition to identity. Logo and cover are human upload handoffs: do not invent media URLs. Always re-read get_site_plan after the confirmed write.",
  {
    brand_id: UUID,
    expected_plan_revision: {
      type: "integer",
      minimum: 0,
      description: "The plan revision get_site_plan returned",
    },
    patch: CONTEXT_PATCH,
    exceptions: {
      type: "array",
      maxItems: CONTEXT_EXCEPTION_FIELDS.length,
      items: closedObject({
        field_key: { type: "string", enum: [...CONTEXT_EXCEPTION_FIELDS] },
        reason: plainText(500, "The owner's reason this field does not apply"),
      }, ["field_key", "reason"]),
    },
    evidence: closedObject({
      source_type: {
        type: "string",
        enum: ["mingla", "owner", "public_research", "imported"],
      },
      source_ref: plainText(300, "Short source label or Mingla record id"),
      source_url: plainText(1000, "HTTPS public source URL"),
      observed_at: {
        type: "string",
        description: "ISO-8601 time when the source was checked",
      },
    }, ["source_type"]),
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "expected_plan_revision", "evidence", "why", "cites"],
  async (args, client, _userId, context) => {
    const operationId = requireAgentOperationId(context);
    if (!isUuid(args.brand_id) || !Number.isInteger(args.expected_plan_revision)) {
      throw new ToolError("INVALID_ARGS", "brand_id and expected_plan_revision are required");
    }
    const patch = args.patch && typeof args.patch === "object" && !Array.isArray(args.patch)
      ? args.patch
      : {};
    const exceptions = Array.isArray(args.exceptions) ? args.exceptions : [];
    if (Object.keys(patch as Record<string, unknown>).length === 0 && exceptions.length === 0) {
      throw new ToolError("INVALID_ARGS", "Provide a field change or an explicit exception");
    }
    const { data, error } = await client.rpc("ari_update_brand_context", {
      p_operation_id: operationId,
      p_brand_id: args.brand_id,
      p_expected_plan_revision: args.expected_plan_revision,
      p_patch: patch,
      p_exceptions: exceptions,
      p_evidence: args.evidence,
    });
    if (error) {
      const message = error.message ?? "Brand context update failed";
      if (message.includes("sites_revision_conflict")) {
        throw new ToolError("REVISION_CONFLICT", "The Website setup changed. Read get_site_plan again before proposing this update.");
      }
      if (message.includes("sites_plan_locked")) {
        throw new ToolError("REVISION_CONFLICT", "A teammate is editing the Website setup. Read the plan again before continuing.");
      }
      if (message.includes("forbidden")) {
        throw new ToolError("FORBIDDEN", "A brand admin or owner must confirm this brand-context change.");
      }
      throw new ToolError("SITE_SERVICE_UNAVAILABLE", "Ari could not save that Website detail right now.");
    }
    const logged = await logWorkIfSite(client, args.brand_id, {
      part: "brand_context",
      tool: "update_brand_context",
      why: args.why,
      cites: args.cites,
      target: "brand",
    });
    return { ...(data as Record<string, unknown>), work_log_saved: logged };
  },
);

const saveSitePlanAnswers = tool(
  "save_site_plan_answers",
  "Save the owner's answers to the website plan (what they offer, the venue word, and the three story answers, in their own words) against the plan's revision. Brand admins and owners only. Never approves the plan; the owner approves it themselves.",
  {
    brand_id: UUID,
    expected_plan_revision: { type: "integer", minimum: 0, description: "The plan revision get_site_plan returned" },
    answers: PLAN_ANSWERS,
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "expected_plan_revision", "answers", "why", "cites"],
  async (args, client, _userId, context) => {
    requireAgentOperationId(context);
    if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    const saved = settleControl(await readControl(client, {
      route: `/v1/brands/${args.brand_id}/site-plan`,
      method: "POST",
      revision: args.expected_plan_revision,
      patch: args.answers,
    }));
    const logged = await logWorkIfSite(client, args.brand_id, { part: "plan", tool: "save_site_plan_answers", why: args.why, cites: args.cites, target: "plan" });
    return { plan: saved, draft_only: true, work_log_saved: logged };
  },
);

/** The work log for a change Core itself made (plan, first draft, trip guide), once the brand has a site. */
async function logWorkIfSite(
  client: SupabaseClient,
  brandId: string,
  entry: { part: string; tool: string; why: unknown; cites: unknown; target: string; revision?: string | null },
): Promise<boolean> {
  const siteId = await authoritativeSiteId(client, brandId);
  if (!siteId) return false;
  const outcome = await readControl(client, {
    route: `/v1/sites/${siteId}/ari`,
    method: "POST",
    operation_id: crypto.randomUUID(),
    action: "log_work",
    brand_id: brandId,
    args: { part: entry.part, tool: entry.tool, why: entry.why, cites: entry.cites, target: entry.target, revision: entry.revision ?? null },
  });
  if (outcome.kind !== "ok") {
    console.warn("[agentSiteTools] work log not saved", JSON.stringify({ fn: "agentSiteTools", tool: entry.tool, outcome: outcome.kind }));
    return false;
  }
  return true;
}

const SITE_READY_WINDOW_MS = 20_000;

const createSiteDraft = tool(
  "create_site_draft",
  "Create the brand's website draft from its approved plan: Mingla gives it its address, then builds the pages (Home, one page per offering, About, Contact) from the brand's own words and the owner's answers, in the chosen design. Never publishes. Brand admins and owners only; for a brand without Mingla websites it gives the honest answer instead and records the interest.",
  { brand_id: UUID, why: WHY, cites: CITES },
  ["brand_id", "why", "cites"],
  async (args, client, _userId, context) => {
    const operationId = requireAgentOperationId(context);
    if (!isUuid(args.brand_id)) throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    const brandId = args.brand_id;
    const availability = await readControl(client, { route: `/v1/brands/${brandId}/site-availability`, method: "GET" });
    const state = settleControl(availability) as { available?: unknown; site?: unknown } | null;
    if (state?.available === false) {
      return { website_state: "not_available", reply: NOT_AVAILABLE_REPLY, interest_recorded: await recordSiteInterest(client, brandId) };
    }
    let site = await readControl(client, { route: `/v1/brands/${brandId}/site`, method: "GET" });
    if (site.kind === "refused" && site.code === "NOT_FOUND") {
      settleControl(await readControl(client, { route: `/v1/brands/${brandId}/site`, method: "POST", operation_id: operationId }));
      site = await readControl(client, { route: `/v1/brands/${brandId}/site`, method: "GET" });
    }
    const started = Date.now();
    let row = settleControl(site) as { id?: unknown; status?: unknown } | null;
    while (row && row.status === "provisioning" && Date.now() - started < SITE_READY_WINDOW_MS) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      row = settleControl(await readControl(client, { route: `/v1/brands/${brandId}/site`, method: "GET" })) as typeof row;
    }
    if (!row || !isUuid(row.id)) throw new ToolError("SITE_SERVICE_UNAVAILABLE", SITE_SERVICE_UNAVAILABLE_MESSAGE);
    if (row.status === "provisioning") throw new ToolError("OPERATION_IN_PROGRESS", "The website draft is still being set up. Try again in a minute.");
    const composed = settleControl(await readControl(client, {
      route: `/v1/brands/${brandId}/site/compose-from-plan`,
      method: "POST",
      operation_id: crypto.randomUUID(),
    })) as { pages?: unknown; site_id?: unknown };
    const logged = await logWorkIfSite(client, brandId, { part: "draft", tool: "create_site_draft", why: args.why, cites: args.cites, target: "site" });
    return { website_state: "draft", site_id: row.id, pages: composed?.pages ?? [], draft_only: true, work_log_saved: logged };
  },
);

const proposeSiteComposition = tool(
  "propose_site_composition",
  "Propose a whole-site change in one go, applied all together or not at all: new blocks (with layouts) for existing pages, new pages, and the menu (labels and order; Home is the logo). Every block must use the catalogue's types, fields and the site's design layouts; pictures are approved media ids. Text may not state numbers, prices, dates or superlatives Mingla can't back. Draft only.",
  {
    brand_id: UUID,
    site_id: UUID,
    expected_site_revision: { ...DIGEST, description: "The draft digest from validate_site_draft (the whole draft's revision)" },
    pages: {
      type: "array",
      maxItems: 20,
      description: "Existing pages whose blocks are replaced",
      items: closedObject({
        page_path: PAGE_PATH,
        title: plainText(MAX_PAGE_TITLE_LENGTH),
        blocks: { type: "array", maxItems: 60, items: blocksSchema() },
      }, ["page_path", "blocks"]),
    },
    new_pages: {
      type: "array",
      maxItems: 10,
      items: closedObject({
        slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 60 },
        title: plainText(MAX_PAGE_TITLE_LENGTH),
        parent_path: PAGE_PATH,
        blocks: { type: "array", maxItems: 60, items: blocksSchema() },
      }, ["slug", "title", "blocks"]),
    },
    menu: {
      type: "array",
      maxItems: MAX_NAV_ITEMS,
      description: "The header menu, in order (labels and pages). Links to other websites and “More” groups stay as they are.",
      items: closedObject({ page_path: PAGE_PATH, label: plainText(MAX_NAV_LABEL_LENGTH) }, ["page_path", "label"]),
    },
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "site_id", "expected_site_revision", "why", "cites"],
  designerWrite("propose_site_composition"),
);

const proposeBlockVariant = tool(
  "propose_block_variant",
  "Propose a different layout (variant) for one block on one page; the layout must be one the site's design draws for that block type. Draft only.",
  {
    brand_id: UUID,
    site_id: UUID,
    page_path: PAGE_PATH,
    expected_revision: REVISION,
    block_index: { type: "integer", minimum: 0, maximum: 59 },
    variant: { type: "string", maxLength: 40 },
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "site_id", "expected_revision", "block_index", "variant", "why", "cites"],
  designerWrite("propose_block_variant"),
);

const proposeSiteTokens = tool(
  "propose_site_tokens",
  "Propose the website's look: the design, exact colours (#rrggbb), shape, motion, heading case and Google fonts per slot. Stored exactly as proposed; the reply lists any readability warnings for the owner to decide on. Mingla never adjusts colours. Draft only.",
  {
    brand_id: UUID,
    site_id: UUID,
    expected_revision: { ...REVISION, description: "The revision get_site_tokens returned" },
    design: DESIGN,
    tokens: tokenOverridesSchema(),
    fonts: fontChoicesSchema(),
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "site_id", "expected_revision", "why", "cites"],
  designerWrite("propose_site_tokens"),
);

const proposeSiteCopy = tool(
  "propose_site_copy",
  "Propose new words for text fields on one page (block text fields, list item text, the page title). Refused when it states a number, price, date or superlative that isn't backed by the brand's Mingla offerings, the brand's own words, or the owner's words cited here. Draft only.",
  {
    brand_id: UUID,
    site_id: UUID,
    page_path: PAGE_PATH,
    expected_revision: REVISION,
    title: plainText(MAX_PAGE_TITLE_LENGTH),
    edits: {
      type: "array",
      maxItems: 40,
      items: closedObject({
        block_index: { type: "integer", minimum: 0, maximum: 59 },
        field: { type: "string", maxLength: 60, description: "A text field of that block (or of the list item)" },
        list: { type: "string", maxLength: 60, description: "For text inside a list (e.g. ctas, items, cards): the list's field name" },
        item_index: { type: "integer", minimum: 0, maximum: 119 },
        value: plainText(5000),
      }, ["block_index", "field", "value"]),
    },
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "site_id", "expected_revision", "why", "cites"],
  designerWrite("propose_site_copy"),
);

const proposeSiteImagery = tool(
  "propose_site_imagery",
  "Propose the owner's approved photos and videos for picture spots on one page: a block's picture, a film's poster, a hero or brand-film video (hero videos up to 15 seconds), or a gallery's photos with descriptions. Draft only.",
  {
    brand_id: UUID,
    site_id: UUID,
    page_path: PAGE_PATH,
    expected_revision: REVISION,
    slots: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: closedObject({
        block_index: { type: "integer", minimum: 0, maximum: 59 },
        slot: { type: "string", enum: ["media", "poster", "video", "gallery"] },
        media_id: UUID,
        alt: plainText(240, "What the photo shows"),
        images: {
          type: "array",
          maxItems: 12,
          items: closedObject({ media_id: UUID, alt: plainText(240) }, ["media_id"]),
        },
      }, ["block_index", "slot"]),
    },
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "site_id", "expected_revision", "slots", "why", "cites"],
  designerWrite("propose_site_imagery"),
);

const COLLECTION_DATA = closedObject({
  destination: closedObject({
    title: plainText(120),
    country: plainText(80),
    tagline: plainText(200),
    summary: plainText(600),
    story_heading: plainText(120),
    body: plainText(5000, "The destination's story (plain text; a blank line starts a new paragraph)"),
    featured_image: UUID,
    did_you_know: { type: "array", maxItems: 12, items: plainText(400) },
    related_offerings: { type: "array", maxItems: 12, items: UUID },
  }),
  story: closedObject({
    title: plainText(160),
    excerpt: plainText(400),
    content: plainText(5000, "The story (plain text; a blank line starts a new paragraph)"),
    featured_image: UUID,
  }),
  review: closedObject({
    quote: plainText(1200, "The review word for word as the owner pasted it"),
    reviewer: plainText(80, "The reviewer's name exactly as shown in the pasted text"),
    review_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" },
    trip_name: plainText(120),
    related_offering: UUID,
    source_note: plainText(500, "Where the owner says this review comes from"),
  }),
}, [], "Exactly one of destination, story or review, matching collection");

const proposeSiteCollectionEntry = tool(
  "propose_site_collection_entry",
  "Propose a new or changed destination, story or review for the website. Entries arrive hidden (the owner shows them). A review needs owner_source_text the owner pasted, and its quote and reviewer must appear in it word for word; it stays unconfirmed until a brand admin or owner confirms it with confirm_site_review. Draft only.",
  {
    brand_id: UUID,
    site_id: UUID,
    collection: { type: "string", enum: ["destinations", "stories", "testimonials"] },
    operation: { type: "string", enum: ["create", "update"] },
    entry_id: { type: "string", maxLength: 64 },
    expected_revision: REVISION,
    data: COLLECTION_DATA,
    owner_source_text: plainText(5000, "Text the owner pasted into the chat (required for a review)"),
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "site_id", "collection", "operation", "data", "why", "cites"],
  async (args, client, _userId, context) => {
    const operationId = requireAgentOperationId(context);
    const key = args.collection === "destinations" ? "destination" : args.collection === "stories" ? "story" : "review";
    const data = (args.data ?? {}) as Record<string, unknown>;
    const entry = data[key];
    if (!entry || typeof entry !== "object" || Object.keys(data).length !== 1) {
      throw new ToolError("INVALID_ARGS", `data must carry only ${key}`);
    }
    return await cmsTool("propose_site_collection_entry", { ...args, data: entry }, client, operationId);
  },
);

const confirmSiteReview = tool(
  "confirm_site_review",
  `Show the confirm-real card for one review: the owner confirms "${REVIEW_CONFIRMATION_STATEMENT}". Only brand admins and owners can confirm it. Confirming does not show the review on the website; the owner does that.`,
  {
    brand_id: UUID,
    site_id: UUID,
    review_id: { type: "string", maxLength: 64 },
    expected_revision: REVISION,
    statement: { type: "string", enum: [REVIEW_CONFIRMATION_STATEMENT] },
  },
  ["brand_id", "site_id", "review_id", "expected_revision", "statement"],
  async (args, client, _userId, context) => {
    const operationId = requireAgentOperationId(context);
    const { brandId, siteId } = requiredIds(args);
    if (args.statement !== REVIEW_CONFIRMATION_STATEMENT) {
      throw new ToolError("INVALID_ARGS", "The confirmation statement must be shown word for word.");
    }
    // The owner's own confirmation (rank 50 checked by Core in SQL), never Ari's designer path.
    return await invokeSiteControl(client, brandId, siteId, (id) => ({
      route: `/v1/sites/${id}/content`,
      method: "POST",
      operation_id: operationId,
      action: "confirm_review",
      args: { id: args.review_id, expected_revision: args.expected_revision, confirmed: true },
    }));
  },
);

const TRIP_GUIDE = closedObject({
  highlights: { type: "array", maxItems: 12, items: plainText(200) },
  what_to_prepare: plainText(4000),
  good_to_know: plainText(4000),
  faqs: {
    type: "array",
    maxItems: 20,
    items: closedObject({ question: plainText(300), answer: plainText(2000) }, ["question", "answer"]),
  },
  group_minimum: { type: "integer", minimum: 1, maximum: 500 },
  activity_level: plainText(60),
}, [], "The trip guide's full replacement (an empty guide removes it)");

const proposeTripGuideUpdate = tool(
  "propose_trip_guide_update",
  "Propose a trip's guide (highlights, what to prepare, good to know, FAQs, group minimum, activity level), shown on the Mingla trip page everywhere. Event managers, brand admins and owners. Replaces the whole guide against the revision Ari read.",
  {
    brand_id: UUID,
    trip_id: UUID,
    expected_revision: { type: "string", maxLength: 64, description: "The guide's updated_at Ari read, or \"none\" when the trip had no guide" },
    guide: TRIP_GUIDE,
    why: WHY,
    cites: CITES,
  },
  ["brand_id", "trip_id", "expected_revision", "guide", "why", "cites"],
  async (args, client, _userId, context) => {
    requireAgentOperationId(context);
    if (!isUuid(args.brand_id) || !isUuid(args.trip_id)) throw new ToolError("INVALID_ARGS", "brand_id and trip_id must be UUIDs");
    const current = await client.rpc("biz_get_trip_guide", { p_event_id: args.trip_id });
    if (current.error) throw tripGuideError(current.error.message);
    const currentRevision = (current.data as { updated_at?: unknown } | null)?.updated_at;
    const expected = String(args.expected_revision ?? "");
    if ((currentRevision == null && expected !== "none") || (currentRevision != null && String(currentRevision) !== expected)) {
      throw new ToolError("REVISION_CONFLICT", `The trip guide changed since Ari read it. Latest revision: ${currentRevision == null ? "none" : String(currentRevision)}.`);
    }
    const saved = await client.rpc("biz_upsert_trip_guide", { p_event_id: args.trip_id, p_guide: args.guide });
    if (saved.error) throw tripGuideError(saved.error.message);
    const logged = await logWorkIfSite(client, args.brand_id, { part: "trip_guide", tool: "propose_trip_guide_update", why: args.why, cites: args.cites, target: `trip:${args.trip_id}` });
    return { guide: saved.data, work_log_saved: logged };
  },
);

function tripGuideError(message: string): ToolError {
  if (message.includes("insufficient_event_permission")) return new ToolError("FORBIDDEN", "Trip guides need an event manager, brand admin or owner.");
  if (message.includes("trip_not_found") || message.includes("event_not_a_trip")) return new ToolError("NOT_FOUND", "That isn't one of this brand's trips.");
  if (message.includes("trip_guide_invalid")) return new ToolError("INVALID_ARGS", "That trip guide doesn't fit the guide's limits.");
  if (message.includes("trip_not_editable_status")) return new ToolError("INVALID_STATE", "This trip can't be edited any more.");
  return new ToolError("SITE_SERVICE_UNAVAILABLE", "Ari could not reach the trip guide right now.");
}

function publicationTool(
  name: "create_site_preview" | "publish_site" | "rollback_site",
) {
  const route = name === "create_site_preview"
    ? "previews"
    : name === "rollback_site"
    ? "rollbacks"
    : "publications";
  return tool(
    name,
    name === "create_site_preview"
      ? "Create a 30-minute private, non-indexed preview for one exact validated revision."
      : name === "publish_site"
      ? "Publish one exact validated revision after a separate explicit publish confirmation. Brand admins and owners only; a site's first publish needs the design checks run on that draft."
      : "Publish a selected historical revision as a new publication after a separate rollback confirmation. Brand admins and owners only.",
    {
      brand_id: UUID,
      site_id: UUID,
      expected_revision: REVISION,
      source_digest: DIGEST,
      arguments_digest: DIGEST,
    },
    [
      "brand_id",
      "site_id",
      "expected_revision",
      "source_digest",
      "arguments_digest",
    ],
    async (args, client, _userId, context) => {
      const { brandId, siteId } = requiredIds(args);
      const operationId = requireAgentOperationId(context);
      return await invokeSiteControl(client, brandId, siteId, (id) => ({
        route: `/v1/sites/${id}/${route}`,
        method: "POST",
        operation_id: operationId,
        brand_id: brandId,
        expected_revision: args.expected_revision,
        source_digest: args.source_digest,
        arguments_digest: args.arguments_digest,
      }));
    },
  );
}

const getOperation = tool(
  "get_site_operation_status",
  "Read the durable safe receipt for one Website operation.",
  { brand_id: UUID, site_id: UUID, operation_id: UUID },
  ["brand_id", "site_id", "operation_id"],
  async (args, client, userId) => {
    const { brandId, siteId } = requiredIds(args);
    if (!isUuid(args.operation_id)) {
      throw new ToolError("INVALID_ARGS", "operation_id must be a UUID");
    }
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await invokeSiteControl(client, brandId, siteId, (id) => ({
      route: `/v1/sites/${id}/operations/${args.operation_id}`,
      method: "GET",
    }));
  },
);

const listVersions = tool(
  "list_site_versions",
  "List immutable Website publication versions and their safe receipts.",
  { brand_id: UUID, site_id: UUID },
  ["brand_id", "site_id"],
  async (args, client, userId) => {
    const { brandId, siteId } = requiredIds(args);
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await invokeSiteControl(client, brandId, siteId, (id) => ({
      route: `/v1/sites/${id}/versions`,
      method: "GET",
    }));
  },
);

const createSitePreview = publicationTool("create_site_preview");
const publishSite = publicationTool("publish_site");
const rollbackSite = publicationTool("rollback_site");

export const SITE_AGENT_TOOLS: AgentToolDefinition[] = [
  getBrandSite,
  getSitePlan,
  startBrandCompletenessJob,
  listSiteDesigns,
  getBlockCatalog,
  getSiteTokens,
  runSiteDesignChecks,
  listSitePages,
  getSitePage,
  validateDraft,
  saveSitePlanAnswers,
  saveSitePlanDesign,
  updateBrandContext,
  createSiteDraft,
  proposeSiteComposition,
  proposeBlockVariant,
  proposeSiteTokens,
  proposeSiteCopy,
  proposeSiteImagery,
  proposeSiteCollectionEntry,
  confirmSiteReview,
  proposeTripGuideUpdate,
  createSitePreview,
  publishSite,
  getOperation,
  listVersions,
  rollbackSite,
];

export const SITE_AGENT_READ_ONLY = new Set([
  "get_brand_site",
  "get_site_plan",
  "start_brand_completeness_job",
  "list_site_designs",
  "get_block_catalog",
  "get_site_tokens",
  "run_site_design_checks",
  "list_site_pages",
  "get_site_page",
  "validate_site_draft",
  "get_site_operation_status",
  "list_site_versions",
]);

/** The Sites tools that write (each one a confirmed proposal). */
export const SITE_AGENT_WRITES: ReadonlySet<string> = new Set(
  SITE_AGENT_TOOLS.map((definition) => definition.name).filter((name) => !SITE_AGENT_READ_ONLY.has(name)),
);

/**
 * #2829 W9b — checks a Sites proposal BEFORE its card is shown (called by
 * the authorization seam at proposal time and again at confirmation): every
 * block against the catalogue, a citation for every write, a review only
 * from text the owner pasted, and the confirm-real statement word for word.
 * Facts (numbers, prices, dates, superlatives) are checked by Studio against
 * Mingla's data when the confirmed change is applied.
 */
export function assertSiteToolArgs(toolName: string, args: Record<string, unknown>): void {
  if (!SITE_AGENT_WRITES.has(toolName)) return;
  const invalid = (message: string): never => {
    throw new ToolError("INVALID_ARGS", message);
  };
  const needsLog = !["confirm_site_review", "create_site_preview", "publish_site", "rollback_site"].includes(toolName);
  if (needsLog) {
    const problem = workLogCitesProblem(args.cites);
    if (problem) invalid(`${problem} (every website change says what it is based on)`);
    if (typeof args.why !== "string" || !args.why.trim()) invalid("why is required");
  }
  if (toolName === "propose_site_composition") {
    for (const [listName, rows] of [["pages", args.pages], ["new_pages", args.new_pages]] as const) {
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) invalid(`${listName} must be a list`);
      (rows as Array<Record<string, unknown>>).forEach((row, n) => {
        const blocks = Array.isArray(row?.blocks) ? row.blocks : invalid(`${listName}[${n}].blocks must be a list`);
        const problems = (blocks as unknown[]).flatMap((block, i) => ariBlockProblems(block, undefined, `${listName}[${n}].blocks[${i}]`));
        if (problems.length) invalid(problems.slice(0, 6).join("; "));
      });
    }
    if (args.pages === undefined && args.new_pages === undefined && args.menu === undefined) invalid("propose at least one page, new page or menu");
  }
  if (toolName === "propose_site_collection_entry" && args.collection === "testimonials") {
    const source = typeof args.owner_source_text === "string" ? args.owner_source_text : "";
    const review = ((args.data ?? {}) as { review?: { quote?: unknown; reviewer?: unknown } }).review;
    if (!source.trim()) invalid("A review needs owner_source_text: the text the owner pasted.");
    const squash = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    if (typeof review?.quote === "string" && !squash(source).includes(squash(review.quote))) {
      invalid("The review must be word for word as the owner pasted it.");
    }
  }
  if (toolName === "confirm_site_review" && args.statement !== REVIEW_CONFIRMATION_STATEMENT) {
    invalid("The confirmation statement must be shown word for word.");
  }
}
