// Issue #3355 — Ari 10x discovery, memory, plan and public-research tools.
//
// These tools are intentionally narrow. Public content is untrusted, app
// handoffs are allowlisted, memory is caller scoped in SQL, and onboarding
// progress advances through an expected-revision compare-and-swap.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AgentToolDefinition } from "./agentToolHelpers.ts";
import { callRpc, isString, isUuid, ToolError } from "./agentToolHelpers.ts";
import { DOMAIN_TOOLS } from "./agentDomainTools.ts";
import { SITE_AGENT_TOOLS } from "./agentSiteTools.ts";
import { STRIPE_SUPPORTED_COUNTRIES } from "./stripeSupportedCountries.ts";
import { sanitizeAriPublicText } from "./agentSanitization.ts";
import { toolBelongsTo } from "./agentToolsets.ts";
import {
  type AriResearchResult,
  readPublicUrl,
  searchPublicWeb,
} from "./agentWebResearch.ts";

const TOOLSET_KEYS = [
  "core",
  "brand",
  "listings",
  "money",
  "marketing",
  "people",
  "sites",
  "venues",
  "research",
  "memory",
  "onboarding",
] as const;

const LOCAL_CAPABILITIES = [
  [
    "search_public_web",
    "Research public web sources with dates and citations.",
  ],
  ["read_public_url", "Read one public website or public document safely."],
  [
    "inspect_public_social_profile",
    "Read a public social profile where public access permits.",
  ],
  ["search_capabilities", "Search Ari's current Mingla capability map."],
  ["request_tools", "Load a compact toolset needed for the current step."],
  ["get_onboarding_plan", "Read the user's durable onboarding plan."],
  [
    "update_onboarding_plan",
    "Create or advance the user's durable onboarding plan.",
  ],
  ["list_memory_notes", "List editable memories scoped to the user and brand."],
  [
    "save_memory_note",
    "Save an approved preference, correction, business fact or workflow.",
  ],
  ["forget_memory_note", "Remove a memory from future Ari context."],
  [
    "open_handoff",
    "Prepare an allowlisted Mingla app destination for a human-owned step.",
  ],
  [
    "get_market_rules",
    "Read deterministic country, currency and payment-rail rules.",
  ],
  [
    "get_listing_type_capabilities",
    "Read what each Mingla listing type supports.",
  ],
  [
    "fetch_public_listing_page",
    "Read a public listing or ticket page as untrusted data.",
  ],
  [
    "extract_listing_candidates",
    "Extract candidate listing fields and conflicts from supplied text.",
  ],
  [
    "manage_agent_job",
    "Create, inspect, checkpoint, pause, resume or cancel a durable Ari job.",
  ],
  [
    "build_host_onboarding_blueprint",
    "Turn host materials into a complete resumable setup and launch checklist.",
  ],
  [
    "get_capability_inventory",
    "Inspect Ari's live coverage across every shipped Mingla product area.",
  ],
  [
    "set_refund_policy",
    "Set an event or experience refund policy through Mingla's canonical protected writer.",
  ],
  [
    "get_buyer_notice_status",
    "Read whether buyers will be notified about a live event edit and the latest delivery counts.",
  ],
] as const;

const HANDOFF_ROUTES = Object.freeze({
  brand: "/brand/{brand_id}",
  brand_edit: "/brand/{brand_id}/edit",
  payments: "/brand/{brand_id}/payments",
  payment_onboarding: "/brand/{brand_id}/payments/onboard",
  pricing_defaults: "/brand/{brand_id}/pricing-defaults",
  team: "/brand/{brand_id}/team",
  website: "/brand/{brand_id}/website",
  marketing: "/(tabs)/marketing",
  campaigns: "/(tabs)/marketing/campaigns",
  ads: "/(tabs)/marketing/ads",
  creators: "/(tabs)/marketing/creators",
  referrals: "/(tabs)/marketing/referrals",
  analytics: "/(tabs)/analytics",
  people: "/(tabs)/marketing/people",
  people_import: "/(tabs)/people/import",
  venue_create: "/venue/create",
  experience_create: "/experience/create",
  create_event: "/event/create",
  create_trip: "/trip/create",
  create_rsvp: "/rsvp/create",
  account_profile: "/account/edit-profile",
  account_notifications: "/account/notifications",
  account_support: "/account/support",
});

