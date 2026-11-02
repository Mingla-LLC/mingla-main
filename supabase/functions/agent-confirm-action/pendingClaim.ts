/**
 * Issue #3355 P1 (D-14) — the confirm path asks the database whether an
 * approval has expired, and claims it there.
 *
 * `expires_at` is written by the database clock (column default / the Ari
 * 30-minute trigger). Comparing it with the edge clock (`Date.now()`) mixed two
 * clocks that were observed 25 hours apart locally. Both the early expiry
 * probe and the pending -> executing flip now go through
 * `agent_pending_action_claim_for_confirm`, which decides with `now()`.
 *
 * Deploy window: merging deploys this function before the migration may be
 * applied. When the RPC does not exist yet (PostgREST PGRST202 / undefined
 * function 42883) the legacy edge-clock check and update are used, unchanged.
 * Kept out of index.ts so tests can import it without starting the server.
 */

// deno-lint-ignore-file no-explicit-any

export type PendingClaimAnswer =
  | "pending"
  | "claimed"
  | "expired"
  | "executing"
  | "not_found"
  | "other";

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => any;
  from: (table: string) => any;
}

export function isMissingRpc(
  error: { code?: unknown; message?: unknown } | null | undefined,
): boolean {
  if (!error) return false;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  return code === "PGRST202" || code === "42883" ||
    /could not find the function|function .* does not exist/i.test(message);
}

function normalize(answer: unknown): PendingClaimAnswer {
  switch (answer) {
    case "pending":
    case "claimed":
    case "expired":
    case "executing":
    case "not_found":
      return answer;
    default:
      return "other";
  }
}

/**
 * Has this pending approval expired? Decided by the database clock; the
 * legacy edge-clock comparison is only the fallback while the RPC is missing.
 */
export async function pendingExpiredByDbClock(
  client: RpcClient,
  input: { id: string; userId: string; expiresAt: string },
): Promise<boolean> {
  const { data, error } = await client.rpc(
    "agent_pending_action_claim_for_confirm",
    {
      p_pending_action_id: input.id,
      p_user_id: input.userId,
      p_tool_args: null,
      p_probe_only: true,
    },
  );
  if (error) {
    if (isMissingRpc(error)) {
      // [TRANSITIONAL] edge-clock fallback for the deploy window before
      // 20280306003355 is applied — exit: the migration is live everywhere.
      return new Date(input.expiresAt).getTime() < Date.now();
    }
    throw new Error(`expiry_probe_failed: ${String(error.message ?? "")}`);
  }
  return normalize(data) === "expired";
}

/**
 * Flip pending -> executing with the confirmed args, on the database clock.
 * `legacy` is true when the RPC was missing and the old conditional update ran.
 */
export async function claimPendingForConfirm(
  client: RpcClient,
  input: {
    id: string;
    userId: string;
    /** The only state a confirm claim may move to; named at the call site. */
    status: "executing";
    toolArgs: Record<string, unknown>;
  },
): Promise<{ answer: PendingClaimAnswer; legacy: boolean }> {
  const { data, error } = await client.rpc(
    "agent_pending_action_claim_for_confirm",
    {
      p_pending_action_id: input.id,
      p_user_id: input.userId,
      p_tool_args: input.toolArgs,
      p_probe_only: false,
    },
  );
  if (!error) return { answer: normalize(data), legacy: false };
  if (!isMissingRpc(error)) {
    throw new Error(`claim_failed: ${String(error.message ?? "")}`);
  }
  // [TRANSITIONAL] pre-migration flip — exit: 20280306003355 applied.
  const { data: flipped, error: flipErr } = await client
    .from("agent_pending_actions")
    .update({
      status: input.status,
      tool_args: input.toolArgs,
      execution_attested_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (flipErr) {
    throw new Error(`claim_failed: ${String(flipErr.message ?? "")}`);
  }
  return { answer: flipped ? "claimed" : "other", legacy: true };
}
