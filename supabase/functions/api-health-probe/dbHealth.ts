// Issue #4423 Wave 3 — database health check (every 5 minutes).
//
// On 13 Nov the Admin Work tab filled PostgREST's single pool of 30 database
// connections and public event pages waited 30 to 280 s, while the only uptime
// monitor (a static page) stayed green. This check runs on its own cron tick
// (body {"mode":"db"}) and alerts through the existing sendOpsAlertEmail rail
// and the api_health recipients when:
//   * the pool is at least 80 % in use on 2 checks in a row, or
//   * one cheap public RPC through PostgREST takes more than 1 s or fails, or
//   * the database does not answer the snapshot at all.
// Queries running longer than 5 s are named (count, longest age, application)
// in the alert, never their text. One incident sends at most one email per
// 30 minutes.
//
// Pure: the probe passes in the database calls, the timer and the sender, so
// the Deno test drives it with fakes.

export const DB_POOL_SIZE = 30;
export const DB_POOL_HIGH_RATIO = 0.8;
export const DB_POOL_HIGH_STREAK = 2;
export const DB_PUBLIC_RPC_SLOW_MS = 1000;
export const DB_LONG_QUERY_MS = 5000;
export const DB_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

export interface DbHealthSnapshot {
  pool_size: number;
  pool_open: number;
  pool_in_use: number;
  long_running: number;
  longest_ms: number;
  longest_app: string | null;
}

export interface PublicRpcTiming {
  ok: boolean;
  ms: number;
  status: number | null;
}

export interface DbHealthState {
  high_streak: number;
  last_alert_at: string | null;
}

export interface DbHealthDeps {
  snapshot(): Promise<{ data: DbHealthSnapshot | null; error: string | null }>;
  timePublicRpc(): Promise<PublicRpcTiming>;
  record(high: boolean, alerted: boolean, snapshot: DbHealthSnapshot | null): Promise<{ data: DbHealthState | null; error: string | null }>;
  send(alert: { subject: string; paragraphs: string[] }): Promise<{ succeeded: number }>;
  nowMs(): number;
}

export type DbHealthOutcome =
  | { status: "healthy"; snapshot: DbHealthSnapshot; rpc: PublicRpcTiming; highStreak: number }
  | { status: "watching"; snapshot: DbHealthSnapshot; rpc: PublicRpcTiming; highStreak: number }
  | { status: "alerted"; reasons: string[]; highStreak: number | null }
  | { status: "cooldown"; reasons: string[]; highStreak: number | null }
  | { status: "send_failed"; reasons: string[]; highStreak: number | null };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Normalise the RPC's jsonb (numbers may arrive as strings). */
export function readSnapshot(raw: unknown): DbHealthSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    pool_size: num(r.pool_size) > 0 ? num(r.pool_size) : DB_POOL_SIZE,
    pool_open: num(r.pool_open),
    pool_in_use: num(r.pool_in_use),
    long_running: num(r.long_running),
    longest_ms: num(r.longest_ms),
    longest_app: typeof r.longest_app === "string" && r.longest_app ? r.longest_app : null,
  };
}

export function poolIsHigh(s: DbHealthSnapshot): boolean {
  return s.pool_in_use >= Math.ceil(s.pool_size * DB_POOL_HIGH_RATIO);
}

export function dbHealthAlertCopy(
  reasons: string[],
  snapshot: DbHealthSnapshot | null,
  rpc: PublicRpcTiming | null,
): { subject: string; paragraphs: string[] } {
  const paragraphs = [
    "Public pages may be slow or failing: they share one pool of database connections with every app.",
    ...reasons,
  ];
  if (snapshot) {
    paragraphs.push(
      `Connections in use: ${snapshot.pool_in_use} of ${snapshot.pool_size} (${snapshot.pool_open} open).`,
      snapshot.long_running > 0
        ? `Queries running longer than ${DB_LONG_QUERY_MS / 1000} s: ${snapshot.long_running}. The longest has run ${(snapshot.longest_ms / 1000).toFixed(1)} s (${snapshot.longest_app ?? "unnamed app"}).`
        : `No query has run longer than ${DB_LONG_QUERY_MS / 1000} s.`,
    );
  }
  if (rpc) {
    paragraphs.push(rpc.ok ? `A public request took ${Math.round(rpc.ms)} ms.` : `A public request failed after ${Math.round(rpc.ms)} ms (status ${rpc.status ?? "none"}).`);
  }
  paragraphs.push("Check the Supabase dashboard (CPU, connections) and any open Admin tab. Admin calls are cut off at 3 s, so a busy Admin tab cannot hold a connection for long.");
  return { subject: "[DATABASE] Public pages are at risk", paragraphs };
}

export async function runDbHealthCheck(deps: DbHealthDeps): Promise<DbHealthOutcome> {
  const [snap, rpc] = await Promise.all([deps.snapshot(), deps.timePublicRpc()]);
  const snapshot = snap.error ? null : readSnapshot(snap.data);
  const high = snapshot ? poolIsHigh(snapshot) : false;

  const reasons: string[] = [];
  if (!snapshot) reasons.push(`The database did not answer the health check (${snap.error ?? "no row"}).`);
  if (!rpc.ok) reasons.push("A public request through the API failed.");
  else if (rpc.ms > DB_PUBLIC_RPC_SLOW_MS) reasons.push(`A public request took ${Math.round(rpc.ms)} ms (the limit is ${DB_PUBLIC_RPC_SLOW_MS} ms).`);

  // Record this check first: the streak decides whether a high pool alerts.
  const recorded = await deps.record(high, false, snapshot);
  const state = recorded.error ? null : recorded.data;
  const streak = state ? num(state.high_streak) : null;
  if (high && streak !== null && streak >= DB_POOL_HIGH_STREAK) {
    reasons.push(`The connection pool has been at least ${Math.round(DB_POOL_HIGH_RATIO * 100)} % in use for ${streak} checks in a row.`);
  }

  if (reasons.length === 0) {
    return { status: high ? "watching" : "healthy", snapshot: snapshot as DbHealthSnapshot, rpc, highStreak: streak ?? 0 };
  }

  const lastAlert = state?.last_alert_at ? Date.parse(state.last_alert_at) : NaN;
  if (Number.isFinite(lastAlert) && deps.nowMs() - lastAlert < DB_ALERT_COOLDOWN_MS) {
    return { status: "cooldown", reasons, highStreak: streak };
  }

  const sent = await deps.send(dbHealthAlertCopy(reasons, snapshot, rpc));
  if (sent.succeeded <= 0) return { status: "send_failed", reasons, highStreak: streak };
  // Only a delivered alert starts the cooldown. Failing to record it is
  // logged by the caller; the next check may alert again, which is the safe side.
  await deps.record(high, true, null);
  return { status: "alerted", reasons, highStreak: streak };
}
