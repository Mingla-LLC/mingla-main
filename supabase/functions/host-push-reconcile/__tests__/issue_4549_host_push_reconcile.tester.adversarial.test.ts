// #4549 host-push-reconcile, tester adversarial suite (Deno 1.46). Angles the
// implementor suite does not take: a hostile or broken provider (every status
// family, malformed bodies, hanging calls, Retry-After in every shape), a huge
// candidate list, the delete switch fed non-boolean values, a faithful replay
// of the report call across ten days, a crash between writes and a rerun, and
// a scan of every log line and alert for secrets and identifiers.
// No network, no keys: a fake provider and an in-memory store.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { type DeviceRow, MAX_USERS_PER_RUN } from "../logic.ts";
import {
  PROVIDER_DELETE_ENABLED,
  type ReconcileDeps,
  type ReconcileState,
  type ReconcileStore,
  runHostPushReconcile,
} from "../run.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-12-01T00:00:00.000Z");
const REST_KEY = "rest-key-SECRET-4549";
const UID = (n: number) =>
  `45493333-0000-4000-8000-${String(n).padStart(12, "0")}`;

class Store implements ReconcileStore {
  rows: DeviceRow[] = [];
  state: ReconcileState = {
    last_alert_fingerprint: null,
    last_alert_at: null,
    provider_backoff_until: null,
  };
  users: string[] = [];
  names = new Map<string, string>();
  claims = 0;
  failUpdateOnCall = -1;
  private updates = 0;
  private seq = 0;
  candidates(limit: number) {
    return Promise.resolve(this.users.slice(0, limit));
  }
  rowsForUser(u: string) {
    return Promise.resolve(
      this.rows.filter((r) => r.user_id === u).map((r) => ({ ...r })),
    );
  }
  insertRow(r: DeviceRow) {
    if (
      this.rows.some((x) =>
        x.user_id === r.user_id &&
        x.provider_subscription_id === r.provider_subscription_id
      )
    ) return Promise.resolve(); // unique key: theirs wins
    this.rows.push({ ...r, id: `ins-${++this.seq}` });
    return Promise.resolve();
  }
  updateRow(id: string, patch: Record<string, unknown>) {
    this.updates += 1;
    if (this.updates === this.failUpdateOnCall) {
      return Promise.reject(new Error("db connection reset"));
    }
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
    return Promise.resolve();
  }
  claimProviderDelete(id: string, nowIso: string) {
    this.claims += 1;
    const r = this.rows.find((x) => x.id === id);
    if (
      !r || r.provider_deleted_at !== null ||
      r.provider_state !== "refused_token"
    ) {
      return Promise.resolve(false);
    }
    r.repair_state = "provider_deleted";
    r.provider_deleted_at = nowIso;
    return Promise.resolve(true);
  }
  deleteRows(ids: string[]) {
    this.rows = this.rows.filter((r) => !ids.includes(r.id ?? ""));
    return Promise.resolve();
  }
  allRows() {
    return Promise.resolve(this.rows.map((r) => ({ ...r })));
  }
  displayNames(ids: string[]) {
    return Promise.resolve(
      new Map([...this.names].filter(([k]) => ids.includes(k))),
    );
  }
  readState() {
    return Promise.resolve({ ...this.state });
  }
  writeState(p: Partial<ReconcileState>) {
    this.state = { ...this.state, ...p };
    return Promise.resolve();
  }
  /** Mirrors report_host_push_device (proven in the pg17 suites). */
  report(subId: string, at: number): "reregister" | "none" {
    const r = this.rows.find((x) => x.provider_subscription_id === subId);
    if (!r) return "none";
    r.last_reported_at = new Date(at).toISOString();
    r.last_report_reason = "foreground";
    if (r.repair_state === "requested") {
      r.repair_state = "none";
      r.repair_requests = Math.min(r.repair_requests + 1, 3);
      return "reregister";
    }
    return "none";
  }
}

