// MINGLA-INVARIANT: I-4549-HOST-PUSH-NO-SILENT-REGISTRATION | issue #4549 | every Host app push setup step either succeeds, is retried with a bound, or is reported to the server and to Sentry; the server checks the provider for every Host device reported or pushed to in the last day at least every 24 h, never retries a refused device forever, and emails ops about unreachable Host accounts (server half here; app half in mingla-business pushRegistrationHealth tests).
//
// #4549 host-push-reconcile: logic and run loop against an in-memory store and
// a fake provider. No network, no keys.

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  classifyDeleteResponse,
  classifyViewResponse,
  type DeviceRow,
  mapProviderState,
  MAX_REPAIR_REQUESTS,
} from "../logic.ts";
import {
  PROVIDER_DELETE_ENABLED,
  type ReconcileState,
  type ReconcileStore,
  runHostPushReconcile,
} from "../run.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-22T00:00:00.000Z");

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
class FakeStore implements ReconcileStore {
  rows: DeviceRow[] = [];
  state: ReconcileState = {
    last_alert_fingerprint: null,
    last_alert_at: null,
    provider_backoff_until: null,
  };
  users: string[] = [];
  names = new Map<string, string>();
  private seq = 0;

  candidates(limit: number): Promise<string[]> {
    return Promise.resolve(this.users.slice(0, limit));
  }
  rowsForUser(userId: string): Promise<DeviceRow[]> {
    return Promise.resolve(
      this.rows.filter((r) => r.user_id === userId).map((r) => ({ ...r })),
    );
  }
  insertRow(row: DeviceRow): Promise<void> {
    this.rows.push({ ...row, id: `row-${++this.seq}` });
    return Promise.resolve();
  }
  updateRow(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
    return Promise.resolve();
  }
  claimProviderDelete(id: string, nowIso: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id);
    if (
      !row || row.provider_deleted_at !== null ||
      row.provider_state !== "refused_token"
    ) {
      return Promise.resolve(false);
    }
    row.repair_state = "provider_deleted";
    row.provider_deleted_at = nowIso;
    return Promise.resolve(true);
  }
  deleteRows(ids: string[]): Promise<void> {
    this.rows = this.rows.filter((r) => !ids.includes(r.id ?? ""));
    return Promise.resolve();
  }
  allRows(): Promise<DeviceRow[]> {
    return Promise.resolve(this.rows.map((r) => ({ ...r })));
  }
  displayNames(userIds: string[]): Promise<Map<string, string>> {
    return Promise.resolve(
      new Map([...this.names].filter(([k]) => userIds.includes(k))),
    );
  }
  readState(): Promise<ReconcileState> {
    return Promise.resolve({ ...this.state });
  }
  writeState(patch: Partial<ReconcileState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    return Promise.resolve();
  }
  /** What report_host_push_device does to a row (the SQL is tested in pg17). */
  appReports(subId: string, at: number): string {
    const row = this.rows.find((r) => r.provider_subscription_id === subId);
    if (!row) return "none";
    row.last_reported_at = new Date(at).toISOString();
    row.last_report_reason = "launch";
    if (row.repair_state === "requested") {
      row.repair_state = "none";
      row.repair_requests = Math.min(row.repair_requests + 1, 3);
      return "reregister";
    }
    return "none";
  }
}

type Sub = {
  id: string;
  type: string;
  notification_types: number;
  test_type?: number;
};

class FakeProvider {
  calls: Array<{ method: string; url: string; at: number }> = [];
  subsByUser = new Map<string, Sub[]>();
  status = new Map<string, number>(); // per user id override
  throwFor = new Set<string>();
  deleteStatus = 202;
  constructor(private clock: { t: number }) {}
  fetch = (url: string, init: { method: string }) => {
    this.calls.push({ method: init.method, url, at: this.clock.t });
    const user = decodeURIComponent(url.split("/external_id/")[1] ?? "");
    if (init.method === "DELETE") {
      return Promise.resolve(response(this.deleteStatus, {}, null));
    }
    if (this.throwFor.has(user)) {
      return Promise.reject(new TypeError("network down"));
    }
    const status = this.status.get(user) ?? 200;
    if (status === 429) {
      return Promise.resolve(
        response(429, { errors: ["API rate limit exceeded."] }, "120"),
      );
    }
    return Promise.resolve(
      response(
        status,
        { subscriptions: this.subsByUser.get(user) ?? [] },
        null,
      ),
    );
  };
}

