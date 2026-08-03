import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateIssue1221 } from "../issue-1221-source-refund-control-plane.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(HERE, "../issue-1221-source-refund-control-plane.mjs");

function run(args = []) {
  return execFileSync(process.execPath, [GATE, ...args], { encoding: "utf8" });
}

test("real #1221 source-refund artifacts satisfy the guard", () => {
  assert.match(run(), /PASS issue-1221 source refund control plane/);
});

test("the guard's fails-on-revert self-test remains wired", () => {
  assert.match(run(["--self-test"]), /PASS .* self-test/);
});

test("raw guest cancellation token persistence is rejected", () => {
  const files = {
    "supabase/functions/venue-reservation-create/index.ts":
      "guest_cancel_token: guestCancelToken,\n" +
      "guest_cancel_token_hash: sha256Hex(guestCancelToken)",
  };
  const failures = evaluateIssue1221(
    files,
    ["20270131001221_issue_1221_source_refund_control_plane.sql"],
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("persist only the guest cancellation token hash")
    ),
    failures.join("\n"),
  );
});

test("raw venue source rejects comment-only legacy symbols and direct terminal writes", () => {
  const migration =
    "CREATE OR REPLACE FUNCTION public.record_source_refund_provider_event\n" +
    "p_next_state='processed'\n" +
    "UPDATE public.reservations SET payment_status='refunded'\n" +
    "CREATE OR REPLACE FUNCTION public.pg_prepare_my_venue_cancellation_refund";
  const baseline =
    '"pg_prepare_my_venue_cancellation_refund"\n' +
    "await runSourceRefundOperation(";
  for (const mutation of [
    `${baseline}\n// createPaystackRefund`,
    `${baseline}\nconst write = { payment_status: "refunded" };`,
  ]) {
    const failures = evaluateIssue1221(
      {
        "supabase/migrations/20270131001221_issue_1221_source_refund_control_plane.sql":
          migration,
        "supabase/functions/venue-reservation-cancel/index.ts": mutation,
      },
      ["20270131001221_issue_1221_source_refund_control_plane.sql"],
    );
    assert.ok(
      failures.some((failure) =>
        failure.includes("retired venue refund symbol") ||
        failure.includes("direct terminal refunded projection")
      ),
      failures.join("\n"),
    );
  }
});

test("venue runner must remain after durable typed preparation", () => {
  const failures = evaluateIssue1221(
    {
      "supabase/migrations/20270131001221_issue_1221_source_refund_control_plane.sql":
        "CREATE OR REPLACE FUNCTION public.record_source_refund_provider_event\n" +
        "p_next_state='processed'\n" +
        "UPDATE public.reservations SET payment_status='refunded'\n" +
        "CREATE OR REPLACE FUNCTION public.pg_prepare_my_venue_cancellation_refund",
      "supabase/functions/venue-reservation-cancel/index.ts":
        "await runSourceRefundOperation(\n" +
        '"pg_prepare_my_venue_cancellation_refund"',
    },
    ["20270131001221_issue_1221_source_refund_control_plane.sql"],
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("prepare durable typed work before")
    ),
    failures.join("\n"),
  );
});

test("SC-27 executable Admin guard fails on mutable live seek and passes restored", () => {
  const uiTest = path.resolve(
    HERE,
    "../../../../mingla-admin/src/__tests__/issue1221_refund_operations.tester.adversarial.test.js",
  );
  const reverted = spawnSync(process.execPath, [uiTest], {
    encoding: "utf8",
    env: { ...process.env, ISSUE_1221_LIVE_SEEK_REVERSION: "1" },
  });
  assert.notEqual(reverted.status, 0);
  assert.match(
    `${reverted.stdout}\n${reverted.stderr}`,
    /SC27_MUTABLE_LIVE_SEEK_SKIPPED_UNSEEN_ROW/,
  );
  assert.match(
    execFileSync(process.execPath, [uiTest], {
      encoding: "utf8",
      env: { ...process.env, ISSUE_1221_LIVE_SEEK_REVERSION: "0" },
    }),
    /pass 2/,
  );
});

test("notify drain exact service-role runtime authorization remains CI-wired", () => {
  const runtimeTest = path.resolve(
    HERE,
    "../../../../supabase/functions/notify-outbox-drain/__tests__/issue_1221_service_role_authorization.test.ts",
  );
  const result = spawnSync(
    "deno",
    [
      "test",
      "--allow-env",
      "--allow-net",
      "--allow-read",
      runtimeTest,
    ],
    { cwd: path.resolve(HERE, "../../../.."), encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /1 passed \| 0 failed/);
});