type Reply = {
  status: number;
  body?: unknown;
  retryAfter?: string | null;
  jsonThrows?: boolean;
};

function seed(
  user: string,
  sub: string,
  extra: Partial<DeviceRow> = {},
): DeviceRow {
  return {
    id: `seed-${sub}`,
    user_id: user,
    provider_subscription_id: sub,
    platform: "ios",
    device_permission: "granted",
    last_reported_at: new Date(T0 - HOUR).toISOString(),
    last_report_reason: "launch",
    provider_state: "subscribed",
    provider_status_code: 1,
    provider_environment: 0,
    provider_checked_at: new Date(T0 - DAY).toISOString(),
    repair_state: "none",
    repair_requests: 0,
    repair_window_started_at: null,
    provider_deleted_at: null,
    created_at: new Date(T0 - 2 * DAY).toISOString(),
    ...extra,
  };
}

function rig(reply: (user: string, method: string) => Reply) {
  const clock = { t: T0 };
  const store = new Store();
  const calls: Array<
    { method: string; url: string; at: number; auth: string }
  > = [];
  const logs: string[] = [];
  const mails: Array<
    { subject: string; paragraphs: string[]; recipients: string[] }
  > = [];
  const deps = (over: Partial<ReconcileDeps> = {}): ReconcileDeps => ({
    store,
    credentials: { appId: "app-4549", restKey: REST_KEY },
    fetch: (url, init) => {
      calls.push({
        method: init.method,
        url,
        at: clock.t,
        auth: init.headers.Authorization,
      });
      const user = decodeURIComponent(url.split("/external_id/")[1] ?? "");
      const r = reply(user, init.method);
      return Promise.resolve({
        status: r.status,
        headers: {
          get: (n: string) =>
            n.toLowerCase() === "retry-after" ? (r.retryAfter ?? null) : null,
        },
        json: () =>
          r.jsonThrows
            ? Promise.reject(new SyntaxError("Unexpected token <"))
            : Promise.resolve(r.body),
      });
    },
    now: () => clock.t,
    sleep: (ms) => {
      clock.t += ms;
      return Promise.resolve();
    },
    sendAlert: (m) => {
      mails.push(m);
      return Promise.resolve({ succeeded: 1, attempted: 1 });
    },
    recipients: () => ["ops-existing@example.test"],
    log: (l) => logs.push(l),
    ...over,
  });
  return { clock, store, calls, logs, mails, deps };
}

async function captureConsole<T>(
  fn: () => Promise<T>,
): Promise<{ out: T; lines: string[] }> {
  const lines: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  const grab = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  console.log = grab;
  console.error = grab;
  console.warn = grab;
  try {
    return { out: await fn(), lines };
  } finally {
    Object.assign(console, orig);
  }
}

const refusedSub = (id: string) => ({
  id,
  type: "iOSPush",
  notification_types: -16,
  test_type: 0,
  token: "tok-" + id,
});

// ---------------------------------------------------------------------------

Deno.test("#4549 tester: the delete path is unreachable while the switch is off, whatever the switch is fed", async () => {
  assertEquals(PROVIDER_DELETE_ENABLED, false);
  for (const fed of [undefined, false, "true", 1, {}, [true], "yes"]) {
    const t = rig(() => ({
      status: 200,
      body: { subscriptions: [refusedSub("sub-del")] },
    }));
    t.store.users = [UID(1)];
    // Every other delete condition holds: refused for 2 days, asked, reported since.
    t.store.rows = [seed(UID(1), "sub-del", {
      provider_state: "refused_token",
      provider_status_code: -16,
      repair_state: "none",
      repair_requests: 1,
      repair_window_started_at: new Date(T0 - 2 * DAY).toISOString(),
      last_reported_at: new Date(T0 - HOUR).toISOString(),
    })];
    // deno-lint-ignore no-explicit-any
    await runHostPushReconcile(t.deps({ deleteEnabled: fed as any }));
    assertEquals(
      t.calls.filter((c) => c.method === "DELETE").length,
      0,
      `fed ${JSON.stringify(fed)}`,
    );
    assertEquals(t.store.claims, 0, `no claim when fed ${JSON.stringify(fed)}`);
    assertEquals(t.store.rows[0].provider_deleted_at, null);
  }
  // Positive control: the same row with the switch truly on is deleted once.
  const on = rig(() => ({
    status: 200,
    body: { subscriptions: [refusedSub("sub-del")] },
  }));
  on.store.users = [UID(1)];
  on.store.rows = [seed(UID(1), "sub-del", {
    provider_state: "refused_token",
    repair_requests: 1,
    repair_window_started_at: new Date(T0 - 2 * DAY).toISOString(),
  })];
  await runHostPushReconcile(on.deps({ deleteEnabled: true }));
  assertEquals(on.calls.filter((c) => c.method === "DELETE").length, 1);
});

