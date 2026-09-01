import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import { retentionEnvelope } from "../run-sites-retention.mjs";

const SITE_ID = "123e4567-e89b-42d3-a456-426614174000";
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174001";
const NONCE = "123e4567-e89b-42d3-a456-426614174002";
const NOW = new Date("2026-09-01T12:00:00.000Z");
const KEY = Buffer.alloc(32, 0x29);

function canonical(envelope) {
  return [
    envelope.schema_version,
    envelope.issuer,
    envelope.audience,
    envelope.direction,
    envelope.site_id,
    envelope.operation_id,
    envelope.issued_at,
    envelope.expires_at,
    envelope.nonce,
    envelope.method,
    envelope.path,
    envelope.body_sha256,
    envelope.kid,
  ].join("\n");
}

function independentlyVerifies(envelope) {
  const { signature_b64: observed, ...unsigned } = envelope;
  const expected = createHmac("sha256", KEY)
    .update(canonical(unsigned))
    .digest("base64");
  return observed === expected;
}

test("#2893 tester: nightly retention envelope matches the CMS verifier and binds every field", () => {
  const result = retentionEnvelope({
    SITES_PILOT_SITE_ID: SITE_ID,
    SITES_CMS_ORIGIN: "https://studio.sites.usemingla.com",
    MINGLA_CORE_TO_CMS_CURRENT_KID: "core-sites-key-v1",
    MINGLA_CORE_TO_CMS_CURRENT_KEY_B64: KEY.toString("base64"),
  }, {
    now: NOW,
    operationId: OPERATION_ID,
    nonce: NONCE,
  });

  assert.equal(result.body, "{}");
  assert.deepEqual(Object.keys(result.envelope).sort(), [
    "audience",
    "body_sha256",
    "direction",
    "expires_at",
    "issued_at",
    "issuer",
    "kid",
    "method",
    "nonce",
    "operation_id",
    "path",
    "schema_version",
    "signature_b64",
    "site_id",
  ]);
  assert.equal(
    result.envelope.body_sha256,
    createHash("sha256").update(result.body).digest("hex"),
  );
  assert.equal(
    Date.parse(result.envelope.expires_at) -
      Date.parse(result.envelope.issued_at),
    60_000,
  );
  assert.equal(independentlyVerifies(result.envelope), true);

  // These are the fields a replay, tenant swap, route swap, or widened expiry
  // would attack. The unchanged signature must reject every mutation.
  for (const mutation of [
    { site_id: "123e4567-e89b-42d3-a456-426614174099" },
    { operation_id: "123e4567-e89b-42d3-a456-426614174098" },
    { nonce: "123e4567-e89b-42d3-a456-426614174097" },
    { path: "/api/internal/retention-sweep-all-tenants" },
    { body_sha256: "0".repeat(64) },
    { expires_at: "2026-09-01T12:05:00.000Z" },
  ]) {
    assert.equal(
      independentlyVerifies({ ...result.envelope, ...mutation }),
      false,
    );
  }
});
