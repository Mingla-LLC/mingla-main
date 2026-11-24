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

// Issue #4522 (H-2) — a second-provider trip cancel refund that was sent and
// never answered. These are database functions called with the admin's own
// session (they check is_admin_user() and record auth.uid() as who acted),
// so a 401 gets the same one refresh-and-retry as invokeWithRefresh.
const MISSING_SCHEMA_CODES = new Set(["42883", "PGRST202"]);

/** True only for "this function does not exist yet" (deploy window). */
export function isMissingTripCancelLane(error) {
  return typeof error?.code === "string" && MISSING_SCHEMA_CODES.has(error.code);
}

async function callAdminRpc(name, args) {
  const { supabase } = await import("../lib/supabase");
  let result = await supabase.rpc(name, args);
  if (result?.status === 401) {
    await supabase.auth.refreshSession();
    result = await supabase.rpc(name, args);
  }
  return result;
}

function rpcError(error, status) {
  const err = new Error(error?.message ?? "rpc_failed");
  err.code = error?.code ?? null;
  err.status = status ?? null;
  return err;
}

/**
 * The stuck trip cancels for the queue. Before the #4522 migration is applied
 * the function does not exist: the queue then lists none (exactly as main).
 */
export async function listUnansweredTripCancelRefunds(rpc = callAdminRpc) {
  const { data, error, status } = await rpc(
    "issue_4522_list_unanswered_trip_cancel_refunds",
    {},
  );
  if (error) {
    if (isMissingTripCancelLane(error)) return [];
    throw rpcError(error, status);
  }
  return Array.isArray(data) ? data : [];
}

export async function getUnansweredTripCancelRefund(refundId, rpc = callAdminRpc) {
  const { data, error, status } = await rpc(
    "issue_4522_get_unanswered_trip_cancel_refund",
    { p_refund_id: refundId },
  );
  if (error) throw rpcError(error, status);
  return data ?? null;
}

// Pass 10 (P10-2): an edge-function error as a plain Error whose message is
// the server's code and whose serverMessage is its plain-words message.
async function edgeError(error) {
  let payload = null;
  try {
    payload = typeof error?.context?.json === "function" ? await error.context.json() : null;
  } catch {
    payload = null;
  }
  const err = new Error(typeof payload?.error === "string" ? payload.error : error?.message ?? "edge_failed");
  err.status = error?.context?.status ?? error?.status ?? null;
  err.serverMessage = typeof payload?.message === "string" ? payload.message : null;
  return err;
}

export async function resolveTripCancelRefund(
  { attemptId, outcome, reference, reason, amountCents, currency, refundedElsewhereCents },
  rpc = callAdminRpc,
  invoke = invokeAdminFunction,
) {
  // Pass 10 (P10-2): "partly refunded already" goes through the edge
  // function, which checks the reference and the figure against Paystack's
  // refund list for this payment before anything is recorded.
  if (outcome === "refunded_elsewhere") {
    const { data, error } = await invoke("cancel-trip-booking", {
      body: {
        mode: "ops_refunded_elsewhere",
        attemptId,
        reference,
        reason,
        amountCents,
        currency,
        refundedElsewhereCents,
      },
    });
    if (error) throw await edgeError(error);
    return data;
  }
  const { data, error, status } = await rpc(
    "issue_4522_resolve_trip_cancel_refund_by_ops",
    {
      p_attempt_id: attemptId,
      p_outcome: outcome,
      p_provider_refund_reference:
        outcome === "refunded_at_provider" || outcome === "paid_outside_provider" ? reference : null,
      p_reason: reason,
      p_amount_cents: amountCents,
      p_currency: currency,
    },
  );
  if (error) throw rpcError(error, status);
  return data;
}
