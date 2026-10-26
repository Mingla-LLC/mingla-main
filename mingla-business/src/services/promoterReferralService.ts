import { supabase } from "./supabase";

export interface PromotingOffer {
  memberId: string;
  offerId: string;
  brandId: string;
  brandName: string;
  offerName: string;
  rewardKind: "cash" | "voucher" | "perk";
  shareBps: number | null;
  perkText: string | null;
  perkThreshold: number | null;
  currency: string;
  linkSlug: string;
  code: string | null;
  status: string;
  salesCount: number;
  earnedMinor: number;
  paidMinor: number;
}

export async function fetchPromotingOffers(): Promise<PromotingOffer[]> {
  const { data, error } = await supabase.rpc("my_promoting_offers");
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as PromotingOffer[];
}

// #3872 — the promoter's own money in the three approved words
// (On the way · Ready · Paid), from creator_earnings_summary().
export type EarningsState = "on_the_way" | "ready" | "paid";
export interface PromoterEarnings {
  currency: string | null;
  onTheWayMinor: number;
  readyMinor: number;
  paidMinor: number;
}

export async function fetchPromoterEarnings(): Promise<PromoterEarnings | null> {
  const { data, error } = await supabase.rpc("creator_earnings_summary");
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const rows = Array.isArray(row.rows)
    ? (row.rows as Array<Record<string, unknown>>)
    : [];
  const referral = rows.filter((item) => item.kind === "referral");
  if (referral.length === 0) {
    return {
      currency: typeof row.currency === "string" ? row.currency : null,
      onTheWayMinor: 0,
      readyMinor: 0,
      paidMinor: 0,
    };
  }
  const sum = (state: EarningsState) =>
    referral
      .filter((item) => item.state === state)
      .reduce((total, item) => total + Number(item.amount_minor ?? 0), 0);
  return {
    currency:
      typeof referral[0].currency === "string"
        ? referral[0].currency
        : typeof row.currency === "string"
          ? row.currency
          : null,
    onTheWayMinor: sum("on_the_way"),
    readyMinor: sum("ready"),
    paidMinor: sum("paid"),
  };
}

export type PayoutAccountStatus = {
  state: "connected" | "pending" | "none";
  country: string | null;
};

/** The caller's own payout account (owner-readable row). Provider names never leave here. */
export async function fetchMyPayoutAccount(): Promise<PayoutAccountStatus> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return { state: "none", country: null };
  const { data, error } = await supabase
    .from("payee_accounts")
    .select("stripe_status,paystack_status,stripe_country,paystack_country")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return { state: "none", country: null };
  if (data.stripe_status === "active")
    return { state: "connected", country: data.stripe_country ?? null };
  if (data.paystack_status === "verified")
    return { state: "connected", country: data.paystack_country ?? null };
  if (
    data.stripe_status === "onboarding" ||
    data.stripe_status === "restricted"
  )
    return { state: "pending", country: data.stripe_country ?? null };
  return { state: "none", country: null };
}
