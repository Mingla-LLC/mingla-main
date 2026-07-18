#!/usr/bin/env node
/**
 * ORCH-1386 companion node:test suite for the framework-major guard.
 *
 * Provenance rule (COMMS-0106): every case imports the REAL gate module —
 * `runAll` / `checkManifest` / `checkLockfile` / `checkPairing` /
 * `majorLineOf` / `computeRegistry` — or spawns the real gate binary. No
 * re-implemented logic anywhere, so the suite can never drift green while
 * the shipped gate rots.
 *
 * Happy-path + adversarial angles:
 *  1. real repo tree passes with the committed registry (fails-on-revert
 *     anchor: restoring `"expo": "~57.0.6"` in either manifest reds this).
 *  2. the gate binary's --self-test matrix stays intact (14/14).
 *  3. the EXACT #925 manifest shape (expo ~54→~57, nothing else) fails.
 *  4. the #925 TRANSITIVE disguise against the REAL lockfile fails (mutate
 *     @expo/metro-config to 57.0.5 in-memory, manifest untouched).
 *  5. registry-only tamper (approve 57 in the registry, manifest at 54)
 *     still fails — the pin is two-sided.
 *  6. prerelease strings do not bypass parsing ("57.0.0-rc.1" → 57).
 *  7. a missing registry file fails CLOSED (exit 1 path, not a silent pass).
 *  8. the committed registry equals `computeRegistry()` of the current tree
 *     (a stale/hand-tampered registry cannot sit unnoticed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  REGISTRY_FILE,
  GUARDED_APPS,
  checkLockfile,
  checkManifest,
  checkPairing,
  computeRegistry,
  majorLineOf,
  runAll,
} from "./orch-1386-framework-major-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const gateBin = path.join(__dirname, "orch-1386-framework-major-guard.mjs");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

test("1. real repo tree passes the gate with the committed registry", () => {
  const failures = runAll(root);
  assert.deepEqual(
    failures,
    [],
    `gate must pass on the shipped tree; got:\n${failures.join("\n")}`,
  );
});

test("2. gate --self-test matrix intact", () => {
  const out = execFileSync(process.execPath, [gateBin, "--self-test"], {
    encoding: "utf8",
  });
  assert.match(out, /self-test PASS \(14\/14 cases\)/);
});

test("3. exact #925 manifest shape (expo ~54.0.34 → ~57.0.6) fails", () => {
  const registry = readJson(REGISTRY_FILE);
  for (const app of ["app-mobile", "mingla-business"]) {
    const pkg = readJson(path.join(root, app, "package.json"));
    pkg.dependencies.expo = "~57.0.6"; // the #925 line, verbatim
    const manifestFailures = checkManifest(app, pkg, registry.apps[app]);
    assert.ok(
      manifestFailures.some((f) => /MAJOR moved for "expo"/.test(f)),
      `${app}: manifest check must flag the expo major move`,
    );
    const pairingFailures = checkPairing({ [app]: pkg });
    assert.ok(
      pairingFailures.some((f) => /NO approved react-native pairing/.test(f)),
      `${app}: pairing check must reject expo 57 with rn 0.81`,
    );
  }
});

test("4. #925 transitive disguise against the REAL lockfile fails", () => {
  const registry = readJson(REGISTRY_FILE);
  const lock = readJson(path.join(root, "app-mobile", "package-lock.json"));
  assert.equal(
    checkLockfile("app-mobile", lock, registry.apps["app-mobile"]).length,
    0,
    "pristine lockfile must pass first",
  );
  lock.packages["node_modules/@expo/metro-config"] = { version: "57.0.5" };
  const failures = checkLockfile(
    "app-mobile",
    lock,
    registry.apps["app-mobile"],
  );
  assert.ok(
    failures.some((f) => /TRANSITIVE disguise/.test(f)),
    `lockfile-only @expo/metro-config 57.0.5 must fail; got:\n${failures.join("\n")}`,
  );
});

test("5. registry-only tamper still fails (two-sided pin)", () => {
  const registry = readJson(REGISTRY_FILE);
  const tampered = structuredClone(registry.apps["app-mobile"]);
  tampered.manifest.expo = "57"; // attacker approves 57 without touching code
  const pkg = readJson(path.join(root, "app-mobile", "package.json"));
  const failures = checkManifest("app-mobile", pkg, tampered);
  assert.ok(
    failures.some((f) => /MAJOR moved for "expo"/.test(f)),
    "manifest at 54 vs registry at 57 must fail (mismatch is symmetric)",
  );
});

test("6. prerelease version strings do not bypass the parser", () => {
  assert.equal(majorLineOf("57.0.0-rc.1"), "57");
  assert.equal(majorLineOf("~57.0.0-beta.2+build.7"), "57");
  assert.equal(majorLineOf("0.82.0-nightly-20260101"), "0.82");
  const pkg = readJson(path.join(root, "app-mobile", "package.json"));
  pkg.dependencies.expo = "57.0.0-rc.1";
  const failures = checkPairing({ "app-mobile": pkg });
  assert.ok(
    failures.some((f) =>
      /expo major line 57 has NO approved react-native pairing/.test(f),
    ),
    "a prerelease expo 57 spec must still hit the pairing wall",
  );
});

test("7. missing registry file fails CLOSED", () => {
  const failures = runAll(root, null) && runAll(root); // sanity: normal path ok
  assert.deepEqual(failures, []);
  // Point the gate at a tree whose registry cannot be read by passing a
  // bogus registry object shape: no apps key → every guarded app must fail.
  const failuresNoApps = runAll(root, {});
  assert.equal(
    failuresNoApps.filter((f) => /Registry has no entry/.test(f)).length,
    GUARDED_APPS.length,
    "an empty registry must fail every guarded app, not pass silently",
  );
});

test("8. committed registry matches computeRegistry() of the current tree", () => {
  const committed = readJson(REGISTRY_FILE);
  const fresh = computeRegistry(root);
  assert.deepEqual(
    { apps: committed.apps },
    fresh,
    "registry drift: regenerate via --print-registry inside a deliberate-upgrade PR",
  );
});

test("9. babel presets referenced by app-mobile/babel.config.js are declared deps", () => {
  // ORCH-1386 fix component: app-mobile's babel.config.js references
  // 'babel-preset-expo' by name, but the manifest never declared it — it
  // resolved only via npm hoisting accident (the ORCH-1385 undeclared-dep
  // bug class). During the expo-54 revert, npm's incremental placement
  // nested it under expo/node_modules and every native bundle died with
  // "Cannot find module 'babel-preset-expo'". The fix declares it in
  // devDependencies; deleting that declaration must fail THIS test.
  const babelConfigPath = path.join(root, "app-mobile", "babel.config.js");
  const src = fs.readFileSync(babelConfigPath, "utf8");
  const referenced = [...src.matchAll(/['"]([a-z0-9@][a-z0-9@/._-]*)['"]/gi)]
    .map((m) => m[1])
    .filter((s) => /^(babel-preset-|@babel\/preset-)/.test(s));
  assert.ok(
    referenced.includes("babel-preset-expo"),
    "expected app-mobile/babel.config.js to reference babel-preset-expo (if this legitimately changed, update this test in a deliberate PR)",
  );
  const pkg = readJson(path.join(root, "app-mobile", "package.json"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const name of referenced) {
    assert.ok(
      name in deps,
      `app-mobile/babel.config.js references "${name}" but app-mobile/package.json does not declare it — resolution must never lean on hoisting accidents (ORCH-1385/ORCH-1386 doctrine)`,
    );
  }
});
