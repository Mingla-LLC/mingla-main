import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_PATH,
  BOOTSTRAP_SHA256,
  loadBootstrap,
  loadEffectiveManifest,
  trustedRegistryViews,
} from "../load-manifest.mjs";
import { loadAndValidate, validateRegistry } from "../validate-manifest-v2.mjs";
import { expectedSuites, selectSuites } from "../run-suite-batch.mjs";
import { governanceVerdict } from "../../strict-grep/issue-2148-ci-registry-v2.mjs";
import {
  effectiveBatchInvocationSource,
  run as runJestReachability,
} from "../../strict-grep/issue-1486-jest-config-invoked-by-workflow.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const LOCAL_ID = "issue-9998-additive-registry-fixture";
const LOCAL_COMMAND_ID = `assert:${LOCAL_ID}:01`;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function temporary(label) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `issue-3643-additive-${label}-`));
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

function descriptor({
  id = LOCAL_ID,
  ownerIssue = "#9998",
  expectedFile = ".github/scripts/ci-batch/__fixtures__/issue9998_additive_registry.test.mjs",
  descriptorPath = ".github/scripts/ci-batch/__fixtures__/issue-9998-additive-registry.ci-batch.json",
} = {}) {
  const run = `node --test ${expectedFile}`;
  return {
    descriptorPath,
    value: {
      schemaVersion: 1,
      kind: "ci-batch-suite",
      ownerIssue,
      suite: {
        id,
        class: "node20-noinstall",
        originPaths: [expectedFile],
        steps: [{
          name: "Run the issue-owned additive registry proof",
          cwd: ".",
          run,
          commandId: `assert:${id}:01`,
          invocation: { kind: "raw-shell", command: "bash", argv: ["-c", run] },
          exceptionRationale: "Raw shell matches the legacy workflow command contract while the descriptor owns registration.",
        }],
        lifecycle: "batched-active",
        ownerIssue,
        runtime: { name: "node", version: "20" },
        setupProfile: "node20-noinstall",
        cwd: ".",
        envNames: [],
        isolation: "clean-worktree",
        expectedFiles: [expectedFile],
        externalReferenceFiles: [],
        requiredContext: "CI batch: node20-noinstall",
        timingSeconds: { p50: null, p95: null, evidence: "not-yet-measured" },
        generatedPaths: ["suite-results.json"],
        exceptionRationale: "Raw shell is retained for the issue-owned command without adding an execution grammar.",
        timeoutSeconds: 480,
      },
    },
  };
}

function syntheticLoaderFixture(label, { bootstrapSuiteId = null } = {}) {
  const root = temporary(label);
  const bootstrap = {
    schemaVersion: 2,
    expectedExecutableSuites: 0,
    expectedSuites: 0,
    classes: ["node20-noinstall", "other"],
    executionClasses: ["node20-noinstall", "other"],
    setupProfiles: {
      "node20-noinstall": { runtime: { name: "node", version: "20" }, install: null, classes: ["node20-noinstall"] },
      other: { runtime: { name: "node", version: "20" }, install: null, classes: ["other"] },
    },
    suites: bootstrapSuiteId ? [{ id: bootstrapSuiteId }] : [],
    legacyOrigins: [],
    commandCapabilities: { schemaVersion: 1, expectedCommands: 0, registrySha256: sha256("[]"), commands: [] },
  };
  const manifestPath = writeJson(root, "bootstrap.json", bootstrap);
  const expectedSha = sha256(fs.readFileSync(manifestPath));
  const declaration = descriptor({
    expectedFile: "fixtures/local.test.mjs",
    descriptorPath: "fixtures/local.ci-batch.json",
  });
  write(root, declaration.value.suite.expectedFiles[0], "// synthetic local expected file\n");
  const save = (entry = declaration) => writeJson(root, entry.descriptorPath, entry.value);
  const load = () => loadEffectiveManifest({ root, manifestPath, expectedSha, discover: true });
  return { root, bootstrap, declaration, save, load };
}

