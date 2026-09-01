#!/usr/bin/env node

import { createHash, createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  fail,
  requiredEnv,
  requireUuid,
} from "./lib/sites-ops.mjs";

const CMS_ORIGIN = "https://studio.sites.usemingla.com";
const PATH = "/api/internal/retention-sweep";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  return [
    value.schema_version,
    value.issuer,
    value.audience,
    value.direction,
    value.site_id,
    value.operation_id,
    value.issued_at,
    value.expires_at,
    value.nonce,
    value.method,
    value.path,
    value.body_sha256,
    value.kid,
  ].join("\n");
}

export function retentionEnvelope(env, {
  now = new Date(),
  operationId = randomUUID(),
  nonce = randomUUID(),
} = {}) {
  const siteId = requireUuid(requiredEnv(env, "SITES_PILOT_SITE_ID"));
  const origin = requiredEnv(env, "SITES_CMS_ORIGIN");
  if (origin !== CMS_ORIGIN) fail("CMS_ORIGIN_MISMATCH");
  const kid = requiredEnv(env, "MINGLA_CORE_TO_CMS_CURRENT_KID");
  if (!/^[A-Za-z0-9._-]{8,64}$/.test(kid)) fail("INVALID_CORE_TO_CMS_KID");
  const key = Buffer.from(
    requiredEnv(env, "MINGLA_CORE_TO_CMS_CURRENT_KEY_B64"),
    "base64",
  );
  if (key.byteLength !== 32) fail("INVALID_CORE_TO_CMS_KEY");
  const body = "{}";
  const unsigned = {
    schema_version: 1,
    issuer: "mingla-core",
    audience: "mingla-site-cms",
    direction: "core_to_cms",
    site_id: siteId,
    operation_id: requireUuid(operationId, "INVALID_OPERATION_ID"),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    nonce: requireUuid(nonce, "INVALID_NONCE"),
    method: "POST",
    path: PATH,
    body_sha256: sha256(body),
    kid,
  };
  return {
    body,
    envelope: {
      ...unsigned,
      signature_b64: createHmac("sha256", key)
        .update(canonical(unsigned))
        .digest("base64"),
    },
  };
}

export async function runSitesRetention({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  operationId = randomUUID(),
  nonce = randomUUID(),
} = {}) {
  const { body, envelope } = retentionEnvelope(env, {
    now,
    operationId,
    nonce,
  });
  const response = await fetchImpl(`${CMS_ORIGIN}${PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mingla-sites-envelope": Buffer.from(JSON.stringify(envelope))
        .toString("base64"),
    },
    body,
    cache: "no-store",
    redirect: "error",
  });
  const value = await response.json().catch(() => null);
  const data = value?.data;
  if (
    !response.ok || value?.ok !== true ||
    !data || typeof data !== "object" || Array.isArray(data)
  ) fail("RETENTION_SWEEP_FAILED");
  const exactKeys = [
    "protected_artifacts", "protected_media", "purged_artifacts", "purged_media",
  ];
  if (
    JSON.stringify(Object.keys(data).sort()) !== JSON.stringify(exactKeys.sort()) ||
    exactKeys.some((key) => !Number.isSafeInteger(data[key]) || data[key] < 0)
  ) fail("RETENTION_SWEEP_READBACK_INVALID");
  process.stdout.write(
    `SITES_RETENTION_OK purged_media=${data.purged_media} purged_artifacts=${data.purged_artifacts}\n`,
  );
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSitesRetention().catch((error) => {
    const code = error?.code || error?.message || "RETENTION_SWEEP_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  });
}
