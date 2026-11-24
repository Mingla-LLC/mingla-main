// MINGLA-INVARIANT: I-4574-SITES-FIRST-PUBLISH-BACKUP-BUDGET | issue #4574 | The first-publish database-backup freshness budget has one owner (public.brand_site_database_backup_budget()) read by the gate and the alert lane, and it is always guarded by a non-GitHub (pg_cron) alert that fires before it expires.
// Issue #4574 — the Sites recovery watch tells people before new websites stop
// going live, and the number it measures is the gate's own.
//
// A fake database mirrors brand_site_recovery_watch_snapshot (closes_at =
// least(database stamp + gate budget, manifest stamp + manifest budget)) and
// brand_site_recovery_watch_record (the pg17 suite proves the SQL side). The
// real runSitesRecoveryWatch drives it:
//   * level boundaries come from hours left before closes_at;
//   * warn, critical and expired each email once per incident; a new backup
//     sends one recovery email;
//   * walking every 15-minute tick towards expiry, the FIRST email is warn and
//     it goes out before the gate closes (warn can never fire after expiry);
//   * no backup completed for 18 h sends one heartbeat per completion;
//   * an unreadable snapshot is "unproven" (never ok), repeated at most every 2 h;
//   * a dry run sends nothing and records nothing; an undelivered email does
//     not move the dedup state;
//   * the source guard: the gate calls the one readiness owner
//     (brand_site_first_publish_ready, #4572), that owner and the snapshot both
//     read the SAME helpers, and this lane holds no budget of its own.
//
// FAILS-ON-REVERT: hard-code `interval '26 hours'` in the readiness owner, or
// drop the gate's call to it, and the source guard fails; drop the
// same-incident rank check and the dedup test fails; drop the `succeeded > 0`
// filter and the retry test fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideSitesAlerts,
  levelForHeadroom,
  readSitesSnapshot,
  runSitesRecoveryWatch,
  SITES_CRITICAL_HEADROOM_H,
  SITES_HEARTBEAT_H,
  SITES_RECOVERED_HEADROOM_H,
  SITES_WARN_HEADROOM_H,
  SITES_WATCH_CADENCE_H,
  type SitesAlert,
  type SitesWatchDeps,
  type SitesWatchState,
} from "./sitesRecoveryWatch.ts";

const H = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

// The gate budget as the fake SQL reports it. Tests read it from here, never
// from the module (which has none).
const GATE_BUDGET_H = 48;
const MANIFEST_BUDGET_H = 26;

function world(opts: { gateBudgetH?: number } = {}) {
  const gate = opts.gateBudgetH ?? GATE_BUDGET_H;
  const db = {
    now: Date.parse("2026-11-24T10:00:00Z"),
    databaseAt: Date.parse("2026-11-24T10:00:00Z"),
    manifestAt: Date.parse("2026-11-24T10:00:00Z"),
    lastCompletion: Date.parse("2026-11-24T10:00:00Z") as number | null,
    snapshotError: null as string | null,
    deliver: true,
    state: {
      level: null, incident_closes_at: null, last_sent_level: null,
      last_sent_at: null, heartbeat_for: null, unproven_sent_at: null,
    } as SitesWatchState,
    sent: [] as SitesAlert[],
    records: 0,
  };
  const deps: SitesWatchDeps = {
    snapshot: async () => {
      if (db.snapshotError) return { data: null, error: db.snapshotError };
      return {
        data: {
          config_present: true,
          gate_budget_h: gate,
          manifest_budget_h: MANIFEST_BUDGET_H,
          database_backup_verified_at: iso(db.databaseAt),
          object_manifest_verified_at: iso(db.manifestAt),
          closes_at: iso(Math.min(db.databaseAt + gate * H, db.manifestAt + MANIFEST_BUDGET_H * H)),
          last_completion_at: db.lastCompletion === null ? null : iso(db.lastCompletion),
          state: { ...db.state },
        },
        error: null,
      };
    },
    record: async (e) => {
      db.records += 1;
      db.state.level = e.level;
      if (e.sent_level) {
        db.state.last_sent_level = e.sent_level;
        db.state.last_sent_at = iso(db.now);
        db.state.incident_closes_at = e.incident_closes_at;
      }
      if (e.heartbeat_for) db.state.heartbeat_for = e.heartbeat_for;
      if (e.unproven_sent) db.state.unproven_sent_at = iso(db.now);
      return { error: null };
    },
    send: async (alert) => {
      if (!db.deliver) return { succeeded: 0 };
      db.sent.push(alert);
      return { succeeded: 1 };
    },
    nowMs: () => db.now,
  };
  /** A provider backup at `at` recorded by a job finishing at `at` (manifest stamp). */
  const backup = (at: number) => {
    db.databaseAt = at;
    db.manifestAt = at;
    db.lastCompletion = at;
  };
  const tick = (dryRun = false) => runSitesRecoveryWatch(deps, { dryRun });
  return { db, deps, tick, backup, gate };
}

