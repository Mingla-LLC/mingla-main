// ORCH-0821 — Per-user rate limit gate for Ari.
//
// Enforces (#3355 P1: after turn recognition, on the database clock):
//   1. Max 200 owner turns / rolling 24h per user (cost + abuse cap)
//   2. Max 1 in-flight executing pending_action per user, inside its
//      2-minute lease
//
// Owns creation of Ari's narrowly used service client. It is used for system
// rate-limit/pending-action access and for #1985 reducer-validated,
// explicitly user-scoped task-state CAS RPCs. Authentication, tenant checks,
// and tool executors continue to use the caller's JWT; executors NEVER receive
// this service client.

// deno-lint-ignore-file no-explicit-any
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TURN_LIMIT_24H = 200;

export interface RateLimitResult {
  allowed: boolean;
  reason?: "rate_limited_daily" | "rate_limited_inflight";
  resetAt?: string;
  /** Database-clock seconds until the window frees a slot. */
  retryAfterSeconds?: number;
  /** The client_turn_id was already claimed: answer with the stored turn. */
  replay?: boolean;
}

export function buildServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in env");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isMissingRpcError(
  error: { code?: unknown; message?: unknown } | null | undefined,
): boolean {
  if (!error) return false;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";
  return code === "PGRST202" || code === "42883" ||
    /could not find the function|function .* does not exist/i.test(message);
}

/**
 * Issue #3355 P1 (D-1, D-13, D-14) — the daily cap and the in-flight gate.
 *
 * Runs after turn recognition: a `client_turn_id` that was already claimed is
 * a replay and is never refused (the stored answer is returned). Only owner
 * turns count (`agent_turn_attempts.origin = 'owner'`), the in-flight gate
 * only honours an executing confirmation inside its 2-minute lease, and the
 * reset time is when the oldest counted turn leaves the rolling 24 h window.
 * Every time decision is the database clock (`agent_turn_rate_window`).
 *
 * Fails open on a read error, as before: degraded availability is worse than
 * a brief over-limit window.
 */
export async function enforceTurnRateLimit(
  userId: string,
  service: SupabaseClient,
  clientTurnId?: string | null,
): Promise<RateLimitResult> {
  const { data, error } = await service.rpc("agent_turn_rate_window", {
    p_user_id: userId,
    p_client_turn_id: clientTurnId ?? null,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return await legacyTurnRateLimit(userId, service, clientTurnId ?? null);
    }
    return { allowed: true };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
      allowed?: unknown;
      reason?: unknown;
      replay?: unknown;
      reset_at?: unknown;
      retry_after_seconds?: unknown;
    }
    | null
    | undefined;
  if (!row || row.allowed !== false) {
    return { allowed: true, ...(row?.replay === true ? { replay: true } : {}) };
  }
  return {
    allowed: false,
    reason: row.reason === "rate_limited_inflight"
      ? "rate_limited_inflight"
      : "rate_limited_daily",
    ...(typeof row.reset_at === "string" ? { resetAt: row.reset_at } : {}),
    ...(typeof row.retry_after_seconds === "number"
      ? { retryAfterSeconds: row.retry_after_seconds }
      : {}),
  };
}

/**
 * Issue #3355 P1 (D-13) — executing rows past their lease. One with an
 * operation receipt is finished as executed; one with none past 10 minutes is
 * marked failed_unknown with one plain owner line. Best effort: a failure
 * here never blocks the turn (the lease already stopped blocking chat).
 */
export async function reconcileStalePendingActions(
  userId: string,
  service: SupabaseClient,
): Promise<void> {
  const { error } = await service.rpc("agent_pending_action_reconcile_stale", {
    p_user_id: userId,
  });
  if (error && !isMissingRpcError(error)) {
    console.warn(
      "[agentRateLimit] stale pending reconcile failed",
      JSON.stringify({ code: error.code ?? null }),
    );
  }
}

// [TRANSITIONAL] the pre-#3355 check, used only while the
// 20280306003355 migration is not applied yet (RPC missing) — exit: the
// migration is live in every environment. It still honours replay
// recognition so a claimed turn is never refused.
async function legacyTurnRateLimit(
  userId: string,
  service: SupabaseClient,
  clientTurnId: string | null,
): Promise<RateLimitResult> {
  if (clientTurnId) {
    const { data: claimed, error: claimedErr } = await service
      .from("agent_turn_attempts")
      .select("id")
      .eq("user_id", userId)
      .eq("client_turn_id", clientTurnId)
      .maybeSingle();
    if (!claimedErr && claimed) return { allowed: true, replay: true };
  }
  const { count: inflight, error: inflightErr } = await service
    .from("agent_pending_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "executing");
  if (inflightErr) return { allowed: true };
  if ((inflight ?? 0) > 0) {
    return { allowed: false, reason: "rate_limited_inflight" };
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: turns, error: turnsErr } = await service
    .from("agent_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", since);
  if (turnsErr) return { allowed: true };
  if ((turns ?? 0) >= TURN_LIMIT_24H) {
    const reset = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return { allowed: false, reason: "rate_limited_daily", resetAt: reset };
  }
  return { allowed: true };
}
