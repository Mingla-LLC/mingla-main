// #4564 tester adversarial suite for the provider delete switch.
//
// Written by the independent tester, not the implementor. Every test tries to
// make host-push-reconcile send a DELETE it must not send, send more than the
// per-run cap, send one to the wrong app, or leak an identifier into a log.
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
  type ReconcileState,
  type ReconcileStore,
  runHostPushReconcile,
} from "../run.ts";
import { resolveAppCredentials } from "../../_shared/push-utils.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-24T00:00:00.000Z");
const REST_KEY = "rest-key-TESTER-4564";
const APP_ID = "host-app-TESTER-4564";
const UID = (n: number) =>
  `45641111-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SUB = (n: number) => `sub-tester-4564-${n}`;
const TOKEN = "apns-token-TESTER-4564";
const EMAIL = "tester-4564@example.test";
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
  /** Mirrors host_push_claim_provider_delete: atomic, one claim per record. */
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
}

type Reply = {
  status: number;
  body?: unknown;
  retryAfter?: string | null;
  throws?: boolean;
  hang?: boolean;
};
type Script = (
  call: { user: string; method: string; viewIndex: number; url: string },
) => Reply;

function viewBody(
  user: string,
  subs: Array<[string, string, unknown]>,
): Record<string, unknown> {
  return {
    identity: { external_id: user },
    subscriptions: subs.map(([id, type, code]) => ({
      id,
      type,
      notification_types: code,
      test_type: 0,
      token: TOKEN,
      email: EMAIL,
    })),
  };
}

function rig(
  store: Store,
  script: Script,
  opts: { async?: boolean; requestTimeoutMs?: number } = {},
) {
  const clock = { t: T0 };
  const calls: Array<{ method: string; url: string }> = [];
  const logs: string[] = [];
  const views = new Map<string, number>();
  const fetch = async (url: string, init: { method: string }) => {
    calls.push({ method: init.method, url });
    const user = decodeURIComponent(url.split("/external_id/")[1] ?? "");
    const viewIndex = init.method === "GET" ? (views.get(user) ?? 0) : -1;
    if (init.method === "GET") views.set(user, viewIndex + 1);
    // A real macrotask hop so two concurrent runs genuinely interleave.
    if (opts.async) await new Promise((r) => setTimeout(r, 0));
    const r = script({ user, method: init.method, viewIndex, url });
    if (r.hang) return await new Promise<never>(() => {});
    if (r.throws) throw new TypeError("network down");
    return {
      status: r.status,
      headers: {
        get: (n: string) =>
          n.toLowerCase() === "retry-after" ? r.retryAfter ?? null : null,
      },
      json: () => Promise.resolve(r.body ?? null),
    };
  };
  const run = () => {
    views.clear();
    return runHostPushReconcile({
      store,
      credentials: { appId: APP_ID, restKey: REST_KEY },
      fetch,
      now: () => clock.t,
      sleep: (ms) => {
        clock.t += ms;
        return Promise.resolve();
      },
      sendAlert: () => Promise.resolve({ succeeded: 1, attempted: 1 }),
      recipients: () => [EMAIL],
      deleteEnabled: true,
      requestTimeoutMs: opts.requestTimeoutMs,
      log: (line) => logs.push(line),
    });
  };
  return { clock, calls, logs, run };
}

/** Every ladder condition for a delete holds on this record. */
function eligible(n: number, over: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: `seed-${n}`,
    user_id: UID(n),
    provider_subscription_id: SUB(n),
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
    ...over,
  };
}

const deletes = (calls: Array<{ method: string; url: string }>) =>
  calls.filter((c) => c.method === "DELETE");
const nOf = (user: string) => Number(user.slice(-12));

// ---------------------------------------------------------------------------

Deno.test("T-4564-STATE every provider state other than a fresh iOS APNs refusal is never deleted, even with every ladder field primed", async () => {
  // [platform, provider type, provider code]
  const cases: Array<[string, string, unknown]> = [
    ["android-apns-code", "AndroidPush", -14],
    ["android-firebase", "AndroidPush", -32],
    ["subscribed", "iOSPush", 1],
    ["subscribed-big", "iOSPush", 15],
    ["unsubscribed", "iOSPush", -2],
    ["uninstalled", "iOSPush", -10],
    ["never-subscribed", "iOSPush", 0],
    ["never-prompted", "iOSPush", -18],
    ["prompted-unanswered", "iOSPush", -19],
    ["config", "iOSPush", -13],
    ["simulator", "iOSPush", -15],
    ["disabled-rest", "iOSPush", -31],
    ["unknown-code", "iOSPush", -77],
    ["null-code", "iOSPush", null],
    ["string-code", "iOSPush", "-14"],
    ["float-code", "iOSPush", -14.5],
    ["nan-code", "iOSPush", Number.NaN],
    ["email-channel", "Email", -14],
  ];
  for (const [name, type, code] of cases) {
    const store = new Store();
    store.users = [UID(1)];
    store.rows = [
      eligible(1, {
        platform: type === "AndroidPush" ? "android" : "ios",
      }),
    ];
    const r = rig(
      store,
      ({ user, method }) =>
        method === "DELETE"
          ? { status: 202 }
          : { status: 200, body: viewBody(user, [[SUB(1), type, code]]) },
    );
    for (let i = 0; i < 6; i++) {
      await r.run();
      r.clock.t += 30 * MIN;
    }
    assertEquals(deletes(r.calls).length, 0, name);
    assertEquals(store.claims, 0, name);
  }
});

Deno.test("T-4564-FLIP the plan saw a refusal, the delete-time read sees anything else: no DELETE", async () => {
  const seconds: Array<[string, (u: string) => Reply]> = [
    ["android twin with same id", (u) => ({
      status: 200,
      body: viewBody(u, [[SUB(1), "iOSPush", -14], [
        SUB(1),
        "AndroidPush",
        -14,
      ]]),
    })],
    ["subscribed twin with same id", (u) => ({
      status: 200,
      body: viewBody(u, [[SUB(1), "iOSPush", -14], [SUB(1), "iOSPush", 1]]),
    })],
    [
      "gone",
      (u) => ({ status: 200, body: viewBody(u, [[SUB(2), "iOSPush", -14]]) }),
    ],
    ["other account", () => ({
      status: 200,
      body: viewBody(UID(99), [[SUB(1), "iOSPush", -14]]),
    })],
    ["no identity", () => ({
      status: 200,
      body: {
        subscriptions: [{
          id: SUB(1),
          type: "iOSPush",
          notification_types: -14,
        }],
      },
    })],
    ["subscriptions not an array", (u) => ({
      status: 200,
      body: { identity: { external_id: u }, subscriptions: { id: SUB(1) } },
    })],
    ["body null", () => ({ status: 200, body: null })],
    ["body string", () => ({ status: 200, body: "ok" })],
    ["404 user", () => ({ status: 404 })],
    ["500", () => ({ status: 500 })],
    ["503", () => ({ status: 503, retryAfter: "5" })],
    ["400", () => ({ status: 400 })],
    ["transport throw", () => ({ status: 0, throws: true })],
    ["429", () => ({ status: 429, retryAfter: "30" })],
    ["401", () => ({ status: 401 })],
    ["403", () => ({ status: 403 })],
  ];
  for (const [name, second] of seconds) {
    const store = new Store();
    store.users = [UID(1)];
    store.rows = [eligible(1)];
    const r = rig(store, ({ user, method, viewIndex }) => {
      if (method === "DELETE") return { status: 202 };
      if (viewIndex === 0) {
        return {
          status: 200,
          body: viewBody(user, [[SUB(1), "iOSPush", -14]]),
        };
      }
      return second(user);
    });
    const s = await r.run();
    assertEquals(deletes(r.calls).length, 0, name);
    assertEquals(s.provider_deletes_attempted, 0, name);
    assertEquals(s.provider_deletes_suppressed, 1, name);
    assertEquals(store.claims, 0, name);
    // Not claimed, so not marked deleted in our table either.
    assertEquals(
      store.rows[0].repair_state === "provider_deleted",
      false,
      name,
    );
  }
});

Deno.test("T-4564-TIMEOUT a delete-time read that never answers is aborted and suppresses the delete", async () => {
  const store = new Store();
  store.users = [UID(1)];
  store.rows = [eligible(1)];
  const r = rig(
    store,
    ({ user, method, viewIndex }) => {
      if (method === "DELETE") return { status: 202 };
      if (viewIndex === 0) {
        return {
          status: 200,
          body: viewBody(user, [[SUB(1), "iOSPush", -14]]),
        };
      }
      return { status: 0, hang: true };
    },
    { requestTimeoutMs: 20 },
  );
  const s = await r.run();
  assertEquals(deletes(r.calls).length, 0);
  assertEquals(s.provider_deletes_suppressed, 1);
  const line = r.logs.map((l) => JSON.parse(l)).find((l) =>
    l.event === "host_push_provider_delete"
  );
  assertEquals(line.reason, "fresh_read_unavailable");
});

Deno.test("T-4564-OLDBUILD the production shape on 2026-11-22 (refused, requested, never reported, 0 repairs) never deletes over 8 days", async () => {
  const store = new Store();
  for (let n = 1; n <= 4; n++) {
    store.users.push(UID(n));
    store.rows.push(eligible(n, {
      last_report_reason: null,
      last_reported_at: iso(T0 - 3 * HOUR),
      repair_state: "requested",
      repair_requests: 0,
      repair_window_started_at: iso(T0 - 3 * HOUR),
    }));
  }
  const r = rig(
    store,
    ({ user, method }) =>
      method === "DELETE" ? { status: 202 } : {
        status: 200,
        body: viewBody(user, [[SUB(nOf(user)), "iOSPush", -16]]),
      },
  );
  for (let i = 0; i < 8 * 48; i++) {
    await r.run();
    r.clock.t += 30 * MIN;
  }
  assertEquals(deletes(r.calls).length, 0);
  assertEquals(store.claims, 0);
});

Deno.test("T-4564-STALE-REPORT a report from before the refusal window, or a repair counted but no report since, is not enough", async () => {
  const variants: Array<[string, Partial<DeviceRow>]> = [
    ["reported before window", {
      last_reported_at: iso(T0 - 3 * DAY),
      repair_window_started_at: iso(T0 - 2 * DAY),
    }],
    ["reported, 0 repairs", { repair_requests: 0 }],
    ["window 23h old", { repair_window_started_at: iso(T0 - 23 * HOUR) }],
    ["already deleted", {
      repair_state: "provider_deleted",
      provider_deleted_at: iso(T0 - HOUR),
    }],
    ["gave up", { repair_state: "gave_up" }],
    ["window expired", { repair_window_started_at: iso(T0 - 8 * DAY) }],
  ];
  for (const [name, over] of variants) {
    const store = new Store();
    store.users = [UID(1)];
    store.rows = [eligible(1, over)];
    const r = rig(
      store,
      ({ user, method }) =>
        method === "DELETE"
          ? { status: 202 }
          : { status: 200, body: viewBody(user, [[SUB(1), "iOSPush", -14]]) },
    );
    await r.run();
    assertEquals(deletes(r.calls).length, 0, name);
  }
});

Deno.test("T-4564-CAP 40 eligible accounts with several records each: never more than 5 DELETE calls in one run, whatever the outcome mix", async () => {
  for (const deleteStatus of [202, 404, 500, 400, 503]) {
    const store = new Store();
    let idx = 0;
    for (let n = 1; n <= 40; n++) {
      store.users.push(UID(n));
      for (let k = 0; k < 3; k++) {
        idx += 1;
        store.rows.push(eligible(n, {
          id: `seed-${idx}`,
          provider_subscription_id: `${SUB(n)}-${k}`,
        }));
      }
    }
    const r = rig(store, ({ user, method }) => {
      if (method === "DELETE") return { status: deleteStatus };
      const n = nOf(user);
      return {
        status: 200,
        body: viewBody(
          user,
          [0, 1, 2].map((k) => [`${SUB(n)}-${k}`, "iOSPush", -30]),
        ),
      };
    });
    const s = await r.run();
    assertEquals(
      deletes(r.calls).length,
      MAX_PROVIDER_DELETES_PER_RUN,
      `status ${deleteStatus}`,
    );
    assertEquals(s.provider_deletes_attempted, MAX_PROVIDER_DELETES_PER_RUN);
    assert(s.provider_deletes_succeeded <= s.provider_deletes_attempted);
    assertEquals(
      s.provider_deletes_succeeded,
      deleteStatus === 202 || deleteStatus === 404 ? 5 : 0,
    );
  }
});

Deno.test("T-4564-CONCURRENT two overlapping invocations: no record is deleted twice; the cap is per invocation (at most 2 x 5 together)", async () => {
  const store = new Store();
  for (let n = 1; n <= 12; n++) {
    store.users.push(UID(n));
    store.rows.push(eligible(n));
  }
  const script: Script = ({ user, method }) =>
    method === "DELETE" ? { status: 202 } : {
      status: 200,
      body: viewBody(user, [[SUB(nOf(user)), "iOSPush", -14]]),
    };
  const a = rig(store, script, { async: true });
  const b = rig(store, script, { async: true });
  const [sa, sb] = await Promise.all([a.run(), b.run()]);
  const all = [...deletes(a.calls), ...deletes(b.calls)];
  const ids = all.map((c) => c.url.split("/subscriptions/")[1]);
  assertEquals(new Set(ids).size, ids.length, "a record was deleted twice");
  assert(sa.provider_deletes_attempted <= MAX_PROVIDER_DELETES_PER_RUN);
  assert(sb.provider_deletes_attempted <= MAX_PROVIDER_DELETES_PER_RUN);
  assert(all.length <= 2 * MAX_PROVIDER_DELETES_PER_RUN);
  assertEquals(store.claims, all.length);
});

Deno.test("T-4564-RETRY a record whose delete keeps failing is attempted at most 3 times across runs, then never again", async () => {
  const store = new Store();
  store.users = [UID(1)];
  store.rows = [eligible(1)];
  const r = rig(
    store,
    ({ user, method }) =>
      method === "DELETE"
        ? { status: 500 }
        : { status: 200, body: viewBody(user, [[SUB(1), "iOSPush", -14]]) },
  );
  for (let i = 0; i < 20; i++) {
    await r.run();
    r.clock.t += 30 * MIN;
  }
  assertEquals(deletes(r.calls).length, 3);
});

Deno.test("T-4564-429 a 429 on the DELETE writes a back-off and the next run sends nothing at all", async () => {
  const store = new Store();
  for (let n = 1; n <= 3; n++) {
    store.users.push(UID(n));
    store.rows.push(eligible(n));
  }
  const r = rig(
    store,
    ({ user, method }) =>
      method === "DELETE" ? { status: 429, retryAfter: "3600" } : {
        status: 200,
        body: viewBody(user, [[SUB(nOf(user)), "iOSPush", -14]]),
      },
  );
  const first = await r.run();
  assertEquals(deletes(r.calls).length, 1);
  assertEquals(first.stopped, "rate_limited");
  const before = r.calls.length;
  r.clock.t += 30 * MIN;
  const second = await r.run();
  assertEquals(second.stopped, "backoff");
  assertEquals(r.calls.length, before);
});

Deno.test("T-4564-WRONG-APP every call goes to the configured Host app path; the business credentials never fall back to the Explorer app", async () => {
  const store = new Store();
  store.users = [UID(1)];
  store.rows = [eligible(1)];
  const r = rig(
    store,
    ({ user, method }) =>
      method === "DELETE"
        ? { status: 202 }
        : { status: 200, body: viewBody(user, [[SUB(1), "iOSPush", -14]]) },
  );
  await r.run();
  assertEquals(deletes(r.calls).length, 1);
  for (const c of r.calls) {
    assert(
      c.url.startsWith(`https://api.onesignal.com/apps/${APP_ID}/`),
      c.url,
    );
  }

  // Only the Explorer app's env is set: the Host app resolves to empty, and a
  // run with empty credentials makes no provider call at all.
  const keep = [
    "ONESIGNAL_BUSINESS_APP_ID",
    "ONESIGNAL_BUSINESS_REST_API_KEY",
    "ONESIGNAL_APP_ID",
    "ONESIGNAL_REST_API_KEY",
  ].map((k) => [k, Deno.env.get(k)] as const);
  try {
    Deno.env.delete("ONESIGNAL_BUSINESS_APP_ID");
    Deno.env.delete("ONESIGNAL_BUSINESS_REST_API_KEY");
    Deno.env.set("ONESIGNAL_APP_ID", "explorer-app-TESTER");
    Deno.env.set("ONESIGNAL_REST_API_KEY", "explorer-key-TESTER");
    const creds = resolveAppCredentials("business");
    assertEquals(creds, { appId: "", restKey: "" });
    const calls: string[] = [];
    const s = await runHostPushReconcile({
      store,
      credentials: creds,
      fetch: (url) => {
        calls.push(url);
        return Promise.reject(new Error("must not be called"));
      },
      now: () => T0,
      sleep: () => Promise.resolve(),
      deleteEnabled: true,
      log: () => {},
    });
    assertEquals(s.stopped, "no_credentials");
    assertEquals(calls.length, 0);
  } finally {
    for (const [k, v] of keep) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }

  // index.ts wires the business credentials and nothing else.
  const index = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assert(index.includes('resolveAppCredentials("business")'));
  assert(!/resolveAppCredentials\(\s*"consumer"/.test(index));
  assert(!index.includes("ONESIGNAL_APP_ID"));
});

