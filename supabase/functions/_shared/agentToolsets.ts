// Issue #3355 — compact, discoverable toolsets. The full registry stays the
// execution authority; this module selects only the tools relevant to the
// current goal and exposes a searchable capability map.

import type { AgentTool } from "./agentToolHelpers.ts";
import type { AgentLoopObservation, AgentLoopToolCall } from "./agentLoop.ts";

export type AriToolsetKey =
  | "core"
  | "brand"
  | "listings"
  | "money"
  | "marketing"
  | "people"
  | "sites"
  | "venues"
  | "research"
  | "memory"
  | "onboarding";

const TOOLSET_PATTERNS: Readonly<Record<AriToolsetKey, readonly RegExp[]>> =
  Object.freeze({
    core: [
      /^get_operator_snapshot$/,
      /^search_capabilities$/,
      /^search_mingla_guide$/,
      /^request_tools$/,
      /^get_capability_inventory$/,
    ],
    // #3355 P2 — get_brand_readiness matches /brand/; the brand-wide
    // "not now" pair travels with brand work too.
    brand: [/brand/, /profile/, /notification/, /readiness_item$/],
    listings: [
      /event/,
      /experience/,
      /rsvp/,
      /trip/,
      /ticket/,
      /listing/,
      /refund/,
      /pricing/,
    ],
    money: [
      /payout/,
      /payment/,
      /balance/,
      /order/,
      /installment/,
      /tax/,
      /refund/,
    ],
    marketing: [
      /campaign/,
      /discount/,
      /referral/,
      /ad_/,
      /growth/,
      /audience/,
      /template/,
    ],
    people: [/people/, /team/, /member/, /scanner/, /guest/, /owner/],
    sites: [/site/, /website/, /page/, /block_catalog/],
    venues: [/venue/, /reservation/, /stay/],
    research: [
      /research/,
      /public_web/,
      /public_url/,
      /social_profile/,
      /listing_page/,
    ],
    memory: [/memory/, /remember/, /ari_history/, /ari_prefs/, /agent_job/],
    onboarding: [
      /onboarding/,
      /handoff/,
      /payout_country/,
      /listing_candidates/,
      /attachment/,
      /host_onboarding_blueprint/,
    ],
  });

