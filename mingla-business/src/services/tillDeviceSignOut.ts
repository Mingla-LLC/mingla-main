/**
 * #4490 spec 08 O5 part B (carried from part A) — Account › Sign out on a Till
 * device login asks for a manager's PIN (or the device's own email code when
 * nobody at the venue has a PIN, §12 item 5), the same rule and the SAME flow
 * as the Till's "Sign this device out": Account sends the person to the Till's
 * sign-out step instead of signing out at once.
 *
 * A login is a Till device at a venue when it holds venue.till_device there
 * and the Till is released at that venue (the server's pin_gate answers that
 * through "Who's selling?"). Any other account signs out as before.
 *
 * Loaded on use only (Account imports it when Sign out is pressed), so the
 * Account tab's bundle does not grow.
 */

import { supabase } from "./supabase";
import { fetchTillPinStaff } from "./tillPinService";

/** The device sign-out step on the Till route. */
export function tillSignOutHref(venueId: string): string {
  return `/venue/${venueId}/till?signout=1`;
}

/**
 * The venue whose manager must approve this account's sign-out, or null when
 * it is not a gated Till device anywhere (sign out as normal). A read that
 * fails answers null: the device's PIN sessions end on the server with any
 * sign-out, and nobody is ever kept signed in by a network error.
 */
export async function tillDeviceSignOutVenue(userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  const { data, error } = await supabase
    .from("brand_team_member_venue_grants")
    .select("venue_id, capabilities, brand_team_members!inner(user_id, removed_at)")
    .eq("brand_team_members.user_id", userId)
    .is("brand_team_members.removed_at", null)
    .contains("capabilities", ["venue.till_device"])
    .limit(5);
  if (error || !Array.isArray(data)) {
    if (error) console.warn("[till-sign-out] device lookup failed", error.code ?? "unknown");
    return null;
  }
  for (const row of data as Array<{ venue_id?: unknown }>) {
    const venueId = typeof row.venue_id === "string" ? row.venue_id : null;
    if (venueId === null) continue;
    try {
      const staff = await fetchTillPinStaff(venueId);
      if (staff.gated) return venueId;
    } catch (err) {
      console.warn("[till-sign-out] gate read failed", err instanceof Error ? err.message : "unknown");
    }
  }
  return null;
}