const ONBOARDING_STEPS = Object.freeze([
  {
    key: "materials",
    title: "Read supplied materials",
    capabilities: ["extract_listing_candidates"],
    human_owned: false,
  },
  {
    key: "brand",
    title: "Create or select the brand",
    capabilities: ["list_brands", "create_brand", "update_brand"],
    human_owned: false,
  },
  {
    key: "market",
    title: "Confirm country, currency and timezone",
    capabilities: ["get_market_rules", "manage_brand_discovery_currency"],
    human_owned: false,
  },
  {
    key: "listing_type",
    title: "Choose the right listing type",
    capabilities: ["get_listing_type_capabilities"],
    human_owned: false,
  },
  {
    key: "listing",
    title: "Create events, trips, RSVPs or experiences",
    capabilities: [
      "create_event",
      "create_experience",
      "create_trip",
      "create_rsvp",
    ],
    human_owned: false,
  },
  {
    key: "schedule",
    title: "Set dates, recurrence and availability",
    capabilities: [
      "update_event",
      "update_experience",
      "manage_venue_availability",
    ],
    human_owned: false,
  },
  {
    key: "tickets",
    title: "Configure tickets, capacity, fees and refunds",
    capabilities: [
      "upsert_ticket_tier",
      "set_pricing_switches",
      "set_refund_policy",
    ],
    human_owned: false,
  },
  {
    key: "location",
    title: "Set venues, departure points and address privacy",
    capabilities: [
      "update_event",
      "manage_experience_stops",
      "create_venue_listing",
    ],
    human_owned: false,
  },
  {
    key: "media",
    title: "Prepare covers, logos, galleries and video",
    capabilities: ["set_event_cover", "manage_venue_gallery"],
    human_owned: false,
  },
  {
    key: "people",
    title: "Import people and assign the team",
    capabilities: ["manage_brand_people", "invite_brand_member"],
    human_owned: false,
  },
  {
    key: "payouts",
    title: "Complete payout setup",
    capabilities: ["open_handoff"],
    human_owned: true,
  },
  {
    key: "terms",
    title: "Review and accept legal terms",
    capabilities: ["open_handoff"],
    human_owned: true,
  },
  {
    key: "preview",
    title: "Preview the listing and website",
    capabilities: ["fetch_public_listing_page", "get_brand_site"],
    human_owned: false,
  },
  {
    key: "publish",
    title: "Publish after explicit approval",
    capabilities: [
      "publish_event",
      "publish_trip",
      "publish_rsvp",
      "publish_experience",
    ],
    human_owned: true,
  },
  {
    key: "verify",
    title: "Verify the public result and issue a receipt",
    capabilities: ["fetch_public_listing_page", "get_buyer_notice_status"],
    human_owned: false,
  },
  {
    key: "handover",
    title: "Invite the owner and prepare the launch message",
    capabilities: ["invite_brand_member", "list_brand_team"],
    human_owned: true,
  },
]);

const LISTING_CAPABILITIES = Object.freeze({
  event: {
    schedule: ["single", "multi_date", "recurring"],
    commerce: ["free", "paid_tickets", "capacity", "refund_policy"],
    location: ["venue", "address_privacy", "online_or_tba"],
  },
  experience: {
    schedule: ["single", "multi_date", "recurring", "open_hours"],
    commerce: ["person", "group", "time_block", "capacity", "refund_policy"],
    location: ["single", "per_stop", "address_privacy"],
  },
  trip: {
    schedule: ["multi_day_itinerary"],
    commerce: ["tiers", "installments", "capacity", "traveler_intake"],
    location: ["departure_point", "daily_stops", "address_privacy"],
  },
  rsvp: {
    schedule: ["single", "multi_date", "recurring"],
    commerce: ["free", "optional_contribution", "guest_approval", "capacity"],
    location: ["venue", "private_address", "online_or_tba"],
  },
});

function requiredText(value: unknown, name: string, max: number): string {
  if (!isString(value)) {
    throw new ToolError("INVALID_ARGS", `${name} is required`);
  }
  const cleaned = sanitizeAriPublicText(value).text.trim();
  if (!cleaned || cleaned.length > max) {
    throw new ToolError("INVALID_ARGS", `${name} must be 1-${max} characters`);
  }
  return cleaned;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function cachedResearch(
  client: SupabaseClient,
  kind: string,
  input: string,
  loader: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const key = await sha256(`${kind}\n${input.trim().toLowerCase()}`);
  const cached = await callRpc<Record<string, unknown> | null>(
    client,
    "ari_research_cache_get",
    {
      p_cache_key: key,
    },
  );
  if (cached) return { ...cached, cache: "hit" };
  const result = await loader();
  await callRpc(client, "ari_research_cache_put", {
    p_cache_key: key,
    p_result: result,
    p_ttl_seconds: 1800,
  });
  return { ...result, cache: "miss" };
}

function publicSocialType(url: URL): "social" | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return [
      "instagram.com",
      "tiktok.com",
      "youtube.com",
      "youtu.be",
      "x.com",
      "twitter.com",
      "facebook.com",
      "threads.net",
      "linkedin.com",
    ].some((domain) => host === domain || host.endsWith(`.${domain}`))
    ? "social"
    : null;
}