function response(status: number, body: unknown, retryAfter: string | null) {
  return {
    status,
    headers: {
      get: (
        n: string,
      ) => (n.toLowerCase() === "retry-after" ? retryAfter : null),
    },
    json: () => Promise.resolve(body),
  };
}

function row(
  partial: Partial<DeviceRow> & {
    provider_subscription_id: string;
    user_id: string;
  },
): DeviceRow {
  return {
    id: `seed-${partial.provider_subscription_id}`,
    platform: "ios",
    device_permission: "granted",
    last_reported_at: new Date(T0 - HOUR).toISOString(),
    last_report_reason: "launch",
    provider_state: "unknown",
    provider_status_code: null,
    provider_environment: null,
    provider_checked_at: null,
    repair_state: "none",
    repair_requests: 0,
    repair_window_started_at: null,
    provider_deleted_at: null,
    created_at: new Date(T0 - DAY).toISOString(),
    ...partial,
  };
}

function harness(opts: { deleteEnabled?: boolean } = {}) {
  const clock = { t: T0 };
  const store = new FakeStore();
  const provider = new FakeProvider(clock);
  const sent: Array<
    { subject: string; paragraphs: string[]; recipients: string[] }
  > = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const run = () =>
    runHostPushReconcile({
      store,
      credentials: { appId: "app", restKey: "fake-key" },
      fetch: provider.fetch,
      now: () => clock.t,
      sleep: (ms) => {
        sleeps.push(ms);
        clock.t += ms;
        return Promise.resolve();
      },
      sendAlert: (input) => {
        sent.push(input);
        return Promise.resolve({ succeeded: 1, attempted: 1 });
      },
      recipients: () => ["ops@example.test"],
      hash: (text) => Promise.resolve(`h:${text.length}:${text}`),
      deleteEnabled: opts.deleteEnabled,
      log: (line) => logs.push(line),
    });
  return { clock, store, provider, sent, sleeps, logs, run };
}

// ---------------------------------------------------------------------------
// Logic: the documented code table
// ---------------------------------------------------------------------------
Deno.test("#4549 map: positive codes are subscribed; APNs errors are refused_token", () => {
  assertEquals(mapProviderState(1, "granted"), "subscribed");
  assertEquals(mapProviderState(15, null), "subscribed");
  for (const code of [-14, -16, -17, -30]) {
    assertEquals(mapProviderState(code, "granted"), "refused_token");
  }
});

Deno.test("#4549 map: Android and capability errors are refused_config; opt-outs unsubscribed", () => {
  for (
    const code of [
      -3,
      -4,
      -5,
      -6,
      -7,
      -8,
      -9,
      -11,
      -12,
      -13,
      -15,
      -29,
      -32,
      -33,
      -34,
    ]
  ) {
    assertEquals(
      mapProviderState(code, "granted"),
      "refused_config",
      `code ${code}`,
    );
  }
  for (const code of [-2, -10, -22, -31]) {
    assertEquals(mapProviderState(code, "granted"), "unsubscribed");
  }
  assertEquals(mapProviderState(-18, null), "never_prompted");
  assertEquals(mapProviderState(0, "denied"), "permission_off");
  assertEquals(mapProviderState(-99, "not_determined"), "never_prompted");
});

Deno.test("#4549 map adversarial: a code the docs do not settle is unknown, never a refusal", () => {
  for (const code of [-1, -20, -21, -23, -25, -50, -98, -1000]) {
    assertEquals(mapProviderState(code, "granted"), "unknown", `code ${code}`);
  }
  assertEquals(mapProviderState(null, "granted"), "unknown");
  assertEquals(mapProviderState(Number.NaN, "granted"), "unknown");
});

