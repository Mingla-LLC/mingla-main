#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FILES = {
  edge: "supabase/functions/_shared/agentReliability.ts",
  edgeHttp: "supabase/functions/_shared/agentReliabilityHttp.ts",
  agentChat: "supabase/functions/agent-chat/index.ts",
  agentConfirm: "supabase/functions/agent-confirm-action/index.ts",
  business: "mingla-business/src/services/agentReliability.ts",
  agentChatService: "mingla-business/src/services/agentChatService.ts",
  useAgentChat: "mingla-business/src/hooks/useAgentChat.ts",
  ledger: "docs/contracts/ari-capability-ledger.json",
  owners: "docs/contracts/ari-certification-domain-owners.json",
  observability: "docs/contracts/ari-observability.json",
  seams: "docs/contracts/ari-pass5-integration-seams.json",
  schema: "docs/contracts/ari-certification-evidence.schema.json",
  digest: "docs/contracts/ari-certification-digest-v1.json",
  certifier: "scripts/ari/certify-capabilities.mjs",
  migration: "supabase/migrations/20270504002060_issue_2060_ari_certification_foundation.sql",
<<<<<<< HEAD
  currentMigration: "supabase/migrations/20270609002830_issue_2830_mingla_sites_foundation.sql",
=======
  currentMigration: "supabase/migrations/20270521001978_issue_1978_ari_venue_listings_certification.sql",
  setDigestMigration: "supabase/migrations/20270529002060_issue_2060_ari_cert_requirements_set_digest.sql",
>>>>>>> 8b6decb29 (Replace the dual hardcoded digest literals with private.ari_cert_requirements_set_digest_v1() so begin_run stamps and finalize_run rechecks a content hash of ordered (capability_id, evidence_mode) rows. Same-count swaps now fail closed; the #2592 parity gate requires both halves call the helper.)
  invariants: "docs/INVARIANT_REGISTRY.md",
  rollback: "docs/runbooks/ARI_RELIABILITY_ROLLBACK.md",
  workflow: ".github/workflows/issue-2060-ari-reliability.yml",
  crossRuntimeGuard: "supabase/migrations/__tests__/issue_2060_ari_certification_cross_runtime.tester.pg17.test.sql",
  independentVerdictGuard: "supabase/migrations/__tests__/issue_2060_ari_certification_independent_verdict.tester.pg17.test.sql",
  unicodeBoundaryGuard: "supabase/migrations/__tests__/issue_2060_ari_certification_unicode_boundary.tester.pg17.test.sql",
};

function readLive() {
  return Object.fromEntries(Object.entries(FILES).map(([key, rel]) => {
    const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
    return [key, rel.endsWith(".json") ? JSON.parse(raw) : raw];
  }));
}

function need(source, values, label) {
  for (const value of values) assert.ok(source.includes(value), `${label}: missing ${value}`);
}

