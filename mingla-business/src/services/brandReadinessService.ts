/**
 * #3355 P5 — the Host's reader for the ONE canonical brand readiness answer.
 *
 * `brand_readiness(p_brand_id, p_action)` (migration 20280307003355) is the
 * server's single definition of "what is this brand missing, does it block
 * this action, who can fix it". Ari reads it in every flow; Home's brand,
 * profile and money to-do rows and the publish forms' money check read it
 * through this module. Nothing on the Host derives those facts on its own
 * any more (I-BRAND-READINESS-SINGLE-SOURCE).
 *
 * Ari's brand-wide "not now" (the item's `deferral`) is an Ari-flow concept
 * only (Seth, 2026-11-01): Home lists every outstanding item as a reminder,
 * so this reader does not surface it.
 *
 * The Supabase client is imported lazily inside each call so this module can
 * sit on Home's boot path without pulling the native client graph into
 * headless renders or the eager web chunk (same boundary as
 * useBrandPayoutScreen).
 */

export const BRAND_READINESS_ACTIONS = [
  "draft_save",
  "publish_free",
  "publish_paid",
  "trip_installments",
  "venue_submit",
  "stay_publish",
  "website_build",
  "website_publish",
  "refund",
  "bank_setup",
] as const;

export type BrandReadinessAction = (typeof BRAND_READINESS_ACTIONS)[number];

export const BRAND_READINESS_STATES = [
  "verified",
  "missing",
  "invalid",
  "stale",
  "conflict",
  "not_applicable",
] as const;

export type BrandReadinessState = (typeof BRAND_READINESS_STATES)[number];

export interface BrandReadinessItem {
  key: string;
  group: string;
  label: string;
  state: BrandReadinessState;
  valuePreview: string | null;
  blocksAction: boolean;
  deferrable: boolean;
  fix: {
    route: string | null;
    routeLabel: string;
    canCallerFix: boolean;
    whoCanFix: string;
  };
}

export interface BrandReadinessMoney {
  canSell: boolean;
  canBePaidOut: boolean;
  sellReason: string;
  payoutReason: string;
  rail: string;
  currency: string | null;
  termsAcceptedByCaller: boolean | null;
}

export interface BrandReadiness {
  brandId: string;
  contextRevision: string | null;
  evaluatedAt: string;
  action: BrandReadinessAction | null;
  canProceed: boolean;
  items: BrandReadinessItem[];
  money: BrandReadinessMoney;
}

/** An item is "done" when it is verified or does not apply to this brand. */
export function isBrandReadinessItemDone(item: { state: BrandReadinessState }): boolean {
  return item.state === "verified" || item.state === "not_applicable";
}

export class BrandReadinessShapeError extends Error {
  constructor(detail: string) {
    super(`brand_readiness returned an unexpected shape: ${detail}`);
    this.name = "BrandReadinessShapeError";
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new BrandReadinessShapeError(`${field} is not text`);
  return value;
};

const optStr = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const bool = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") throw new BrandReadinessShapeError(`${field} is not true/false`);
  return value;
};

const isState = (value: unknown): value is BrandReadinessState =>
  typeof value === "string" &&
  (BRAND_READINESS_STATES as readonly string[]).includes(value);

const isAction = (value: unknown): value is BrandReadinessAction =>
  typeof value === "string" &&
  (BRAND_READINESS_ACTIONS as readonly string[]).includes(value);

function parseItem(raw: unknown, index: number): BrandReadinessItem {
  if (!isObject(raw)) throw new BrandReadinessShapeError(`items[${index}] is not an object`);
  const key = str(raw.key, `items[${index}].key`);
  if (!isState(raw.state)) {
    throw new BrandReadinessShapeError(`items[${index}] (${key}) has an unknown state`);
  }
  const fix = raw.fix;
  if (!isObject(fix)) throw new BrandReadinessShapeError(`items[${index}] (${key}) has no fix`);
  return {
    key,
    group: str(raw.group, `${key}.group`),
    label: str(raw.label, `${key}.label`),
    state: raw.state,
    valuePreview: optStr(raw.value_preview),
    blocksAction: bool(raw.blocks_action, `${key}.blocks_action`),
    deferrable: bool(raw.deferrable, `${key}.deferrable`),
    fix: {
      route: optStr(fix.route),
      routeLabel: str(fix.route_label, `${key}.fix.route_label`),
      canCallerFix: bool(fix.can_caller_fix, `${key}.fix.can_caller_fix`),
      whoCanFix: str(fix.who_can_fix, `${key}.fix.who_can_fix`),
    },
  };
}

/** Parse the RPC's jsonb answer. Throws on any shape drift (never guesses). */
export function parseBrandReadiness(raw: unknown): BrandReadiness {
  if (!isObject(raw)) throw new BrandReadinessShapeError("not an object");
  if (!Array.isArray(raw.items)) throw new BrandReadinessShapeError("items is not a list");
  const money = raw.money;
  if (!isObject(money)) throw new BrandReadinessShapeError("money is missing");
  return {
    brandId: str(raw.brand_id, "brand_id"),
    contextRevision: optStr(raw.context_revision),
    evaluatedAt: str(raw.evaluated_at, "evaluated_at"),
    action: isAction(raw.action) ? raw.action : null,
    canProceed: bool(raw.can_proceed, "can_proceed"),
    items: raw.items.map(parseItem),
    money: {
      canSell: bool(money.can_sell, "money.can_sell"),
      canBePaidOut: bool(money.can_be_paid_out, "money.can_be_paid_out"),
      sellReason: str(money.sell_reason, "money.sell_reason"),
      payoutReason: str(money.payout_reason, "money.payout_reason"),
      rail: str(money.rail, "money.rail"),
      currency: optStr(money.currency),
      termsAcceptedByCaller:
        typeof money.terms_accepted_by_caller === "boolean"
          ? money.terms_accepted_by_caller
          : null,
    },
  };
}

const rpcError = (fn: string, error: { message?: string }): Error =>
  new Error(`${fn} failed: ${error.message ?? "unknown error"}`);

/** Read the canonical readiness for one brand (optionally scoped to an action). */
export async function fetchBrandReadiness(
  brandId: string,
  action: BrandReadinessAction | null = null,
): Promise<BrandReadiness> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.rpc("brand_readiness", {
    p_brand_id: brandId,
    p_action: action,
  });
  if (error) throw rpcError("brand_readiness", error);
  return parseBrandReadiness(data);
}