function addDetachedWorktree(label) {
  const root = temporary(label);
  fs.rmSync(root, { recursive: true, force: true });
  execFileSync("git", ["worktree", "add", "--detach", root, "HEAD"], { cwd: ROOT, stdio: "pipe" });
  test.after(() => {
    try { execFileSync("git", ["worktree", "remove", "--force", root], { cwd: ROOT, stdio: "pipe" }); }
    catch { fs.rmSync(root, { recursive: true, force: true }); }
  });
  return root;
}

test("a synthetic additive suite passes the full production loader, validator, runner and selector path", () => {
  const root = addDetachedWorktree("full-validator");
  const manifestPath = path.join(root, path.relative(ROOT, BOOTSTRAP_PATH));
  const before = trustedRegistryViews(loadEffectiveManifest({
    root, manifestPath, expectedSha: BOOTSTRAP_SHA256, discover: true,
  }));
  assert.ok(before);
  const declaration = descriptor();
  write(root, declaration.value.suite.expectedFiles[0], [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'test("synthetic additive suite", () => assert.equal(1, 1));',
    "",
  ].join("\n"));
  writeJson(root, declaration.descriptorPath, declaration.value);
  execFileSync("git", ["add", declaration.descriptorPath, declaration.value.suite.expectedFiles[0]], { cwd: root });

  const { manifest, errors } = loadAndValidate(manifestPath, {
    root,
    expectedSha: BOOTSTRAP_SHA256,
    discover: true,
  });
  assert.deepEqual(errors, []);

  const views = trustedRegistryViews(manifest);
  assert.ok(views);
  // Adding a descriptor must leave both trusted bootstrap views unchanged.
  assert.deepEqual(views.rawBootstrap, before.rawBootstrap);
  assert.deepEqual(views.patchedBootstrap, before.patchedBootstrap);
  // [TEST-MOD-APPROVED #3682] Effective totals derive from the sealed
  // projection plus every trusted local descriptor, including this fixture.
  const localSuites = manifest.suites.filter((suite) => suite.localDescriptor);
  const localCommands = localSuites.reduce((sum, suite) => sum + suite.steps.length, 0);
  assert.equal(manifest.suites.length, views.patchedBootstrap.suites.length + localSuites.length);
  assert.equal(
    manifest.commandCapabilities.commands.length,
    views.patchedBootstrap.commandCapabilities.commands.length + localCommands,
  );
  assert.equal(manifest.suites.filter((suite) => suite.id === LOCAL_ID).length, 1);
  assert.equal(manifest.commandCapabilities.commands.filter((command) => command.id === LOCAL_COMMAND_ID).length, 1);

  const full = selectSuites(manifest, expectedSuites(manifest), { mode: "full", eventName: "push" });
  assert.equal(full.selectedSuiteIds.filter((id) => id === LOCAL_ID).length, 1);
  assert.equal(full.suites.filter((suite) => suite.id === LOCAL_ID).length, 1);
  const routed = selectSuites(manifest, expectedSuites(manifest), {
    mode: "routed",
    eventName: "pull_request",
    changedPaths: [declaration.value.suite.expectedFiles[0]],
  });
  assert.deepEqual(routed.selectedSuiteIds.filter((id) => id === LOCAL_ID), [LOCAL_ID]);
  assert.deepEqual(routed.suites.filter((suite) => suite.id === LOCAL_ID).map((suite) => suite.id), [LOCAL_ID]);
  assert.deepEqual(loadBootstrap({ manifestPath, expectedSha: BOOTSTRAP_SHA256 }), views.rawBootstrap);

  const local = manifest.suites.find((suite) => suite.id === LOCAL_ID);
  const originalPaths = local.originPaths;
  local.originPaths = [declaration.descriptorPath];
  const movedDescriptor = `${path.join(root, declaration.descriptorPath)}.moved`;
  fs.renameSync(path.join(root, declaration.descriptorPath), movedDescriptor);
  const missingDescriptorErrors = validateRegistry(manifest, { root });
  assert.ok(missingDescriptorErrors.some((error) => /local owned path is not covered/.test(error)));
  assert.ok(missingDescriptorErrors.some((error) => /trusted local descriptor is missing/.test(error)));
  fs.renameSync(movedDescriptor, path.join(root, declaration.descriptorPath));
  local.originPaths = originalPaths;

  const claimingOrigin = manifest.legacyOrigins.find((origin) => origin.disposition === "batched-active");
  const originalClaim = claimingOrigin.replacementSuite;
  claimingOrigin.replacementSuite = LOCAL_ID;
  assert.ok(validateRegistry(manifest, { root }).some((error) => /zero legacy claims|patched bootstrap exactly/.test(error)));
  claimingOrigin.replacementSuite = originalClaim;
});