const INTENT_PATTERNS: ReadonlyArray<[AriToolsetKey, RegExp]> = [
  ["sites", /\b(site|website|web page|landing page)\b/i],
  [
    "people",
    /\b(people|customer|contact|csv|team|member|invite|scanner|guest list|guest check[ -]?in)\b/i,
  ],
  [
    "marketing",
    /\b(ad|campaign|promote|marketing|discount|referral|creator|growth)\b/i,
  ],
  [
    "money",
    /\b(payment|payout|bank|refund|order|revenue|tax|installment|price|fee)\b/i,
  ],
  ["venues", /\b(venue|reservation|stay|hotel|room|availability|menu)\b/i],
  [
    "research",
    /\b(search|research|online|website|social|instagram|tiktok|youtube|public page|compare sources)\b/i,
  ],
  // #3355 Wave D (D1): corrections and lasting preferences bring remember_note.
  [
    "memory",
    /\b(remember|preference|correction|forget|last time|actually|that'?s (?:wrong|not right)|i (?:said|meant)|from now on|going forward|in future|always|never)\b/i,
  ],
  [
    "onboarding",
    /\b(set up|onboard|launch my|flyer|voice note|document|materials)\b/i,
  ],
  [
    "listings",
    /\b(?:trip|experience|rsvp|ticket|package|tier|itinerary|listing|date|capacity|refund)\b|\b(?:create|make|set up|setup|schedule|host|plan|start|edit|update|change|cancel|publish|draft)\b[\s\S]{0,60}\bevents?\b(?!\s+flyer\b)|\bevents?\b(?!\s+flyer\b)[\s\S]{0,60}\b(?:create|make|set up|setup|schedule|host|plan|start|edit|update|change|cancel|publish|draft)\b/i,
  ],
  [
    "brand",
    /\b(brand|business|logo|tagline|phone|currency|timezone|country)\b/i,
  ],
];

/**
 * #3355 Wave B (B3, D3a): the keyword classifiers are hints, never the
 * router. A hint (readFlowRequest / classifyOfferingIntent) adds the
 * toolset that serves it to this turn's tools; the model still chooses.
 */
const HINT_TOOLSETS: Readonly<Record<string, readonly AriToolsetKey[]>> = Object
  .freeze({
    create_discount: ["marketing"],
    campaign: ["marketing"],
    ticket_tiers: ["listings"],
    refund: ["money", "listings"],
    payouts: ["money"],
    team: ["people"],
    website: ["sites"],
    readiness: ["brand"],
    create_event: ["listings"],
    create_experience: ["listings"],
    create_trip: ["listings"],
    create_venue: ["venues"],
    create_stay: ["venues"],
  });

export function ariToolsetsForHints(
  hints: readonly (string | null | undefined)[],
): AriToolsetKey[] {
  const selected = new Set<AriToolsetKey>();
  for (const hint of hints) {
    if (typeof hint !== "string") continue;
    for (const key of HINT_TOOLSETS[hint] ?? []) selected.add(key);
  }
  return [...selected];
}

/**
 * #3355 ship-prep — origin/main's toolset inference (811c033211), for the
 * rollout switch's off path: no classifier hints, and the memory toolset only
 * on its original words. [TRANSITIONAL] off path — exit: rollout
 * ari-understand-first-3355 active at 100% for every brand.
 */
const LEGACY_MEMORY_INTENT =
  /\b(remember|preference|correction|forget|last time)\b/i;

export function inferLegacyAriToolsets(text: string): AriToolsetKey[] {
  const selected = new Set<AriToolsetKey>(["core"]);
  for (const [key, pattern] of INTENT_PATTERNS) {
    const legacyPattern = key === "memory" ? LEGACY_MEMORY_INTENT : pattern;
    if (legacyPattern.test(text)) selected.add(key);
  }
  if (selected.size === 1) selected.add("brand");
  return [...selected];
}

export function inferAriToolsets(
  text: string,
  hints: readonly (string | null | undefined)[] = [],
): AriToolsetKey[] {
  const selected = new Set<AriToolsetKey>(["core"]);
  for (const [key, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) selected.add(key);
  }
  for (const key of ariToolsetsForHints(hints)) selected.add(key);
  if (selected.size === 1) selected.add("brand");
  return [...selected];
}

export function toolBelongsTo(toolName: string, key: AriToolsetKey): boolean {
  return TOOLSET_PATTERNS[key].some((pattern) => pattern.test(toolName));
}

export function selectAriTools(
  all: readonly AgentTool[],
  keys: readonly AriToolsetKey[],
  maxTools = 40,
  query = "",
): AgentTool[] {
  const queryTerms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) =>
    term.length > 2
  );
  const tripFinanceRequested = queryTerms.some((term) =>
    ["installment", "installments", "order", "orders", "payment", "refund"]
      .includes(term)
  );
  const eventMoneyReadRequested =
    /\b(?:order|orders|sales|revenue|refund|payment|payments|payout|money|transaction|transactions)\b/i
      .test(query);
  // Follow-up turns often omit "trip" but still say "per-person package".
  // Treat that as trip pricing intent so a mention of the brand's currency
  // does not route a package write into brand settings.
  const tripTierRequested =
    /\b(?:trip|per[ -]?person)\b[\s\S]{0,80}\b(?:package|tier|deposit|price|capacity)\b|\b(?:package|tier)\b[\s\S]{0,80}\b(?:trip|per[ -]?person)\b/i
      .test(query);
  // #3355 P9 (audit D-22): a host setting up a stay or a venue needs its
  // venues listed, never the guest booking tools (quote, reserve, approve).
  const hostVenueCreate = keys.includes("venues") &&
    /\b(?:create|make|set\s*up|setup|add|build|start|list)\b[\s\S]{0,60}\b(?:stays?|venues?|guest\s?houses?|hotels?|rooms?)\b/i
      .test(query) &&
    !/\b(?:book|booking|bookings|reserve|reservation|reservations|quote|approve|decline|cancel)\b/i
      .test(query);
  const selected = all.filter((tool) =>
    keys.some((key) => toolBelongsTo(tool.name, key)) &&
    !(
      hostVenueCreate &&
      /^(quote_stay|create_stay_reservation|transition_stay|create_venue_reservation|transition_venue_reservation)$/
        .test(tool.name)
    ) &&
    // Toolsets overlap by name (for example, manage_brand_people is both a
    // brand and a people tool). Do not load the more sensitive people tools
    // for generic brand settings questions unless people intent was detected.
    (keys.includes("people") || !toolBelongsTo(tool.name, "people")) &&
    !(
      keys.includes("listings") && !tripFinanceRequested &&
        /^(get_trip_order_money|list_trip_installments|cancel_trip_booking)$/
          .test(tool.name) ||
      keys.includes("listings") && !eventMoneyReadRequested &&
        /^(list_event_orders|get_event_order_reconciliation)$/
          .test(tool.name)
    )
  );
  const core = all.filter((tool) => toolBelongsTo(tool.name, "core"));
  const unique = new Map<string, AgentTool>();
  for (const tool of core) unique.set(tool.name, tool);

  const terms = queryTerms;
  const actionWords = new Set([
    "add",
    "change",
    "create",
    "delete",
    "draft",
    "edit",
    "invite",
    "make",
    "manage",
    "publish",
    "remove",
    "set",
    "update",
  ]);
  const requestIsWrite = terms.some((term) => actionWords.has(term));
  const priority: Record<string, number> = {
    get_operator_snapshot: 80,
    search_capabilities: 78,
    search_mingla_guide: 77,
    list_brands: 75,
    list_events: 70,
    request_tools: 68,
    get_capability_inventory: 66,
    get_brand_site: 64,
    search_public_web: 62,
    read_public_url: 60,
    inspect_public_social_profile: 58,
    fetch_public_listing_page: 56,
    // #3355 P2: the saved onboarding plan stays in a tight window now that
    // the brand checklist read competes for the same brand slots.
    get_onboarding_plan: 55,
    build_host_onboarding_blueprint: 54,
    compare_listing_candidate_sources: 52,
    extract_listing_candidates: 50,
  };
  const ranked = selected.map((tool, index) => {
    const haystack = `${tool.name} ${tool.description}`.toLowerCase();
    const nameTokens = tool.name.split("_").filter((term) =>
      term.length > 2 && !actionWords.has(term) &&
      !["list", "get", "read", "search", "find", "check"].includes(term)
    );
    const readBonus =
      /^(get|list|search|read|inspect|fetch|preview|compare|check|lookup|extract)_/
          .test(
            tool.name,
          )
        ? 18
        : 0;
    const writePenalty =
      /^(create|update|delete|manage|set|invite|revoke|publish|send|transfer)_/
          .test(
            tool.name,
          )
        ? requestIsWrite ? 0 : -12
        : 0;
    const termScore = terms.reduce(
      (score, term) => score + (haystack.includes(term) ? 4 : 0),
      0,
    );
    // Keep direct requested actions in the compact tool window. Without this
    // boost, broad generic reads can crowd out a literal "create trip" request.
    const directIntentScore = nameTokens.reduce(
      (score, token) => score + (terms.includes(token) ? 90 : 0),
      0,
    );
    const venueListScore =
      hostVenueCreate && tool.name === "list_venue_listings" ? 150 : 0;
    const tripPricingScore =
      tripTierRequested && tool.name === "manage_trip_tiers"
        ? 180
        : tripTierRequested && tool.name === "manage_brand_discovery_currency"
        ? -120
        : 0;
    return {
      tool,
      index,
      score: (priority[tool.name] ?? 0) + readBonus + writePenalty + termScore +
        directIntentScore + tripPricingScore + venueListScore,
    };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  for (const { tool } of ranked) unique.set(tool.name, tool);
  return [...unique.values()].slice(0, Math.max(8, Math.min(maxTools, 60)));
}

/** Keep brand setup turns on their read/plan lane until a specific write is requested. */
export function selectAriOnboardingSetupTools(
  all: readonly AgentTool[],
): AgentTool[] {
  const allowed = new Set([
    "get_operator_snapshot",
    "get_brand_readiness",
    "get_onboarding_plan",
    "build_host_onboarding_blueprint",
    "update_onboarding_plan",
    "get_market_rules",
  ]);
  return all.filter((tool) => allowed.has(tool.name));
}

export function needsAriCampaignWorkflow(text: string): boolean {
  return /\b(?:campaign|promote|promotion)\b/i.test(text) &&
    !/\bcampaign\s+report\b|\breport\s+for\s+campaign\b/i.test(text);
}

export function needsAriCampaignPerformanceRead(text: string): boolean {
  return needsAriCampaignWorkflow(text) &&
    !/\b(?:review|inspect)\s+(?:the\s+)?(?:saved\s+)?campaign\s+draft\b/i
      .test(text) &&
    /\b(?:what\s+has\s+worked|worked\s+recently|recent\s+(?:results|performance)|available\s+results|analytics)\b/i
      .test(text);
}

export function needsAriCampaignDraftReview(text: string): boolean {
  return /\b(?:review|inspect|read\s+back|show\s+me)\b[\s\S]{0,50}\b(?:saved\s+)?campaign\s+draft\b/i
    .test(text) ||
    /\b(?:saved\s+campaign\s+draft|campaign\s+draft)\b[\s\S]{0,40}\b(?:review|inspect|read\s+back)\b/i
      .test(text);
}

/** Find only the most recent campaign draft id explicitly read or changed in this conversation. */
export function findAriCampaignDraftId(
  history: readonly unknown[],
): string | null {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const value of [...history].reverse()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const toolCall = row.tool_calls && typeof row.tool_calls === "object"
      ? row.tool_calls as Record<string, unknown>
      : null;
    const toolResult = row.tool_results && typeof row.tool_results === "object"
      ? row.tool_results as Record<string, unknown>
      : null;
    if (
      toolCall &&
      (toolCall.tool_name === "update_campaign_draft" ||
        toolCall.tool_name === "get_campaign_draft")
    ) {
      const args = toolCall.args && typeof toolCall.args === "object"
        ? toolCall.args as Record<string, unknown>
        : {};
      if (typeof args.campaign_id === "string" && uuid.test(args.campaign_id)) {
        return args.campaign_id;
      }
    }
    if (
      toolResult &&
      (toolResult.tool_name === "draft_campaign" ||
        toolResult.tool_name === "update_campaign_draft" ||
        toolResult.tool_name === "get_campaign_draft")
    ) {
      const result = toolResult.result && typeof toolResult.result === "object"
        ? toolResult.result as Record<string, unknown>
        : {};
      if (typeof result.id === "string" && uuid.test(result.id)) {
        return result.id;
      }
    }
  }
  return null;
}

