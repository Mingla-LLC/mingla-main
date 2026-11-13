// MINGLA-INVARIANT: I-4423-DB-POOL-ALERT | issue #4423 | The api-health-probe database check alerts when the PostgREST pool is at least 80 % in use on 2 checks in a row, or a public RPC takes over 1 s or fails, at most once per 30 minutes.
// Issue #4423 Wave 3 — the database pool check alerts before public pages fail.
//
// A fake database keeps the streak and last-alert time exactly like
// issue_4423_db_health_record (the pg17 suite proves the SQL side), and the
// real runDbHealthCheck drives it check after check:
//   * a quiet pool and a fast public request send nothing;
//   * a pool at 80 % or more on ONE check sends nothing (watching), on the
//     second check in a row sends ONE email, and the third (inside 30 minutes)
//     sends nothing (cooldown); a drop below 80 % resets the streak;
//   * a public request over 1 s, or one that fails, alerts on the first check;
//   * a database that does not answer alerts on the first check;
//   * a send that reached nobody does not start the cooldown, so the next
//     check tries again;
//   * the email names long queries by count, age and application, never text.
//
// FAILS-ON-REVERT: drop the streak check and the single-check test fails (it
// alerts at once); drop the cooldown and the third check alerts again; drop the
// `succeeded <= 0` guard and the retry test fails.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DB_ALERT_COOLDOWN_MS,
  type DbHealthDeps,
  type DbHealthSnapshot,
  dbHealthAlertCopy,
  poolIsHigh,
  readSnapshot,
  runDbHealthCheck,
} from "./dbHealth.ts";

function snap(inUse: number, extra: Partial<DbHealthSnapshot> = {}): DbHealthSnapshot {
  return { pool_size: 30, pool_open: 30, pool_in_use: inUse, long_running: 0, longest_ms: 0, longest_app: null, ...extra };
}

function world() {
  const state = {
    now: Date.parse("2026-11-13T16:00:00Z"),
    streak: 0,
    lastAlert: null as string | null,
    snapshot: snap(3) as DbHealthSnapshot | null,
    snapshotError: null as string | null,
    rpc: { ok: true, ms: 40, status: 200 as number | null },
    deliver: true,
    sent: [] as { subject: string; paragraphs: string[] }[],
  };
  const deps: DbHealthDeps = {
    snapshot: async () => ({ data: state.snapshotError ? null : state.snapshot, error: state.snapshotError }),
    timePublicRpc: async () => ({ ...state.rpc }),
    record: async (high, alerted) => {
      if (!alerted) state.streak = high ? state.streak + 1 : 0;
      if (alerted) state.lastAlert = new Date(state.now).toISOString();
      return { data: { high_streak: state.streak, last_alert_at: state.lastAlert }, error: null };
    },
    send: async (alert) => {
      if (!state.deliver) return { succeeded: 0 };
      state.sent.push(alert);
      return { succeeded: 1 };
    },
    nowMs: () => state.now,
  };
  const tick = async (minutes = 5) => {
    const out = await runDbHealthCheck(deps);
    state.now += minutes * 60_000;
    return out;
  };
  return { state, tick };
}

Deno.test("#4423 db check: a quiet pool and a fast public request send nothing", async () => {
  const w = world();
  assertEquals((await w.tick()).status, "healthy");
  assertEquals(w.state.sent.length, 0);
});

Deno.test("#4423 db check: 80 % in use alerts on the second check in a row, then cools down, and a low check resets", async () => {
  const w = world();
  w.state.snapshot = snap(24);
  assertEquals((await w.tick()).status, "watching");
  assertEquals(w.state.sent.length, 0);
  const second = await w.tick();
  assertEquals(second.status, "alerted");
  assertEquals(w.state.sent.length, 1);
  assertStringIncludes(w.state.sent[0].paragraphs.join(" "), "2 checks in a row");
  assertEquals((await w.tick()).status, "cooldown");
  assertEquals(w.state.sent.length, 1);
  w.state.snapshot = snap(10);
  assertEquals((await w.tick()).status, "healthy");
  assertEquals(w.state.streak, 0);
  w.state.snapshot = snap(29);
  assertEquals((await w.tick()).status, "watching");
});

Deno.test("#4423 db check: after the cooldown a still-full pool alerts again", async () => {
  const w = world();
  w.state.snapshot = snap(30);
  await w.tick();
  assertEquals((await w.tick(DB_ALERT_COOLDOWN_MS / 60_000)).status, "alerted");
  assertEquals((await w.tick()).status, "alerted");
  assertEquals(w.state.sent.length, 2);
});

Deno.test("#4423 db check: a slow or failed public request alerts on the first check", async () => {
  const slow = world();
  slow.state.rpc = { ok: true, ms: 1800, status: 200 };
  assertEquals((await slow.tick()).status, "alerted");
  assertStringIncludes(slow.state.sent[0].paragraphs.join(" "), "1800 ms");
  const failed = world();
  failed.state.rpc = { ok: false, ms: 10_000, status: null };
  assertEquals((await failed.tick()).status, "alerted");
  assertStringIncludes(failed.state.sent[0].paragraphs.join(" "), "failed");
  const fine = world();
  fine.state.rpc = { ok: true, ms: 999, status: 200 };
  assertEquals((await fine.tick()).status, "healthy");
});

Deno.test("#4423 db check: a database that does not answer alerts on the first check", async () => {
  const w = world();
  w.state.snapshotError = "canceling statement due to statement timeout";
  const out = await w.tick();
  assertEquals(out.status, "alerted");
  assertStringIncludes(w.state.sent[0].paragraphs.join(" "), "did not answer");
});

Deno.test("#4423 db check: a send that reached nobody does not start the cooldown", async () => {
  const w = world();
  w.state.rpc = { ok: false, ms: 10_000, status: 503 };
  w.state.deliver = false;
  assertEquals((await w.tick()).status, "send_failed");
  assertEquals(w.state.lastAlert, null);
  w.state.deliver = true;
  assertEquals((await w.tick()).status, "alerted");
});

Deno.test("#4423 db check: the email names long queries by count, age and app, never query text", () => {
  const copy = dbHealthAlertCopy(["A public request took 1500 ms (the limit is 1000 ms)."],
    snap(26, { long_running: 3, longest_ms: 7400, longest_app: "postgrest" }), { ok: true, ms: 1500, status: 200 });
  const text = copy.paragraphs.join(" ");
  assertEquals(copy.subject, "[DATABASE] Public pages are at risk");
  assertStringIncludes(text, "26 of 30");
  assertStringIncludes(text, "longer than 5 s: 3");
  assertStringIncludes(text, "7.4 s (postgrest)");
  assert(!/select|insert|update|delete/i.test(text));
});

Deno.test("#4423 db check: the snapshot reader and the 80 % line", () => {
  assertEquals(readSnapshot(null), null);
  assertEquals(readSnapshot({ pool_size: "30", pool_in_use: "24", pool_open: 28, long_running: 0, longest_ms: "12", longest_app: "" }),
    { pool_size: 30, pool_open: 28, pool_in_use: 24, long_running: 0, longest_ms: 12, longest_app: null });
  assertEquals(poolIsHigh(snap(23)), false);
  assertEquals(poolIsHigh(snap(24)), true);
});
