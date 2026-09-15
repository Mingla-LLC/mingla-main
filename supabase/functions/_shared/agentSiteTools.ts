// #2830 — Ari's closed Restaurant Website v1 tool surface.
// Every call uses the caller-scoped Supabase client. Core re-derives the
// user's effective rank and site/brand binding before signing any CMS request.

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

const UUID = { type: "string", format: "uuid" };
const REVISION = { type: "string", minLength: 1, maxLength: 200 };
const DIGEST = {
  type: "string",
  minLength: 64,
  maxLength: 64,
  description: "Lowercase SHA-256 digest from the validated draft receipt.",
};
const PAGE_ROLE = {
  type: "string",
  enum: ["home", "about", "menu", "gallery", "contact"],
};
const SAFE_URL = {
  type: "string",
  minLength: 1,
  maxLength: 2048,
  description:
    "An https URL or an approved relative Mingla path; never javascript, data, HTML, or code.",
};
const MEDIA_ID = { type: "string", format: "uuid" };
const boundedText = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const closedObject = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});
const cta = closedObject(
  { label: boundedText(80), href: SAFE_URL },
  ["label", "href"],
);
const block = (
  blockType: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) =>
  closedObject(
    {
      blockType: { type: "string", enum: [blockType] },
      ...properties,
    },
    ["blockType", ...required],
  );
const SITE_BLOCK = {
  anyOf: [
    block(
      "hero",
      {
        heading: boundedText(120),
        subheading: boundedText(300),
        media: MEDIA_ID,
        ctas: { type: "array", maxItems: 2, items: cta },
      },
      ["heading", "media"],
    ),
    block(
      "rich_text",
      {
        heading: boundedText(120),
        content: {
          type: "string",
          minLength: 1,
          maxLength: 5000,
          description:
            "Plain text for the bounded rich-text block. Mingla converts it to safe structured content.",
        },
      },
      ["content"],
    ),
    block(
      "media_feature",
      {
        media: MEDIA_ID,
        alt: boundedText(240),
        heading: boundedText(120),
        caption: boundedText(500),
        alignment: { type: "string", enum: ["left", "right"] },
      },
      ["media", "alt", "alignment"],
    ),
    block(
      "cta",
      {
        heading: boundedText(120),
        body: boundedText(500),
        label: boundedText(80),
        href: SAFE_URL,
      },
      ["heading", "label", "href"],
    ),
    block(
      "offering_grid",
      {
        heading: boundedText(120),
        offering_ids: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: closedObject(
            { offering_id: boundedText(80) },
            ["offering_id"],
          ),
        },
      },
      ["offering_ids"],
    ),
    block(
      "venue_reservation",
      {
        heading: boundedText(120),
        body: boundedText(500),
        reservation_target_id: boundedText(80),
      },
      ["heading", "reservation_target_id"],
    ),
    block(
      "menu_link",
      {
        heading: boundedText(120),
        label: boundedText(80),
        href: SAFE_URL,
      },
      ["label", "href"],
    ),
    block(
      "gallery",
      {
        heading: boundedText(120),
        images: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: closedObject(
            { media: MEDIA_ID, alt: boundedText(240) },
            ["media", "alt"],
          ),
        },
      },
      ["images"],
    ),
    block(
      "hours_location",
      {
        heading: boundedText(120),
        address: boundedText(300),
        map_url: SAFE_URL,
        hours: {
          type: "array",
          minItems: 1,
          maxItems: 7,
          items: closedObject(
            { day: boundedText(20), value: boundedText(80) },
            ["day", "value"],
          ),
        },
      },
      ["address", "hours"],
    ),
    block(
      "testimonials",
      {
        heading: boundedText(120),
        items: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: closedObject(
            { name: boundedText(120), quote: boundedText(500) },
            ["name", "quote"],
          ),
        },
      },
      ["items"],
    ),
    block(
      "faq",
      {
        heading: boundedText(120),
        items: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: closedObject(
            { question: boundedText(240), answer: boundedText(1000) },
            ["question", "answer"],
          ),
        },
      },
      ["items"],
    ),
    block(
      "contact_handoff",
      {
        heading: boundedText(120),
        body: boundedText(500),
        label: boundedText(80),
        href: SAFE_URL,
      },
      ["heading", "label", "href"],
    ),
    block("divider", {}),
    block(
      "spacer",
      { size: { type: "string", enum: ["small", "medium", "large"] } },
      ["size"],
    ),
  ],
};
const PAGE_CHANGES = closedObject({
  title: boundedText(120),
  enabled: { type: "boolean" },
  nav_label: boundedText(40),
  nav_order: { type: "integer", minimum: 0, maximum: 4 },
  blocks: { type: "array", maxItems: 40, items: SITE_BLOCK },
  seo: closedObject({
    title: boundedText(70),
    description: boundedText(170),
  }),
});
const SETTINGS_CHANGES = closedObject({
  display_name: boundedText(120),
  short_description: boundedText(300),
  logo: MEDIA_ID,
  background_color: {
    type: "string",
    pattern: "^#[0-9a-fA-F]{6}$",
  },
  foreground_color: {
    type: "string",
    pattern: "^#[0-9a-fA-F]{6}$",
  },
  accent_color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
  typography: { type: "string", enum: ["modern-sans", "editorial-serif"] },
  seo_title: boundedText(70),
  seo_description: boundedText(170),
  social_image: MEDIA_ID,
});

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
  | { kind: "refused"; code: SitesSafeCustomerCode; status: number }
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

