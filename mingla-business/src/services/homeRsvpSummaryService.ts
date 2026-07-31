/** Issue #1447 — lazy Home-only RSVP admission summary reader. */
import { supabase } from "./supabase";

export async function fetchHomeRsvpCheckinSummary(eventId: string): Promise<{
  going: number;
  capacity: number | null;
  checkedIn: number;
}> {
  const { data, error } = await supabase.rpc("rsvp_event_checkin_summary", {
    p_event_id: eventId,
  });
  if (error) throw error;
  const value = (data ?? {}) as {
    going?: number;
    capacity?: number | null;
    checkedIn?: number;
  };
  return {
    going: value.going ?? 0,
    capacity: value.capacity ?? null,
    checkedIn: value.checkedIn ?? 0,
  };
}
