/**
 * Issue #3512 — the Admin Refund operations page blamed the queue when the real
 * problem was an aged-out admin session.
 *
 * Production (`function_edge_logs`, gqnoajqerqhnvulmnyvv, 2026-09-21) after the
 * #3506 CORS fix landed:
 *
 *   08:01:37  OPTIONS  200   ← preflight fixed
 *   08:01:37  POST     401   ← not_authenticated: the tab's Bearer had aged out
 *
 * `admin-source-refund-operations` answers 401 `not_authenticated` when
 * `auth.getUser()` rejects the Bearer and 403 `not_authorized` when the caller
 * is not an active admin — so a 401 is authentication, and re-authenticating is
 * the fix. `invokeWithRefresh` already implements exactly one refresh-and-retry;
 * `refundOperationsService.js` was the one admin service not using it.
 *
 * These tests do NOT restate the source. They build a live module pair from the
 * SHIPPED source of both files — the real `invokeWithRefresh` body lifted out of
 * `lib/supabase.js`, and the real `refundOperationsService.js` with only its
 * `../lib/supabase` specifier redirected at the stub — and then drive the real
 * exported service functions against a fake edge client. Deleting the fix makes
 * the service call `supabase.functions.invoke` directly again, which refreshes
 * zero times and surfaces the 401, and these assertions go red.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LIB_PATH = path.resolve(here, "../lib/supabase.js");
const SERVICE_PATH = path.resolve(here, "../services/refundOperationsService.js");

const PROBE_KEY = "__ISSUE_3512_PROBE__";

/**
 * Lift the real `invokeWithRefresh` implementation out of `lib/supabase.js`.
 *
 * Everything above the ORCH-0541 marker is `createClient` + `import.meta.env`,
 * which cannot run outside Vite. Everything from `SESSION_REFRESH_BUFFER_MS`
 * down is the retry policy under test, and it runs verbatim here.
 */
function liftInvokeWithRefreshSource() {
  const lib = fs.readFileSync(LIB_PATH, "utf8");
  const start = lib.indexOf("const SESSION_REFRESH_BUFFER_MS");
  assert.notEqual(
    start,
    -1,
    "lib/supabase.js no longer declares SESSION_REFRESH_BUFFER_MS — this test is lifting the wrong code",
  );
  const source = lib.slice(start);
  // Guard the lift: if these disappear, the test would silently stop proving
  // anything, which is the failure mode this repo calls an unfalsifiable check.
  for (
    const marker of [
      "export async function invokeWithRefresh(",
      "supabase.auth.getSession()",
      "supabase.auth.refreshSession()",
      "supabase.functions.invoke(functionName, options)",
      "=== 401",
    ]
  ) {
    assert.ok(
      source.includes(marker),
      `lifted invokeWithRefresh source is missing ${marker}`,
    );
  }
  return source;
}

const STUB_CLIENT = `
const probe = () => globalThis["${PROBE_KEY}"];

export const supabase = {
  auth: {
    getSession: async () => {
      probe().getSessions += 1;
      return { data: { session: { expires_at: probe().expiresAt } } };
    },
    refreshSession: async () => {
      probe().refreshes += 1;
      if (probe().refreshThrows) throw new Error("refresh_failed");
      return { data: { session: { expires_at: probe().expiresAt } }, error: null };
    },
  },
  functions: {
    invoke: async (functionName, options) => {
      probe().invokes.push({ functionName, options });
      const next = probe().responses.shift();
      if (!next) throw new Error("ISSUE_3512_UNEXPECTED_EXTRA_INVOKE");
      return next;
    },
  },
};
`;

/**
 * Write a temp module pair: the stub client + real retry policy, and the real
 * service with its lib specifier redirected at that stub. Nothing else in the
 * service is touched.
 */
function buildLiveService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue3512-"));
  fs.writeFileSync(
    path.join(dir, "lib-supabase.mjs"),
    `${STUB_CLIENT}\n${liftInvokeWithRefreshSource()}`,
  );
  const service = fs.readFileSync(SERVICE_PATH, "utf8");
  assert.ok(
    service.includes('"../lib/supabase"'),
    "refundOperationsService.js no longer imports ../lib/supabase",
  );
  fs.writeFileSync(
    path.join(dir, "service.mjs"),
    service.replaceAll('"../lib/supabase"', '"./lib-supabase.mjs"'),
  );
  return pathToFileURL(path.join(dir, "service.mjs")).href;
}

const service = await import(buildLiveService());

const FAR_FUTURE = Math.floor(Date.now() / 1000) + 3600;
const NEAR_EXPIRY = Math.floor(Date.now() / 1000) + 10;