Deno.test("T-4564-LOGS no log line of any kind carries a token, email, key, app id, account id or subscription id", async () => {
  const store = new Store();
  for (let n = 1; n <= 8; n++) {
    store.users.push(UID(n));
    store.rows.push(eligible(n));
  }
  let i = 0;
  const outcomes = [202, 500, 404, 400];
  const r = rig(store, ({ user, method, viewIndex }) => {
    if (method === "DELETE") return { status: outcomes[i++ % outcomes.length] };
    const n = nOf(user);
    if (n === 7 && viewIndex === 1) return { status: 0, throws: true };
    if (n === 8 && viewIndex === 1) {
      return { status: 200, body: viewBody(user, [[SUB(8), "iOSPush", 1]]) };
    }
    return { status: 200, body: viewBody(user, [[SUB(n), "iOSPush", -14]]) };
  });
  await r.run();
  const banned = [
    TOKEN,
    EMAIL,
    REST_KEY,
    APP_ID,
    "sub-tester-4564",
    "45641111-",
  ];
  const deleteLines = r.logs.filter((l) =>
    l.includes('"event":"host_push_provider_delete"')
  );
  assert(deleteLines.length >= 8);
  for (const line of r.logs) {
    for (const b of banned) assert(!line.includes(b), `${b} in ${line}`);
  }
  for (const line of deleteLines) {
    const keys = Object.keys(JSON.parse(line)).sort();
    assertEquals(keys, [
      "event",
      "http_status",
      "outcome",
      "platform",
      "reason",
      "record_id",
      "state",
      "status_code",
    ]);
  }
});

