// MINGLA-INVARIANT: I-ADMIN-TAB-CEILING-300-PER-MIN | issue #4423 | One admin tab sends at most 300 database requests per minute; over that it pauses for 60 s, shows a banner and reports to Sentry.
// Issue #4423 (W1.4, W1.6): the hard per-tab ceiling, 300 requests a minute.
//
// lib/requestCeiling.js with an injected inner fetch, clock and Sentry
// reporter. Also pins the wiring: lib/supabase.js hands governedFetch to
// createClient and reports trips to Sentry, and AppShell shows the banner.
//
// FAILS-ON-REVERT: delete the `sent.length >= ceiling` trip in governedFetch
// and "the 301st request" goes red; count /auth/v1/ and "auth is never
// blocked" goes red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CEILING_MESSAGE,
  CEILING_PAUSE_MS,
  REQUEST_CEILING,
  createRequestCeiling,
  pathLabel,
  requestKind,
} from "../lib/requestCeiling.js";
import { createPollGate, gatedRun } from "../lib/pollGate.js";

const BASE = "https://example.supabase.co";
const RPC = (name) => `${BASE}/rest/v1/rpc/${name}`;

function setup(overrides = {}) {
  let t = 5_000_000;
  const inner = [];
  const reports = [];
  const ceiling = createRequestCeiling({
    fetchImpl: async (url, init) => { inner.push({ url: String(url), init }); return { status: 200, ok: true }; },
    now: () => t,
    report: (message, context) => reports.push({ message, context }),
    route: () => "#/work-board",
    ...overrides,
  });
  return { ceiling, inner, reports, clock: { add: (ms) => { t += ms; }, now: () => t } };
}

const silence = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