function errorTuples(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing registry ${marker}`);
  const block = source.slice(start, source.indexOf("});", start) + 3);
  const tuples = new Map();
  const entry = /^  ([A-Z_]+): \{([\s\S]*?)^  \},?/gm;
  for (const match of block.matchAll(entry)) {
    const retryability = match[2].match(/retryability: "([^"]+)"/)?.[1];
    const safeToRetry = match[2].match(/safeToRetry: (true|false)/)?.[1];
    const operationState = match[2].match(/operationState: "([^"]+)"/)?.[1];
    if (retryability && safeToRetry && operationState) {
      tuples.set(match[1], `${retryability}|${safeToRetry}|${operationState}`);
    }
  }
  return tuples;
}

export function checkContract(fixture) {
  assert.equal(fixture.ledger.capabilities.length, 132, "canonical ledger must stay exactly 132 rows");
  assert.equal(new Set(fixture.ledger.capabilities.map((row) => row.id)).size, 132, "capability IDs must be unique");
  for (const row of fixture.ledger.capabilities) {
    const owner = fixture.owners.domains?.[row.domain];
    assert.ok(owner, `missing certification owner for ${row.id}`);
    assert.ok(owner.cache_owner_id, `missing cache owner for ${row.id}`);
    assert.ok(owner.readback_owner, `missing readback owner for ${row.id}`);
  }
  assert.ok(
    fixture.owners.domains.venues.dependency_issues?.includes(1979),
    "venue operations must depend on #1979",
  );

  assert.equal(fixture.schema.properties.capabilities.minItems, 132, "evidence schema row floor");
  assert.equal(fixture.schema.properties.capabilities.maxItems, 132, "evidence schema row ceiling");
  assert.ok(
    fixture.schema.properties.capabilities.items.properties.scenario_evidence,
    "evidence schema must require structured scenario evidence",
  );
  assert.equal(fixture.schema.properties.cleanup.properties.verified_zero_residue.const, true, "cleanup must be true");
  assert.equal(fixture.schema.properties.rollback.properties.stranded_operation_count.const, 0, "rollback must strand zero");
  assert.equal(fixture.schema.properties.run.properties.native_artifacts.maxItems, 3, "native tuple ceiling");
  assert.equal(
    fixture.schema.properties.run.properties.server_attestation.properties.canonicalization.const,
    "ARI-CERT-TUPLE-V1",
    "attestation canonicalization",
  );
  assert.equal(fixture.digest.contract, "ARI-CERT-TUPLE-V1", "portable digest contract");

  const seamById = new Map(fixture.seams.seams.map((seam) => [seam.id, seam]));
  assert.equal(seamById.get("task_state_and_client_turn")?.owner_issue, 1985, "#1985 task-state owner");
  assert.equal(seamById.get("atomic_execution_receipt")?.owner_issue, 1972, "#1972 receipt owner");
  assert.equal(seamById.get("brand_domain_readback")?.owner_issue, 2063, "#2063 brand owner");
  assert.equal(seamById.get("task_state_and_client_turn")?.state, "ready", "#1985 seam must be ready");
  assert.equal(seamById.get("atomic_execution_receipt")?.state, "ready", "#1972 seam must be ready");
  assert.equal(seamById.get("brand_domain_readback")?.state, "ready", "#2063 brand seam must be ready");
  assert.equal(
    seamById.get("venue_operations_readback")?.state,
    "dependency_pending",
    "venue ops receipt-backed confirm alias remains dependency-pending",
  );
  assert.equal(fixture.observability.status, "hot_path_wired", "observability must reflect hot-path wire");
  for (const metric of ["dedupe_replay_count", "stuck_executing_count", "reconciliation_age_ms", "telemetry_missing_count"]) {
    assert.ok(fixture.observability.required_metrics.includes(metric), `missing observability metric ${metric}`);
  }
  for (const alert of ["canonical_readback_mismatch", "stuck_or_unknown_operation", "missing_telemetry"]) {
    assert.ok(fixture.observability.required_alerts.some((row) => row.id === alert), `missing observability alert ${alert}`);
  }

  need(fixture.edge, [
    "ARI_PROTOCOL_VERSION = 1",
    '"DEADLINE_EXCEEDED"',
    '"RESULT_UNKNOWN"',
    '"RECONCILIATION_REQUIRED"',
    '"MINIMUM_VERSION_REQUIRED"',
    "request_id: string",
    "client_turn_id: string | null",
    "execution_id: string | null",
    "release_sha: string",
    "function_version: string",
    "RELEASE_SHA_PATTERN.test(sha)",
    ": ARI_UNATTESTED_RELEASE",
    "createAriDeadline",
    "decideAriFinalization",
    "mapLegacyAriErrorCode",
    'event: "ari_reliability"',
    "tenant_ref: string | null",
    "sanitizeAriTelemetryEvent",
    "user_message: definition.userMessage",
  ], "edge reliability");

  need(fixture.edgeHttp, [
    "runWithAriRequest",
    "ariJsonResponse",
    "ariErrorResponse",
    "emitAriPhase",
    "successEnvelope",
    "errorEnvelope",
  ], "edge reliability HTTP");

  need(fixture.agentChat, [
    'from "../_shared/agentReliabilityHttp.ts"',
    "runWithAriRequest",
    "ariJsonResponse",
    "ariErrorResponse",
    'emitAriPhase("received"',
    'emitAriPhase("authorized"',
  ], "agent-chat hot-path wire");

  need(fixture.agentConfirm, [
    'from "../_shared/agentReliabilityHttp.ts"',
    "decideAriFinalization",
    "runWithAriRequest",
    "ariJsonResponse",
    "ariErrorResponse",
    'emitAriPhase("execution_claimed"',
    'emitAriPhase("canonical_readback"',
    "updateAriRequest({ executionId: body.pending_action_id })",
  ], "agent-confirm-action hot-path wire");

  need(fixture.agentChatService, [
    'from "./agentReliability"',
    "assertAriEnvelope",
    "unwrapAriDomainPayload",
    "allowUnattestedRelease",
  ], "Business agentChatService envelope unwrap");

  need(fixture.useAgentChat, [
    "canDispatchAriIntent",
    "reduceAriClientIntent",
    "createAriClientIntent",
  ], "useAgentChat recovery gate");

  need(fixture.business, [
    "stableId: string",
    '| "server_reconcile";',
    "canDispatchAriIntent",
    'reason: "offline"',
    'reason: "in_flight"',
    'reason: "server_reconcile"',
    'lastCode: "CORRELATION_MISMATCH"',
    "retryDelayMs",
    "assertAriEnvelope",
    "ARI_CLIENT_ERROR_REGISTRY",
    "authoritative pending action UUID",
    'case "reauthorized"',
    'event.operationState === "executing"',
    '? "in_flight"',
  ], "Business recovery");
  assert.deepEqual(
    [...errorTuples(fixture.business, "ARI_CLIENT_ERROR_REGISTRY").entries()],
    [...errorTuples(fixture.edge, "ARI_ERROR_REGISTRY").entries()],
    "edge and Business error tuples must remain exhaustive and identical",
  );
  assert.deepEqual(
    [...errorTuples(fixture.business, "ARI_CLIENT_SUCCESS_REGISTRY").entries()],
    [...errorTuples(fixture.edge, "ARI_SUCCESS_REGISTRY").entries()],
    "edge and Business success tuples must remain exhaustive and identical",
  );

  need(fixture.certifier, [
    "ledger.capabilities.length !== 132",
    '`ledger_not_certifiable:${planned.capability_id}',
    '`status_laundering:${planned.capability_id}',
    'verified_zero_residue === true',
    'stranded_operation_count === 0',
    'tester_verdict === "PASS"',
    "requirements_digest === plan.requirements_digest",
    "releaseArtifacts.length === 7",
    '"concurrent_confirm_no_second_side_effect"',
    '"revoked_during_retry_zero_new_side_effect"',
    '"business_ios_simulator"',
    '"business_ios_physical"',
    '"business_android"',
    "failures.push(...validatePublishedSchema(evidence, schema))",
    "capabilityEvidenceDigest",
    "scenarioEvidenceDigest",
    "canonicalCertificationTuple",
    "canonicalCertificationDigest",
    "inspectNativeArtifactManifest",
    "native_artifact_release_correlation",
    "export function signCertificationAttestation",
    "server_attestation_key_required",
    '"capability_set_digest"',
    '"native_artifact_set_digest"',
    '"cleanup_digest"',
    '"rollback_digest"',
    '"run_manifest_digest"',
    'dependency_issues: dependencyIssues',
  ], "certifier");

  need(fixture.currentMigration, [
    "'ari.sites.read_site', 'read'",
    "'ari.sites.rollback', 'write'",
    "v_capability_count <> 132",
    "'capability_count', 132",
  ], "#2830 current certification upgrade");

  need(fixture.setDigestMigration, [
    "private.ari_cert_requirements_set_digest_v1",
    "'requirements-set'",
    "'requirement'",
    "v_requirements_digest := private.ari_cert_requirements_set_digest_v1()",
    "IS DISTINCT FROM private.ari_cert_requirements_set_digest_v1()",
  ], "#2060 Pass-5 requirements set digest");

  need(fixture.migration, [
    "CREATE TABLE IF NOT EXISTS public.ari_cert_runs",
    "CREATE TABLE IF NOT EXISTS public.ari_cert_evidence",
    "CREATE TABLE IF NOT EXISTS public.ari_cert_release_artifacts",
    "CREATE TABLE IF NOT EXISTS public.ari_cert_fixtures",
    "FORCE ROW LEVEL SECURITY",
    "ari_cert_evidence_is_immutable",
    "v_capability_count <> 116",
    "v_artifact_count <> 7",
    "cleanup_state <> 'removed'",
    "stranded_operation_count IS DISTINCT FROM 0",
    "requirements_digest text NOT NULL",
    "prior_compatible_pair",
    "ari_cert_capability_requirements",
    "ari_cert_terminal_status_requires_finalizer",
    "ari_cert_record_evidence",
    "ari_cert_missing_matrix_evidence",
    "ari_cert_invalid_evidence_digest",
    "ari_certification_attestation_key",
    "extensions.hmac",
    "private.ari_cert_verified_provenance",
    "ari_cert_unverified_provenance",
    "business_ios_physical",
    "v_run_manifest_digest",
    "private.ari_cert_canonical_tuple_v1",
    "private.ari_cert_digest_v1",
    "private.ari_cert_native_artifacts_valid",
    "ari_cert_invalid_native_artifacts",
  ], "certification migration");
  assert.ok(!fixture.migration.includes("CREATE TABLE public.agent_operation_receipts"), "must not duplicate #1972 receipt");
  assert.ok(!fixture.migration.includes("CREATE TABLE public.agent_task_state"), "must not duplicate #1985 state");

  for (const invariant of [
    "I-ARI-LOGICAL-TURN-ONCE (DRAFT)",
    "I-ARI-EXECUTION-ONCE (DRAFT)",
    "I-ARI-RESULT-HONESTY (DRAFT)",
    "I-ARI-RECOVERY-PARITY (DRAFT)",
    "I-ARI-CORRELATED-RELEASE-TRUTH (DRAFT)",
    "I-ARI-LEDGER-CERTIFICATION (DRAFT)",
  ]) need(fixture.invariants, [invariant], "invariant registry");
  need(fixture.rollback, [
    "Never roll back one",
    "Do not down-migrate additive #2060 tables",
    "zero stranded pending/executing/reconciling operations",
    "--validate /absolute/path/to/evidence.json",
  ], "rollback runbook");
  need(fixture.workflow, [
    "issue_2060_ari_reliability_foundation.test.ts",
    "issue_2060_ari_certification_foundation.test.ts",
    "certify-capabilities.issue2060.test.mjs",
    "agentReliability.issue2060.test.ts",
    "issue_2060_ari_envelope_wire.implementor.test.ts",
    "agentChatService.issue2060.wire.test.ts",
    "deno check supabase/functions/_shared/agentReliability.ts",
    "npx tsc --noEmit --pretty false",
    "issue_2060_ari_certification_cross_runtime.tester.pg17.test.sql",
    "issue_2060_ari_certification_independent_verdict.tester.pg17.test.sql",
    "issue_2060_ari_certification_canonical_digest.implementor.pg17.test.sql",
    "certify-capabilities.issue2060.canonical-digest.implementor.test.mjs",
    "certify-capabilities.issue2060.unicode-boundary.tester.adversarial.test.mjs",
    "issue_2060_ari_certification_unicode_boundary.tester.pg17.test.sql",
  ], "CI workflow");
  need(fixture.crossRuntimeGuard, [
    "issue_2060_cross_runtime_certification_not_correlated",
    "v_sql_digest <> v_js_digest",
    "v_incomplete_native_accepted",
  ], "cross-runtime certification guard");
  need(fixture.independentVerdictGuard, [
    "has_function_privilege",
    "ari_cert_record_completion(uuid,text,text,text,integer)",
    "has_table_privilege",
    "issue_2060_independent_verdict_boundary_open",
  ], "independent verdict certification guard");
  need(fixture.unicodeBoundaryGuard, [
    "issue_2060_unicode_node_pg_digest_mismatch",
    "issue_2060_unicode_value_not_bound",
    "issue_2060_invalid_native_begin_accepted",
    "issue_2060_invalid_native_finalize_accepted",
  ], "Unicode boundary certification guard");
}

