// Issue #3355 — Ari 10x discovery, memory, plan and public-research tools.
//
// These tools are intentionally narrow. Public content is untrusted, app
// handoffs are allowlisted, memory is caller scoped in SQL, and onboarding
// progress advances through an expected-revision compare-and-swap.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AgentToolDefinition } from "./agentToolHelpers.ts";
import {
  callRpc,
  invokeFn,
  isString,
  isUuid,
  requireAgentOperationId,
  ToolError,
} from "./agentToolHelpers.ts";
import { DOMAIN_TOOLS } from "./agentDomainTools.ts";
import { SITE_AGENT_TOOLS } from "./agentSiteTools.ts";
import { READINESS_TOOLS } from "./agentReadinessTools.ts";
import { STRIPE_SUPPORTED_COUNTRIES } from "./stripeSupportedCountries.ts";
// #3355: the payout-country list lives in a leaf so the flow engine's money
// gate reads it without importing these tools (and their web research).
import {
  MARKET_DEFAULT_TIMEZONES,
  marketDefaultTimezone,
  payoutRailFor,
} from "./payoutCountries.ts";
export {
  MARKET_DEFAULT_TIMEZONES,
  marketDefaultTimezone,
  PAYOUT_COUNTRIES,
  type PayoutRail,
  payoutRailFor,
} from "./payoutCountries.ts";
import { sanitizeAriPublicText } from "./agentSanitization.ts";
// #3355 Wave D (D1): remember_note replaces save_memory_note.
import {
  ARI_MEMORY_KINDS,
  ARI_MEMORY_NOTE_MAX,
  ARI_MEMORY_SCOPES,
  rememberNoteArgs,
  rememberNoteError,
} from "./ariMemory.ts";
// #3355 Wave D (D4): "Ask the Mingla team" rides the tell_owner send.
import {
  ARI_ASK_TEAM_TOPIC,
  ASK_TEAM_ALREADY_SENT,
  askTeamNoteFromGaps,
  askTeamSentRecently,
  readAskTeamGaps,
} from "./ariGaps.ts";
import { toolBelongsTo } from "./agentToolsets.ts";
import { ARI_APP_ROUTES, ariHandoffRoute } from "./ariAppMap.ts";
import { TOOL_CAPABILITY_KEYS } from "./ariToolDescriptions.ts";
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
  ["list_events", "List the signed-in host's events and their saved details."],
  ["update_event", "Prepare an approved change to an event the host owns."],
  ["update_brand", "Prepare an approved change to a brand the host owns."],
  [
    "delete_brand",
    "Request recoverable deletion of an owned brand after confirmation.",
  ],
  ["manage_brand_hours", "Read or update a brand venue's opening hours."],
  ["list_brand_audit_log", "Read recent audit activity for an owned brand."],
  [
    "manage_brand_discovery_currency",
    "Read or manage a brand's discovery currency settings.",
  ],
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
  [
    "search_mingla_guide",
    "Search the Mingla Feature Guide for what Mingla can do and the exact steps.",
  ],
  ["request_tools", "Load a compact toolset needed for the current step."],
  ["get_onboarding_plan", "Read the user's durable onboarding plan."],
  [
    "update_onboarding_plan",
    "Create or advance the user's durable onboarding plan.",
  ],
  ["list_memory_notes", "List editable memories scoped to the user and brand."],
  [
    "remember_note",
    "Keep a short correction, preference or fact for later turns (brand or user scope).",
  ],
  ["forget_memory_note", "Remove a memory from future Ari context."],
  [
    "open_handoff",
    "Prepare an allowlisted Mingla app destination for a human-owned step.",
  ],
  [
    "tell_owner_in_brand_group",
    "After confirmation, ask the brand owner in the brand group chat to do an owner-only step.",
  ],
  [
    "get_market_rules",
    "Read deterministic country, currency and payment-rail rules.",
  ],
  [
    "set_brand_payout_country",
    "After confirmation, set the payout country (and so the price currency) of a brand that has none yet.",
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
    ...READINESS_TOOLS.map(({ name, description }) => ({ name, description })),
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

const CAPABILITY_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  tag: ["mark", "label"],
  tags: ["mark", "label"],
  waiter: ["waitlist"],
  waiters: ["waitlist"],
  order: ["reservation", "booking"],
};

function capabilityTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
}

