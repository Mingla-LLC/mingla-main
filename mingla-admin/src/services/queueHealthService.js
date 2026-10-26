// #2879 / #2947 — waiting-room queue-health data layer.
import { supabase } from "../lib/supabase";

export async function getQueueHealth(windowHours = 72) {
  const { data, error } = await supabase.rpc("admin_get_queue_health", {
    p_hours: windowHours,
  });
  if (error) {
    // #4130 (Wave 4b): keep the code, so Platform health can tell "this
    // function is not in production yet" (PGRST202) from a failed load.
    const err = new Error(error.message || "Could not load queue health.");
    err.code = error.code;
    throw err;
  }
  return data;
}
