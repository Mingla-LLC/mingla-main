#!/usr/bin/env node

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "../..");
const LEDGER_PATH = resolve(ROOT, "docs/contracts/ari-capability-ledger.json");
const OWNERS_PATH = resolve(
  ROOT,
  "docs/contracts/ari-certification-domain-owners.json",
);
const SCHEMA_PATH = resolve(
  ROOT,
  "docs/contracts/ari-certification-evidence.schema.json",
);

export const READ_SCENARIOS = Object.freeze([
  "valid_result",
  "empty_result",
  "not_found",
  "malformed_args",
  "dependency_failure",
  "outsider_denial",
  "below_role_denial",
  "revoked_role_denial",
  "canonical_source_comparison",
]);

export const WRITE_SCENARIOS = Object.freeze([
  "proposal_zero_side_effect",
  "edit_exact_final_args",
  "cancel_zero_side_effect",
  "confirm_one_side_effect",
  "duplicate_confirm_no_second_side_effect",
  "concurrent_confirm_no_second_side_effect",
  "lost_ack_retry_no_second_side_effect",
  "canonical_readback_match",
  "cache_owner_refresh",
  "outsider_zero_side_effect",
  "below_role_zero_side_effect",
  "revoked_role_zero_side_effect",
  "revoked_after_proposal_zero_side_effect",
  "revoked_during_retry_zero_new_side_effect",
  "failure_or_unknown_is_honest",
]);

export const HANDOFF_SCENARIOS = Object.freeze([
  "accepted_wording",
  "concrete_route",
  "zero_side_effect",
  "no_fake_execution",
]);