function catalogue(): Array<{ name: string; description: string }> {
  const all = [
    ...DOMAIN_TOOLS.map(({ name, description }) => ({ name, description })),
    ...SITE_AGENT_TOOLS.map(({ name, description }) => ({ name, description })),
    ...LOCAL_CAPABILITIES.map(([name, description]) => ({ name, description })),
    {
      name: "create_brand",
      description: "Create a host brand after confirmation.",
    },
    {
      name: "list_brands",
      description: "List brands available to the signed-in host.",
    },
    {
      name: "create_event",
      description: "Prepare a new event for confirmation.",
    },
    {
      name: "create_experience",
      description: "Prepare a new experience for confirmation.",
    },
  ];
  return [...new Map(all.map((item) => [item.name, item])).values()];
}

function capabilitySearch(
  query: string,
  limit = 12,
): Array<{ name: string; description: string; score: number }> {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) =>
    term.length > 2
  );
  return catalogue().map((item) => {
    const haystack = `${item.name} ${item.description}`.toLowerCase();
    return {
      ...item,
      score: terms.reduce(
        (total, term) => total + (haystack.includes(term) ? 1 : 0),
        0,
      ),
    };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

export function extractCandidates(
  text: string,
  sourceUrl: string | null,
): Record<string, unknown> {
  const clean = sanitizeAriPublicText(text).text.replace(/\s+/g, " ").trim()
    .slice(
      0,
      48_000,
    );
  const dateMatches = [
    ...clean.matchAll(
      /\b(?:mon|tue|wed|thu|fri|sat|sun)?(?:day)?[,]?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:[,]?\s+\d{4})?/gi,
    ),
  ].map((m) => m[0]);
  const isoDates = [...clean.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((m) =>
    m[0]
  );
  const times = [
    ...clean.matchAll(/\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:am|pm)?\b/gi),
  ].map((m) => m[0]).filter((value) => /:|am|pm/i.test(value));
  const prices = [
    ...clean.matchAll(
      /(?:[$£€₦]\s?\d[\d,.]*|\b(?:USD|GBP|EUR|NGN|CAD|GHS|KES)\s?\d[\d,.]*)/gi,
    ),
  ].map((m) => m[0]);
  const unique = (values: string[]) =>
    [...new Set(values.map((value) => value.trim()))].slice(0, 12);
  const dates = unique([...dateMatches, ...isoDates]);
  const uniqueTimes = unique(times);
  return {
    source_url: sourceUrl,
    candidates: { dates, times: uniqueTimes, prices: unique(prices) },
    conflicts: [
      ...(dates.length > 1
        ? [{ field: "date", values: dates, requires_confirmation: true }]
        : []),
      ...(uniqueTimes.length > 1
        ? [{ field: "time", values: uniqueTimes, requires_confirmation: true }]
        : []),
    ],
    needs_human_confirmation: dates.length > 1 || uniqueTimes.length > 1,
    excerpt: clean.slice(0, 1800),
  };
}

export function compareListingCandidateSources(
  primary: Record<string, unknown>,
  comparison: Record<string, unknown>,
  labels: [string, string],
): Array<Record<string, unknown>> {
  const left = primary.candidates as Record<string, unknown> | undefined;
  const right = comparison.candidates as Record<string, unknown> | undefined;
  const conflicts: Array<Record<string, unknown>> = [];
  for (const field of ["dates", "times", "prices"] as const) {
    const leftValues = Array.isArray(left?.[field])
      ? [
        ...new Set((left[field] as unknown[]).filter((value): value is string =>
          typeof value === "string"
        )),
      ]
      : [];
    const rightValues = Array.isArray(right?.[field])
      ? [
        ...new Set(
          (right[field] as unknown[]).filter((value): value is string =>
            typeof value === "string"
          ),
        ),
      ]
      : [];
    if (
      leftValues.length > 0 && rightValues.length > 0 &&
      JSON.stringify(leftValues) !== JSON.stringify(rightValues)
    ) {
      conflicts.push({
        field,
        blocking: true,
        sources: [
          { label: labels[0], values: leftValues },
          { label: labels[1], values: rightValues },
        ],
        resolution: "ask_user_to_choose_source",
      });
    }
  }
  return conflicts;
}

const searchPublicWebTool: AgentToolDefinition = {
  name: "search_public_web",
  description:
    "Search public web sources. Returns citations, source dates and reported-versus-corroborated claims. Never searches private accounts.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: { query: { type: "string", minLength: 3, maxLength: 1200 } },
  },
  executor: async (args, client) => {
    const query = requiredText(args.query, "query", 1200);
    return await cachedResearch(
      client,
      "search",
      query,
      async () =>
        await searchPublicWeb(query) as unknown as Record<string, unknown>,
    );
  },
};

