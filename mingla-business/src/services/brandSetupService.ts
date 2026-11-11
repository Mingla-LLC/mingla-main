/**
 * #4389 — brand setup with the minimum information (Host side).
 *
 * One reader and the writes behind the 4-step setup (F1 name → F2 bank
 * country → F3 get paid → F4 done). "Setup finished" is ONLY the server's
 * `brand_readiness(brand_setup)` with nothing blocking
 * (I-4389-SETUP-DONE-IS-SERVER); this module never recomputes it, it only
 * picks the step to show from the server's 4 items.
 *
 * Supabase is imported lazily (same boot-path boundary as
 * brandReadinessService).
 */

// #3355 keeps the readiness reader off the boot chunk (this module is reached
// statically from the setup route): types only here, the parser is loaded with
// the first read.
import type { BrandReadiness } from "./brandReadinessService";
import { awaitSessionAttached } from "../utils/authReadyGate";

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

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const optStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function parseBrandSetupFacts(raw: unknown): BrandSetupFacts {
  const s = isObject(raw) ? raw : {};
  const stripe = s.stripe_state;
  return {
    payoutCountry: optStr(s.payout_country),
    currency: optStr(s.currency),
    provider: s.provider === "paystack" ? "paystack" : "stripe",
    market: s.market === true,
    terms: s.terms === true,
    details: s.details === true,
    stripeState:
      stripe === "started" || stripe === "submitted" || stripe === "action_needed" ? stripe : "none",
    waitingFor: optStr(s.waiting_for),
    complete: s.complete === true,
    freeOnlyAt: optStr(s.free_only_at),
    paymentsSetupStartedAt: optStr(s.payments_setup_started_at),
    published: s.published === true,
    isDraft: s.is_draft === true,
  };
}

export function parseBrandSetupChecklist(
  raw: unknown,
  parseBrandReadiness: (raw: unknown) => BrandReadiness,
): BrandSetupChecklist {
  const readiness = parseBrandReadiness(raw);
  const facts = parseBrandSetupFacts(isObject(raw) ? raw.setup : null);
  const doneCount = readiness.items.filter(
    (i) => i.state === "verified" || i.state === "not_applicable",
  ).length;
  return { readiness, facts, doneCount };
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

const KNOWN_CODES: readonly BrandSetupErrorCode[] = [
  "draft_exists",
  "slug_taken",
  "brand_not_found",
  "forbidden",
  "requires_owner",
  "payout_country_locked",
  "payout_country_unsupported",
  "payout_country_required",
  "terms_required",
  "invalid_address",
  "address_country_mismatch",
];

export function classifySetupError(error: { message?: string; code?: string } | null | undefined): BrandSetupError {
  const message = error?.message ?? "";
  const code = KNOWN_CODES.find((c) => message.includes(c));
  if (code) return new BrandSetupError(code, message);
  if (/network|fetch|Failed to fetch|timeout/i.test(message)) {
    return new BrandSetupError("network", message);
  }
  return new BrandSetupError("unknown", message || "brand setup failed");
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function fetchBrandSetupChecklist(brandId: string): Promise<BrandSetupChecklist> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.rpc("brand_readiness", {
    p_brand_id: brandId,
    p_action: "brand_setup",
  });
  if (error) throw classifySetupError(error);
  const { parseBrandReadiness } = await import("./brandReadinessService");
  return parseBrandSetupChecklist(data, parseBrandReadiness);
}

// ── Writes ──────────────────────────────────────────────────────────────────

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

export function slugForBrandName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export interface CreateSetupBrandResult {
  brandId: string;
  created: boolean;
}

/**
 * F1 Continue. Idempotent on `brandId` (same id twice = one brand). A host
 * with a brand already in setup gets `draft_exists` with that brand (N1).
 */
export async function createSetupBrand(input: {
  brandId: string;
  name: string;
  partnerSetup?: boolean;
}): Promise<CreateSetupBrandResult> {
  const { supabase } = await import("./supabase");
  // META-ORCH-1232 (C2) — the brand write never goes out before a real access
  // token is attached (a fresh signup flips isAuthReady a beat early, and an
  // anon insert is refused by RLS). Cap elapsed → AuthNotReadyError, which F1
  // shows as its own retryable message.
  await awaitSessionAttached(() => supabase.auth.getSession());
  const base = slugForBrandName(input.name) || "brand";
  // A taken slug retries with a short suffix; the id keeps it one brand.
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? base : `${base.slice(0, 54)}-${input.brandId.slice(0, 4 + attempt)}`;
    const { data, error } = await supabase.rpc("biz_create_setup_brand", {
      p_brand_id: input.brandId,
      p_name: input.name.trim(),
      p_slug: slug,
      p_partner_setup: input.partnerSetup === true,
    });
    if (error) throw classifySetupError(error);
    const result = isObject(data) ? data : {};
    if (result.ok === true) {
      return { brandId: String(result.brand_id), created: result.created === true };
    }
    if (result.error === "draft_exists") {
      throw new BrandSetupError("draft_exists", "draft_exists", {
        brandId: result.brand_id,
        brandName: result.brand_name,
      });
    }
    if (result.error !== "slug_taken") throw new BrandSetupError("unknown", String(result.error ?? "unknown"));
  }
  throw new BrandSetupError("slug_taken", "slug_taken");
}

