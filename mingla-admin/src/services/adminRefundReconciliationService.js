import { invokeWithRefresh } from "../lib/supabase";

export async function reconcileTicketRefund(refundId) {
  const { data, error } = await invokeWithRefresh("admin-reconcile-ticket-refund", {
    body: { refundId },
  });
  if (error) throw new Error(error.message || "Reconciliation failed.");
  return data;
}
