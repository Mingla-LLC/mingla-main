#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const CONTRACT_PATH = path.join(REPO_ROOT, "supabase/function-env.contract.json");
export const CONFIG_PATH = path.join(REPO_ROOT, "supabase/config.toml");
export const CONTRACT_SHA256 = "d68d94e035654bb5ad55682a267d1eddb421990b058f67f5a46b58c27ed5e217";
export const CONFIG_SHA256 = "a6a0dc681a4054abd83c77613c1ea5ba1ca839bf6f989658c59c6addbfc4c771";
export const FUNCTION_POLICY_FILE = "function-policy.json";
export const SHARED_POLICY_SUFFIX = ".function-policy.json";

const SHA256 = /^[a-f0-9]{64}$/;
const ISSUE = /^#[1-9][0-9]*$/;
const ENV_NAME = /^(?:[A-Z][A-Z0-9_]*|app\.qr_token_pepper)$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const FUNCTION_ENV_KEYS = [
  "migration_fallback_top_level", "optional_top_level",
  "required_bundle_fields", "required_top_level",
];
const ENV_CLASSIFICATIONS = new Set([
  "required_top_level", "optional_top_level", "migration_fallback_top_level",
]);
const SHARED_ARRAY_FIELDS = new Set([
  "allowed_top_level", "dynamic_getters", "local_call_identifiers", "closure_call_identifiers",
]);
const SHARED_MAP_FIELDS = new Set([
  "allowed_bundle_fields", "allowed_call_expressions", "allowed_identifier_references",
]);
const SHARED_REQUIRED_FIELDS = [
  "allowed_top_level", "dynamic_getters", "local_call_identifiers",
  "closure_call_identifiers", "allowed_bundle_fields",
];

