#!/usr/bin/env node
/**
 * ORCH-1386 TESTER ADVERSARIAL suite — framework-major guard attacked from
 * angles the implementor's companion does NOT cover.
 *
 * Provenance rule (COMMS-0106): every case imports the REAL shipped gate
 * module (`orch-1386-framework-major-guard.mjs`) — its exported check
 * functions, parser, pairing table, and `runAll` aggregator. Nothing is
 * re-implemented, so this suite can never drift green while the shipped
 * gate rots.
 *
 * Angle deltas vs the companion suite (orch-1386-framework-major-guard.test.mjs):
 *  - T1 attacks the ROOT framework package (`node_modules/expo` itself)
 *    lockfile-only — the companion only moves `@expo/metro-config`.
 *  - T2 attacks a NESTED-ONLY path (`node_modules/expo/node_modules/…`) —
 *    the companion only tampers a top-level path.
 *  - T3 attacks MINGLA-BUSINESS's lockfile — the companion only attacks
 *    app-mobile's.
 *  - T4 proves an npm `alias` spec on a family key cannot slip the parser.
 *  - T5 pins the parser's contract on exotic/prerelease specs INCLUDING its
 *    documented laxity (a range's lower bound is "the" major) so any silent
 *    parser change surfaces here first.
 *  - T6 proves the PAIRING wall is the last line even when an attacker
 *    fully regenerates the registry to approve expo 57 (the one shape that
 *    beats checks A and B).
 *  - T7 pins EXPO_RN_PAIRING itself — the only way past T6 is extending the
 *    table, which must red this test and therefore be a deliberate,
 *    reviewed, test-updating PR.
 *  - T8 proves cross-app expo parity on REAL manifest copies.
 *  - T9 exercises the runAll() AGGREGATOR end-to-end against a scratch tree
 *    built from the real four apps' manifest+lockfile pairs (the companion
 *    only calls per-check functions for its tamper cases).
 *
 * fails-on-revert (tester-verified, two-sided):
 *  (a) reverting the FIX (expo back to ~57.0.6 in a manifest copy of the
 *      shipped tree) reds T9's pristine leg via the real files;
 *  (b) neutering the GATE (line-deleting checkLockfile's outside-approved-set
 *      failure push) reds T1/T2/T9.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPO_RN_PAIRING,
  GUARDED_APPS,
  REGISTRY_FILE,
  checkLockfile,
  checkManifest,
  checkPairing,
  majorLineOf,
  runAll,
} from "./orch-1386-framework-major-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const registry = readJson(REGISTRY_FILE);
const appLock = (app) => readJson(path.join(root, app, "package-lock.json"));
const appPkg = (app) => readJson(path.join(root, app, "package.json"));

test("T1. lockfile-only major of the ROOT framework package (node_modules/expo → 57) fails", () => {
  const lock = appLock("app-mobile");
  assert.equal(
    checkLockfile("app-mobile", lock, registry.apps["app-mobile"]).length,
    0,
    "pristine lockfile must pass first",
  );
  lock.packages["node_modules/expo"].version = "57.0.6";
  const failures = checkLockfile(
    "app-mobile",
    lock,
    registry.apps["app-mobile"],
  );
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(
    failures[0],
    /"expo" resolved at major line 57/,
    "the root framework package moving lockfile-only must be named explicitly",
  );
});

test("T2. NESTED-only family major (node_modules/expo/node_modules/@expo/metro-config → 57) fails with correct attribution", () => {
  const lock = appLock("app-mobile");
  lock.packages["node_modules/expo/node_modules/@expo/metro-config"] = {
    version: "57.0.5",
  };
  const failures = checkLockfile(
    "app-mobile",
    lock,
    registry.apps["app-mobile"],
  );
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(
    failures[0],
    /"@expo\/metro-config" resolved at major line 57/,
    "nested paths must attribute to the package name after the LAST node_modules/",
  );
});

test("T3. NEW family package injected lockfile-only into MINGLA-BUSINESS fails", () => {
  const lock = appLock("mingla-business");
  assert.equal(
    checkLockfile(
      "mingla-business",
      lock,
      registry.apps["mingla-business"],
    ).length,
    0,
    "pristine mingla-business lockfile must pass first",
  );
  lock.packages["node_modules/@expo/dom-webview"] = { version: "57.0.1" };
  const failures = checkLockfile(
    "mingla-business",
    lock,
    registry.apps["mingla-business"],
  );
  assert.ok(
    failures.some((f) =>
      /NEW framework-family package "@expo\/dom-webview"/.test(f),
    ),
    `mingla-business new-family-package wall must fire; got:\n${failures.join("\n")}`,
  );
});

test("T4. npm alias spec on a family key (expo: npm:expo@57.0.6) cannot slip the parser", () => {
  assert.equal(majorLineOf("npm:expo@57.0.6"), null);
  const pkg = appPkg("app-mobile");
  pkg.dependencies.expo = "npm:expo@57.0.6";
  const failures = checkManifest(
    "app-mobile",
    pkg,
    registry.apps["app-mobile"],
  );
  assert.ok(
    failures.some((f) => /un-pinnable spec/.test(f)),
    "an alias spec on a family key must fail loud as un-pinnable, never parse as an approved major",
  );
});

test("T5. parser contract pinned on exotic specs (incl. documented range laxity)", () => {
  // Hard guarantees — prerelease/build-metadata never bypass:
  assert.equal(majorLineOf("57.0.0-rc.1"), "57");
  assert.equal(majorLineOf("~54.0.34-beta"), "54");
  assert.equal(majorLineOf("~57.0.0-beta.2+build.7"), "57");
  assert.equal(majorLineOf("0.82.0-nightly-20260101"), "0.82");
  // Fail-loud (null → un-pinnable violation at the caller):
  assert.equal(majorLineOf("npm:expo@57"), null);
  assert.equal(majorLineOf("workspace:*"), null);
  assert.equal(majorLineOf("workspace:^54.0.0"), null);
  assert.equal(majorLineOf("file:../expo"), null);
  assert.equal(majorLineOf("git+https://github.com/expo/expo#sdk-57"), null);
  assert.equal(majorLineOf("latest"), null);
  assert.equal(majorLineOf("*"), null);
  assert.equal(majorLineOf(""), null);
  assert.equal(majorLineOf("0"), null);
  // DOCUMENTED LAXITY (tester-pinned): a range's lower bound is taken as
  // "the" major line, so ">=54 <58" passes check A even though it PERMITS
  // 57. The resolved-truth wall (check B, lockfile) is the backstop — the
  // built artifact cannot move majors without the lockfile moving, which
  // check B rejects. If majorLineOf is ever tightened, update these two
  // assertions deliberately.
  assert.equal(majorLineOf(">=54 <58"), "54");
  assert.equal(majorLineOf("54.x || 57.x"), "54");
});

test("T6. FULL registry tamper (attacker approves 57 everywhere) still dies on the pairing wall", () => {
  // Attacker regenerates the registry so checks A and B both pass at 57.
  const tampered = structuredClone(registry);
  tampered.apps["app-mobile"].manifest.expo = "57";
  tampered.apps["mingla-business"].manifest.expo = "57";
  const pkgA = appPkg("app-mobile");
  const pkgB = appPkg("mingla-business");
  pkgA.dependencies.expo = "~57.0.6";
  pkgB.dependencies.expo = "~57.0.6";
  // Check A is silent by design under the tampered registry…
  assert.equal(
    checkManifest("app-mobile", pkgA, tampered.apps["app-mobile"]).length,
    0,
    "precondition: manifest wall is intentionally beaten by the tampered registry",
  );
  // …so the pairing table must be the last line, and it must fire for BOTH apps.
  const failures = checkPairing({
    "app-mobile": pkgA,
    "mingla-business": pkgB,
  });
  assert.equal(
    failures.filter((f) => /NO approved react-native pairing/.test(f)).length,
    2,
    `pairing wall must reject expo 57 for both apps; got:\n${failures.join("\n")}`,
  );
});

test("T7. EXPO_RN_PAIRING is exactly the vetted table (extending it must be a deliberate, test-updating PR)", () => {
  assert.deepEqual(
    EXPO_RN_PAIRING,
    { 54: "0.81" },
    "the pairing table is the LAST wall past a full registry tamper (T6); any extension is the deliberate-upgrade act and must update this assertion in the same reviewed PR",
  );
});

test("T8. cross-app expo parity fires on REAL manifest copies (54 vs 55)", () => {
  const pkgA = appPkg("app-mobile");
  const pkgB = appPkg("mingla-business");
  pkgB.dependencies.expo = "~55.0.0";
  const failures = checkPairing({
    "app-mobile": pkgA,
    "mingla-business": pkgB,
  });
  assert.ok(
    failures.some((f) => /differs between/.test(f)),
    `both mobile apps must ship the SAME expo major; got:\n${failures.join("\n")}`,
  );
});

test("T9. runAll() end-to-end on a scratch tree: pristine passes, single lockfile tamper fails with exactly that violation", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "orch1386-adv-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  for (const app of GUARDED_APPS) {
    fs.mkdirSync(path.join(tmpRoot, app), { recursive: true });
    for (const f of ["package.json", "package-lock.json"]) {
      fs.copyFileSync(
        path.join(root, app, f),
        path.join(tmpRoot, app, f),
      );
    }
  }
  // Pristine scratch tree ≡ shipped tree → the aggregator must pass.
  // (fails-on-revert side (a): restoring expo ~57.0.6 in the shipped
  // manifests reds THIS assertion through the real files.)
  const pristine = runAll(tmpRoot);
  assert.deepEqual(
    pristine,
    [],
    `runAll must pass on a copy of the shipped tree; got:\n${pristine.join("\n")}`,
  );
  // Tamper ONE lockfile transitively (manifest untouched — the #925 shape).
  const lockPath = path.join(tmpRoot, "app-mobile", "package-lock.json");
  const lock = readJson(lockPath);
  lock.packages["node_modules/@expo/metro-config"] = { version: "57.0.5" };
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  const failures = runAll(tmpRoot);
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(
    failures[0],
    /app-mobile\/package-lock\.json.*"@expo\/metro-config" resolved at major line 57/s,
    "the aggregator must surface exactly the transitive tamper, attributed to the right app and package",
  );
});