/** A campaign drafting turn should not surface another campaign's report or unrelated writes. */
export function selectAriCampaignWorkflowTools(
  all: readonly AgentTool[],
): AgentTool[] {
  const allowed = new Set([
    "get_brand_analytics",
    "draft_campaign",
    "update_campaign_draft",
    "get_campaign_draft",
  ]);
  return all.filter((tool) => allowed.has(tool.name));
}

/**
 * Broad goals should begin with Mingla's capability map instead of prompting a
 * small model to guess which product feature implements the request. Specific
 * CRUD requests still go directly to their scoped toolset.
 */
/** A request to Mingla support ("open a support ticket", "my support request"). */
export const ARI_SUPPORT_REQUEST =
  /\bsupport\s+(?:ticket|request|team|chat|case)s?\b|\b(?:open|raise|file|submit|log|create|send|start)\s+(?:a\s+|an\s+|my\s+)?(?:support\s+)?(?:ticket|request|case)\b/i;

export function needsAriCapabilityDiscovery(text: string): boolean {
  return /\b(?:host\s+promotion|promotion\s+plan|marketing\s+plan|growth\s+plan|launch\s+strategy|what\s+can\s+(?:ari|mingla)|can\s+(?:ari|mingla)\s+help|available\s+capabilit(?:y|ies))\b/i
    .test(text);
}

export function buildAriCapabilityPlan(
  request: string,
  brandName: string | null,
  capabilityMatches: readonly (string | {
    name: string;
    description?: string;
  })[],
): string | null {
  if (!needsAriCapabilityDiscovery(request)) return null;
  const brand = brandName?.trim() || "your brand";
  const capabilityNames = capabilityMatches.flatMap((item) =>
    typeof item === "string" ? [item] : [item.name]
  );
  const isPromotionPlan =
    /\b(?:host\s+promotion|promotion\s+plan|marketing\s+plan|growth\s+plan|launch\s+strategy)\b/i
      .test(request);
  if (!isPromotionPlan) {
    const hoursMatch = capabilityMatches.find((item) =>
      typeof item !== "string" && item.name === "manage_brand_hours"
    );
    if (
      /\b(?:opening\s+hours|business\s+hours)\b/i.test(request) && hoursMatch
    ) {
      return `Ari can read or update ${brand}'s venue opening hours as a complete seven-day schedule. Tell me which venue and the hours for each day; I’ll show the proposed change for your approval before anything is saved.`;
    }
    const descriptions = capabilityMatches.flatMap((item) =>
      typeof item === "string"
        ? []
        : typeof item.description === "string" && item.description.trim()
        ? [item.description.trim()]
        : []
    ).slice(0, 3);
    if (descriptions.length === 0) {
      return `I couldn't find a matching Ari capability for that request in ${brand}'s available tools. Tell me the outcome you want, and I’ll check the closest supported path.`;
    }
    return `I checked ${brand}'s available capabilities. Ari can help with: ${
      descriptions.join("; ")
    }. Tell me which result you want, and I’ll prepare the right next step for review.`;
  }
  const hasCampaigns = capabilityNames.some((name) =>
    /(?:ad|campaign|audience|discount|referral)/i.test(name)
  );
  const launchStep = hasCampaigns
    ? "Prepare the audience, budget and campaign for your approval. Nothing spends or launches until you confirm it."
    : "Prepare the promotion and its exact audience for your approval before anything is launched.";
  return `Here’s a practical promotion plan for ${brand}:

1. Set the goal — choose awareness, ticket sales, bookings, repeat visits or follower growth.
2. Choose what to promote — an existing listing, a new event, an offer or the brand itself.
3. Prepare the story — align the headline, visual, landing destination and offer with the audience.
4. Review the launch — ${launchStep}
5. Measure and improve — compare reach, clicks, conversions and sales, then adjust the weakest step.

I found the Mingla capabilities needed to support this plan. Nothing has been created, published or charged. To make the plan specific, tell me the main goal, what you want to promote, the audience, timing and budget.`;
}

export function needsAriOnboardingResumeRead(text: string): boolean {
  return /\b(?:next\s+steps?\s+after\s+accepting|greeting\s+after\s+silence\s+resumes?\s+plan|resume\s+(?:the\s+)?(?:onboarding|setup|launch)\s+plan|continue\s+(?:the\s+)?(?:onboarding|setup|launch)\s+plan)\b/i
    .test(text);
}

/** Existing-brand setup work should use the durable onboarding workflow. */
export function needsAriOnboardingSetupRead(text: string): boolean {
  const setupIntent =
    /\b(?:set\s*up|setup|onboard|onboarding)\b[\s\S]{0,80}\b(?:brand|business|host|profile|my|this|the)\b|\b(?:brand|business|host)\b[\s\S]{0,80}\b(?:set\s*up|setup|onboard|onboarding)\b/i;
  const explicitLaunchIntent =
    /\blaunch\s+(?:my|this|the)\s+(?:brand|business|host|profile)\b|\b(?:my|this|the)\s+(?:brand|business|host|profile)\s+launch\b/i;
  // #3355 P1 (D-20): "set up a trip for my brand" is offering work, not brand
  // onboarding. Only an offering that is the object of the setup verb counts:
  // "set up my brand … event flyer to add later" is still onboarding.
  return (setupIntent.test(text) || explicitLaunchIntent.test(text)) &&
    !/\bwebsite\b/i.test(text) && !ARI_OFFERING_SETUP.test(text);
}