/** Rank actual tool capabilities and require multiword intent coverage. */
export function searchAriCapabilities(
  query: string,
  limit = 12,
): Array<{ name: string; description: string; score: number }> {
  const terms = capabilityTerms(query);
  const minimumCoverage = terms.length <= 1 ? 1 : 2;
  return catalogue().map((item) => {
    const haystack = new Set(
      `${item.name} ${item.description}`.toLowerCase().match(/[a-z0-9]{3,}/g) ??
        [],
    );
    let matchedTerms = 0;
    let score = 0;
    for (const term of terms) {
      const exact = haystack.has(term);
      const synonym = (CAPABILITY_SYNONYMS[term] ?? []).some((variant) =>
        haystack.has(variant)
      );
      if (exact || synonym) matchedTerms += 1;
      if (exact) score += 2;
      else if (synonym) score += 1;
    }
    return {
      ...item,
      score: matchedTerms >= minimumCoverage ? score : 0,
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
    matches: searchAriCapabilities(
      String(args.query),
      Number(args.limit ?? 12),
    ),
    total_capabilities: catalogue().length,
  }),
};

/**
 * #3355 Wave B (B1) — Ari reads the Feature Guide (public.product_capabilities)
 * through ari_search_feature_guide, as the signed-in caller. The guide's
 * effective status decides how Ari may speak (how_to_say).
 */
const GUIDE_STATUS: Readonly<
  Record<string, { status: string; how_to_say: string }>
> = Object.freeze({
  Live: { status: "live", how_to_say: "state_as_fact" },
  "Needs review": {
    status: "needs_review",
    how_to_say: "hedge_and_point_to_the_screen",
  },
  Planned: { status: "planned", how_to_say: "not_available_yet" },
  Retired: { status: "retired", how_to_say: "not_available" },
});

/**
 * #3355 Wave F: a guide entry still claimed "planned" whose feature Ari can
 * already do with one of its own registered tools (create_discount for
 * events-discount-codes). The guide claim lags the product; the tool is the
 * ground truth for "can Ari do this", so Ari offers the tool instead of
 * saying "not available yet". Retired entries are never upgraded.
 * MINGLA-INVARIANT: I-ARI-TOOL-OUTRANKS-PLANNED-GUIDE | issue #3355 | A planned guide entry that a registered Ari tool serves is read as available through that tool, never as "not available yet".
 */
export function ariToolsForGuideKey(key: string): string[] {
  const registered = new Set(DOMAIN_TOOLS.map((tool) => tool.name));
  return Object.entries(TOOL_CAPABILITY_KEYS)
    .filter(([tool, capability]) => capability === key && registered.has(tool))
    .map(([tool]) => tool);
}

export function ariGuideReadStatus(
  guideStatus: unknown,
  key: string,
): { status: string; how_to_say: string; ari_tools: string[] } {
  const status = GUIDE_STATUS[String(guideStatus)] ??
    GUIDE_STATUS["Needs review"];
  const tools = status.status === "planned" ? ariToolsForGuideKey(key) : [];
  return tools.length > 0
    ? {
      status: "available_through_ari",
      how_to_say: "offer_the_ari_tool",
      ari_tools: tools.slice(0, 5),
    }
    : { ...status, ari_tools: [] };
}

function guideText(value: unknown, max: number): string {
  return typeof value === "string"
    ? sanitizeAriPublicText(value).text.trim().slice(0, max)
    : "";
}

function guideList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
      .slice(0, 12)
    : [];
}

const searchMinglaGuide: AgentToolDefinition = {
  name: "search_mingla_guide",
  description:
    "Search the Mingla Feature Guide: what Mingla can do, who can use it, the exact steps (how_to) and limits. Use it before saying Mingla can't do something and before giving how-to steps. status live = say it as fact; needs_review = hedge and point to the screen; planned or retired = not available; available_through_ari = Ari can do it now with the listed ari_tools, so offer that. Cite the capability_key of the entry you used.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 2, maxLength: 300 },
      limit: { type: "integer", minimum: 1, maximum: 5 },
    },
  },
  executor: async (args, client) => {
    const query = requiredText(args.query, "query", 300);
    const limit = Math.min(
      Math.max(Math.trunc(Number(args.limit ?? 3)) || 3, 1),
      5,
    );
    const { data, error } = await client.rpc("ari_search_feature_guide", {
      p_query: query,
      p_limit: limit,
    });
    if (error) {
      throw new ToolError(
        "READ_FAILED",
        "The Mingla Feature Guide could not be read just now.",
        {
          user_reason: "Ari couldn't read the Mingla guide just now.",
          next_step: null,
        },
      );
    }
    const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
    return {
      query,
      results: rows.slice(0, limit).map((row) => {
        const key = guideText(row.capability_key, 80);
        const status = ariGuideReadStatus(row.guide_status, key);
        return {
          capability_key: key,
          title: guideText(row.title, 160),
          outcome: guideText(row.outcome_summary, 600),
          how_to: guideText(row.how_to, 1500),
          limitations: guideText(row.limitations, 800),
          support_wording: guideText(row.support_wording, 600),
          who_can_use: guideList(row.who_can_use),
          surfaces: guideList(row.surfaces),
          claimed_status: guideText(row.claimed_status, 20),
          status: status.status,
          evidence_current: row.evidence_current === true,
          how_to_say: status.how_to_say,
          ...(status.ari_tools.length > 0
            ? { ari_tools: status.ari_tools }
            : {}),
          screens: ARI_APP_ROUTES.filter((route) =>
            route.capability_keys.includes(key)
          ).slice(0, 3).map((route) => ({
            route: route.pattern,
            title: route.title,
          })),
        };
      }),
      found: rows.length > 0,
    };
  },
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

