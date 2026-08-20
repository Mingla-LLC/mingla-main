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

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const KEY = "issue-2060-independent-attestation-key-32-bytes";
const ROLES = [
  "owner",
  "applicable_member",
  "below_threshold",
  "revoked",
  "outsider",
];

function certifiableInputs() {
  const loaded = loadCertificationInputs();
  const ledger = structuredClone(loaded.ledger);
  for (const row of ledger.capabilities) {
    if (!["guided_handoff", "unsupported"].includes(row.status)) {
      row.status = "verified";
    }
  }
  return { ledger, owners: loaded.owners };
}

function uuid(prefix, ordinal) {
  return `${prefix}23e4567-e89b-42d3-a456-${String(ordinal).padStart(12, "0")}`;
}

function signedEvidence(plan, testerVerdict = "FAIL") {
  const artifacts = [
    "source",
    "agent_chat_bundle",
    "agent_confirm_bundle",
    "business_web",
    "business_ios_simulator",
    "business_ios_physical",
    "business_android",
  ].map((artifact_type) => ({
    artifact_type,
    artifact_id: `${artifact_type}-original`,
    release_sha: "a".repeat(40),
    sha256: "d".repeat(64),
  }));
  const evidence = {
    schema_version: 1,
    run: {
      ari_cert_run_id: RUN_ID,
      release_sha: "a".repeat(40),
      requirements_digest: plan.requirements_digest,
      function_versions: {
        agent_chat: "original-chat-v500",
        agent_confirm_action: "original-confirm-v501",
      },
      web_deployment: "original-web-deployment",
      release_artifacts: artifacts,
      native_artifacts: [
        {
          surface: "business_ios_simulator",
          artifact_id: "business_ios_simulator-original",
          runtime_version: "1.1.3",
          device: "Original iOS simulator",
        },
        {
          surface: "business_ios_physical",
          artifact_id: "business_ios_physical-original",
          runtime_version: "1.1.3",
          device: "Original physical iPhone",
        },
        {
          surface: "business_android",
          artifact_id: "business_android-original",
          runtime_version: "1.1.3",
          device: "Original Android",
        },
      ],
      tester_verdict: testerVerdict,
    },
    capabilities: plan.rows.map((row, rowIndex) => {
      const readback = ["guided_handoff", "unsupported"].includes(
          row.current_status,
        )
        ? null
        : `${row.canonical_readback_owner}:original`;
      let ordinal = rowIndex * 10_000;
      const scenario_evidence = row.required_scenarios.flatMap((scenario) =>
        row.required_surfaces.flatMap((surface) =>
          ROLES.map((role_case) => {
            ordinal += 1;
            const record = {
              run_id: RUN_ID,
              capability_id: row.capability_id,
              scenario,
              surface,
              tenant_case: role_case === "outsider"
                ? "outsider_tenant"
                : "owner_tenant",
              role_case,
              operation_id: uuid("0", ordinal),
              request_id: uuid("1", ordinal),
              client_turn_id: uuid("2", ordinal),
              execution_id: uuid("3", ordinal),
              artifact_type: surface === "business_ios"
                ? "business_ios_simulator"
                : surface === "business_android"
                ? "business_android"
                : "business_web",
              artifact_id: surface === "business_ios"
                ? "business_ios_simulator-original"
                : surface === "business_android"
                ? "business_android-original"
                : "business_web-original",
              canonical_readback_reference: readback,
              outcome: "passed",
              safe_evidence: {
                receipt_id: uuid("4", ordinal),
                readback_digest: "e".repeat(64),
                telemetry_event_id: uuid("5", ordinal),
              },
            };
            return {
              ...record,
              evidence_digest: scenarioEvidenceDigest(
                RUN_ID,
                row.capability_id,
                record,
              ),
            };
          })
        )
      );
      const capability = {
        capability_id: row.capability_id,
        status: row.current_status,
        surfaces: [...row.required_surfaces],
        scenarios: [...row.required_scenarios],
        canonical_readback: readback,
        tenant_role_matrix: "owner|applicable_member|below_threshold|revoked|outsider",
        scenario_evidence,
      };
      return {
        ...capability,
        evidence_digest: capabilityEvidenceDigest(RUN_ID, capability),
      };
    }),
    cleanup: { verified_zero_residue: true, manifest_digest: "c".repeat(64) },
    rollback: {
      rehearsed: true,
      prior_pair: "original-compatible-pair",
      stranded_operation_count: 0,
    },
  };
  evidence.run.server_attestation = signCertificationAttestation(
    evidence,
    "test-key-v1",
    KEY,
  );
  return evidence;
}

test("#2060 tester: server attestation binds the independent verdict and exact runtime/deploy proof", () => {
  const { ledger, owners } = certifiableInputs();
  const evidence = signedEvidence(buildCertificationPlan(ledger, owners));

  // Preserve the original signature while relabelling a failed, different
  // release drive as a successful one. Every changed field is release-critical.
  evidence.run.tester_verdict = "PASS";
  evidence.run.function_versions = {
    agent_chat: "forged-chat-version",
    agent_confirm_action: "forged-confirm-version",
  };
  evidence.run.web_deployment = "forged-web-deployment";
  evidence.run.native_artifacts = evidence.run.native_artifacts.map((item) => ({
    ...item,
    artifact_id: `forged-${item.surface}`,
    runtime_version: "forged-runtime",
    device: "forged-device",
  }));

  const result = validateCertificationEvidence(evidence, ledger, owners, {
    attestationSecret: KEY,
  });
  assert.equal(
    result.ok,
    false,
    "an HMAC from a failed/different runtime drive must not certify after unsigned metadata is relabelled",
  );
});

test("#2060 tester: certification requires scenario evidence from the physical iPhone", () => {
  const { ledger, owners } = certifiableInputs();
  const evidence = signedEvidence(
    buildCertificationPlan(ledger, owners),
    "PASS",
  );
  assert.equal(
    evidence.capabilities.some((row) =>
      row.scenario_evidence.some((record) =>
        record.artifact_type === "business_ios_physical"
      )
    ),
    false,
    "attack fixture intentionally has no physical-iPhone scenario proof",
  );

  const result = validateCertificationEvidence(evidence, ledger, owners, {
    attestationSecret: KEY,
  });
  assert.equal(
    result.ok,
    false,
    "a listed but never exercised physical artifact must not satisfy the runtime matrix",
  );
});

test("#2060 tester: venue plan rows retain both canonical dependency owners", () => {
  const { ledger, owners } = certifiableInputs();
  const plan = buildCertificationPlan(ledger, owners);
  const venueRows = plan.rows.filter((row) => row.domain === "venues");
  assert.ok(venueRows.length > 0, "canonical ledger must contain venue rows");
  for (const row of venueRows) {
    assert.deepEqual(
      row.dependency_issues,
      [1978, 1979],
      `${row.capability_id} must remain held on listing/claim and operations owners`,
    );
  }
});