/** A setup verb whose object is an offering ("set up a trip", "plan my events"). */
const ARI_OFFERING_SETUP =
  /\b(?:set\s*up|setup|create|plan|build|launch|make|organi[sz]e)\s+(?:(?:a|an|my|our|the|this|that|new|first|next|some)\s+){0,3}(?:events?|trips?|experiences?|class(?:es)?|rsvps?|venues?|listings?|campaigns?|tickets?|itinerar(?:y|ies)|stays?)\b/i;

/** Nouns that name an offering workflow, never brand onboarding. */
const ARI_OFFERING_NOUN =
  /\b(?:events?|trips?|experiences?|class(?:es)?|rsvps?|venues?|listings?|campaigns?|tickets?|itinerar(?:y|ies)|stays?)\b/i;

/** Follow-up values belong to the active setup checklist, not a new task. */
export function isAriOnboardingPlanProgressMessage(text: string): boolean {
  // An active onboarding checklist must not capture a follow-up that clearly
  // belongs to another product workflow. For example, a trip date request
  // contains “timezone” and “set”, but must continue through trip tools.
  if (ARI_OFFERING_NOUN.test(text)) {
    return false;
  }
  return /\b(?:currency|timezone|time zone|logo|flyer|materials?|profile|business description|social links?)\b/i
    .test(text) &&
    /\b(?:use|set|mark|keep|leave|preserve|record|save|show|remaining|still needed|add later)\b/i
      .test(text);
}

/** Prepare a caller-scoped progress write; it changes Ari's plan, never the brand. */
export function buildAriOnboardingSetupPlanCall(args: {
  text: string;
  brandId: string | null;
  brandName: string | null;
  existingPlan: unknown;
  hasAttachments: boolean;
}): AgentLoopToolCall {
  const plan = args.existingPlan && typeof args.existingPlan === "object" &&
      !Array.isArray(args.existingPlan)
    ? args.existingPlan as Record<string, unknown>
    : {};
  const oldState = plan.state && typeof plan.state === "object" &&
      !Array.isArray(plan.state)
    ? plan.state as Record<string, unknown>
    : {};
  const previousDetails = Array.isArray(oldState.owner_provided_details)
    ? oldState.owner_provided_details.filter((value): value is string =>
      typeof value === "string"
    )
    : [];
  const detail = args.text.trim().slice(0, 1000);
  const details = previousDetails.includes(detail)
    ? previousDetails
    : [...previousDetails.slice(-7), detail];
  const futureMaterials = [
    ...new Set([
      ...(Array.isArray(oldState.future_materials)
        ? oldState.future_materials.filter((value): value is string =>
          typeof value === "string"
        )
        : []),
      ...((/\blogo\b/i.test(args.text)) ? ["logo"] : []),
      ...((/\bflyers?\b/i.test(args.text)) ? ["event flyer"] : []),
      ...((/\b(?:document|pdf)\b/i.test(args.text)) ? ["document"] : []),
    ]),
  ];
  const blueprintSteps = [
    ["materials", "Read supplied materials"],
    ["brand", "Create or select the brand"],
    ["market", "Confirm country, currency and timezone"],
    ["listing_type", "Choose the right listing type"],
    ["offerings", "Set up events, trips, experiences and venues"],
    ["pricing", "Confirm tickets, capacity, fees and policies"],
    ["media", "Add covers, logos, galleries and video"],
    ["payments", "Complete payout and legal handoffs"],
    ["preview", "Preview and publish after approval"],
    ["verification", "Verify the public page"],
    ["handover", "Invite the owner and prepare a launch message"],
  ];
  const priorSteps = Array.isArray(oldState.steps) ? oldState.steps : [];
  const steps = blueprintSteps.map(([key, title]) => {
    const existing = priorSteps.find((step) =>
      !!step && typeof step === "object" &&
      (step as Record<string, unknown>).key === key
    ) as Record<string, unknown> | undefined;
    const status = key === "brand" && args.brandId
      ? "completed"
      : existing && typeof existing.status === "string"
      ? existing.status
      : "pending";
    return {
      key,
      title,
      status,
      human_owned: key === "payments" || key === "preview" ||
        key === "handover",
    };
  });
  const firstPending = steps.find((step) =>
    step.status !== "completed" && step.status !== "done"
  );
  const revision = Number.isInteger(plan.revision) &&
      (plan.revision as number) >= 0
    ? plan.revision as number
    : 0;
  return {
    name: "update_onboarding_plan",
    args: {
      brand_id: args.brandId,
      mode: "self_serve",
      expected_revision: revision,
      patch: {
        ...oldState,
        goal: typeof oldState.goal === "string"
          ? oldState.goal
          : `Set up ${args.brandName?.trim() || "this business"}`,
        status: "active",
        current_step: firstPending?.key ?? "handover",
        brand_name: args.brandName?.trim() || null,
        owner_provided_details: details,
        future_materials: futureMaterials,
        materials_attached: args.hasAttachments ||
          oldState.materials_attached === true,
        steps,
      },
      evidence: {
        ...(plan.evidence && typeof plan.evidence === "object" &&
            !Array.isArray(plan.evidence)
          ? plan.evidence as Record<string, unknown>
          : {}),
        last_updated_from: "owner_message",
      },
    },
  };
}

