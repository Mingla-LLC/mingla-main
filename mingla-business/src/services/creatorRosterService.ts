import { supabase } from "./supabase";

export type CreatorRosterRow = {
  id: string;
  name: string;
  platform: string | null;
  handle: string | null;
  email: string | null;
  notes: string | null;
  status: string;
  linked_creator_account_id: string | null;
  referral_member_id: string | null;
  link_slug: string | null;
  offer_name: string | null;
  sales_count: number;
  revenue_minor: number;
  currency: string | null;
  updated_at: string;
};

async function rpc<T>(name: string, input: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data as T;
}

export const creatorRosterService = {
  save: (brandId: string, payload: Record<string, unknown>) =>
    rpc("brand_creator_roster_save", { p_brand_id: brandId, p_payload: payload }),
  list: (brandId: string) =>
    rpc<CreatorRosterRow[]>("brand_creator_roster_list", { p_brand_id: brandId }),
  linkInvite: (rosterId: string, memberId: string) =>
    rpc("brand_creator_roster_link_invite", {
      p_roster_id: rosterId,
      p_member_id: memberId,
    }),
};