const readPublicUrlTool: AgentToolDefinition = {
  name: "read_public_url",
  description:
    "Read one public HTTP(S) page as untrusted content with a bounded response and freshness stamp.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["url"],
    properties: {
      url: { type: "string", maxLength: 2048 },
      source_type: { type: "string", enum: ["web", "document", "ticket_page"] },
    },
  },
  executor: async (args, client) => {
    const url = requiredText(args.url, "url", 2048);
    const sourceType =
      args.source_type === "document" || args.source_type === "ticket_page"
        ? args.source_type
        : "web";
    return await cachedResearch(
      client,
      "url",
      url,
      async () => await readPublicUrl(url, sourceType),
    );
  },
};

const inspectPublicSocialProfile: AgentToolDefinition = {
  name: "inspect_public_social_profile",
  description:
    "Read a public Instagram, TikTok, YouTube, X, Facebook, Threads or LinkedIn profile when public web access permits. Never logs in or bypasses access controls.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["url"],
    properties: { url: { type: "string", maxLength: 2048 } },
  },
  executor: async (args, client) => {
    const value = requiredText(args.url, "url", 2048);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ToolError(
        "INVALID_ARGS",
        "url must be a public social profile URL",
      );
    }
    if (!publicSocialType(url)) {
      throw new ToolError(
        "SOCIAL_DOMAIN_UNSUPPORTED",
        "That public social network is not supported yet.",
      );
    }
    return await cachedResearch(
      client,
      "social",
      value,
      async () => await readPublicUrl(value, "social"),
    );
  },
};

const searchCapabilities: AgentToolDefinition = {
  name: "search_capabilities",
  description:
    "Search Mingla capabilities before concluding that Ari cannot do something.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 2, maxLength: 300 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
  },
  executor: async (args) => ({
    query: requiredText(args.query, "query", 300),
    matches: capabilitySearch(String(args.query), Number(args.limit ?? 12)),
    total_capabilities: catalogue().length,
  }),
};

const requestTools: AgentToolDefinition = {
  name: "request_tools",
  description:
    "Request one or more compact toolsets for the next reasoning step instead of loading the entire catalogue.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["toolsets"],
    properties: {
      toolsets: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: { type: "string", enum: [...TOOLSET_KEYS] },
      },
      reason: { type: "string", maxLength: 300 },
    },
  },
  executor: async (args) => ({
    requested: args.toolsets,
    available: TOOLSET_KEYS,
    reason: typeof args.reason === "string"
      ? sanitizeAriPublicText(args.reason).text.slice(0, 300)
      : null,
  }),
};

const getOnboardingPlan: AgentToolDefinition = {
  name: "get_onboarding_plan",
  description:
    "Read the caller's durable, resumable host-onboarding plan for a brand or an unbound new-brand setup.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      brand_id: { type: "string", format: "uuid", nullable: true },
    },
  },
  executor: async (args, client) =>
    await callRpc(client, "ari_get_onboarding_plan", {
      p_brand_id: isUuid(args.brand_id) ? args.brand_id : null,
    }),
};

/**
 * Reachable production owner for the onboarding-plan lifecycle transition.
 * Keeping the RPC name explicit here lets lifecycle audits prove that the SQL
 * resolver is invoked by a shipped tool rather than existing only in schema.
 */
async function ari_upsert_onboarding_plan(
  client: SupabaseClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  return await callRpc(client, "ari_upsert_onboarding_plan", {
    p_brand_id: isUuid(args.brand_id) ? args.brand_id : null,
    p_mode: args.mode,
    p_expected_revision: args.expected_revision,
    p_patch: args.patch,
    p_evidence: args.evidence ?? {},
  });
}

const updateOnboardingPlan: AgentToolDefinition = {
  name: "update_onboarding_plan",
  description:
    "Create or advance the caller's durable onboarding plan. Uses expected_revision so parallel or stale turns cannot overwrite newer work.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "expected_revision", "patch"],
    properties: {
      brand_id: { type: "string", format: "uuid", nullable: true },
      mode: { type: "string", enum: ["self_serve", "operator_client"] },
      expected_revision: { type: "integer", minimum: 0 },
      patch: { type: "object" },
      evidence: { type: "object" },
    },
  },
  executor: async (args, client) =>
    await ari_upsert_onboarding_plan(client, args),
};

const listMemoryNotes: AgentToolDefinition = {
  name: "list_memory_notes",
  description:
    "List the caller's active Ari memories. Brand-scoped memories never leak across brands and global caller preferences may also appear.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      brand_id: { type: "string", format: "uuid", nullable: true },
    },
  },
  executor: async (args, client) =>
    await callRpc(client, "ari_memory_list", {
      p_brand_id: isUuid(args.brand_id) ? args.brand_id : null,
    }),
};

