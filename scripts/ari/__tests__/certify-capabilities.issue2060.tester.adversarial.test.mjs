import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

function evidenceFor(plan) {
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
      const canonicalReadback =
        ["guided_handoff", "unsupported"].includes(row.current_status)
          ? null
          : `${row.canonical_readback_owner}:fixture`;
      const scenarioEvidence = row.required_scenarios.flatMap((
        scenario,
        scenarioIndex,
      ) =>
        row.required_surfaces.flatMap((surface) =>
          (surface === "business_ios"
            ? ["business_ios_simulator", "business_ios_physical"]
            : surface === "business_android"
            ? ["business_android"]
            : ["business_web"]).flatMap((artifact_type, artifactIndex) =>
            [
            "owner",
            "applicable_member",
            "below_threshold",
            "revoked",
            "outsider",
          ].map((role_case, roleIndex) => {
            const suffix = String(
              100000000000 + rowIndex * 100000 + scenarioIndex * 100 +
                artifactIndex * 10 + roleIndex,
            ).slice(-12);
            const record = {
              run_id: "123e4567-e89b-42d3-a456-426614174000",
              capability_id: row.capability_id,
              scenario,
              surface,
              tenant_case: role_case === "outsider"
                ? "outsider_tenant"
                : "owner_tenant",
              role_case,
              operation_id: `023e4567-e89b-42d3-a456-${suffix}`,
              request_id: `123e4567-e89b-42d3-a456-${suffix}`,
              client_turn_id: `223e4567-e89b-42d3-a456-${suffix}`,
              execution_id: `323e4567-e89b-42d3-a456-${suffix}`,
              artifact_type,
              artifact_id: `${artifact_type}-1`,
              canonical_readback_reference: canonicalReadback,
              outcome: "passed",
              safe_evidence: {
                receipt_id: `423e4567-e89b-42d3-a456-${suffix}`,
                readback_digest: "e".repeat(64),
                telemetry_event_id: `523e4567-e89b-42d3-a456-${suffix}`,
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
          }))
        )
      );
      const capability = {
        capability_id: row.capability_id,
        status: row.current_status,
        surfaces: [...row.required_surfaces],
        scenarios: [...row.required_scenarios],
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

test("#2060 tester: the executable validator enforces its published JSON schema", () => {
  const { ledger, owners } = certifiableInputs();
  const plan = buildCertificationPlan(ledger, owners);
  const evidence = evidenceFor(plan);
  evidence.run.ari_cert_run_id = "not-a-uuid";
  evidence.run.unpublished_field = "schema says additionalProperties=false";
  evidence.capabilities[0].surfaces.push("consumer_ios");

  const result = validateCertificationEvidence(evidence, ledger, owners, {
    attestationSecret: ATTESTATION_KEY,
  });
  assert.equal(result.ok, false, "schema-invalid evidence must never certify");
});

test("#2060 tester: a row digest is bound to the evidence it claims to attest", () => {
  const { ledger, owners } = certifiableInputs();
  const plan = buildCertificationPlan(ledger, owners);
  const evidence = evidenceFor(plan);
  const before = validateCertificationEvidence(evidence, ledger, owners, {
    attestationSecret: ATTESTATION_KEY,
  });
  assert.equal(before.ok, true, before.failures.join("\n"));

  evidence.capabilities[0].tenant_role_matrix = "fabricated-after-digest";
  evidence.capabilities[0].canonical_readback = "fabricated-after-digest";
  const after = validateCertificationEvidence(evidence, ledger, owners, {
    attestationSecret: ATTESTATION_KEY,
  });
  assert.equal(
    after.ok,
    false,
    "mutating evidence without its digest must fail closed",
  );
});

test("#2060 tester: every Pass 4 owner is explicitly represented in dependency seams", () => {
  const { owners } = loadCertificationInputs();
  const seams = JSON.parse(readFileSync(
    resolve(
      "docs/contracts/ari-pass5-integration-seams.json",
    ),
    "utf8",
  ));
  const required = new Set([
    1971,
    1972,
    1973,
    1974,
    1975,
    1977,
    1978,
    1979,
    1985,
    2063,
  ]);
  const actual = new Set(
    Object.values(owners.domains)
      .flatMap((owner) =>
        Array.isArray(owner.dependency_issues)
          ? owner.dependency_issues
          : [owner.dependency_issue]
      )
      .filter((value) => Number.isInteger(value)),
  );
  for (const seam of seams.seams) actual.add(seam.owner_issue);

  for (const issue of required) {
    assert.equal(actual.has(issue), true, `missing dependency owner #${issue}`);
  }
});
