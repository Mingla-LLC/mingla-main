// #2879 / #2947 — waiting-room queue-health data layer.
import { supabase } from "../lib/supabase";

export async function getQueueHealth(windowHours = 72) {
  const { data, error } = await supabase.rpc("admin_get_queue_health", {
    p_hours: windowHours,
  });
  if (error) throw new Error(error.message || "Could not load queue health.");
  return data;
}