function arm({ responses, expiresAt = FAR_FUTURE, refreshThrows = false }) {
  const probe = {
    responses: [...responses],
    expiresAt,
    refreshThrows,
    invokes: [],
    refreshes: 0,
    getSessions: 0,
  };
  globalThis[PROBE_KEY] = probe;
  return probe;
}

const QUEUE_PAGE = {
  data: {
    snapshot_id: "35120000-0000-4000-8000-000000000001",
    snapshot_created_at: "2030-01-04T00:00:00.000Z",
    items: [],
    nextCursor: null,
  },
  error: null,
};

/** The shape supabase-js hands back for a non-2xx edge response. */
function edgeError(status, body) {
  return {
    data: null,
    error: Object.assign(
      new Error("Edge Function returned a non-2xx status code"),
      { context: { status }, body },
    ),
  };
}

test("#3512 a healthy session loads the queue with zero refreshes", async () => {
  const probe = arm({ responses: [QUEUE_PAGE] });
  const view = await service.listSourceRefundOperations();
  assert.equal(view.snapshot_id, QUEUE_PAGE.data.snapshot_id);
  assert.equal(probe.invokes.length, 1, "one edge call");
  assert.equal(probe.refreshes, 0, "a valid session must not be refreshed");
  assert.equal(probe.invokes[0].functionName, "admin-source-refund-operations");
});

test("#3512 a 401 queue load refreshes EXACTLY once, retries EXACTLY once, and renders", async () => {
  const probe = arm({
    responses: [edgeError(401, { error: "not_authenticated" }), QUEUE_PAGE],
  });
  const view = await service.listSourceRefundOperations();

  assert.equal(
    probe.refreshes,
    1,
    `ISSUE_3512_REFRESH_COUNT:${probe.refreshes} — a 401 must trigger exactly one session refresh`,
  );
  assert.equal(
    probe.invokes.length,
    2,
    `ISSUE_3512_INVOKE_COUNT:${probe.invokes.length} — exactly one retry, no loop`,
  );
  assert.equal(view.snapshot_id, QUEUE_PAGE.data.snapshot_id);
  // The retry must be the same call, not a degraded one.
  assert.deepEqual(probe.invokes[0], probe.invokes[1]);
});

test("#3512 a 401 that survives the refresh stops after one retry and surfaces as expired", async () => {
  const probe = arm({
    responses: [
      edgeError(401, { error: "not_authenticated" }),
      edgeError(401, { error: "not_authenticated" }),
    ],
  });
  const caught = await service.listSourceRefundOperations().then(
    () => null,
    (error) => error,
  );

  assert.ok(caught, "a surviving 401 must reject, not resolve");
  assert.equal(
    probe.refreshes,
    1,
    `ISSUE_3512_REFRESH_COUNT:${probe.refreshes} — must not loop refreshing`,
  );
  assert.equal(
    probe.invokes.length,
    2,
    `ISSUE_3512_INVOKE_COUNT:${probe.invokes.length} — must not loop retrying`,
  );
  assert.equal(
    service.isSessionExpiredError(caught),
    true,
    "the page must be able to tell this is an expired session, not a broken queue",
  );
});

test("#3512 action buttons get the same one refresh-and-retry", async () => {
  const probe = arm({
    responses: [
      edgeError(401, { error: "not_authenticated" }),
      { data: { refund: { refund_id: "r-1", ops_status: "resolved" } }, error: null },
    ],
  });
  const refund = await service.actOnSourceRefund({
    refundId: "35120000-0000-4000-8000-000000000002",
    action: "resolve_ops",
    reason: "verified with provider",
  });

  assert.equal(refund.ops_status, "resolved");
  assert.equal(probe.refreshes, 1, `ISSUE_3512_REFRESH_COUNT:${probe.refreshes}`);
  assert.equal(probe.invokes.length, 2, `ISSUE_3512_INVOKE_COUNT:${probe.invokes.length}`);
  assert.equal(probe.invokes[0].functionName, "admin-source-refund-action");
});

test("#3512 attention recovery and detail reads route through the same policy", async () => {
  for (
    const [label, call] of [
      [
        "detail",
        () =>
          service.getSourceRefundOperation(
            "35120000-0000-4000-8000-000000000002",
          ),
      ],
      [
        "recovery",
        () =>
          service.recoverSourceRefundAttention({
            refundId: "35120000-0000-4000-8000-000000000002",
            action: "invalidate_and_resend_attention",
            expectedGeneration: 3,
            reasonCode: "delivery_acceptance_unknown",
          }),
      ],
    ]
  ) {
    const probe = arm({
      responses: [
        edgeError(401, { error: "not_authenticated" }),
        { data: { item: { summary: {} }, refund: { refund_id: "r-1" } }, error: null },
      ],
    });
    await call();
    assert.equal(probe.refreshes, 1, `${label}: ISSUE_3512_REFRESH_COUNT:${probe.refreshes}`);
    assert.equal(
      probe.invokes.length,
      2,
      `${label}: ISSUE_3512_INVOKE_COUNT:${probe.invokes.length}`,
    );
  }
});

