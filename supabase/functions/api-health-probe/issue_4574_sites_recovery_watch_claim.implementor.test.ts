// MINGLA-INVARIANT: I-4574-SITES-RECOVERY-WATCH-CLAIM-BEFORE-SEND | issue #4574 | Every Sites recovery email is claimed in SQL before it is sent, so two overlapping runs send it once and an unreadable snapshot emails at most once per 2 h.
// Issue #4574 rework (tester FAIL P1-1, P2-1).
//
// The fake database below mirrors brand_site_recovery_watch_claim and
// brand_site_recovery_watch_release (the pg17 suite proves the SQL): one row,
// a lock around read-then-write, the same rules per kind. The real
// runSitesRecoveryWatch drives it through the probe's real loop:
//   * P1-1: with the snapshot RPC failing on every check, 8 checks over 2 h
//     send ONE unproven email, and the next one goes out only after 2 h;
//   * P1-1: with the claim RPC failing too (database unwritable), unproven
//     goes out only in the stateless 2 h slot (12 a day, not 96);
//   * P2-1: two runs started together at warn (and with a heartbeat due) send
//     each email once;
//   * an email that reached nobody releases its claim, so the next check retries.
//
// FAILS-ON-REVERT: make runSitesRecoveryWatch skip `deps.claim` and the P1-1
// and P2-1 tests fail (8 and 2 emails); drop the stateless slot and the
// claim-error test fails; drop the claim wiring in index.ts and the source
// guard fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runSitesRecoveryWatch,
  type SitesAlert,
  SITES_UNPROVEN_REPEAT_MS,
  type SitesWatchDeps,
  statelessUnprovenSlot,
} from "./sitesRecoveryWatch.ts";

const H = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const RANK: Record<string, number> = { warn: 1, critical: 2, expired: 3 };

interface Row {
  level: string | null;
  incident_closes_at: string | null;
  last_sent_level: string | null;
  last_sent_at: string | null;
  heartbeat_for: string | null;
  unproven_sent_at: string | null;
}

function world() {
  const db = {
    now: Date.parse("2026-11-25T00:04:00Z"),
    databaseAt: Date.parse("2026-11-24T10:00:00Z"),
    lastCompletion: Date.parse("2026-11-24T10:00:00Z"),
    snapshotError: null as string | null,
    claimError: null as string | null,
    deliver: true,
    row: {
      level: null, incident_closes_at: null, last_sent_level: null,
      last_sent_at: null, heartbeat_for: null, unproven_sent_at: null,
    } as Row,
    sent: [] as SitesAlert[],
  };
  // The row lock: claims run one at a time, each reading the latest row.
  let lock: Promise<void> = Promise.resolve();
  const locked = <T>(fn: () => T): Promise<T> => {
    const run = lock.then(async () => {
      await new Promise((r) => setTimeout(r, 1)); // let the other run interleave
      return fn();
    });
    lock = run.then(() => undefined, () => undefined);
    return run;
  };
  const deps: SitesWatchDeps = {
    snapshot: async () => {
      await new Promise((r) => setTimeout(r, 1));
      if (db.snapshotError) return { data: null, error: db.snapshotError };
      return {
        data: {
          config_present: true, gate_budget_h: 48, manifest_budget_h: 26,
          database_backup_verified_at: iso(db.databaseAt),
          object_manifest_verified_at: iso(db.now),
          closes_at: iso(db.databaseAt + 48 * H),
          last_completion_at: iso(db.lastCompletion),
          state: { ...db.row },
        },
        error: null,
      };
    },
    record: async (e) => {
      db.row.level = e.level;
      if (e.sent_level) {
        db.row.last_sent_level = e.sent_level;
        db.row.incident_closes_at = e.incident_closes_at;
        db.row.last_sent_at = iso(db.now);
      }
      if (e.heartbeat_for) db.row.heartbeat_for = e.heartbeat_for;
      if (e.unproven_sent) db.row.unproven_sent_at = iso(db.now);
      return { error: null };
    },
    send: async (alert) => {
      await new Promise((r) => setTimeout(r, 1));
      if (!db.deliver) return { succeeded: 0 };
      db.sent.push(alert);
      return { succeeded: 1 };
    },
    nowMs: () => db.now,
    claim: (kind, closesAt, heartbeatFor) => locked(() => {
      if (db.claimError) return { claimed: false, prior: null, error: db.claimError };
      const prior = { ...db.row } as unknown as Record<string, unknown>;
      const r = db.row;
      let ok: boolean;
      if (kind === "warn" || kind === "critical" || kind === "expired") {
        ok = !(r.incident_closes_at !== null && closesAt !== null &&
          Date.parse(r.incident_closes_at) === Date.parse(closesAt) &&
          (RANK[r.last_sent_level ?? ""] ?? 0) >= RANK[kind]);
        if (ok) { r.last_sent_level = kind; r.incident_closes_at = closesAt; r.last_sent_at = iso(db.now); }
      } else if (kind === "recovered") {
        ok = r.last_sent_level === "warn" || r.last_sent_level === "critical" || r.last_sent_level === "expired";
        if (ok) { r.last_sent_level = "recovered"; r.incident_closes_at = closesAt; }
      } else if (kind === "heartbeat") {
        ok = r.heartbeat_for === null || Date.parse(r.heartbeat_for) !== Date.parse(heartbeatFor ?? "");
        if (ok) r.heartbeat_for = heartbeatFor;
      } else {
        ok = r.unproven_sent_at === null || db.now - Date.parse(r.unproven_sent_at) >= 2 * H;
        if (ok) r.unproven_sent_at = iso(db.now);
      }
      return { claimed: ok, prior, error: null };
    }),
    release: (kind, _closesAt, _heartbeatFor, prior) => locked(() => {
      const p = prior as unknown as Row;
      if (kind === "heartbeat") db.row.heartbeat_for = p.heartbeat_for;
      else if (kind === "unproven") db.row.unproven_sent_at = p.unproven_sent_at;
      else {
        db.row.last_sent_level = p.last_sent_level;
        db.row.incident_closes_at = p.incident_closes_at;
        db.row.last_sent_at = p.last_sent_at;
      }
      return { error: null };
    }),
  };
  const tick = () => runSitesRecoveryWatch(deps, { dryRun: false });
  return { db, deps, tick };
}