describe("#4423 requestCeiling: 300 per rolling minute", () => {
  it("the ceiling is 300 and the pause 60 s", () => {
    assert.equal(REQUEST_CEILING, 300);
    assert.equal(CEILING_PAUSE_MS, 60_000);
  });

  it("the 301st request in 60 s rejects with request_ceiling and is never sent", async () => {
    await silence(async () => {
      const { ceiling, inner, clock } = setup();
      for (let i = 0; i < 300; i += 1) {
        await ceiling.governedFetch(RPC(i % 2 ? "ops_work_list" : "team_inbox"), { method: "POST" });
        clock.add(150); // 300 requests in 45 s
      }
      assert.equal(inner.length, 300);
      await assert.rejects(ceiling.governedFetch(RPC("ops_config"), { method: "POST" }), /request_ceiling/);
      assert.equal(inner.length, 300, "not sent");
      assert.equal(ceiling.state().tripped, true);
    });
  });

  it("requests spread under the ceiling never trip it (rolling window)", async () => {
    const { ceiling, inner, clock } = setup();
    for (let i = 0; i < 1_200; i += 1) {
      await ceiling.governedFetch(RPC("ops_work_list"), {});
      clock.add(250); // 240 a minute for 5 minutes
    }
    assert.equal(inner.length, 1_200);
    assert.equal(ceiling.state().trips, 0);
  });

  it("mutations are not exempt; edge functions count too", async () => {
    await silence(async () => {
      const { ceiling } = setup();
      for (let i = 0; i < 150; i += 1) await ceiling.governedFetch(`${BASE}/functions/v1/admin-bulk`, { method: "POST" });
      for (let i = 0; i < 150; i += 1) await ceiling.governedFetch(`${BASE}/rest/v1/ops_cards?id=eq.1`, { method: "PATCH" });
      await assert.rejects(ceiling.governedFetch(RPC("ops_work_update"), { method: "POST" }), /request_ceiling/);
    });
  });

  it("/auth/v1/ is never counted or blocked, even while tripped; /storage/v1/ neither", async () => {
    await silence(async () => {
      const { ceiling, inner } = setup();
      for (let i = 0; i < 300; i += 1) await ceiling.governedFetch(RPC("x"), {});
      await assert.rejects(ceiling.governedFetch(RPC("x"), {}), /request_ceiling/);
      for (let i = 0; i < 500; i += 1) await ceiling.governedFetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: "POST" });
      await ceiling.governedFetch(`${BASE}/storage/v1/object/media/a.mp4`, { method: "POST" });
      assert.equal(inner.length, 300 + 500 + 1);
      assert.equal(ceiling.state().tripped, true);
    });
  });

  it("the breaker resets after 60 s: refused for the whole minute, then requests flow again", async () => {
    await silence(async () => {
      const { ceiling, inner, clock } = setup();
      for (let i = 0; i < 300; i += 1) await ceiling.governedFetch(RPC("x"), {});
      await assert.rejects(ceiling.governedFetch(RPC("x"), {}), /request_ceiling/);
      clock.add(59_999);
      await assert.rejects(ceiling.governedFetch(RPC("x"), {}), /request_ceiling/);
      assert.equal(ceiling.state().resumeInMs, 1);
      clock.add(1);
      assert.equal(ceiling.state().tripped, false);
      const res = await ceiling.governedFetch(RPC("x"), {});
      assert.equal(res.status, 200);
      assert.equal(inner.length, 301);
      // and the next minute has its full 300 again
      for (let i = 0; i < 299; i += 1) await ceiling.governedFetch(RPC("x"), {});
      assert.equal(inner.length, 600);
    });
  });

  it("Sentry is told once per trip, with the route and the counts by path", async () => {
    await silence(async () => {
      const { ceiling, reports, clock } = setup();
      for (let i = 0; i < 200; i += 1) await ceiling.governedFetch(RPC("ops_work_list"), {});
      for (let i = 0; i < 100; i += 1) await ceiling.governedFetch(RPC("team_inbox"), {});
      for (let i = 0; i < 50; i += 1) await ceiling.governedFetch(RPC("ops_config"), {}).catch(() => {});
      assert.equal(reports.length, 1, "once, not once per refused request");
      const [r] = reports;
      assert.equal(r.message, CEILING_MESSAGE);
      assert.equal(r.message, "admin_request_ceiling_tripped");
      assert.equal(r.context.level, "error");
      assert.equal(r.context.extra.route, "#/work-board");
      assert.deepEqual(r.context.extra.counts, { "rpc/ops_work_list": 200, "rpc/team_inbox": 100, "rpc/ops_config": 1 });
      // a second trip after the pause reports again
      clock.add(60_000);
      for (let i = 0; i < 301; i += 1) await ceiling.governedFetch(RPC("ops_work_list"), {}).catch(() => {});
      assert.equal(reports.length, 2);
    });
  });

  it("a reporter that throws does not stop the ceiling", async () => {
    await silence(async () => {
      const { ceiling } = setup({ report: () => { throw new Error("sentry down"); } });
      for (let i = 0; i < 300; i += 1) await ceiling.governedFetch(RPC("x"), {});
      await assert.rejects(ceiling.governedFetch(RPC("x"), {}), /request_ceiling/);
    });
  });

  it("subscribers hear the trip (the banner)", async () => {
    await silence(async () => {
      const { ceiling } = setup();
      let heard = 0;
      ceiling.subscribe(() => { heard += 1; });
      for (let i = 0; i < 301; i += 1) await ceiling.governedFetch(RPC("x"), {}).catch(() => {});
      assert.equal(heard, 1);
    });
  });

  it("classifies URLs", () => {
    assert.equal(requestKind(`${BASE}/rest/v1/rpc/a`), "rest");
    assert.equal(requestKind(`${BASE}/functions/v1/a`), "functions");
    assert.equal(requestKind(`${BASE}/auth/v1/user`), "auth");
    assert.equal(requestKind(`${BASE}/storage/v1/object/x`), "storage");
    assert.equal(requestKind(new URL(`${BASE}/rest/v1/t`)), "rest");
    assert.equal(pathLabel(`${BASE}/rest/v1/rpc/ops_work_list?x=1`), "rpc/ops_work_list");
    assert.equal(pathLabel(`${BASE}/functions/v1/admin-x/sub`), "functions/admin-x");
  });
});

