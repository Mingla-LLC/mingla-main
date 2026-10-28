// Issue #4130 (Wave 2b) — the one caller of the messaging-limit RPCs.
//
// Every call is an admin RPC (is_admin_user() on the server; writes are
// audited there with the signed-in admin as the actor). Reads throw on error
// so the page shows its error state; writes return { data, error } so the
// panel can show the refusal inline.
import { supabase } from "../lib/supabase";

/** Defaults plus every brand's limits and usage this month (UTC). */
export async function getMessagingLimitsOverview() {
  const { data, error } = await supabase.rpc("admin_messaging_limits_overview");
  if (error) throw new Error(error.message || "messaging_limits_load_failed");
  return {
    monthStart: data?.month_start ?? null,
    defaults: data?.defaults ?? null,
    brands: Array.isArray(data?.brands) ? data.brands : [],
  };
}

export async function setMessagingLimitDefaults({ email, sms, push, weekWarningAt, reason }) {
  return supabase.rpc("admin_set_messaging_limit_defaults", {
    p_email_monthly: email,
    p_sms_monthly: sms,
    p_push_monthly: push,
    p_week_warning_at: weekWarningAt,
    p_reason: reason,
  });
}

export async function setBrandMessagingLimits({ brandId, email, sms, push, weekWarningAt, endsAt, reason }) {
  return supabase.rpc("admin_set_brand_messaging_limits", {
    p_brand_id: brandId,
    p_email_monthly: email,
    p_sms_monthly: sms,
    p_push_monthly: push,
    p_week_warning_at: weekWarningAt,
    p_ends_at: endsAt,
    p_reason: reason,
  });
}

export async function clearBrandMessagingLimits({ brandId, reason }) {
  return supabase.rpc("admin_clear_brand_messaging_limits", {
    p_brand_id: brandId,
    p_reason: reason,
  });
}