export const UNSUPPORTED_SCENARIOS = Object.freeze([
  "accepted_wording",
  "zero_side_effect",
  "no_fake_execution",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function scenariosFor(capability) {
  if (capability.status === "guided_handoff") return [...HANDOFF_SCENARIOS];
  if (capability.status === "unsupported") return [...UNSUPPORTED_SCENARIOS];
  return capability.safety === "read"
    ? [...READ_SCENARIOS]
    : [...WRITE_SCENARIOS];
}

export function loadCertificationInputs() {
  return {
    ledger: readJson(LEDGER_PATH),
    owners: readJson(OWNERS_PATH),
    schema: readJson(SCHEMA_PATH),
  };
}

export function buildCertificationPlan(ledger, owners) {
  if (
    !Array.isArray(ledger.capabilities) || ledger.capabilities.length !== 132
  ) {
    throw new Error(
      `ledger_capability_count:${ledger.capabilities?.length ?? "missing"}`,
    );
  }
  const ids = new Set();
  const rows = ledger.capabilities.map((capability) => {
    if (typeof capability.id !== "string" || ids.has(capability.id)) {
      throw new Error(
        `duplicate_or_invalid_capability_id:${String(capability.id)}`,
      );
    }
    ids.add(capability.id);
    const owner = owners.domains?.[capability.domain];
    if (!owner) {
      throw new Error(
        `missing_domain_owner:${capability.id}:${capability.domain}`,
      );
    }
    const dependencyIssues = Array.isArray(owner.dependency_issues)
      ? [...owner.dependency_issues]
      : Number.isInteger(owner.dependency_issue)
      ? [owner.dependency_issue]
      : [];
    return {
      capability_id: capability.id,
      domain: capability.domain,
      safety: capability.safety,
      current_status: capability.status,
      ari_tool: capability.ari_tool ?? null,
      required_role: capability.required_role,
      required_surfaces: capability.surfaces,
      cache_owner_id: owner.cache_owner_id,
      canonical_readback_owner: owner.readback_owner,
      dependency_issues: dependencyIssues,
      required_scenarios: scenariosFor(capability),
    };
  });
  return {
    schema_version: 1,
    source_ledger_schema_version: ledger.schema_version,
    capability_count: rows.length,
    requirements_digest: digestEvidence(
      rows.map(({ current_status: _status, ...row }) => row),
    ),
    rows,
  };
}

function requireValue(condition, code, failures) {
  if (!condition) failures.push(code);
}

function isHex(value, length) {
  return typeof value === "string" &&
    new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

function hasAll(actual, required) {
  const values = new Set(Array.isArray(actual) ? actual : []);
  return required.every((value) => values.has(value));
}

function sameMembers(actual, required) {
  return Array.isArray(actual) && actual.length === required.length &&
    hasAll(actual, required);
}

function valueTypeMatches(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (expected === "integer") return Number.isInteger(value);
  return typeof value === expected;
}

/** Execute the published schema rather than treating it as documentation. */
export function validatePublishedSchema(value, schema, path = "$") {
  const failures = [];
  const expectedTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
    ? [schema.type]
    : [];
  if (
    expectedTypes.length &&
    !expectedTypes.some((type) => valueTypeMatches(value, type))
  ) {
    return [`schema:${path}:type`];
  }
  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) {
    failures.push(`schema:${path}:const`);
  }
  if (
    schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))
  ) failures.push(`schema:${path}:enum`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      failures.push(`schema:${path}:minLength`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      failures.push(`schema:${path}:maxLength`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      failures.push(`schema:${path}:pattern`);
    }
    if (
      schema.format === "uuid" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value)
    ) {
      failures.push(`schema:${path}:format:uuid`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      failures.push(`schema:${path}:minItems`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      failures.push(`schema:${path}:maxItems`);
    }
    if (
      schema.uniqueItems &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    ) failures.push(`schema:${path}:uniqueItems`);
    if (schema.items) {
      value.forEach((item, index) =>
        failures.push(
          ...validatePublishedSchema(item, schema.items, `${path}[${index}]`),
        )
      );
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        failures.push(`schema:${path}.${required}:required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          failures.push(`schema:${path}.${key}:additionalProperty`);
        }
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        failures.push(
          ...validatePublishedSchema(value[key], child, `${path}.${key}`),
        );
      }
    }
  }
  return failures;
}

const CERT_ROLE_CASES = Object.freeze([
  "owner",
  "applicable_member",
  "below_threshold",
  "revoked",
  "outsider",
]);
const CERT_TENANT_ROLE_MATRIX = CERT_ROLE_CASES.join("|");

export const ARI_CERT_CANONICALIZATION = "ARI-CERT-TUPLE-V1";
const REQUIRED_NATIVE_SURFACES = Object.freeze([
  "business_ios_simulator",
  "business_ios_physical",
  "business_android",
]);

function canonicalScalar(value) {
  if (value === null || value === undefined) return "-1:";
  const text = String(value);
  return `${Buffer.byteLength(text, "utf8")}:${text}`;
}

/**
 * Versioned, length-prefixed UTF-8 bytes shared byte-for-byte with PostgreSQL.
 * Values may contain delimiters or newlines without changing tuple boundaries.
 */
export function canonicalCertificationTuple(kind, values) {
  if (typeof kind !== "string" || !Array.isArray(values)) {
    throw new TypeError("ari_cert_invalid_canonical_tuple");
  }
  return Buffer.from([
    ARI_CERT_CANONICALIZATION,
    canonicalScalar(kind),
    String(values.length),
    ...values.map(canonicalScalar),
  ].join("\n"), "utf8");
}

export function canonicalCertificationDigest(kind, values) {
  return createHash("sha256")
    .update(canonicalCertificationTuple(kind, values))
    .digest("hex");
}

export function inspectNativeArtifactManifest(nativeArtifacts, releaseArtifacts) {
  const failures = [];
  const bySurface = new Map();
  const items = Array.isArray(nativeArtifacts) ? nativeArtifacts : [];
  if (items.length !== REQUIRED_NATIVE_SURFACES.length) {
    failures.push(`native_artifact_count:${items.length}`);
  }
  for (const item of items) {
    const keys = Object.keys(item ?? {}).sort();
    if (keys.join("|") !== "artifact_id|device|runtime_version|surface") {
      failures.push(`native_artifact_shape:${item?.surface ?? "unknown"}`);
    }
    for (const [field, maxBytes] of [
      ["artifact_id", 256],
      ["runtime_version", 128],
      ["device", 256],
    ]) {
      const value = item?.[field];
      if (
        typeof value !== "string" || value.trim().length === 0 ||
        Buffer.byteLength(value, "utf8") > maxBytes
      ) failures.push(`native_artifact_${field}:${item?.surface ?? "unknown"}`);
    }
    if (bySurface.has(item?.surface)) {
      failures.push(`native_artifact_duplicate:${item?.surface}`);
    }
    bySurface.set(item?.surface, item);
  }
  for (const surface of REQUIRED_NATIVE_SURFACES) {
    if (!bySurface.has(surface)) failures.push(`native_artifact:${surface}`);
    const releaseArtifact = releaseArtifacts.find((item) =>
      item?.artifact_type === surface
    );
    if (
      !releaseArtifact ||
      bySurface.get(surface)?.artifact_id !== releaseArtifact.artifact_id
    ) failures.push(`native_artifact_release_correlation:${surface}`);
  }
  return { failures, bySurface };
}

function scenarioDigestValues(runId, capabilityId, record) {
  return [
    runId,
    capabilityId,
    record.scenario,
    record.surface,
    record.tenant_case,
    record.role_case,
    record.operation_id,
    record.request_id,
    record.client_turn_id,
    record.execution_id,
    record.artifact_type,
    record.artifact_id,
    record.canonical_readback_reference,
    record.outcome,
    record.safe_evidence?.receipt_id,
    record.safe_evidence?.readback_digest,
    record.safe_evidence?.telemetry_event_id,
  ];
}

export function scenarioEvidenceDigest(runId, capabilityId, record) {
  return canonicalCertificationDigest(
    "scenario-evidence",
    scenarioDigestValues(runId, capabilityId, record),
  );
}

export function capabilityEvidenceDigest(runId, row) {
  const scenarioDigests = [...(row.scenario_evidence ?? [])]
    .sort((a, b) =>
      [a.surface, a.artifact_type, a.scenario, a.role_case]
        .join("|").localeCompare(
          [b.surface, b.artifact_type, b.scenario, b.role_case].join("|"),
        )
    )
    .map((record) => record.evidence_digest);
  return canonicalCertificationDigest(
    "capability-evidence",
    [
      runId,
      row.capability_id,
      row.status,
      ...[...(row.surfaces ?? [])].sort(),
      ...[...(row.scenarios ?? [])].sort(),
      row.canonical_readback,
      row.tenant_role_matrix,
      ...scenarioDigests,
    ],
  );
}

export function certificationSetDigests(evidence) {
  const evidenceSet = (evidence.capabilities ?? [])
    .flatMap((row) => row.scenario_evidence ?? [])
    .sort((a, b) =>
      [a.capability_id, a.surface, a.artifact_type, a.scenario, a.role_case]
        .join("|").localeCompare(
          [b.capability_id, b.surface, b.artifact_type, b.scenario, b.role_case]
            .join("|"),
        )
    )
    .map((record) => record.evidence_digest);
  const artifactSet = [...(evidence.run?.release_artifacts ?? [])]
    .sort((a, b) => a.artifact_type.localeCompare(b.artifact_type))
    .map((artifact) =>
      canonicalCertificationDigest("release-artifact", [
        artifact.artifact_type,
        artifact.artifact_id,
        artifact.release_sha,
        artifact.sha256,
      ])
    );
  const capabilitySet = [...(evidence.capabilities ?? [])]
    .sort((a, b) => a.capability_id.localeCompare(b.capability_id))
    .flatMap((row) => [row.capability_id, row.evidence_digest]);
  const nativeArtifactSet = [...(evidence.run?.native_artifacts ?? [])]
    .sort((a, b) => a.surface.localeCompare(b.surface))
    .map((artifact) =>
      canonicalCertificationDigest("native-artifact", [
        artifact.surface,
        artifact.artifact_id,
        artifact.runtime_version,
        artifact.device,
      ])
    );
  const cleanupSet = [
    evidence.cleanup?.verified_zero_residue ?? null,
    evidence.cleanup?.manifest_digest ?? null,
  ];
  const rollbackSet = [
    evidence.rollback?.rehearsed ?? null,
    evidence.rollback?.prior_pair ?? null,
    evidence.rollback?.stranded_operation_count ?? null,
  ];
  const capabilitySetDigest = canonicalCertificationDigest(
    "capability-set",
    capabilitySet,
  );
  const nativeArtifactSetDigest = canonicalCertificationDigest(
    "native-artifact-set",
    nativeArtifactSet,
  );
  const cleanupDigest = canonicalCertificationDigest("cleanup", cleanupSet);
  const rollbackDigest = canonicalCertificationDigest("rollback", rollbackSet);
  const runManifestDigest = canonicalCertificationDigest("run-manifest", [
    evidence.run?.function_versions?.agent_chat ?? null,
    evidence.run?.function_versions?.agent_confirm_action ?? null,
    evidence.run?.web_deployment ?? null,
    evidence.run?.tester_verdict ?? null,
    nativeArtifactSetDigest,
    capabilitySetDigest,
    cleanupDigest,
    rollbackDigest,
  ]);
  return {
    evidence_set_digest: canonicalCertificationDigest(
      "evidence-set",
      evidenceSet,
    ),
    artifact_set_digest: canonicalCertificationDigest(
      "artifact-set",
      artifactSet,
    ),
    capability_set_digest: capabilitySetDigest,
    native_artifact_set_digest: nativeArtifactSetDigest,
    cleanup_digest: cleanupDigest,
    rollback_digest: rollbackDigest,
    run_manifest_digest: runManifestDigest,
  };
}

export function signCertificationAttestation(evidence, keyId, secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("certification_attestation_key_required");
  }
  const digests = certificationSetDigests(evidence);
  const payload = canonicalCertificationTuple("attestation", [
    keyId,
    evidence.run.ari_cert_run_id,
    evidence.run.release_sha,
    evidence.run.requirements_digest,
    digests.evidence_set_digest,
    digests.artifact_set_digest,
    digests.capability_set_digest,
    digests.native_artifact_set_digest,
    digests.cleanup_digest,
    digests.rollback_digest,
    digests.run_manifest_digest,
  ]);
  return {
    algorithm: "HMAC-SHA256",
    canonicalization: ARI_CERT_CANONICALIZATION,
    key_id: keyId,
    ...digests,
    signature: createHmac("sha256", secret).update(payload).digest("hex"),
  };
}

export function validateCertificationEvidence(
  evidence,
  ledger,
  owners,
  options = {},
) {
  const failures = [];
  const plan = buildCertificationPlan(ledger, owners);
  const schema = readJson(SCHEMA_PATH);
  failures.push(...validatePublishedSchema(evidence, schema));
  const attestationSecret = options.attestationSecret ??
    process.env.ARI_CERTIFICATION_ATTESTATION_KEY;
  if (typeof attestationSecret !== "string" || attestationSecret.length < 32) {
    failures.push("server_attestation_key_required");
  } else if (evidence?.run?.server_attestation) {
    const expected = signCertificationAttestation(
      evidence,
      evidence.run.server_attestation.key_id,
      attestationSecret,
    );
    for (
      const field of [
        "algorithm",
        "canonicalization",
        "key_id",
        "evidence_set_digest",
        "artifact_set_digest",
        "capability_set_digest",
        "native_artifact_set_digest",
        "cleanup_digest",
        "rollback_digest",
        "run_manifest_digest",
      ]
    ) {
      requireValue(
        evidence.run.server_attestation[field] === expected[field],
        `server_attestation:${field}`,
        failures,
      );
    }
    const actualSignature = evidence.run.server_attestation.signature;
    requireValue(
      isHex(actualSignature, 64) &&
        timingSafeEqual(
          Buffer.from(actualSignature, "hex"),
          Buffer.from(expected.signature, "hex"),
        ),
      "server_attestation:signature",
      failures,
    );
  }
  requireValue(
    evidence?.schema_version === 1,
    "evidence_schema_version",
    failures,
  );
  requireValue(
    /^[0-9a-f]{40,64}$/.test(evidence?.run?.release_sha ?? ""),
    "release_sha_attested",
    failures,
  );
  requireValue(
    evidence?.run?.requirements_digest === plan.requirements_digest,
    "requirements_digest",
    failures,
  );
  requireValue(
    evidence?.run?.tester_verdict === "PASS",
    "independent_tester_pass",
    failures,
  );
  requireValue(
    typeof evidence?.run?.function_versions?.agent_chat === "string",
    "agent_chat_version",
    failures,
  );
  requireValue(
    typeof evidence?.run?.function_versions?.agent_confirm_action === "string",
    "agent_confirm_version",
    failures,
  );
  requireValue(
    typeof evidence?.run?.web_deployment === "string" &&
      evidence.run.web_deployment.length > 0,
    "web_deployment",
    failures,
  );

  const requiredArtifactTypes = [
    "source",
    "agent_chat_bundle",
    "agent_confirm_bundle",
    "business_web",
    "business_ios_simulator",
    "business_ios_physical",
    "business_android",
  ];
  const releaseArtifacts = Array.isArray(evidence?.run?.release_artifacts)
    ? evidence.run.release_artifacts
    : [];
  requireValue(
    releaseArtifacts.length === 7,
    `release_artifact_count:${releaseArtifacts.length}`,
    failures,
  );
  for (const artifactType of requiredArtifactTypes) {
    const matches = releaseArtifacts.filter((item) =>
      item?.artifact_type === artifactType
    );
    requireValue(
      matches.length === 1,
      `release_artifact:${artifactType}`,
      failures,
    );
    if (matches.length === 1) {
      requireValue(
        matches[0].release_sha === evidence?.run?.release_sha,
        `release_artifact_sha:${artifactType}`,
        failures,
      );
      requireValue(
        isHex(matches[0].sha256, 64),
        `release_artifact_digest:${artifactType}`,
        failures,
      );
      requireValue(
        typeof matches[0].artifact_id === "string" &&
          matches[0].artifact_id.length > 0,
        `release_artifact_id:${artifactType}`,
        failures,
      );
    }
  }

  const nativeInspection = inspectNativeArtifactManifest(
    evidence?.run?.native_artifacts,
    releaseArtifacts,
  );
  failures.push(...nativeInspection.failures);
  const nativeBySurface = nativeInspection.bySurface;

  const rows = Array.isArray(evidence?.capabilities)
    ? evidence.capabilities
    : [];
  requireValue(
    rows.length === 132,
    `evidence_capability_count:${rows.length}`,
    failures,
  );
  const evidenceById = new Map();
  for (const row of rows) {
    if (evidenceById.has(row?.capability_id)) {
      failures.push(`duplicate_evidence:${row?.capability_id}`);
    }
    evidenceById.set(row?.capability_id, row);
  }

  for (const planned of plan.rows) {
    const row = evidenceById.get(planned.capability_id);
    if (!row) {
      failures.push(`missing_evidence:${planned.capability_id}`);
      continue;
    }
    const statusAllowed = planned.current_status === "guided_handoff"
      ? row.status === "guided_handoff"
      : planned.current_status === "unsupported"
      ? row.status === "unsupported"
      : row.status === "verified";
    requireValue(
      statusAllowed,
      `status_laundering:${planned.capability_id}:${planned.current_status}->${row.status}`,
      failures,
    );
    requireValue(
      sameMembers(row.surfaces, planned.required_surfaces),
      `surface_gap:${planned.capability_id}`,
      failures,
    );
    requireValue(
      sameMembers(row.scenarios, planned.required_scenarios),
      `scenario_gap:${planned.capability_id}`,
      failures,
    );
    requireValue(
      row.tenant_role_matrix === CERT_TENANT_ROLE_MATRIX,
      `role_matrix:${planned.capability_id}`,
      failures,
    );
    requireValue(
      isHex(row.evidence_digest, 64),
      `evidence_digest:${planned.capability_id}`,
      failures,
    );
    if (row.status === "verified") {
      requireValue(
        typeof row.canonical_readback === "string" &&
          row.canonical_readback.length > 0,
        `canonical_readback:${planned.capability_id}`,
        failures,
      );
    }
    const scenarioEvidence = Array.isArray(row.scenario_evidence)
      ? row.scenario_evidence
      : [];
    const scenarioKeys = new Set();
    for (const record of scenarioEvidence) {
      const key =
        `${record.scenario}|${record.surface}|${record.artifact_type}|${record.tenant_case}|${record.role_case}`;
      if (scenarioKeys.has(key)) {
        failures.push(
          `duplicate_scenario_evidence:${planned.capability_id}:${key}`,
        );
      }
      scenarioKeys.add(key);
      requireValue(
        record.run_id === evidence.run.ari_cert_run_id,
        `scenario_run:${planned.capability_id}:${key}`,
        failures,
      );
      requireValue(
        record.capability_id === planned.capability_id,
        `scenario_capability:${planned.capability_id}:${key}`,
        failures,
      );
      requireValue(
        scenarioEvidenceDigest(
          evidence.run.ari_cert_run_id,
          planned.capability_id,
          record,
        ) === record.evidence_digest,
        `scenario_digest:${planned.capability_id}:${key}`,
        failures,
      );
      const artifact = releaseArtifacts.find((candidate) =>
        candidate.artifact_type === record.artifact_type &&
        candidate.artifact_id === record.artifact_id
      );
      requireValue(
        Boolean(artifact),
        `scenario_artifact:${planned.capability_id}:${key}`,
        failures,
      );
      if (REQUIRED_NATIVE_SURFACES.includes(record.artifact_type)) {
        requireValue(
          nativeBySurface.get(record.artifact_type)?.artifact_id ===
            record.artifact_id,
          `native_scenario_artifact:${planned.capability_id}:${key}`,
          failures,
        );
      }
    }
    for (const scenario of planned.required_scenarios) {
      for (const surface of planned.required_surfaces) {
        const artifactTypes = surface === "business_ios"
          ? ["business_ios_simulator", "business_ios_physical"]
          : surface === "business_android"
          ? ["business_android"]
          : ["business_web"];
        for (const roleCase of CERT_ROLE_CASES) {
          const tenantCase = roleCase === "outsider"
            ? "outsider_tenant"
            : "owner_tenant";
          for (const artifactType of artifactTypes) {
            requireValue(
              scenarioKeys.has(
                `${scenario}|${surface}|${artifactType}|${tenantCase}|${roleCase}`,
              ),
              `scenario_matrix:${planned.capability_id}:${scenario}:${surface}:${artifactType}:${roleCase}`,
              failures,
            );
          }
        }
      }
    }
    if (row.status === "verified") {
      requireValue(
        scenarioEvidence.every((record) =>
          record.canonical_readback_reference === row.canonical_readback
        ),
        `canonical_readback_binding:${planned.capability_id}`,
        failures,
      );
    }
    requireValue(
      capabilityEvidenceDigest(evidence.run.ari_cert_run_id, row) ===
        row.evidence_digest,
      `bound_evidence_digest:${planned.capability_id}`,
      failures,
    );
    if (
      ["broken", "registered_unverified", "in_flight"].includes(
        planned.current_status,
      )
    ) {
      failures.push(
        `ledger_not_certifiable:${planned.capability_id}:${planned.current_status}`,
      );
    }
  }
  for (const id of evidenceById.keys()) {
    if (!plan.rows.some((row) => row.capability_id === id)) {
      failures.push(`unknown_evidence:${id}`);
    }
  }

  requireValue(
    evidence?.cleanup?.verified_zero_residue === true,
    "cleanup_zero_residue",
    failures,
  );
  requireValue(
    isHex(evidence?.cleanup?.manifest_digest, 64),
    "cleanup_manifest_digest",
    failures,
  );
  requireValue(
    evidence?.rollback?.rehearsed === true,
    "rollback_rehearsed",
    failures,
  );
  requireValue(
    evidence?.rollback?.stranded_operation_count === 0,
    "rollback_no_stranded_operations",
    failures,
  );
  requireValue(
    typeof evidence?.rollback?.prior_pair === "string" &&
      evidence.rollback.prior_pair.length > 0,
    "rollback_prior_pair",
    failures,
  );

  return {
    ok: failures.length === 0,
    failures,
    capabilityCount: plan.capability_count,
  };
}

export function digestEvidence(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function usage() {
  console.error(
    "Usage: node scripts/ari/certify-capabilities.mjs --plan | --validate <evidence.json>",
  );
  process.exitCode = 2;
}

if (
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { ledger, owners } = loadCertificationInputs();
  const [mode, value] = process.argv.slice(2);
  if (mode === "--plan") {
    process.stdout.write(
      `${JSON.stringify(buildCertificationPlan(ledger, owners), null, 2)}\n`,
    );
  } else if (mode === "--validate" && value) {
    const evidence = readJson(resolve(process.cwd(), value));
    const result = validateCertificationEvidence(evidence, ledger, owners, {
      attestationSecret: process.env.ARI_CERTIFICATION_ATTESTATION_KEY,
    });
    if (!result.ok) {
      for (const failure of result.failures) console.error(`FAIL ${failure}`);
      process.exitCode = 1;
    } else {
      console.log(
        `PASS ${result.capabilityCount} capabilities certified at ${evidence.run.release_sha}`,
      );
    }
  } else {
    usage();
  }
}