const saveMemoryNote: AgentToolDefinition = {
  name: "save_memory_note",
  description:
    "Save an explicit approved preference, correction, business fact or working style. Do not infer sensitive facts.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "content"],
    properties: {
      brand_id: { type: "string", format: "uuid", nullable: true },
      kind: {
        type: "string",
        enum: ["preference", "correction", "business_fact", "workflow"],
      },
      content: { type: "string", minLength: 1, maxLength: 1200 },
      evidence_message_id: { type: "string", format: "uuid", nullable: true },
    },
  },
  executor: async (args, client) =>
    await callRpc(client, "ari_memory_save", {
      p_brand_id: isUuid(args.brand_id) ? args.brand_id : null,
      p_kind: args.kind,
      p_content: requiredText(args.content, "content", 1200),
      p_evidence_message_id: isUuid(args.evidence_message_id)
        ? args.evidence_message_id
        : null,
    }),
};

const forgetMemoryNote: AgentToolDefinition = {
  name: "forget_memory_note",
  description: "Remove one caller-owned memory from future Ari context.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["note_id"],
    properties: { note_id: { type: "string", format: "uuid" } },
  },
  executor: async (args, client) => {
    if (!isUuid(args.note_id)) {
      throw new ToolError("INVALID_ARGS", "note_id must be a uuid");
    }
    return await callRpc(client, "ari_memory_forget", {
      p_note_id: args.note_id,
    });
  },
};

const openHandoff: AgentToolDefinition = {
  name: "open_handoff",
  description:
    "Return an allowlisted Mingla Host route for a human-owned or screen-specific step. This never accepts an arbitrary URL.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["destination"],
    properties: {
      destination: { type: "string", enum: Object.keys(HANDOFF_ROUTES) },
      brand_id: { type: "string", format: "uuid", nullable: true },
      reason: { type: "string", maxLength: 300 },
    },
  },
  executor: async (args) => {
    const destination = String(args.destination) as keyof typeof HANDOFF_ROUTES;
    const template = HANDOFF_ROUTES[destination];
    if (!template) {
      throw new ToolError(
        "HANDOFF_NOT_ALLOWED",
        "That Mingla destination is not allowlisted.",
      );
    }
    if (template.includes("{brand_id}") && !isUuid(args.brand_id)) {
      throw new ToolError(
        "INVALID_ARGS",
        "brand_id is required for this destination",
      );
    }
    return {
      destination,
      route: template.replace("{brand_id}", String(args.brand_id ?? "")),
      reason: typeof args.reason === "string"
        ? sanitizeAriPublicText(args.reason).text.slice(0, 300)
        : null,
      requires_human: true,
    };
  },
};

const getMarketRules: AgentToolDefinition = {
  name: "get_market_rules",
  description:
    "Read Mingla's deterministic payout country, currency and provider rules. Unknown markets remain unknown rather than being guessed.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["country_code"],
    properties: {
      country_code: { type: "string", minLength: 2, maxLength: 2 },
    },
  },
  executor: async (args) => {
    const country = requiredText(args.country_code, "country_code", 2)
      .toUpperCase();
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria uses the canonical Paystack branch, never Stripe Connect.
    if (country === "NG") {
      return {
        country,
        supported: true,
        currency: "NGN",
        payment_provider: "paystack",
        payout_country_immutable_after_onboarding: true,
      };
    }
    const stripe = STRIPE_SUPPORTED_COUNTRIES.find((entry) =>
      entry.country === country
    );
    return stripe
      ? {
        country,
        supported: true,
        currency: stripe.defaultCurrency,
        payment_provider: "stripe",
        payout_country_immutable_after_onboarding: true,
      }
      : {
        country,
        supported: false,
        currency: null,
        payment_provider: null,
        requires_human_review: true,
      };
  },
};

const getListingCapabilities: AgentToolDefinition = {
  name: "get_listing_type_capabilities",
  description:
    "Read supported schedule, commerce and location capabilities for event, experience, trip or RSVP listings.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["listing_type"],
    properties: {
      listing_type: { type: "string", enum: Object.keys(LISTING_CAPABILITIES) },
    },
  },
  executor: async (args) => ({
    listing_type: args.listing_type,
    ...LISTING_CAPABILITIES[
      String(args.listing_type) as keyof typeof LISTING_CAPABILITIES
    ],
  }),
};