Deno.test("#4549 view response: only iOS and Android push records; errors classified", () => {
  const ok = classifyViewResponse(200, {
    subscriptions: [
      { id: "a", type: "iOSPush", notification_types: 1, test_type: 1 },
      { id: "b", type: "Email", notification_types: 1 },
      { id: "c", type: "AndroidPush", notification_types: -6 },
    ],
  }, null);
  assertEquals(ok.kind, "ok");
  if (ok.kind === "ok") {
    assertEquals(ok.subscriptions.map((s) => s.id), ["a", "c"]);
  }
  assertEquals(classifyViewResponse(404, null, null).kind, "not_found");
  assertEquals(classifyViewResponse(429, null, "7"), {
    kind: "rate_limited",
    retryAfterSeconds: 7,
  });
  assertEquals(classifyViewResponse(401, null, null).kind, "auth_error");
  assertEquals(classifyViewResponse(503, null, null).kind, "unavailable");
  assertEquals(
    classifyViewResponse(200, { nope: 1 }, null).kind,
    "unavailable",
  );
  assertEquals(classifyDeleteResponse(202, null).kind, "deleted");
  assertEquals(classifyDeleteResponse(404, null).kind, "deleted");
  assertEquals(classifyDeleteResponse(500, null).kind, "failed");
});

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------
Deno.test("#4549 run happy: subscribed records map to subscribed; an unreported record is inserted", async () => {
  const h = harness();
  h.store.users = ["u1"];
  h.store.rows = [row({ user_id: "u1", provider_subscription_id: "s1" })];
  h.provider.subsByUser.set("u1", [
    { id: "s1", type: "iOSPush", notification_types: 1, test_type: 0 },
    { id: "s2", type: "AndroidPush", notification_types: 1 },
  ]);
  const summary = await h.run();
  assertEquals(summary.users_checked, 1);
  assertEquals(summary.rows_inserted, 1);
  const s1 = h.store.rows.find((r) => r.provider_subscription_id === "s1");
  const s2 = h.store.rows.find((r) => r.provider_subscription_id === "s2");
  assertEquals(s1?.provider_state, "subscribed");
  assertEquals(s1?.provider_environment, 0);
  assertEquals(s2?.provider_state, "subscribed");
  assertEquals(s2?.platform, "android");
  assertEquals(s2?.last_report_reason, null);
  assertEquals(h.sent.length, 0, "nothing to alert on");
  assert(h.logs.some((l) => l.includes('"event":"host_push_reconcile_run"')));
  assert(
    !h.logs.some((l) => l.includes("u1")),
    "the run log carries counts only, no account ids",
  );
});

Deno.test("#4549 run: an APNs-refused record becomes refused_token with repair requested", async () => {
  const h = harness();
  h.store.users = ["u1"];
  h.store.rows = [row({ user_id: "u1", provider_subscription_id: "s1" })];
  h.provider.subsByUser.set("u1", [{
    id: "s1",
    type: "iOSPush",
    notification_types: -16,
  }]);
  const summary = await h.run();
  const s1 = h.store.rows[0];
  assertEquals(s1.provider_state, "refused_token");
  assertEquals(s1.repair_state, "requested");
  assertEquals(summary.repairs_requested, 1);
  assertEquals(h.store.appReports("s1", h.clock.t + 1000), "reregister");
  assertEquals(h.store.appReports("s1", h.clock.t + 2000), "none");
});

async function tenRuns(deleteEnabled: boolean) {
  const h = harness({ deleteEnabled });
  h.store.users = ["u1"];
  h.store.rows = [
    row({ user_id: "u1", provider_subscription_id: "bad" }),
    row({
      user_id: "u1",
      provider_subscription_id: "good",
      platform: "android",
    }),
  ];
  h.provider.subsByUser.set("u1", [
    { id: "bad", type: "iOSPush", notification_types: -14 },
    { id: "good", type: "AndroidPush", notification_types: 1 },
  ]);
  const handed: string[] = [];
  for (let i = 0; i < 10; i++) {
    await h.run();
    // The app opens between runs and reports.
    handed.push(h.store.appReports("bad", h.clock.t + 60_000));
    h.store.appReports("good", h.clock.t + 60_000);
    h.clock.t += 20 * HOUR; // ten runs span 8+ days
  }
  return { h, handed };
}

Deno.test("#4549 never retried forever (switch off): at most 3 requests, zero deletes, then gave_up", async () => {
  const { h, handed } = await tenRuns(false);
  const bad = h.store.rows.find((r) => r.provider_subscription_id === "bad");
  assertEquals(
    handed.filter((a) => a === "reregister").length,
    MAX_REPAIR_REQUESTS,
  );
  assertEquals(h.provider.calls.filter((c) => c.method === "DELETE").length, 0);
  assertEquals(bad?.repair_state, "gave_up");
  assertEquals(bad?.repair_requests, 3);
});

