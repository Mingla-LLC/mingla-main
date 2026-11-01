// Issue #3355 — deterministic minimum contract for a brand launch plan.
// The reasoning model may add useful detail, but a missed tool choice must not
// collapse a broad launch request into a single website or research step.

import type { AgentLoopObservation, AgentLoopToolCall } from "./agentLoop.ts";
import { sanitizeAriPublicText } from "./agentSanitization.ts";
import {
  type BrandReadinessMoney,
  readinessGapLabels,
  readinessMoneyGaps,
  readinessMoneySentence,
} from "./agentReadinessTools.ts";

type JsonRecord = Record<string, unknown>;

export interface AriLaunchPlanStep {
  id: string;
  label: string;
  detail: string;
  state: "done" | "active" | "queued";
}

export interface AriBrandLaunchPlan {
  title: string;
  summary: string;
  text: string;
  steps: AriLaunchPlanStep[];
  missing: string[];
  sourceUrls: string[];
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string"
    ? sanitizeAriPublicText(value).text.replace(/\s+/g, " ").trim().slice(
      0,
      500,
    )
    : fallback;
}

function observationResult(
  observations: readonly AgentLoopObservation[],
  tool: string,
): JsonRecord | null {
  return record(observations.find((item) => item.tool === tool)?.result);
}

const GENERIC_BRAND_WORDS = new Set([
  "and",
  "club",
  "events",
  "official",
  "room",
  "the",
]);

function normalizedWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter(Boolean);
}

/** Search engines can return plausible-looking but unrelated pages. A result
 * is eligible for the host thread only when its title, URL, or snippet
 * contains a distinctive word from the selected brand name. */
function brandMatchedSourceUrls(
  brandName: string,
  sources: unknown[],
): string[] {
  const allBrandWords = normalizedWords(brandName).filter((word) =>
    word.length >= 4
  );
  const distinctive = allBrandWords.filter((word) =>
    !GENERIC_BRAND_WORDS.has(word)
  );
  const identityWords = distinctive.length > 0 ? distinctive : allBrandWords;
  if (identityWords.length === 0) return [];
  return sources.flatMap((source) => {
    const item = record(source);
    const url = text(item?.url);
    const haystack = normalizedWords(
      `${text(item?.title)} ${url} ${text(item?.snippet)}`,
    );
    return url && identityWords.some((word) => haystack.includes(word))
      ? [url]
      : [];
  });
}

export function isBrandLaunchPlanRequest(value: string): boolean {
  return /\b(?:launch|go live|ready to publish|publishing)\b/i.test(value) &&
    /\b(?:plan|steps|checklist)\b/i.test(value) &&
    /\b(?:brand|business|club|room|host)\b/i.test(value);
}

/** Route a saved event's launch-readiness request through canonical reads. */
export function isAriEventLaunchReadinessRequest(value: string): boolean {
  const readiness = /\b(?:launch|publish|public)\b/i.test(value) &&
    /\b(?:checklist|preview|readiness)\b/i.test(value);
  const publicEventDetails =
    /\bpublic\b[\s\S]{0,40}\bevents?\b[\s\S]{0,40}\bdetails\b/i
      .test(value);
  return (readiness || publicEventDetails) &&
    /\b(?:event|listing|ticket)\b/i.test(value);
}

export function launchPlanNeedsPublicResearch(value: string): boolean {
  return /\b(?:research|public evidence|public presence|public source|online|social|instagram|tiktok|youtube|website)\b/i
    .test(value);
}

export function launchPlanInitialCalls(input: {
  brandId: string;
  brandName: string;
  includeResearch: boolean;
}): AgentLoopToolCall[] {
  const calls: AgentLoopToolCall[] = [
    { name: "get_operator_snapshot", args: { brand_id: input.brandId } },
    { name: "get_brand_site", args: { brand_id: input.brandId } },
  ];
  if (input.includeResearch) {
    calls.push({
      name: "search_public_web",
      args: { query: `"${input.brandName}" official events` },
    });
  }
  return calls;
}

