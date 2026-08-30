import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCertificationPlan,
  capabilityEvidenceDigest,
  loadCertificationInputs,
  scenarioEvidenceDigest,
  signCertificationAttestation,
  validateCertificationEvidence,
} from "../certify-capabilities.mjs";

const ATTESTATION_KEY = "issue-2060-test-attestation-key-32-bytes-minimum";

function passingEvidence(plan) {
  const evidence = {
    schema_version: 1,
    run: {
      ari_cert_run_id: "123e4567-e89b-42d3-a456-426614174000",
      release_sha: "a".repeat(40),
      requirements_digest: plan.requirements_digest,
      function_versions: { agent_chat: "v500", agent_confirm_action: "v501" },
      web_deployment: "business-web-deployment-1",
      release_artifacts: [
        "source",
        "agent_chat_bundle",
        "agent_confirm_bundle",
        "business_web",
        "business_ios_simulator",
        "business_ios_physical",
        "business_android",
      ].map((artifact_type) => ({
        artifact_type,
        artifact_id: `${artifact_type}-1`,
        release_sha: "a".repeat(40),
        sha256: "d".repeat(64),
      })),
      native_artifacts: [
        {
          surface: "business_ios_simulator",
          artifact_id: "business_ios_simulator-1",
          runtime_version: "1.1.3",
          device: "iPhone 17 Pro",
        },
        {
          surface: "business_ios_physical",
          artifact_id: "business_ios_physical-1",
          runtime_version: "1.1.3",
          device: "Physical iPhone",
        },
        {
          surface: "business_android",
          artifact_id: "business_android-1",
          runtime_version: "1.1.3",
          device: "Pixel 7",
        },
      ],
      tester_verdict: "PASS",
    },
    capabilities: plan.rows.map((row, rowIndex) => {
      const status = row.current_status === "guided_handoff"
        ? "guided_handoff"
        : row.current_status === "unsupported"
        ? "unsupported"
        : "verified";
      const canonicalReadback = row.current_status === "guided_handoff" ||
          row.current_status === "unsupported"
        ? null
        : `${row.canonical_readback_owner}:fixture`;
      const scenarioEvidence = row.required_scenarios.flatMap((
        scenario,
        scenarioIndex,
      ) =>
        row.required_surfaces.flatMap((surface) =>
          [
            "owner",
            "applicable_member",
            "below_threshold",
            "revoked",
            "outsider",
          ].map((role_case, roleIndex) => {
            const record = {
              run_id: "123e4567-e89b-42d3-a456-426614174000",
              capability_id: row.capability_id,
              scenario,
              surface,
              tenant_case: role_case === "outsider"
                ? "outsider_tenant"
                : "owner_tenant",
              role_case,
              operation_id: `023e4567-e89b-42d3-a456-${
                String(
                  100000000000 + rowIndex * 1000 + scenarioIndex * 10 +
                    roleIndex,
                ).slice(-12)
              }`,
              request_id: `123e4567-e89b-42d3-a456-${
                String(
                  100000000000 + rowIndex * 1000 + scenarioIndex * 10 +
                    roleIndex,
                ).slice(-12)
              }`,
              client_turn_id: `223e4567-e89b-42d3-a456-${
                String(
                  100000000000 + rowIndex * 1000 + scenarioIndex * 10 +
                    roleIndex,
                ).slice(-12)
              }`,
              execution_id: `323e4567-e89b-42d3-a456-${
                String(
                  100000000000 + rowIndex * 1000 + scenarioIndex * 10 +
                    roleIndex,
                ).slice(-12)
              }`,
              artifact_type: surface === "business_ios"
                ? "business_ios_simulator"
                : surface === "business_android"
                ? "business_android"
                : "business_web",
              artifact_id: surface === "business_ios"
                ? "business_ios_simulator-1"
                : surface === "business_android"
                ? "business_android-1"
                : "business_web-1",
              canonical_readback_reference: canonicalReadback,
              outcome: "passed",
              safe_evidence: {
                receipt_id: `423e4567-e89b-42d3-a456-${
                  String(
                    100000000000 + rowIndex * 1000 + scenarioIndex * 10 +
                      roleIndex,
                  ).slice(-12)
                }`,
                readback_digest: "e".repeat(64),
                telemetry_event_id: `523e4567-e89b-42d3-a456-${
                  String(
                    100000000000 + rowIndex * 1000 + scenarioIndex * 10 +
                      roleIndex,
                  ).slice(-12)
                }`,
              },
            };
            return {
              ...record,
              evidence_digest: scenarioEvidenceDigest(
                record.run_id,
                row.capability_id,
                record,
              ),
            };
          })
        )
      );
      const capability = {
        capability_id: row.capability_id,
        status,
        surfaces: row.required_surfaces,
        scenarios: row.required_scenarios,
        canonical_readback: canonicalReadback,
        tenant_role_matrix: "owner|applicable_member|below_threshold|revoked|outsider",
        scenario_evidence: scenarioEvidence,
      };
      return {
        ...capability,
        evidence_digest: capabilityEvidenceDigest(
          "123e4567-e89b-42d3-a456-426614174000",
          capability,
        ),
      };
    }),
    cleanup: { verified_zero_residue: true, manifest_digest: "c".repeat(64) },
    rollback: {
      rehearsed: true,
      prior_pair: "chat-v499+confirm-v500",
      stranded_operation_count: 0,
    },
  };
  evidence.run.server_attestation = signCertificationAttestation(
    evidence,
    "test-key-v1",
    ATTESTATION_KEY,
  );
  return evidence;
}

