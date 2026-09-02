#!/usr/bin/env node
/**
 * One-process issue-2241 production reconciliation coordinator.
 *
 * Receipt authority is born and consumed in this process. No private key,
 * operation nonce, or authoritative receipt is accepted from or written to a
 * file, argv, environment, subprocess, log, or annotation.
 */

import {
  generateKeyPairSync,
  randomBytes,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyProductionAuthority } from "../ops/verify-production-supabase-authority.mjs";
import {
  auditFunctionSecretContract,
  buildRuntimeImportClosure,
  DEFAULT_CONTRACT,
  DEFAULT_MANIFEST,
} from "./audit-function-secret-contract.mjs";
import {
  assertLiveNameParity,
  listLiveSecretNames,
  runFunctionReadinessPreflight,
} from "./preflight-function-secret-readiness.mjs";
import {
  applyPreparedGovernedBundle,
  loadManifest,
  loadSecureBundleInput,
  prepareGovernedBundle,
} from "./set-governed-secret-bundle.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const RECEIPT_TTL_MS = 15 * 60 * 1000;
const RECEIPT_PAYLOAD_KEYS = [
  "bundle_name",
  "expires_at",
  "field_names",
  "issued_at",
  "kind",
  "merged_commit",
  "operation_nonce",
  "parser_pass",
  "preservation_pass",
  "project_ref",
  "schema_version",
  "selected_functions",
  "source_owner_attestation_pass",
];
const FORBIDDEN_RECEIPT_KEYS = new Set([
  "bytes",
  "credential_prefix",
  "digest",
  "fingerprint",
  "hash",
  "length",
  "prefix",
  "raw",
  "secret",
  "suffix",
  "value",
]);

export const ISSUE_2241_JWT_POSTURE = Object.freeze({
  "attendance-claim-backfill": false,
  "attendance-claim-identity": true,
  "attendance-claim-link": false,
  "brand-paystack-onboard": true,
  "brand-stripe-onboard": true,
  "checkout-sale-revocation": false,
  "claim-attendance": true,
  "competitor-intel-worker": false,
  "event-cancel-refund-fanout": false,
  "guest-roster-actions": true,
  "marketing-send": true,
  "notify-dispatch": true,
  "offering-invite-dispatch": true,
  "payout-release-sweep": false,
  "resend-webhook": false,
  "rsvp-contribution-refund": true,
  "rsvp-notify": true,
  "send-pair-request": true,
  "send-phone-invite": true,
  "send-venue-sms": true,
  "source-refund-sweep": false,
  "support-brand-person-erasure": true,
  "ticket-confirmation-dispatch": true,
  "venue-reservation-cancel": false,
});

export class ReconciliationError extends Error {
  constructor(code, publicNames = []) {
    super(code);
    this.name = "ReconciliationError";
    this.code = code;
    this.publicNames = [...new Set(publicNames)].sort();
  }
}

function exactKeys(value, expected) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort());
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function exactSet(left, right) {
  return JSON.stringify(sortedUnique(left)) ===
    JSON.stringify(sortedUnique(right));
}

function isSortedUniqueStringArray(value, pattern) {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && pattern.test(entry)) &&
    JSON.stringify(value) === JSON.stringify(sortedUnique(value));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${
      Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(value[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function forbiddenReceiptMetadata(value, path = "receipt", failures = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      forbiddenReceiptMetadata(entry, `${path}[${index}]`, failures)
    );
    return failures;
  }
  if (value === null || typeof value !== "object") return failures;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RECEIPT_KEYS.has(key.toLowerCase())) {
      failures.push(`${path}.${key}`);
    }
    forbiddenReceiptMetadata(child, `${path}.${key}`, failures);
  }
  return failures;
}

