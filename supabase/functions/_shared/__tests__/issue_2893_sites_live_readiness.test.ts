import {
  validReadinessEvidence,
  validRecoveryState,
} from "../../brand-site-cms-callback/index.ts";
import { verifySitesEnvelope } from "../sitesContracts.ts";
import { signCoreRequest } from "../../../../scripts/sites/lib/sites-ops.mjs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function quotedValues(source: string, constant: string): string[] {
  const body = source.match(
    new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\] as const;`),
  )?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
}

function base64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

Deno.test("#2893 Node ops envelopes verify against the Core implementation", async () => {
  const keyBytes = new Uint8Array(32).fill(9);
  const now = new Date("2026-08-31T12:00:00.000Z");
  const siteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const body = JSON.stringify({ schema_version: 1 });
  const path = `/internal/v1/sites/${siteId}/readiness-evidence`;
  const envelope = signCoreRequest(
    { kid: "cms-core-current", key: keyBytes },
    {
      siteId,
      operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      nonce: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      method: "POST",
      path,
      body,
      now,
    },
  );
  await verifySitesEnvelope({
    envelope,
    expectedAudience: "mingla-core",
    expectedDirection: "cms_to_core",
    method: "POST",
    path,
    body,
    keys: [{ kid: "cms-core-current", keyBytes }],
    now: new Date(now.getTime() + 1_000),
  });

  const duplicatedExpiryCanonical = [
    envelope.schema_version,
    envelope.issuer,
    envelope.audience,
    envelope.direction,
    envelope.site_id,
    envelope.operation_id,
    envelope.issued_at,
    envelope.expires_at,
    envelope.expires_at,
    envelope.nonce,
    envelope.method,
    envelope.path,
    envelope.body_sha256,
    envelope.kid,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const wrongSignature = base64(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(duplicatedExpiryCanonical),
  )));
  let rejected = false;
  try {
    await verifySitesEnvelope({
      envelope: { ...envelope, signature_b64: wrongSignature },
      expectedAudience: "mingla-core",
      expectedDirection: "cms_to_core",
      method: "POST",
      path,
      body,
      keys: [{ kid: "cms-core-current", keyBytes }],
      now: new Date(now.getTime() + 1_000),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "duplicate-expiry signature verified");
});

Deno.test("#2893 readiness callback accepts only the two exact v1 bodies", async () => {
  const callback = await Deno.readTextFile(
    new URL("../../brand-site-cms-callback/index.ts", import.meta.url),
  );
  assert(
    JSON.stringify(quotedValues(callback, "NIGHTLY_BACKUP_KEYS")) ===
      JSON.stringify([
        "backup_bundle_digest",
        "backup_retention_days",
        "database_backup_verified_at",
        "evidence_kind",
        "manifest_digest",
        "object_bytes",
        "object_count",
        "object_manifest_verified_at",
        "observed_at",
        "schema_version",
      ].sort()),
    "nightly_backup body is not exact",
  );
  assert(
    JSON.stringify(quotedValues(callback, "RESTORE_DRILL_KEYS")) ===
      JSON.stringify([
        "document_count",
        "evidence_kind",
        "object_bytes",
        "object_count",
        "observed_at",
        "restore_drill_evidence_digest",
        "restore_drill_verified_at",
        "schema_version",
        "tenant_count",
      ].sort()),
    "restore_drill body is not exact",
  );
  for (
    const token of [
      'value.evidence_kind === "nightly_backup"',
      'value.evidence_kind === "restore_drill"',
      "Number.isSafeInteger(value)",
      "database > now - 26 * 60 * 60_000",
      "restored > now - 100 * 24 * 60 * 60_000",
      '"brand_site_record_readiness_evidence"',
      "p_body_digest: await sitesSha256Hex(raw)",
    ]
  ) assert(callback.includes(token), `callback lost ${token}`);
});

Deno.test("#2893 readiness body validator rejects stale, malformed, and expanded input", () => {
  const now = Date.parse("2026-08-31T12:00:00.000Z");
  const nightly = {
    schema_version: 1,
    evidence_kind: "nightly_backup",
    observed_at: "2026-08-31T11:59:00.000Z",
    backup_retention_days: 7,
    database_backup_verified_at: "2026-08-31T11:00:00.000Z",
    object_manifest_verified_at: "2026-08-31T11:30:00.000Z",
    manifest_digest: "a".repeat(64),
    backup_bundle_digest: "b".repeat(64),
    object_count: 0,
    object_bytes: 0,
  };
  const restore = {
    schema_version: 1,
    evidence_kind: "restore_drill",
    observed_at: "2026-08-31T11:59:00.000Z",
    restore_drill_verified_at: "2026-08-30T10:00:00.000Z",
    restore_drill_evidence_digest: "c".repeat(64),
    tenant_count: 1,
    document_count: 1,
    object_count: 0,
    object_bytes: 0,
  };
  assert(validReadinessEvidence(nightly, now), "valid nightly rejected");
  assert(validReadinessEvidence(restore, now), "valid restore rejected");
  assert(
    !validReadinessEvidence({ ...nightly, provider_payload: {} }, now),
    "extra nightly key accepted",
  );
  assert(
    !validReadinessEvidence({ ...restore, tenant_count: 0 }, now),
    "zero-tenant restore accepted",
  );
  assert(
    !validReadinessEvidence({
      ...nightly,
      database_backup_verified_at: "2026-08-30T09:00:00.000Z",
    }, now),
    "stale backup accepted",
  );
  assert(
    !validReadinessEvidence({ ...nightly, object_bytes: 1.5 }, now),
    "fractional object bytes accepted",
  );
});

Deno.test("#2893 signed retention is bound through the Core projection", async () => {
  const callback = await Deno.readTextFile(
    new URL("../../brand-site-cms-callback/index.ts", import.meta.url),
  );
  const branch = callback.match(
    /if \(retentionMatch && req\.method === "GET"\) \{[\s\S]*?\n    \}/,
  )?.[0] ?? "";
  assert(
    branch.includes("siteId !== envelope.site_id"),
    "site envelope not bound",
  );
  assert(
    branch.includes('"brand_site_retention_protection"'),
    "retention bypasses Core binding",
  );
  assert(
    !branch.includes('.from("'),
    "retention directly reads a tenant table",
  );
});

// #2829 converted this test: a backup failure used to DISABLE the single
// bound pilot through a signed deactivation. That switch is gone (Seth
// 2026-10-12 D1: hold-and-page, never take sites down). The replacement is a
// recovery-state alert that names no host, brand or site to switch off.
Deno.test("#2893 backup failure records an alert and can disable nothing", async () => {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const valid = { schema_version: 1, state: "late", observed_at: now };
  assert(validRecoveryState(valid), "exact recovery-state body rejected");
  assert(
    !validRecoveryState({ ...valid, hostname: "any.sites.usemingla.com" }),
    "a host to switch off was accepted",
  );
  assert(
    !validRecoveryState({ ...valid, brand_id: crypto.randomUUID() }),
    "customer-supplied brand accepted",
  );
  assert(
    !validRecoveryState({ ...valid, state: "disabled" }),
    "unknown state accepted",
  );

  const callback = await Deno.readTextFile(
    new URL("../../brand-site-cms-callback/index.ts", import.meta.url),
  );
  const branch = callback.match(
    /if \(recoveryStateMatch && req\.method === "POST"\) \{[\s\S]*?\n    \}/,
  )?.[0] ?? "";
  for (
    const token of [
      "siteId !== envelope.site_id",
      '"brand_site_record_recovery_state"',
      "emitRecoveryAlert(",
    ]
  ) assert(branch.includes(token), `recovery callback lost ${token}`);
  for (const forbidden of ["deactivate", "pilot", "parsed.brand"]) {
    assert(!branch.includes(forbidden), `recovery callback contains ${forbidden}`);
  }
});

Deno.test("#2893 activation is forward-only, atomic, and service-only", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270613002893_issue_2893_sites_readiness_activation.sql",
      import.meta.url,
    ),
  );
  for (
    const token of [
      "brand_site_readiness_receipt_immutable",
      "host.status = 'pending' AND host.activated_at IS NULL",
      "pilot_enabled = true",
      "interval '26 hours'",
      "interval '100 days'",
      "interval '15 minutes'",
      "TO service_role, postgres",
      "brand_site_deactivate_gogi_pilot",
      "last_good_preserved",
    ]
  ) assert(migration.includes(token), `activation lost ${token}`);
  assert(
    migration.includes(
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\n  ON TABLE public.brand_site_service_config FROM service_role",
    ),
    "service role can bypass controlled configuration",
  );
  assert(
    !migration.includes(
      "GRANT EXECUTE ON FUNCTION public.brand_site_activate_gogi_pilot(uuid,uuid,text,uuid)\n  TO authenticated",
    ),
    "activation became customer executable",
  );
});

Deno.test("#2893 deployment owner is an exact non-pruning four-function wrapper", async () => {
  const wrapper = await Deno.readTextFile(
    new URL(
      "../../../../scripts/ops/deploy-sites-edge-functions.sh",
      import.meta.url,
    ),
  );
  const allowlist = wrapper.match(/FUNCTIONS=\([\s\S]*?\n\)/)?.[0] ?? "";
  const names = [...allowlist.matchAll(/\n  (brand-site-[a-z-]+)/g)].map((m) =>
    m[1]
  );
  assert(names.length === 4, `expected four functions, found ${names.length}`);
  assert(wrapper.includes("--use-api"), "API deployment pin missing");
  assert(!wrapper.includes("--prune"), "wrapper may never prune functions");
  assert(!wrapper.includes("db push"), "wrapper may never apply migrations");
});
