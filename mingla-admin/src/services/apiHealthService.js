// ORCH-1199 — Admin API-Health hub data layer.
// Wraps the SECURITY DEFINER admin RPCs over the existing Supabase client.
// Throws a human-readable message on reject (mirrors src/lib/pricing.js).
import { supabase } from "../lib/supabase";

export async function getApiHealth() {
  const { data, error } = await supabase.rpc("admin_get_api_health");
  if (error) throw new Error(error.message || "Could not load API health.");
  return data;
}

export async function getApiHealthIncidents(serviceKey, limit = 50) {
  const { data, error } = await supabase.rpc("admin_get_api_health_incidents", {
    p_service_key: serviceKey,
    p_limit: limit,
  });
  if (error) throw new Error(error.message || "Could not load incidents.");
  return data;
}
