import { supabase } from "./supabase";

/** issue #3281 — `event_dates.id` to its stable key, null when it has none. */
export const fetchEventDateKeys = async (
  eventId: string,
): Promise<Record<string, string | null>> => {
  const { data, error } = await supabase
    .from("event_dates")
    .select("id,occurrence_key")
    .eq("event_id", eventId);
  if (error !== null) throw error;
  return Object.fromEntries(
    (data ?? []).map((row) => [row.id as string, (row.occurrence_key as string | null) ?? null]),
  );
};
