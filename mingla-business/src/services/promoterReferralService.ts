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