export interface PayoutCountrySaved {
  payoutCountry: string;
  currency: string;
  provider: "stripe" | "paystack";
}

/** F2 Continue: one write; Nigeria then stamps the payout hold. */
export async function setBrandPayoutCountry(
  brandId: string,
  country: string,
): Promise<PayoutCountrySaved> {
  const { supabase } = await import("./supabase");
  // META-ORCH-1232 (C2) — same write gate as F1 create.
  await awaitSessionAttached(() => supabase.auth.getSession());
  const { data, error } = await supabase.rpc("biz_set_brand_payout_country", {
    p_brand_id: brandId,
    p_country: country,
  });
  if (error) throw classifySetupError(error);
  const saved = isObject(data) ? data : {};
  const provider = saved.payment_provider === "paystack" ? "paystack" : "stripe";
  if (provider === "paystack") {
    const { error: holdError } = await supabase.functions.invoke("brand-paystack-onboard", {
      body: { action: "select_provider", brand_id: brandId },
    });
    if (holdError) throw classifySetupError(holdError);
  }
  return {
    payoutCountry: String(saved.payout_country ?? country),
    currency: String(saved.default_currency ?? ""),
    provider,
  };
}

/** Before any payment-partner step (Paystack bank form). Stripe calls it on the server. */
export async function beginPaymentsSetup(brandId: string): Promise<void> {
  const { supabase } = await import("./supabase");
  const { error } = await supabase.rpc("biz_begin_payments_setup", { p_brand_id: brandId });
  if (error) throw classifySetupError(error);
}

/** K1 "Free events only for now". */
export async function markBrandSetupFreeOnly(brandId: string): Promise<void> {
  const { supabase } = await import("./supabase");
  const { error } = await supabase.rpc("biz_mark_brand_setup_free_only", { p_brand_id: brandId });
  if (error) throw classifySetupError(error);
}

export interface StripeSetupStatus {
  state: "submitted" | "action_needed" | "not_started";
  due: string[];
}

/** F4: a live read (never waits on the webhook, R-5). */
export async function refreshStripeSetupStatus(brandId: string): Promise<StripeSetupStatus> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.functions.invoke("brand-stripe-onboard", {
    body: { action: "refresh_status", brand_id: brandId },
  });
  if (error) throw classifySetupError(error);
  const r = isObject(data) ? data : {};
  const state = r.state === "submitted" || r.state === "action_needed" ? r.state : "not_started";
  return {
    state,
    due: Array.isArray(r.due) ? r.due.filter((d): d is string => typeof d === "string") : [],
  };
}

