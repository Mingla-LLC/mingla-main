async function invokeAdminFunction(name, options) {
  const { supabase } = await import("../lib/supabase");
  return supabase.functions.invoke(name, options);
}

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