/** Safe copy for the narrow, deterministic existing-brand setup lane. */
export function buildAriOnboardingSetupReply(
  observations: readonly AgentLoopObservation[],
  brandName: string | null,
): string | null {
  const update = observations.find((item) =>
    item.tool === "update_onboarding_plan"
  );
  if (!update || update.error) {
    return `I checked the setup status for ${
      brandName?.trim() || "this brand"
    }, but couldn't save the onboarding checklist. Nothing changed on the brand profile or any listing. Please try again.`;
  }
  const planResult = observations.find((item) =>
    item.tool === "update_onboarding_plan" && !item.error
  )?.result;
  const state = planResult && typeof planResult === "object" &&
      !Array.isArray(planResult) &&
      (planResult as Record<string, unknown>).state &&
      typeof (planResult as Record<string, unknown>).state === "object"
    ? (planResult as Record<string, unknown>).state as Record<string, unknown>
    : {};
  const details = Array.isArray(state.owner_provided_details)
    ? state.owner_provided_details.filter((value): value is string =>
      typeof value === "string"
    ).slice(-3)
    : [];
  const materials = Array.isArray(state.future_materials)
    ? state.future_materials.filter((value): value is string =>
      typeof value === "string"
    )
    : [];
  const detailText = details.join("\n");
  const facts: string[] = [];
  const location = new RegExp(
    "\\bin\\s+([A-Z][A-Za-z' -]{1,40})(?=[,.;\\n])",
  ).exec(detailText)?.[1]?.trim();
  const businessType = new RegExp("\\bbusiness\\s+is\\s+([^.;\\n]+)", "i")
    .exec(detailText)?.[1]?.trim();
  const currency = new RegExp(
    "\\b(NGN|USD|GBP|EUR|CAD|AUD|GHS|KES|ZAR)\\b",
    "i",
  ).exec(detailText)?.[1]?.toUpperCase();
  const timezone = new RegExp(
    "\\b(?:Africa|America|Europe|Asia|Australia|Pacific)/[A-Za-z_+-]+(?:/[A-Za-z_+-]+)?\\b",
  ).exec(detailText)?.[0];
  if (location) facts.push("Location: " + location);
  if (businessType) facts.push("Business type: " + businessType);
  if (currency) facts.push("Currency: " + currency);
  if (timezone) facts.push("Timezone: " + timezone);
  const detailCopy = facts.length
    ? "Saved to the onboarding checklist: " + facts.join("; ") + ". "
    : "I saved the setup details you provided to the onboarding checklist. ";
  const materialCopy = materials.length
    ? "Marked to add later: " + materials.join(" and ") +
      (state.materials_attached === true
        ? ". A file is attached in this conversation but has not been inspected. "
        : ". They were not attached or inspected. ")
    : "No future material was marked as received. ";
  const snapshot = observations.find((item) =>
    item.tool === "get_operator_snapshot" && !item.error
  )?.result;
  const profile = snapshot && typeof snapshot === "object" &&
      !Array.isArray(snapshot) &&
      (snapshot as Record<string, unknown>).selected_brand &&
      typeof (snapshot as Record<string, unknown>).selected_brand === "object"
    ? (snapshot as Record<string, unknown>).selected_brand as Record<
      string,
      unknown
    >
    : null;
  // #3355 P2: what the brand still needs comes from the canonical checklist
  // summary (brand_readiness) inside the snapshot, never a list made here.
  const readiness = profile && profile.readiness &&
      typeof profile.readiness === "object" &&
      !Array.isArray(profile.readiness)
    ? profile.readiness as Record<string, unknown>
    : null;
  const gaps = readiness && Array.isArray(readiness.items)
    ? readiness.items.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }
      const item = value as Record<string, unknown>;
      return ["identity", "contact", "location", "media"].includes(
          String(item.group),
        ) &&
          item.severity !== "done" &&
          typeof item.label === "string" && typeof item.key === "string"
        ? [{ key: item.key, label: item.label.toLowerCase() }]
        : [];
    })
    : [];
  const missing = gaps.map((gap) => gap.key);
  const missingCopy = gaps.length
    ? "The brand checklist still needs: " +
      gaps.map((gap) => gap.label).join(", ") + ". "
    : "";
  const hasCurrency = /\b(?:NGN|USD|GBP|EUR|CAD|AUD|GHS|KES|ZAR)\b/i.test(
    detailText,
  );
  const hasTimezone =
    /\b(?:Africa|America|Europe|Asia|Australia|Pacific)\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?\b/
      .test(detailText);
  const nextQuestion = !hasCurrency || !hasTimezone
    ? "What " + (!hasCurrency && !hasTimezone
      ? "currency and timezone"
      : !hasCurrency
      ? "currency"
      : "timezone") +
      " should I record?"
    : missing.includes("description")
    ? "What exact public description should the brand profile use?"
    : "Which missing profile detail should we work on next?";
  return "I matched " + (brandName?.trim() || "your business") +
    " to the selected brand and saved a private onboarding checklist. " +
    detailCopy + materialCopy + missingCopy +
    "The brand profile, events, payments and public page are unchanged. I’ll show the exact profile fields and values and ask for your approval before changing or publishing anything. " +
    nextQuestion;
}

export function buildAriOnboardingResumeReply(
  plan: unknown,
  brandName: string | null,
): string {
  const brand = brandName?.trim() || "this brand";
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return `I checked the saved onboarding work for ${brand}, but there is no active plan to resume yet. Tell me what you accepted or what you were setting up, and I’ll rebuild the next steps without claiming anything was completed.`;
  }
  const record = plan as Record<string, unknown>;
  const state = record.state && typeof record.state === "object" &&
      !Array.isArray(record.state)
    ? record.state as Record<string, unknown>
    : record;
  const steps = Array.isArray(state.steps) ? state.steps : [];
  const remaining = steps.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const step = value as Record<string, unknown>;
    if (step.status === "completed" || step.status === "done") return [];
    const label = typeof step.label === "string"
      ? step.label
      : typeof step.title === "string"
      ? step.title
      : typeof step.id === "string"
      ? step.id.replaceAll("_", " ")
      : null;
    return label ? [label] : [];
  });
  const next = remaining[0] || "review the saved setup details";
  return `I found the saved onboarding plan for ${brand}. The next step is to ${next}. I’ll continue from that checkpoint and will not repeat completed work or make a protected change without your approval.`;
}

/** High-confidence safety answers that must not depend on model phrasing. */
export function ariDeterministicSafetyReply(text: string): string | null {
  if (
    /\bbank[- ]like\b[\s\S]{0,40}\bphone\b|\bphone\b[\s\S]{0,40}\bbank[- ]like\b/i
      .test(text)
  ) {
    return "That number could be sensitive financial information, so I won’t save or repeat it as a phone number. Confirm what the number represents and, if it is a phone number, enter it in the brand profile rather than sharing bank details in chat. Nothing was changed.";
  }
  if (
    /\b(?:bank\s+(?:account\s+)?number|account\s+number|routing\s+number|sort\s+code|bank\s+details)\b/i
      .test(text)
  ) {
    return "Please don’t send bank-account or routing details in Ari chat. Use Mingla’s protected payout setup screen instead. I did not store, repeat or act on financial details from this message.";
  }
  if (
    /\b(?:82|eighty[- ]two)[ -]seconds?\b[\s\S]{0,40}\bvideo\b|\bvideo\b[\s\S]{0,40}\b(?:82|eighty[- ]two)[ -]seconds?\b/i
      .test(text)
  ) {
    return "That cover video is longer than Mingla’s 15-second limit. Choose or trim it to 15 seconds or less before attaching it. I did not upload or change the cover.";
  }
  return null;
}

export type AriDeterministicReadIntent =
  | "existing_brands"
  | "brand_team"
  | "event_list"
  | "saved_event"
  | "market_rules"
  | "listing_capabilities"
  | "listing_candidates"
  | "campaign_draft";