test("generic governance and Jest reachability consume the synthetic additive suite exactly once", () => {
  const root = addDetachedWorktree("generic-consumers");
  const configPath = "mingla-business/jest.issue9998.local.cjs";
  const expectedFile = "mingla-business/issue9998_additive_registry.test.mjs";
  const declaration = descriptor({
    expectedFile,
    descriptorPath: "mingla-business/issue-9998-additive-registry.ci-batch.json",
  });
  const run = `npx jest --config ${configPath} --listTests && node --test ${expectedFile}`;
  declaration.value.suite.originPaths = [configPath, expectedFile];
  declaration.value.suite.expectedFiles = [configPath, expectedFile].sort();
  declaration.value.suite.steps[0].run = run;
  declaration.value.suite.steps[0].invocation.argv[1] = run;
  write(root, configPath, 'module.exports = { testMatch: ["<rootDir>/issue9998_additive_registry.test.mjs"] };\n');
  write(root, expectedFile, "// synthetic expected file\n");
  writeJson(root, declaration.descriptorPath, declaration.value);
  execFileSync("git", ["add", configPath, expectedFile, declaration.descriptorPath], { cwd: root });

  const manifestPath = path.join(root, path.relative(ROOT, BOOTSTRAP_PATH));
  const governed = governanceVerdict({ root, manifestPath });
  assert.deepEqual(governed.errors, []);
  const governedViews = trustedRegistryViews(governed.manifest);
  assert.ok(governedViews);
  // [TEST-MOD-APPROVED #3682] The generic consumer follows the same sealed
  // projection plus all trusted local descriptors, not one assumed fixture.
  const governedLocalSuites = governed.manifest.suites.filter((suite) => suite.localDescriptor);
  const governedLocalCommands = governedLocalSuites.reduce((sum, suite) => sum + suite.steps.length, 0);
  assert.equal(governed.manifest.suites.length, governedViews.patchedBootstrap.suites.length + governedLocalSuites.length);
  assert.equal(
    governed.manifest.commandCapabilities.commands.length,
    governedViews.patchedBootstrap.commandCapabilities.commands.length + governedLocalCommands,
  );
  assert.equal(governed.manifest.suites.filter((suite) => suite.id === LOCAL_ID).length, 1);

  const effectiveSource = effectiveBatchInvocationSource({ root, manifestPath });
  assert.equal(effectiveSource.text.split(configPath).length - 1, 2);
  const configs = [
    { name: "jest.config.cjs", code: "module.exports = {};" },
    { name: path.basename(configPath), code: 'module.exports = { testMatch: ["<rootDir>/issue9998_additive_registry.test.mjs"] };' },
  ];
  const effectiveVerdict = runJestReachability({
    configs,
    workflows: [{ name: "default", text: "npm test" }, effectiveSource],
    npmScripts: {},
  }, { minConfigs: 2, minWorkflows: 1 });
  assert.deepEqual(effectiveVerdict, { code: 0, failures: [] });

  const rawSource = {
    name: "raw-bootstrap",
    text: fs.readFileSync(manifestPath, "utf8"),
  };
  const rawVerdict = runJestReachability({
    configs,
    workflows: [{ name: "default", text: "npm test" }, rawSource],
    npmScripts: {},
  }, { minConfigs: 2, minWorkflows: 1 });
  assert.equal(rawVerdict.code, 1);
  assert.ok(rawVerdict.failures.some((failure) => failure.includes(path.basename(configPath))));

  fs.rmSync(path.join(root, declaration.descriptorPath));
  execFileSync("git", ["add", "-u", declaration.descriptorPath], { cwd: root });
  const withoutDescriptor = effectiveBatchInvocationSource({ root, manifestPath });
  const missingVerdict = runJestReachability({
    configs,
    workflows: [{ name: "default", text: "npm test" }, withoutDescriptor],
    npmScripts: {},
  }, { minConfigs: 2, minWorkflows: 1 });
  assert.equal(missingVerdict.code, 1);
  assert.ok(missingVerdict.failures.some((failure) => failure.includes(path.basename(configPath))));
});