Deno.test("#4549 tester: index.ts never reads the request body and passes only the off constant", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  for (
    const reader of [
      "req.json(",
      "req.text(",
      "req.formData(",
      "req.arrayBuffer(",
      "req.body",
      "new URL(req.url",
    ]
  ) {
    assert(!src.includes(reader), `index.ts must not read ${reader}`);
  }
  assertEquals(src.match(/deleteEnabled:/g)?.length, 1);
  assert(src.includes("deleteEnabled: PROVIDER_DELETE_ENABLED"));
  assert(
    /req\.headers\.get\("authorization"\) !== `Bearer \$\{serviceKey\}`/.test(
      src,
    ),
  );
  assert(
    src.includes("!serviceKey ||"),
    "an unset service key must refuse, not compare to 'Bearer undefined'",
  );
});

Deno.test("#4549 tester: no provider failure ever marks a device refused or changes a row", async () => {
  const failures: Array<[string, Reply]> = [
    ["500", { status: 500, body: { errors: ["x"] } }],
    ["502", { status: 502 }],
    ["503 + Retry-After", { status: 503, retryAfter: "30" }],
    ["400", { status: 400, body: { errors: ["bad"] } }],
    ["418 unknown code", { status: 418 }],
    ["301", { status: 301 }],
    ["200 html body", { status: 200, jsonThrows: true }],
    ["200 null", { status: 200, body: null }],
    ["200 array", { status: 200, body: [] }],
    ["200 no subscriptions", { status: 200, body: { identity: {} } }],
    ["200 subscriptions object", {
      status: 200,
      body: { subscriptions: { a: 1 } },
    }],
    ["401", { status: 401 }],
    ["403", { status: 403 }],
    ["429 no Retry-After", { status: 429 }],
  ];
  for (const [label, reply] of failures) {
    const t = rig(() => reply);
    t.store.users = [UID(1), UID(2)];
    t.store.rows = [
      seed(UID(1), "s1"),
      seed(UID(2), "s2", {
        provider_state: "never_prompted",
        provider_status_code: -18,
      }),
    ];
    const before = JSON.stringify(t.store.rows);
    const { out, lines } = await captureConsole(() =>
      runHostPushReconcile(t.deps())
    );
    assertEquals(
      JSON.stringify(t.store.rows),
      before,
      `${label}: rows unchanged`,
    );
    assertEquals(
      out.rows_updated + out.rows_inserted + out.repairs_requested,
      0,
      label,
    );
    assert(out.skipped_users >= 1, `${label}: the skip is counted`);
    const run = t.logs.find((l) => l.includes("host_push_reconcile_run"));
    assert(
      run && run.includes('"skipped_users"'),
      `${label}: one run line with the skip count`,
    );
    if (["401", "403", "429 no Retry-After"].includes(label)) {
      assert(
        lines.some((l) => l.includes("host_push_reconcile_stopped")),
        `${label}: a stop is logged as an error`,
      );
      assertEquals(
        t.calls.length,
        1,
        `${label}: the run stops after the first refusal`,
      );
    }
  }
});

