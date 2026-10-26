import { supabase } from "./supabase";

export type ReferralAudience = "buyers" | "invited" | "both";
export type ReferralRewardKind = "cash" | "voucher" | "perk";
export type ReferralOfferStatus = "draft" | "active" | "paused" | "ended";
export interface ReferralListing {
  listingKind: "event" | "venue";
  listingId: string;
}
export interface ReferralTier {
  id?: string;
  minSales: number;
  shareBps: number;
}
export interface ReferralOffer {
  id: string;
  brandId: string;
  name: string;
  audience: ReferralAudience;
  scopeKind: "brand" | "listings";
  rewardKind: ReferralRewardKind;
  shareBps: number | null;
  voucherTemplate: Record<string, unknown> | null;
  perkText: string | null;
  perkThreshold: number | null;
  buyerDiscountId: string | null;
  budgetMinor: number | null;
  currency: string;
  startsAt: string;
  endsAt: string | null;
  status: ReferralOfferStatus;
  pausedReason: string | null;
  version: number;
  listings: ReferralListing[];
  tiers: ReferralTier[];
  memberCount: number;
  salesCount: number;
  shareMinor: number;
}
export interface ReferralOfferDraft {
  id?: string;
  brandId: string;
  name: string;
  audience: ReferralAudience;
  scopeKind: "brand" | "listings";
  rewardKind: ReferralRewardKind;
  shareBps?: number | null;
  voucherTemplate?: Record<string, unknown> | null;
  perkText?: string | null;
  perkThreshold?: number | null;
  buyerDiscountId?: string | null;
  budgetMinor?: number | null;
  currency: string;
  startsAt: string;
  endsAt?: string | null;
  status: "draft" | "active";
  version?: number;
  listings: ReferralListing[];
  tiers: ReferralTier[];
}
export interface ReferralMember {
  id: string;
  offerId: string;
  displayName: string;
  email: string | null;
  linkSlug: string;
  code: string | null;
  status: "invited" | "active" | "declined" | "removed";
  invitedAt: string;
  joinedAt: string | null;
  salesCount: number;
  revenueMinor: number;
  owedMinor: number;
  paidMinor: number;
  currency: string;
  activity: {
    kind: "sale";
    happenedAt: string;
    orderKind: "ticket" | "venue_order";
    orderId: string;
    eligibleMinor: number;
    shareMinor: number;
    status: string;
  }[];
}
export interface ReferralTrackingLink {
  id: string;
  label: string;
  slug: string;
  listingKind: "event" | "venue" | null;
  listingId: string | null;
  createdAt: string;
  archivedAt: string | null;
  touchCount: number;
  orderCount: number;
  revenueMinor: number;
}
export interface ReferralListingOption extends ReferralListing {
  label: string;
  typeLabel: string;
}
const rowObject = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;
const camel = (value: unknown): ReferralOffer => {
  const row = rowObject(value);
  return {
    id: String(row.id),
    brandId: String(row.brand_id),
    name: String(row.name),
    audience: row.audience as ReferralAudience,
    scopeKind: row.scope_kind as ReferralOffer["scopeKind"],
    rewardKind: row.reward_kind as ReferralRewardKind,
    shareBps: row.share_bps == null ? null : Number(row.share_bps),
    voucherTemplate:
      row.voucher_template && typeof row.voucher_template === "object"
        ? (row.voucher_template as Record<string, unknown>)
        : null,
    perkText: typeof row.perk_text === "string" ? row.perk_text : null,
    perkThreshold:
      row.perk_threshold == null ? null : Number(row.perk_threshold),
    buyerDiscountId:
      typeof row.buyer_discount_id === "string" ? row.buyer_discount_id : null,
    budgetMinor: row.budget_minor == null ? null : Number(row.budget_minor),
    currency: String(row.currency),
    startsAt: String(row.starts_at),
    endsAt: typeof row.ends_at === "string" ? row.ends_at : null,
    status: row.status as ReferralOfferStatus,
    pausedReason:
      typeof row.paused_reason === "string" ? row.paused_reason : null,
    version: Number(row.version ?? 1),
    listings: Array.isArray(row.listings)
      ? row.listings.map((item) => {
          const listing = rowObject(item);
          return {
            listingKind: listing.listing_kind as ReferralListing["listingKind"],
            listingId: String(listing.listing_id),
          };
        })
      : [],
    tiers: Array.isArray(row.tiers)
      ? row.tiers.map((item) => {
          const tier = rowObject(item);
          return {
            id: typeof tier.id === "string" ? tier.id : undefined,
            minSales: Number(tier.min_sales),
            shareBps: Number(tier.share_bps),
          };
        })
      : [],
    memberCount: Number(row.member_count ?? 0),
    salesCount: Number(row.sales_count ?? 0),
    shareMinor: Number(row.share_minor ?? 0),
  };
};

async function invoke<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, {
    body: body as Record<string, unknown>,
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    let detail = error.message;
    try {
      const parsed = context
        ? ((await context.clone().json()) as {
            detail?: string;
            error?: string;
          })
        : null;
      detail = parsed?.detail ?? parsed?.error ?? detail;
    } catch {
      /* keep provider message */
    }
    throw new Error(detail);
  }
  return data as T;
}