test("local descriptor declarations fail closed for malformed ownership, execution and routing shapes", async (t) => {
  const expectFailure = async (label, mutate, pattern, prepare = () => {}) => t.test(label, () => {
    const fixture = syntheticLoaderFixture(label);
    prepare(fixture);
    mutate(fixture.declaration.value, fixture);
    fixture.save();
    assert.throws(() => fixture.load(), pattern);
  });

  await expectFailure("malformed-envelope", (value) => { delete value.kind; }, /malformed_descriptor/);
  await expectFailure("owner-mismatch", (value) => { value.suite.ownerIssue = "#9997"; }, /descriptor_owner_mismatch/);
  await expectFailure("descriptor-supplied-provenance", (value) => { value.suite.localDescriptor = "fixtures/local.ci-batch.json"; }, /malformed_suite/);
  await t.test("bootstrap-id-shadow", () => {
    const fixture = syntheticLoaderFixture("bootstrap-shadow", { bootstrapSuiteId: LOCAL_ID });
    fixture.save();
    assert.throws(() => fixture.load(), /bootstrap_shadow/);
  });
  await expectFailure("missing-expected-file", (value) => { value.suite.expectedFiles = ["fixtures/missing.test.mjs"]; }, /missing_suite_path/);
  await expectFailure("nonlocal-expected-file", (value, fixture) => {
    write(fixture.root, "elsewhere/local.test.mjs", "// elsewhere\n");
    value.suite.expectedFiles = ["elsewhere/local.test.mjs"];
  }, /descriptor_not_local/);
  await expectFailure("absolute-path", (value) => { value.suite.expectedFiles = ["/tmp/escape.test.mjs"]; }, /missing_suite_path/);
  await expectFailure("parent-path", (value) => { value.suite.originPaths = ["../escape.test.mjs"]; }, /invalid_origin_path/);
  await expectFailure("unknown-class", (value) => { value.suite.class = "invented-class"; }, /unknown_class_or_setup/);
  await expectFailure("unknown-profile", (value) => { value.suite.setupProfile = "invented-profile"; }, /unknown_class_or_setup/);
  await expectFailure("profile-class-mismatch", (value) => { value.suite.setupProfile = "other"; }, /unknown_class_or_setup/);
  await expectFailure("runtime-mismatch", (value) => { value.suite.runtime.version = "22"; }, /unknown_class_or_setup/);
  await expectFailure("disallowed-lifecycle", (value) => { value.suite.lifecycle = "shadow-active"; }, /unsupported_local_execution_contract/);
  await expectFailure("invented-wave-field", (value) => { value.suite.migrationWave = "invented-wave"; }, /malformed_suite/);
  await expectFailure("invalid-cwd", (value) => { value.suite.cwd = "missing-cwd"; }, /invalid_cwd/);
  await expectFailure("malformed-step", (value) => { value.suite.steps[0].invocation.argv = ["-c", "different"]; }, /malformed_step/);
  await expectFailure("empty-steps", (value) => { value.suite.steps = []; }, /missing_suite_arrays/);
  await expectFailure("invalid-timeout", (value) => { value.suite.timeoutSeconds = 0; }, /malformed_runtime_or_timeout/);
  await expectFailure("invalid-isolation", (value) => { value.suite.isolation = "shared"; }, /unsupported_local_execution_contract/);
  await expectFailure("declaration-produces-no-suite", (value) => { delete value.suite; }, /malformed_descriptor/);
});

