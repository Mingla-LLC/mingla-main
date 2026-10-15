import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEffectiveFunctionPolicy } from "../../.github/scripts/ci-discovery/function-policy.mjs";

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
