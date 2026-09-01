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

async function invokeControl(
  client: SupabaseClient,
  input: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.functions.invoke("brand-site-control", {
    body: input,
  });
  if (error) {
    throw new ToolError(
      "SITE_SERVICE_UNAVAILABLE",
      "Ari could not reach Website tools right now.",
    );
  }
  const response = data as
    | {
      ok?: boolean;
      data?: unknown;
      error?: { code?: string; message?: string };
    }
    | null;
  if (!response?.ok) {
    throw new ToolError(
      String(response?.error?.code || "SITE_OPERATION_FAILED"),
      String(
        response?.error?.message ||
          "The Website action could not be completed.",
      ),
    );
  }
  return response.data;
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
  "Read one accessible brand's Restaurant Website v1 status and draft summary. Never reveals a Website to ranks below marketing manager.",
  { brand_id: UUID },
  ["brand_id"],
  async (args, client, userId) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    }
    await assertAgentReadBrand(client, userId, args.brand_id);
    return await invokeControl(client, {
      route: `/v1/brands/${args.brand_id}/site`,
      method: "GET",
    });
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
