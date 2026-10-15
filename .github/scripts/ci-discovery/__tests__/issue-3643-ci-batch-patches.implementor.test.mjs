import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_PATH,
  BOOTSTRAP_SHA256,
  bootstrapRowSha256,
  loadBootstrap,
  loadEffectiveManifest,
} from "../../ci-batch/load-manifest.mjs";
import { validateRegistry } from "../../ci-batch/validate-manifest-v2.mjs";
import { expectedSuites, selectSuites } from "../../ci-batch/run-suite-batch.mjs";
import { routedProvider } from "../../ci-batch/route-live-provider.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function temporary(label) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `issue-3643-patch-${label}-`));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, contents = "") {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function writeJson(root, relative, value) {
  return write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

function seedProductionPatches(root, sourceRoot = ROOT) {
  const relativePatchDirectory = ".github/ci-batch/patches";
  const sourcePatchDirectory = path.join(sourceRoot, relativePatchDirectory);
  const targetedRows = new Set();
  if (!fs.existsSync(sourcePatchDirectory)) return targetedRows;

  fs.cpSync(sourcePatchDirectory, path.join(root, relativePatchDirectory), { recursive: true });
  for (const entry of fs.readdirSync(sourcePatchDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ci-batch.patch.json")) continue;
    const declaration = JSON.parse(fs.readFileSync(path.join(sourcePatchDirectory, entry.name), "utf8"));
    const { collection, selector } = declaration.target;
    targetedRows.add(collection === "suites"
      ? `suites:id=${selector.id}`
      : `legacyOrigins:stem=${selector.stem}:extension=${selector.extension}`);

    const referencedPaths = collection === "legacyOrigins"
      ? [path.posix.join(".github/workflows", `${selector.stem}.${selector.extension}`)]
      : declaration.operations
        .filter((operation) => operation.op === "append-unique")
        .map((operation) => operation.value);
    for (const relative of referencedPaths) {
      const source = path.join(sourceRoot, relative);
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(source, target, { recursive: true });
    }
  }
  return targetedRows;
}

function syntheticFixture(label, { duplicateLegacy = false } = {}) {
  const root = temporary(label);
  const workflowSource = "name: Synthetic ownership proof\njobs: {}\n";
  const legacy = {
    stem: "synthetic-owned-lane",
    extension: "yml",
    ownerIssue: "#3643",
    disposition: "database-special",
    workflowMetadata: { sourceSha256: sha256("sealed predecessor\n") },
  };
  const suite = {
    id: "synthetic-owned-suite",
    originPaths: ["owned.txt"],
    externalReferenceFiles: [],
  };
  const bootstrap = {
    schemaVersion: 2,
    expectedExecutableSuites: 1,
    expectedSuites: 1,
    classes: [],
    setupProfiles: {},
    commandCapabilities: { schemaVersion: 1, expectedCommands: 0, registrySha256: sha256("[]"), commands: [] },
    suites: [suite],
    legacyOrigins: duplicateLegacy ? [legacy, structuredClone(legacy)] : [legacy],
  };
  const manifestPath = writeJson(root, "bootstrap.json", bootstrap);
  const expectedSha = sha256(fs.readFileSync(manifestPath));
  write(root, `.github/workflows/${legacy.stem}.${legacy.extension}`, workflowSource);
  write(root, "owned.txt", "owned\n");
  write(root, "appended.txt", "appended\n");
  const legacyPatch = () => ({
    schemaVersion: 1,
    kind: "ci-batch-bootstrap-patch",
    ownerIssue: "#3643",
    target: {
      collection: "legacyOrigins",
      selector: { stem: legacy.stem, extension: legacy.extension },
      baseRowSha256: bootstrapRowSha256(legacy),
    },
    operations: [{
      op: "replace",
      path: "/workflowMetadata/sourceSha256",
      expected: legacy.workflowMetadata.sourceSha256,
      value: sha256(workflowSource),
    }],
    dependentSeals: [],
    reason: "Synthetic source ownership changes while execution topology stays fixed.",
  });
  const suitePatch = () => ({
    schemaVersion: 1,
    kind: "ci-batch-bootstrap-patch",
    ownerIssue: "#3643",
    target: {
      collection: "suites",
      selector: { id: suite.id },
      baseRowSha256: bootstrapRowSha256(suite),
    },
    operations: [{
      op: "append-unique",
      path: "/originPaths",
      expected: suite.originPaths,
      value: "appended.txt",
    }],
    dependentSeals: [],
    reason: "Synthetic additive provenance follows its existing owning suite.",
  });
  const patch = (name, declaration) => writeJson(root, `.github/ci-batch/patches/${name}.ci-batch.patch.json`, declaration);
  const load = () => loadEffectiveManifest({ root, manifestPath, expectedSha, discover: true });
  return { root, bootstrap, manifestPath, expectedSha, legacy, suite, legacyPatch, suitePatch, patch, load };
}

test("bootstrap patches preserve row identity, order and counts for both allowed patch shapes", () => {
  const fixture = syntheticFixture("positive");
  fixture.patch("legacy", fixture.legacyPatch());
  fixture.patch("suite", fixture.suitePatch());
  const effective = fixture.load();
  assert.equal(effective.legacyOrigins.length, 1);
  assert.equal(effective.suites.length, 1);
  assert.equal(effective.legacyOrigins[0].stem, fixture.legacy.stem);
  assert.equal(effective.legacyOrigins[0].workflowMetadata.sourceSha256, fixture.legacyPatch().operations[0].value);
  assert.deepEqual(effective.suites[0].originPaths, ["owned.txt", "appended.txt"]);
  assert.equal(effective.suites[0].id, fixture.suite.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8")), fixture.bootstrap);
});
test("validator, runner, selector and router consume one effective registry view", () => {
  const root = temporary("production-consumers");
  const bootstrap = loadBootstrap();
  const productionPatchTargets = seedProductionPatches(root);
  const suite = bootstrap.suites.find((entry) =>
    !productionPatchTargets.has(`suites:id=${entry.id}`) &&
    !(entry.originPaths || []).some((value) => typeof value === "string" && value.startsWith(".github/workflows/"))
  );
  assert.ok(suite, "fixture needs one suite whose CAS value carries no workflow filename literal");
  write(root, "MARKETING.md", "synthetic path presence\n");
  writeJson(root, ".github/ci-batch/patches/suite.ci-batch.patch.json", {
    schemaVersion: 1,
    kind: "ci-batch-bootstrap-patch",
    ownerIssue: "#3643",
    target: {
      collection: "suites",
      selector: { id: suite.id },
      baseRowSha256: bootstrapRowSha256(suite),
    },
    operations: [{ op: "append-unique", path: "/originPaths", expected: suite.originPaths, value: "MARKETING.md" }],
    dependentSeals: [],
    reason: "Synthetic consumer parity proves the canonical overlay is never bypassed.",
  });
  const effective = loadEffectiveManifest({ root, manifestPath: BOOTSTRAP_PATH, expectedSha: BOOTSTRAP_SHA256, discover: true });
  const patched = effective.suites.find((entry) => entry.id === suite.id);
  assert.ok(patched.originPaths.includes("MARKETING.md"));
  assert.deepEqual(validateRegistry(effective, { root: ROOT }), []);
  assert.equal(expectedSuites(effective).find((entry) => entry.id === suite.id), patched);
  const selection = selectSuites(effective, [patched], {
    mode: "routed",
    eventName: "pull_request",
    changedPaths: ["MARKETING.md"],
  });
  assert.ok(selection.selectedSuiteIds.includes(suite.id));
  assert.deepEqual(routedProvider(effective, "#1403"), routedProvider(bootstrap, "#1403"));

  const consumers = [
    ".github/scripts/ci-batch/validate-manifest-v2.mjs",
    ".github/scripts/ci-batch/run-suite-batch.mjs",
    ".github/scripts/ci-batch/select-phase3b-suites.mjs",
    ".github/scripts/ci-batch/route-live-provider.mjs",
    ".github/scripts/strict-grep/issue-2148-ci-runner-v2.mjs",
    ".github/scripts/strict-grep/meta-1383-manifest-parity.mjs",
  ];
  for (const consumer of consumers) {
    assert.match(fs.readFileSync(path.join(ROOT, consumer), "utf8"), /loadEffectiveManifest/,
      `${consumer} must not bypass the canonical effective registry`);
  }
});

test("consumer fixtures retain production patches and the files their CAS checks inspect", () => {
  const production = syntheticFixture("production-patch-source");
  production.patch("production", production.legacyPatch());
  const consumerRoot = temporary("seeded-production-consumer");
  const targets = seedProductionPatches(consumerRoot, production.root);
  assert.deepEqual([...targets], [
    `legacyOrigins:stem=${production.legacy.stem}:extension=${production.legacy.extension}`,
  ]);
  const effective = loadEffectiveManifest({
    root: consumerRoot,
    manifestPath: production.manifestPath,
    expectedSha: production.expectedSha,
    discover: true,
  });
  assert.equal(
    effective.legacyOrigins[0].workflowMetadata.sourceSha256,
    production.legacyPatch().operations[0].value,
  );
});

test("bootstrap patch declarations fail closed for every forbidden or stale shape", async (t) => {
  const expectFailure = async (label, mutate, pattern, options = {}) => t.test(label, () => {
    const fixture = syntheticFixture(label, options);
    const declaration = fixture.legacyPatch();
    mutate({ fixture, declaration });
    if (!fs.existsSync(path.join(fixture.root, ".github/ci-batch/patches/primary.ci-batch.patch.json"))) {
      fixture.patch("primary", declaration);
    }
    assert.throws(() => fixture.load(), pattern);
  });

  await expectFailure("bootstrap-byte-drift", ({ fixture }) => {
    fs.appendFileSync(fixture.manifestPath, " ");
  }, /bootstrap_seal_mismatch/);
  await expectFailure("unknown-collection", ({ declaration }) => {
    declaration.target.collection = "providers";
  }, /unknown_patch_collection/);
  await expectFailure("malformed-selector", ({ declaration }) => {
    delete declaration.target.selector.extension;
  }, /malformed_patch_selector/);
  await expectFailure("zero-selector-matches", ({ declaration }) => {
    declaration.target.selector.stem = "missing-owned-lane";
  }, /patch_target_cardinality:.*matches=0/);
  await expectFailure("multiple-selector-matches", () => {}, /patch_target_cardinality:.*matches=2/, { duplicateLegacy: true });
  await expectFailure("index-target", ({ fixture, declaration }) => {
    Object.assign(declaration, fixture.suitePatch());
    declaration.operations[0].path = "/originPaths/0";
  }, /index_target_forbidden/);
  await expectFailure("stale-base-row", ({ declaration }) => {
    declaration.target.baseRowSha256 = "0".repeat(64);
  }, /stale_base_row/);
  await expectFailure("wrong-expected", ({ declaration }) => {
    declaration.operations[0].expected = "1".repeat(64);
  }, /patch_cas_mismatch/);
  await expectFailure("unknown-pointer", ({ declaration }) => {
    declaration.operations[0].path = "/rationale";
  }, /unknown_patch_path/);
  await expectFailure("full-row-replacement", ({ declaration }) => {
    declaration.operations[0].path = "/";
  }, /row_mutation_forbidden/);
  await expectFailure("row-addition", ({ declaration }) => {
    declaration.operations[0] = { op: "add", path: "/newRow", expected: null, value: {} };
  }, /row_mutation_forbidden/);
  await expectFailure("row-removal", ({ declaration }) => {
    declaration.operations[0] = { op: "remove", path: "/workflowMetadata", expected: {}, value: null };
  }, /row_mutation_forbidden/);
  await expectFailure("duplicate-target-descriptors", ({ fixture, declaration }) => {
    fixture.patch("primary", declaration);
    fixture.patch("secondary", structuredClone(declaration));
  }, /duplicate_patch_target/);
  await expectFailure("duplicate-operation-path", ({ declaration }) => {
    declaration.operations.push(structuredClone(declaration.operations[0]));
  }, /duplicate_patch_path/);
  await expectFailure("no-op", ({ declaration }) => {
    declaration.operations[0].value = declaration.operations[0].expected;
  }, /patch_noop/);
  await expectFailure("suite-provenance-replacement", ({ fixture, declaration }) => {
    Object.assign(declaration, fixture.suitePatch());
    declaration.operations[0].op = "replace";
    declaration.operations[0].value = ["appended.txt", "owned.txt"];
  }, /provenance_mutation_forbidden/);
  await expectFailure("missing-appended-path", ({ fixture, declaration }) => {
    Object.assign(declaration, fixture.suitePatch());
    declaration.operations[0].value = "missing.txt";
  }, /appended_path_missing/);
  await expectFailure("source-digest-mismatch", ({ declaration }) => {
    declaration.operations[0].value = "2".repeat(64);
  }, /source_digest_mismatch/);
  await expectFailure("unrelated-operation-field", ({ declaration }) => {
    declaration.operations[0].unrelated = true;
  }, /malformed_patch_operation/);
  await expectFailure("dependent-seal-field", ({ fixture, declaration }) => {
    Object.assign(declaration, fixture.suitePatch());
    declaration.operations[0] = { op: "replace", path: "/steps", expected: [], value: [] };
  }, /dependent_seal_change/);
});