export async function fetchReferralAccess(brandId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("brand_referral_access", {
    p_brand_id: brandId,
  });
  if (error) throw error;
  return data === true;
}
export async function fetchReferralOffers(
  brandId: string,
): Promise<ReferralOffer[]> {
  const { data, error } = await supabase.rpc("brand_referral_offers", {
    p_brand_id: brandId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(camel);
}
export async function writeReferralOffer(
  action: "create" | "update" | "pause" | "resume" | "end" | "delete_draft",
  payload:
    ReferralOfferDraft | { id: string; brandId: string; version: number },
): Promise<ReferralOffer> {
  const data = await invoke<{ offer: unknown }>("referral-offer-upsert", {
    action,
    payload,
  });
  return camel(data.offer);
}
export async function fetchReferralMembers(
  brandId: string,
  offerId?: string,
): Promise<ReferralMember[]> {
  const { data, error } = await supabase.rpc("brand_referral_members", {
    p_brand_id: brandId,
    p_offer_id: offerId ?? null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((value) => {
    const row = rowObject(value);
    return {
      id: String(row.id),
      offerId: String(row.offer_id),
      displayName: String(row.display_name),
      email: typeof row.email === "string" ? row.email : null,
      linkSlug: String(row.link_slug),
      code: typeof row.code === "string" ? row.code : null,
      status: row.status as ReferralMember["status"],
      invitedAt: String(row.invited_at),
      joinedAt: typeof row.joined_at === "string" ? row.joined_at : null,
      salesCount: Number(row.sales_count ?? 0),
      revenueMinor: Number(row.revenue_minor ?? 0),
      owedMinor: Number(row.owed_minor ?? 0),
      paidMinor: Number(row.paid_minor ?? 0),
      currency: String(row.currency),
      activity: Array.isArray(row.activity)
        ? row.activity.map((item) => {
            const activity = rowObject(item);
            return {
              kind: "sale" as const,
              happenedAt: String(activity.happened_at),
              orderKind: activity.order_kind as "ticket" | "venue_order",
              orderId: String(activity.order_id),
              eligibleMinor: Number(activity.eligible_minor ?? 0),
              shareMinor: Number(activity.share_minor ?? 0),
              status: String(activity.status),
            };
          })
        : [],
    };
  });
}
export async function inviteReferralMembers(
  offerId: string,
  members: { email: string; displayName?: string; code?: string }[],
) {
  return invoke<{
    members: unknown[];
    delivery: { email: string; sent: boolean }[];
  }>("referral-member-invite", { offerId, members });
}
export async function removeReferralMember(memberId: string): Promise<void> {
  await invoke("referral-member-remove", { memberId });
}
export async function fetchReferralListingOptions(
  brandId: string,
): Promise<ReferralListingOption[]> {
  const [events, venues] = await Promise.all([
    supabase
      // orch-strict-grep-allow events-type-filter — the referral offer picker intentionally includes every public offering kind and filters with an explicit .in
      .from("events")
      .select("id,title,event_type")
      .eq("brand_id", brandId)
      .in("event_type", ["event", "experience", "trip", "rsvp"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("venue_listings")
      .select("id,name,venue_category")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (events.error) throw events.error;
  if (venues.error) throw venues.error;
  return [
    ...(events.data ?? []).map((row) => ({
      listingKind: "event" as const,
      listingId: String(row.id),
      label: String(row.title ?? "Untitled listing"),
      typeLabel: String(row.event_type ?? "event"),
    })),
    ...(venues.data ?? []).map((row) => ({
      listingKind: "venue" as const,
      listingId: String(row.id),
      label: String(row.name ?? "Untitled venue"),
      typeLabel: String(row.venue_category ?? "venue"),
    })),
  ];
}
export async function fetchTrackingLinks(
  brandId: string,
): Promise<ReferralTrackingLink[]> {
  const { data, error } = await supabase.rpc("brand_tracking_links", {
    p_brand_id: brandId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((value) => {
    const row = rowObject(value);
    return {
      id: String(row.id),
      label: String(row.label),
      slug: String(row.slug),
      listingKind:
        typeof row.listing_kind === "string"
          ? (row.listing_kind as "event" | "venue")
          : null,
      listingId: typeof row.listing_id === "string" ? row.listing_id : null,
      createdAt: String(row.created_at),
      archivedAt: typeof row.archived_at === "string" ? row.archived_at : null,
      touchCount: Number(row.touch_count ?? 0),
      orderCount: Number(row.order_count ?? 0),
      revenueMinor: Number(row.revenue_minor ?? 0),
    };
  });
}
export async function writeTrackingLink(
  action: "create" | "archive",
  payload: Record<string, unknown>,
) {
  return invoke<{ link: Record<string, unknown> }>(
    "referral-tracking-link-upsert",
    { action, payload },
  );
}
export async function fetchReferralReport(
  brandId: string,
  from: string,
  to: string,
  offerId?: string,
) {
  const { data, error } = await supabase.rpc("brand_referral_report", {
    p_brand_id: brandId,
    p_from: from,
    p_to: to,
    p_offer_id: offerId ?? null,
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}
