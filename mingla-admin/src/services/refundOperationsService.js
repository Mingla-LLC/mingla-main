// Issue #3512 — this service MUST go through invokeWithRefresh, not the raw
// supabase.functions.invoke. Admin JWTs expire after 1h; an idle Refund
// operations tab race-loses autoRefreshToken and sends a stale Bearer, which
// these edge functions reject with 401 (not_authenticated). PostgREST reads on
// the same session keep working, so the page looked selectively broken.
// invokeWithRefresh pre-refreshes near expiry and retries a 401 exactly once.
async function invokeAdminFunction(name, options) {
  const { invokeWithRefresh } = await import("../lib/supabase");
  return invokeWithRefresh(name, options);
}

/**
 * Issue #3512 — true when an edge-function error is an expired/absent session
 * (HTTP 401 `not_authenticated`) rather than a queue failure.
 *
 * Deliberately NOT true for 403 `not_authorized`: the admin functions return
 * 401 when `auth.getUser()` rejects the Bearer and 403 when the caller is not
 * an active admin. Re-authenticating fixes the first and cannot fix the second.
 */
export function isSessionExpiredError(error) {
  if (!error) return false;
  const status = error?.context?.status ?? error?.status;
  if (status === 401) return true;
  const message = typeof error?.message === "string" ? error.message : "";
  return message.includes("not_authenticated");
}

export const SESSION_EXPIRED_MESSAGE =
  "Your admin session expired. Sign in again to load refund operations.";

export async function listSourceRefundOperations(
  { filters = {}, limit = 50, cursor = null } = {},
  invoke = invokeAdminFunction,
) {
  const { data, error } = await invoke(
    "admin-source-refund-operations",
    {
      body: cursor
        ? { mode: "list", filters, cursor }
        : { mode: "list", filters, limit },
    },
  );
  if (error) throw error;
  return data;
}

export async function getSourceRefundOperation(
  refundId,
  invoke = invokeAdminFunction,
) {
  const { data, error } = await invoke(
    "admin-source-refund-operations",
    { body: { mode: "detail", refundId } },
  );
  if (error) throw error;
  return data?.item ?? null;
}

export async function actOnSourceRefund(
  { refundId, action, reason },
  invoke = invokeAdminFunction,
) {
  const { data, error } = await invoke(
    "admin-source-refund-action",
    { body: { refundId, action, reason } },
  );
  if (error) throw error;
  return data?.refund ?? null;
}

export async function recoverSourceRefundAttention(
  {
    refundId,
    action,
    expectedGeneration,
    deliveryId,
    channel,
    newContact,
    reasonCode,
  },
  invoke = invokeAdminFunction,
) {
  const body = {
    refundId,
    action,
    expectedGeneration,
    reasonCode,
    ...(action === "correct_attention_contact"
      ? { channel, newContact }
      : action === "reclaim_confirmed_unsent"
      ? { deliveryId, channel }
      : {}),
  };
  const { data, error } = await invoke(
    "admin-source-refund-action",
    { body },
  );
  if (error) throw error;
  return data?.refund ?? null;
}

export function appendCapturedQueuePage(current, page) {
  if (!current) return page;
  if (
    !page ||
    page.snapshot_id !== current.snapshot_id ||
    page.snapshot_created_at !== current.snapshot_created_at
  ) {
    throw new Error("snapshot_mismatch");
  }
  const items = [...(current.items ?? []), ...(page.items ?? [])];
  const identities = items.map((item) => `${item.itemKind}:${item.itemId}`);
  const ordinals = items.map((item) => item.ordinal);
  if (
    new Set(identities).size !== identities.length ||
    new Set(ordinals).size !== ordinals.length ||
    ordinals.some((ordinal, index) => ordinal !== index)
  ) {
    throw new Error("snapshot_page_discontinuity");
  }
  return { ...page, items };
}