// #3355 Wave D (D1): Ari's memory write. Ari-owned, reversible state (the
// host sees and deletes every note in Ari settings), so it runs in the loop
// without a card (ARI_10X_AGENT_STATE), through ari_remember_note with the
// caller's JWT. See ariMemory.ts.
const rememberNote: AgentToolDefinition = {
  name: "remember_note",
  description:
    "Keep one short note for later turns: a correction the host gave you, a lasting preference, or a fact about their business. scope brand shares it with everyone on the brand; scope user keeps it to this host. Never store emails, phone numbers, card or bank details, passwords or ID numbers. The host sees and deletes notes in Ari settings.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["scope", "kind", "text"],
    properties: {
      scope: { type: "string", enum: [...ARI_MEMORY_SCOPES] },
      kind: { type: "string", enum: [...ARI_MEMORY_KINDS] },
      text: {
        type: "string",
        minLength: 3,
        maxLength: ARI_MEMORY_NOTE_MAX,
      },
      brand_id: { type: "string", format: "uuid", nullable: true },
      evidence_message_id: { type: "string", format: "uuid", nullable: true },
    },
  },
  executor: async (args, client) => {
    const checked = rememberNoteArgs(args);
    try {
      return await callRpc(client, "ari_remember_note", {
        p_scope: checked.scope,
        p_kind: checked.kind,
        p_content: checked.text,
        p_brand_id: checked.brandId,
        p_evidence_message_id: isUuid(args.evidence_message_id)
          ? args.evidence_message_id
          : null,
      });
    } catch (error) {
      if (error instanceof ToolError && error.code !== "RPC_FAILED") {
        throw error;
      }
      throw rememberNoteError(
        error instanceof Error ? error.message : String(error),
      );
    }
  },
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

// #3355 P6 (D-11): destinations only the brand owner can finish. A teammate
// is told so in plain words instead of being sent to a screen they can't use.
const OWNER_ONLY_HANDOFFS: Readonly<Record<string, string>> = Object.freeze({
  payment_onboarding: "biz_can_mutate_payouts_for_brand_for_caller",
});

export const OWNER_ONLY_HANDOFF_MESSAGE =
  "Only the owner can do this — tell them?";

// #3355 P6 follow-up (Seth, 2026-11-01): "Tell them" drops a note in the
// brand's group chat, sent as the teammate (their sign-in, so the group's
// membership rules apply) and only after they confirm the exact words on a
// card. No group the teammate can post in → the Team screen, said plainly.
export const OWNER_NOTE_TEAM_FALLBACK =
  "There's no brand group chat you can post in, so let the owner know from the Team screen.";

/** What the owner is asked to do, per owner-only step (owner-facing words). */
export const OWNER_NOTE_TOPICS: Readonly<
  Record<string, { ask: string; where: string; destination: string }>
> = Object.freeze({
  payment_setup: {
    ask: "set up payments",
    where: "Payments",
    destination: "payment_onboarding",
  },
});

const OWNER_NOTE_TOPIC_BY_DESTINATION: Readonly<Record<string, string>> = Object
  .freeze({ payment_onboarding: "payment_setup" });

type JsonRecord = Record<string, unknown>;

/**
 * The brand's group chat the caller can post in as a team member, or null.
 * Reads the caller's own groups (issue_3720_list_brand_groups, caller JWT);
 * a support-only view never counts. A failed read is "no group": the caller
 * is sent to the Team screen instead, never told a note was sent.
 */
export async function findCallerBrandGroup(
  client: SupabaseClient,
  brandId: string,
): Promise<string | null> {
  const { data, error } = await client.rpc("issue_3720_list_brand_groups");
  if (error || !Array.isArray(data)) return null;
  const group = (data as JsonRecord[]).find((row) =>
    String(row.brand_id ?? "").toLowerCase() === brandId.toLowerCase() &&
    row.access_kind === "brand" && isUuid(row.conversation_id)
  );
  return group ? String(group.conversation_id) : null;
}