Deno.test("T-4564-SUMMARY the run summary carries the three new counters and not the old provider_deletes key", async () => {
  const store = new Store();
  const r = rig(store, () => ({ status: 200 }));
  const s = await r.run();
  const keys = Object.keys(s);
  assert(!keys.includes("provider_deletes"));
  for (
    const k of [
      "provider_deletes_attempted",
      "provider_deletes_succeeded",
      "provider_deletes_suppressed",
    ]
  ) assert(keys.includes(k), k);
});

Deno.test("T-4564-GUARD freshReadAllowsDelete refuses an empty list, a mixed-platform twin and a null code", () => {
  assertEquals(
    freshReadAllowsDelete({ kind: "ok", subscriptions: [] }, "x").ok,
    false,
  );
  assertEquals(
    freshReadAllowsDelete({
      kind: "ok",
      subscriptions: [
        { id: "x", platform: "ios", notification_types: -14, test_type: 0 },
        { id: "x", platform: "android", notification_types: -14, test_type: 0 },
      ],
    }, "x").ok,
    false,
  );
  assertEquals(
    freshReadAllowsDelete({
      kind: "ok",
      subscriptions: [
        { id: "x", platform: "ios", notification_types: null, test_type: 0 },
      ],
    }, "x").ok,
    false,
  );
});
