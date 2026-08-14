#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
export const DEFAULT_AUTHORITY_FILE = resolve(
  REPO_ROOT,
  "docs/contracts/production-supabase-authority.json",
);
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const CONTRACT_KEYS = [
  "environment",
  "forbidden_mingla_refs",
  "origins",
  "project_ref",
  "schema_version",
];
const FORBIDDEN_RECORD_KEYS = ["classification", "project_ref"];
const FORBIDDEN_CLASSIFICATION = "unrelated_project_do_not_target";

export class AuthorityError extends Error {
  constructor(variableName, expectedRef, actualRef, reason = "mismatch") {
    super(
      `Production Supabase authority mismatch; expected ${expectedRef}; no action executed. ` +
        `${variableName}: expected=${expectedRef} actual=${actualRef} reason=${reason}`,
    );
    this.name = "AuthorityError";
  }
}

function exactKeys(value, keys) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function safeActualRef(value) {
  return typeof value === "string" && PROJECT_REF_PATTERN.test(value)
    ? value
    : "<malformed>";
}

export function loadProductionAuthority(path = DEFAULT_AUTHORITY_FILE) {
  const contract = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!exactKeys(contract, CONTRACT_KEYS)) throw new Error("authority_contract_keys_invalid");
  if (contract.schema_version !== 1) throw new Error("authority_schema_version_invalid");
  if (contract.environment !== "production") throw new Error("authority_environment_invalid");
  if (!PROJECT_REF_PATTERN.test(contract.project_ref)) {
    throw new Error("authority_project_ref_invalid");
  }
  if (
    !exactKeys(contract.origins, ["functions", "rest"]) ||
    contract.origins.rest !== `https://${contract.project_ref}.supabase.co` ||
    contract.origins.functions !==
      `https://${contract.project_ref}.functions.supabase.co`
  ) {
    throw new Error("authority_origins_invalid");
  }
  if (
    !Array.isArray(contract.forbidden_mingla_refs) ||
    contract.forbidden_mingla_refs.length === 0 ||
    contract.forbidden_mingla_refs.some(
      (record) =>
        !exactKeys(record, FORBIDDEN_RECORD_KEYS) ||
        !PROJECT_REF_PATTERN.test(record.project_ref) ||
        record.project_ref === contract.project_ref ||
        record.classification !== FORBIDDEN_CLASSIFICATION,
    ) ||
    new Set(contract.forbidden_mingla_refs.map((record) => record.project_ref)).size !==
      contract.forbidden_mingla_refs.length
  ) {
    throw new Error("authority_forbidden_refs_invalid");
  }
  return contract;
}

export function extractProjectRefFromUrl(value, variableName) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${variableName}:url_malformed`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName}:url_malformed`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error(`${variableName}:url_malformed`);
  }
  const restMatch = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const functionsMatch = /^([a-z0-9]{20})\.functions\.supabase\.co$/.exec(url.hostname);
  const ref = restMatch?.[1] ?? functionsMatch?.[1];
  if (!ref) throw new Error(`${variableName}:url_malformed`);
  return ref;
}