const buildHostOnboardingBlueprint: AgentToolDefinition = {
  name: "build_host_onboarding_blueprint",
  description:
    "Build the complete host setup plan from supplied materials. Returns every product, safety, human-owned, preview, publish, verification and handover step; use update_onboarding_plan to save progress.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["goal", "mode", "materials"],
    properties: {
      goal: { type: "string", minLength: 3, maxLength: 1000 },
      mode: { type: "string", enum: ["self_serve", "operator_client"] },
      brand_id: { type: "string", format: "uuid", nullable: true },
      materials: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "string",
          enum: [
            "message",
            "image",
            "flyer",
            "document",
            "csv",
            "voice_note",
            "video",
            "public_url",
          ],
        },
      },
    },
  },
  executor: async (args) => {
    const goal = requiredText(args.goal, "goal", 1000);
    const materials = Array.isArray(args.materials)
      ? [...new Set(args.materials.map(String))]
      : [];
    return {
      schema_version: 1,
      goal,
      mode: args.mode,
      brand_id: isUuid(args.brand_id) ? args.brand_id : null,
      materials,
      steps: ONBOARDING_STEPS.map((step, index) => ({
        ...step,
        order: index + 1,
        status: "pending",
        approval_required: step.human_owned ||
          step.capabilities.some((name) =>
            /^(create_|update_|publish_|set_|manage_|invite_)/.test(name)
          ),
      })),
      completion_contract: {
        verify_public_result: true,
        issue_receipt: true,
        distinguish_skipped_failed_and_human_owned: true,
        resume_without_repeating_completed_writes: true,
      },
      next_action:
        "Resolve material conflicts, then save this blueprint with update_onboarding_plan.",
    };
  },
};

const getCapabilityInventory: AgentToolDefinition = {
  name: "get_capability_inventory",
  description:
    "Return Ari's executable capability coverage grouped across Mingla products, plus the allowlisted human handoffs. Use this before claiming a product area is unsupported.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      area: { type: "string", enum: [...TOOLSET_KEYS], nullable: true },
    },
  },
  executor: async (args) => {
    const all = catalogue();
    const requested = typeof args.area === "string" ? args.area : null;
    const areas = TOOLSET_KEYS.filter((key) => !requested || key === requested)
      .map((key) => ({
        key,
        capabilities: all.filter((item) => toolBelongsTo(item.name, key)),
      }));
    return {
      generated_at: new Date().toISOString(),
      total_capabilities: all.length,
      areas,
      handoffs: Object.entries(HANDOFF_ROUTES).map(([destination, route]) => ({
        destination,
        route,
      })),
      discovery_rule:
        "Search capabilities and request only the toolsets needed for the current step.",
    };
  },
};

const setRefundPolicy: AgentToolDefinition = {
  name: "set_refund_policy",
  description:
    "Set or clear the refund policy for an owned standard event or experience. Published offerings require a 10-200 character edit reason; the server refuses less-generous terms after paid sales.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["event_id", "policy"],
    properties: {
      event_id: { type: "string", format: "uuid" },
      policy: {
        type: "object",
        nullable: true,
        description:
          "The canonical refund-policy object, or null to clear it when the server permits that change.",
      },
      reason: { type: "string", minLength: 10, maxLength: 200 },
    },
  },
  executor: async (args, client) => {
    if (!isUuid(args.event_id)) {
      throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
    }
    if (
      args.policy !== null &&
      (typeof args.policy !== "object" || Array.isArray(args.policy))
    ) {
      throw new ToolError("INVALID_ARGS", "policy must be an object or null");
    }
    if (
      args.reason !== undefined &&
      (typeof args.reason !== "string" || args.reason.trim().length < 10 ||
        args.reason.trim().length > 200)
    ) {
      throw new ToolError(
        "INVALID_ARGS",
        "reason must be 10-200 characters when supplied",
      );
    }
    const result = await callRpc<Record<string, unknown>>(
      client,
      "business_patch_offering_refund_policy",
      {
        p_event_id: args.event_id,
        p_policy: args.policy,
        p_reason: typeof args.reason === "string" ? args.reason.trim() : null,
      },
    );
    if (result.ok !== true) {
      throw new ToolError(
        "DOMAIN_ACTION_REFUSED",
        typeof result.reason === "string"
          ? result.reason
          : "The refund policy was not changed.",
      );
    }
    return result;
  },
};

const getBuyerNoticeStatus: AgentToolDefinition = {
  name: "get_buyer_notice_status",
  description:
    "Read the canonical buyer-notice status for an owned event, including audience, no-email, sent, pending, failed and held counts.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["event_id"],
    properties: { event_id: { type: "string", format: "uuid" } },
  },
  executor: async (args, client) => {
    if (!isUuid(args.event_id)) {
      throw new ToolError("INVALID_ARGS", "event_id must be a uuid");
    }
    return await callRpc<Record<string, unknown>>(
      client,
      "business_event_buyer_notice_status",
      { p_event_id: args.event_id },
    );
  },
};

