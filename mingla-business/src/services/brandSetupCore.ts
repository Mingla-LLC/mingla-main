/**
 * #4389 — the pure half of brand setup the routes and the setup screen share
 * with the service (types, step rules, the error class, ids). Split from
 * brandSetupService.ts so they can use the rules without loading the service's
 * Supabase reads and writes up front. The parsers, error classification and
 * slug rule are the service's alone and live there: what more than one chunk
 * imports is hoisted into the eager web __common chunk, so keep this small.
 */
// Types only: the readiness parser loads with the first read.
import type { BrandReadiness } from "./brandReadinessService";

export type BrandSetupStep = "name" | "country" | "pay" | "done";
export const BRAND_SETUP_STEPS: readonly BrandSetupStep[] = ["name", "country", "pay", "done"];

export const BRAND_SETUP_ITEM_KEYS = [
  "brand.name",
  "money.market",
  "money.terms_member",
  "money.details_submitted",
] as const;

export type StripeSetupState = "none" | "started" | "submitted" | "action_needed";

export interface BrandSetupFacts {
  payoutCountry: string | null;
  currency: string | null;
  provider: "stripe" | "paystack";
  market: boolean;
  terms: boolean;
  details: boolean;
  stripeState: StripeSetupState;
  waitingFor: string | null;
  complete: boolean;
  freeOnlyAt: string | null;
  paymentsSetupStartedAt: string | null;
  published: boolean;
  isDraft: boolean;
}

export interface BrandSetupChecklist {
  readiness: BrandReadiness;
  facts: BrandSetupFacts;
  /** Items done, out of 4. */
  doneCount: number;
}

/**
 * The step to show, derived from the server's checklist on mount and on
 * focus (never stored). A requested step is honoured only when it is not
 * past the first unfinished one: "You're all set" is unreachable while any
 * item is blocking (SC-2), whatever the deep link says.
 */
export function deriveSetupStep(
  checklist: Pick<BrandSetupChecklist, "readiness"> | null,
  requested: BrandSetupStep | null = null,
): BrandSetupStep {
  if (checklist === null) return "name";
  const done = (key: string): boolean => {
    const item = checklist.readiness.items.find((i) => i.key === key);
    return item?.state === "verified" || item?.state === "not_applicable";
  };
  const first: BrandSetupStep = !done("brand.name")
    ? "name"
    : !done("money.market")
    ? "country"
    : !done("money.terms_member") || !done("money.details_submitted")
    ? "pay"
    : "done";
  if (requested === null) return first;
  const order = BRAND_SETUP_STEPS;
  return order.indexOf(requested) <= order.indexOf(first) ? requested : first;
}

/**
 * #4389 R1 — a hop INSIDE the setup (F1 → F2, the return from secure setup)
 * carries `from=flow`. Every other open of /brand/{id}/setup (Home card, Ari
 * card, switcher Continue, N1 Continue, a deep link) is a resume and may show
 * "Welcome back. You stopped at…" once.
 */
export function setupFlowHop(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}from=flow`;
}

export function isSetupFlowHop(from: unknown): boolean {
  return (Array.isArray(from) ? from[0] : from) === "flow";
}

export function parseSetupStep(value: unknown): BrandSetupStep | null {
  return value === "name" || value === "country" || value === "pay" || value === "done" ? value : null;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type BrandSetupErrorCode =
  | "draft_exists"
  | "slug_taken"
  | "brand_not_found"
  | "forbidden"
  | "requires_owner"
  | "payout_country_locked"
  | "payout_country_unsupported"
  | "payout_country_required"
  | "terms_required"
  | "invalid_address"
  | "address_country_mismatch"
  | "network"
  | "unknown";

export class BrandSetupError extends Error {
  constructor(
    public readonly code: BrandSetupErrorCode,
    message: string,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BrandSetupError";
  }
}

/** RFC 4122 v4, generated once when F1 mounts (R-1 idempotent create). */
export function newBrandId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}