export interface TapLocationAddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  country: string;
}

/** T1 (fallback only). */
export async function setTapLocationAddress(
  brandId: string,
  address: TapLocationAddressInput,
): Promise<void> {
  const { supabase } = await import("./supabase");
  const { error } = await supabase.rpc("biz_set_tap_location_address", {
    p_brand_id: brandId,
    p_address: {
      line1: address.line1,
      line2: address.line2 ?? null,
      city: address.city,
      state: address.state ?? null,
      postal_code: address.postalCode ?? null,
      country: address.country,
    },
  });
  if (error) throw classifySetupError(error);
}

// ── Delete / discard (one core: the brand-delete edge function) ────────────

export interface BrandDeletionPreview {
  blockers: Array<{ code: string; count?: number }>;
  isDraft: boolean;
  providers: { stripe: boolean; paystack: boolean };
}

export async function fetchBrandDeletionPreview(brandId: string): Promise<BrandDeletionPreview> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.rpc("biz_brand_deletion_blockers", { p_brand_id: brandId });
  if (error) throw classifySetupError(error);
  const r = isObject(data) ? data : {};
  const providers = isObject(r.providers) ? r.providers : {};
  return {
    blockers: Array.isArray(r.blockers) ? (r.blockers as BrandDeletionPreview["blockers"]) : [],
    isDraft: r.is_draft === true,
    providers: { stripe: providers.stripe === true, paystack: providers.paystack === true },
  };
}

export type BrandDeleteOutcome =
  | { ok: true; stripe: "closed" | "none"; paystack: "switched_off" | "none" }
  | { ok: false; error: "delete_blocked"; blockers: Array<{ code: string; count?: number }> }
  | { ok: false; error: "payment_account_close_refused"; reasonCode: string }
  | { ok: false; error: "not_a_draft" | "confirm_name_mismatch" | "forbidden" };

async function invokeBrandDelete(body: Record<string, unknown>): Promise<BrandDeleteOutcome> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.functions.invoke("brand-delete", { body });
  if (error) {
    let payload: Json = {};
    try {
      const ctx = (error as { context?: { clone?: () => { json: () => Promise<unknown> } } }).context;
      const parsed = ctx?.clone ? await ctx.clone().json() : null;
      if (isObject(parsed)) payload = parsed;
    } catch {
      payload = {};
    }
    switch (payload.error) {
      case "delete_blocked":
        return {
          ok: false,
          error: "delete_blocked",
          blockers: Array.isArray(payload.blockers) ? payload.blockers as Array<{ code: string }> : [],
        };
      case "payment_account_close_refused":
        return { ok: false, error: "payment_account_close_refused", reasonCode: String(payload.reason_code ?? "unknown") };
      case "not_a_draft":
      case "confirm_name_mismatch":
      case "forbidden":
        return { ok: false, error: payload.error };
      default: {
        // #1835 — never let a non-Error (or a code-less Error) escape the delete.
        const { normalizeSupabaseError } = await import("../utils/supabaseErrorMessage");
        throw normalizeSupabaseError(error, "brand-delete rejected");
      }
    }
  }
  const r = isObject(data) ? data : {};
  return {
    ok: true,
    stripe: r.stripe === "closed" ? "closed" : "none",
    paystack: r.paystack === "switched_off" ? "switched_off" : "none",
  };
}

export function deleteBrandClosingPayments(brandId: string, confirmName: string): Promise<BrandDeleteOutcome> {
  return invokeBrandDelete({ brand_id: brandId, confirm_name: confirmName });
}

/** N1 "Discard and start new" (S-12): owner only, no name typing. */
export function discardDraftBrand(brandId: string): Promise<BrandDeleteOutcome> {
  return invokeBrandDelete({ brand_id: brandId, mode: "discard_draft" });
}