Deno.test("#4549 never retried forever (switch on): exactly one delete, only for the refused record", async () => {
  const { h } = await tenRuns(true);
  const deletes = h.provider.calls.filter((c) => c.method === "DELETE");
  assertEquals(deletes.length, 1);
  assertStringIncludes(deletes[0].url, "/subscriptions/bad");
  assert(
    !deletes.some((d) => d.url.includes("/subscriptions/good")),
    "a subscribed record is never deleted",
  );
  const bad = h.store.rows.find((r) => r.provider_subscription_id === "bad");
  assert(
    bad?.repair_state === "provider_deleted" || bad?.repair_state === "gave_up",
  );
  assert((bad?.repair_requests ?? 0) <= 3);
});

Deno.test("#4549 delete waits 24 h and a report after the first request", async () => {
  const h = harness({ deleteEnabled: true });
  h.store.users = ["u1"];
  h.store.rows = [row({ user_id: "u1", provider_subscription_id: "bad" })];
  h.provider.subsByUser.set("u1", [{
    id: "bad",
    type: "iOSPush",
    notification_types: -17,
  }]);
  await h.run();
  h.clock.t += 25 * HOUR; // no report since the request
  await h.run();
  assertEquals(h.provider.calls.filter((c) => c.method === "DELETE").length, 0);
  h.store.appReports("bad", h.clock.t + 1000);
  h.clock.t += HOUR;
  await h.run();
  assertEquals(h.provider.calls.filter((c) => c.method === "DELETE").length, 1);
  assertEquals(h.store.rows[0].repair_state, "provider_deleted");
});

Deno.test("#4549 a replacement record after a delete marks the old one repaired", async () => {
  const h = harness();
  h.store.users = ["u1"];
  h.store.rows = [row({
    user_id: "u1",
    provider_subscription_id: "old",
    provider_state: "refused_token",
    repair_state: "provider_deleted",
    provider_deleted_at: new Date(T0 - HOUR).toISOString(),
    repair_window_started_at: new Date(T0 - 2 * DAY).toISOString(),
  })];
  h.provider.subsByUser.set("u1", [{
    id: "new",
    type: "iOSPush",
    notification_types: 1,
  }]);
  await h.run();
  assertEquals(
    h.store.rows.find((r) => r.provider_subscription_id === "old")
      ?.repair_state,
    "repaired",
  );
  assertEquals(
    h.store.rows.find((r) => r.provider_subscription_id === "old")
      ?.provider_state,
    "missing",
  );
});

Deno.test("#4549 429 stops the run, honours Retry-After, and the next run waits", async () => {
  const h = harness();
  h.store.users = ["u1", "u2", "u3"];
  h.store.rows = [row({ user_id: "u2", provider_subscription_id: "s2" })];
  h.provider.status.set("u1", 429);
  const summary = await h.run();
  assertEquals(summary.stopped, "rate_limited");
  assertEquals(h.provider.calls.length, 1, "no call after the 429");
  assertEquals(summary.skipped_users, 3);
  assertEquals(
    h.store.state.provider_backoff_until,
    new Date(T0 + 120_000).toISOString(),
  );
  const again = await h.run();
  assertEquals(again.stopped, "backoff");
  assertEquals(h.provider.calls.length, 1, "no call while backing off");
  assertEquals(h.store.rows[0].provider_checked_at, null, "rows untouched");
});

Deno.test("#4549 transport error and outage leave rows unchanged; three in a row stop the run", async () => {
  const h = harness();
  h.store.users = ["u1", "u2", "u3", "u4"];
  h.store.rows = [
    row({
      user_id: "u1",
      provider_subscription_id: "s1",
      provider_state: "subscribed",
    }),
  ];
  const before = JSON.stringify(h.store.rows);
  h.provider.throwFor.add("u1");
  h.provider.status.set("u2", 503);
  h.provider.status.set("u3", 500);
  const summary = await h.run();
  assertEquals(JSON.stringify(h.store.rows), before);
  assertEquals(summary.stopped, "provider_unavailable");
  assertEquals(h.provider.calls.length, 3);
});

Deno.test("#4549 no credentials: no provider call at all, loud stop", async () => {
  const h = harness();
  h.store.users = ["u1"];
  const summary = await runHostPushReconcile({
    store: h.store,
    credentials: { appId: "", restKey: "" },
    fetch: h.provider.fetch,
    now: () => h.clock.t,
    sleep: () => Promise.resolve(),
    log: () => {},
  });
  assertEquals(summary.stopped, "no_credentials");
  assertEquals(h.provider.calls.length, 0);
});