export interface AriDeterministicReadPlan {
  intent: AriDeterministicReadIntent;
  calls: AgentLoopToolCall[];
  targetTitle?: string;
}

/**
 * Route narrow, read-only product questions to their canonical Mingla read
 * before asking a model to guess. The patterns describe user intent rather
 * than scenario ids, so the same lane serves ordinary phrasing in Host.
 */
export function ariDeterministicReadPlan(
  text: string,
  brandId: string | null,
  taskTitle?: string | null,
  hasAttachments = false,
  campaignDraftId?: string | null,
  /** #3355 ship-prep: the rollout switch's off path keeps origin/main's lanes. */
  options: { legacy?: boolean } = {},
): AriDeterministicReadPlan | null {
  if (brandId && campaignDraftId && needsAriCampaignDraftReview(text)) {
    return {
      intent: "campaign_draft",
      calls: [{
        name: "get_campaign_draft",
        args: { campaign_id: campaignDraftId },
      }],
    };
  }
  const explicitSavedEventReadback =
    /\bread\s+back\b[\s\S]{0,50}\b(?:saved|created|draft|event)\b/i.test(
      text,
    ) ||
    /\b(?:check|verify|confirm)\b[\s\S]{0,35}\b(?:that\s+)?(?:the\s+)?(?:(?:saved|created|published)\s+)?(?:draft|event|listing)\b/i
      .test(text);
  const containsEventWriteIntent =
    /\b(?:add|create|make|set|change|update|edit|prepare|save|publish|cancel|delete)\b[\s\S]{0,90}\b(?:ticket|tier|event|draft|listing)\b/i
      .test(text);
  const containsTicketWriteIntent =
    /\b(?:add|create|make|set|change|update|edit|prepare|save|publish|cancel|delete)\b[\s\S]{0,120}\b(?:ticket|tier)\b/i
      .test(text);
  if (brandId && explicitSavedEventReadback && !containsEventWriteIntent) {
    return {
      intent: "saved_event",
      calls: [{
        name: "list_events",
        args: { brand_id: brandId, upcoming_only: false, limit: 50 },
      }],
      ...(typeof taskTitle === "string" && taskTitle.trim()
        ? { targetTitle: taskTitle.trim() }
        : {}),
    };
  }
  if (
    brandId &&
    /\b(?:list|show|find|which|what|see)\s+(?:(?:me|my|the|all|upcoming|current|saved|draft|published)\s+){0,3}events?\b/i
      .test(text) &&
    !containsEventWriteIntent &&
    !containsTicketWriteIntent &&
    !/\b(?:market|pricing|price|support|capabilit\w*|platform|rules?|bookable|ticketing)\b/i
      .test(text)
  ) {
    return {
      intent: "event_list",
      calls: [{
        name: "list_events",
        args: { brand_id: brandId, upcoming_only: false, limit: 50 },
      }],
    };
  }
  if (
    /\b(?:existing|current|available)\s+brands?\b/i.test(text) ||
    /\bbrand\b[\s\S]{0,40}\b(?:already\s+exists?|admin\s+invite)\b/i.test(text)
  ) {
    return {
      intent: "existing_brands",
      calls: [{ name: "list_brands", args: { limit: 20 } }],
    };
  }
  if (
    brandId &&
    /\b(?:owner|team|member)\b[\s\S]{0,40}\b(?:invite|invitation)\b[\s\S]{0,24}\b(?:missing|not\s+found|status|pending)\b/i
      .test(text)
  ) {
    return {
      intent: "brand_team",
      calls: [{ name: "list_brand_team", args: { brand_id: brandId } }],
    };
  }
  const materialMentioned =
    /\b(?:flyers?|voice\s+notes?|images?|documents?|materials?)\b/i.test(text);
  const explicitMaterialRead =
    /\b(?:read|extract|compare|inspect|review|summari[sz]e)\b[\s\S]{0,50}\b(?:flyers?|voice\s+notes?|images?|documents?|materials?)\b/i
      .test(text) ||
    /\b(?:attached|uploaded|provided|supplied)\b[\s\S]{0,30}\b(?:flyers?|voice\s+notes?|images?|documents?|materials?)\b/i
      .test(text);
  const materialConflict = materialMentioned &&
    /\b(?:vs\.?|versus|differs?|conflicts?|reversed)\b/i.test(text);
  if (
    hasAttachments && materialMentioned || explicitMaterialRead ||
    materialConflict ||
    /\b(?:date|time|address|price)\b[\s\S]{0,30}\b(?:differs?|conflicts?|changing|reversed)\b/i
      .test(text)
  ) {
    const parts = text.split(/\s+(?:vs\.?|versus)\s+|\s+differs?\s+from\s+/i);
    return {
      intent: "listing_candidates",
      calls: [{
        name: "extract_listing_candidates",
        args: parts.length > 1
          ? {
            text: parts[0],
            source_label: "supplied material",
            comparison_text: parts.slice(1).join(" versus "),
            comparison_label: "message text",
          }
          : { text, source_label: "request" },
      }],
    };
  }
  const listingType =
    /\b(?:charter|bookable\s+class|class\s+booking)\b/i.test(text)
      ? "experience"
      : /\btrip\b/i.test(text)
      ? "trip"
      : /\brsvp\b/i.test(text)
      ? "rsvp"
      : /\b(?:event|ticket)\b/i.test(text)
      ? "event"
      : null;
  // A request to build an offering can mention currency or price as a
  // constraint (often to say not to invent it). Do not let the narrow market
  // lookup lane consume that write request and report success without
  // creating or proposing the requested listing.
  const containsOfferingWriteIntent =
    /\b(?:create|make|set\s+up|set|update|edit|change|patch|replace|schedule|host|plan|start|add|build)\b[\s\S]{0,100}\b(?:event|trip|experience|class|rsvp|venue|listing|draft)\b/i
      .test(text) ||
    /\b(?:event|trip|experience|class|rsvp|venue|listing|draft)\b[\s\S]{0,100}\b(?:create|make|set\s+up|set|update|edit|change|patch|replace|schedule|host|plan|start|add|build)\b/i
      .test(text);
  if (
    listingType &&
    /\b(?:platform|capabilit|support|comparison|time[- ]dependent|per[- ]hour|rate\s+card|bookable)\b/i
      .test(text) &&
    // #3355 rework 3 (live answer eval): "open a support ticket" is a
    // support request for the support tools, never an event-capability read.
    (options.legacy === true || !ARI_SUPPORT_REQUEST.test(text))
  ) {
    return {
      intent: "listing_capabilities",
      calls: [{
        name: "get_listing_type_capabilities",
        args: { listing_type: listingType },
      }],
    };
  }
  if (
    /\b(?:nigeria|nigerian|lagos|naira|ngn|payout\s+country)\b/i.test(text) &&
    /\b(?:currency|price|pricing|payout|market|country|rule|tax|fee)\b/i
      .test(text) &&
    !containsOfferingWriteIntent
  ) {
    return {
      intent: "market_rules",
      // orch-strict-grep-allow stripe-country-out-of-scope — deterministic Nigeria research routes to Paystack market rules, not Stripe.
      calls: [{ name: "get_market_rules", args: { country_code: "NG" } }],
    };
  }
  return null;
}

