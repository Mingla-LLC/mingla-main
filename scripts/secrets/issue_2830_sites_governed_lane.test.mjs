import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const contract = JSON.parse(read("supabase/function-env.contract.json"));
const deployScript = read("scripts/deploy-supabase-functions.sh");
const coordinator = read("scripts/secrets/reconcile-governed-secrets.mjs");

function declaredBundles() {
  const names = new Set();
  for (const entry of Object.values(contract.functions)) {
    for (const name of Object.keys(entry.required_bundle_fields ?? {})) {
      names.add(name);
    }
  }
  return [...names].sort();
}

test("every bundle a function can REQUIRE, the lane can SUPPLY", () => {
  const supplied = new Set(
    [...coordinator.matchAll(/bundleInputs\.([A-Z0-9_]+)\s*=/g)].map((m) => m[1]),
  );
  const missing = declaredBundles().filter((name) => !supplied.has(name));
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
    assert.ok(entry, `${name} missing from the contract`);
    assert.ok(
      Object.keys(entry.required_bundle_fields ?? {}).includes(
        "MINGLA_SITES_SECURITY_JSON",
      ),
      `${name} should declare the sites bundle`,
    );
  }
});