test("#2060 plan covers the current exact 132-row ledger with one cache/readback owner", () => {
  const { ledger, owners } = loadCertificationInputs();
  const plan = buildCertificationPlan(ledger, owners);
  assert.equal(plan.capability_count, 132);
  assert.equal(new Set(plan.rows.map((row) => row.capability_id)).size, 132);
  assert.equal(
    plan.rows.every((row) =>
      row.cache_owner_id && row.canonical_readback_owner
    ),
    true,
  );
});

test("#2060 current unverified/broken/in-flight ledger truth blocks false PASS", () => {
  const { ledger, owners } = loadCertificationInputs();
  const plan = buildCertificationPlan(ledger, owners);
  const result = validateCertificationEvidence(
    passingEvidence(plan),
    ledger,
    owners,
    { attestationSecret: ATTESTATION_KEY },
  );
  assert.equal(result.ok, false);
  assert.equal(
    result.failures.some((value) =>
      value.startsWith("ledger_not_certifiable:")
    ),
    true,
  );
});

test("#2060 rejects missing rows, SHA mismatch surfaces, dirty cleanup, and stranded rollback", () => {
  const { ledger, owners } = loadCertificationInputs();
  const plan = buildCertificationPlan(ledger, owners);
  const evidence = passingEvidence(plan);
  evidence.capabilities.pop();
  evidence.run.release_sha = "unattested";
  evidence.run.requirements_digest = "e".repeat(64);
  evidence.run.release_artifacts.find((item) =>
    item.artifact_type === "agent_chat_bundle"
  ).release_sha = "f".repeat(40);
  evidence.run.native_artifacts = evidence.run.native_artifacts.filter((item) =>
    item.surface !== "business_android"
  );
  evidence.cleanup.verified_zero_residue = false;
  evidence.rollback.stranded_operation_count = 1;
  const result = validateCertificationEvidence(evidence, ledger, owners, {
    attestationSecret: ATTESTATION_KEY,
  });
  assert.equal(result.ok, false);
  for (
    const prefix of [
      "release_sha_attested",
      "requirements_digest",
      "release_artifact_sha:agent_chat_bundle",
      "native_artifact:business_android",
      "evidence_capability_count:131",
      "cleanup_zero_residue",
      "rollback_no_stranded_operations",
    ]
  ) {
    assert.equal(result.failures.includes(prefix), true, prefix);
  }
});

test("#2060 does not allow manual status laundering", () => {
  const { ledger, owners } = loadCertificationInputs();
  const plan = buildCertificationPlan(ledger, owners);
  const evidence = passingEvidence(plan);
  const guided = evidence.capabilities.find((row) =>
    row.status === "guided_handoff"
  );
  assert.ok(guided);
  guided.status = "verified";
  guided.canonical_readback = "fabricated";
  const result = validateCertificationEvidence(evidence, ledger, owners, {
    attestationSecret: ATTESTATION_KEY,
  });
  assert.equal(
    result.failures.some((value) =>
      value.startsWith(`status_laundering:${guided.capability_id}`)
    ),
    true,
  );
});

test("#2060 server attestation defeats a forged file even when every public digest is recomputed", () => {
  const { ledger, owners } = loadCertificationInputs();
  const plan = buildCertificationPlan(ledger, owners);
  const evidence = passingEvidence(plan);
  const row = evidence.capabilities[0];
  const record = row.scenario_evidence[0];
  record.canonical_readback_reference = "forged:readback";
  const { evidence_digest: _oldRecordDigest, ...recordPayload } = record;
  record.evidence_digest = scenarioEvidenceDigest(
    evidence.run.ari_cert_run_id,
    row.capability_id,
    recordPayload,
  );
  const { evidence_digest: _oldRowDigest, ...rowPayload } = row;
  row.evidence_digest = capabilityEvidenceDigest(
    evidence.run.ari_cert_run_id,
    rowPayload,
  );

  const result = validateCertificationEvidence(evidence, ledger, owners, {
    attestationSecret: ATTESTATION_KEY,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures.includes("server_attestation:evidence_set_digest"), true);
  assert.equal(result.failures.includes("server_attestation:signature"), true);
});

test("#2060 certification cannot run without the server attestation key", () => {
  const { ledger, owners } = loadCertificationInputs();
  const plan = buildCertificationPlan(ledger, owners);
  const result = validateCertificationEvidence(passingEvidence(plan), ledger, owners, {
    attestationSecret: "",
  });
  assert.equal(result.failures.includes("server_attestation_key_required"), true);
});
