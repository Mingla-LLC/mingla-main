import { supabase } from "./supabase";

export type DiscountKind = "code" | "automatic" | "sale_price";
export type DiscountValueType = "percent" | "amount" | "set_price";
export type DiscountScopeKind =
  "brand" | "listing_kinds" | "listings" | "items";
export type DiscountCombinesWith = "none" | "automatic_only" | "any";
export type DiscountFilter = "live" | "scheduled" | "ended" | "needs_attention";

export interface DiscountTarget {
  targetKind:
    | "listing_kind"
    | "event"
    | "ticket_type"
    | "venue_menu"
    | "menu_item"
    | "venue_deposit";
  listingKind?:
    | "event"
    | "experience"
    | "trip"
    | "venue_order"
    | "reservation_deposit"
    | null;
  targetId?: string | null;
  orphanedAt?: string | null;
}

export interface BrandDiscount {
  id: string;
  brandId: string;
  kind: DiscountKind;
  code: string | null;
  name: string;
  valueType: DiscountValueType;
  valueBps: number | null;
  valueMinor: number | null;
  currency: string | null;
  scopeKind: DiscountScopeKind;
  combinesWith: DiscountCombinesWith;
  startsAt: string;
  endsAt: string | null;
  schedule: { days: number[]; from: string; to: string } | null;
  endsAfterCount: number | null;
  maxTotalUses: number | null;
  maxUsesPerBuyer: number | null;
  minSubtotalMinor: number | null;
  status: "draft" | "active" | "paused" | "ended";
  endedReason: string | null;
  needsAttention: string | null;
  version: number;
  consumedUnits: number;
  liveUses: number;
  targets: DiscountTarget[];
}

export interface DiscountDraft {
  id?: string;
  brandId: string;
  kind: DiscountKind;
  code?: string | null;
  name: string;
  valueType: DiscountValueType;
  valueBps?: number | null;
  valueMinor?: number | null;
  currency?: string | null;
  scopeKind: DiscountScopeKind;
  combinesWith: DiscountCombinesWith;
  startsAt: string;
  endsAt?: string | null;
  schedule?: { days: number[]; from: string; to: string } | null;
  endsAfterCount?: number | null;
  maxTotalUses?: number | null;
  maxUsesPerBuyer?: number | null;
  minSubtotalMinor?: number | null;
  status?: "draft" | "active";
  source?: "host" | "ari";
  version?: number;
  targets: DiscountTarget[];
}

export interface BrandPriceRow {
  kind: "ticket_type" | "menu_item" | "venue_deposit";
  id: string;
  listingName: string;
  itemName: string;
  listUnitCents: number;
  currentSaleCents: number | null;
  saleEndsAt: string | null;
  discountsAllowed: boolean;
  ownerRoute: string;
}

export interface BrandDiscountPreviewRow {
  itemName: string;
  listUnitMinor: number;
  netUnitMinor: number;
  allInListCents: number;
  allInNetCents: number;
}

export interface DiscountReport {
  orders: number;
  revenueCents: number;
  amountGivenAwayCents: number;
  firstTimeBuyerPercent: number;
  discounts: Array<{
    discountId: string;
    name: string;
    orders: number;
    amountGivenAwayCents: number;
  }>;
}

export interface OrderDiscountLine {
  id: string;
  lineRef: string | null;
  discountId: string;
  name: string;
  amountMinor: number;
  currency: string;
  appliedSeq: number;
}

const snakeToCamel = (value: Record<string, unknown>): BrandDiscount => ({
  id: String(value.id),
  brandId: String(value.brand_id),
  kind: value.kind as DiscountKind,
  code: typeof value.code === "string" ? value.code : null,
  name: String(value.name ?? "Discount"),
  valueType: value.value_type as DiscountValueType,
  valueBps: value.value_bps == null ? null : Number(value.value_bps),
  valueMinor: value.value_minor == null ? null : Number(value.value_minor),
  currency: typeof value.currency === "string" ? value.currency : null,
  scopeKind: value.scope_kind as DiscountScopeKind,
  combinesWith: value.combines_with as DiscountCombinesWith,
  startsAt: String(value.starts_at),
  endsAt: typeof value.ends_at === "string" ? value.ends_at : null,
  schedule:
    value.schedule && typeof value.schedule === "object"
      ? (value.schedule as BrandDiscount["schedule"])
      : null,
  endsAfterCount:
    value.ends_after_count == null ? null : Number(value.ends_after_count),
  maxTotalUses:
    value.max_total_uses == null ? null : Number(value.max_total_uses),
  maxUsesPerBuyer:
    value.max_uses_per_buyer == null ? null : Number(value.max_uses_per_buyer),
  minSubtotalMinor:
    value.min_subtotal_minor == null ? null : Number(value.min_subtotal_minor),
  status: value.status as BrandDiscount["status"],
  endedReason:
    typeof value.ended_reason === "string" ? value.ended_reason : null,
  needsAttention:
    typeof value.needs_attention === "string" ? value.needs_attention : null,
  version: Number(value.version ?? 1),
  consumedUnits: Number(value.consumedUnits ?? 0),
  liveUses: Number(value.liveUses ?? 0),
  targets: Array.isArray(value.targets)
    ? value.targets.map((target) => {
        const row = target as Record<string, unknown>;
        return {
          targetKind: String(row.target_kind) as DiscountTarget["targetKind"],
          listingKind:
            typeof row.listing_kind === "string"
              ? (row.listing_kind as DiscountTarget["listingKind"])
              : null,
          targetId: typeof row.target_id === "string" ? row.target_id : null,
          orphanedAt:
            typeof row.orphaned_at === "string" ? row.orphaned_at : null,
        };
      })
    : [],
});