Deno.test("#4574 thresholds: alert levels are hours left, measured against the gate's own budget", async () => {
  const w = world();
  // The database stamp drives closing: keep the manifest fresh (both daily runs renew it).
  const keepManifest = () => { w.db.manifestAt = w.db.now; w.db.lastCompletion = w.db.now; };
  // A 30 h-old provider backup: the gate is open with 18 h left (it would have
  // been closed under the old 26 h budget).
  w.db.now = w.db.databaseAt + 30 * H; keepManifest();
  let out = await w.tick(true);
  assertEquals(out.level, "ok");
  assertEquals(out.headroom_h, GATE_BUDGET_H - 30);
  assertEquals(out.gate_budget_h, GATE_BUDGET_H);
  for (const [age, level] of [
    [GATE_BUDGET_H - SITES_RECOVERED_HEADROOM_H - 0.01, "ok"],
    [GATE_BUDGET_H - SITES_RECOVERED_HEADROOM_H + 0.01, "watch"],
    [GATE_BUDGET_H - SITES_WARN_HEADROOM_H + 0.01, "warn"],
    [GATE_BUDGET_H - SITES_CRITICAL_HEADROOM_H + 0.01, "critical"],
    [GATE_BUDGET_H, "expired"],
    [GATE_BUDGET_H + 1, "expired"],
  ] as const) {
    w.db.now = w.db.databaseAt + age * H; keepManifest();
    out = await w.tick(true);
    assertEquals(out.level, level, `age ${age} h`);
  }
  // A different gate budget moves every threshold with it (the lane has none of its own).
  const w2 = world({ gateBudgetH: 30 });
  w2.db.now = w2.db.databaseAt + 29 * H; w2.db.manifestAt = w2.db.now; w2.db.lastCompletion = w2.db.now;
  assertEquals((await w2.tick(true)).level, "warn");
});

Deno.test("#4574 the manifest budget can close the gate first, and the watch sees it", async () => {
  const w = world();
  // Database backup fresh, but the backup job last finished 25 h ago.
  w.db.manifestAt = w.db.now - 25 * H;
  w.db.lastCompletion = w.db.manifestAt;
  const out = await w.tick(true);
  assertEquals(out.level, "warn");
  assertEquals(out.closes_at, iso(w.db.manifestAt + MANIFEST_BUDGET_H * H));
});

Deno.test("#4574 the warn level is wider than the cron cadence and narrower than the budget", () => {
  assert(SITES_WARN_HEADROOM_H > 2 * SITES_WATCH_CADENCE_H, "warn must survive a missed tick");
  assert(SITES_CRITICAL_HEADROOM_H > SITES_WATCH_CADENCE_H);
  assert(SITES_WARN_HEADROOM_H > SITES_CRITICAL_HEADROOM_H);
  assert(SITES_RECOVERED_HEADROOM_H > SITES_WARN_HEADROOM_H);
  assert(SITES_WARN_HEADROOM_H < GATE_BUDGET_H && SITES_RECOVERED_HEADROOM_H < MANIFEST_BUDGET_H);
  assertEquals(levelForHeadroom(0), "expired");
  assertEquals(levelForHeadroom(-0.01), "expired");
});

Deno.test("#4574 walking every 15-minute tick to expiry: warn first, before the gate closes, then critical, then expired, each once", async () => {
  const w = world();
  const closes = w.db.databaseAt + GATE_BUDGET_H * H;
  w.db.now = closes - 10 * H;
  const timeline: { kind: string; headroom: number }[] = [];
  while (w.db.now <= closes + 2 * H) {
    w.db.manifestAt = w.db.now; // the manifest is renewed; the provider backup is not.
    const before = w.db.sent.length;
    await w.tick();
    for (const a of w.db.sent.slice(before)) timeline.push({ kind: a.kind, headroom: (closes - w.db.now) / H });
    w.db.now += SITES_WATCH_CADENCE_H * H;
  }
  // lastCompletion stays at the old backup time, so a heartbeat fires too: drop it here.
  const levels = timeline.filter((t) => t.kind !== "heartbeat");
  assertEquals(levels.map((t) => t.kind), ["warn", "critical", "expired"]);
  assert(levels[0].headroom > 0, "warn must fire before expiry");
  assert(levels[1].headroom > 0, "critical must fire before expiry");
});

