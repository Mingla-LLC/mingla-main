/**
 * Ve1 — detect whether a typed venue name likely exists in consumer place_pool.
 * Ve2 will own fuzzy match / claim UX; Ve1 only needs a coarse gate for the fork.
 */

import { supabase } from "./supabase";

/**
 * Returns true when at least one active place_pool row matches the name (ILIKE contains).
 * Uses `biz_place_pool_name_contains` so `%`, `_`, and `\` in user input are literal.
 */
export async function placePoolHasNameMatch(name: string): Promise<boolean> {
  const q = name.trim();
  if (q.length < 2) return false;

  const { data, error } = await supabase.rpc("biz_place_pool_name_contains", {
    p_query: q,
  });

  if (error !== null) throw error;
  return data === true;
}