test("#3512 a session near expiry is refreshed BEFORE the call, and still only once", async () => {
  const probe = arm({ responses: [QUEUE_PAGE], expiresAt: NEAR_EXPIRY });
  await service.listSourceRefundOperations();
  assert.equal(
    probe.refreshes,
    1,
    `ISSUE_3512_REFRESH_COUNT:${probe.refreshes} — a session inside the 60s buffer is pre-refreshed`,
  );
  assert.equal(
    probe.invokes.length,
    1,
    `ISSUE_3512_INVOKE_COUNT:${probe.invokes.length} — a pre-refreshed call needs no retry`,
  );
});

test("#3512 a failing refresh still retries at most once and does not hang", async () => {
  const probe = arm({
    responses: [edgeError(401, { error: "not_authenticated" })],
    refreshThrows: true,
  });
  const caught = await service.listSourceRefundOperations().then(
    () => null,
    (error) => error,
  );
  assert.ok(caught, "an unrecoverable session must reject");
  assert.equal(service.isSessionExpiredError(caught), true);
  assert.equal(
    probe.refreshes,
    1,
    `ISSUE_3512_REFRESH_COUNT:${probe.refreshes} — the 401 must still attempt one refresh`,
  );
  assert.equal(probe.invokes.length, 1, `ISSUE_3512_INVOKE_COUNT:${probe.invokes.length}`);
});

test("#3512 403 not_authorized is NOT treated as an expired session", async () => {
  // The edge function answers 401 when the Bearer fails and 403 when the caller
  // is not an active admin. Refreshing cannot fix 403, so it must not retry and
  // must not tell the admin to sign in again.
  const probe = arm({ responses: [edgeError(403, { error: "not_authorized" })] });
  const caught = await service.listSourceRefundOperations().then(
    () => null,
    (error) => error,
  );
  assert.ok(caught);
  assert.equal(probe.refreshes, 0, "403 must not trigger a refresh");
  assert.equal(probe.invokes.length, 1, "403 must not be retried");
  assert.equal(
    service.isSessionExpiredError(caught),
    false,
    "403 is an authorization problem; a sign-in prompt would send the admin in circles",
  );
});

test("#3512 isSessionExpiredError classifies the shapes the client actually sees", () => {
  assert.equal(service.isSessionExpiredError(null), false);
  assert.equal(service.isSessionExpiredError(undefined), false);
  assert.equal(service.isSessionExpiredError({ context: { status: 401 } }), true);
  assert.equal(service.isSessionExpiredError({ status: 401 }), true);
  assert.equal(service.isSessionExpiredError({ context: { status: 403 } }), false);
  assert.equal(service.isSessionExpiredError({ context: { status: 500 } }), false);
  assert.equal(
    service.isSessionExpiredError(new Error("not_authenticated")),
    true,
  );
  assert.equal(
    service.isSessionExpiredError(new Error("snapshot_expired")),
    false,
  );
});

test("#3512 the page reports an expired session with a sign-in action, on load AND on actions", () => {
  const page = fs.readFileSync(
    path.resolve(here, "../pages/RefundOperationsPage.jsx"),
    "utf8",
  );
  assert.match(page, /isSessionExpiredError/);
  assert.match(page, /SESSION_EXPIRED_MESSAGE/);
  assert.match(page, /Sign in again/);
  assert.match(page, /signOut/);

  // Every catch that can see a 401 must classify it. The action handler had no
  // catch at all before #3512, so a 401 there failed silently.
  const handlers = page.split(/const (?=load|loadMore|act|recoverAttention)/);
  for (const name of ["load ", "loadMore =", "act =", "recoverAttention ="]) {
    const handler = handlers.find((chunk) => chunk.startsWith(name));
    assert.ok(handler, `handler ${name} not found`);
    assert.ok(
      handler.includes("isSessionExpiredError"),
      `${name} does not classify an expired session`,
    );
  }

  const service_ = fs.readFileSync(SERVICE_PATH, "utf8");
  const stripped = service_
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.match(stripped, /invokeWithRefresh\(name, options\)/);
  assert.doesNotMatch(
    stripped,
    /(?:^|[^\w.])supabase\.functions\.invoke\(/m,
    "the raw client call is what broke on an idle tab",
  );
});
