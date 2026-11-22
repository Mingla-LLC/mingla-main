// MINGLA-INVARIANT: I-4564-HOST-PUSH-DELETE-BOUNDED-AND-AUDIBLE | issue #4564 | with the provider delete switch on, host-push-reconcile deletes only refused_token records the #4549 app reported on and took a repair for, at most MAX_PROVIDER_DELETES_PER_RUN per run, only after a fresh provider read at delete time still shows an APNs refusal, and logs one structured line (no tokens, emails or account ids) per delete decision plus attempted/succeeded/suppressed counts on the run line.
//
// #4564 delete switch: the per-run cap, the delete-time fresh read, the log
// lines and the "an old build is never deleted" shape seen in production.
// No network, no keys: an in-memory store and a scripted fake provider.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type DeviceRow,
  freshReadAllowsDelete,
  MAX_PROVIDER_DELETES_PER_RUN,
} from "../logic.ts";
import {
  PROVIDER_DELETE_ENABLED,
  type ReconcileState,
  type ReconcileStore,
  runHostPushReconcile,
} from "../run.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-23T00:00:00.000Z");
const REST_KEY = "rest-key-SECRET-4564";
const UID = (n: number) =>
  `45640000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SUB = (n: number) => `sub-4564-${n}`;
const TOKEN = (n: number) => `apns-token-4564-${n}`;
const iso = (t: number) => new Date(t).toISOString();

class Store implements ReconcileStore {
  rows: DeviceRow[] = [];
  users: string[] = [];
  claims = 0;
  attempts = new Map<string, number>();
  state: ReconcileState = {
    last_alert_fingerprint: null,
    last_alert_at: null,
    provider_backoff_until: null,
  };
  private seq = 0;
  candidates(limit: number) {
    return Promise.resolve(this.users.slice(0, limit));
  }
  rowsForUser(userId: string) {
    return Promise.resolve(
      this.rows.filter((r) => r.user_id === userId).map((r) => ({ ...r })),
    );
  }
  insertRow(row: DeviceRow) {
    this.rows.push({ ...row, id: `ins-${++this.seq}` });
    return Promise.resolve();
  }
  updateRow(id: string, patch: Record<string, unknown>) {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
    return Promise.resolve();
  }
  /** Mirrors host_push_claim_provider_delete (tested in pg17). */
  claimProviderDelete(id: string, nowIso: string) {
    const row = this.rows.find((r) => r.id === id);
    const used = this.attempts.get(id) ?? 0;
    if (
      !row || row.provider_state !== "refused_token" ||
      row.repair_state === "provider_deleted" ||
      row.repair_state === "gave_up" || used >= 3
    ) {
      return Promise.resolve(false);
    }
    this.claims += 1;
    this.attempts.set(id, used + 1);
    row.repair_state = "provider_deleted";
    row.provider_deleted_at = nowIso;
    return Promise.resolve(true);
  }
  releaseProviderDelete(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row && row.repair_state === "provider_deleted") {
      row.repair_state = "none";
      row.provider_deleted_at = null;
    }
    return Promise.resolve();
  }
  deleteRows(ids: string[]) {
    this.rows = this.rows.filter((r) => !ids.includes(r.id ?? ""));
    return Promise.resolve();
  }
  allRows() {
    return Promise.resolve(this.rows.map((r) => ({ ...r })));
  }
  displayNames() {
    return Promise.resolve(new Map<string, string>());
  }
  readState() {
    return Promise.resolve({ ...this.state });
  }
  writeState(patch: Partial<ReconcileState>) {
    this.state = { ...this.state, ...patch };
    return Promise.resolve();
  }
  /** What report_host_push_device does (the SQL is tested in pg17). */
  appReports(subId: string, at: number) {
    const row = this.rows.find((r) => r.provider_subscription_id === subId);
    if (!row) return;
    row.last_reported_at = iso(at);
    row.last_report_reason = "launch";
    if (row.repair_state === "requested") {
      row.repair_state = "none";
      row.repair_requests = Math.min(row.repair_requests + 1, 3);
    }
  }
}

type Reply = {
  status: number;
  body?: unknown;
  retryAfter?: string | null;
  throws?: boolean;
};
type Script = (
  call: { user: string; method: string; viewIndex: number },
) => Reply;

function viewBody(user: string, subs: Array<[string, string, number]>) {
  return {
    identity: { external_id: user },
    subscriptions: subs.map(([id, type, code], i) => ({
      id,
      type,
      notification_types: code,
      test_type: 0,
      token: TOKEN(i),
      email: "host@example.test",
    })),
  };
}

function rig(
  store: Store,
  script: Script,
  switchFed: { value: unknown } = { value: true },
) {
  const clock = { t: T0 };
  const calls: Array<{ method: string; url: string }> = [];
  const logs: string[] = [];
  const views = new Map<string, number>();
  const fetch = (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url });
    const user = decodeURIComponent(url.split("/external_id/")[1] ?? "");
    const viewIndex = init.method === "GET" ? (views.get(user) ?? 0) : -1;
    if (init.method === "GET") views.set(user, viewIndex + 1);
    const r = script({ user, method: init.method, viewIndex });
    if (r.throws) return Promise.reject(new TypeError("network down"));
    return Promise.resolve({
      status: r.status,
      headers: {
        get: (n: string) =>
          n.toLowerCase() === "retry-after" ? r.retryAfter ?? null : null,
      },
      json: () => Promise.resolve(r.body ?? null),
    });
  };
  const run = () => {
    views.clear();
    return runHostPushReconcile({
      store,
      credentials: { appId: "app-4564", restKey: REST_KEY },
      fetch,
      now: () => clock.t,
      sleep: (ms) => {
        clock.t += ms;
        return Promise.resolve();
      },
      sendAlert: () => Promise.resolve({ succeeded: 1, attempted: 1 }),
      recipients: () => ["ops@example.test"],
      // deno-lint-ignore no-explicit-any
      deleteEnabled: switchFed.value as any,
      log: (line) => logs.push(line),
    });
  };
  return { clock, calls, logs, run };
}

/** A record every delete condition holds for: refused 2 days, asked, reported since. */
function eligible(user: string, sub: string, idx: number): DeviceRow {
  return {
    id: `seed-${idx}`,
    user_id: user,
    provider_subscription_id: sub,
    platform: "ios",
    device_permission: "granted",
    last_reported_at: iso(T0 - HOUR),
    last_report_reason: "launch",
    provider_state: "refused_token",
    provider_status_code: -14,
    provider_environment: 0,
    provider_checked_at: iso(T0 - HOUR),
    repair_state: "none",
    repair_requests: 1,
    repair_window_started_at: iso(T0 - 2 * DAY),
    provider_deleted_at: null,
    created_at: iso(T0 - 10 * DAY),
  };
}

const deleteLines = (logs: string[]) =>
  logs.filter((l) => l.includes('"event":"host_push_provider_delete"')).map((
    l,
  ) => JSON.parse(l));
const runLine = (logs: string[]) =>
  JSON.parse(
    logs.find((l) => l.includes('"event":"host_push_reconcile_run"')) ?? "{}",
  );

// ---------------------------------------------------------------------------

Deno.test("#4564 the bundle switch is on and the per-run cap is 5", () => {
  assertEquals(PROVIDER_DELETE_ENABLED, true);
  assertEquals(MAX_PROVIDER_DELETES_PER_RUN, 5);
});

Deno.test("#4564 an old build (never reported, never took a repair) is never deleted, switch on, over 8 days", async () => {
  // The production shape on 2026-11-22: the reconciler inserted the record
  // itself, so last_report_reason is null and repair_requests stays 0.
  for (const code of [-14, -30]) {
    const store = new Store();
    store.users = [UID(1)];
    const r = rig(
      store,
      ({ user }) => ({
        status: 200,
        body: viewBody(user, [[SUB(1), "iOSPush", code]]),
      }),
    );
    for (let i = 0; i < 8 * 48; i++) {
      await r.run();
      r.clock.t += 30 * MIN;
    }
    assertEquals(r.calls.filter((c) => c.method === "DELETE").length, 0);
    assertEquals(store.claims, 0);
    assertEquals(store.rows[0].repair_requests, 0);
    assertEquals(store.rows[0].repair_state, "gave_up", `code ${code}`);
  }
});

Deno.test("#4564 cap: 8 eligible records, one run makes exactly 5 deletes and suppresses 3 out loud; the next run takes the rest", async () => {
  const store = new Store();
  for (let n = 1; n <= 8; n++) {
    store.users.push(UID(n));
    store.rows.push(eligible(UID(n), SUB(n), n));
  }
  const r = rig(store, ({ user, method }) => {
    if (method === "DELETE") return { status: 202 };
    const n = Number(user.slice(-12));
    return { status: 200, body: viewBody(user, [[SUB(n), "iOSPush", -14]]) };
  });
  const first = await r.run();
  assertEquals(r.calls.filter((c) => c.method === "DELETE").length, 5);
  assertEquals(first.provider_deletes_attempted, 5);
  assertEquals(first.provider_deletes_succeeded, 5);
  assertEquals(first.provider_deletes_suppressed, 3);
  const lines = deleteLines(r.logs);
  assertEquals(lines.filter((l) => l.outcome === "deleted").length, 5);
  const capped = lines.filter((l) => l.outcome === "suppressed");
  assertEquals(capped.length, 3);
  assert(capped.every((l) => l.reason === "run_cap"));
  // A capped record is not claimed: it stays eligible.
  assertEquals(store.claims, 5);
  assertEquals(
    store.rows.filter((x) => x.repair_state === "provider_deleted").length,
    5,
  );
  const line = runLine(r.logs);
  assertEquals(line.provider_deletes_attempted, 5);
  assertEquals(line.provider_deletes_succeeded, 5);
  assertEquals(line.provider_deletes_suppressed, 3);

  r.logs.length = 0;
  r.clock.t += 30 * MIN;
  const second = await r.run();
  assertEquals(second.provider_deletes_attempted, 3);
  assertEquals(second.provider_deletes_suppressed, 0);
  assertEquals(r.calls.filter((c) => c.method === "DELETE").length, 8);
});

Deno.test("#4564 cap counts failed attempts too: 7 eligible records whose deletes all fail make 5 calls, not 7", async () => {
  const store = new Store();
  for (let n = 1; n <= 7; n++) {
    store.users.push(UID(n));
    store.rows.push(eligible(UID(n), SUB(n), n));
  }
  const r = rig(store, ({ user, method }) => {
    if (method === "DELETE") return { status: 500 };
    const n = Number(user.slice(-12));
    return { status: 200, body: viewBody(user, [[SUB(n), "iOSPush", -16]]) };
  });
  const s = await r.run();
  assertEquals(r.calls.filter((c) => c.method === "DELETE").length, 5);
  assertEquals(s.provider_deletes_attempted, 5);
  assertEquals(s.provider_deletes_succeeded, 0);
  assertEquals(s.provider_deletes_suppressed, 2);
  const failed = deleteLines(r.logs).filter((l) => l.outcome === "failed");
  assertEquals(failed.length, 5);
  assert(failed.every((l) => l.http_status === 500 && l.reason === "http_500"));
  assert(store.rows.every((x) => x.repair_state !== "provider_deleted"));
});

Deno.test("#4564 fresh read: the delete-time read decides, not the stored verdict or the earlier read", async () => {
  const cases: Array<
    { name: string; second: (u: string) => Reply; reason: string }
  > = [
    {
      name: "now subscribed",
      second: (u) => ({
        status: 200,
        body: viewBody(u, [[SUB(1), "iOSPush", 1]]),
      }),
      reason: "fresh_read_not_refused_token",
    },
    {
      name: "now unsubscribed",
      second: (u) => ({
        status: 200,
        body: viewBody(u, [[SUB(1), "iOSPush", -2]]),
      }),
      reason: "fresh_read_not_refused_token",
    },
    {
      name: "gone from the account",
      second: (u) => ({ status: 200, body: viewBody(u, []) }),
      reason: "fresh_read_not_listed",
    },
    {
      name: "conflicting duplicate entry",
      second: (u) => ({
        status: 200,
        body: viewBody(u, [[SUB(1), "iOSPush", -14], [SUB(1), "iOSPush", 1]]),
      }),
      reason: "fresh_read_not_refused_token",
    },
    {
      name: "listed as Android",
      second: (u) => ({
        status: 200,
        body: viewBody(u, [[SUB(1), "AndroidPush", -14]]),
      }),
      reason: "fresh_read_not_ios",
    },
    {
      name: "provider 503",
      second: () => ({ status: 503 }),
      reason: "fresh_read_unavailable",
    },
    {
      name: "transport error",
      second: () => ({ status: 0, throws: true }),
      reason: "fresh_read_unavailable",
    },
    {
      name: "user not found",
      second: () => ({ status: 404 }),
      reason: "fresh_read_not_found",
    },
    {
      name: "identity mismatch",
      second: () => ({
        status: 200,
        body: viewBody("someone-else", [[SUB(1), "iOSPush", -14]]),
      }),
      reason: "fresh_read_unavailable",
    },
    {
      name: "rate limited",
      second: () => ({ status: 429, retryAfter: "30" }),
      reason: "fresh_read_rate_limited",
    },
    {
      name: "auth error",
      second: () => ({ status: 401 }),
      reason: "fresh_read_auth_error",
    },
  ];
  for (const c of cases) {
    const store = new Store();
    store.users = [UID(1)];
    store.rows = [eligible(UID(1), SUB(1), 1)];
    const r = rig(store, ({ user, method, viewIndex }) => {
      if (method === "DELETE") return { status: 202 };
      return viewIndex === 0
        ? { status: 200, body: viewBody(user, [[SUB(1), "iOSPush", -14]]) }
        : c.second(user);
    });
    const s = await r.run();
    assertEquals(
      r.calls.filter((x) => x.method === "DELETE").length,
      0,
      c.name,
    );
    assertEquals(store.claims, 0, `${c.name}: not claimed`);
    assertEquals(store.rows[0].provider_deleted_at, null, c.name);
    assertEquals(s.provider_deletes_attempted, 0, c.name);
    assertEquals(s.provider_deletes_suppressed, 1, c.name);
    const lines = deleteLines(r.logs);
    assertEquals(lines.length, 1, c.name);
    assertEquals(lines[0].outcome, "suppressed", c.name);
    assertEquals(lines[0].reason, c.reason, c.name);
  }
});

Deno.test("#4564 fresh read: a delete is preceded by its own GET in the same run", async () => {
  const store = new Store();
  store.users = [UID(1)];
  store.rows = [eligible(UID(1), SUB(1), 1)];
  const r = rig(
    store,
    ({ user, method }) =>
      method === "DELETE"
        ? { status: 202 }
        : { status: 200, body: viewBody(user, [[SUB(1), "iOSPush", -30]]) },
  );
  await r.run();
  assertEquals(r.calls.map((c) => c.method), ["GET", "GET", "DELETE"]);
});

Deno.test("#4564 freshReadAllowsDelete: only iOS entries that all carry an APNs error code pass", () => {
  const ok = (subs: Array<[string, "ios" | "android", number | null]>) => ({
    kind: "ok" as const,
    subscriptions: subs.map(([id, platform, code]) => ({
      id,
      platform,
      notification_types: code,
      test_type: 0,
    })),
  });
  for (const code of [-14, -16, -17, -30]) {
    assertEquals(freshReadAllowsDelete(ok([["s", "ios", code]]), "s"), {
      ok: true,
      statusCode: code,
    });
  }
  for (const code of [1, 0, -2, -10, -13, -15, -18, -99, -1, null]) {
    assertEquals(
      freshReadAllowsDelete(ok([["s", "ios", code]]), "s").ok,
      false,
      `code ${code}`,
    );
  }
  assertEquals(freshReadAllowsDelete(ok([["t", "ios", -14]]), "s").ok, false);
  assertEquals(
    freshReadAllowsDelete(ok([["s", "android", -14]]), "s").ok,
    false,
  );
});

Deno.test("#4564 delete log lines: one per decision, fixed keys, no token, email, account id, subscription id or key", async () => {
  const store = new Store();
  store.users = [UID(1), UID(2), UID(3)];
  store.rows = [
    eligible(UID(1), SUB(1), 1),
    eligible(UID(2), SUB(2), 2),
    eligible(UID(3), SUB(3), 3),
  ];
  const r = rig(store, ({ user, method, viewIndex }) => {
    const n = Number(user.slice(-12));
    if (method === "DELETE") return { status: 202 };
    if (n === 2 && viewIndex === 1) {
      return { status: 200, body: viewBody(user, [[SUB(2), "iOSPush", 1]]) };
    }
    return { status: 200, body: viewBody(user, [[SUB(n), "iOSPush", -17]]) };
  });
  // The second account's delete-time read shows it subscribed again.
  const s = await r.run();
  assertEquals(r.calls.filter((c) => c.method === "DELETE").length, 2);
  assertEquals(s.provider_deletes_succeeded, 2);
  assertEquals(s.provider_deletes_suppressed, 1);
  const lines = deleteLines(r.logs);
  assertEquals(lines.length, 3);
  for (const l of lines) {
    assertEquals(Object.keys(l).sort(), [
      "event",
      "http_status",
      "outcome",
      "platform",
      "reason",
      "record_id",
      "state",
      "status_code",
    ]);
    assertEquals(l.state, "refused_token");
    assertEquals(l.platform, "ios");
    assert(String(l.record_id).startsWith("seed-"));
  }
  const deleted = lines.filter((l) => l.outcome === "deleted");
  assertEquals(deleted.length, 2);
  assert(deleted.every((l) => l.http_status === 202 && l.status_code === -17));
  const suppressed = lines.find((l) => l.outcome === "suppressed");
  assertEquals(suppressed?.record_id, "seed-2");
  assertEquals(suppressed?.status_code, 1);
  const all = r.logs.join("\n");
  for (
    const secret of [
      REST_KEY,
      "apns-token-4564",
      "example.test",
      "sub-4564",
      "45640000-",
    ]
  ) {
    assert(!all.includes(secret), `log leaks ${secret}`);
  }
});

Deno.test("#4564 a provider 429 on the delete stops the run, logs rate_limited and suppresses the rest", async () => {
  const store = new Store();
  store.users = [UID(1), UID(2)];
  store.rows = [eligible(UID(1), SUB(1), 1), eligible(UID(2), SUB(2), 2)];
  const r = rig(store, ({ user, method }) => {
    if (method === "DELETE") return { status: 429, retryAfter: "60" };
    const n = Number(user.slice(-12));
    return { status: 200, body: viewBody(user, [[SUB(n), "iOSPush", -14]]) };
  });
  const s = await r.run();
  assertEquals(s.stopped, "rate_limited");
  assertEquals(r.calls.filter((c) => c.method === "DELETE").length, 1);
  assertEquals(s.provider_deletes_attempted, 1);
  assertEquals(s.provider_deletes_succeeded, 0);
  const lines = deleteLines(r.logs);
  assertEquals(lines.map((l) => l.outcome), ["rate_limited"]);
  assert(store.state.provider_backoff_until !== null);
  assertEquals(store.rows[0].repair_state, "none", "claim released");
});

Deno.test("#4564 deleteEnabled fed anything but literal true still deletes nothing", async () => {
  for (const fed of [undefined, false, "true", 1, {}]) {
    const store = new Store();
    store.users = [UID(1)];
    store.rows = [eligible(UID(1), SUB(1), 1)];
    const r = rig(
      store,
      ({ user, method }) =>
        method === "DELETE"
          ? { status: 202 }
          : { status: 200, body: viewBody(user, [[SUB(1), "iOSPush", -14]]) },
      { value: fed },
    );
    const s = await r.run();
    assertEquals(r.calls.filter((c) => c.method === "DELETE").length, 0);
    assertEquals(s.provider_deletes_suppressed, 0);
    assertEquals(deleteLines(r.logs).length, 0);
  }
});
