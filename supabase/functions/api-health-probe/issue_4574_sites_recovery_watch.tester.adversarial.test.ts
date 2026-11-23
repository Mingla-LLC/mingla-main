// MINGLA-INVARIANT: I-4574-SITES-RECOVERY-WATCH-NO-FALSE-OK | issue #4574 | The Sites recovery watch never reports ok without readable evidence, never sends or records on a dry run, sends a recovery email only after an alert was delivered, and keys its heartbeat to one completion.
// Issue #4574 — tester adversarial suite for the Sites recovery watch.
//
// Different angles from the implementor's suite (which walks a well-formed
// world through time):
//   * exact boundaries of every level (2 h, 0.5 h, 0, 6 h) to the millisecond;
//   * malformed and hostile snapshots (strings, NaN, negative budgets,
//     unparseable dates, arrays) are unproven, never ok, never a throw;
//   * a dry run with EVERY alert due (expired + heartbeat, and unproven) calls
//     neither the mailer nor the record RPC;
//   * recovery only after an alert was DELIVERED: a heartbeat-only history,
//     an already-recovered history, and an undelivered warn send no recovery;
//   * heartbeat boundaries: exactly 18 h is quiet, 18 h + 1 ms fires once, a
//     future-dated completion never fires, a null completion never fires;
//   * a future-dated provider stamp is simply ok (no alert, no crash);
//   * the escalation cannot go backwards: after expired, a critical/warn
//     reading for the same incident sends nothing;
//   * the probe's auth check still runs before the body is read and the
//     sites_recovery route returns before the vendor tick.
//
// FAILS-ON-REVERT (verified by the tester): delete `if (opts.dryRun) return
// outcome;` and the dry-run test fails; delete `&& lastAlert !== null` from the
// recovered branch and the recovery tests fail; delete the heartbeat_for
// comparison and the heartbeat-once test fails; change `headroomH <= 0` to
// `< 0` and the exact-zero boundary fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideSitesAlerts,
  levelForHeadroom,
  readSitesSnapshot,
  runSitesRecoveryWatch,
  type SitesWatchDeps,
  type SitesWatchState,
} from "./sitesRecoveryWatch.ts";

const H = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-24T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const EMPTY: SitesWatchState = {
  level: null, incident_closes_at: null, last_sent_level: null,
  last_sent_at: null, heartbeat_for: null, unproven_sent_at: null,
};

function snap(opts: {
  closesAt: number;
  lastCompletion?: number | null;
  state?: Partial<SitesWatchState>;
  overrides?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    config_present: true,
    gate_budget_h: 48,
    manifest_budget_h: 26,
    closes_at: iso(opts.closesAt),
    database_backup_verified_at: iso(opts.closesAt - 48 * H),
    object_manifest_verified_at: iso(opts.closesAt - 20 * H),
    last_completion_at: opts.lastCompletion === undefined
      ? iso(T0 - 1 * H)
      : opts.lastCompletion === null ? null : iso(opts.lastCompletion),
    state: { ...EMPTY, ...(opts.state ?? {}) },
    ...(opts.overrides ?? {}),
  };
}

/** A strict fake: counts every mailer and record call. */
function harness(data: unknown, error: string | null = null, deliver = true) {
  const calls = { send: [] as string[], record: [] as unknown[] };
  const deps: SitesWatchDeps = {
    snapshot: async () => ({ data, error }),
    record: async (e) => {
      calls.record.push(e);
      return { error: null };
    },
    send: async (a) => {
      calls.send.push(a.kind);
      return { succeeded: deliver ? 1 : 0 };
    },
    nowMs: () => T0,
  };
  return { deps, calls };
}

Deno.test("#4574 adv: level boundaries are exact to the millisecond", () => {
  assertEquals(levelForHeadroom(0), "expired");
  assertEquals(levelForHeadroom(-1 / H), "expired");
  assertEquals(levelForHeadroom(1 / H), "critical");
  assertEquals(levelForHeadroom(0.5), "critical");
  assertEquals(levelForHeadroom(0.5 + 1 / H), "warn");
  assertEquals(levelForHeadroom(2), "warn");
  assertEquals(levelForHeadroom(2 + 1 / H), "watch");
  assertEquals(levelForHeadroom(6), "watch");
  assertEquals(levelForHeadroom(6 + 1 / H), "ok");
});

