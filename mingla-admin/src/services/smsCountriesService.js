// Issue #4273 (country switches) — the server calls behind Mingla Admin's
// "SMS countries" page. Owner and admins only; the server checks (the partner
// seat and everyone else get not_authorized). Every write needs a reason, is
// audited, and carries the row's updatedAt so a stale write is refused (PT409).
import { supabase } from "../lib/supabase";

/** The 35 payout countries with switch, sender, registration and price. Throws on error. */
export async function getSmsCountries() {
  const { data, error } = await supabase.rpc("admin_sms_country_switches_list");
  if (error) {
    const err = new Error(error.message || "The server did not answer.");
    err.code = error.code;
    throw err;
  }
  return {
    marketingService: data?.marketingService ?? null,
    countries: Array.isArray(data?.countries) ? data.countries : [],
  };
}

/** Turn one country's marketing texts on or off. Returns { data, error }. */
export async function setSmsCountrySwitch({ country, on, reason, expectedUpdatedAt }) {
  return supabase.rpc("admin_set_sms_country_switch", {
    p_country: country,
    p_marketing_enabled: on,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}

/**
 * Mark a country's sender registration done (or not), and/or change its sender
 * between the marketing service and "needs a local number". null = leave as is.
 * Returns { data, error }.
 */
export async function setSmsCountryReadiness({ country, registrationDone, sender, reason, expectedUpdatedAt }) {
  return supabase.rpc("admin_set_sms_country_readiness", {
    p_country: country,
    p_registration_done: registrationDone ?? null,
    p_sender: sender ?? null,
    p_reason: reason,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  });
}