function validateReceiptPayload(payload) {
  if (
    !exactKeys(payload, RECEIPT_PAYLOAD_KEYS) ||
    !["applied_bundle", "prepared_transition"].includes(payload.kind) ||
    !/^[A-Z][A-Z0-9_]*$/.test(payload.bundle_name) ||
    !/^[a-z0-9]{20}$/.test(payload.project_ref) ||
    !/^[0-9a-f]{40}$/.test(payload.merged_commit) ||
    !/^[A-Za-z0-9_-]{16,}$/.test(payload.operation_nonce) ||
    !isSortedUniqueStringArray(
      payload.field_names,
      /^[A-Za-z_][A-Za-z0-9_.]*$/,
    ) ||
    !isSortedUniqueStringArray(
      payload.selected_functions,
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    ) ||
    (payload.schema_version !== null &&
      (!Number.isInteger(payload.schema_version) ||
        payload.schema_version < 1)) ||
    typeof payload.issued_at !== "string" ||
    typeof payload.expires_at !== "string" ||
    payload.source_owner_attestation_pass !== true ||
    payload.preservation_pass !== true ||
    payload.parser_pass !== true
  ) throw new ReconciliationError("receipt_shape_invalid");
}

export function createReceiptAuthority({
  now = () => Date.now(),
  nonce = randomBytes(32).toString("base64url"),
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  let consumed = false;

  function createReceipt({
    kind,
    projectRef,
    bundleName,
    schemaVersion,
    fieldNames,
    sourceOwnerAttestationPass,
    preservationPass,
    parserPass,
    mergedCommit,
    selectedFunctions,
  }) {
    if (consumed) {
      throw new ReconciliationError("receipt_nonce_already_consumed");
    }
    const issuedAt = now();
    const payload = {
      bundle_name: bundleName,
      expires_at: new Date(issuedAt + RECEIPT_TTL_MS).toISOString(),
      field_names: sortedUnique(fieldNames),
      issued_at: new Date(issuedAt).toISOString(),
      kind,
      merged_commit: mergedCommit,
      operation_nonce: nonce,
      parser_pass: parserPass,
      preservation_pass: preservationPass,
      project_ref: projectRef,
      schema_version: schemaVersion,
      selected_functions: sortedUnique(selectedFunctions),
      source_owner_attestation_pass: sourceOwnerAttestationPass,
    };
    validateReceiptPayload(payload);
    const signature = signBytes(
      null,
      Buffer.from(canonicalJson(payload)),
      privateKey,
    ).toString("base64url");
    return { payload, signature };
  }

  function verifyReceipt(receipt, expected) {
    if (
      receipt === null || typeof receipt !== "object" || Array.isArray(receipt)
    ) {
      throw new ReconciliationError("receipt_shape_invalid");
    }
    if (forbiddenReceiptMetadata(receipt.payload).length > 0) {
      throw new ReconciliationError("receipt_forbidden_metadata");
    }
    if (
      !exactKeys(receipt, ["payload", "signature"]) ||
      !exactKeys(receipt.payload, RECEIPT_PAYLOAD_KEYS) ||
      typeof receipt.signature !== "string"
    ) throw new ReconciliationError("receipt_shape_invalid");
    validateReceiptPayload(receipt.payload);
    if (
      !verifyBytes(
        null,
        Buffer.from(canonicalJson(receipt.payload)),
        publicKey,
        Buffer.from(receipt.signature, "base64url"),
      )
    ) throw new ReconciliationError("receipt_signature_invalid");
    const payload = receipt.payload;
    const issuedAt = Date.parse(payload.issued_at);
    const expiresAt = Date.parse(payload.expires_at);
    if (
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > RECEIPT_TTL_MS ||
      now() < issuedAt ||
      now() >= expiresAt
    ) throw new ReconciliationError("receipt_stale_or_invalid_window");
    if (payload.operation_nonce !== nonce) {
      throw new ReconciliationError("receipt_operation_nonce_mismatch");
    }
    if (
      !expected.kinds.includes(payload.kind) ||
      payload.project_ref !== expected.projectRef ||
      payload.bundle_name !== expected.bundleName ||
      payload.merged_commit !== expected.mergedCommit ||
      !exactSet(payload.selected_functions, expected.selectedFunctions) ||
      !exactSet(payload.field_names, expected.fieldNames) ||
      payload.source_owner_attestation_pass !== true ||
      payload.preservation_pass !== true ||
      payload.parser_pass !== true
    ) {
      throw new ReconciliationError("receipt_context_mismatch", [
        expected.bundleName,
      ]);
    }
  }

  function verifyReceiptSet(entries) {
    if (consumed) throw new ReconciliationError("receipt_replay_rejected");
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new ReconciliationError("receipt_set_empty");
    }
    for (const { receipt, expected } of entries) {
      verifyReceipt(receipt, expected);
    }
    consumed = true;
    return true;
  }

  return { createReceipt, verifyReceiptSet };
}

