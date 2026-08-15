import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_INPUT_BYTES,
  detectCredentialClass,
  parseCliArgs,
  runInventory,
  safeFailure,
} from "./issue_2084_safe_credential_inventory.mjs";

const utility = fileURLToPath(new URL("./issue_2084_safe_credential_inventory.mjs", import.meta.url));
const synthetic = (prefix) => `${prefix}_${randomBytes(24).toString("hex")}`;
const cleanInput = (records, comparisons = []) => ({ schemaVersion: 1, records, comparisons });
const runCli = (input, args = []) => spawnSync(process.execPath, [utility, ...args], {
  input,
  encoding: "utf8",
  maxBuffer: 2 * MAX_INPUT_BYTES,
});
const assertAbsent = (result, values) => {
  const captured = `${result.stdout}${result.stderr}${result.error?.message ?? ""}`;
  for (const value of values) assert.equal(captured.includes(value), false);
};

test("one-separator webhook value never reaches output", () => {
  const value = synthetic("whsec");
  const result = runCli(JSON.stringify(cleanInput([
    { label: "LIVE_CONNECT_WEBHOOK", path: "SUPABASE_SECRET_SLOT", value },
  ])));
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).records[0].credentialClass, "WEBHOOK_SIGNING");
  assertAbsent(result, [value]);
});

test("multi-separator secret and restricted tokens never reach output", () => {
  const secret = synthetic("sk_test_part_with");
  const restricted = synthetic("rk_test_part_with");
  const result = runCli(JSON.stringify(cleanInput([
    { label: "TEST_STANDARD_KEY", path: "MASTER_INVENTORY", value: secret },
    { label: "RAK_WEBHOOK_TEST", path: "PROVIDER_DASHBOARD", value: restricted },
  ])));
  assert.equal(result.status, 0);
  assertAbsent(result, [secret, restricted]);
});

test("credential classes are closed and accurate", () => {
  assert.equal(detectCredentialClass(synthetic("sk_live")), "SECRET_API");
  assert.equal(detectCredentialClass(synthetic("rk_test")), "RESTRICTED_API");
  assert.equal(detectCredentialClass(synthetic("pk_test")), "PUBLISHABLE_API");
  assert.equal(detectCredentialClass(`Bearer ${randomBytes(20).toString("hex")}`), "BEARER");
  const segment = randomBytes(12).toString("base64url");
  assert.equal(detectCredentialClass(`eyJ${segment}.${segment}.${segment}`), "JWT");
  assert.equal(detectCredentialClass(`Authorization: ${synthetic("sk_test")}`), "AUTHORIZATION_HEADER");
  assert.equal(detectCredentialClass(`https://safe.invalid/hook?secret=${randomBytes(12).toString("hex")}`), "SENSITIVE_URL");
  assert.equal(detectCredentialClass(`provider rejected ${synthetic("sk_test")}`), "ERROR_PAYLOAD");
});

test("digest equality emits only slot and MATCH or NO_MATCH", () => {
  const same = synthetic("whsec");
  const different = synthetic("whsec");
  const result = runInventory(cleanInput([
    { label: "LIVE_CONNECT_WEBHOOK", path: "SUPABASE_SECRET_SLOT", value: same },
    { label: "LIVE_CONNECT_WEBHOOK", path: "PROVIDER_DASHBOARD", value: same },
    { label: "LIVE_PLATFORM_WEBHOOK", path: "PROVIDER_DASHBOARD", value: different },
  ], [
    { left: 0, right: 1, slot: "STRIPE_WEBHOOK_SECRET" },
    { left: 0, right: 2, slot: "STRIPE_WEBHOOK_SECRET_PLATFORM" },
  ]));
  assert.deepEqual(result.comparisons, [
    { slot: "STRIPE_WEBHOOK_SECRET", result: "MATCH" },
    { slot: "STRIPE_WEBHOOK_SECRET_PLATFORM", result: "NO_MATCH" },
  ]);
  assert.equal(JSON.stringify(result).includes(same), false);
  assert.equal(JSON.stringify(result).includes(different), false);
});

