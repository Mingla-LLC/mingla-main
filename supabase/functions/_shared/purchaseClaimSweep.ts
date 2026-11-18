// Issue #4473 — the identity sweep that runs after an account proves a contact.
//
// Order matters: purchases nobody owns attach to this account first, then
// tickets sent to this contact, then purchases another account already owns
// are shared with this account (read-only, live-proof). Every entry carries
// `sharedWithAnotherAccount`; only the shared pass sets it true.

export type SweepRpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export type SweepRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<SweepRpcResult>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function objectResult(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  return isObject(value) ? value : {};
}

function entries(
  result: Record<string, unknown>,
  shared: boolean,
): Record<string, unknown>[] {
  const claimed = Array.isArray(result.claimed) ? result.claimed : [];
  return claimed.filter(isObject).map((entry) => ({
    ...entry,
    sharedWithAnotherAccount: shared
      ? true
      : entry.sharedWithAnotherAccount === true,
  }));
}

export type PurchaseSweepOutcome =
  | { result: Record<string, unknown>; limited: false }
  | { result: null; limited: boolean };

/** Runs the budgeted identity sweep for one account. */
export async function runPurchaseClaimSweep(
  rpc: SweepRpc,
  userId: string,
  qrPepper: string,
): Promise<PurchaseSweepOutcome> {
  const attempt = await rpc("begin_attendance_claim_attempt", {
    p_user_id: userId,
    p_kind: "identity",
  });
  const budget = objectResult(attempt.data);
  if (attempt.error || budget.allowed !== true) {
    return { result: null, limited: budget.allowed === false };
  }
  const claimed = await rpc("claim_attendance_by_verified_identity", {
    p_user_id: userId,
  });
  if (claimed.error) return { result: null, limited: false };
  const transfer = await rpc("issue_4063_claim_offered_tickets", {
    p_user_id: userId,
    p_qr_token_pepper: qrPepper,
  });
  if (transfer.error) return { result: null, limited: false };
  const shared = await rpc("issue_4473_share_purchases_by_verified_identity", {
    p_user_id: userId,
  });
  if (shared.error) return { result: null, limited: false };

  const primary = objectResult(claimed.data);
  const held = objectResult(transfer.data);
  const sharedResult = objectResult(shared.data);
  const all = [
    ...entries(primary, false),
    ...entries(held, false),
    ...entries(sharedResult, true),
  ];
  return {
    result: {
      ...primary,
      claimed: all,
      count: all.length,
      more: primary.more === true || held.more === true ||
        sharedResult.more === true,
    },
    limited: false,
  };
}