Deno.test("#4549 pacing: one provider request per second, at most 40 accounts per run", async () => {
  const h = harness();
  h.store.users = Array.from({ length: 55 }, (_, i) => `u${i}`);
  const summary = await h.run();
  assertEquals(h.provider.calls.length, 40);
  assertEquals(summary.users_checked, 40);
  for (let i = 1; i < h.provider.calls.length; i++) {
    assert(
      h.provider.calls[i].at - h.provider.calls[i - 1].at >= 1000,
      `gap before call ${i}`,
    );
  }
});

Deno.test("#4549 alert: once for a new set, not again inside 6 h, again on change and after 6 h", async () => {
  const h = harness();
  h.store.users = ["u1"];
  h.store.names.set("u1", "Lagos Nights");
  h.store.rows = [row({ user_id: "u1", provider_subscription_id: "s1" })];
  h.provider.subsByUser.set("u1", [{
    id: "s1",
    type: "iOSPush",
    notification_types: -10,
  }]);
  await h.run();
  assertEquals(h.sent.length, 1);
  assertStringIncludes(h.sent[0].paragraphs.join(" "), "Lagos Nights");
  assertEquals(h.sent[0].recipients, ["ops@example.test"]);
  h.clock.t += 2 * HOUR;
  await h.run();
  assertEquals(h.sent.length, 1, "same set inside 6 h: no second email");
  h.provider.subsByUser.set("u1", [{
    id: "s1",
    type: "iOSPush",
    notification_types: -14,
  }]);
  await h.run();
  assertEquals(h.sent.length, 2, "the set changed: a new email");
  h.clock.t += 7 * HOUR;
  await h.run();
  assertEquals(h.sent.length, 3, "same set after 6 h: reminded");
});

Deno.test("#4549 alert adversarial: a failed send is not recorded, so the next run tries again", async () => {
  const h = harness();
  h.store.users = ["u1"];
  h.store.rows = [row({ user_id: "u1", provider_subscription_id: "s1" })];
  h.provider.subsByUser.set("u1", [{
    id: "s1",
    type: "iOSPush",
    notification_types: -10,
  }]);
  const summary = await runHostPushReconcile({
    store: h.store,
    credentials: { appId: "app", restKey: "k" },
    fetch: h.provider.fetch,
    now: () => h.clock.t,
    sleep: () => Promise.resolve(),
    sendAlert: () => Promise.resolve({ succeeded: 0, attempted: 1 }),
    recipients: () => ["ops@example.test"],
    log: () => {},
  });
  assertEquals(summary.alert, "send_failed");
  assertEquals(h.store.state.last_alert_at, null);
});

// ---------------------------------------------------------------------------
// Wiring (index.ts calls serve() at module scope, so it is read as source)
// ---------------------------------------------------------------------------
const INDEX = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const RUN = await Deno.readTextFile(new URL("../run.ts", import.meta.url));

Deno.test("#4549 wiring: service-role only, body never read, delete switch is the off constant", () => {
  assert(INDEX.length > 2_000, "a short read would make every check vacuous");
  assertMatch(
    INDEX,
    /req\.headers\.get\("authorization"\) !== `Bearer \$\{serviceKey\}`/,
  );
  assertStringIncludes(INDEX, 'jsonResponse({ error: "forbidden" }, 403)');
  assert(
    !/req\.(json|text|formData|arrayBuffer)\(/.test(INDEX),
    "nothing a caller sends steers a run",
  );
  assertStringIncludes(INDEX, "deleteEnabled: PROVIDER_DELETE_ENABLED");
  assertEquals(PROVIDER_DELETE_ENABLED, false);
  assertMatch(RUN, /export const PROVIDER_DELETE_ENABLED = false;/);
  assertMatch(RUN, /const deleteEnabled = deps\.deleteEnabled === true;/);
});

Deno.test("#4549 wiring: existing provider key and ops recipient names, no new secret", () => {
  assertStringIncludes(INDEX, 'resolveAppCredentials("business")');
  assertStringIncludes(INDEX, "apiHealthAlertRecipients");
  assertStringIncludes(INDEX, "sendOpsAlertEmail");
  assert(
    !/Deno\.env\.get\("(?!SUPABASE_SERVICE_ROLE_KEY")/.test(INDEX + RUN),
    "no other env read",
  );
});
