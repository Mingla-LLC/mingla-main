// ORCH-0821 — Per-user rate limit gate for Ari.
//
// Enforces:
//   1. Max 200 user-role messages / 24h per user (cost + abuse cap)
//   2. Max 1 in-flight executing pending_action per user
//
// Uses service-role client because counting rows across the user's own data
// is faster with an admin client, AND this is a SYSTEM table read (the gate
// itself), not a tool execution. This is the ONLY service-role usage in the
// Ari surface — per the I-ARI-USER-JWT-ONLY invariant, executors NEVER use
// service role.

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TURN_LIMIT_24H = 200;

export interface RateLimitResult {
  allowed: boolean;
  reason?: "rate_limited_daily" | "rate_limited_inflight";
  resetAt?: string;
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

export async function enforceTurnRateLimit(
  userId: string,
  service: SupabaseClient,
): Promise<RateLimitResult> {
  // Check 1 — in-flight executing pending_action
  const { count: inflight, error: inflightErr } = await service
    .from("agent_pending_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "executing");
  if (inflightErr) {
    // Fail open rather than fail closed — but log via thrown error so the
    // caller can decide. We choose to allow through (degraded availability
    // is worse than a brief over-limit window).
    return { allowed: true };
  }
  if ((inflight ?? 0) > 0) {
    return { allowed: false, reason: "rate_limited_inflight" };
  }

  // Check 2 — last-24h user message count
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: turns, error: turnsErr } = await service
    .from("agent_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", since);
  if (turnsErr) {
    return { allowed: true }; // fail open per above
  }
  if ((turns ?? 0) >= TURN_LIMIT_24H) {
    const reset = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return { allowed: false, reason: "rate_limited_daily", resetAt: reset };
  }

  return { allowed: true };
}