function deliveryComparable(bundle) {
  return {
    marketing_send_live_enabled: bundle.marketing_send_live_enabled,
    payment_operations: {
      paystack_payout_hold_onboard_flip:
        bundle.payment_operations.paystack_payout_hold_onboard_flip,
      payout_hold_onboard_flip:
        bundle.payment_operations.payout_hold_onboard_flip,
      payout_release_execute: bundle.payment_operations.payout_release_execute,
      source_refunds_post_disabled:
        bundle.payment_operations.source_refunds_post_disabled,
    },
    sms_live_enabled: bundle.sms_live_enabled,
  };
}

export function validateDeliveryTransition(currentV3, candidateV4) {
  if (currentV3.schema_version !== 3 || candidateV4.schema_version !== 4) {
    throw new ReconciliationError("delivery_transition_schema_invalid");
  }
  if (
    canonicalJson(deliveryComparable(currentV3)) !==
      canonicalJson(deliveryComparable(candidateV4))
  ) {
    throw new ReconciliationError(
      "delivery_transition_existing_controls_changed",
    );
  }
  if (
    typeof candidateV4.payment_operations.checkout_revocation_execute !==
      "boolean"
  ) {
    throw new ReconciliationError(
      "delivery_transition_checkout_attestation_invalid",
    );
  }
  return true;
}

function readConfigJwtPosture(configSource, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = new RegExp(
    `\\[functions\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[functions\\.|$)`,
  ).exec(configSource)?.[1];
  const declared = section &&
    /verify_jwt\s*=\s*(true|false)/.exec(section)?.[1];
  return declared === undefined ? true : declared === "true";
}

export function verifyJwtPostures(
  selectedFunctions,
  configSource = readFileSync(
    resolve(REPO_ROOT, "supabase", "config.toml"),
    "utf8",
  ),
) {
  for (const functionName of selectedFunctions) {
    if (
      !Object.hasOwn(ISSUE_2241_JWT_POSTURE, functionName) ||
      readConfigJwtPosture(configSource, functionName) !==
        ISSUE_2241_JWT_POSTURE[functionName]
    ) throw new ReconciliationError("jwt_posture_mismatch", [functionName]);
  }
  return true;
}

function defaultGitState(mergedCommit) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const dirty = git("status", "--porcelain");
  const head = git("rev-parse", "HEAD");
  const remoteMainOutput = git(
    "ls-remote",
    "--exit-code",
    "origin",
    "refs/heads/main",
  );
  const remoteMain = remoteMainOutput.split(/\s+/)[0] ?? "";
  const committedAtSeconds = Number(
    git("show", "-s", "--format=%ct", mergedCommit),
  );
  return {
    clean: dirty.length === 0,
    committedAtMs: committedAtSeconds * 1000,
    head,
    remoteMain,
  };
}

function verifyMergedState({ state, mergedCommit, maxAgeHours, nowMs }) {
  if (!state.clean) throw new ReconciliationError("git_worktree_not_clean");
  if (state.head !== mergedCommit || state.remoteMain !== mergedCommit) {
    throw new ReconciliationError("exact_merged_commit_required");
  }
  if (
    !Number.isFinite(state.committedAtMs) ||
    nowMs < state.committedAtMs ||
    (maxAgeHours !== undefined &&
      nowMs - state.committedAtMs > maxAgeHours * 60 * 60 * 1000)
  ) throw new ReconciliationError("remediation_window_expired");
}