export function extractProjectRefFromJwt(value, variableName) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${variableName}:key_malformed`);
  }
  const segments = value.split(".");
  if (segments.length !== 3) throw new Error(`${variableName}:key_malformed`);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new Error(`${variableName}:key_malformed`);
  }
  if (!PROJECT_REF_PATTERN.test(payload?.ref ?? "")) {
    throw new Error(`${variableName}:key_malformed`);
  }
  return payload.ref;
}

function verifyExactRef(actualRef, variableName, authority) {
  if (
    typeof actualRef !== "string" ||
    actualRef.trim() !== actualRef ||
    !PROJECT_REF_PATTERN.test(actualRef)
  ) {
    throw new AuthorityError(
      variableName,
      authority.project_ref,
      safeActualRef(actualRef),
      actualRef === undefined || actualRef === "" ? "missing" : "malformed",
    );
  }
  if (actualRef !== authority.project_ref) {
    const forbidden = authority.forbidden_mingla_refs.some(
      (record) => record.project_ref === actualRef,
    );
    throw new AuthorityError(
      variableName,
      authority.project_ref,
      actualRef,
      forbidden ? FORBIDDEN_CLASSIFICATION : "noncanonical",
    );
  }
}

export function verifyProductionAuthority({
  targetRef,
  restUrl,
  functionsUrl,
  publishableKey,
  variableName = "target-ref",
  expectedFile = DEFAULT_AUTHORITY_FILE,
} = {}) {
  const authority = loadProductionAuthority(expectedFile);
  verifyExactRef(targetRef, variableName, authority);
  const derivedInputs = [
    ["rest-url", restUrl, extractProjectRefFromUrl],
    ["functions-url", functionsUrl, extractProjectRefFromUrl],
    ["publishable-key", publishableKey, extractProjectRefFromJwt],
  ];
  for (const [name, value, extractor] of derivedInputs) {
    if (value === undefined) continue;
    let derivedRef;
    try {
      derivedRef = extractor(value, name);
    } catch {
      throw new AuthorityError(name, authority.project_ref, "<malformed>", "malformed");
    }
    verifyExactRef(derivedRef, name, authority);
    if (name === "rest-url" && value !== authority.origins.rest) {
      throw new AuthorityError(name, authority.project_ref, derivedRef, "noncanonical_origin");
    }
    if (name === "functions-url" && value !== authority.origins.functions) {
      throw new AuthorityError(name, authority.project_ref, derivedRef, "noncanonical_origin");
    }
  }
  return authority;
}

function read(relativePath, repoRoot = REPO_ROOT) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function assertSource(condition, name, failures) {
  if (!condition) failures.push(name);
}

function matchingValues(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function assertSingleValue(source, pattern, expected, name, failures) {
  const values = matchingValues(source, pattern);
  assertSource(values.length === 1 && values[0] === expected, name, failures);
}

function assertNoAlternateSupabaseOrigins(source, authority, name, failures) {
  const refs = matchingValues(
    source,
    /https:\/\/([a-z0-9]{20})(?:\.functions)?\.supabase\.co/g,
  );
  assertSource(refs.every((ref) => ref === authority.project_ref), name, failures);
}

export function validateAmendment2SourceOwners(
  { businessAuthCallback, sentryDeploy, discoverDeploy },
  authority = loadProductionAuthority(),
) {
  const failures = [];

  assertSingleValue(
    businessAuthCallback,
    /var SUPABASE_URL = "([^"]+)";/g,
    authority.origins.rest,
    "business-auth-callback:canonical_url",
    failures,
  );
  assertNoAlternateSupabaseOrigins(
    businessAuthCallback,
    authority,
    "business-auth-callback:alternate_origin",
    failures,
  );

  const callbackJwtValues = matchingValues(
    businessAuthCallback,
    /var SUPABASE_ANON_KEY\s*=\s*\n\s*"([^"]+)";/g,
  );
  let callbackJwtRef = "<malformed>";
  if (callbackJwtValues.length === 1) {
    try {
      callbackJwtRef = extractProjectRefFromJwt(
        callbackJwtValues[0],
        "business-auth-callback:public-jwt",
      );
    } catch {
      // The named failure below deliberately does not include key material.
    }
  }
  assertSource(
    callbackJwtValues.length === 1 && callbackJwtRef === authority.project_ref,
    "business-auth-callback:public_jwt_ref",
    failures,
  );
  assertSingleValue(
    businessAuthCallback,
    /var STORAGE_KEY = "([^"]+)";/g,
    `sb-${authority.project_ref}-auth-token`,
    "business-auth-callback:storage_key_ref",
    failures,
  );

  const operationalOwners = [
    {
      name: "deploy-g3-sentry",
      source: sentryDeploy,
      targetPattern: /PROJECT_REF="\$\{1:-([a-z0-9]{20})\}"/g,
      sideEffects: ["supabase link", "supabase secrets set"],
    },
    {
      name: "deploy-discover-production",
      source: discoverDeploy,
      targetPattern:
        /PROJECT_REF="\$\{SUPABASE_PROJECT_REF:-([a-z0-9]{20})\}"/g,
      sideEffects: ["supabase link", "supabase db push", "supabase functions deploy"],
    },
  ];
  for (const owner of operationalOwners) {
    assertSingleValue(
      owner.source,
      owner.targetPattern,
      authority.project_ref,
      `${owner.name}:canonical_default`,
      failures,
    );
    const verifierIndex = owner.source.indexOf(
      "scripts/ops/verify-production-supabase-authority.mjs",
    );
    const targetArgumentIndex = owner.source.indexOf('--target-ref "$PROJECT_REF"');
    assertSource(
      verifierIndex >= 0 && targetArgumentIndex > verifierIndex,
      `${owner.name}:authority_guard_missing`,
      failures,
    );
    for (const sideEffect of owner.sideEffects) {
      assertSource(
        verifierIndex >= 0 && verifierIndex < owner.source.indexOf(sideEffect),
        `${owner.name}:guard_after_${sideEffect.replaceAll(" ", "_")}`,
        failures,
      );
    }
  }

  return [...new Set(failures)].sort();
}

export function validateRepositoryAuthority(repoRoot = REPO_ROOT) {
  const authority = loadProductionAuthority(
    resolve(repoRoot, "docs/contracts/production-supabase-authority.json"),
  );
  const canonicalRest = authority.origins.rest;
  const canonicalFunctions = authority.origins.functions;
  const failures = [];

  for (const configPath of ["supabase/config.toml", "backend/supabase/config.toml"]) {
    const config = read(configPath, repoRoot);
    assertSingleValue(
      config,
      /^project_id\s*=\s*"([^"]+)"\s*$/gm,
      authority.project_ref,
      `${configPath}:project_id`,
      failures,
    );
  }
  const consumerClient = read("app-mobile/src/services/supabase.ts", repoRoot);
  assertSingleValue(
    consumerClient,
    /^export const supabaseUrl\s*=\s*['"]([^'"]+)['"];\s*$/gm,
    canonicalRest,
    "consumer:canonical_url",
    failures,
  );
  assertNoAlternateSupabaseOrigins(
    consumerClient,
    authority,
    "consumer:alternate_origin",
    failures,
  );
  const businessConfig = read("mingla-business/app.config.js", repoRoot);
  const businessClient = read("mingla-business/src/services/supabase.ts", repoRoot);
  assertSingleValue(
    businessConfig,
    /EXPO_PUBLIC_SUPABASE_URL:\s*\n\s*process\.env\.EXPO_PUBLIC_SUPABASE_URL\s*\?\?\s*\n\s*"([^"]+)"/g,
    canonicalRest,
    "business:canonical_fallback",
    failures,
  );
  assertNoAlternateSupabaseOrigins(
    businessConfig,
    authority,
    "business:alternate_origin",
    failures,
  );
  for (const environmentPath of [
    "mingla-business/env.example",
    "mingla-business/.env.example",
  ]) {
    const environment = read(environmentPath, repoRoot);
    assertSingleValue(
      environment,
      /^EXPO_PUBLIC_SUPABASE_URL=(.+)$/gm,
      canonicalRest,
      `${environmentPath}:canonical_url`,
      failures,
    );
    assertNoAlternateSupabaseOrigins(
      environment,
      authority,
      `${environmentPath}:alternate_origin`,
      failures,
    );
  }
  assertSource(
    matchingValues(
      businessClient,
      /const supabaseUrl\s*=\s*\n\s*(extra\?\.EXPO_PUBLIC_SUPABASE_URL\s*\|\|\s*\n\s*process\.env\.EXPO_PUBLIC_SUPABASE_URL\s*\|\|\s*\n\s*"")/g,
    ).length === 1,
    "business:emitted_extra_consumer",
    failures,
  );
  assertSource(
    matchingValues(businessClient, /createClient\((supabaseUrl),\s*supabaseAnonKey/g).length === 1,
    "business:sole_client_target",
    failures,
  );
  for (const easPath of ["app-mobile/eas.json", "mingla-business/eas.json"]) {
    const eas = JSON.parse(read(easPath, repoRoot));
    const productionProfiles = Object.entries(eas?.build ?? {}).filter(
      ([, profile]) => profile?.channel === "production",
    );
    assertSource(productionProfiles.length > 0, `${easPath}:production_profile_missing`, failures);
    for (const [profileName, profile] of productionProfiles) {
      const configuredUrl = profile?.env?.EXPO_PUBLIC_SUPABASE_URL;
      assertSource(
        configuredUrl === undefined || configuredUrl === canonicalRest,
        `${easPath}:${profileName}:production_override`,
        failures,
      );
    }
  }
  const adminClient = read("mingla-admin/src/lib/supabase.js", repoRoot);
  const adminEnvironment = read("mingla-admin/.env.example", repoRoot);
  assertSource(
    matchingValues(
      adminClient,
      /const supabaseUrl\s*=\s*(import\.meta\.env\.VITE_SUPABASE_URL);/g,
    ).length === 1 &&
      authority.forbidden_mingla_refs.every(
        (record) => !adminClient.includes(record.project_ref),
      ),
    "admin:environment_owned_url",
    failures,
  );
  assertSingleValue(
    adminEnvironment,
    /^VITE_SUPABASE_URL=(.+)$/gm,
    canonicalRest,
    "admin:canonical_environment_template",
    failures,
  );
  const marketingEnvironment = read("mingla-marketing/.env.example", repoRoot);
  assertSingleValue(
    marketingEnvironment,
    /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/gm,
    canonicalRest,
    "marketing:canonical_rest_url",
    failures,
  );
  assertSingleValue(
    marketingEnvironment,
    /^NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL=(.+)$/gm,
    canonicalFunctions,
    "marketing:canonical_functions_url",
    failures,
  );
  assertNoAlternateSupabaseOrigins(
    marketingEnvironment,
    authority,
    "marketing:alternate_origin",
    failures,
  );

  failures.push(
    ...validateAmendment2SourceOwners(
      {
        businessAuthCallback: read("mingla-business/public/auth/callback.html", repoRoot),
        sentryDeploy: read("scripts/ops/deploy-g3-sentry.sh", repoRoot),
        discoverDeploy: read("scripts/load/deploy-discover-staging.sh", repoRoot),
      },
      authority,
    ),
  );

  const deployWorkflow = read(".github/workflows/deploy-functions.yml", repoRoot);
  const rotationWorkflow = read(".github/workflows/rotate-apple-jwt.yml", repoRoot);
  const budgetWorkflow = read(".github/workflows/supabase-secret-budget.yml", repoRoot);
  assertSource(
    deployWorkflow.includes("SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}") &&
      deployWorkflow.includes("scripts/deploy-supabase-functions.sh") &&
      !deployWorkflow.includes("supabase functions deploy"),
    "workflow:edge_deploy_guarded_entry",
    failures,
  );
  assertSource(
    rotationWorkflow.includes("SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}") &&
      rotationWorkflow.includes("node scripts/rotate-apple-jwt.mjs"),
    "workflow:apple_rotation_guarded_entry",
    failures,
  );
  assertSingleValue(
    budgetWorkflow,
    /^\s*SUPABASE_PROJECT_REF:\s*([a-z0-9]{20})\s*$/gm,
    authority.project_ref,
    "workflow:secret_budget_target",
    failures,
  );
  for (const [name, source] of [
    ["workflow:deploy", deployWorkflow],
    ["workflow:rotation", rotationWorkflow],
    ["workflow:secret_budget", budgetWorkflow],
  ]) {
    assertNoAlternateSupabaseOrigins(source, authority, `${name}:alternate_origin`, failures);
  }

  const allowedForbiddenRefPaths = new Set([
    "docs/contracts/production-supabase-authority.json",
    "docs/runbooks/PRODUCTION_SUPABASE_AUTHORITY.md",
  ]);
  for (const record of authority.forbidden_mingla_refs) {
    let matches = [];
    try {
      matches = execFileSync(
        "git",
        ["grep", "-l", "-F", "--", record.project_ref],
        { cwd: repoRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      ).trim().split("\n").filter(Boolean);
    } catch (error) {
      if (error?.status !== 1) throw error;
    }
    for (const path of matches) {
      if (
        path.startsWith("scripts/ops/__tests__/issue_2016_") ||
        allowedForbiddenRefPaths.has(path)
      ) continue;
      failures.push(`${path}:forbidden_ref`);
    }
  }
  return [...new Set(failures)].sort();
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function main() {
  const mode = argValue("--mode");
  if (!["offline", "metadata"].includes(mode)) throw new Error("mode_invalid");
  const expectedFile = argValue("--expected-file") ?? DEFAULT_AUTHORITY_FILE;
  const authority = verifyProductionAuthority({
    expectedFile,
    targetRef: argValue("--target-ref"),
    restUrl: argValue("--rest-url"),
    functionsUrl: argValue("--functions-url"),
    publishableKey: argValue("--publishable-key"),
  });
  if (process.argv.includes("--check-sources")) {
    const failures = validateRepositoryAuthority(REPO_ROOT);
    if (failures.length > 0) throw new Error(`source_authority_invalid:${failures.join(",")}`);
  }
  console.log(`Production Supabase authority verified: ${authority.project_ref}; mode=${mode}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "authority_verification_failed";
    console.error(`::error title=Production Supabase authority::${message}`);
    process.exit(1);
  }
}