function clone(value) {
  return structuredClone(value);
}

function bad(base, mutate, label) {
  const fixture = clone(base);
  mutate(fixture);
  assert.throws(() => checkContract(fixture), undefined, label);
}

function selfTest() {
  const good = readLive();
  checkContract(good);
  bad(good, (x) => x.ledger.capabilities.pop(), "reduced ledger");
  bad(good, (x) => { delete x.owners.domains.brands; }, "missing owner");
  bad(good, (x) => { x.seams.seams[0].owner_issue = 2060; }, "competing state owner");
  bad(good, (x) => { x.seams.seams[0].state = "dependency_pending"; }, "task-state seam reverted");
  bad(good, (x) => { x.observability.status = "integration_held_until_1972_1985_merge"; }, "observability held again");
  bad(good, (x) => { x.observability.required_alerts.pop(); }, "missing alert");
  bad(good, (x) => { x.edge = x.edge.replaceAll('"RESULT_UNKNOWN"', '"RESULT_LOST"'); }, "unknown result family");
  bad(good, (x) => { x.business = x.business.replaceAll('reason: "offline"', 'reason: "terminal"'); }, "offline gate");
  bad(good, (x) => { x.certifier = x.certifier.replace("ledger.capabilities.length !== 132", "false"); }, "row completeness");
  bad(good, (x) => { x.migration = x.migration.replace("ari_cert_evidence_is_immutable", "evidence_is_mutable"); }, "immutable evidence");
  bad(good, (x) => { x.invariants = x.invariants.replace("I-ARI-RESULT-HONESTY (DRAFT)", "I-ARI-RESULT-HONESTY (REMOVED)"); }, "result honesty invariant");
  bad(good, (x) => { x.rollback = x.rollback.replace("Do not down-migrate additive #2060 tables", "Down-migrate #2060 tables"); }, "forward rollback");
  bad(good, (x) => { x.workflow = x.workflow.replaceAll("agentReliability.issue2060.test.ts", "missing.test.ts"); }, "CI wiring");
  bad(good, (x) => { x.workflow = x.workflow.replaceAll("issue_2060_ari_certification_cross_runtime.tester.pg17.test.sql", "missing-cross-runtime.test.sql"); }, "cross-runtime CI wiring");
  bad(good, (x) => { x.crossRuntimeGuard = x.crossRuntimeGuard.replace("v_sql_digest <> v_js_digest", "false"); }, "cross-runtime digest bypass");
  bad(good, (x) => { x.owners.domains.venues.dependency_issues = [1978]; }, "missing venue operations owner");
  bad(good, (x) => { delete x.schema.properties.capabilities.items.properties.scenario_evidence; }, "schema evidence bypass");
  bad(good, (x) => { x.digest.contract = "JSONB-TEXT"; }, "portable digest contract removed");
  bad(good, (x) => { x.certifier = x.certifier.replaceAll("inspectNativeArtifactManifest", "trustNativeTuple"); }, "native tuple validation removed");
  bad(good, (x) => { x.edge = x.edge.replace("user_message: definition.userMessage", "user_message: options.userMessage"); }, "raw error echo");
  bad(good, (x) => { x.business = x.business.replace('ROLE_REVOKED: {', 'ROLE_REVOKED_REMOVED: {'); }, "error tuple drift");
  bad(good, (x) => { x.edge = x.edge.replace('operationState: "executed"', 'operationState: "pending"'); }, "success tuple drift");
  bad(good, (x) => { x.certifier = x.certifier.replace("validatePublishedSchema(evidence, schema)", "[]"); }, "schema not executed");
  bad(good, (x) => { x.migration = x.migration.replace("ari_cert_missing_matrix_evidence", "matrix_not_checked"); }, "forged matrix accepted");
  bad(good, (x) => { x.certifier = x.certifier.replace("signCertificationAttestation", "trustCallerAttestation"); }, "unsigned certification");
  bad(good, (x) => { x.migration = x.migration.replace("extensions.hmac", "caller_signature"); }, "server signature removed");
  bad(good, (x) => { x.migration = x.migration.replaceAll("private.ari_cert_verified_provenance", "private.unverified_claims"); }, "canonical provenance removed");
  bad(good, (x) => { x.setDigestMigration = x.setDigestMigration.replaceAll("ari_cert_requirements_set_digest_v1", "ari_cert_requirements_count_only"); }, "set-digest helper removed");
  bad(good, (x) => { x.workflow = x.workflow.replaceAll("issue_2060_ari_certification_unicode_boundary.tester.pg17.test.sql", "missing-unicode-boundary.test.sql"); }, "Unicode boundary CI wiring");
  bad(good, (x) => { x.unicodeBoundaryGuard = x.unicodeBoundaryGuard.replace("issue_2060_unicode_value_not_bound", "unicode_values_unbound"); }, "Unicode bound-field guard removed");
  bad(good, (x) => { x.agentChat = x.agentChat.replaceAll("agentReliabilityHttp", "agentReliabilityMissing"); }, "agent-chat wire removed");
  bad(good, (x) => { x.agentConfirm = x.agentConfirm.replaceAll("decideAriFinalization", "decideNothing"); }, "confirm finalization removed");
  console.log("issue-2060 self-test: 1 GOOD + 31 BAD fixtures passed");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  checkContract(readLive());
  console.log("issue-2060 Ari reliability foundation: PASS (132 capabilities; #2060 history remains 116)");
}