/** The note's exact words: owner-facing, no codes, ids or tool names. */
export function ownerNoteText(args: {
  teammateFirstName: string | null;
  brandName: string;
  topic: string;
}): string {
  const topic = OWNER_NOTE_TOPICS[args.topic];
  if (!topic) {
    throw new ToolError("INVALID_ARGS", "That isn't an owner-only step.");
  }
  const who = args.teammateFirstName?.trim() || "A teammate";
  return `${who} asked Ari to ${topic.ask} for ${args.brandName}. Only the owner can do this. Could you take a look? It's in Mingla Host under ${args.brandName} > ${topic.where}.`;
}

async function teammateFirstName(
  client: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await client.from("profiles")
    .select("first_name,display_name")
    .eq("id", userId).maybeSingle();
  const row = (data ?? {}) as JsonRecord;
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  if (first) return first.split(/\s+/)[0];
  const display = typeof row.display_name === "string"
    ? row.display_name.trim()
    : "";
  return display ? display.split(/\s+/)[0] : null;
}

async function brandNameFor(
  client: SupabaseClient,
  brandId: string,
): Promise<string> {
  const { data, error } = await client.from("brands").select("name")
    .eq("id", brandId).is("deleted_at", null).maybeSingle();
  const name = typeof (data as JsonRecord | null)?.name === "string"
    ? String((data as JsonRecord).name).trim()
    : "";
  if (error || !name) {
    throw new ToolError(
      "BRAND_ACCESS_DENIED",
      "That brand or resource is unavailable",
    );
  }
  return name;
}

/** The caller can do the step themselves (they don't need the owner). */
async function callerOwnsStep(
  client: SupabaseClient,
  brandId: string,
  topic: string,
): Promise<boolean> {
  const destination = OWNER_NOTE_TOPICS[topic]?.destination;
  const check = destination ? OWNER_ONLY_HANDOFFS[destination] : undefined;
  if (!check) return false;
  const { data, error } = await client.rpc(check, { p_brand_id: brandId });
  if (error) {
    throw new ToolError(
      "ROLE_CHECK_UNAVAILABLE",
      "Ari could not verify permissions right now",
    );
  }
  return data === true;
}

/**
 * Propose-time binding for tell_owner_in_brand_group: the server writes the
 * exact note (the model never supplies the words) and where it goes, so the
 * card shows precisely what will be sent. Said in plain words instead of a
 * card when the caller is the owner or has no group to post in.
 */
export async function bindOwnerNoteProposal(
  toolName: string,
  args: JsonRecord,
  client: SupabaseClient,
  userId: string,
): Promise<JsonRecord> {
  if (toolName !== "tell_owner_in_brand_group") return args;
  if (!isUuid(args.brand_id)) {
    throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
  }
  const topic = String(args.about ?? "");
  if (topic === ARI_ASK_TEAM_TOPIC) {
    return await bindAskTeamProposal(args, client, userId);
  }
  if (!OWNER_NOTE_TOPICS[topic]) {
    throw new ToolError("INVALID_ARGS", "That isn't an owner-only step.");
  }
  if (await callerOwnsStep(client, args.brand_id, topic)) {
    throw new ToolError(
      "OWNER_NOTE_NOT_NEEDED",
      `You can ${OWNER_NOTE_TOPICS[topic].ask} yourself in ${
        OWNER_NOTE_TOPICS[topic].where
      }. Nothing was sent.`,
    );
  }
  const [group, brandName, firstName] = await Promise.all([
    findCallerBrandGroup(client, args.brand_id),
    brandNameFor(client, args.brand_id),
    teammateFirstName(client, userId),
  ]);
  if (!group) {
    throw new ToolError(
      "OWNER_NOTE_UNAVAILABLE",
      `${OWNER_NOTE_TEAM_FALLBACK} Nothing was sent.`,
    );
  }
  return {
    brand_id: args.brand_id,
    about: topic,
    send_to: `${brandName} group chat`,
    message: ownerNoteText({
      teammateFirstName: firstName,
      brandName,
      topic,
    }),
  };
}

/**
 * #3355 Wave D (D4, D7a) — "Ask the Mingla team": the server writes a
 * PII-minimised note from this Ari chat's gap rows (by id, so the executor
 * rebuilds the same words), bound to the brand's own group. Refused when the
 * team was already asked from this chat within the hour.
 */
