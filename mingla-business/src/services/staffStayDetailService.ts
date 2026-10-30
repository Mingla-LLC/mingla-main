import { parsePublicStayDetail } from "@mingla/brand-rendering/stayGuest";
import type { PublicStayDetail } from "@mingla/brand-rendering/stayGuest";

import { supabase } from "./supabase";

/** Authenticated Stay inventory projection for the staff operations shell. */
export async function fetchStaffStayDetail(
  venueId: string,
): Promise<PublicStayDetail | null> {
  const { data, error } = await supabase.rpc("issue_4188_staff_stay_details", {
    p_venue_id: venueId,
  });
  if (error) throw error;
  return parsePublicStayDetail(data, (path) =>
    supabase.storage.from("brand_covers").getPublicUrl(path).data.publicUrl
  );
}