const PROFILE_GROUPS = new Set(["identity", "contact", "location", "media"]);

interface SnapshotChecklistItem {
  label: string;
  group: string;
  severity: string;
  deferral: JsonRecord | null;
}

/** The snapshot's canonical checklist summary, or null when it couldn't be read. */
function readinessFromSnapshot(
  selected: JsonRecord,
): { items: SnapshotChecklistItem[]; money: BrandReadinessMoney } | null {
  const readiness = record(selected.readiness);
  if (!readiness || !Array.isArray(readiness.items)) return null;
  const money = record(readiness.money);
  if (!money) return null;
  const items = readiness.items.flatMap((value) => {
    const item = record(value);
    const label = text(item?.label);
    return item && label
      ? [{
        label,
        group: text(item.group),
        severity: text(item.severity, "skippable"),
        deferral: record(item.not_now),
      }]
      : [];
  });
  return {
    items,
    money: {
      can_sell: money.can_sell === true,
      can_be_paid_out: money.can_be_paid_out === true,
      sell_reason: text(money.sell_reason, "kyc_incomplete"),
      payout_reason: text(money.payout_reason, "no_bank"),
      rail: text(money.rail, "none"),
      currency: text(money.currency) || null,
      terms_accepted_by_caller: typeof money.terms_accepted_by_caller ===
          "boolean"
        ? money.terms_accepted_by_caller
        : null,
    },
  };
}