const fetchPublicListingPage: AgentToolDefinition = {
  name: "fetch_public_listing_page",
  description:
    "Read a public event or ticket page as untrusted content for comparison and candidate extraction.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["url"],
    properties: { url: { type: "string", maxLength: 2048 } },
  },
  executor: async (args, client) => {
    const url = requiredText(args.url, "url", 2048);
    return await cachedResearch(
      client,
      "listing",
      url,
      async () => await readPublicUrl(url, "ticket_page"),
    );
  },
};

const extractListingCandidates: AgentToolDefinition = {
  name: "extract_listing_candidates",
  description:
    "Extract date, time and price candidates from supplied flyer, document, image, voice/video transcript, web page or message text. Compare two sources when supplied; differing values are blocking conflicts that require human confirmation, never silent selection.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: {
      text: { type: "string", minLength: 1, maxLength: 48000 },
      source_url: { type: "string", maxLength: 2048, nullable: true },
      source_label: { type: "string", maxLength: 120, nullable: true },
      comparison_text: { type: "string", maxLength: 48000, nullable: true },
      comparison_label: { type: "string", maxLength: 120, nullable: true },
    },
  },
  executor: async (args) => {
    const primary = extractCandidates(
      requiredText(args.text, "text", 48_000),
      typeof args.source_url === "string" ? args.source_url : null,
    );
    if (typeof args.comparison_text !== "string") return primary;
    const comparison = extractCandidates(
      requiredText(args.comparison_text, "comparison_text", 48_000),
      null,
    );
    const labels: [string, string] = [
      typeof args.source_label === "string"
        ? requiredText(args.source_label, "source_label", 120)
        : "supplied material",
      typeof args.comparison_label === "string"
        ? requiredText(args.comparison_label, "comparison_label", 120)
        : "message text",
    ];
    const conflicts = compareListingCandidateSources(
      primary,
      comparison,
      labels,
    );
    return {
      sources: [
        { label: labels[0], ...primary },
        { label: labels[1], ...comparison },
      ],
      conflicts,
      requires_human_resolution: conflicts.length > 0,
    };
  },
};

