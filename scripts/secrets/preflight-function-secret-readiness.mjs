#!/usr/bin/env node
/**
 * Value-blind selected-function deploy preflight (#2241).
 *
 * Live CLI output is captured and immediately reduced to public names. This
 * module never emits values, metadata, hashes, prefixes, suffixes, or lengths.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyProductionAuthority } from "../ops/verify-production-supabase-authority.mjs";
import {
  DEFAULT_CONTRACT,
  DEFAULT_MANIFEST,
} from "./audit-function-secret-contract.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const SAFE_NAME = /^(?:[A-Z][A-Z0-9_]*|app\.qr_token_pepper)$/;

export class ReadinessError extends Error {
  constructor(code, details = []) {
    super(code);
    this.name = "ReadinessError";
    this.code = code;
    this.details = [...new Set(details)].sort();
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function exactSet(left, right) {
  return JSON.stringify(sortedUnique(left)) ===
    JSON.stringify(sortedUnique(right));
}

/**
 * Reduce the captured Supabase JSON to names before the caller can use it.
 * Accepted shapes cover current CLI array output and its documented wrapper.
 */
export function reduceLiveSecretNames(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new ReadinessError("secret_list_json_invalid");
  }
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.secrets)
    ? parsed.secrets
    : null;
  if (records === null) throw new ReadinessError("secret_list_shape_invalid");
  const names = [];
  for (const record of records) {
    const name = typeof record === "string" ? record : record?.name;
    if (typeof name !== "string" || !SAFE_NAME.test(name)) {
      throw new ReadinessError("secret_list_name_invalid");
    }
    names.push(name);
  }
  return sortedUnique(names);
}

