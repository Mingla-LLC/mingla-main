/**
 * Ve1 — detect whether a typed venue name likely exists in consumer place_pool.
 * Ve2 will own fuzzy match / claim UX; Ve1 only needs a coarse gate for the fork.
 */

import { supabase } from "./supabase";

/**
 * Returns true when at least one active place_pool row matches the name (ILIKE contains).
 */
export async function placePoolHasNameMatch(name: string): Promise<boolean> {
  const q = name.trim();
  if (q.length < 2) return false;

  const pattern = `%${q}%`;
  const { data, error } = await supabase
    .from("place_pool")
    .select("id")
    .ilike("name", pattern)
    .eq("is_active", true)
    .limit(1);

  if (error !== null) throw error;
  return (data?.length ?? 0) > 0;
}