const manageAgentJob: AgentToolDefinition = {
  name: "manage_agent_job",
  description:
    "Create, inspect, checkpoint, pause, resume or cancel a durable Ari job. Checkpoints can preserve the current and next action, one active question, verified/pending/blocked/human-action keys, and bounded evidence references. Use a stable UUID idempotency key when creating so retries never duplicate work.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: [
          "create",
          "get",
          "list",
          "checkpoint",
          "pause",
          "resume",
          "cancel",
        ],
      },
      job_id: { type: "string", format: "uuid", nullable: true },
      brand_id: { type: "string", format: "uuid", nullable: true },
      conversation_id: { type: "string", format: "uuid", nullable: true },
      idempotency_key: { type: "string", format: "uuid", nullable: true },
      expected_revision: { type: "integer", minimum: 1, nullable: true },
      goal_summary: { type: "string", maxLength: 1000, nullable: true },
      status: {
        type: "string",
        enum: [
          "queued",
          "running",
          "paused",
          "awaiting_approval",
          "completed",
          "failed",
          "cancelled",
        ],
        nullable: true,
      },
      current_step: { type: "string", maxLength: 200, nullable: true },
      next_action: {
        type: "object",
        nullable: true,
        additionalProperties: false,
        required: ["kind"],
        properties: {
          kind: {
            type: "string",
            enum: [
              "fresh_terminal_read",
              "human_handoff",
              "resolve_conflict",
              "refresh_evidence",
              "propose_correction",
              "research_or_ask",
              "ask_owner",
              "confirmed_write",
              "readback",
            ],
          },
          field_key: { type: "string", maxLength: 120, nullable: true },
          detail: { type: "string", maxLength: 500, nullable: true },
          requires_owner_input: { type: "boolean", nullable: true },
          recheck_triggers: {
            type: "array",
            maxItems: 20,
            items: { type: "string", maxLength: 120 },
          },
        },
      },
      active_question: { type: "string", maxLength: 500, nullable: true },
      completed_step_keys: {
        type: "array",
        maxItems: 50,
        items: { type: "string", maxLength: 120 },
      },
      pending_step_keys: {
        type: "array",
        maxItems: 50,
        items: { type: "string", maxLength: 120 },
      },
      blocked_step_keys: {
        type: "array",
        maxItems: 50,
        items: { type: "string", maxLength: 120 },
      },
      human_action_step_keys: {
        type: "array",
        maxItems: 50,
        items: { type: "string", maxLength: 120 },
      },
      evidence_refs: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field_key", "source_type"],
          properties: {
            field_key: { type: "string", maxLength: 120 },
            source_type: {
              type: "string",
              enum: ["mingla", "owner", "public_research", "imported"],
            },
            source_ref: { type: "string", maxLength: 300, nullable: true },
            source_url: {
              type: "string",
              maxLength: 1000,
              pattern: "^https://",
              nullable: true,
            },
            observed_at: { type: "string", maxLength: 80, nullable: true },
          },
        },
      },
      last_error_code: { type: "string", maxLength: 120, nullable: true },
    },
  },
  executor: async (args, client) => {
    const action = String(args.action);
    const needsJob = !["create", "list"].includes(action);
    if (needsJob && !isUuid(args.job_id)) {
      throw new ToolError("INVALID_ARGS", "job_id is required");
    }
    if (action === "create" && !isUuid(args.idempotency_key)) {
      throw new ToolError("INVALID_ARGS", "idempotency_key is required");
    }
    const patch: Record<string, unknown> = {};
    if (typeof args.goal_summary === "string") {
      patch.goal_summary = requiredText(
        args.goal_summary,
        "goal_summary",
        1000,
      );
    }
    if (typeof args.status === "string") patch.status = args.status;
    const checkpoint: Record<string, unknown> = {};
    if (args.current_step === null) {
      checkpoint.current_step = null;
    } else if (typeof args.current_step === "string") {
      checkpoint.current_step = requiredText(
        args.current_step,
        "current_step",
        200,
      );
    }
    if (args.next_action === null) {
      checkpoint.next_action = null;
    } else if (
      args.next_action && typeof args.next_action === "object" &&
      !Array.isArray(args.next_action)
    ) {
      checkpoint.next_action = args.next_action;
    }
    if (args.active_question === null) {
      checkpoint.active_question = null;
    } else if (typeof args.active_question === "string") {
      checkpoint.active_question = requiredText(
        args.active_question,
        "active_question",
        500,
      );
    }
    if (Array.isArray(args.blocked_step_keys)) {
      checkpoint.blocked_step_keys = args.blocked_step_keys;
    }
    if (Array.isArray(args.human_action_step_keys)) {
      checkpoint.human_action_step_keys = args.human_action_step_keys;
    }
    if (Array.isArray(args.evidence_refs)) {
      checkpoint.evidence_refs = args.evidence_refs;
    }
    if (Object.keys(checkpoint).length > 0) patch.checkpoint = checkpoint;
    if (Array.isArray(args.completed_step_keys)) {
      patch.completed_step_keys = args.completed_step_keys;
    }
    if (Array.isArray(args.pending_step_keys)) {
      patch.pending_step_keys = args.pending_step_keys;
    }
    if (typeof args.last_error_code === "string") {
      patch.last_error_code = requiredText(
        args.last_error_code,
        "last_error_code",
        120,
      );
    }
    return await callRpc(client, "ari_manage_agent_job", {
      p_action: action,
      p_job_id: isUuid(args.job_id) ? args.job_id : null,
      p_brand_id: isUuid(args.brand_id) ? args.brand_id : null,
      p_conversation_id: isUuid(args.conversation_id)
        ? args.conversation_id
        : null,
      p_idempotency_key: isUuid(args.idempotency_key)
        ? args.idempotency_key
        : null,
      p_expected_revision: typeof args.expected_revision === "number"
        ? args.expected_revision
        : null,
      p_patch: patch,
    });
  },
};

export const ARI_10X_TOOLS: AgentToolDefinition[] = [
  searchPublicWebTool,
  readPublicUrlTool,
  inspectPublicSocialProfile,
  searchCapabilities,
  requestTools,
  getOnboardingPlan,
  updateOnboardingPlan,
  listMemoryNotes,
  saveMemoryNote,
  forgetMemoryNote,
  openHandoff,
  getMarketRules,
  getListingCapabilities,
  buildHostOnboardingBlueprint,
  getCapabilityInventory,
  setRefundPolicy,
  getBuyerNoticeStatus,
  fetchPublicListingPage,
  extractListingCandidates,
  manageAgentJob,
];

export const ARI_10X_READ_ONLY = new Set([
  "search_public_web",
  "read_public_url",
  "inspect_public_social_profile",
  "search_capabilities",
  "request_tools",
  "get_onboarding_plan",
  "list_memory_notes",
  "open_handoff",
  "get_market_rules",
  "get_listing_type_capabilities",
  "build_host_onboarding_blueprint",
  "get_capability_inventory",
  "get_buyer_notice_status",
  "fetch_public_listing_page",
  "extract_listing_candidates",
  "manage_agent_job",
]);

export const ARI_10X_AGENT_STATE = new Set([
  "request_tools",
  "update_onboarding_plan",
  "save_memory_note",
  "forget_memory_note",
  "manage_agent_job",
]);

export type { AriResearchResult };
