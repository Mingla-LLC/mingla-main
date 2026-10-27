import { supabase } from "./supabase";

export type BrandLocalReview = {
  local_month_id: string;
  name: string;
  rating: number;
  title: string;
  body: string;
  visited_on: string;
  reply: string | null;
  reply_at: string | null;
  reply_editable_until: string | null;
  published_at: string;
};

async function rpc<T>(name: string, input: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data as T;
}

export const localReviewsService = {
  forClaimedPlace: (brandId: string, placePoolId: string) =>
    rpc<BrandLocalReview[]>("brand_place_local_reviews", {
      p_brand_id: brandId,
      p_place_id: placePoolId,
    }),
  reply: (brandId: string, localMonthId: string, reply: string) =>
    rpc<{ ok: boolean }>("local_place_reply", {
      p_local_month_id: localMonthId,
      p_brand_id: brandId,
      p_reply: reply,
    }),
};