Deno.test("#4574 adv: the gate closing exactly now is expired, not critical", async () => {
  const h = harness(snap({ closesAt: T0 }));
  const o = await runSitesRecoveryWatch(h.deps, { dryRun: true });
  assertEquals(o.level, "expired");
  assertEquals(o.headroom_h, 0);
  assertEquals(o.would_send, ["expired"]);
});

Deno.test("#4574 adv: malformed or hostile snapshots are unproven, never ok, never a throw", async () => {
  const bad: unknown[] = [
    null,
    [],
    "ok",
    42,
    { config_present: "true", gate_budget_h: 48, manifest_budget_h: 26 },
    snap({ closesAt: T0 + 40 * H, overrides: { gate_budget_h: "not a number" } }),
    snap({ closesAt: T0 + 40 * H, overrides: { gate_budget_h: -48 } }),
    snap({ closesAt: T0 + 40 * H, overrides: { gate_budget_h: null } }),
    snap({ closesAt: T0 + 40 * H, overrides: { manifest_budget_h: Number.NaN } }),
    snap({ closesAt: T0 + 40 * H, overrides: { closes_at: "tomorrow-ish" } }),
    snap({ closesAt: T0 + 40 * H, overrides: { closes_at: "" } }),
    snap({ closesAt: T0 + 40 * H, overrides: { database_backup_verified_at: null } }),
    snap({ closesAt: T0 + 40 * H, overrides: { object_manifest_verified_at: 12345 } }),
  ];
  for (const data of bad) {
    assertEquals(readSitesSnapshot(data).snapshot, null, `accepted ${JSON.stringify(data)}`);
    const h = harness(data);
    const o = await runSitesRecoveryWatch(h.deps, { dryRun: true });
    assertEquals(o.level, "unproven", `level for ${JSON.stringify(data)}`);
    assert(o.reason !== null && o.reason.length > 0);
    assertEquals(o.headroom_h, null);
  }
});

Deno.test("#4574 adv: a dry run with every alert due calls neither the mailer nor the record RPC", async () => {
  // Expired AND heartbeat both due.
  const h1 = harness(snap({ closesAt: T0 - 3 * H, lastCompletion: T0 - 30 * H }));
  const o1 = await runSitesRecoveryWatch(h1.deps, { dryRun: true });
  assertEquals(o1.dry_run, true);
  assertEquals(o1.would_send, ["expired", "heartbeat"]);
  assertEquals(o1.sent, []);
  assertEquals(h1.calls.send, []);
  assertEquals(h1.calls.record, []);
  // Unproven due (RPC error).
  const h2 = harness(null, "function does not exist");
  const o2 = await runSitesRecoveryWatch(h2.deps, { dryRun: true });
  assertEquals(o2.level, "unproven");
  assertEquals(o2.would_send, ["unproven"]);
  assertEquals(h2.calls.send, []);
  assertEquals(h2.calls.record, []);
  // And the same inputs without dry run DO send and record (the fake is live).
  const h3 = harness(snap({ closesAt: T0 - 3 * H, lastCompletion: T0 - 30 * H }));
  await runSitesRecoveryWatch(h3.deps, { dryRun: false });
  assertEquals(h3.calls.send, ["expired", "heartbeat"]);
  assertEquals(h3.calls.record.length, 1);
});

Deno.test("#4574 adv: recovery only after a delivered alert", async () => {
  const fresh = T0 + 40 * H;
  // Never alerted: ok sends nothing.
  assertEquals(decideSitesAlerts("ok", readSitesSnapshot(snap({ closesAt: fresh })).snapshot, T0, null), []);
  // Only a heartbeat was ever sent: no recovery email (heartbeat is not a gate alert).
  const hbOnly = readSitesSnapshot(snap({ closesAt: fresh, state: { heartbeat_for: iso(T0 - 20 * H) } })).snapshot;
  assertEquals(decideSitesAlerts("ok", hbOnly, T0, hbOnly!.state), []);
  // Already recovered: no second recovery.
  const rec = readSitesSnapshot(snap({ closesAt: fresh, state: { last_sent_level: "recovered", incident_closes_at: iso(fresh) } })).snapshot;
  assertEquals(decideSitesAlerts("ok", rec, T0, rec!.state), []);
  // A warn that was attempted but NOT delivered never arms a recovery.
  const h = harness(snap({ closesAt: T0 + 1.5 * H }), null, false);
  const o = await runSitesRecoveryWatch(h.deps, { dryRun: false });
  assertEquals(o.send_failed, ["warn"]);
  assertEquals((h.calls.record[0] as { sent_level: unknown }).sent_level, null);
  // After a delivered expired, ok sends exactly one recovery.
  const exp = readSitesSnapshot(snap({ closesAt: fresh, state: { last_sent_level: "expired", incident_closes_at: iso(T0 - 1 * H) } })).snapshot;
  assertEquals(decideSitesAlerts("ok", exp, T0, exp!.state), ["recovered"]);
});