Deno.test("#4574 dedup: one email per level per incident; a new backup sends one recovery", async () => {
  const w = world();
  w.db.now = w.db.databaseAt + (GATE_BUDGET_H - 1.9) * H;
  w.db.manifestAt = w.db.now; w.db.lastCompletion = w.db.now;
  const o1 = await w.tick();
  assertEquals(o1.sent, ["warn"]);
  assertEquals(w.db.state.last_sent_level, "warn");
  w.db.now += 15 * 60 * 1000; w.db.manifestAt = w.db.now; w.db.lastCompletion = w.db.now;
  assertEquals((await w.tick()).sent, []);
  w.db.now += 15 * 60 * 1000; w.db.manifestAt = w.db.now; w.db.lastCompletion = w.db.now;
  assertEquals((await w.tick()).sent, []);
  // A new backup lands: 48 h left.
  w.backup(w.db.now);
  assertEquals((await w.tick()).sent, ["recovered"]);
  assertEquals((await w.tick()).sent, []);
  // The next incident (a new closes_at) warns again.
  w.db.now = w.db.databaseAt + (GATE_BUDGET_H - 1) * H; w.db.manifestAt = w.db.now; w.db.lastCompletion = w.db.now;
  assertEquals((await w.tick()).sent, ["warn"]);
  assertEquals(w.db.sent.length, 3);
});

Deno.test("#4574 first observation already expired sends expired, never warn", () => {
  const closes = Date.parse("2026-11-26T10:00:00Z");
  const snap = readSitesSnapshot({
    config_present: true, gate_budget_h: GATE_BUDGET_H, manifest_budget_h: MANIFEST_BUDGET_H,
    database_backup_verified_at: iso(closes - GATE_BUDGET_H * H),
    object_manifest_verified_at: iso(closes),
    closes_at: iso(closes), last_completion_at: iso(closes - 1 * H), state: null,
  }).snapshot;
  assert(snap);
  assertEquals(decideSitesAlerts(levelForHeadroom(-0.1), snap, closes + 0.1 * H, snap.state), ["expired"]);
});

Deno.test("#4574 heartbeat: no backup completed in 18 h sends one email per completion", async () => {
  const w = world();
  w.db.lastCompletion = w.db.now - (SITES_HEARTBEAT_H - 0.1) * H;
  assertEquals((await w.tick()).sent, []);
  w.db.lastCompletion = w.db.now - (SITES_HEARTBEAT_H + 0.1) * H;
  assertEquals((await w.tick()).sent, ["heartbeat"]);
  assertEquals((await w.tick()).sent, []);
  w.db.lastCompletion = w.db.now - (SITES_HEARTBEAT_H + 0.05) * H; // a later (still old) completion
  assertEquals((await w.tick()).sent, ["heartbeat"]);
});

Deno.test("#4574 an unreadable snapshot is unproven, never ok, and repeats at most every 2 h", async () => {
  const w = world();
  w.db.snapshotError = "permission denied";
  const o1 = await w.tick();
  assertEquals(o1.level, "unproven");
  assertEquals(o1.sent, ["unproven"]);
  w.db.snapshotError = null;
  // Missing evidence is unproven too (the state row is still readable).
  const missing = readSitesSnapshot({ config_present: true, gate_budget_h: 48, manifest_budget_h: 26, closes_at: null });
  assertEquals(missing.snapshot, null);
  assertEquals(readSitesSnapshot({ config_present: false }).snapshot, null);
  assertEquals(readSitesSnapshot({ config_present: true, gate_budget_h: 0, manifest_budget_h: 26 }).snapshot, null);
  const state = { ...w.db.state };
  assertEquals(decideSitesAlerts("unproven", null, w.db.now + 1 * H, state), []);
  assertEquals(decideSitesAlerts("unproven", null, w.db.now + 2.1 * H, state), ["unproven"]);
});

