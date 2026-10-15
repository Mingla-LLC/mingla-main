#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const CONTRACT_PATH = path.join(REPO_ROOT, "supabase/function-env.contract.json");
export const CONFIG_PATH = path.join(REPO_ROOT, "supabase/config.toml");
export const CONTRACT_SHA256 = "a4196082acc5c79b1cf386668dbf2fe237657b4f920cd52bbea32d3d74c7cc15";
export const CONFIG_SHA256 = "a6a0dc681a4054abd83c77613c1ea5ba1ca839bf6f989658c59c6addbfc4c771";
export const FUNCTION_POLICY_FILE = "function-policy.json";
export const SHARED_POLICY_SUFFIX = ".function-policy.json";

function fail(code, detail = "") {
  throw new Error(`${code}${detail ? `:${detail}` : ""}`);
}

function readSealed(file, expected, label) {
  const raw = fs.readFileSync(file);
  const actual = crypto.createHash("sha256").update(raw).digest("hex");
  if (actual !== expected) fail(`${label}:bootstrap_seal_mismatch`, `${actual}:expected=${expected}`);
  return raw.toString("utf8");
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

function validateEnvPolicy(policy, label) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) fail("policy:malformed_env", label);
  for (const key of ["required_top_level", "optional_top_level", "migration_fallback_top_level"]) {
    if (!Array.isArray(policy[key]) || !policy[key].every((item) => typeof item === "string")) {
      fail("policy:malformed_env", `${label}:${key}`);
    }
  }
  if (!policy.required_bundle_fields || typeof policy.required_bundle_fields !== "object" ||
      Array.isArray(policy.required_bundle_fields)) fail("policy:malformed_env", `${label}:required_bundle_fields`);
}

function validateSharedEnvPolicy(policy, label) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) fail("policy:malformed_env", label);
  for (const key of ["allowed_top_level", "dynamic_getters", "local_call_identifiers", "closure_call_identifiers"]) {
    if (!Array.isArray(policy[key]) || !policy[key].every((item) => typeof item === "string")) {
      fail("policy:malformed_env", `${label}:${key}`);
    }
  }
  for (const key of ["allowed_bundle_fields", "allowed_call_expressions"]) {
    if (!policy[key] || typeof policy[key] !== "object" || Array.isArray(policy[key])) {
      fail("policy:malformed_env", `${label}:${key}`);
    }
  }
}

function loadJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail("policy:malformed_declaration", `${label}:${error.message}`);
  }
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
  const functionsRoot = path.join(root, "supabase/functions");
  const diskFunctions = listDiskFunctions(functionsRoot);
  const diskFunctionSet = new Set(diskFunctions);
  const functions = structuredClone(bootstrap.functions ?? {});
  const sharedModules = structuredClone(bootstrap.shared_modules ?? {});
  const explicitJwt = parseJwt(configRaw);
  const localFunctions = [];

  for (const entry of fs.readdirSync(functionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "_shared") continue;
    const declarationPath = path.join(functionsRoot, entry.name, FUNCTION_POLICY_FILE);
    if (fs.existsSync(declarationPath) && !diskFunctionSet.has(entry.name)) {
      fail("policy:stale_function_policy", entry.name);
    }
  }

  for (const name of diskFunctions) {
    const declarationPath = path.join(functionsRoot, name, FUNCTION_POLICY_FILE);
    if (Object.hasOwn(functions, name)) {
      if (fs.existsSync(declarationPath)) fail("policy:legacy_shadow", name);
      continue;
    }
    if (!fs.existsSync(declarationPath)) fail("contract:function_set_mismatch", `missing_policy=${name}`);
    const declaration = loadJson(declarationPath, name);
    if (declaration?.schemaVersion !== 1 || declaration?.kind !== "edge-function-policy" ||
        declaration.name !== name || typeof declaration.verify_jwt !== "boolean" ||
        typeof declaration.gateway_reason !== "string" || declaration.gateway_reason.trim().length < 12) {
      fail("policy:malformed_declaration", name);
    }
    validateEnvPolicy(declaration.env, name);
    functions[name] = declaration.env;
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
        if (declaration?.schemaVersion !== 1 || declaration?.kind !== "shared-module-policy" ||
            typeof declaration.module_path !== "string") fail("policy:malformed_declaration", path.relative(root, child));
        if (Object.hasOwn(sharedModules, declaration.module_path)) fail("policy:legacy_shadow", declaration.module_path);
        const owner = path.resolve(root, declaration.module_path);
        if (!owner.startsWith(sharedRoot) || !fs.existsSync(owner) || path.dirname(owner) !== path.dirname(child)) {
          fail("policy:stale_shared_module", declaration.module_path);
        }
        validateSharedEnvPolicy(declaration.env, declaration.module_path);
        sharedModules[declaration.module_path] = declaration.env;
      }
    }
  };
  discoverShared(sharedRoot);

  let generatedConfig = configRaw;
  for (const { name, declaration } of localFunctions.sort((a, b) => a.name.localeCompare(b.name))) {
    if (explicitJwt.has(name)) fail("config:legacy_registration_for_new_function", name);
    generatedConfig += `${generatedConfig.endsWith("\n") ? "" : "\n"}\n# ${declaration.gateway_reason}\n[functions.${name}]\nverify_jwt = ${declaration.verify_jwt}\n`;
  }
  const generatedExplicit = parseJwt(generatedConfig);
  const jwtPolicy = Object.fromEntries(diskFunctions.map((name) => [name, {
    verify_jwt: generatedExplicit.get(name) ?? true,
    explicit: generatedExplicit.has(name),
  }]));

  return {
    contract: { ...bootstrap, functions, shared_modules: sharedModules },
    configToml: generatedConfig,
    diskFunctions,
    jwtPolicy,
    localFunctions: localFunctions.map(({ name }) => name),
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
