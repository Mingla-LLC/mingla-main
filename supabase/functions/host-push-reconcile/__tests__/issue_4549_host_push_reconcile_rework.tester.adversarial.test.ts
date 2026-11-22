// #4549 retest (tester, adversarial, Deno 1.46): the rework fixes from angles
// the implementor suite does not take. Alert volume over a 6-hour churn and a
// 3-day persistent condition through the real run; the "materially worsens"
// boundaries just under and at the threshold for several baselines; mixed
// answered/unanswered accounts; a given-up device that turns healthy; a stalled
// body next to a healthy account; an answer about another account; delete
// retries capped at 3 whatever the failure shape. No network, no keys.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  advanceRepair,
  ALERT_REMINDER_MS,
  computeAlertSet,
  decideAlert,
  type DeviceRow,
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
const T0 = Date.parse("2026-12-01T00:00:00.000Z");
const UID = (n: number) =>
  `45495555-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (t: number) => new Date(t).toISOString();

function row(
  user: string,
  sub: string,
  extra: Partial<DeviceRow> = {},
): DeviceRow {
  return {
    id: `id-${sub}`,
    user_id: user,
    provider_subscription_id: sub,
    platform: "ios",
    device_permission: "granted",
    last_reported_at: iso(T0 - HOUR),
    last_report_reason: "launch",
    provider_state: "subscribed",
    provider_status_code: 1,
    provider_environment: 0,
    provider_checked_at: iso(T0 - HOUR),
    repair_state: "none",
    repair_requests: 0,
    repair_window_started_at: null,
    provider_deleted_at: null,
    created_at: iso(T0 - 2 * DAY),
    ...extra,
  };
}

/** In-memory store; claim/release mirror host_push_claim_provider_delete and index.ts. */
class Store implements ReconcileStore {
  rows: DeviceRow[] = [];
  attempts = new Map<string, number>();
  state: ReconcileState = {
    last_alert_fingerprint: null,
    last_alert_at: null,
    provider_backoff_until: null,
  };
  candidates() {
    return Promise.resolve([...new Set(this.rows.map((r) => r.user_id))]);
  }
  rowsForUser(u: string) {
    return Promise.resolve(
      this.rows.filter((r) => r.user_id === u).map((r) => ({ ...r })),
    );
  }
  insertRow(r: DeviceRow) {
    this.rows.push({ ...r, id: r.id ?? `new-${this.rows.length}` });
    return Promise.resolve();
  }
  updateRow(id: string, patch: Record<string, unknown>) {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
    return Promise.resolve();
  }
  claimProviderDelete(id: string, nowIso: string) {
    const r = this.rows.find((x) => x.id === id);
    const n = this.attempts.get(id) ?? 0;
    if (
      !r || r.provider_state !== "refused_token" ||
      r.repair_state === "provider_deleted" || r.repair_state === "gave_up" ||
      n >= 3
    ) return Promise.resolve(false);
    r.repair_state = "provider_deleted";
    r.provider_deleted_at = nowIso;
    this.attempts.set(id, n + 1);
    return Promise.resolve(true);
  }
  releaseProviderDelete(id: string) {
    const r = this.rows.find((x) => x.id === id);
    if (r && r.repair_state === "provider_deleted") {
      r.repair_state = "none";
      r.provider_deleted_at = null;
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
  writeState(p: Partial<ReconcileState>) {
    this.state = { ...this.state, ...p };
    return Promise.resolve();
  }
}

type Answer = (user: string, method: string, url: string) => {
  status: number;
  body?: unknown;
  stallBody?: boolean;
  throws?: boolean;
};

function rig(
  store: Store,
  answer: Answer,
  extra: { deleteEnabled?: boolean } = {},
) {
  const clock = { t: T0 };
  const emails: string[] = [];
  const calls: string[] = [];
  const run = () =>
    runHostPushReconcile({
      store,
      credentials: { appId: "app", restKey: "k" },
      now: () => clock.t,
      sleep: () => Promise.resolve(),
      requestTimeoutMs: 40,
      log: () => {},
      recipients: () => ["ops@example.invalid"],
      sendAlert: (input) => {
        emails.push(input.subject);
        return Promise.resolve({ succeeded: 1, attempted: 1 });
      },
      deleteEnabled: extra.deleteEnabled,
      fetch: (url, init) => {
        calls.push(init.method);
        const user = decodeURIComponent(url.split("/").pop() ?? "");
        const a = answer(user, init.method, url);
        if (a.throws) return Promise.reject(new TypeError("network down"));
        return Promise.resolve({
          status: a.status,
          headers: { get: () => null },
          json: () =>
            a.stallBody
              ? new Promise<unknown>(() => {})
              : Promise.resolve(a.body),
        });
      },
    });
  return { clock, emails, calls, run };
}

const viewBody = (user: string, sub: string, code: number) => ({
  identity: { external_id: user },
  subscriptions: [{ id: sub, type: "iOSPush", notification_types: code }],
});

Deno.test("R-ALERT-6H 12 unreachable accounts aging out one by one over 6 hours: exactly 1 email", async () => {
  const store = new Store();
  for (let i = 0; i < 12; i++) {
    // Each account last reported so it leaves the 7-day window 30 min after the previous one.
    store.rows.push(row(UID(i), `s${i}`, {
      provider_state: "unsubscribed",
      provider_status_code: -10,
      last_reported_at: iso(T0 - 7 * DAY + (i + 1) * 30 * MIN - MIN),
    }));
  }
  const r = rig(
    store,
    (u) => ({ status: 200, body: viewBody(u, `s${Number(u.slice(-2))}`, -10) }),
  );
  for (let k = 0; k < 12; k++) {
    await r.run();
    r.clock.t += 30 * MIN;
  }
  assertEquals(r.emails.length, 1);
});

Deno.test("R-ALERT-3D one refused device that never recovers, runs every 30 min for 72 h: one email a day at most", async () => {
  const store = new Store();
  store.rows.push(
    row(UID(1), "r1", {
      provider_state: "refused_token",
      provider_status_code: -14,
    }),
  );
  const r = rig(store, (u) => ({ status: 200, body: viewBody(u, "r1", -14) }));
  for (let k = 0; k <= 144; k++) {
    store.rows[0].last_reported_at = iso(r.clock.t - MIN); // the app keeps reporting
    await r.run();
    r.clock.t += 30 * MIN;
  }
  // t = 0 (start), then a reminder at 24 h, 48 h and 72 h.
  assertEquals(r.emails.length, 4);
  assertEquals(r.emails.filter((s) => s.includes("still")).length, 3);
});

Deno.test("R-ALERT-BOUNDARY materially worsens: just under the threshold is silent, at it mails", () => {
  const now = T0;
  const recent = iso(now - HOUR);
  const setWith = (refused: number) =>
    computeAlertSet(
      Array.from({ length: refused }, (_, i) =>
        row(UID(100 + i), `b${i}`, {
          provider_state: "refused_token",
          provider_checked_at: recent,
          last_reported_at: recent,
        })).concat([row(UID(999), "ok", {})]),
      now,
    );
  const state = (base: number) => ({
    last_alert_fingerprint: JSON.stringify({
      unreachable: base,
      refused: base,
      crowded: 0,
    }), // each refused account is also unreachable
    last_alert_at: iso(now - HOUR),
  });
  for (
    const [base, under, at] of [[1, 3, 4], [3, 5, 6], [10, 19, 20], [2, 4, 5]]
  ) {
    assertEquals(
      decideAlert(setWith(under), state(base), now).kind,
      "none",
      `base ${base} -> ${under}`,
    );
    const d = decideAlert(setWith(at), state(base), now);
    assertEquals(
      d.kind === "send" && d.reason,
      "worse",
      `base ${base} -> ${at}`,
    );
  }
  // Reminder boundary: one minute short of a day is silent, a day mails.
  const s = setWith(1);
  assertEquals(
    decideAlert(s, {
      ...state(1),
      last_alert_at: iso(now - ALERT_REMINDER_MS + MIN),
    }, now).kind,
    "none",
  );
  const rem = decideAlert(s, {
    ...state(1),
    last_alert_at: iso(now - ALERT_REMINDER_MS),
  }, now);
  assertEquals(rem.kind === "send" && rem.reason, "reminder");
});

Deno.test("R-ALERT-CLEAR a condition that clears and returns: one email per start, none while it persists", async () => {
  const store = new Store();
  store.rows.push(
    row(UID(1), "c1", {
      provider_state: "refused_token",
      provider_status_code: -14,
    }),
  );
  let code = -14;
  const r = rig(store, (u) => ({ status: 200, body: viewBody(u, "c1", code) }));
  const step = async () => {
    store.rows[0].last_reported_at = iso(r.clock.t - MIN);
    await r.run();
    r.clock.t += 30 * MIN;
  };
  for (let k = 0; k < 4; k++) await step(); // refused 2 h
  assertEquals(r.emails.length, 1);
  code = 1;
  for (let k = 0; k < 4; k++) await step(); // healthy 2 h: cleared, no all-clear email
  assertEquals(r.emails.length, 1);
  assertEquals(store.state.last_alert_fingerprint, null);
  code = -14;
  for (let k = 0; k < 4; k++) await step(); // it returns: a new start
  assertEquals(r.emails.length, 2);
});

Deno.test("R-ALERT-ANSWERED an account with any unanswered or stale-answer record is not called unreachable", () => {
  const now = T0;
  const fresh = iso(now - HOUR);
  const rows = [
    // answered and unsubscribed + never checked -> not unreachable
    row(UID(1), "a1", {
      provider_state: "unsubscribed",
      provider_checked_at: fresh,
    }),
    row(UID(1), "a2", { provider_state: "unknown", provider_checked_at: null }),
    // answered + `unknown` state with a check time -> not unreachable
    row(UID(2), "b1", {
      provider_state: "unsubscribed",
      provider_checked_at: fresh,
    }),
    row(UID(2), "b2", {
      provider_state: "unknown",
      provider_checked_at: fresh,
    }),
    // answered + an answer 27 h old -> not unreachable
    row(UID(3), "c1", {
      provider_state: "unsubscribed",
      provider_checked_at: fresh,
    }),
    row(UID(3), "c2", {
      provider_state: "unsubscribed",
      provider_checked_at: iso(now - 27 * HOUR),
    }),
    // control: every record answered within 26 h and none subscribed -> unreachable
    row(UID(4), "d1", {
      provider_state: "unsubscribed",
      provider_checked_at: fresh,
    }),
    row(UID(4), "d2", {
      provider_state: "permission_off",
      provider_checked_at: iso(now - 25 * HOUR),
    }),
  ];
  assertEquals(computeAlertSet(rows, now).unreachable.map((u) => u.user_id), [
    UID(4),
  ]);
});

Deno.test("R-GAVEUP a given-up device that the provider shows subscribed becomes repaired and leaves the alert", async () => {
  const store = new Store();
  store.rows.push(row(UID(1), "g1", {
    provider_state: "refused_token",
    repair_state: "gave_up",
    repair_requests: 3,
    repair_window_started_at: iso(T0 - 8 * DAY),
  }));
  assertEquals(computeAlertSet(store.rows, T0).refused.length, 1);
  const r = rig(store, (u) => ({ status: 200, body: viewBody(u, "g1", 1) }));
  await r.run();
  assertEquals(store.rows[0].provider_state, "subscribed");
  assertEquals(store.rows[0].repair_state, "repaired");
  assertEquals(computeAlertSet(store.rows, T0).refused.length, 0);
  // and the pure rule agrees for a `requested` row too
  const adv = advanceRepair(
    row(UID(1), "g2", {
      provider_state: "subscribed",
      repair_state: "requested",
    }),
    T0,
    { deleteEnabled: false, replacedAfterDelete: false },
  );
  assertEquals(adv.row.repair_state, "repaired");
});

Deno.test("R-STALL a stalled body hits the per-request deadline; the next account is still checked; rows untouched", async () => {
  const store = new Store();
  store.rows.push(row(UID(1), "x1", { provider_state: "subscribed" }));
  store.rows.push(row(UID(2), "y1", { provider_state: "subscribed" }));
  const before = JSON.stringify(store.rows[0]);
  const r = rig(
    store,
    (u) =>
      u === UID(1)
        ? { status: 200, stallBody: true }
        : { status: 200, body: viewBody(u, "y1", -10) },
  );
  const started = Date.now();
  const summary = await r.run();
  assert(
    Date.now() - started < 2_000,
    "the run did not hang on the stalled body",
  );
  assertEquals(JSON.stringify(store.rows[0]), before);
  assertEquals(summary.users_checked, 1);
  assertEquals(store.rows[1].provider_state, "unsubscribed");
});

Deno.test("R-IDENTITY an answer about another account, or with no identity, changes nothing for the asked account", async () => {
  for (
    const identity of [{ external_id: UID(9) }, undefined, {
      external_id: null,
    }, { external_id: ` ${UID(1)}` }]
  ) {
    const store = new Store();
    store.rows.push(row(UID(1), "i1", { provider_state: "subscribed" }));
    const before = JSON.stringify(store.rows);
    const r = rig(store, () => ({
      status: 200,
      body: {
        identity,
        subscriptions: [{
          id: "other",
          type: "iOSPush",
          notification_types: -14,
        }],
      },
    }));
    const summary = await r.run();
    assertEquals(
      JSON.stringify(store.rows),
      before,
      `identity ${JSON.stringify(identity)}`,
    );
    assertEquals(summary.users_checked, 0);
  }
});

Deno.test("R-DELETE retries are capped at 3 for throws, 500s and 400s, and the switch is off in the bundle", async () => {
  assertEquals(PROVIDER_DELETE_ENABLED, false);
  for (const shape of ["throw", "500", "400"] as const) {
    const store = new Store();
    store.rows.push(row(UID(1), "d1", {
      provider_state: "refused_token",
      provider_status_code: -14,
      repair_state: "none",
      repair_requests: 1,
      repair_window_started_at: iso(T0 - 2 * DAY),
    }));
    const r = rig(store, (u, method) => {
      if (method === "DELETE") {
        return shape === "throw"
          ? { status: 0, throws: true }
          : { status: Number(shape) };
      }
      return { status: 200, body: viewBody(u, "d1", -14) };
    }, { deleteEnabled: true });
    for (let k = 0; k < 12; k++) {
      store.rows[0].last_reported_at = iso(r.clock.t - MIN);
      await r.run();
      r.clock.t += 30 * MIN;
    }
    assertEquals(r.calls.filter((m) => m === "DELETE").length, 3, shape);
    assert(
      store.rows[0].repair_state !== "provider_deleted",
      `${shape}: a failed delete never reads as deleted`,
    );
  }
});
