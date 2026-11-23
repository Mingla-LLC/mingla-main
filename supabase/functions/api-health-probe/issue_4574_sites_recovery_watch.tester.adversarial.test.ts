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
// Rework (claim before send), tester angles:
//   * the stateless slot hits exactly once per 2 h on the real cron minutes
//     (:04 :19 :34 :49) and at its edges (00:00:00.000 in, 00:15 out);
//   * clock skew between the SQL 2 h claim and the stateless slot: a claim
//     that worked at 10:49 then a claim outage still sends at most 2 in any
//     rolling 2 h and at most 13 a day;
//   * SQL is the authority: claimed:false suppresses a send the snapshot
//     state would allow, and a dry run never claims or releases;
//   * a claim ERROR on a gate alert fails OPEN (the warn still goes out) and
//     is never released;
//   * release runs only for a send that reached nobody, with the claim's own
//     prior, and never for a delivered email.
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
  type SitesWatchClaim,
  type SitesWatchDeps,
  type SitesWatchState,
  statelessUnprovenSlot,
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

// ── rework: claim before send ────────────────────────────────────────────

function claimHarness(data: unknown, claimImpl: (kind: string) => SitesWatchClaim, deliver = true, snapError: string | null = null) {
  const calls = { send: [] as string[], claim: [] as string[], release: [] as { kind: string; prior: unknown }[] };
  const deps: SitesWatchDeps = {
    snapshot: async () => ({ data, error: snapError }),
    record: async () => ({ error: null }),
    send: async (a) => {
      calls.send.push(a.kind);
      return { succeeded: deliver ? 1 : 0 };
    },
    claim: async (kind) => {
      calls.claim.push(kind);
      return claimImpl(kind);
    },
    release: async (kind, _c, _h, prior) => {
      calls.release.push({ kind, prior });
      return { error: null };
    },
    nowMs: () => T0,
  };
  return { deps, calls };
}

Deno.test("#4574 adv rework: the stateless slot hits once per 2 h on the real cron minutes, edges exact", () => {
  const day = Date.parse("2026-11-24T00:00:00Z");
  let hits = 0;
  for (let m = 4; m < 24 * 60; m += 15) if (statelessUnprovenSlot(day + m * 60 * 1000)) hits += 1;
  assertEquals(hits, 12);
  assert(statelessUnprovenSlot(day));
  assert(statelessUnprovenSlot(day + 15 * 60 * 1000 - 1));
  assert(!statelessUnprovenSlot(day + 15 * 60 * 1000));
  assert(!statelessUnprovenSlot(day + 1 * H + 4 * 60 * 1000));
  assert(statelessUnprovenSlot(day + 22 * H + 4 * 60 * 1000));
});

Deno.test("#4574 adv rework: SQL claim then claim outage (clock skew) stays bounded", async () => {
  // 10:49 the claim works (SQL stamps unproven_sent_at), from 11:04 every claim errors.
  const start = Date.parse("2026-11-24T10:49:00Z");
  const sentAt: number[] = [];
  let now = start;
  let sqlSentAt: number | null = null;
  const deps: SitesWatchDeps = {
    snapshot: async () => ({ data: null, error: "statement timeout" }),
    record: async () => ({ error: "statement timeout" }),
    send: async () => {
      sentAt.push(now);
      return { succeeded: 1 };
    },
    claim: async () => {
      if (now === start) {
        const ok = sqlSentAt === null || now - sqlSentAt >= 2 * H;
        if (ok) sqlSentAt = now;
        return { claimed: ok, prior: {}, error: null };
      }
      return { claimed: false, prior: null, error: "connection refused" };
    },
    nowMs: () => now,
  };
  for (let i = 0; i < 96; i++) {
    await runSitesRecoveryWatch(deps, { dryRun: false });
    now += 15 * 60 * 1000;
  }
  assert(sentAt.length <= 13, `sent ${sentAt.length} in 24 h`);
  for (const t of sentAt) {
    const inWindow = sentAt.filter((u) => u >= t && u < t + 2 * H).length;
    assert(inWindow <= 2, `more than 2 unproven emails within 2 h of ${iso(t)}`);
  }
});

Deno.test("#4574 adv rework: SQL is the authority; a dry run never claims", async () => {
  // Snapshot state says warn is due; the claim says another run has it.
  const data = snap({ closesAt: T0 + 1.5 * H });
  const h = claimHarness(data, () => ({ claimed: false, prior: {}, error: null }));
  const o = await runSitesRecoveryWatch(h.deps, { dryRun: false });
  assertEquals(o.would_send, ["warn"]);
  assertEquals(o.not_claimed, ["warn"]);
  assertEquals(h.calls.send, []);
  assertEquals(h.calls.release, []);
  // The probe turns anything but a literal jsonb true into "not claimed".
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes("claimed: row.claimed === true"), "the claim RPC result must be read as a strict boolean");
  const dry = claimHarness(data, () => ({ claimed: true, prior: {}, error: null }));
  await runSitesRecoveryWatch(dry.deps, { dryRun: true });
  assertEquals(dry.calls.claim, []);
  assertEquals(dry.calls.release, []);
  assertEquals(dry.calls.send, []);
});

Deno.test("#4574 adv rework: a claim error on a gate alert fails open and is never released", async () => {
  const h = claimHarness(snap({ closesAt: T0 + 1.5 * H }), () => ({ claimed: false, prior: null, error: "connection refused" }), false);
  const o = await runSitesRecoveryWatch(h.deps, { dryRun: false });
  assertEquals(h.calls.send, ["warn"], "a database outage must not silence the warn");
  assertEquals(o.claim_errors.length, 1);
  assertEquals(h.calls.release, [], "nothing was claimed, so nothing may be released");
});

Deno.test("#4574 adv rework: release only for an undelivered send, with the claim's own prior", async () => {
  const prior = { last_sent_level: "warn", incident_closes_at: iso(T0 + 0.4 * H) };
  const delivered = claimHarness(snap({ closesAt: T0 + 0.4 * H }), () => ({ claimed: true, prior, error: null }), true);
  await runSitesRecoveryWatch(delivered.deps, { dryRun: false });
  assertEquals(delivered.calls.send, ["critical"]);
  assertEquals(delivered.calls.release, [], "a delivered email must never be released");
  const failed = claimHarness(snap({ closesAt: T0 + 0.4 * H }), () => ({ claimed: true, prior, error: null }), false);
  await runSitesRecoveryWatch(failed.deps, { dryRun: false });
  assertEquals(failed.calls.release, [{ kind: "critical", prior }]);
});
