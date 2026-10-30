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
      /^request_tools$/,
      /^get_capability_inventory$/,
    ],
    brand: [/brand/, /profile/, /notification/],
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
    memory: [/memory/, /ari_history/, /ari_prefs/, /agent_job/],
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
    /\b(people|customer|contact|csv|team|member|invite|scanner|guest)\b/i,
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
  ["memory", /\b(remember|preference|correction|forget|last time)\b/i],
  [
    "onboarding",
    /\b(set up|onboard|launch my|flyer|voice note|document|materials)\b/i,
  ],
  [
    "listings",
    /\b(event|trip|experience|rsvp|ticket|listing|date|capacity|refund)\b/i,
  ],
  [
    "brand",
    /\b(brand|business|logo|tagline|phone|currency|timezone|country)\b/i,
  ],
];

export function inferAriToolsets(text: string): AriToolsetKey[] {
  const selected = new Set<AriToolsetKey>(["core"]);
  for (const [key, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) selected.add(key);
  }
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
  const selected = all.filter((tool) =>
    keys.some((key) => toolBelongsTo(tool.name, key))
  );
  const core = all.filter((tool) => toolBelongsTo(tool.name, "core"));
  const unique = new Map<string, AgentTool>();
  for (const tool of core) unique.set(tool.name, tool);

  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((term) =>
    term.length > 2
  );
  const priority: Record<string, number> = {
    get_operator_snapshot: 80,
    search_capabilities: 78,
    list_brands: 75,
    list_events: 70,
    request_tools: 68,
    get_capability_inventory: 66,
    get_brand_site: 64,
    search_public_web: 62,
    read_public_url: 60,
    inspect_public_social_profile: 58,
    fetch_public_listing_page: 56,
    build_host_onboarding_blueprint: 54,
    compare_listing_candidate_sources: 52,
    extract_listing_candidates: 50,
  };
  const ranked = selected.map((tool, index) => {
    const haystack = `${tool.name} ${tool.description}`.toLowerCase();
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
        ? -12
        : 0;
    const termScore = terms.reduce(
      (score, term) => score + (haystack.includes(term) ? 4 : 0),
      0,
    );
    return {
      tool,
      index,
      score: (priority[tool.name] ?? 0) + readBonus + writePenalty + termScore,
    };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  for (const { tool } of ranked) unique.set(tool.name, tool);
  return [...unique.values()].slice(0, Math.max(8, Math.min(maxTools, 60)));
}

/**
 * Broad goals should begin with Mingla's capability map instead of prompting a
 * small model to guess which product feature implements the request. Specific
 * CRUD requests still go directly to their scoped toolset.
 */
export function needsAriCapabilityDiscovery(text: string): boolean {
  return /\b(?:host\s+promotion|promotion\s+plan|marketing\s+plan|growth\s+plan|launch\s+strategy|what\s+can\s+(?:ari|mingla)|can\s+(?:ari|mingla)\s+help|available\s+capabilit(?:y|ies))\b/i
    .test(text);
}

export function buildAriCapabilityPlan(
  request: string,
  brandName: string | null,
  capabilityNames: readonly string[],
): string | null {
  if (!needsAriCapabilityDiscovery(request) || capabilityNames.length === 0) {
    return null;
  }
  const brand = brandName?.trim() || "your brand";
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
  | "market_rules"
  | "listing_capabilities"
  | "listing_candidates";

export interface AriDeterministicReadPlan {
  intent: AriDeterministicReadIntent;
  calls: AgentLoopToolCall[];
}

/**
 * Route narrow, read-only product questions to their canonical Mingla read
 * before asking a model to guess. The patterns describe user intent rather
 * than scenario ids, so the same lane serves ordinary phrasing in Host.
 */
export function ariDeterministicReadPlan(
  text: string,
  brandId: string | null,
): AriDeterministicReadPlan | null {
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
  if (
    /\b(?:flyers?|voice\s+note|supplied\s+(?:image|document|material)|document)\b/i
      .test(text) ||
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
  if (
    listingType &&
    /\b(?:platform|capabilit|support|comparison|time[- ]dependent|per[- ]hour|rate\s+card|bookable)\b/i
      .test(text)
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
    /\b(?:currency|price|pricing|payout|market|country|rule|event|class)\b/i
      .test(text)
  ) {
    return {
      intent: "market_rules",
      // orch-strict-grep-allow stripe-country-out-of-scope — deterministic Nigeria research routes to Paystack market rules, not Stripe.
      calls: [{ name: "get_market_rules", args: { country_code: "NG" } }],
    };
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
