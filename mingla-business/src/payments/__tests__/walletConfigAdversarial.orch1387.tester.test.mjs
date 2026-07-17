/**
 * ORCH-1387 — TESTER-ADVERSARIAL regression suite (mingla-tester, TEST phase;
 * SPEC §9 angles A-2/A-3/A-4). CLOSE Step 0.5 tester test.
 *
 * DIFFERENT ANGLES than the implementor's shipped nets:
 *  1. REAL-MODULE PROVENANCE (COMMS-0106): imports the SHIPPED gate module
 *     (.github/scripts/strict-grep/orch-1387-wallet-config-threaded.mjs) and
 *     attacks it with mutations of the REAL HEAD file contents — not the
 *     gate's own synthetic self-test fixtures. If the gate's stripper, span
 *     extractor, or rule set is ever weakened, these fail even while the
 *     self-test's fixtures still pass.
 *  2. FAIL-CLOSED PINS: shapes that must STAY red (parenthesized cast spread,
 *     googlePay-without-country, hook rebuild on real content) are pinned so
 *     a gate regression cannot silently reopen them.
 *  3. TYPE-REJECTION BREADTH (A-3): drives the tester-adversarial scoped tsc
 *     lane (tsconfig.orch1387.tester-adversarial.typetest.json — Deferred/
 *     Recurring union breadth + wrong-typed booleans + excess keys INSIDE the
 *     wallet params). Two-sided: reverting the types.ts wallet extension
 *     breaks the lane's positives → THIS SUITE GOES RED (the tester
 *     fails-on-revert angle); widening trips TS2578 → red.
 *  4. CI-WIRING TRUTH (A-4 static half): asserts both ORCH-1387 workflow jobs
 *     exist with their load-bearing steps, and that the workflow's
 *     pull_request path filters cover every path class this net guards —
 *     deleting a job or a filter line goes red here.
 *
 * Zero product imports at runtime beyond the gate script itself (which is
 * main-guarded and import-safe by design).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

const GATE_REL = ".github/scripts/strict-grep/orch-1387-wallet-config-threaded.mjs";
const WORKFLOW_REL = ".github/workflows/strict-grep-mingla-business.yml";
const TESTER_LANE_REL =
  "packages/payments-native/tsconfig.orch1387.tester-adversarial.typetest.json";

const gate = await import(pathToFileURL(path.join(repoRoot, GATE_REL)).href);
const { checkFlowFile, checkReserveFile, checkHookFile, checkTypesFile, FILES } = gate;

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const idsB = { unique: "W-1", apple: "W-4", google: "W-6" };

// ─── 0. Real-module provenance ─────────────────────────────────────────────

test("provenance: the SHIPPED gate module exports its checkers and scans the five invariant files", () => {
  assert.equal(typeof checkFlowFile, "function");
  assert.equal(typeof checkReserveFile, "function");
  assert.equal(typeof checkHookFile, "function");
  assert.equal(typeof checkTypesFile, "function");
  assert.deepEqual(FILES, {
    B: "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
    C: "app-mobile/src/payments/nativeCheckoutFlow.ts",
    R: "app-mobile/src/hooks/useReserveTable.ts",
    H: "packages/payments-native/useStripePaymentSheet.ts",
    T: "packages/payments-native/types.ts",
  });
  for (const rel of Object.values(FILES)) {
    assert.ok(fs.existsSync(path.join(repoRoot, rel)), `${rel} must exist`);
  }
});

// ─── 1. Fail-closed pins on REAL HEAD content (not synthetic fixtures) ─────

test("fail-closed: deleting the real applePay block from B fires W-4 via the shipped gate", () => {
  const B = read(FILES.B);
  const mutated = B.replace(/        applePay: \{[\s\S]*?\n        \},\n/, "");
  assert.notEqual(mutated, B, "mutation must apply");
  const failures = checkFlowFile(mutated, "B", idsB);
  assert.ok(
    failures.some((f) => f.startsWith("W-4")),
    `W-4 must fire on real-content applePay deletion; got: ${failures.join(" | ")}`,
  );
});

test("fail-closed: a PARENTHESIZED cast spread in R stays red (any cast form breaks the literal ...walletConfig token)", () => {
  const R = read(FILES.R);
  for (const castForm of [
    "...(walletConfig as any),",
    "...(walletConfig as unknown as Record<string, unknown>),",
    "...(walletConfig as object),",
  ]) {
    const mutated = R.replace("        ...walletConfig,", `        ${castForm}`);
    assert.notEqual(mutated, R, "mutation must apply");
    const failures = checkReserveFile(mutated, "R");
    assert.ok(
      failures.length > 0,
      `cast form \`${castForm}\` must not pass the shipped gate silently`,
    );
  }
});

test("fail-closed: stripping merchantCountryCode from the real googlePay block in B fires W-6", () => {
  const B = read(FILES.B);
  const mutated = B.replace(
    /googlePay: \{\n          merchantCountryCode: "US",/,
    "googlePay: {",
  );
  assert.notEqual(mutated, B, "mutation must apply");
  const failures = checkFlowFile(mutated, "B", idsB);
  assert.ok(
    failures.some((f) => f.startsWith("W-6")),
    `W-6 must fire when the real googlePay block loses its country; got: ${failures.join(" | ")}`,
  );
});

test("fail-closed: rebuilding the real hook forward fires W-10 on the shipped gate", () => {
  const H = read(FILES.H);
  const mutated = H.replace(
    "initPaymentSheet(input)",
    "initPaymentSheet({ merchantDisplayName: input.merchantDisplayName })",
  );
  assert.notEqual(mutated, H, "mutation must apply");
  const failures = checkHookFile(mutated, "H");
  assert.ok(
    failures.some((f) => f.startsWith("W-10")),
    `W-10 must fire on a real-content hook rebuild; got: ${failures.join(" | ")}`,
  );
});

test("fail-closed: removing the wallet keys from the real types.ts fires W-11", () => {
  const T = read(FILES.T);
  const mutated = T.replace("applePay?: PaymentSheet.ApplePayParams;", "").replace(
    "googlePay?: PaymentSheet.GooglePayParams;",
    "",
  );
  assert.notEqual(mutated, T, "mutation must apply");
  const failures = checkTypesFile(mutated, "T");
  assert.ok(
    failures.some((f) => f.startsWith("W-11")),
    `W-11 must fire on real-content type revert; got: ${failures.join(" | ")}`,
  );
});

// ─── 2. The pristine tree passes the shipped gate end-to-end ───────────────

test("pristine: the shipped gate binary passes on the current tree (exit 0)", () => {
  execFileSync(process.execPath, [path.join(repoRoot, GATE_REL)], {
    cwd: repoRoot,
    stdio: "pipe",
  }); // throws on non-zero exit
});

// ─── 3. A-3 type-rejection breadth via the tester-adversarial scoped lane ──
// FAILS-ON-REVERT (tester angle): reverting the ORCH-1387 types.ts wallet-key
// extension breaks this lane's positives → this test goes red.

test("A-3 breadth lane: Deferred/Recurring positives compile; 6 breadth negatives stay errors", () => {
  execSync(
    `npx tsc --noEmit -p ${JSON.stringify(path.join(repoRoot, TESTER_LANE_REL))}`,
    { cwd: path.join(repoRoot, "mingla-business"), stdio: "pipe" },
  ); // throws (test red) if any positive breaks or any @ts-expect-error goes unused (TS2578)
});

// ─── 4. A-4 static CI-wiring truth ─────────────────────────────────────────

test("A-4: both ORCH-1387 workflow jobs exist with their load-bearing steps", () => {
  const wf = read(WORKFLOW_REL);
  assert.ok(wf.includes("orch-1387-wallet-config-threaded:"), "threaded job must exist");
  assert.ok(wf.includes("orch-1387-wallet-type-contract:"), "type-contract job must exist");
  assert.ok(
    wf.includes(`node ${GATE_REL} --self-test`),
    "threaded job must self-test the gate",
  );
  assert.ok(
    wf.includes("mingla-business/src/payments/__tests__/walletConfigThreading.orch1387.test.mjs"),
    "threaded job must run the business structural suite",
  );
  assert.ok(
    wf.includes("app-mobile/src/payments/__tests__/wallet_config_threading.orch1387.test.mjs"),
    "threaded job must run the consumer structural suite",
  );
  assert.ok(
    wf.includes("npx tsc --noEmit -p ../packages/payments-native/tsconfig.orch1387.typetest.json"),
    "type-contract job must run the scoped lane",
  );
});

test("A-4: workflow path filters cover every path class this net guards", () => {
  const wf = read(WORKFLOW_REL);
  const pullRequestBlock = wf.slice(wf.indexOf("pull_request:"), wf.indexOf("push:"));
  for (const p of [
    '"mingla-business/**"',
    '"app-mobile/**"',
    '"packages/**"',
    '".github/scripts/strict-grep/**"',
    '".github/workflows/strict-grep-mingla-business.yml"',
  ]) {
    assert.ok(
      pullRequestBlock.includes(p),
      `pull_request path filter must include ${p} — every file class scanned by the ORCH-1387 gate must trigger the workflow`,
    );
  }
});