export function buildBrandLaunchPlan(input: {
  brandName: string;
  observations: readonly AgentLoopObservation[];
}): AriBrandLaunchPlan {
  const snapshot = observationResult(
    input.observations,
    "get_operator_snapshot",
  ) ?? {};
  const selected = record(snapshot.selected_brand) ?? {};
  const website = observationResult(input.observations, "get_brand_site") ?? {};
  const research = observationResult(
    input.observations,
    "search_public_web",
  );
  const offerings = Array.isArray(snapshot.offerings) ? snapshot.offerings : [];
  // #3355 P2 (I-BRAND-READINESS-SINGLE-SOURCE): the profile and money gaps
  // come from the canonical brand_readiness summary inside the snapshot.
  const checklist = readinessFromSnapshot(selected);
  const checklistUnavailable = checklist === null;
  const missingProfile = checklist
    ? readinessGapLabels(
      checklist.items.filter((item) =>
        PROFILE_GROUPS.has(item.group) && item.severity !== "done"
      ),
    )
    : [];
  const brandName = text(selected.name, text(input.brandName, "this brand"));
  const description = text(selected.description);
  const city = text(selected.city);
  const country = text(selected.country_code);
  const currency = text(selected.default_currency);
  const money = checklist?.money ?? null;
  const moneyReady = money !== null && money.can_sell &&
    money.can_be_paid_out && money.terms_accepted_by_caller !== false;
  const websiteReadFailed = input.observations.some((item) =>
    item.tool === "get_brand_site" && item.error
  );
  const websiteState = websiteReadFailed
    ? "unverified"
    : text(website.website_state, "unknown");
  const sources = Array.isArray(research?.sources) ? research.sources : [];
  const sourceUrls = brandMatchedSourceUrls(brandName, sources);
  const researchFailed = input.observations.some((item) =>
    item.tool === "search_public_web" && item.error
  );

  const confirmed = [description, city, country, currency].filter(Boolean);
  const profileDetail = checklistUnavailable
    ? "I couldn't read the brand checklist in this pass, so I can't say what the profile still needs. Nothing is assumed complete."
    : missingProfile.length > 0
    ? `Confirmed ${
      confirmed.join(" · ") || "the saved brand record"
    }. Still needed: ${missingProfile.join(", ")}.`
    : `The saved brand profile is complete enough for this planning pass${
      confirmed.length ? `: ${confirmed.join(" · ")}` : "."
    }`;
  const offeringDetail = offerings.length > 0
    ? `${offerings.length} saved offering${
      offerings.length === 1 ? "" : "s"
    } will be reviewed before launch.`
    : "Choose the first offering type, date and time, capacity, price, location privacy, and refund policy.";
  const websiteDetail = websiteReadFailed
    ? "I couldn't verify the website status in this check. Review the brand's Website screen before publishing."
    : websiteState === "not_set_up"
    ? "No website draft exists yet; prepare one after the brand and first offering are ready."
    : websiteState === "not_available"
    ? "Website setup is not available for this brand yet; continue with the Mingla public profile and listing."
    : websiteState === "unknown"
    ? "Read the current website state before publishing."
    : "Review the existing website draft and verify its public preview.";
  const researchDetail = sourceUrls.length > 0
    ? `${sourceUrls.length} brand-matched public search lead${
      sourceUrls.length === 1 ? "" : "s"
    } found; verify identity and page content before using any claim.`
    : researchFailed
    ? "Public research could not be verified in this pass; this does not block preparation from Mingla data."
    : "No official public source was verified; add a known public URL or social handle if one exists.";

  const steps: AriLaunchPlanStep[] = [
    {
      id: "brand-profile",
      label: "Finish the public brand profile",
      detail: profileDetail,
      state: !checklistUnavailable && missingProfile.length === 0
        ? "done"
        : "active",
    },
    {
      id: "first-offering",
      label: offerings.length > 0
        ? "Review the saved offerings"
        : "Build the first bookable offering",
      detail: offeringDetail,
      state: offerings.length > 0 ? "done" : "active",
    },
    {
      id: "tickets-and-policy",
      label: "Confirm tickets, capacity, fees, and refunds",
      detail:
        "Keep exact pricing, capacity, address privacy, and the refund policy explicit before any publish approval.",
      state: offerings.length > 0 ? "active" : "queued",
    },
    {
      id: "payouts-and-terms",
      label: "Complete payout and Terms handoffs",
      detail: money
        ? `${
          readinessMoneySentence(money)
        } Payment setup and the Terms stay with people; Ari can't complete them.`
        : "I couldn't read the payment position in this pass. Payment setup and the Terms stay with people; Ari can't complete them.",
      state: moneyReady ? "done" : "active",
    },
    {
      id: "website",
      label: "Prepare the public website and profile",
      detail: websiteDetail,
      state: websiteState === "not_set_up" || websiteState === "unknown"
        ? "active"
        : "done",
    },
    {
      id: "research",
      label: "Verify the public presence",
      detail: researchDetail,
      state: "active",
    },
    {
      id: "preview",
      label: "Preview every buyer-visible surface",
      detail:
        "Check the app, public listing, website, media, dates, prices, and address privacy against the canonical records.",
      state: "queued",
    },
    {
      id: "approval",
      label: "Request final publish approval",
      detail:
        "Show the exact changes, publish only after approval, then read the live result back and draft the launch message.",
      state: "queued",
    },
  ];

  const missing = checklistUnavailable
    ? ["a verified brand checklist"]
    : [...missingProfile];
  if (offerings.length === 0) {
    missing.push(
      "first offering details: type, date and time, capacity, price, location privacy, and refund policy",
    );
  }
  if (money) missing.push(...readinessMoneyGaps(money));
  else missing.push("a verified payment position");
  if (websiteReadFailed) missing.push("verified website status");
  if (sourceUrls.length === 0) {
    missing.push("a known official public URL or social handle (optional)");
  }

  const numbered = steps.map((step, index) =>
    `${index + 1}. ${step.label}: ${step.detail}`
  ).join("\n");
  return {
    title: "Launch plan ready",
    summary:
      `This plan uses ${brandName}'s saved Mingla record. Nothing has been changed or published.`,
    text:
      `I built this launch plan for ${brandName} from the business information already in Mingla. Nothing has been changed or published.\n\n${numbered}\n\nStill needed: ${
        missing.length ? missing.join("; ") : "nothing for this planning pass"
      }.`,
    steps,
    missing,
    sourceUrls,
  };
}
