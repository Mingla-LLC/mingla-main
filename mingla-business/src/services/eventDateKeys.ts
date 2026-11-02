import { supabase } from "./supabase";

export interface EventDateKeyRow {
  id: string;
  occurrence_key: string | null;
  cancelled_at: string | null;
  end_at: string;
}

/** issue #3281 — each date's stable key, null when it has none. */
export const fetchEventDateKeys = async (
  eventId: string,
): Promise<EventDateKeyRow[]> => {
  const { data, error } = await supabase
    .from("event_dates")
    .select("id,occurrence_key,cancelled_at,end_at")
    .eq("event_id", eventId);
  if (error !== null) throw error;
  return (data ?? []) as EventDateKeyRow[];
};
