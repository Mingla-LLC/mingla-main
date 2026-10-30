// Issue #3355 — deterministic minimum contract for a brand launch plan.
// The reasoning model may add useful detail, but a missed tool choice must not
// collapse a broad launch request into a single website or research step.

import type { AgentLoopObservation, AgentLoopToolCall } from "./agentLoop.ts";
import { sanitizeAriPublicText } from "./agentSanitization.ts";

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
  const missingProfile = Array.isArray(selected.genuinely_missing)
    ? selected.genuinely_missing.flatMap((item) => {
      const value = text(item);
      return value ? [value] : [];
    })
    : [];
  const brandName = text(selected.name, text(input.brandName, "this brand"));
  const description = text(selected.description);
  const city = text(selected.city);
  const country = text(selected.country_code);
  const currency = text(selected.default_currency);
  const payoutReady = snapshot.payout_ready === true;
  const websiteState = text(website.website_state, "unknown");
  const sources = Array.isArray(research?.sources) ? research.sources : [];
  const sourceUrls = brandMatchedSourceUrls(brandName, sources);
  const researchFailed = input.observations.some((item) =>
    item.tool === "search_public_web" && item.error
  );

  const confirmed = [description, city, country, currency].filter(Boolean);
  const profileDetail = missingProfile.length > 0
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
  const websiteDetail = websiteState === "not_set_up"
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
      state: missingProfile.length === 0 ? "done" : "active",
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
      detail: payoutReady
        ? "Payout collection is ready; the account owner still controls legal acceptance."
        : "Payout setup and legal acceptance remain human-owned and cannot be completed by Ari.",
      state: payoutReady ? "done" : "active",
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

  const missing = [...missingProfile];
  if (offerings.length === 0) {
    missing.push(
      "first offering details: type, date and time, capacity, price, location privacy, and refund policy",
    );
  }
  if (!payoutReady) missing.push("payout setup (human-owned)");
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
      `I built this launch plan for ${brandName} from the business information already in Mingla. Nothing has been changed or published.\n\n${numbered}\n\nThe only genuinely missing items are: ${
        missing.length ? missing.join("; ") : "none for this planning pass"
      }.`,
    steps,
    missing,
    sourceUrls,
  };
}