test("malformed JSON fails through the same sanitizer", () => {
  const value = synthetic("whsec");
  const result = runCli(`{"value":"${value}"`);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "INVENTORY_FAILED" });
  assertAbsent(result, [value]);
});

test("newline and control injection is rejected without reflection", () => {
  const value = `${synthetic("whsec")}\nINJECTED`;
  const result = runCli(JSON.stringify(cleanInput([
    { label: "LIVE_CONNECT_WEBHOOK", path: "SUPABASE_SECRET_SLOT", value },
  ])));
  assert.equal(result.status, 1);
  assertAbsent(result, [value, "INJECTED"]);
});

test("nested exception content is ignored by safeFailure", () => {
  const value = synthetic("sk_test");
  const error = new Error(`outer ${value}`, { cause: new Error(`inner ${value}`) });
  const output = JSON.stringify(safeFailure(error));
  assert.deepEqual(JSON.parse(output), { ok: false, error: "INVENTORY_FAILED" });
  assert.equal(output.includes(value), false);
});

test("child-process failure output remains sanitized", () => {
  const value = synthetic("rk_test");
  const result = runCli(JSON.stringify(cleanInput([
    { label: "RAK_WEBHOOK_TEST", path: "PROVIDER_DASHBOARD", value, extra: value },
  ])));
  assert.equal(result.status, 1);
  assertAbsent(result, [value]);
});

test("unknown credential formats fail closed", () => {
  const value = randomBytes(30).toString("hex");
  const result = runCli(JSON.stringify(cleanInput([
    { label: "TEST_STANDARD_KEY", path: "MASTER_INVENTORY", value },
  ])));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "UNKNOWN_CREDENTIAL_CLASS" });
  assertAbsent(result, [value]);
});

test("credential-like argv is rejected without echo", () => {
  const value = synthetic("sk_test");
  assert.throws(() => parseCliArgs([value]), (error) => error.message === "CREDENTIAL_LIKE_ARGUMENT");
  const result = runCli("", [value]);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "CREDENTIAL_LIKE_ARGUMENT" });
  assertAbsent(result, [value]);
});

test("malicious label and path inputs never echo", () => {
  const credential = synthetic("sk_test");
  const label = `BAD_${credential}`;
  const path = `../?secret=${credential}`;
  for (const record of [
    { label, path: "MASTER_INVENTORY", value: credential },
    { label: "TEST_STANDARD_KEY", path, value: credential },
  ]) {
    const result = runCli(JSON.stringify(cleanInput([record])));
    assert.equal(result.status, 1);
    assertAbsent(result, [credential, label, path]);
  }
});

test("oversized input fails without outputting the payload", () => {
  const marker = randomBytes(24).toString("hex");
  const result = runCli(`${"x".repeat(MAX_INPUT_BYTES)}${marker}`);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "INPUT_TOO_LARGE" });
  assertAbsent(result, [marker]);
});

test("unknown harmless path is normalized to UNCLASSIFIED_PATH", () => {
  const value = synthetic("whsec");
  const result = runInventory(cleanInput([
    { label: "TEST_CONNECT_WEBHOOK", path: "HUMAN_ENTERED_SOURCE", value },
  ]));
  assert.equal(result.records[0].path, "UNCLASSIFIED_PATH");
  assert.equal(JSON.stringify(result).includes(value), false);
});

test("extra requested output fields fail the closed schema", () => {
  const value = synthetic("whsec");
  const result = runCli(JSON.stringify({
    ...cleanInput([{ label: "TEST_CONNECT_WEBHOOK", path: "PROVIDER_DASHBOARD", value }]),
    includeDigest: true,
  }));
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "INVALID_SCHEMA" });
  assertAbsent(result, [value]);
});