function fail(code, detail = "") {
  throw new Error(`${code}${detail ? `:${detail}` : ""}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isObject(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sortedUniqueStrings(value, pattern = null) {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0 &&
      (pattern === null || pattern.test(entry))) &&
    JSON.stringify(value) === JSON.stringify([...new Set(value)].sort());
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    const members = value.map(canonicalize);
    return [...new Map(members.map((member) => [JSON.stringify(member), member])).values()]
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function policySha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function readSealed(file, expected, label) {
  const raw = fs.readFileSync(file);
  const actual = crypto.createHash("sha256").update(raw).digest("hex");
  if (actual !== expected) fail(`${label}:bootstrap_seal_mismatch`, `${actual}:expected=${expected}`);
  return raw.toString("utf8");
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

function listDiskFunctions(functionsRoot) {
  return fs.readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_shared" && fs.existsSync(path.join(functionsRoot, entry.name, "index.ts")))
    .map((entry) => entry.name)
    .sort();
}

function parseJwt(config) {
  const explicit = new Map();
  const block = /^\[functions\.([^\]]+)\]\s*\nverify_jwt\s*=\s*(true|false)\s*$/gm;
  for (const match of config.matchAll(block)) {
    if (explicit.has(match[1])) fail("config:duplicate_function", match[1]);
    explicit.set(match[1], match[2] === "true");
  }
  return explicit;
}

function readManifest(root) {
  const candidate = path.join(root, "supabase/secrets.manifest.json");
  const fallback = path.join(REPO_ROOT, "supabase/secrets.manifest.json");
  const manifest = JSON.parse(fs.readFileSync(fs.existsSync(candidate) ? candidate : fallback, "utf8"));
  return new Map((manifest.secrets ?? []).map((record) => [record.name, record]));
}

function validateBundleMap(bundleMap, label, manifest) {
  if (!isObject(bundleMap) || JSON.stringify(Object.keys(bundleMap)) !== JSON.stringify(Object.keys(bundleMap).sort())) {
    fail("policy:malformed_env", `${label}:required_bundle_fields`);
  }
  for (const [bundle, fields] of Object.entries(bundleMap)) {
    if (!ENV_NAME.test(bundle) || !sortedUniqueStrings(fields)) {
      fail("policy:malformed_env", `${label}:required_bundle_fields:${bundle}`);
    }
    const governed = manifest.get(bundle);
    if (!governed || !Array.isArray(governed.bundle_fields)) fail("policy:unowned_bundle", `${label}:${bundle}`);
    const allowed = new Set(governed.bundle_fields.map((field) => field.name));
    for (const field of fields) {
      if (!allowed.has(field)) fail("policy:unowned_bundle_field", `${label}:${bundle}:${field}`);
    }
  }
}

function validateEnvPolicy(policy, label, manifest) {
  if (!exactKeys(policy, FUNCTION_ENV_KEYS)) fail("policy:malformed_env", label);
  for (const key of ENV_CLASSIFICATIONS) {
    if (!sortedUniqueStrings(policy[key], ENV_NAME)) fail("policy:malformed_env", `${label}:${key}`);
  }
  validateBundleMap(policy.required_bundle_fields, label, manifest);
  const classifications = [
    ...policy.required_top_level, ...policy.optional_top_level,
    ...policy.migration_fallback_top_level, ...Object.keys(policy.required_bundle_fields),
  ];
  if (new Set(classifications).size !== classifications.length) fail("policy:classification_overlap", label);
  for (const name of policy.required_top_level) {
    if (!manifest.has(name)) fail("policy:unowned_required_name", `${label}:${name}`);
  }
}

function validateStringMap(value, label, field) {
  if (!isObject(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(Object.keys(value).sort())) {
    fail("policy:malformed_env", `${label}:${field}`);
  }
  for (const [key, members] of Object.entries(value)) {
    if (!IDENTIFIER.test(key) || !sortedUniqueStrings(members)) fail("policy:malformed_env", `${label}:${field}:${key}`);
  }
}

function validateSharedEnvPolicy(policy, label, manifest) {
  if (!isObject(policy) || SHARED_REQUIRED_FIELDS.some((key) => !Object.hasOwn(policy, key)) ||
      Object.keys(policy).some((key) => !SHARED_ARRAY_FIELDS.has(key) && !SHARED_MAP_FIELDS.has(key))) {
    fail("policy:malformed_env", label);
  }
  for (const key of SHARED_ARRAY_FIELDS) {
    const pattern = key === "allowed_top_level" ? ENV_NAME : key.endsWith("identifiers") ? IDENTIFIER : null;
    if (!sortedUniqueStrings(policy[key], pattern)) fail("policy:malformed_env", `${label}:${key}`);
  }
  const bundles = policy.allowed_bundle_fields;
  if (!isObject(bundles) || JSON.stringify(Object.keys(bundles)) !== JSON.stringify(Object.keys(bundles).sort())) {
    fail("policy:malformed_env", `${label}:allowed_bundle_fields`);
  }
  for (const [bundle, fields] of Object.entries(bundles)) {
    if (!ENV_NAME.test(bundle) || !sortedUniqueStrings(fields)) fail("policy:malformed_env", `${label}:allowed_bundle_fields:${bundle}`);
    const governed = manifest.get(bundle);
    const allowed = new Set(governed?.bundle_fields?.map((field) => field.name) ?? []);
    if (!governed) fail("policy:unowned_bundle", `${label}:${bundle}`);
    for (const field of fields) {
      if (!allowed.has(field)) fail("policy:unowned_bundle_field", `${label}:${bundle}:${field}`);
    }
  }
  for (const field of ["allowed_call_expressions", "allowed_identifier_references"]) {
    if (Object.hasOwn(policy, field)) validateStringMap(policy[field], label, field);
  }
}

function loadJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail("policy:malformed_declaration", `${label}:${error.message}`);
  }
}

function validatePatchEnvelope(patch, label, kind) {
  const expected = [
    "schemaVersion", "kind", "ownerIssue", "target", "basePolicySha256",
    "operations", "resultPolicySha256", "reason",
  ];
  if (!exactKeys(patch, expected) || patch.schemaVersion !== 1 || patch.kind !== kind ||
      !ISSUE.test(patch.ownerIssue) || !SHA256.test(patch.basePolicySha256) ||
      !SHA256.test(patch.resultPolicySha256) || !Array.isArray(patch.operations) ||
      patch.operations.length === 0 || typeof patch.reason !== "string" || !patch.reason.trim()) {
    fail("policy:malformed_patch", label);
  }
}

function expectedFlag(operation, key, label) {
  if (operation[key] !== true) fail("policy:unmet_expectation", `${label}:${key}`);
}

function applyFunctionOperations(base, patch, label, manifest) {
  const next = structuredClone(base);
  const touched = new Set();
  for (const [index, operation] of patch.operations.entries()) {
    const operationLabel = `${label}:operation=${index}`;
    if (!isObject(operation) || typeof operation.op !== "string") fail("policy:unknown_operation", operationLabel);
    if (["add_env_name", "remove_env_name"].includes(operation.op)) {
      const flag = operation.op === "add_env_name" ? "expectedAbsent" : "expectedPresent";
      if (!exactKeys(operation, ["op", "classification", "name", flag]) ||
          !ENV_CLASSIFICATIONS.has(operation.classification) || !ENV_NAME.test(operation.name)) {
        fail("policy:unknown_operation", operationLabel);
      }
      expectedFlag(operation, flag, operationLabel);
      const semantic = `env:${operation.classification}:${operation.name}`;
      if (touched.has(semantic)) fail("policy:duplicate_operation", semantic);
      touched.add(semantic);
      const members = next.env[operation.classification];
      const present = members.includes(operation.name);
      if ((operation.op === "add_env_name" && present) || (operation.op === "remove_env_name" && !present)) {
        fail("policy:unmet_expectation", semantic);
      }
      next.env[operation.classification] = operation.op === "add_env_name"
        ? [...members, operation.name].sort()
        : members.filter((member) => member !== operation.name);
    } else if (operation.op === "move_env_name") {
      if (!exactKeys(operation, ["op", "fromClassification", "toClassification", "name", "expectedPresent", "expectedAbsent"]) ||
          !ENV_CLASSIFICATIONS.has(operation.fromClassification) ||
          !ENV_CLASSIFICATIONS.has(operation.toClassification) ||
          operation.fromClassification === operation.toClassification || !ENV_NAME.test(operation.name)) {
        fail("policy:unknown_operation", operationLabel);
      }
      expectedFlag(operation, "expectedPresent", operationLabel);
      expectedFlag(operation, "expectedAbsent", operationLabel);
      const semantic = `env:${operation.name}`;
      if (touched.has(semantic)) fail("policy:duplicate_operation", semantic);
      touched.add(semantic);
      const from = next.env[operation.fromClassification];
      const to = next.env[operation.toClassification];
      if (!from.includes(operation.name) || to.includes(operation.name)) fail("policy:unmet_expectation", semantic);
      next.env[operation.fromClassification] = from.filter((member) => member !== operation.name);
      next.env[operation.toClassification] = [...to, operation.name].sort();
    } else if (["add_bundle_field", "remove_bundle_field"].includes(operation.op)) {
      const flag = operation.op === "add_bundle_field" ? "expectedAbsent" : "expectedPresent";
      if (!exactKeys(operation, ["op", "bundle", "field", flag]) ||
          !ENV_NAME.test(operation.bundle) || typeof operation.field !== "string" || !operation.field) {
        fail("policy:unknown_operation", operationLabel);
      }
      expectedFlag(operation, flag, operationLabel);
      const semantic = `bundle:${operation.bundle}:${operation.field}`;
      if (touched.has(semantic)) fail("policy:duplicate_operation", semantic);
      touched.add(semantic);
      const members = next.env.required_bundle_fields[operation.bundle] ?? [];
      const present = members.includes(operation.field);
      if ((operation.op === "add_bundle_field" && present) || (operation.op === "remove_bundle_field" && !present)) {
        fail("policy:unmet_expectation", semantic);
      }
      const changed = operation.op === "add_bundle_field"
        ? [...members, operation.field].sort()
        : members.filter((member) => member !== operation.field);
      if (changed.length === 0) delete next.env.required_bundle_fields[operation.bundle];
      else next.env.required_bundle_fields[operation.bundle] = changed;
      next.env.required_bundle_fields = Object.fromEntries(Object.entries(next.env.required_bundle_fields).sort());
    } else if (operation.op === "set_verify_jwt") {
      if (!exactKeys(operation, ["op", "expectedOld", "newValue"]) ||
          typeof operation.expectedOld !== "boolean" || typeof operation.newValue !== "boolean") {
        fail("policy:unknown_operation", operationLabel);
      }
      if (touched.has("jwt:verify_jwt")) fail("policy:duplicate_operation", "jwt:verify_jwt");
      touched.add("jwt:verify_jwt");
      if (next.jwt.verify_jwt !== operation.expectedOld) fail("policy:unmet_expectation", "jwt:verify_jwt");
      next.jwt.verify_jwt = operation.newValue;
      if (operation.newValue !== operation.expectedOld) next.jwt.explicit = true;
    } else fail("policy:unknown_operation", `${operationLabel}:${operation.op}`);
  }
  validateEnvPolicy(next.env, label, manifest);
  if (!exactKeys(next.jwt, ["explicit", "verify_jwt"]) ||
      typeof next.jwt.explicit !== "boolean" || typeof next.jwt.verify_jwt !== "boolean") {
    fail("policy:malformed_jwt", label);
  }
  return next;
}

function applySharedOperations(base, patch, label, manifest) {
  const next = structuredClone(base);
  const touched = new Set();
  for (const [index, operation] of patch.operations.entries()) {
    const operationLabel = `${label}:operation=${index}`;
    if (!isObject(operation) || !["add_member", "remove_member"].includes(operation.op) ||
        typeof operation.field !== "string" || typeof operation.value !== "string" || !operation.value) {
      fail("policy:unknown_operation", operationLabel);
    }
    const add = operation.op === "add_member";
    const flag = add ? "expectedAbsent" : "expectedPresent";
    if (SHARED_ARRAY_FIELDS.has(operation.field)) {
      if (!exactKeys(operation, ["op", "field", "value", flag])) fail("policy:unknown_operation", operationLabel);
      expectedFlag(operation, flag, operationLabel);
      const semantic = `${operation.field}:${operation.value}`;
      if (touched.has(semantic)) fail("policy:duplicate_operation", semantic);
      touched.add(semantic);
      const members = next[operation.field];
      const present = members.includes(operation.value);
      if ((add && present) || (!add && !present)) fail("policy:unmet_expectation", semantic);
      next[operation.field] = add ? [...members, operation.value].sort() : members.filter((member) => member !== operation.value);
    } else if (SHARED_MAP_FIELDS.has(operation.field)) {
      if (!exactKeys(operation, ["op", "field", "key", "value", flag]) ||
          typeof operation.key !== "string" || !IDENTIFIER.test(operation.key)) fail("policy:unknown_operation", operationLabel);
      expectedFlag(operation, flag, operationLabel);
      const semantic = `${operation.field}:${operation.key}:${operation.value}`;
      if (touched.has(semantic)) fail("policy:duplicate_operation", semantic);
      touched.add(semantic);
      const members = next[operation.field]?.[operation.key] ?? [];
      const present = members.includes(operation.value);
      if ((add && present) || (!add && !present)) fail("policy:unmet_expectation", semantic);
      const changed = add ? [...members, operation.value].sort() : members.filter((member) => member !== operation.value);
      next[operation.field] ??= {};
      if (changed.length === 0) delete next[operation.field][operation.key];
      else next[operation.field][operation.key] = changed;
      next[operation.field] = Object.fromEntries(Object.entries(next[operation.field]).sort());
    } else fail("policy:unknown_operation", operationLabel);
  }
  validateSharedEnvPolicy(next, label, manifest);
  return next;
}

function applyPatchChain({ base, patches, label, apply }) {
  let current = structuredClone(base);
  let currentDigest = policySha256(current);
  const visited = new Set([currentDigest]);
  const unused = new Set(patches);
  while (unused.size > 0) {
    const matching = [...unused].filter(({ declaration }) => declaration.basePolicySha256 === currentDigest);
    if (matching.length > 1) fail("policy:cas_branch_conflict", `${label}:${currentDigest}`);
    if (matching.length === 0) fail("policy:cas_stale_or_orphan", `${label}:${currentDigest}`);
    const selected = matching[0];
    const next = apply(current, selected.declaration, selected.label);
    const nextDigest = policySha256(next);
    if (nextDigest === currentDigest) fail("policy:patch_noop", selected.label);
    if (nextDigest !== selected.declaration.resultPolicySha256) {
      fail("policy:result_digest_mismatch", `${selected.label}:${nextDigest}`);
    }
    if (visited.has(nextDigest)) fail("policy:cas_cycle", selected.label);
    visited.add(nextDigest);
    current = next;
    currentDigest = nextDigest;
    unused.delete(selected);
  }
  return current;
}

function discoverPatches(root, functionsRoot, bootstrapFunctions, bootstrapShared) {
  const functionPatches = new Map();
  const sharedPatches = new Map();
  const owners = new Set();
  for (const file of listFiles(functionsRoot).filter((candidate) => candidate.endsWith(".patch.json"))) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const declaration = loadJson(file, relative);
    if (!["edge-function-policy-patch", "shared-module-policy-patch"].includes(declaration?.kind)) {
      if (path.basename(file).includes("function-policy")) fail("policy:unknown_patch_kind", relative);
      continue;
    }
    validatePatchEnvelope(declaration, relative, declaration.kind);
    const issueNumber = declaration.ownerIssue.slice(1);
    const ownership = `${declaration.ownerIssue}:${JSON.stringify(declaration.target)}`;
    if (owners.has(ownership)) fail("policy:duplicate_issue_target", ownership);
    owners.add(ownership);
    if (declaration.kind === "edge-function-policy-patch") {
      if (!exactKeys(declaration.target, ["kind", "name"]) || declaration.target.kind !== "function" ||
          typeof declaration.target.name !== "string") fail("policy:malformed_patch_target", relative);
      const name = declaration.target.name;
      const expected = `supabase/functions/${name}/function-policy.issue-${issueNumber}.patch.json`;
      if (relative !== expected) fail("policy:patch_location_mismatch", `${relative}:expected=${expected}`);
      if (!Object.hasOwn(bootstrapFunctions, name)) fail("policy:nonbootstrap_patch_target", name);
      if (!fs.existsSync(path.join(functionsRoot, name, "index.ts"))) fail("policy:stale_function_patch", name);
      const list = functionPatches.get(name) ?? [];
      list.push({ declaration, label: relative });
      functionPatches.set(name, list);
    } else {
      if (!exactKeys(declaration.target, ["kind", "module_path"]) || declaration.target.kind !== "shared_module" ||
          typeof declaration.target.module_path !== "string") fail("policy:malformed_patch_target", relative);
      const modulePath = declaration.target.module_path;
      const moduleAbsolute = path.resolve(root, modulePath);
      const sharedRoot = path.resolve(functionsRoot, "_shared");
      const expected = `${modulePath}.function-policy.issue-${issueNumber}.patch.json`;
      if (relative !== expected || !moduleAbsolute.startsWith(`${sharedRoot}${path.sep}`)) {
        fail("policy:patch_location_mismatch", `${relative}:expected=${expected}`);
      }
      if (!Object.hasOwn(bootstrapShared, modulePath)) fail("policy:nonbootstrap_patch_target", modulePath);
      if (!fs.existsSync(moduleAbsolute) || !fs.statSync(moduleAbsolute).isFile()) fail("policy:stale_shared_patch", modulePath);
      const list = sharedPatches.get(modulePath) ?? [];
      list.push({ declaration, label: relative });
      sharedPatches.set(modulePath, list);
    }
  }
  return { functionPatches, sharedPatches };
}

function replaceJwtValue(config, name, previous, next, reason) {
  if (previous.explicit) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^\\[functions\\.${escaped}\\]\\s*\\nverify_jwt\\s*=\\s*)${previous.verify_jwt}(\\s*$)`, "gm");
    const matches = [...config.matchAll(pattern)];
    if (matches.length !== 1) fail("config:materialization_target_count", `${name}:${matches.length}`);
    return config.replace(pattern, `$1${next.verify_jwt}$2`);
  }
  if (next.verify_jwt === true) fail("policy:patch_noop", `${name}:default_jwt`);
  return `${config}${config.endsWith("\n") ? "" : "\n"}\n# ${reason}\n[functions.${name}]\nverify_jwt = ${next.verify_jwt}\n`;
}