export function listLiveSecretNames({
  projectRef,
  spawn = spawnSync,
} = {}) {
  const result = spawn(
    "supabase",
    ["secrets", "list", "--project-ref", projectRef, "--output", "json"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new ReadinessError("secret_list_failed");
  return reduceLiveSecretNames(result.stdout);
}

function functionRequirements(contract, selectedFunctions) {
  const requiredTopLevel = new Set();
  const requiredBundleFields = new Map();
  for (const functionName of selectedFunctions) {
    const record = contract.functions?.[functionName];
    if (!record) {
      throw new ReadinessError("selected_function_unknown", [functionName]);
    }
    for (const name of record.required_top_level) requiredTopLevel.add(name);
    for (
      const [bundleName, fields] of Object.entries(
        record.required_bundle_fields,
      )
    ) {
      if (!requiredBundleFields.has(bundleName)) {
        requiredBundleFields.set(bundleName, new Set());
      }
      for (const field of fields) {
        requiredBundleFields.get(bundleName).add(field);
      }
    }
  }
  return { requiredBundleFields, requiredTopLevel };
}

function receiptForBundle(receipts, bundleName, acceptedKinds) {
  const matches = receipts.filter((receipt) =>
    receipt?.payload?.bundle_name === bundleName &&
    acceptedKinds.includes(receipt?.payload?.kind)
  );
  if (matches.length !== 1) {
    throw new ReadinessError("bundle_receipt_missing_or_ambiguous", [
      bundleName,
    ]);
  }
  return matches[0];
}

/**
 * Value-blind parity gate that is safe to run before any mutating boundary.
 * Later readiness still verifies selected-function requirements and receipts.
 */
export function assertLiveNameParity({
  contract,
  manifest,
  liveNames,
  projectRef,
  mode = "normal",
}) {
  const platform = new Set(contract.platform_managed);
  const liveUserManaged = sortedUnique(
    liveNames.filter((name) => !platform.has(name)),
  );
  const manifestNames = sortedUnique(
    manifest.secrets.map((record) => record.name),
  );
  const remediation = contract.remediation;
  const bandNames = sortedUnique(remediation.allowed_extra_live_names);
  // #2241, founder-approved 2026-09-02. BOTH modes accept the approved
  // two-name migration band; only remediation REQUIRES it (and, below,
  // exactly 90). Normal mode used to expect the 88 declared names alone, so
  // every normal deploy was refused for a migration state the policy
  // explicitly permits — that is what pinned production on one revision.
  // Requiring the band here instead would be the mirror bug: the documented
  // removal order in docs/runbooks/SUPABASE_SECRET_CAPACITY.md takes live to
  // 89 and then to the exact 88-name target, and a check that cannot pass at
  // its own target state is the #2113 shape. So the band is TOLERATED, never
  // demanded. The comparison stays exact in both directions: a DECLARED name
  // that is absent still fails `missing:`, and any name outside
  // manifest+band still fails `unexpected:`.
  const requiredLive = mode === "issue-2241-remediation"
    ? sortedUnique([...manifestNames, ...bandNames])
    : manifestNames;
  const acceptedLive = sortedUnique([...manifestNames, ...bandNames]);

  if (projectRef !== remediation.production_ref) {
    throw new ReadinessError("wrong_project", [projectRef]);
  }
  const live = new Set(liveUserManaged);
  const accepted = new Set(acceptedLive);
  const missing = requiredLive.filter((name) => !live.has(name)).map((name) =>
    `missing:${name}`
  );
  const unexpected = liveUserManaged
    .filter((name) => !accepted.has(name))
    .map((name) => `unexpected:${name}`);
  if (missing.length > 0 || unexpected.length > 0) {
    throw new ReadinessError("live_name_set_mismatch", [
      ...missing,
      ...unexpected,
    ]);
  }
  if (
    mode === "issue-2241-remediation" &&
    liveUserManaged.length !== 90
  ) throw new ReadinessError("remediation_requires_exact_90");
  return { liveUserManaged, manifestNames, remediation };
}

/** Pure readiness evaluation used by the in-memory coordinator and tests. */
export function evaluateFunctionReadiness({
  contract,
  manifest,
  liveNames,
  selectedFunctions,
  projectRef,
  mergedCommit,
  mode = "normal",
  receipts = [],
  expectedReceiptFields = {},
  verifyReceiptSet = null,
}) {
  if (!Array.isArray(selectedFunctions) || selectedFunctions.length === 0) {
    throw new ReadinessError("explicit_function_selection_required");
  }
  if (new Set(selectedFunctions).size !== selectedFunctions.length) {
    throw new ReadinessError("selected_functions_duplicate");
  }
  const selected = sortedUnique(selectedFunctions);
  const { liveUserManaged, remediation } = assertLiveNameParity({
    contract,
    manifest,
    liveNames,
    projectRef,
    mode,
  });
  if (mode === "issue-2241-remediation") {
    if (!exactSet(selected, remediation.selected_functions)) {
      throw new ReadinessError("remediation_function_set_mismatch");
    }
  }

  const requirements = functionRequirements(contract, selected);
  const liveSet = new Set(liveUserManaged);
  const missingRequired = [...requirements.requiredTopLevel]
    .filter((name) => !liveSet.has(name));
  for (const bundleName of requirements.requiredBundleFields.keys()) {
    if (!liveSet.has(bundleName)) missingRequired.push(bundleName);
  }
  if (missingRequired.length > 0) {
    throw new ReadinessError("required_live_name_missing", missingRequired);
  }

  const receiptsToVerify = [];
  for (
    const [bundleName, requiredFields] of requirements.requiredBundleFields
  ) {
    const acceptedKinds = mode === "issue-2241-remediation" &&
        bundleName === "MINGLA_DELIVERY_FLAGS_JSON"
      ? ["prepared_transition", "applied_bundle"]
      : ["applied_bundle"];
    const receipt = receiptForBundle(receipts, bundleName, acceptedKinds);
    for (const field of requiredFields) {
      if (!receipt.payload.field_names.includes(field)) {
        throw new ReadinessError("receipt_required_field_missing", [
          `${bundleName}.${field}`,
        ]);
      }
    }
    receiptsToVerify.push({
      receipt,
      expected: {
        bundleName,
        fieldNames: expectedReceiptFields[bundleName],
        kinds: acceptedKinds,
        mergedCommit,
        projectRef,
        selectedFunctions: selected,
      },
    });
  }

  if (mode === "issue-2241-remediation") {
    const ad = receiptForBundle(receipts, "AD_CONVERSION_TOKENS", [
      "applied_bundle",
    ]);
    const adManifest = manifest.secrets.find((record) =>
      record.name === "AD_CONVERSION_TOKENS"
    );
    const requiredAd = new Set(
      adManifest.bundle_fields.map((field) => field.name),
    );
    for (const field of requiredAd) {
      const previous = field.includes("_PREVIOUS_") ||
        field.endsWith("_PREVIOUS");
      if (!previous && !ad.payload.field_names.includes(field)) {
        throw new ReadinessError("remediation_ad_field_missing", [field]);
      }
    }
    if (!receiptsToVerify.some((entry) => entry.receipt === ad)) {
      receiptsToVerify.push({
        receipt: ad,
        expected: {
          bundleName: "AD_CONVERSION_TOKENS",
          fieldNames: expectedReceiptFields.AD_CONVERSION_TOKENS,
          kinds: ["applied_bundle"],
          mergedCommit,
          projectRef,
          selectedFunctions: selected,
        },
      });
    }
    if (!liveSet.has("CHECKOUT_REVOCATION_EXECUTE")) {
      throw new ReadinessError("checkout_transition_fallback_missing");
    }
  }

  if (receiptsToVerify.length > 0) {
    if (typeof verifyReceiptSet !== "function") {
      throw new ReadinessError("in_memory_receipt_authority_required");
    }
    verifyReceiptSet(receiptsToVerify);
  }
  return {
    bundle_receipts: receiptsToVerify.length,
    live_user_managed_count: liveUserManaged.length,
    selected_functions: selected,
  };
}

export function runFunctionReadinessPreflight({
  projectRef,
  selectedFunctions,
  mode = "normal",
  mergedCommit,
  receipts = [],
  expectedReceiptFields = {},
  verifyReceiptSet = null,
  liveNames = null,
  contractPath = DEFAULT_CONTRACT,
  manifestPath = DEFAULT_MANIFEST,
  spawn = spawnSync,
} = {}) {
  verifyProductionAuthority({ targetRef: projectRef });
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const names = liveNames ?? listLiveSecretNames({ projectRef, spawn });
  return evaluateFunctionReadiness({
    contract,
    manifest,
    liveNames: names,
    selectedFunctions,
    projectRef,
    mergedCommit,
    mode,
    receipts,
    expectedReceiptFields,
    verifyReceiptSet,
  });
}

function parseArgs(argv) {
  const args = { functions: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--function") args.functions.push(argv[++index]);
    else if (value === "--project-ref") args.projectRef = argv[++index];
    else if (value === "--merged-commit") args.mergedCommit = argv[++index];
    else if (value === "--issue-2241-remediation") {
      args.mode = "issue-2241-remediation";
    } else throw new ReadinessError("argument_invalid", [value]);
  }
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runFunctionReadinessPreflight({
      projectRef: args.projectRef,
      selectedFunctions: args.functions,
      mode: args.mode,
      mergedCommit: args.mergedCommit,
    });
    console.log(
      `PASS function-secret-readiness functions=${result.selected_functions.length} ` +
        `live_names=${result.live_user_managed_count}`,
    );
  } catch (error) {
    const code = error instanceof ReadinessError
      ? error.code
      : "preflight_failed";
    console.error(`FAIL function-secret-readiness ${code}`);
    if (error instanceof ReadinessError) {
      for (const detail of error.details) console.error(`- ${detail}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