async function bindAskTeamProposal(
  args: JsonRecord,
  client: SupabaseClient,
  userId: string,
): Promise<JsonRecord> {
  const brandId = String(args.brand_id);
  if (!isUuid(args.ari_conversation_id)) {
    throw new ToolError("INVALID_ARGS", "ari_conversation_id must be a uuid");
  }
  const ariConversationId = String(args.ari_conversation_id);
  if (
    await askTeamSentRecently({ caller: client, userId, ariConversationId })
  ) {
    throw new ToolError("ASK_TEAM_RECENTLY_SENT", ASK_TEAM_ALREADY_SENT, {
      user_reason: ASK_TEAM_ALREADY_SENT,
      next_step: null,
    });
  }
  const [group, brandName, firstName, gaps] = await Promise.all([
    findCallerBrandGroup(client, brandId),
    brandNameFor(client, brandId),
    teammateFirstName(client, userId),
    readAskTeamGaps({ caller: client, ariConversationId }),
  ]);
  if (!group) {
    throw new ToolError(
      "OWNER_NOTE_UNAVAILABLE",
      `${OWNER_NOTE_TEAM_FALLBACK} Nothing was sent.`,
    );
  }
  return {
    brand_id: brandId,
    about: ARI_ASK_TEAM_TOPIC,
    ari_conversation_id: ariConversationId,
    gap_ids: gaps.map((gap) => gap.id),
    send_to: `${brandName} group chat`,
    message: askTeamNoteFromGaps({
      firstName,
      brandName,
      ariConversationId,
      gaps,
    }),
  };
}

/** The exact words the server would write today for this approval. */
async function expectedOwnerNote(
  args: JsonRecord,
  client: SupabaseClient,
  userId: string,
): Promise<string> {
  const brandId = String(args.brand_id);
  if (args.about === ARI_ASK_TEAM_TOPIC) {
    if (!isUuid(args.ari_conversation_id)) {
      throw new ToolError(
        "OWNER_NOTE_CHANGED",
        "That note is out of date, so nothing was sent. Ask me again and I'll show the new words.",
      );
    }
    const gapIds = Array.isArray(args.gap_ids)
      ? args.gap_ids.filter((id): id is string => isUuid(id))
      : [];
    const gaps = gapIds.length > 0
      ? await readAskTeamGaps({
        caller: client,
        ariConversationId: String(args.ari_conversation_id),
        gapIds,
      })
      : [];
    return askTeamNoteFromGaps({
      firstName: await teammateFirstName(client, userId),
      brandName: await brandNameFor(client, brandId),
      ariConversationId: String(args.ari_conversation_id),
      gaps,
    });
  }
  return ownerNoteText({
    teammateFirstName: await teammateFirstName(client, userId),
    brandName: await brandNameFor(client, brandId),
    topic: String(args.about ?? ""),
  });
}

/** PostgREST's answer for an RPC that doesn't exist (yet) in this database. */
export function receiptFunctionsMissing(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /Could not find the function|PGRST202|function public\.ari_tell_owner_\w+\(.*\) does not exist/
    .test(text);
}