test("duplicate local identities and command authorities fail before an effective registry is returned", async (t) => {
  await t.test("duplicate-suite-and-descriptor-claim", () => {
    const fixture = syntheticLoaderFixture("duplicate-suite");
    fixture.save();
    const second = descriptor({
      id: fixture.declaration.value.suite.id,
      expectedFile: "second/local.test.mjs",
      descriptorPath: "second/local.ci-batch.json",
    });
    write(fixture.root, second.value.suite.expectedFiles[0], "// second\n");
    fixture.save(second);
    assert.throws(() => fixture.load(), /duplicate_suite_id/);
  });

  await t.test("duplicate-command-id", () => {
    const fixture = syntheticLoaderFixture("duplicate-command");
    fixture.save();
    const second = descriptor({
      id: "issue-9997-second-additive-suite",
      ownerIssue: "#9997",
      expectedFile: "second/local.test.mjs",
      descriptorPath: "second/local.ci-batch.json",
    });
    second.value.suite.steps[0].commandId = fixture.declaration.value.suite.steps[0].commandId;
    write(fixture.root, second.value.suite.expectedFiles[0], "// second\n");
    fixture.save(second);
    assert.throws(() => fixture.load(), /duplicate_command_id|malformed_step/);
  });
});

test("untrusted additions and weakened bootstrap ratchets fail the production validator", () => {
  const bootstrap = loadBootstrap();
  const injected = structuredClone(bootstrap);
  const source = descriptor().value.suite;
  injected.suites.push({ ...source, origin: "untrusted.ci-batch.json", localDescriptor: "untrusted.ci-batch.json" });
  injected.expectedSuites += 1;
  injected.expectedExecutableSuites += 1;
  const command = {
    id: source.steps[0].commandId,
    suiteId: source.id,
    stepIndex: 0,
    cwd: source.steps[0].cwd,
    executable: source.steps[0].invocation.command,
    argv: source.steps[0].invocation.argv,
  };
  command.payloadSha256 = sha256(JSON.stringify({ cwd: command.cwd, executable: command.executable, argv: command.argv }));
  injected.commandCapabilities.commands.push(command);
  injected.commandCapabilities.expectedCommands += 1;
  injected.commandCapabilities.registrySha256 = sha256(JSON.stringify(injected.commandCapabilities.commands));
  assert.ok(validateRegistry(injected, { root: ROOT }).some((error) => /exactly 105 bootstrap suites|effective registry/.test(error)));

  const weakened = structuredClone(bootstrap);
  weakened.expectedSuites = 84;
  weakened.expectedExecutableSuites = 84;
  weakened.shadowExpectedVariants = 43;
  weakened.legacyOrigins.pop();
  assert.ok(validateRegistry(weakened, { root: ROOT }).some((error) => /wave lock|legacyOrigins|shadow/.test(error)));

  const reordered = loadEffectiveManifest({ root: ROOT });
  [reordered.suites[0], reordered.suites[1]] = [reordered.suites[1], reordered.suites[0]];
  assert.ok(validateRegistry(reordered, { root: ROOT }).some((error) => /patched bootstrap exactly|suite and command prefixes/.test(error)));

  const removedRow = loadEffectiveManifest({ root: ROOT });
  removedRow.suites.pop();
  assert.ok(validateRegistry(removedRow, { root: ROOT }).some((error) => /patched bootstrap exactly|effective suites/.test(error)));

  const changedRow = loadEffectiveManifest({ root: ROOT });
  changedRow.suites[0].requiredContext = "changed outside its descriptor authority";
  assert.ok(validateRegistry(changedRow, { root: ROOT }).some((error) => /patched bootstrap exactly|suite and command prefixes/.test(error)));

  const changedPrimaryVector = loadEffectiveManifest({ root: ROOT });
  changedPrimaryVector.suites[0].class = "node22-noinstall";
  assert.ok(validateRegistry(changedPrimaryVector, { root: ROOT }).some((error) => /effective primary lane/.test(error)));

  const removedBootstrapCommand = loadEffectiveManifest({ root: ROOT });
  const removedBootstrapViews = trustedRegistryViews(removedBootstrapCommand);
  assert.ok(removedBootstrapViews);
  const bootstrapCommandId = removedBootstrapViews.patchedBootstrap.commandCapabilities.commands.at(-1).id;
  const bootstrapCommandIndex = removedBootstrapCommand.commandCapabilities.commands.findIndex((command) => command.id === bootstrapCommandId);
  assert.notEqual(bootstrapCommandIndex, -1);
  removedBootstrapCommand.commandCapabilities.commands.splice(bootstrapCommandIndex, 1);
  assert.ok(validateRegistry(removedBootstrapCommand, { root: ROOT }).some((error) => /patched bootstrap exactly|command prefixes/.test(error)));

  const missingCapability = structuredClone(bootstrap);
  missingCapability.commandCapabilities.commands.pop();
  assert.ok(validateRegistry(missingCapability, { root: ROOT }).some((error) => /command capabilit|stable assertion/.test(error)));
});