export function deploySelectedFunctions({
  projectRef,
  selectedFunctions,
  spawn = spawnSync,
}) {
  verifyJwtPostures(selectedFunctions);
  for (const functionName of selectedFunctions) {
    const args = [
      "functions",
      "deploy",
      functionName,
      "--project-ref",
      projectRef,
      "--use-api",
    ];
    if (ISSUE_2241_JWT_POSTURE[functionName] === false) {
      args.push("--no-verify-jwt");
    }
    const result = spawn("supabase", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (
      result.status !== 0 &&
      !output.includes(
        'unexpected deploy status 409: {"message":"deployment already exists"}',
      )
    ) throw new ReconciliationError("function_deploy_failed", [functionName]);
  }
  return true;
}

export function verifyDownloadedFunctionSources({
  projectRef,
  selectedFunctions,
  spawn = spawnSync,
}) {
  verifyJwtPostures(selectedFunctions);
  const tempRoot = mkdtempSync(resolve(tmpdir(), "mingla-2241-source-"));
  try {
    for (const functionName of selectedFunctions) {
      const result = spawn(
        "supabase",
        [
          "functions",
          "download",
          functionName,
          "--project-ref",
          projectRef,
          "--use-api",
          "--workdir",
          tempRoot,
        ],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      );
      if (result.status !== 0) {
        throw new ReconciliationError("function_source_download_failed", [
          functionName,
        ]);
      }
      const downloadedEntrypoint = resolve(
        tempRoot,
        "supabase",
        "functions",
        functionName,
        "index.ts",
      );
      const localEntrypoint = resolve(
        REPO_ROOT,
        "supabase",
        "functions",
        functionName,
        "index.ts",
      );
      if (!existsSync(downloadedEntrypoint)) {
        throw new ReconciliationError("deployed_source_mismatch", [
          functionName,
        ]);
      }
      const localClosure = buildRuntimeImportClosure(
        localEntrypoint,
        REPO_ROOT,
      );
      const remoteClosure = buildRuntimeImportClosure(
        downloadedEntrypoint,
        tempRoot,
      );
      if (
        localClosure.failures.length > 0 ||
        remoteClosure.failures.length > 0
      ) {
        throw new ReconciliationError("deployed_source_closure_invalid", [
          functionName,
        ]);
      }
      const repoPath = (root, path) =>
        relative(root, path).split(sep).join("/");
      const localPaths = localClosure.files.map((path) =>
        repoPath(REPO_ROOT, path)
      );
      const remotePaths = remoteClosure.files.map((path) =>
        repoPath(tempRoot, path)
      );
      if (!exactSet(localPaths, remotePaths)) {
        throw new ReconciliationError("deployed_source_closure_mismatch", [
          functionName,
        ]);
      }
      for (const localPath of localPaths) {
        if (
          readFileSync(resolve(REPO_ROOT, localPath), "utf8") !==
            readFileSync(resolve(tempRoot, localPath), "utf8")
        ) {
          throw new ReconciliationError("deployed_source_mismatch", [
            functionName,
            localPath,
          ]);
        }
      }
    }
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
  return true;
}

/** Keep only public function names and the deployed JWT policy. */
export function reduceRemoteFunctionMetadata(raw) {
  let records;
  try {
    records = JSON.parse(raw);
  } catch {
    throw new ReconciliationError("remote_function_metadata_invalid");
  }
  if (!Array.isArray(records)) {
    throw new ReconciliationError("remote_function_metadata_invalid");
  }
  const reduced = [];
  for (const record of records) {
    const name = typeof record?.slug === "string"
      ? record.slug
      : typeof record?.name === "string"
      ? record.name
      : null;
    const verifyJwt = record?.verify_jwt;
    if (
      name === null ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
      typeof verifyJwt !== "boolean"
    ) throw new ReconciliationError("remote_function_metadata_invalid");
    reduced.push({ name, verify_jwt: verifyJwt });
  }
  return reduced.sort((left, right) => left.name.localeCompare(right.name));
}

export function verifyRemoteJwtPostures({
  projectRef,
  selectedFunctions,
  spawn = spawnSync,
}) {
  verifyJwtPostures(selectedFunctions);
  const result = spawn(
    "supabase",
    [
      "functions",
      "list",
      "--project-ref",
      projectRef,
      "--output",
      "json",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new ReconciliationError("remote_function_metadata_failed");
  }
  const metadata = reduceRemoteFunctionMetadata(result.stdout ?? "");
  const byName = new Map(metadata.map((record) => [record.name, record]));
  for (const functionName of selectedFunctions) {
    if (
      byName.get(functionName)?.verify_jwt !==
        ISSUE_2241_JWT_POSTURE[functionName]
    ) throw new ReconciliationError("remote_jwt_posture_mismatch", [
      functionName,
    ]);
  }
  return true;
}

function receiptFromPrepared(authority, kind, prepared, context) {
  return authority.createReceipt({
    kind,
    projectRef: context.projectRef,
    bundleName: prepared.bundleName,
    schemaVersion: prepared.schemaVersion,
    fieldNames: prepared.fieldNames,
    sourceOwnerAttestationPass: prepared.sourceOwnerAttestationPass,
    preservationPass: prepared.preservationPass,
    parserPass: prepared.parserPass,
    mergedCommit: context.mergedCommit,
    selectedFunctions: context.selectedFunctions,
  });
}

/**
 * Same-process normal deployment for functions that read governed bundles.
 * Complete authoritative objects are applied, their receipts are born and
 * consumed, and exact functions are deployed and verified before this call
 * returns. Receipt material is never accepted as input or persisted.
 */
export function runGovernedBundleDeployment({
  projectRef,
  mergedCommit,
  selectedFunctions,
  bundleInputs,
  now = () => Date.now(),
  dependencies = {},
}) {
  verifyProductionAuthority({ targetRef: projectRef });
  const audit = dependencies.audit ?? auditFunctionSecretContract;
  if (audit().length > 0) {
    throw new ReconciliationError("contract_audit_failed");
  }
  const contract = JSON.parse(readFileSync(DEFAULT_CONTRACT, "utf8"));
  const manifest = loadManifest(DEFAULT_MANIFEST);
  if (
    !Array.isArray(selectedFunctions) ||
    selectedFunctions.length === 0 ||
    new Set(selectedFunctions).size !== selectedFunctions.length ||
    selectedFunctions.some((name) => !Object.hasOwn(contract.functions, name))
  ) throw new ReconciliationError("normal_function_set_invalid");
  const gitState = (dependencies.gitState ?? defaultGitState)(mergedCommit);
  verifyMergedState({
    state: gitState,
    mergedCommit,
    nowMs: now(),
  });
  verifyJwtPostures(selectedFunctions);

  const requiredBundleNames = sortedUnique(
    selectedFunctions.flatMap((functionName) =>
      Object.keys(contract.functions[functionName].required_bundle_fields)
    ),
  );
  if (
    requiredBundleNames.length === 0 ||
    bundleInputs === null ||
    typeof bundleInputs !== "object" ||
    Array.isArray(bundleInputs) ||
    !exactSet(Object.keys(bundleInputs), requiredBundleNames)
  ) throw new ReconciliationError("normal_bundle_input_set_mismatch", [
    ...requiredBundleNames,
  ]);

  const liveNames = (dependencies.listLiveNames ?? listLiveSecretNames)({
    projectRef,
  });
  (dependencies.assertLiveParity ?? assertLiveNameParity)({
    contract,
    manifest,
    liveNames,
    projectRef,
    mode: "normal",
  });
  const prepare = dependencies.prepareBundle ?? prepareGovernedBundle;
  const apply = dependencies.applyBundle ?? applyPreparedGovernedBundle;
  const prepared = requiredBundleNames.map((bundleName) => {
    const result = prepare({ ...bundleInputs[bundleName], manifest });
    if (result.bundleName !== bundleName) {
      throw new ReconciliationError("normal_bundle_name_mismatch", [
        bundleName,
      ]);
    }
    return result;
  });

  const authority = createReceiptAuthority({ now });
  const context = { mergedCommit, projectRef, selectedFunctions };
  const receipts = prepared.map((candidate) => {
    const applied = apply({ prepared: candidate, projectRef, liveNames });
    return receiptFromPrepared(
      authority,
      "applied_bundle",
      applied,
      context,
    );
  });
  const expectedReceiptFields = Object.fromEntries(
    prepared.map((candidate) => [candidate.bundleName, candidate.fieldNames]),
  );
  (dependencies.preflight ?? runFunctionReadinessPreflight)({
    projectRef,
    selectedFunctions,
    mode: "normal",
    mergedCommit,
    receipts,
    expectedReceiptFields,
    verifyReceiptSet: authority.verifyReceiptSet,
    liveNames,
  });
  (dependencies.deploy ?? deploySelectedFunctions)({
    projectRef,
    selectedFunctions,
  });
  (dependencies.verifyDeployed ?? verifyDownloadedFunctionSources)({
    projectRef,
    selectedFunctions,
  });
  (dependencies.verifyRemoteJwt ?? verifyRemoteJwtPostures)({
    projectRef,
    selectedFunctions,
  });
  return {
    applied_bundles: requiredBundleNames,
    deployed_functions: sortedUnique(selectedFunctions),
    downloaded_source_verified: true,
    jwt_posture_verified: true,
    preflight_passed: true,
  };
}

/**
 * Full issue-2241 set → preflight → exact deploy → verify → delivery-v4 set.
 * Every dependency that can mutate production is injectable for adversarial
 * tests; defaults are the real value-silent implementations.
 */
export function runIssue2241Reconciliation({
  projectRef,
  mergedCommit,
  selectedFunctions,
  adInput,
  deliveryV3Input,
  deliveryV4Input,
  now = () => Date.now(),
  dependencies = {},
}) {
  verifyProductionAuthority({ targetRef: projectRef });
  const audit = dependencies.audit ?? auditFunctionSecretContract;
  const auditFailures = audit();
  if (auditFailures.length > 0) {
    throw new ReconciliationError("contract_audit_failed");
  }
  const contract = JSON.parse(readFileSync(DEFAULT_CONTRACT, "utf8"));
  const manifest = loadManifest(DEFAULT_MANIFEST);
  if (!exactSet(selectedFunctions, contract.remediation.selected_functions)) {
    throw new ReconciliationError("remediation_function_set_mismatch");
  }
  const gitState = (dependencies.gitState ?? defaultGitState)(mergedCommit);
  verifyMergedState({
    state: gitState,
    mergedCommit,
    maxAgeHours: contract.remediation.expires_after_merge_hours,
    nowMs: now(),
  });
  verifyJwtPostures(selectedFunctions);
  const liveNames = (dependencies.listLiveNames ?? listLiveSecretNames)({
    projectRef,
  });
  (dependencies.assertLiveParity ?? assertLiveNameParity)({
    contract,
    manifest,
    liveNames,
    projectRef,
    mode: "issue-2241-remediation",
  });
  const prepare = dependencies.prepareBundle ?? prepareGovernedBundle;
  const adPrepared = prepare({ ...adInput, manifest });
  const deliveryV3Prepared = prepare({ ...deliveryV3Input, manifest });
  const deliveryV4Prepared = prepare({ ...deliveryV4Input, manifest });
  if (
    adPrepared.bundleName !== "AD_CONVERSION_TOKENS" ||
    deliveryV3Prepared.bundleName !== "MINGLA_DELIVERY_FLAGS_JSON" ||
    deliveryV4Prepared.bundleName !== "MINGLA_DELIVERY_FLAGS_JSON"
  ) throw new ReconciliationError("bundle_sequence_invalid");
  validateDeliveryTransition(
    deliveryV3Prepared.bundleObject,
    deliveryV4Prepared.bundleObject,
  );

  const apply = dependencies.applyBundle ?? applyPreparedGovernedBundle;
  const receiptAuthority = createReceiptAuthority({ now });
  const context = { mergedCommit, projectRef, selectedFunctions };
  const adApplied = apply({ prepared: adPrepared, projectRef, liveNames });
  const adReceipt = receiptFromPrepared(
    receiptAuthority,
    "applied_bundle",
    adApplied,
    context,
  );
  const deliveryPreparedReceipt = receiptFromPrepared(
    receiptAuthority,
    "prepared_transition",
    deliveryV4Prepared,
    context,
  );

  const preflight = dependencies.preflight ?? runFunctionReadinessPreflight;
  preflight({
    projectRef,
    selectedFunctions,
    mode: "issue-2241-remediation",
    mergedCommit,
    receipts: [adReceipt, deliveryPreparedReceipt],
    expectedReceiptFields: {
      AD_CONVERSION_TOKENS: adPrepared.fieldNames,
      MINGLA_DELIVERY_FLAGS_JSON: deliveryV4Prepared.fieldNames,
    },
    verifyReceiptSet: receiptAuthority.verifyReceiptSet,
    liveNames,
  });

  (dependencies.deploy ?? deploySelectedFunctions)({
    projectRef,
    selectedFunctions,
  });
  (dependencies.verifyDeployed ?? verifyDownloadedFunctionSources)({
    projectRef,
    selectedFunctions,
  });
  (dependencies.verifyRemoteJwt ?? verifyRemoteJwtPostures)({
    projectRef,
    selectedFunctions,
  });

  const appliedDeliveryAuthority = createReceiptAuthority({ now });
  const deliveryApplied = apply({
    prepared: deliveryV4Prepared,
    projectRef,
    liveNames,
  });
  const deliveryAppliedReceipt = receiptFromPrepared(
    appliedDeliveryAuthority,
    "applied_bundle",
    deliveryApplied,
    context,
  );
  appliedDeliveryAuthority.verifyReceiptSet([{
    receipt: deliveryAppliedReceipt,
    expected: {
      bundleName: "MINGLA_DELIVERY_FLAGS_JSON",
      fieldNames: deliveryV4Prepared.fieldNames,
      kinds: ["applied_bundle"],
      mergedCommit,
      projectRef,
      selectedFunctions,
    },
  }]);
  return {
    ad_bundle_applied: true,
    delivery_v4_applied: true,
    deployed_functions: sortedUnique(selectedFunctions),
    downloaded_source_verified: true,
    jwt_posture_verified: true,
    preflight_passed: true,
  };
}

function parseArgs(argv) {
  const args = { normalGovernedDeploy: false, selectedFunctions: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--function") args.selectedFunctions.push(argv[++index]);
    else if (value === "--project-ref") args.projectRef = argv[++index];
    else if (value === "--merged-commit") args.mergedCommit = argv[++index];
    else if (value === "--normal-governed-deploy") {
      args.normalGovernedDeploy = true;
    }
    else if (value === "--ad-input") args.adPath = argv[++index];
    else if (value === "--delivery-input") {
      args.deliveryPath = argv[++index];
    }
    else if (value === "--delivery-v3-input") {
      args.deliveryV3Path = argv[++index];
    } else if (value === "--delivery-v4-input") {
      args.deliveryV4Path = argv[++index];
    } else throw new ReconciliationError("argument_invalid", [value]);
  }
  if (
    [args.adPath, args.deliveryV3Path, args.deliveryV4Path].filter((path) =>
      path === "-"
    ).length > 1
  ) {
    throw new ReconciliationError("stdin_may_supply_only_one_bundle");
  }
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.normalGovernedDeploy) {
      const bundleInputs = {};
      if (args.adPath !== undefined) {
        bundleInputs.AD_CONVERSION_TOKENS = loadSecureBundleInput(args.adPath);
      }
      if (args.deliveryPath !== undefined) {
        bundleInputs.MINGLA_DELIVERY_FLAGS_JSON = loadSecureBundleInput(
          args.deliveryPath,
        );
      }
      const result = runGovernedBundleDeployment({
        projectRef: args.projectRef,
        mergedCommit: args.mergedCommit,
        selectedFunctions: args.selectedFunctions,
        bundleInputs,
      });
      console.log(
        `PASS governed-bundle-deploy functions=${result.deployed_functions.length} ` +
          `bundles=${result.applied_bundles.length}`,
      );
      return;
    }
    const result = runIssue2241Reconciliation({
      projectRef: args.projectRef,
      mergedCommit: args.mergedCommit,
      selectedFunctions: args.selectedFunctions,
      adInput: loadSecureBundleInput(args.adPath),
      deliveryV3Input: loadSecureBundleInput(args.deliveryV3Path),
      deliveryV4Input: loadSecureBundleInput(args.deliveryV4Path),
    });
    console.log(
      `PASS issue-2241-reconciliation functions=${result.deployed_functions.length} ` +
        "bundles=2",
    );
  } catch (error) {
    const code = error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
      ? error.code
      : "reconciliation_failed";
    console.error(`FAIL issue-2241-reconciliation ${code}`);
    const names = error?.publicNames ?? error?.details ?? [];
    for (const name of names) console.error(`- ${name}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