/** Recover the most recently named event from the user's conversation text. */
export function findAriRecentEventTitle(
  texts: readonly string[],
): string | null {
  for (const text of [...texts].reverse()) {
    const matches = [
      /\b(?:event|draft)\s+(?:(?:called|named)\s+)?[“"']([^”"']{2,100})[”"']/i,
      /\b(?:event|draft)\s+(?:called|named)\s+(.{2,100}?)(?=\s+(?:for|on|at)\b|[.!?]|$)/i,
      /\b(?:saved\s+)?(?:private\s+)?draft\s+[“"']([^”"']{2,100})[”"']/i,
    ];
    for (const pattern of matches) {
      const title = pattern.exec(text)?.[1]?.trim();
      if (title) return title;
    }
  }
  return null;
}

function words(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
      typeof item === "string" ? [item.replaceAll("_", " ")] : []
    )
    : [];
}

/** Build concise public copy from the canonical read without a model pass. */
export function buildAriDeterministicReadReply(
  plan: AriDeterministicReadPlan,
  observations: readonly AgentLoopObservation[],
  brandName: string | null,
): string | null {
  const observation = observations.find((item) =>
    item.tool === plan.calls[0]?.name
  );
  if (
    !observation || observation.error || !observation.result ||
    typeof observation.result !== "object"
  ) return null;
  const result = observation.result as Record<string, unknown>;
  const brand = brandName?.trim() || "this brand";
  if (plan.intent === "event_list") {
    const allEvents = Array.isArray(result.events)
      ? result.events.filter((event): event is Record<string, unknown> =>
        !!event && typeof event === "object" && !Array.isArray(event)
      )
      : [];
    const events = plan.targetTitle
      ? allEvents.filter((event) =>
        typeof event.title === "string" &&
        event.title.toLocaleLowerCase() ===
          plan.targetTitle?.toLocaleLowerCase()
      )
      : allEvents;
    if (events.length === 0) {
      return plan.targetTitle
        ? `I checked ${brand}’s saved events in Mingla, but couldn’t verify “${plan.targetTitle}”. Nothing was changed.`
        : `I checked ${brand}’s saved events in Mingla and found none. Nothing was changed.`;
    }
    const lines = events.slice(0, 10).flatMap((event) => {
      if (typeof event.title !== "string" || !event.title.trim()) return [];
      const when = event.when && typeof event.when === "object"
        ? event.when as Record<string, unknown>
        : {};
      const date = typeof when.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(when.date)
        ? new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${when.date}T12:00:00.000Z`))
        : null;
      const timezone = typeof when.timezone === "string"
        ? when.timezone
        : typeof event.timezone === "string"
        ? event.timezone
        : null;
      const start = typeof when.doorsOpen === "string" ? when.doorsOpen : null;
      const end = typeof when.endsAt === "string" ? when.endsAt : null;
      const time = start && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)
        ? `${formatClockTime(start)}${
          end && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)
            ? `–${formatClockTime(end)}`
            : ""
        }${
          timezone ? ` ${timezone === "Africa/Lagos" ? "WAT" : timezone}` : ""
        }`
        : null;
      const rawStatus = typeof event.status === "string"
        ? event.status.replaceAll("_", " ")
        : null;
      const isDraft = event.status === "draft" || event.visibility === "draft";
      const status = isDraft
        ? "Draft — not published"
        : rawStatus
        ? `Status: ${rawStatus}`
        : null;
      const location = typeof event.location_text === "string" &&
          event.location_text.trim()
        ? ` · ${event.location_text.trim()}`
        : "";
      return [
        `• ${event.title.trim()}${date ? ` — ${date}` : ""}${
          time ? `, ${time}` : ""
        }${location}${status ? ` (${status})` : ""}`,
      ];
    });
    if (lines.length === 0) {
      return `I checked ${brand}’s saved events in Mingla, but couldn’t verify readable event details. Nothing was changed.`;
    }
    const extra = events.length > 10 ? ` Showing 10 of ${events.length}.` : "";
    return `Here are ${brand}’s saved events from Mingla:\n${
      lines.join("\n")
    }${extra}`;
  }
  if (plan.intent === "campaign_draft") {
    const payload = result.channel_payload &&
        typeof result.channel_payload === "object" &&
        !Array.isArray(result.channel_payload)
      ? result.channel_payload as Record<string, unknown>
      : {};
    const channel = result.channel === "sms" ? "SMS" : "email";
    const name = typeof result.name === "string" ? result.name : "Campaign";
    const subject = typeof payload.subject === "string"
      ? payload.subject.trim()
      : "";
    const rawBody = channel === "SMS"
      ? payload.body
      : payload.body_text ?? payload.body_html;
    const body = typeof rawBody === "string"
      ? rawBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      : "";
    if (result.status !== "draft" || !body) {
      return "I found the saved campaign record for " + brand +
        ", but couldn’t verify its saved draft copy and status. I did not change or schedule it.";
    }
    return "I verified the saved " + channel + " campaign draft for " + brand +
      ": “" + name + "”." + (subject ? " Subject: " + subject + "." : "") +
      " Message: " + body +
      " Status: draft. It has not been scheduled or sent.";
  }
  if (plan.intent === "saved_event") {
    const events = Array.isArray(result.events)
      ? result.events.filter((event): event is Record<string, unknown> =>
        !!event && typeof event === "object" && !Array.isArray(event)
      )
      : [];
    const targetTitle = plan.targetTitle?.toLocaleLowerCase();
    const matches = targetTitle
      ? events.filter((event) =>
        typeof event.title === "string" &&
        event.title.toLocaleLowerCase() === targetTitle
      )
      : events;
    const event = matches[0];
    if (!event) {
      return targetTitle
        ? `I checked ${brand}’s saved events in Mingla, but I couldn’t verify a saved event titled “${plan.targetTitle}”. Nothing was changed.`
        : `I checked ${brand}’s saved events in Mingla, but couldn’t verify a saved event. Nothing was changed.`;
    }
    const when = event.when && typeof event.when === "object"
      ? event.when as Record<string, unknown>
      : {};
    const date = typeof when.date === "string" ? when.date : null;
    const timezone = typeof when.timezone === "string"
      ? when.timezone
      : typeof event.timezone === "string"
      ? event.timezone
      : null;
    const weekdayDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date}T12:00:00.000Z`))
      : null;
    const doorsOpen = typeof when.doorsOpen === "string"
      ? when.doorsOpen
      : typeof when.startAt === "string"
      ? when.startAt
      : null;
    const endAt = typeof when.endsAt === "string" ? when.endsAt : null;
    const validClock = (value: string | null): value is string =>
      typeof value === "string" &&
      /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    const zoneLabel = timezone === "Africa/Lagos" ? "WAT" : timezone;
    const clock = validClock(doorsOpen)
      ? `${formatClockTime(doorsOpen)}${
        validClock(endAt) ? `–${formatClockTime(endAt)}` : ""
      }${zoneLabel ? ` ${zoneLabel}` : ""}`
      : null;
    const location = typeof event.location_text === "string" &&
        event.location_text.trim()
      ? event.location_text.trim()
      : null;
    const status = event.status === "draft" || event.visibility === "draft"
      ? "saved draft"
      : "saved event";
    const publication = status === "saved draft" ? "It is not published." : "";
    return `I verified this ${status} in Mingla: “${String(event.title)}”.${
      weekdayDate ? ` Date: ${weekdayDate}.` : date ? ` Date: ${date}.` : ""
    }${clock ? ` Time: ${clock}.` : ""}${
      location ? ` Venue: ${location}.` : ""
    } ${publication}`
      .trim();
  }
  if (plan.intent === "existing_brands") {
    const brands = Array.isArray(result.brands) ? result.brands : [];
    if (brands.length === 0) {
      return "I checked your Mingla account and found no existing brands. Nothing was created or changed.";
    }
    const labels = brands.slice(0, 6).flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string"
        ? row.name
        : typeof row.display_name === "string"
        ? row.display_name
        : null;
      const role = typeof row.role === "string"
        ? row.role.replaceAll("_", " ")
        : null;
      return name ? [`${name}${role ? ` (${role})` : ""}`] : [];
    });
    return `I checked your existing Mingla brands before creating anything. I found ${brands.length}: ${
      labels.join(", ") || "the available brand records"
    }. Nothing was created or changed.`;
  }
  if (plan.intent === "brand_team") {
    const members = Array.isArray(result.members) ? result.members.length : 0;
    const invitations = Array.isArray(result.invitations)
      ? result.invitations as Array<Record<string, unknown>>
      : [];
    const pending = invitations.filter((item) => item?.status === "pending")
      .length;
    return `I checked the team and invitations for ${brand}. It currently has ${members} active ${
      members === 1 ? "member" : "members"
    } and ${pending} pending ${
      pending === 1 ? "invitation" : "invitations"
    }. I did not send or replace an invitation.`;
  }
  if (plan.intent === "market_rules") {
    if (result.supported !== true) {
      return "I checked Mingla’s market rules, but this market needs human review before pricing or payout setup. Nothing was changed.";
    }
    const country = typeof result.country === "string"
      ? result.country
      : "the selected country";
    const currency = typeof result.currency === "string"
      ? result.currency
      : "the supported currency";
    const provider = typeof result.payment_provider === "string"
      ? result.payment_provider
      : "the supported payment provider";
    return `I checked Mingla’s market rules. ${country} uses ${currency} with ${provider}. The payout country becomes fixed after onboarding, so confirm it before pricing or payout setup. Nothing was changed.`;
  }
  if (plan.intent === "listing_capabilities") {
    const type = typeof result.listing_type === "string"
      ? result.listing_type
      : "listing";
    const schedule = words(result.schedule);
    const commerce = words(result.commerce);
    const location = words(result.location);
    return `I checked Mingla’s ${type} capabilities. Scheduling supports ${
      schedule.join(", ") || "the available schedule options"
    }. Pricing and booking support ${
      commerce.join(", ") || "the available commerce options"
    }. Location supports ${
      location.join(", ") || "the available location options"
    }. Nothing was created or changed.`;
  }
  if (plan.intent === "listing_candidates") {
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    if (
      result.requires_human_resolution === true ||
      result.needs_human_confirmation === true || conflicts.length > 0
    ) {
      const fields = conflicts.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const field = (item as Record<string, unknown>).field;
        return typeof field === "string" ? [field] : [];
      });
      return `I checked the supplied details and found a conflict${
        fields.length ? ` in ${[...new Set(fields)].join(" and ")}` : ""
      }. I won’t choose one source silently or create anything from conflicting information. Confirm which value is correct, or attach the original materials so I can show both values side by side.`;
    }
    const candidateRows = Array.isArray(result.sources)
      ? result.sources.flatMap((source) => {
        if (!source || typeof source !== "object" || Array.isArray(source)) {
          return [];
        }
        const candidates = (source as Record<string, unknown>).candidates;
        return candidates && typeof candidates === "object" &&
            !Array.isArray(candidates)
          ? [candidates as Record<string, unknown>]
          : [];
      })
      : result.candidates && typeof result.candidates === "object" &&
          !Array.isArray(result.candidates)
      ? [result.candidates as Record<string, unknown>]
      : [];
    const dates = candidateRows.flatMap((row) => words(row.dates));
    const times = candidateRows.flatMap((row) => words(row.times));
    const prices = candidateRows.flatMap((row) => words(row.prices));
    if (dates.length + times.length + prices.length === 0) {
      return "I checked the supplied text, but it does not contain enough extractable date, time or price detail to make a safe plan. Attach the flyer, document, image or voice note and include any corrected text. Nothing was created or changed.";
    }
    const details = [
      dates.length ? `dates: ${[...new Set(dates)].join(", ")}` : null,
      times.length ? `times: ${[...new Set(times)].join(", ")}` : null,
      prices.length ? `prices: ${[...new Set(prices)].join(", ")}` : null,
    ].filter((item): item is string => item !== null);
    return `I extracted ${
      details.join("; ")
    }. Confirm these details before I prepare a listing. Nothing was created or changed.`;
  }
  return null;
}

function formatClockTime(value: string): string {
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

export function searchAriCapabilities(
  all: readonly AgentTool[],
  query: string,
  limit = 12,
): Array<{ name: string; description: string }> {
  const terms = query.toLowerCase().split(/\s+/).filter((term) =>
    term.length > 2
  );
  return all.map((tool) => {
    const haystack = `${tool.name} ${tool.description}`.toLowerCase();
    return {
      tool,
      score: terms.reduce(
        (score, term) => score + (haystack.includes(term) ? 1 : 0),
        0,
      ),
    };
  }).filter((entry) => entry.score > 0).sort((a, b) =>
    b.score - a.score || a.tool.name.localeCompare(b.tool.name)
  ).slice(0, limit).map(({ tool }) => ({
    name: tool.name,
    description: tool.description,
  }));
}
