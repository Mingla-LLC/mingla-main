import { supabase } from "./supabase";

/**
 * Issue #3969 — the reads of profile data that are not public.
 *
 * - The signed-in person's own row comes from `get_my_profile` (never a
 *   direct table read).
 * - Other people are found through `issue_3969_resolve_person`, which returns
 *   an id and username only.
 */

/** The caller's own profile row. Chain `.single()` / `.maybeSingle()` / `.select(...)`. */
export function readMyProfile() {
  return supabase.rpc("get_my_profile");
}

export interface ResolvedPerson {
  user_exists: boolean;
  can_view: boolean;
  is_blocked: boolean;
  profile_id: string | null;
  username: string | null;
}

interface ResolvedPersonRow {
  user_exists?: boolean | null;
  can_view?: boolean | null;
  is_blocked?: boolean | null;
  profile_id?: string | null;
  username?: string | null;
}

/** Find a person by email, username or user id. Throws when the lookup fails. */
export async function resolvePerson(identifier: string): Promise<ResolvedPerson> {
  const { data, error } = await supabase.rpc("issue_3969_resolve_person", {
    p_identifier: identifier,
  });
  if (error) throw new Error(error.message || "Could not look up that person.");
  const row = (Array.isArray(data) ? data[0] : data) as ResolvedPersonRow | null | undefined;
  return {
    user_exists: row?.user_exists === true,
    can_view: row?.can_view === true,
    is_blocked: row?.is_blocked === true,
    profile_id: row?.profile_id ?? null,
    username: row?.username ?? null,
  };
}