const SITE_SERVICE_UNAVAILABLE_MESSAGE =
  "Ari could not reach Website tools right now.";

function safeRefusalCode(body: unknown): SitesSafeCustomerCode | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as { ok?: unknown; error?: { code?: unknown } };
  const code = candidate.error?.code;
  return candidate.ok === false && typeof code === "string" &&
      SITES_SAFE_CODE_SET.has(code)
    ? code as SitesSafeCustomerCode
    : null;
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
        const code = safeRefusalCode(body);
        const status = context.status;
        if (code) {
          outcome = { kind: "refused", code, status };
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
      const code = safeRefusalCode(response);
      outcome = response?.ok === true
        ? { kind: "ok", data: response.data }
        : code
        ? { kind: "refused", code, status: 200 }
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

async function invokeControl(
  client: SupabaseClient,
  input: Record<string, unknown>,
): Promise<unknown> {
  const outcome = await readControl(client, input);
  if (outcome.kind === "ok") return outcome.data;
  if (outcome.kind === "refused") {
    throw new ToolError(outcome.code, SITES_TOOL_MESSAGES[outcome.code]);
  }
  throw new ToolError(
    "SITE_SERVICE_UNAVAILABLE",
    SITE_SERVICE_UNAVAILABLE_MESSAGE,
  );
}

async function cmsTool(
  name: string,
  args: Record<string, unknown>,
  client: SupabaseClient,
  operationId: string,
): Promise<unknown> {
  const { brandId, siteId } = requiredIds(args);
  return await invokeControl(client, {
    route: `/v1/sites/${siteId}/ari`,
    method: "POST",
    operation_id: operationId,
    action: name,
    brand_id: brandId,
    args,
  });
}

const getBrandSite = tool(
  "get_brand_site",
  "Read one accessible brand's Restaurant Website v1 status and draft summary. When the brand has no website it returns website_state not_set_up or not_available instead of an error. Ari cannot create a website. Never reveals a Website to ranks below marketing manager.",
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
      throw new ToolError(site.code, SITES_TOOL_MESSAGES[site.code]);
    }
    /*
     * #3184 — a brand with no website is a successful read, not an error.
     *
     * brand-site-control answers 404 NOT_FOUND when the brand has no
     * brand_sites row, which is the normal state for almost every brand.
     * Reporting it as a failure made every website question a 500. The
     * availability read decides which honest answer Ari gives: websites are
     * not available for this brand, or not set up yet (a brand admin or owner
     * sets one up on the Website screen). Ari cannot create a website.
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
      throw new ToolError(
        availability.code,
        SITES_TOOL_MESSAGES[availability.code],
      );
    }
    const state = availability.data as
      | { available?: unknown; site?: unknown }
      | null;
    if (state?.available === false) {
      return {
        website_state: "not_available",
        brand_id: brandId,
        can_create_from_chat: false,
        setup_role: null,
        setup_screen: null,
      };
    }
    if (state?.available === true && state.site === null) {
      return {
        website_state: "not_set_up",
        brand_id: brandId,
        can_create_from_chat: false,
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

const listSitePages = tool(
  "list_site_pages",
  "List the five fixed Restaurant Website v1 page roles and current draft revisions.",
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
  "Read one structured Website draft page by fixed role.",
  { brand_id: UUID, site_id: UUID, page_role: PAGE_ROLE },
  ["brand_id", "site_id", "page_role"],
  async (args, client, userId) => {
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await cmsTool("get_site_page", args, client, crypto.randomUUID());
  },
);

const proposeContent = tool(
  "propose_site_content_update",
  "Propose an exact structured page diff against its expected revision. Confirmation updates the draft only and never publishes.",
  {
    brand_id: UUID,
    site_id: UUID,
    page_role: PAGE_ROLE,
    expected_revision: REVISION,
    changes: {
      ...PAGE_CHANGES,
      description:
        "One or more closed page fields or typed blocks; no HTML, CSS, JavaScript, iframe, SVG, or arbitrary code.",
    },
    change_summary: { type: "string", minLength: 1, maxLength: 500 },
  },
  [
    "brand_id",
    "site_id",
    "page_role",
    "expected_revision",
    "changes",
    "change_summary",
  ],
  async (args, client, _userId, context) => {
    const changes = args.changes;
    const allowed = new Set([
      "title",
      "enabled",
      "nav_label",
      "nav_order",
      "blocks",
      "seo",
    ]);
    if (
      !changes || typeof changes !== "object" || Array.isArray(changes) ||
      !Object.keys(changes).length ||
      Object.keys(changes).some((key) => !allowed.has(key))
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "changes contains an unsupported Website field",
      );
    }
    return await cmsTool(
      "propose_site_content_update",
      args,
      client,
      requireAgentOperationId(context),
    );
  },
);

const proposeSettings = tool(
  "propose_site_settings_update",
  "Propose a bounded Restaurant Website v1 visual, copy, or SEO settings diff. Confirmation changes only the draft.",
  {
    brand_id: UUID,
    site_id: UUID,
    expected_revision: REVISION,
    changes: SETTINGS_CHANGES,
    change_summary: { type: "string", minLength: 1, maxLength: 500 },
  },
  ["brand_id", "site_id", "expected_revision", "changes", "change_summary"],
  async (args, client, _userId, context) => {
    const changes = args.changes;
    const allowed = new Set([
      "display_name",
      "short_description",
      "logo",
      "background_color",
      "foreground_color",
      "accent_color",
      "typography",
      "seo_title",
      "seo_description",
      "social_image",
    ]);
    if (
      !changes || typeof changes !== "object" || Array.isArray(changes) ||
      !Object.keys(changes).length ||
      Object.keys(changes).some((key) => !allowed.has(key))
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "changes contains an unsupported Website setting",
      );
    }
    return await cmsTool(
      "propose_site_settings_update",
      args,
      client,
      requireAgentOperationId(context),
    );
  },
);

const attachMedia = tool(
  "attach_approved_site_media",
  "Attach one already processed READY Website image to a typed page block. Never uploads or accepts an unprocessed original.",
  {
    brand_id: UUID,
    site_id: UUID,
    page_role: PAGE_ROLE,
    expected_revision: REVISION,
    media_id: UUID,
    block_index: { type: "integer", minimum: 0, maximum: 39 },
    field: { type: "string", enum: ["media", "images"] },
    alt: { type: "string", minLength: 1, maxLength: 240 },
  },
  [
    "brand_id",
    "site_id",
    "page_role",
    "expected_revision",
    "media_id",
    "block_index",
    "field",
    "alt",
  ],
  async (args, client, _userId, context) =>
    await cmsTool(
      "attach_approved_site_media",
      args,
      client,
      requireAgentOperationId(context),
    ),
);

const validateDraft = tool(
  "validate_site_draft",
  "Validate the current structured draft and return a safe readiness receipt. Performs no publication.",
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
      ? "Publish one exact validated revision after a separate explicit publish confirmation."
      : "Publish a selected historical revision as a new publication after a separate rollback confirmation.",
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
      const { siteId } = requiredIds(args);
      return await invokeControl(client, {
        route: `/v1/sites/${siteId}/${route}`,
        method: "POST",
        operation_id: requireAgentOperationId(context),
        brand_id: args.brand_id,
        expected_revision: args.expected_revision,
        source_digest: args.source_digest,
        arguments_digest: args.arguments_digest,
      });
    },
  );
}

const getOperation = tool(
  "get_site_operation_status",
  "Read the durable safe receipt for one Website operation.",
  { brand_id: UUID, site_id: UUID, operation_id: UUID },
  ["brand_id", "site_id", "operation_id"],
  async (args, client, userId) => {
    const { siteId } = requiredIds(args);
    if (!isUuid(args.operation_id)) {
      throw new ToolError("INVALID_ARGS", "operation_id must be a UUID");
    }
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await invokeControl(client, {
      route: `/v1/sites/${siteId}/operations/${args.operation_id}`,
      method: "GET",
    });
  },
);

const listVersions = tool(
  "list_site_versions",
  "List immutable Website publication versions and their safe receipts.",
  { brand_id: UUID, site_id: UUID },
  ["brand_id", "site_id"],
  async (args, client, userId) => {
    const { siteId } = requiredIds(args);
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await invokeControl(client, {
      route: `/v1/sites/${siteId}/versions`,
      method: "GET",
    });
  },
);

const createSitePreview = publicationTool("create_site_preview");
const publishSite = publicationTool("publish_site");
const rollbackSite = publicationTool("rollback_site");

export const SITE_AGENT_TOOLS: AgentToolDefinition[] = [
  getBrandSite,
  listSitePages,
  getSitePage,
  proposeContent,
  proposeSettings,
  attachMedia,
  validateDraft,
  createSitePreview,
  publishSite,
  getOperation,
  listVersions,
  rollbackSite,
];

export const SITE_AGENT_READ_ONLY = new Set([
  "get_brand_site",
  "list_site_pages",
  "get_site_page",
  "validate_site_draft",
  "get_site_operation_status",
  "list_site_versions",
]);