Deno.test("#4574 rework P1-1: a snapshot RPC that fails on every check emails once per 2 h, not every 15 min", async () => {
  const w = world();
  w.db.snapshotError = "canceling statement due to statement timeout";
  const kinds: string[] = [];
  for (let i = 0; i < 8; i += 1) { // 8 checks: 00:04 .. 01:49
    const o = await w.tick();
    assertEquals(o.level, "unproven");
    kinds.push(...o.sent);
    w.db.now += 15 * 60 * 1000;
  }
  assertEquals(kinds, ["unproven"]);
  assertEquals(w.db.sent.length, 1);
  w.db.now = Date.parse("2026-11-25T02:04:00Z"); // 2 h after the first
  assertEquals((await w.tick()).sent, ["unproven"]);
  // A whole day of failing checks: 12 emails, never 96.
  const w2 = world();
  w2.db.snapshotError = "permission denied for function brand_site_recovery_watch_snapshot";
  for (let i = 0; i < 96; i += 1) { await w2.tick(); w2.db.now += 15 * 60 * 1000; }
  assertEquals(w2.db.sent.length, 12);
});

Deno.test("#4574 rework P1-1: with the claim RPC failing too, unproven uses the stateless 2 h slot", async () => {
  const w = world();
  w.db.snapshotError = "connection refused";
  w.db.claimError = "connection refused";
  for (let i = 0; i < 96; i += 1) { await w.tick(); w.db.now += 15 * 60 * 1000; }
  assertEquals(w.db.sent.length, 12);
  // The slot is exactly one cron tick (4-59/15) in every 2 h.
  let slots = 0;
  for (let m = 0; m < 24 * 60; m += 15) {
    if (statelessUnprovenSlot(Date.parse("2026-11-25T00:04:00Z") + m * 60 * 1000)) slots += 1;
  }
  assertEquals(slots, 12);
  assertEquals(SITES_UNPROVEN_REPEAT_MS, 2 * H);
});

Deno.test("#4574 rework P2-1: two runs started together send each email once", async () => {
  const w = world();
  // 1.5 h left (warn) and no completion for 38 h (heartbeat due).
  w.db.now = w.db.databaseAt + 46.5 * H;
  const [a, b] = await Promise.all([w.tick(), w.tick()]);
  // Both read the same (empty) state, so both wanted to send...
  assertEquals(a.would_send, ["warn", "heartbeat"]);
  assertEquals(b.would_send, ["warn", "heartbeat"]);
  // ...but the claim lets exactly one of them.
  assertEquals(w.db.sent.map((s) => s.kind).sort(), ["heartbeat", "warn"]);
  assertEquals([...a.not_claimed, ...b.not_claimed].sort(), ["heartbeat", "warn"]);
  // Three at once at critical: still one email.
  w.db.now = w.db.databaseAt + 47.7 * H;
  await Promise.all([w.tick(), w.tick(), w.tick()]);
  assertEquals(w.db.sent.filter((s) => s.kind === "critical").length, 1);
});

Deno.test("#4574 rework: an email that reached nobody releases its claim and is retried", async () => {
  const w = world();
  w.db.now = w.db.databaseAt + 46.5 * H;
  w.db.lastCompletion = w.db.now; // no heartbeat
  w.db.deliver = false;
  const o1 = await w.tick();
  assertEquals(o1.send_failed, ["warn"]);
  assertEquals(w.db.row.last_sent_level, null);
  w.db.deliver = true;
  w.db.now += 15 * 60 * 1000;
  w.db.lastCompletion = w.db.now;
  assertEquals((await w.tick()).sent, ["warn"]);
  w.db.now += 15 * 60 * 1000;
  w.db.lastCompletion = w.db.now;
  assertEquals((await w.tick()).sent, []);
});

Deno.test("#4574 rework source guard: the probe claims and releases through SQL, which owns the 2 h cadence", async () => {
  const index = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(index.includes(`serviceClient.rpc("brand_site_recovery_watch_claim"`), "index.ts must claim before sending");
  assert(index.includes(`serviceClient.rpc("brand_site_recovery_watch_release"`), "index.ts must release undelivered claims");
  const sql = await Deno.readTextFile(new URL(
    "../../migrations/20281128004574_issue_4574_sites_backup_budget_and_alerts.sql", import.meta.url));
  const claim = sql.match(/CREATE OR REPLACE FUNCTION public\.brand_site_recovery_watch_claim\([\s\S]*?\n\$function\$;/)?.[0] ?? "";
  assert(claim.includes("FROM public.brand_site_recovery_watch_state WHERE id FOR UPDATE;"), "the claim must lock the row");
  assert(claim.includes("v_old.unproven_sent_at <= clock_timestamp() - interval '2 hours'"), "SQL owns the 2 h unproven cadence");
  assert(sql.includes("REVOKE ALL ON FUNCTION public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;"));
});
