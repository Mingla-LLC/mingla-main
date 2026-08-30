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
  async (args, client) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a UUID");
    }
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
  async (args, client) =>
    await cmsTool("list_site_pages", args, client, crypto.randomUUID()),
);

const getSitePage = tool(
  "get_site_page",
  "Read one structured Website draft page by fixed role.",
  { brand_id: UUID, site_id: UUID, page_role: PAGE_ROLE },
  ["brand_id", "site_id", "page_role"],
  async (args, client) =>
    await cmsTool("get_site_page", args, client, crypto.randomUUID()),
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
      type: "object",
      additionalProperties: false,
      description:
        "Closed page fields/blocks to change; no HTML, CSS, JavaScript, iframe, SVG, or arbitrary code.",
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
    changes: { type: "object", additionalProperties: false },
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
  async (args, client) =>
    await cmsTool("validate_site_draft", args, client, crypto.randomUUID()),
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
  async (args, client) => {
    const { siteId } = requiredIds(args);
    if (!isUuid(args.operation_id)) {
      throw new ToolError("INVALID_ARGS", "operation_id must be a UUID");
    }
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
  async (args, client) => {
    const { siteId } = requiredIds(args);
    return await invokeControl(client, {
      route: `/v1/sites/${siteId}/versions`,
      method: "GET",
    });
  },
);

export const SITE_AGENT_TOOLS: AgentToolDefinition[] = [
  getBrandSite,
  listSitePages,
  getSitePage,
  proposeContent,
  proposeSettings,
  attachMedia,
  validateDraft,
  publicationTool("create_site_preview"),
  publicationTool("publish_site"),
  getOperation,
  listVersions,
  publicationTool("rollback_site"),
];

export const SITE_AGENT_READ_ONLY = new Set([
  "get_brand_site",
  "list_site_pages",
  "get_site_page",
  "validate_site_draft",
  "get_site_operation_status",
  "list_site_versions",
]);