describe("#4423 requestCeiling: the witness pollGate reads", () => {
  it("a 5xx, a network failure and a refusal bump transportFailureSeq; a 2xx or 4xx does not", async () => {
    await silence(async () => {
      let status = 200;
      let fail = false;
      const ceiling = createRequestCeiling({
        fetchImpl: async () => { if (fail) throw new TypeError("Failed to fetch"); return { status }; },
        now: () => 0,
        ceiling: 5,
      });
      await ceiling.governedFetch(RPC("a"), {});
      status = 404; await ceiling.governedFetch(RPC("a"), {});
      assert.equal(ceiling.transportFailureSeq(), 0);
      status = 503; await ceiling.governedFetch(RPC("a"), {});
      assert.equal(ceiling.transportFailureSeq(), 1);
      fail = true; await assert.rejects(ceiling.governedFetch(RPC("a"), {}));
      assert.equal(ceiling.transportFailureSeq(), 2);
      fail = false;
      status = 200;
      await ceiling.governedFetch(RPC("a"), {}); // 5th: at the ceiling
      await assert.rejects(ceiling.governedFetch(RPC("a"), {}), /request_ceiling/);
      assert.equal(ceiling.transportFailureSeq(), 3);
    });
  });

  it("a REST request with no signal gets a client timeout; it aborts, counts as a failure, and pollGate backs the key off", async () => {
    const ceiling = createRequestCeiling({
      restTimeoutMs: 30,
      fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
    });
    let t = 0;
    const gate = createPollGate({ now: () => t, random: () => 0.5, transportFailureSeq: () => ceiling.transportFailureSeq() });
    // AbortSignal.timeout's timer does not hold the event loop open; this does.
    const keepAlive = setTimeout(() => {}, 5_000);
    const r = await gatedRun(gate, "ops_work_list", () => ceiling.governedFetch(RPC("ops_work_list"), { method: "POST" }));
    assert.equal(r.ok, false);
    clearTimeout(keepAlive);
    assert.match(String(r.error?.name), /TimeoutError|AbortError/);
    assert.equal(gate.why("ops_work_list"), "backoff");
    assert.equal(gate.state().backoff.ops_work_list.retryInMs, 30_000);
    t += 30_000;
    assert.equal(gate.why("ops_work_list"), null);
  });

  it("a caller's own signal is kept, and edge functions get no extra timeout", async () => {
    const seen = [];
    const ceiling = createRequestCeiling({ fetchImpl: async (url, init) => { seen.push(init?.signal); return { status: 200 }; } });
    const own = new AbortController().signal;
    await ceiling.governedFetch(RPC("a"), { signal: own });
    await ceiling.governedFetch(`${BASE}/functions/v1/x`, {});
    await ceiling.governedFetch(RPC("a"), {});
    assert.equal(seen[0], own);
    assert.equal(seen[1], undefined);
    assert.ok(seen[2] instanceof AbortSignal);
  });
});

describe("#4423 requestCeiling: wiring", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  it("lib/supabase.js gives createClient the governed fetch and reports trips to Sentry", () => {
    const src = read("lib/supabase.js");
    assert.match(src, /global: \{ fetch: tabCeiling\.governedFetch \}/);
    assert.match(src, /setCeilingReporter\(\(message, context\) => captureMessage\(message, context\)\)/);
  });
  it("AppShell shows the exact, non-dismissible banner while tripped", () => {
    const src = read("components/layout/AppShell.jsx");
    assert.match(src, /"Admin paused refreshing for a minute because this tab sent too many requests\. Your work is safe\."/);
    assert.match(src, /<RequestCeilingBanner \/>/);
    assert.match(src, /role="alert"/);
    const banner = src.slice(src.indexOf("export function RequestCeilingBanner"), src.indexOf("export function AppShell"));
    assert.ok(!/onClose|dismiss|onClick/.test(banner), "no way to dismiss it");
  });
  it("the Sentry shim's captureMessage is a no-op before init and forwards after", async () => {
    const sentry = await import("../diagnostics/sentry.js");
    const calls = [];
    const sdk = { init: () => {}, captureMessage: (...a) => { calls.push(a); return "id1"; } };
    assert.equal(sentry.captureMessage("x", {}, sdk), "");
    sentry.initSentry({ dsn: "https://k@o.ingest.sentry.io/1" }, sdk);
    assert.equal(sentry.captureMessage(CEILING_MESSAGE, { level: "error" }, sdk), "id1");
    assert.deepEqual(calls, [[CEILING_MESSAGE, { level: "error" }]]);
  });
});