Deno.test("#4549 tester: Retry-After in every shape is bounded; the next run inside the back-off makes no call", async () => {
  const cases: Array<[string | null, number]> = [
    [null, 60],
    ["", 60],
    ["0", 60],
    ["-5", 60],
    ["abc", 60],
    ["Wed, 21 Oct 2026 07:28:00 GMT", 60],
    ["1.2", 2],
    ["120", 120],
    ["99999999999", 24 * 3600],
  ];
  for (const [header, expected] of cases) {
    const t = rig(() => ({ status: 429, retryAfter: header }));
    t.store.users = [UID(1), UID(2), UID(3)];
    const first = await captureConsole(() => runHostPushReconcile(t.deps()));
    assertEquals(first.out.stopped, "rate_limited");
    assertEquals(t.calls.length, 1, `header ${header}: stop immediately`);
    assertEquals(
      Date.parse(t.store.state.provider_backoff_until!) - T0,
      expected * 1000,
      `header ${header}`,
    );
    t.clock.t += expected * 1000 - 1;
    const second = await captureConsole(() => runHostPushReconcile(t.deps()));
    assertEquals(second.out.stopped, "backoff");
    assertEquals(
      t.calls.length,
      1,
      `header ${header}: no call inside the back-off`,
    );
  }
});

Deno.test("#4549 tester: a huge candidate list still means at most 40 calls, at least 1 s apart", async () => {
  const t = rig(() => ({ status: 200, body: { subscriptions: [] } }));
  t.store.users = Array.from({ length: 5000 }, (_, i) => UID(i + 1));
  // The store hands back more than asked: the run must still cap itself.
  t.store.candidates = () => Promise.resolve(t.store.users);
  await runHostPushReconcile(t.deps());
  assertEquals(t.calls.length, MAX_USERS_PER_RUN);
  for (let i = 1; i < t.calls.length; i++) {
    assert(t.calls[i].at - t.calls[i - 1].at >= 1000, `gap ${i}`);
  }
});

Deno.test("#4549 tester: ten days of runs with a real report between each: 3 requests, then gave_up, then silence", async () => {
  const t = rig(() => ({
    status: 200,
    body: { subscriptions: [refusedSub("ref-1")] },
  }));
  t.store.users = [UID(7)];
  t.store.rows = [
    seed(UID(7), "ref-1", {
      provider_state: "unknown",
      provider_status_code: null,
    }),
  ];
  let reregisters = 0;
  const states: string[] = [];
  for (let run = 0; run < 480; run++) { // every 30 minutes for 10 days
    await runHostPushReconcile(t.deps());
    if (t.store.report("ref-1", t.clock.t + 1) === "reregister") {
      reregisters += 1;
    }
    states.push(t.store.rows[0].repair_state);
    t.clock.t += 30 * 60_000;
  }
  assertEquals(reregisters, 3, "at most 3 repairs handed to the app");
  assertEquals(t.store.rows[0].repair_state, "gave_up");
  const firstGaveUp = states.indexOf("gave_up");
  assert(
    firstGaveUp > 0 && states.slice(firstGaveUp).every((s) => s === "gave_up"),
    "gave_up is terminal",
  );
  assertEquals(t.calls.filter((c) => c.method === "DELETE").length, 0);
});