const tellOwnerInBrandGroup: AgentToolDefinition = {
  name: "tell_owner_in_brand_group",
  description:
    "After the teammate confirms, post one note in the brand's group chat asking the owner to do an owner-only step (payment setup). Sent as the teammate. The server writes the exact words; never write your own. Offer it when open_handoff returns requires_owner with tell_owner.via brand_group; when it says team_screen, say its message and link the Team screen instead. about ask_mingla_team asks the Mingla team for help in the same group with a server-written summary (Ari offers it when a host is stuck; at most once an hour per chat).",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id", "about"],
    properties: {
      brand_id: { type: "string", format: "uuid" },
      about: {
        type: "string",
        enum: [...Object.keys(OWNER_NOTE_TOPICS), ARI_ASK_TEAM_TOPIC],
      },
      // #3355 Wave D (D4): server-bound for an ask_mingla_team note.
      ari_conversation_id: { type: "string", format: "uuid" },
      gap_ids: {
        type: "array",
        maxItems: 5,
        items: { type: "string", format: "uuid" },
      },
      send_to: { type: "string", maxLength: 200 },
      message: { type: "string", maxLength: 600 },
    },
  },
  executor: async (args, client, userId, context) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    // #3355 bundle 5: the send is keyed by the approval, so a retry after a
    // dropped connection reads back the note that posted instead of failing.
    const operationId = requireAgentOperationId(context);
    // A note that already posted for this approval is answered from its
    // receipt first: a brand renamed or a group left since must not turn a
    // sent note into "nothing was sent".
    // Until migration 20280604003355 is applied (functions deploy on merge,
    // migrations on their own go), the receipt functions don't exist yet:
    // the note is sent the way it was before, never refused.
    let receipts = true;
    let prior: Record<string, unknown> | null = null;
    try {
      prior = await callRpc<Record<string, unknown> | null>(
        client,
        "ari_tell_owner_receipt",
        { p_operation_id: operationId },
      );
    } catch (error) {
      if (!receiptFunctionsMissing(error)) throw error;
      receipts = false;
    }
    if (!(prior && prior.sent === true) && context?.retry) {
      // A retry with no receipt: the earlier attempt may have posted the old
      // way (before the migration) and lost its answer. Never post again;
      // the stuck-row reconcile settles it ("couldn't confirm it saved").
      throw new ToolError(
        "RPC_FAILED",
        "ari_tell_owner_in_brand_group: retry without a receipt",
      );
    }
    if (prior && prior.sent === true) {
      return {
        sent: true,
        message_id: prior.message_id ?? null,
        conversation_id: prior.conversation_id ?? null,
        sent_to: args.send_to ?? null,
        message: typeof args.message === "string" ? args.message : null,
      };
    }
    const conversationId = await findCallerBrandGroup(client, args.brand_id);
    if (!conversationId) {
      throw new ToolError(
        "OWNER_NOTE_UNAVAILABLE",
        `${OWNER_NOTE_TEAM_FALLBACK} Nothing was sent.`,
      );
    }
    // Send exactly the words the teammate confirmed, and only words the
    // server would write today (a stale or altered note is refused).
    const expected = await expectedOwnerNote(args, client, userId);
    if (args.message !== expected) {
      throw new ToolError(
        "OWNER_NOTE_CHANGED",
        "That note is out of date, so nothing was sent. Ask me again and I'll show the new words.",
      );
    }
    if (!receipts) {
      const messageId = await callRpc<string>(
        client,
        "issue_3720_send_brand_group_message",
        {
          p_conversation_id: conversationId,
          p_content: expected,
          p_actor_mode: "brand",
        },
      );
      return {
        sent: true,
        message_id: messageId,
        conversation_id: conversationId,
        sent_to: args.send_to ?? null,
        message: expected,
        // Sent before the receipt functions exist: confirm must not wait
        // for a receipt this send never wrote.
        receipt_backed: false,
      };
    }
    let receipt: Record<string, unknown> | null;
    try {
      receipt = await callRpc<Record<string, unknown>>(
        client,
        "ari_tell_owner_in_brand_group",
        {
          p_operation_id: operationId,
          p_conversation_id: conversationId,
          p_content: expected,
        },
      );
    } catch (error) {
      // The send and its receipt are one transaction, so these refusals are
      // certain: nothing posted. Typed here, they end the approval instead
      // of reading as "result unknown" (receipt-backed RPC_FAILED is kept
      // `executing` for a retry).
      const text = error instanceof Error ? error.message : "";
      // #3355 Wave D (D4): the team was already asked from this chat.
      if (text.includes("ask_team_recently_sent")) {
        throw new ToolError("ASK_TEAM_RECENTLY_SENT", ASK_TEAM_ALREADY_SENT, {
          user_reason: ASK_TEAM_ALREADY_SENT,
          next_step: null,
        });
      }
      if (text.includes("conversation_unavailable")) {
        throw new ToolError(
          "OWNER_NOTE_UNAVAILABLE",
          `${OWNER_NOTE_TEAM_FALLBACK} Nothing was sent.`,
        );
      }
      // (idempotency_conflict is left out: it means a receipt exists, so a
      // note may have posted — it stays "result unknown".)
      if (
        [
          "operation_binding_mismatch",
          "operation_not_executing",
          "operation_not_found",
          "invalid_message",
          "invalid_actor_mode",
        ].some((code) => text.includes(code))
      ) {
        throw new ToolError(
          "OWNER_NOTE_CHANGED",
          "That note is out of date, so nothing was sent. Ask me again and I'll show the new words.",
        );
      }
      throw error;
    }
    return {
      sent: true,
      message_id: receipt?.message_id ?? null,
      conversation_id: receipt?.conversation_id ?? conversationId,
      sent_to: args.send_to ?? null,
      message: expected,
    };
  },
};