export function loadEffectiveFunctionPolicy({
  root = REPO_ROOT,
  contractPath = path.join(root, "supabase/function-env.contract.json"),
  configPath = path.join(root, "supabase/config.toml"),
  contractExpectedSha = CONTRACT_SHA256,
  configExpectedSha = CONFIG_SHA256,
  sealBootstrap = root === REPO_ROOT,
} = {}) {
  const contractRaw = sealBootstrap
    ? readSealed(contractPath, contractExpectedSha, "contract")
    : fs.readFileSync(contractPath, "utf8");
  const configRaw = sealBootstrap
    ? readSealed(configPath, configExpectedSha, "config")
    : fs.readFileSync(configPath, "utf8");
  const bootstrap = JSON.parse(contractRaw);
  const manifest = readManifest(root);
  const functionsRoot = path.join(root, "supabase/functions");
  const diskFunctions = listDiskFunctions(functionsRoot);
  const diskFunctionSet = new Set(diskFunctions);
  const functions = structuredClone(bootstrap.functions ?? {});
  const sharedModules = structuredClone(bootstrap.shared_modules ?? {});
  const explicitJwt = parseJwt(configRaw);
  const localFunctions = [];
  const { functionPatches, sharedPatches } = discoverPatches(
    root, functionsRoot, bootstrap.functions ?? {}, bootstrap.shared_modules ?? {},
  );
  const bootstrapJwt = Object.fromEntries(Object.keys(bootstrap.functions ?? {}).map((name) => [name, {
    verify_jwt: explicitJwt.get(name) ?? true,
    explicit: explicitJwt.has(name),
  }]));
  const effectiveJwt = structuredClone(bootstrapJwt);

  for (const [name, patches] of functionPatches) {
    const final = applyPatchChain({
      base: { env: functions[name], jwt: effectiveJwt[name] },
      patches,
      label: name,
      apply: (base, patch, label) => applyFunctionOperations(base, patch, label, manifest),
    });
    functions[name] = final.env;
    effectiveJwt[name] = final.jwt;
  }
  for (const [modulePath, patches] of sharedPatches) {
    sharedModules[modulePath] = applyPatchChain({
      base: sharedModules[modulePath],
      patches,
      label: modulePath,
      apply: (base, patch, label) => applySharedOperations(base, patch, label, manifest),
    });
  }

  for (const entry of fs.readdirSync(functionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "_shared") continue;
    const declarationPath = path.join(functionsRoot, entry.name, FUNCTION_POLICY_FILE);
    if (fs.existsSync(declarationPath) && !diskFunctionSet.has(entry.name)) fail("policy:stale_function_policy", entry.name);
  }

  for (const name of diskFunctions) {
    const declarationPath = path.join(functionsRoot, name, FUNCTION_POLICY_FILE);
    if (Object.hasOwn(functions, name)) {
      if (fs.existsSync(declarationPath)) fail("policy:legacy_shadow", name);
      continue;
    }
    if (!fs.existsSync(declarationPath)) fail("contract:function_set_mismatch", `missing_policy=${name}`);
    const declaration = loadJson(declarationPath, name);
    if (!exactKeys(declaration, ["schemaVersion", "kind", "name", "verify_jwt", "gateway_reason", "env"]) ||
        declaration.schemaVersion !== 1 || declaration.kind !== "edge-function-policy" ||
        declaration.name !== name || typeof declaration.verify_jwt !== "boolean" ||
        typeof declaration.gateway_reason !== "string" || declaration.gateway_reason.trim().length < 12) {
      fail("policy:malformed_declaration", name);
    }
    validateEnvPolicy(declaration.env, name, manifest);
    functions[name] = declaration.env;
    effectiveJwt[name] = { verify_jwt: declaration.verify_jwt, explicit: true };
    localFunctions.push({ name, declaration });
  }

  const diskSet = new Set(diskFunctions);
  const contractSet = new Set(Object.keys(functions));
  const missing = [...diskSet].filter((name) => !contractSet.has(name));
  const stale = [...contractSet].filter((name) => !diskSet.has(name));
  if (missing.length || stale.length) {
    fail("contract:function_set_mismatch", `missing=${missing.sort().join(",")}:stale=${stale.sort().join(",")}`);
  }

  const sharedRoot = path.join(functionsRoot, "_shared");
  const discoverShared = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) discoverShared(child);
      else if (entry.isFile() && entry.name.endsWith(SHARED_POLICY_SUFFIX)) {
        const declaration = loadJson(child, path.relative(root, child));
        if (!exactKeys(declaration, ["schemaVersion", "kind", "module_path", "env"]) ||
            declaration.schemaVersion !== 1 || declaration.kind !== "shared-module-policy" ||
            typeof declaration.module_path !== "string") fail("policy:malformed_declaration", path.relative(root, child));
        if (Object.hasOwn(sharedModules, declaration.module_path)) fail("policy:legacy_shadow", declaration.module_path);
        const owner = path.resolve(root, declaration.module_path);
        if (!owner.startsWith(`${sharedRoot}${path.sep}`) || !fs.existsSync(owner) || path.dirname(owner) !== path.dirname(child)) {
          fail("policy:stale_shared_module", declaration.module_path);
        }
        validateSharedEnvPolicy(declaration.env, declaration.module_path, manifest);
        sharedModules[declaration.module_path] = declaration.env;
      }
    }
  };
  discoverShared(sharedRoot);

  let generatedConfig = configRaw;
  for (const [name, final] of Object.entries(effectiveJwt).sort(([left], [right]) => left.localeCompare(right))) {
    const previous = bootstrapJwt[name];
    if (!previous || (previous.verify_jwt === final.verify_jwt && previous.explicit === final.explicit)) continue;
    const reason = functionPatches.get(name)?.at(-1)?.declaration.reason ?? "Issue-owned effective function policy.";
    generatedConfig = replaceJwtValue(generatedConfig, name, previous, final, reason);
  }
  for (const { name, declaration } of localFunctions.sort((a, b) => a.name.localeCompare(b.name))) {
    if (explicitJwt.has(name)) fail("config:legacy_registration_for_new_function", name);
    generatedConfig += `${generatedConfig.endsWith("\n") ? "" : "\n"}\n# ${declaration.gateway_reason}\n[functions.${name}]\nverify_jwt = ${declaration.verify_jwt}\n`;
  }
  const generatedExplicit = parseJwt(generatedConfig);
  const jwtPolicy = Object.fromEntries(diskFunctions.map((name) => [name, {
    verify_jwt: generatedExplicit.get(name) ?? true,
    explicit: generatedExplicit.has(name),
  }]));
  for (const name of diskFunctions) {
    if (jwtPolicy[name].verify_jwt !== effectiveJwt[name].verify_jwt || jwtPolicy[name].explicit !== effectiveJwt[name].explicit) {
      fail("config:effective_jwt_mismatch", name);
    }
  }

  return {
    contract: { ...bootstrap, functions, shared_modules: sharedModules },
    configToml: generatedConfig,
    diskFunctions,
    jwtPolicy,
    localFunctions: localFunctions.map(({ name }) => name),
    functionPatchTargets: [...functionPatches.keys()].sort(),
    sharedPatchTargets: [...sharedPatches.keys()].sort(),
  };
}

function main(argv) {
  const policy = loadEffectiveFunctionPolicy();
  const outputIndex = argv.indexOf("--write-config");
  if (outputIndex >= 0) {
    const output = argv[outputIndex + 1];
    if (!output) fail("policy:missing_output");
    fs.writeFileSync(path.resolve(output), policy.configToml);
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify({
      functions: policy.diskFunctions,
      localFunctions: policy.localFunctions,
      jwtPolicy: policy.jwtPolicy,
    }, null, 2));
  } else {
    console.log(`PASS function policy (${policy.diskFunctions.length} functions, ${Object.keys(policy.contract.shared_modules).length} shared modules)`);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) main(process.argv.slice(2));