Deno.test("#4574 a dry run sends nothing and records nothing", async () => {
  const w = world();
  w.db.now = w.db.databaseAt + (GATE_BUDGET_H - 0.4) * H; w.db.manifestAt = w.db.now;
  w.db.lastCompletion = w.db.now - 20 * H;
  const out = await w.tick(true);
  assertEquals(out.dry_run, true);
  assertEquals(out.level, "critical");
  assertEquals(out.would_send, ["critical", "heartbeat"]);
  assertEquals(out.sent, []);
  assertEquals(w.db.sent.length, 0);
  assertEquals(w.db.records, 0);
});

Deno.test("#4574 an undelivered email does not move the dedup state, so the next check retries", async () => {
  const w = world();
  w.db.now = w.db.databaseAt + (GATE_BUDGET_H - 1) * H; w.db.manifestAt = w.db.now; w.db.lastCompletion = w.db.now;
  w.db.deliver = false;
  const o1 = await w.tick();
  assertEquals(o1.send_failed, ["warn"]);
  assertEquals(w.db.state.last_sent_level, null);
  w.db.deliver = true;
  assertEquals((await w.tick()).sent, ["warn"]);
});

// ── Source guard: the alert budget IS the gate budget ─────────────────────────
const MIGRATIONS = new URL("../../migrations/", import.meta.url);

function functionBody(sql: string, name: string): string {
  const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$(?:function)?\\$;`));
  return m?.[0] ?? "";
}

async function newestDefinition(name: string): Promise<{ file: string; body: string }> {
  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) if (e.isFile && e.name.endsWith(".sql")) files.push(e.name);
  files.sort();
  for (const f of files.reverse()) {
    const body = functionBody(await Deno.readTextFile(new URL(f, MIGRATIONS)), name);
    if (body) return { file: f, body };
  }
  return { file: "", body: "" };
}

Deno.test("#4574 source guard: the gate and the alert lane read one budget, and the lane holds none", async () => {
  // #4572 moved the first-publish evidence checks into ONE owner,
  // brand_site_first_publish_ready(), which the gate (and the Host's
  // "publishing paused" read) call. The guard follows that owner: the gate must
  // call it and hold no budget, and the owner must read both shared helpers.
  const gate = await newestDefinition("brand_site_authorize_operation");
  assert(gate.body.length > 0, "no migration defines brand_site_authorize_operation");
  assert(
    /IF NOT public\.brand_site_first_publish_ready\(\) THEN/.test(gate.body),
    `the newest gate (${gate.file}) must refuse a first publish through public.brand_site_first_publish_ready()`,
  );
  assert(!/(database_backup|object_manifest)_verified_at[^\n]*interval '/.test(gate.body), `the newest gate (${gate.file}) has a literal backup or manifest budget`);

  const ready = await newestDefinition("brand_site_first_publish_ready");
  assert(
    ready.body.includes("database_backup_verified_at > clock_timestamp() - public.brand_site_database_backup_budget()"),
    `the newest readiness owner (${ready.file}) must read the shared database-backup budget`,
  );
  assert(
    ready.body.includes("object_manifest_verified_at > clock_timestamp() - public.brand_site_object_manifest_budget()"),
    `the newest readiness owner (${ready.file}) must read the shared manifest budget`,
  );
  assert(!/(database_backup|object_manifest)_verified_at[^\n]*interval '/.test(ready.body), `the readiness owner (${ready.file}) has a literal backup or manifest budget`);

  const snapshot = await newestDefinition("brand_site_recovery_watch_snapshot");
  assert(snapshot.body.length > 0, "no migration defines brand_site_recovery_watch_snapshot");
  for (const token of [
    "'gate_budget_h', extract(epoch FROM public.brand_site_database_backup_budget()) / 3600",
    "config.database_backup_verified_at + public.brand_site_database_backup_budget()",
    "config.object_manifest_verified_at + public.brand_site_object_manifest_budget()",
  ]) assert(snapshot.body.includes(token), `snapshot missing ${token}`);

  const helper = await newestDefinition("brand_site_database_backup_budget");
  assert(helper.body.includes("SELECT interval '48 hours'"), "the approved budget is 48 hours (Seth, #4574 D2)");

  const lane = await Deno.readTextFile(new URL("./sitesRecoveryWatch.ts", import.meta.url));
  assert(!/\b(48|26)\b/.test(lane.replace(/^\/\/.*$/gm, "")), "the alert lane must not hold a budget of its own");
  const index = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(index.includes(`body.mode === "sites_recovery"`), "index.ts must route the sites_recovery mode");
  assert(index.indexOf(`body.mode === "sites_recovery"`) < index.indexOf("const checkRows: CheckRow[] = [];"),
    "sites_recovery must return before the full vendor tick");
});
