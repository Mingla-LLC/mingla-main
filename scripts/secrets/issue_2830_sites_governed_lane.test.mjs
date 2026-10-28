import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEffectiveFunctionPolicy } from "../../.github/scripts/ci-discovery/function-policy.mjs";
import { runGovernedBundleDeployment } from "./reconcile-governed-secrets.mjs";
import {
  BundleSetterError,
  loadManifest,
  prepareGovernedBundle,
} from "./set-governed-secret-bundle.mjs";

/**
 * #2830 — EVERY governed bundle must have a way to supply it.
 *
 * MINGLA_SITES_SECURITY_JSON was declared by all four brand-site-* functions
 * and had no input flag anywhere. The consequence was not a warning: the normal
 * deploy lane refuses any function declaring required_bundle_fields
 * (governed_bundle_lane_required), and the governed lane could not supply this
 * one — so those functions were deployable through NO sanctioned path, and the
 * first change to touch them turned main red and blocked every merge in the
 * repository.
 *
 * This is the general rule rather than a sites-shaped patch: if a bundle can be
 * REQUIRED, it must be SUPPLIABLE. A future bundle added to the contract without
 * a flag fails here instead of at a merge.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const contract = loadEffectiveFunctionPolicy().contract;
const deployScript = read("scripts/deploy-supabase-functions.sh");
const coordinator = read("scripts/secrets/reconcile-governed-secrets.mjs");
const PROJECT_REF = "gqnoajqerqhnvulmnyvv";
const MERGED_COMMIT = "a".repeat(40);

function sitesInput() {
  const manifest = loadManifest();
  const record = manifest.secrets.find((entry) =>
    entry.name === "MINGLA_SITES_SECURITY_JSON"
  );
  const fields = record.bundle_fields.map((field) => field.name).sort();
  const material = (byte) => Buffer.alloc(32, byte).toString("base64");
  return {
    bundleName: "MINGLA_SITES_SECURITY_JSON",
    bundleObject: {
      attribution_pepper_b64: material(4),
      cms_to_core_current_key_b64: material(2),
      cms_to_core_current_kid: "cms-core-current",
      cms_to_core_previous_key_b64: null,
      cms_to_core_previous_kid: null,
      core_to_cms_current_key_b64: material(1),
      core_to_cms_current_kid: "core-cms-current",
      core_to_cms_previous_key_b64: null,
      core_to_cms_previous_kid: null,
      runtime_to_core_current_key_b64: material(3),
      runtime_to_core_current_kid: "runtime-core-current",
      runtime_to_core_previous_key_b64: null,
      runtime_to_core_previous_kid: null,
      schema_version: 1,
    },
    authoritativeExistingFieldNames: fields,
    attestations: Object.fromEntries(record.bundle_fields.map((field) => [
      field.name,
      { owner: field.owner, source_type: field.source_type },
    ])),
  };
}

function declaredBundles(policy = contract) {
  const names = new Set();
  for (const entry of Object.values(policy.functions)) {
    for (const name of Object.keys(entry.required_bundle_fields ?? {})) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function missingBundleInputs(policy, coordinatorSource) {
  const supplied = new Set(
    [...coordinatorSource.matchAll(/bundleInputs\.([A-Z0-9_]+)\s*=/g)].map((match) => match[1]),
  );
  return declaredBundles(policy).filter((name) => !supplied.has(name));
}

test("every bundle a function can REQUIRE, the lane can SUPPLY", () => {
  const missing = missingBundleInputs(contract, coordinator);
  // [TEST-MOD-APPROVED #3643] The assertion now reads the canonical effective
  // function policy, so a valid local function cannot bypass this gate.
  assert.deepEqual(
    missing,
    [],
    `contract requires ${missing.join(", ")} but no input flag can supply it; ` +
      `those functions are deployable through no sanctioned lane`,
  );
});

test("MINGLA_SITES_SECURITY_JSON is suppliable, specifically", () => {
  assert.match(deployScript, /--sites-input\)/);
  assert.match(coordinator, /value === "--sites-input"/);
  assert.match(coordinator, /bundleInputs\.MINGLA_SITES_SECURITY_JSON = loadSecureBundleInput/);
});

test("the Sites input is a complete strict wrapper the governed setter can prepare", () => {
  const manifest = loadManifest();
  const prepared = prepareGovernedBundle({ ...sitesInput(), manifest });
  assert.equal(prepared.bundleName, "MINGLA_SITES_SECURITY_JSON");
  assert.equal(prepared.schemaVersion, 1);
  assert.deepEqual(
    prepared.fieldNames,
    manifest.secrets
      .find((record) => record.name === "MINGLA_SITES_SECURITY_JSON")
      .bundle_fields.map((field) => field.name)
      .sort(),
  );
});

test("the Sites parser fails closed on drift, half-rotation, malformed or reused material", () => {
  const manifest = loadManifest();
  const cases = [];

  const extra = sitesInput();
  extra.bundleObject.unreviewed = "field";
  cases.push([extra, "sites_bundle_shape_invalid"]);

  const halfRotation = sitesInput();
  halfRotation.bundleObject.runtime_to_core_previous_key_b64 =
    Buffer.alloc(32, 9).toString("base64");
  cases.push([halfRotation, "sites_bundle_strict_parser_invalid"]);

  const malformed = sitesInput();
  malformed.bundleObject.cms_to_core_current_key_b64 = "not-base64";
  cases.push([malformed, "sites_bundle_strict_parser_invalid"]);

  const reused = sitesInput();
  reused.bundleObject.attribution_pepper_b64 =
    reused.bundleObject.core_to_cms_current_key_b64;
  cases.push([reused, "sites_bundle_strict_parser_invalid"]);

  for (const [input, code] of cases) {
    assert.throws(
      () => prepareGovernedBundle({ ...input, manifest }),
      (error) => error instanceof BundleSetterError && error.code === code,
    );
  }
});

test("the same-process governed lane can apply and verify a Sites reader", () => {
  const manifest = loadManifest();
  const liveNames = manifest.secrets.map((record) => record.name);
  const calls = [];
  const result = runGovernedBundleDeployment({
    projectRef: PROJECT_REF,
    mergedCommit: MERGED_COMMIT,
    selectedFunctions: ["brand-site-runtime-resolve"],
    bundleInputs: { MINGLA_SITES_SECURITY_JSON: sitesInput() },
    dependencies: {
      audit: () => [],
      gitState: () => ({
        clean: true,
        committedAtMs: Date.now(),
        head: MERGED_COMMIT,
        remoteMain: MERGED_COMMIT,
      }),
      listLiveNames: () => liveNames,
      applyBundle({ prepared }) {
        calls.push(`apply:${prepared.bundleName}`);
        return prepared;
      },
      deploy: () => calls.push("deploy"),
      verifyDeployed: () => calls.push("verify-source"),
      verifyRemoteJwt: () => calls.push("verify-jwt"),
    },
  });
  assert.deepEqual(calls, [
    "apply:MINGLA_SITES_SECURITY_JSON",
    "deploy",
    "verify-source",
    "verify-jwt",
  ]);
  assert.deepEqual(result.applied_bundles, ["MINGLA_SITES_SECURITY_JSON"]);
  assert.deepEqual(result.deployed_functions, ["brand-site-runtime-resolve"]);
});

test("--sites-input engages the governed lane, like its siblings", () => {
  const branch = deployScript.slice(
    deployScript.indexOf("--sites-input)"),
    deployScript.indexOf("--ad-input|--delivery-input)"),
  );
  assert.match(branch, /governed_bundle_deploy=true/);
  assert.match(branch, /coordinator_args\+=\("\$1" "\$2"\)/);
  // A missing path must fail loudly rather than deploying with no bundle.
  assert.match(branch, /FAIL deploy: \$1 requires a secure input path/);
});

test("stdin can still supply only ONE bundle", () => {
  // Sites joins the mutual-exclusion check; two bundles reading "-" would race
  // for the same stream and one would silently get nothing.
  const guard = coordinator.slice(
    coordinator.indexOf("stdin_may_supply_only_one_bundle") - 400,
    coordinator.indexOf("stdin_may_supply_only_one_bundle"),
  );
  assert.match(guard, /args\.sitesPath/);
});

test("all four brand-site functions are covered", () => {
  for (const name of [
    "brand-site-attribution",
    "brand-site-cms-callback",
    "brand-site-control",
    "brand-site-runtime-resolve",
  ]) {
    const entry = contract.functions[name];
    // [TEST-MOD-APPROVED #3643] These preserved assertions now bind to the
    // effective function-policy projection rather than the sealed bootstrap.
    assert.ok(entry, `${name} missing from the contract`);
    assert.ok(
      Object.keys(entry.required_bundle_fields ?? {}).includes(
        "MINGLA_SITES_SECURITY_JSON",
      ),
      `${name} should declare the sites bundle`,
    );
  }
});

test("a valid future function is rejected until its governed bundle becomes suppliable", (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "issue-2830-effective-policy-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const writeFixture = (relative, contents) => {
    const target = path.join(fixtureRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  const bootstrap = JSON.parse(read("supabase/function-env.contract.json"));
  const baseFunctionCount = Object.keys(bootstrap.functions).length;
  writeFixture("supabase/function-env.contract.json", read("supabase/function-env.contract.json"));
  writeFixture("supabase/config.toml", read("supabase/config.toml"));
  writeFixture("supabase/secrets.manifest.json", read("supabase/secrets.manifest.json"));
  for (const name of Object.keys(bootstrap.functions)) {
    writeFixture(`supabase/functions/${name}/index.ts`, "// isolated fixture\n");
  }
  fs.mkdirSync(path.join(fixtureRoot, "supabase/functions/_shared"), { recursive: true });
  const name = "issue-2830-future-governed-function";
  writeFixture(`supabase/functions/${name}/index.ts`, "// isolated fixture\n");
  writeFixture(`supabase/functions/${name}/function-policy.json`, `${JSON.stringify({
    schemaVersion: 1,
    kind: "edge-function-policy",
    name,
    verify_jwt: false,
    gateway_reason: "Issue #2830 proves every locally declared bundle has a sanctioned input.",
    env: {
      required_top_level: [],
      optional_top_level: [],
      migration_fallback_top_level: [],
      required_bundle_fields: { MINGLA_ALERT_RECIPIENTS_JSON: ["api_health"] },
    },
  }, null, 2)}\n`);

  const effective = loadEffectiveFunctionPolicy({ root: fixtureRoot, sealBootstrap: false });
  // [TEST-MOD-APPROVED #3643] Deriving from the fixture bootstrap prevents the
  // next legitimate function from creating another shared count edit.
  assert.equal(effective.diskFunctions.length, baseFunctionCount + 1);
  assert.deepEqual(missingBundleInputs(effective.contract, coordinator), ["MINGLA_ALERT_RECIPIENTS_JSON"]);
  const supplied = `${coordinator}\nbundleInputs.MINGLA_ALERT_RECIPIENTS_JSON = loadSecureBundleInput;\n`;
  assert.deepEqual(missingBundleInputs(effective.contract, supplied), []);
});