Deno.test("#4574 adv: escalation never goes backwards within one incident", () => {
  const closes = T0 + 0.4 * H;
  const afterExpired = readSitesSnapshot(snap({ closesAt: closes, state: { last_sent_level: "expired", incident_closes_at: iso(closes) } })).snapshot!;
  assertEquals(decideSitesAlerts("critical", afterExpired, T0, afterExpired.state), []);
  assertEquals(decideSitesAlerts("warn", afterExpired, T0, afterExpired.state), []);
  const afterCritical = readSitesSnapshot(snap({ closesAt: closes, state: { last_sent_level: "critical", incident_closes_at: iso(closes) } })).snapshot!;
  assertEquals(decideSitesAlerts("warn", afterCritical, T0, afterCritical.state), []);
  assertEquals(decideSitesAlerts("expired", afterCritical, T0, afterCritical.state), ["expired"]);
  // A DIFFERENT closing time is a new incident: warn sends again.
  const newIncident = readSitesSnapshot(snap({ closesAt: closes + 24 * H, lastCompletion: T0 + 22 * H, state: { last_sent_level: "expired", incident_closes_at: iso(closes) } })).snapshot!;
  assertEquals(decideSitesAlerts("warn", newIncident, T0 + 22.5 * H, newIncident.state), ["warn"]);
});

Deno.test("#4574 adv: heartbeat boundaries and keying", () => {
  const closes = T0 + 40 * H;
  const at = (lastCompletion: number | null, hb: string | null = null) => {
    const s = readSitesSnapshot(snap({ closesAt: closes, lastCompletion, state: { heartbeat_for: hb } })).snapshot!;
    return decideSitesAlerts("ok", s, T0, s.state);
  };
  assertEquals(at(T0 - 18 * H), [], "exactly 18 h must be quiet");
  assertEquals(at(T0 - 18 * H - 1), ["heartbeat"], "18 h + 1 ms must fire");
  assertEquals(at(T0 - 18 * H - 1, iso(T0 - 18 * H - 1)), [], "same completion fires once");
  assertEquals(at(T0 - 30 * H, iso(T0 - 50 * H)), ["heartbeat"], "an older heartbeat does not silence a newer gap");
  assertEquals(at(T0 + 5 * H), [], "a future-dated completion never fires");
  assertEquals(at(null), [], "no completion receipt is not keyed");
});

Deno.test("#4574 adv: a future-dated provider stamp is ok and quiet", async () => {
  const h = harness(snap({ closesAt: T0 + 400 * H }));
  const o = await runSitesRecoveryWatch(h.deps, { dryRun: false });
  assertEquals(o.level, "ok");
  assertEquals(h.calls.send, []);
  assertEquals(h.calls.record.length, 1);
});

Deno.test("#4574 adv: probe auth runs before the body is read; the lane returns before the vendor tick", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const handler = src.slice(src.indexOf("serve(async (req) => {"));
  const auth = handler.indexOf("if (authHeader !== `Bearer ${Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\")}`)");
  const bodyRead = handler.indexOf("await requestedBody(req)");
  const route = handler.indexOf('body.mode === "sites_recovery"');
  const vendor = handler.indexOf("const checkRows: CheckRow[] = []");
  assert(auth > 0, "service-role bearer check missing");
  assert(bodyRead > auth, "body read before auth");
  assert(route > bodyRead && route < vendor, "sites_recovery route must return before the vendor tick");
  const lane = src.slice(src.indexOf("async function handleSitesRecovery"), src.indexOf("function jsonResponse"));
  assert(lane.includes('"as_of_requires_dry_run" }, 400)'), "as_of without dry_run must be refused");
  assert(!/console\.(log|warn|error)\([^)]*SERVICE_ROLE/.test(lane), "no secret may be logged");
});