export async function fetchDiscountAccess(brandId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("brand_discount_access", {
    p_brand_id: brandId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function fetchBrandDiscounts(
  brandId: string,
  filter: DiscountFilter,
): Promise<BrandDiscount[]> {
  const { data, error } = await supabase.rpc("brand_discounts_list", {
    p_brand_id: brandId,
    p_filter: filter,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((row) =>
    snakeToCamel(row as Record<string, unknown>),
  );
}

export async function fetchBrandDiscountById(
  brandId: string,
  discountId: string,
): Promise<BrandDiscount | null> {
  const pages = await Promise.all(
    (["live", "scheduled", "ended", "needs_attention"] as const).map((filter) =>
      fetchBrandDiscounts(brandId, filter),
    ),
  );
  return pages.flat().find((row) => row.id === discountId) ?? null;
}

export async function fetchBrandPrices(
  brandId: string,
): Promise<BrandPriceRow[]> {
  const { data, error } = await supabase.rpc("brand_prices_overview", {
    p_brand_id: brandId,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((value) => {
    const row = value as Record<string, unknown>;
    return {
      kind: row.kind as BrandPriceRow["kind"],
      id: String(row.id),
      listingName: String(row.listingName ?? "Listing"),
      itemName: String(row.itemName ?? "Item"),
      listUnitCents: Number(row.listUnitCents ?? 0),
      currentSaleCents:
        row.currentSaleCents == null ? null : Number(row.currentSaleCents),
      saleEndsAt: typeof row.saleEndsAt === "string" ? row.saleEndsAt : null,
      discountsAllowed: row.discountsAllowed === true,
      ownerRoute: String(row.ownerRoute ?? ""),
    };
  });
}

export async function previewBrandDiscount(
  brandId: string,
  draft: DiscountDraft,
): Promise<BrandDiscountPreviewRow[]> {
  const { data, error } = await supabase.rpc("brand_discount_preview", {
    p_brand_id: brandId,
    p_draft: draft,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((value) => {
    const row = value as Record<string, unknown>;
    return {
      itemName: String(row.itemName ?? "Item"),
      listUnitMinor: Number(row.listUnitMinor ?? 0),
      netUnitMinor: Number(row.netUnitMinor ?? 0),
      allInListCents: Number(row.allInListCents ?? 0),
      allInNetCents: Number(row.allInNetCents ?? 0),
    };
  });
}

export class DiscountWriteError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "DiscountWriteError";
  }
}

export async function writeBrandDiscount(
  action: "create" | "update" | "pause" | "resume" | "end" | "delete_draft",
  payload: DiscountDraft | { id: string; brandId: string; version?: number },
): Promise<BrandDiscount> {
  const { data, error } = await supabase.functions.invoke(
    "brand-discount-upsert",
    { body: { action, payload } },
  );
  if (error) {
    let detail = "internal";
    const context = (error as { context?: Response }).context;
    try {
      const parsed = context
        ? ((await context.clone().json()) as { detail?: unknown })
        : null;
      if (typeof parsed?.detail === "string") detail = parsed.detail;
    } catch {
      // Keep the stable fallback.
    }
    throw new DiscountWriteError(detail);
  }
  const row = (data as { discount?: Record<string, unknown> } | null)?.discount;
  if (!row) throw new DiscountWriteError("empty_response");
  return snakeToCamel(row);
}

export async function setDiscountsAllowed(
  kind: BrandPriceRow["kind"] | "event",
  ids: string[],
  allowed: boolean,
): Promise<number> {
  const { data, error } = await supabase.rpc("biz_set_discounts_allowed", {
    p_kind: kind,
    p_ids: ids,
    p_allowed: allowed,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function fetchDiscountsAllowed(
  kind: BrandPriceRow["kind"] | "event",
  id: string,
): Promise<boolean> {
  const table =
    kind === "event"
      ? "events"
      : kind === "ticket_type"
        ? "ticket_types"
        : kind === "menu_item"
          ? "menu_items"
          : "venue_reservation_settings";
  const idColumn = kind === "venue_deposit" ? "venue_id" : "id";
  const { data, error } = await supabase
    .from(table)
    .select("discounts_allowed")
    .eq(idColumn, id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (
    (data as { discounts_allowed?: unknown } | null)?.discounts_allowed !==
    false
  );
}

export async function fetchDiscountReport(
  brandId: string,
  from: string,
  to: string,
): Promise<DiscountReport> {
  const { data, error } = await supabase.rpc("brand_discount_report", {
    p_brand_id: brandId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return data as DiscountReport;
}

export async function fetchDiscountReportBuyers(
  brandId: string,
  from: string,
  to: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.rpc("brand_discount_report_buyers", {
    p_brand_id: brandId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

export async function fetchOrderDiscountLines(
  kind: "ticket" | "venue_order" | "reservation_deposit",
  orderId: string,
): Promise<OrderDiscountLine[]> {
  const { data, error } = await supabase.rpc("order_discount_lines_for_order", {
    p_order_kind: kind,
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map((value) => {
    const row = value as Record<string, unknown>;
    return {
      id: String(row.id),
      lineRef: typeof row.line_ref === "string" ? row.line_ref : null,
      discountId: String(row.discount_id),
      name: String(row.name_snapshot ?? "Discount"),
      amountMinor: Number(row.amount_minor ?? 0),
      currency: String(row.currency ?? ""),
      appliedSeq: Number(row.applied_seq ?? 1),
    };
  });
}