Deno.test("#4549 tester: a crash between writes, then a rerun, ends where one clean run ends", async () => {
  const provider = (u: string) => ({
    status: 200,
    body: {
      subscriptions: [
        u === UID(2)
          ? refusedSub("b1")
          : { id: `${u}-new`, type: "iOSPush", notification_types: 1 },
      ],
    },
  });
  const make = () => {
    const t = rig(provider);
    t.store.users = [UID(1), UID(2), UID(3)];
    t.store.rows = [
      seed(UID(1), "a1"),
      seed(UID(2), "b1", { provider_state: "unknown" }),
      seed(UID(3), "c1"),
    ];
    return t;
  };
  const clean = make();
  await runHostPushReconcile(clean.deps());
  const crashed = make();
  crashed.store.failUpdateOnCall = 3; // dies part-way through the second account
  let threw = false;
  try {
    await runHostPushReconcile(crashed.deps());
  } catch {
    threw = true;
  }
  assert(
    threw,
    "a store failure surfaces (index.ts turns it into a logged 500)",
  );
  crashed.store.failUpdateOnCall = -1;
  await runHostPushReconcile(crashed.deps());
  const strip = (rows: DeviceRow[]) =>
    rows.map((r) => ({
      ...r,
      id: null,
      created_at: null,
      provider_checked_at: null, // run timestamps differ by design
      last_reported_at: null,
      repair_window_started_at: r.repair_window_started_at === null
        ? null
        : "set",
      updated_at: undefined,
    }))
      .sort((a, b) =>
        a.provider_subscription_id.localeCompare(b.provider_subscription_id)
      );
  assertEquals(strip(crashed.store.rows), strip(clean.store.rows));
  assertEquals(
    crashed.store.rows.filter((r) => r.repair_state === "requested").length,
    1,
    "the rerun does not double-queue the repair",
  );
});

Deno.test("#4549 tester: no log line or alert carries a key, token, subscription id, email or user id; recipients are the existing ones only", async () => {
  const t = rig((u) => ({
    status: 200,
    body: {
      identity: { external_id: u },
      subscriptions: [refusedSub(`sub-of-${u}`)],
    },
  }));
  const users = [UID(11), UID(12)];
  t.store.users = users;
  t.store.rows = users.map((u) =>
    seed(u, `sub-of-${u}`, { provider_state: "unknown" })
  );
  t.store.names.set(UID(11), "Lagos Live");
  const { lines } = await captureConsole(() => runHostPushReconcile(t.deps()));
  assertEquals(t.mails.length, 1);
  const everything = [
    ...t.logs,
    ...lines,
    ...t.mails.flatMap((m) => [m.subject, ...m.paragraphs]),
  ].join("\n");
  for (
    const secret of [
      REST_KEY,
      "tok-",
      "sub-of-",
      ...users,
      "@example.test",
      "app-4549",
    ]
  ) {
    assert(!everything.includes(secret), `leaked ${secret}`);
  }
  assertEquals(t.mails[0].recipients, ["ops-existing@example.test"]);
  assert(
    t.calls.every((c) => c.auth === `Key ${REST_KEY}`),
    "the key travels only in the provider header",
  );
  assert(
    t.calls.every((c) =>
      c.url.startsWith(
        "https://api.onesignal.com/apps/app-4549/users/by/external_id/",
      )
    ),
  );
});

Deno.test("#4549 tester: an unchanged alert set mails once in 6 hours across twelve runs", async () => {
  const t = rig(() => ({
    status: 200,
    body: { subscriptions: [refusedSub("r1")] },
  }));
  t.store.users = [UID(21)];
  t.store.rows = [seed(UID(21), "r1", { provider_state: "unknown" })];
  for (let i = 0; i < 12; i++) {
    await runHostPushReconcile(t.deps());
    t.clock.t += 30 * 60_000;
  }
  assertEquals(t.mails.length, 1);
  // A failed send is retried next run, but never more than once per run.
  const f = rig(() => ({
    status: 200,
    body: { subscriptions: [refusedSub("r1")] },
  }));
  f.store.users = [UID(21)];
  f.store.rows = [seed(UID(21), "r1", { provider_state: "unknown" })];
  let attempts = 0;
  for (let i = 0; i < 4; i++) {
    await captureConsole(() =>
      runHostPushReconcile(f.deps({
        sendAlert: () => {
          attempts += 1;
          return Promise.resolve({ succeeded: 0, attempted: 1 });
        },
      }))
    );
  }
  assertEquals(attempts, 4);
});
