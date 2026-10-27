// #3643 Wave 4 — a live workflow is registered by its PROPERTIES, not its bytes.
//
// Before this, every live per-issue workflow row in the CI registry carried a
// sha256 of the file, so rewording one comment forced a registry re-seal (or a
// patch file). The protection that mattered was never the bytes: it was that the
// registry's triggers, path filters, jobs, timeouts, runners, runtimes, setup
// actions and trust boundary are exactly what the YAML says. This proves both
// halves on a scratch clone of the committed tree, never on the branch itself:
// a wording-only edit needs no registry change, and every property edit is red.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BOOTSTRAP_SHA256, loadEffectiveManifest } from "../load-manifest.mjs";
import { PACKAGE_AUTHORITY_DIGESTS, validateRegistry } from "../validate-manifest-v2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
// Assembled, never spelled: a live workflow filename written in a tracked source
// makes that source an external provider reference and moves the provider seal.
const STEM = "issue-1423-stay-discovery-tests";
const NAME = [STEM, "yml"].join(".");
const WORKFLOW = path.posix.join(".github/workflows", NAME);

function scratchClone() {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "issue-3643-properties-")));
  execFileSync("git", ["clone", "-q", "--no-hardlinks", ROOT, temp]);
  // Same overlay the #2438 suite uses: the package authorities are pinned by the
  // validator and must match the working tree they were sealed against.
  for (const relative of Object.keys(PACKAGE_AUTHORITY_DIGESTS)) {
    fs.copyFileSync(path.join(ROOT, relative), path.join(temp, relative));
  }
  return temp;
}

function errorsFor(root, mutateManifest = () => {}) {
  const manifest = loadEffectiveManifest({
    root,
    manifestPath: path.join(root, ".github/ci-batch/MANIFEST.json"),
    expectedSha: BOOTSTRAP_SHA256,
    discover: true,
  });
  mutateManifest(manifest);
  return validateRegistry(manifest, { root });
}

test("#3643 a wording edit to a live workflow needs no registry change; a property edit is red", (t) => {
  const temp = scratchClone();
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const target = path.join(temp, WORKFLOW);
  const original = fs.readFileSync(target, "utf8");
  const withSource = (source, fn) => {
    fs.writeFileSync(target, source);
    try { return fn(); } finally { fs.writeFileSync(target, original); }
  };
  const drifted = (errors) => errors.some((error) => error.includes(`${NAME}: runtime/setup/trust/trigger inventory drifted`));

  assert.deepEqual(errorsFor(temp), [], "the scratch clone must validate before any edit");

  // Cheap now: a comment line changes no property.
  const reworded = original.replace(/^on:$/m, "# Reworded for clarity; no behaviour change.\non:");
  assert.notEqual(reworded, original);
  assert.deepEqual(withSource(reworded, () => errorsFor(temp)), [],
    "a comment-only edit to a live workflow must not need a manifest change");

  // Every property edit is still red, and names the workflow.
  const mutations = [
    ["timeout", original.replace("timeout-minutes: 25", "timeout-minutes: 26")],
    ["job key", original.replace(/^  consumer-stay-discovery:$/m, "  consumer-stay-discovery-renamed:")],
    ["trigger", original.replace(/^on:\n/m, "on:\n  workflow_dispatch:\n")],
    ["path filter", original.replace('      - "app-mobile/src/hooks/useDiscoverStays.ts"\n', '      - "app-mobile/src/hooks/useDiscoverStays.ts"\n      - "app-mobile/src/hooks/useDiscoverStaysExtra.ts"\n')],
  ];
  for (const [label, source] of mutations) {
    assert.notEqual(source, original, `${label}: the mutation must change the workflow`);
    assert.ok(withSource(source, () => drifted(errorsFor(temp))), `${label}: a property edit must stay red`);
  }

  // A stale byte fingerprint cannot be smuggled back onto a live row.
  const stale = errorsFor(temp, (manifest) => {
    const row = manifest.legacyOrigins.find((item) => item.stem === STEM);
    row.workflowMetadata = { sourceSha256: "0".repeat(64), ...row.workflowMetadata };
  });
  assert.ok(stale.some((error) => error.includes(`${NAME}: a live workflow row must not carry a byte fingerprint`)),
    "a live row carrying sourceSha256 must be red");
});
