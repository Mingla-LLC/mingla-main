import { supabase, invokeWithRefresh } from "../lib/supabase";

export async function getAdminStayVenue(venueId) {
  const { data, error } = await supabase.rpc(
    "issue_1427_admin_stay_venue_projection",
    { p_venue_id: venueId },
  );
  if (error) throw new Error(error.message || "Failed to load this Stay.");
  return data;
}

export async function listAdminStayOperations({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc(
    "issue_1427_admin_list_stay_operations",
    {
      p_search: search || null,
      p_kind: filters.kind || null,
      p_limit: pageSize,
      p_offset: page * pageSize,
    },
  );
  if (error) throw new Error(error.message || "Failed to load Stay operations.");
  return { rows: data?.rows ?? [], total: Number(data?.total) || 0, counts: data?.counts ?? {} };
}

export async function getAdminStayGroup(groupId) {
  const { data, error } = await supabase.rpc(
    "issue_1427_admin_stay_group_projection",
    { p_group_id: groupId },
  );
  if (error) throw new Error(error.message || "Failed to load this Stay reservation.");
  return data;
}

export async function pauseAdminStayOffering({ offeringId, expectedVersion, reason }) {
  const { data, error } = await supabase.rpc(
    "issue_1427_admin_pause_stay_offering",
    {
      p_offering_id: offeringId,
      p_expected_version: expectedVersion,
      p_reason: reason,
    },
  );
  if (error) throw new Error(mapStayAdminError(error));
  return data;
}

export async function retryAdminStayNotification({ groupId, reason }) {
  const { data, error } = await supabase.rpc(
    "issue_1427_admin_retry_stay_notification",
    { p_group_id: groupId, p_reason: reason },
  );
  if (error) throw new Error(mapStayAdminError(error));
  return data;
}

export async function reconcileAdminStayPayment({ paymentAttemptId, reason }) {
  const { data, error } = await invokeWithRefresh("admin-stay-operations", {
    body: { mode: "reconcile_payment", paymentAttemptId, reason },
  });
  if (error) throw new Error(mapStayAdminError(error));
  if (data?.error) throw new Error(mapStayAdminError({ message: data.error }));
  return data;
}

export async function retryAdminStayMaterialization({ alertId, reason }) {
  const { data, error } = await supabase.rpc(
    "issue_1427_admin_retry_stay_materialization",
    { p_alert_id: alertId, p_reason: reason },
  );
  if (error) throw new Error(mapStayAdminError(error));
  return data;
}

export function mapStayAdminError(error) {
  const message = error?.message || "";
  if (message.includes("not_authorized") || message.includes("forbidden")) return "Active Admin access is required.";
  if (message.includes("reason_required")) return "Enter a reason for the audit record.";
  if (message.includes("stay_version_conflict")) return "This Stay changed. Reload it before trying again.";
  if (message.includes("provider_evidence_mismatch")) return "The provider record does not match Mingla's amount, currency, account, or Stay identity.";
  if (message.includes("provider_unavailable")) return "The payment provider could not be reached. Try again later.";
  if (message.includes("stay_notification_retry_unavailable")) return "There are no failed Stay notifications to retry.";
  if (message.includes("stay_alert_evidence_incomplete")) return "This alert does not contain enough original evidence for a safe retry.";
  if (message.includes("stay_invalid_transition")) return "That action is no longer valid for the current state.";
  return message || "The Stay support action failed. Reload and try again.";
}
