import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_INPUT_BYTES,
  safeFailure,
} from "./issue_2084_safe_credential_inventory.mjs";

const utility = fileURLToPath(new URL("./issue_2084_safe_credential_inventory.mjs", import.meta.url));
const token = (prefix) => `${prefix}_${randomBytes(24).toString("hex")}`;
const input = (records) => JSON.stringify({ schemaVersion: 1, records, comparisons: [] });
const runCli = (payload) => spawnSync(process.execPath, [utility], {
  input: payload,
  encoding: "utf8",
  maxBuffer: 2 * MAX_INPUT_BYTES,
});
const transcript = (result) => `${result.stdout}${result.stderr}${result.error?.message ?? ""}`;
const assertNothingReflected = (result, forbidden) => {
  const captured = transcript(result);
  for (const value of forbidden) assert.equal(captured.includes(value), false);
};

test("combined header URL bearer and webhook material collapses to one closed class", () => {
  const bearer = randomBytes(24).toString("base64url");
  const webhook = token("whsec");
  const querySecret = randomBytes(24).toString("hex");
  const combined = `Authorization: Bearer ${bearer}; callback=https://safe.invalid/hook?secret=${querySecret}; receipt=${webhook}`;
  const result = runCli(input([
    { label: "LIVE_CONNECT_WEBHOOK", path: "CODEX_SESSION", value: combined },
  ]));

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).records, [{
    label: "LIVE_CONNECT_WEBHOOK",
    path: "CODEX_SESSION",
    credentialClass: "AUTHORIZATION_HEADER",
  }]);
  assertNothingReflected(result, [combined, bearer, webhook, querySecret]);
});

test("nested aggregate causes with Unicode separators never cross the failure boundary", () => {
  const webhook = token("whsec");
  const restricted = token("rk_test");
  const nested = new AggregateError(
    [new Error(`child\u2028${webhook}`), new Error(`child\u2029${restricted}`)],
    `outer\u2063${webhook}`,
    { cause: new Error(`cause\u200b${restricted}`) },
  );
  const serialized = JSON.stringify(safeFailure(nested));

  assert.deepEqual(JSON.parse(serialized), { ok: false, error: "INVENTORY_FAILED" });
  for (const value of [webhook, restricted, nested.message, nested.cause.message]) {
    assert.equal(serialized.includes(value), false);
  }
});

test("a near-limit valid credential is classified without partial or full reflection", () => {
  const value = `whsec_${"A".repeat(MAX_INPUT_BYTES - 512)}`;
  const payload = input([
    { label: "TEST_PLATFORM_WEBHOOK", path: "APPROVED_TEMP", value },
  ]);
  assert.ok(Buffer.byteLength(payload) < MAX_INPUT_BYTES);
  assert.ok(Buffer.byteLength(payload) > MAX_INPUT_BYTES - 1024);

  const result = runCli(payload);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).records[0].credentialClass, "WEBHOOK_SIGNING");
  assertNothingReflected(result, [value, value.slice(-128)]);
});

test("a malicious Unicode label cannot echo embedded credentials or inject output rows", () => {
  const webhook = token("whsec");
  const secret = token("sk_test");
  const label = `LIVE_CONNECT_WEBHOOK\u2028{\"ok\":true}\u2063${webhook}\u2029${secret}`;
  const result = runCli(input([
    { label, path: "MASTER_INVENTORY", value: webhook },
  ]));

  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { ok: false, error: "INVALID_RECORD" });
  assertNothingReflected(result, [label, webhook, secret, "{\"ok\":true}"]);
});