// [#3643] Phase 3D. The folded wave is sealed on its own: each of these edits
// must be named red by the Phase 3D checks, never absorbed by the frozen
// Phase 3A/3B/3C seals or excused because the suite is primary.
test("Phase 3D rejects env drift, a wrong host, an undeclared suite, a false rationale and a reverted disposition", () => {
  const named = (mutate, pattern) => {
    const value = loadEffectiveManifest({ root: ROOT });
    mutate(value);
    return validateRegistry(value, { root: ROOT }).some((error) => pattern.test(error));
  };
  const suite = (value, id) => value.suites.find((item) => item.id === id);
  assert.deepEqual(validateRegistry(loadEffectiveManifest({ root: ROOT }), { root: ROOT }), []);
  assert.ok(named((value) => { suite(value, "issue-2198-paystack-return-verify-tests").steps[2].env.PAYSTACK_MODE = "live"; },
    /Phase 3D typed env|environment capabilities/), "a drifted #2198 env literal must be red");
  assert.ok(named((value) => { suite(value, "issue-1002-campaign-builder-multi-destination-tests").steps[0].env = { GITHUB_TOKEN: "x" }; },
    /Phase 3D typed env|environment capabilities/), "env on a folded step that never had one must be red");
  assert.ok(named((value) => { suite(value, "issue-1014-free-publish-currency-tests").class = "deno2x-node22-noinstall"; },
    /declared Phase 3D suite|Phase 3D suite must be|runtime must agree/), "moving a folded suite to the other host must be red");
  assert.ok(named((value) => { suite(value, "issue-1014-free-publish-currency-tests").migrationWave = undefined; },
    /Phase 3D membership|declared Phase 3D suite|only Phase 3D suites/), "dropping a suite out of the wave must be red");
  assert.ok(named((value) => {
    const row = value.legacyOrigins.find((item) => item.stem === "issue-1392-stay-activation-tests");
    row.rationale = "Retained as the sole live provider because it requires database-special execution.";
  }, /corrected rationale/), "restoring the false database-special rationale must be red");
  assert.ok(named((value) => {
    const row = value.legacyOrigins.find((item) => item.stem === "issue-1792-waiter-mode-tests");
    row.disposition = "database-special";
  }, /Phase 3D legacy origin|live provider workflow is missing|batched legacy origin/), "reverting a folded origin's disposition must be red");
});