const openHandoff: AgentToolDefinition = {
  name: "open_handoff",
  description:
    "Return an allowlisted Mingla Host route for a human-owned or screen-specific step. This never accepts an arbitrary URL. Payment setup is owner-only: for anyone else it returns requires_owner instead of a route; say the message. If tell_owner.via is brand_group, offer to tell them with tell_owner_in_brand_group (about = tell_owner.about); if it is team_screen, say tell_owner.message and link the Team screen.",
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
  executor: async (args, client) => {
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
    const reason = typeof args.reason === "string"
      ? sanitizeAriPublicText(args.reason).text.slice(0, 300)
      : null;
    const ownerCheck = OWNER_ONLY_HANDOFFS[destination];
    if (ownerCheck && isUuid(args.brand_id)) {
      const { data, error } = await client.rpc(ownerCheck, {
        p_brand_id: args.brand_id,
      });
      if (error) {
        throw new ToolError(
          "ROLE_CHECK_UNAVAILABLE",
          "Ari could not verify permissions right now",
        );
      }
      if (data !== true) {
        // "Tell them" posts in the brand group chat after the teammate
        // confirms (tell_owner_in_brand_group); Ari sends nothing on its own.
        // No group they can post in → the Team screen, said plainly.
        const teamRoute = HANDOFF_ROUTES.team.replace(
          "{brand_id}",
          String(args.brand_id),
        );
        const group = await findCallerBrandGroup(client, args.brand_id);
        return {
          destination,
          route: null,
          requires_owner: true,
          message: OWNER_ONLY_HANDOFF_MESSAGE,
          tell_owner: group
            ? {
              via: "brand_group",
              about: OWNER_NOTE_TOPIC_BY_DESTINATION[destination] ?? null,
              route: teamRoute,
              route_label: "Team",
            }
            : {
              via: "team_screen",
              message: OWNER_NOTE_TEAM_FALLBACK,
              route: teamRoute,
              route_label: "Team",
            },
          reason,
          requires_human: true,
        };
      }
    }
    // #3355 Wave B (I-ARI-HANDOFF-FIXABLE): a destination is only a route
    // when the Host App Map has that screen; otherwise say how to get there.
    return {
      destination,
      ...ariHandoffRoute(
        template.replace("{brand_id}", String(args.brand_id ?? "")),
      ),
      reason,
      requires_human: true,
    };
  },
};

function marketTimezoneFields(country: string): Record<string, unknown> {
  const known = Object.prototype.hasOwnProperty.call(
    MARKET_DEFAULT_TIMEZONES,
    country,
  );
  const timezone = marketDefaultTimezone(country);
  return {
    default_timezone: timezone,
    timezone_needs_owner_choice: timezone === null,
    ...(timezone === null && known
      ? {
        timezone_ask:
          "This country has more than one time zone. Ask the owner which one the offering is in.",
      }
      : {}),
  };
}

const getMarketRules: AgentToolDefinition = {
  name: "get_market_rules",
  description:
    "Read Mingla's deterministic payout country, currency, provider and default time zone rules. A country with several time zones returns no default: ask the owner. Unknown markets remain unknown rather than being guessed.",
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
        ...marketTimezoneFields(country),
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
        ...marketTimezoneFields(country),
      }
      : {
        country,
        supported: false,
        currency: null,
        payment_provider: null,
        requires_human_review: true,
        default_timezone: null,
        timezone_needs_owner_choice: true,
      };
  },
};

const setBrandPayoutCountry: AgentToolDefinition = {
  name: "set_brand_payout_country",
  description:
    "After the owner confirms, set the payout country of a brand that has no currency yet, which sets the currency its prices are in. The same change as choosing a payout country in the Host app (Nigeria also puts the brand on Nigerian bank payouts). Never guess the country: ask which country the owner's bank account is in.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["brand_id", "country_code"],
    properties: {
      brand_id: { type: "string", format: "uuid" },
      country_code: { type: "string", minLength: 2, maxLength: 2 },
    },
  },
  executor: async (args, client) => {
    if (!isUuid(args.brand_id)) {
      throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
    }
    const brandId = args.brand_id;
    const rail = payoutRailFor(args.country_code);
    if (!rail) {
      throw new ToolError(
        "PAYOUT_COUNTRY_UNSUPPORTED",
        "Mingla can't pay out to that country yet, so nothing was changed.",
      );
    }
    const readBrand = async () => {
      const { data, error } = await client.from("brands")
        .select("id,name,default_currency,payment_provider,payout_country")
        .eq("id", brandId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new ToolError("READ_FAILED", error.message);
      return data as {
        id: string;
        name: string;
        default_currency: string | null;
        payment_provider: string | null;
        payout_country: string | null;
      } | null;
    };
    const brand = await readBrand();
    if (!brand) {
      throw new ToolError(
        "NOT_FOUND",
        "That brand isn't available, so nothing was changed.",
      );
    }
    const current = brand.default_currency?.trim().toUpperCase() || null;
    if (current && current !== rail.currency) {
      throw new ToolError(
        "PAYOUT_COUNTRY_ALREADY_SET",
        `This brand's prices are already in ${current}. You can change the payout country in Payments setup. Nothing was changed.`,
      );
    }
    if (!current) {
      // The same writes, in the same order, as the Host chooser
      // (BrandPayoutCountryField), made as the caller.
      try {
        if (rail.provider === "paystack") {
          // The server puts the brand on the Nigerian rail and sets naira.
          await invokeFn(client, "brand-paystack-onboard", {
            action: "select_provider",
            brand_id: brandId,
          });
        } else if (
          brand.payment_provider?.trim().toLowerCase() === "paystack"
        ) {
          await invokeFn(client, "brand-paystack-onboard", {
            action: "clear_provider",
            brand_id: brandId,
          });
        }
      } catch (error) {
        if (error instanceof ToolError && error.code !== "EDGE_FAILED") {
          throw error;
        }
        throw new ToolError(
          "PAYOUT_COUNTRY_NOT_SAVED",
          rail.provider === "paystack"
            ? "I couldn't put this brand on Nigerian bank payouts, so nothing was changed. Only the brand owner can choose that, in Payments setup."
            : "I couldn't change this brand's payout country, so nothing was changed. You can choose it in Payments setup.",
        );
      }
      if (rail.provider !== "paystack") {
        const { data, error } = await client.from("brands")
          .update({ default_currency: rail.currency })
          .eq("id", brandId)
          .is("deleted_at", null)
          .select("id");
        if (error) throw new ToolError("WRITE_FAILED", error.message);
        if (!Array.isArray(data) || data.length !== 1) {
          throw new ToolError(
            "PERMISSION_DENIED",
            "Only the owner or a brand admin can choose the payout country. Nothing was changed.",
          );
        }
      }
    }
    // Remember the country itself (a currency several countries share still
    // names the one picked). Best effort, exactly as the Host: the currency
    // above is already saved either way.
    if (brand.payout_country !== rail.country) {
      await client.from("brands")
        .update({ payout_country: rail.country })
        .eq("id", brandId)
        .is("deleted_at", null)
        .select("id");
    }
    const after = await readBrand();
    if (after?.default_currency?.trim().toUpperCase() !== rail.currency) {
      throw new ToolError(
        "PAYOUT_COUNTRY_NOT_SAVED",
        "The currency didn't save, so nothing is shown as done. You can choose the payout country in Payments setup.",
      );
    }
    return {
      brand: after,
      country_code: rail.country,
      country_name: rail.name,
      currency: rail.currency,
      payout_provider: rail.provider,
    };
  },
};

function validIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

const TIMEZONE_BOUND_TOOLS: ReadonlySet<string> = new Set([
  "create_event",
  "create_trip",
]);

/**
 * #3355 P6 (D-27): Ari never proposes an offering with an empty time zone.
 * A blank zone is filled from the brand's own time zone, then from its
 * country when that country has exactly one; otherwise Ari asks before any
 * card. Bound before the card so the confirmed payload is the one shown.
 */
export async function bindProposalTimezone(
  toolName: string,
  args: Record<string, unknown>,
  client: SupabaseClient,
): Promise<Record<string, unknown>> {
  if (!TIMEZONE_BOUND_TOOLS.has(toolName)) return args;
  if (validIanaTimezone(args.timezone)) return args;
  if (!isUuid(args.brand_id)) return args;
  const { data } = await client.from("brands")
    .select("default_timezone,country_code")
    .eq("id", args.brand_id).maybeSingle();
  // Not this caller's brand: authorization answers that, not a time zone ask.
  if (!data) return args;
  const brand = data as Record<string, unknown>;
  const timezone = validIanaTimezone(brand.default_timezone)
    ? String(brand.default_timezone).trim()
    : marketDefaultTimezone(brand.country_code);
  if (!timezone) {
    throw new ToolError(
      "TIMEZONE_NEEDED",
      "Which time zone is this in? Tell me the city or time zone and I'll set it up.",
    );
  }
  return { ...args, timezone };
}

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
  searchMinglaGuide,
  requestTools,
  getOnboardingPlan,
  updateOnboardingPlan,
  listMemoryNotes,
  rememberNote,
  forgetMemoryNote,
  openHandoff,
  tellOwnerInBrandGroup,
  getMarketRules,
  setBrandPayoutCountry,
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
  "search_mingla_guide",
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
  "remember_note",
  "forget_memory_note",
  "manage_agent_job",
]);

export type { AriResearchResult };
