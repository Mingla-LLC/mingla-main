// #2436 happy-path and adversarial runtime proof. Distinct from the governance gate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildShardReport, capabilityPayloadDigest, capabilityRegistryDigest, createIsolatedWorkspace, loadManifest,
  minimalChildEnvironment, recordSetup, renderAnnotations, renderSummary, resolveCommandCapability, runInvocation,
  runSuiteV2, runSuitesV2, setupEvidencePath, validateSetupEvidence, verdict,
} from "../ci-batch/run-suite-batch.mjs";
import { forbiddenEmbeddedSetup } from "../ci-batch/validate-manifest-v2.mjs";

function temporaryDirectory(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function gitFixture() {
  const root = temporaryDirectory("runner-v2-fixture-");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "runner@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Runner Proof"], { cwd: root });
  fs.writeFileSync(path.join(root, "proof.test.mjs"), "// proof\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return root;
}
function suite(id, command, timeoutSeconds = 5) {
  return { id, class: "node20-noinstall", setupProfile: "node20-noinstall", timeoutSeconds,
    expectedFiles: ["proof.test.mjs"], generatedPaths: [], steps: [{ name: id, cwd: ".", run: command,
      commandId: `assert:${id}:01`, invocation: { kind: "raw-shell", command: "bash", argv: ["-c", command] } }] };
}
function registryFor(suites) {
  const commands = suites.flatMap((item) => item.steps.map((step, stepIndex) => {
    const capability = { id: step.commandId, suiteId: item.id, stepIndex, cwd: step.cwd || ".",
      executable: step.invocation.command, argv: [...step.invocation.argv] };
    return { ...capability, payloadSha256: capabilityPayloadDigest(capability) };
  }));
  return { schemaVersion: 1, expectedCommands: commands.length, registrySha256: capabilityRegistryDigest(commands), commands };
}
function fixtureWorkspace(root) { return { root, cleanup() {} }; }

test("setup is exactly once and missing, mismatch, or duplicate evidence is red", () => {
  const manifest = loadManifest();
  const temp = temporaryDirectory("runner-v2-evidence-");
  assert.throws(() => fs.readFileSync(setupEvidencePath(manifest, "node20-noinstall", temp)), /ENOENT/);
  assert.throws(() => validateSetupEvidence(manifest, "node20-noinstall", { class: "node20-noinstall", setupProfile: "node20-noinstall", setupExecutions: 2, installExecutions: 0 }), /mismatch/);
  const evidencePath = recordSetup(manifest, "node20-noinstall", 0, temp);
  const evidence = JSON.parse(fs.readFileSync(evidencePath));
  assert.equal(validateSetupEvidence(manifest, "node20-noinstall", evidence).name, "node20-noinstall");
  assert.throws(() => recordSetup(manifest, "node20-noinstall", 0, temp), /EEXIST/);
  assert.throws(() => recordSetup(manifest, "business-node20-1", 0, temp), /mismatch/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("structured shell inspection rejects wrappers and dynamic setup without flagging narration", () => {
  for (const command of [
    "builtin command npm ci", "sudo -u root npm install", "nice -n 5 corepack pnpm install",
    "sh -c 'npm ci'", "printf 'npm ci' | bash", "find . -exec npm ci ;", "eval 'npm ci'", "$PACKAGE_MANAGER ci",
  ]) assert.equal(forbiddenEmbeddedSetup({ cmd: "bash", args: ["-lc", command] }), true, command);
  assert.equal(forbiddenEmbeddedSetup("echo 'npm ci is forbidden here'"), false);
  assert.equal(forbiddenEmbeddedSetup("# npm ci is forbidden here\nnode --test proof.test.mjs"), false);
});

test("the reviewed command registry is the only assertion execution authority", async () => {
  const manifest = loadManifest();
  const registered = manifest.suites[0];
  assert.deepEqual(resolveCommandCapability(manifest.commandCapabilities, registered, registered.steps[0], 0), {
    command: registered.steps[0].invocation.command, argv: registered.steps[0].invocation.argv,
  });
  const substituted = structuredClone(registered);
  substituted.steps[0].invocation.argv = ["-c", "npx --yes hidden-installer"];
  assert.throws(() => resolveCommandCapability(manifest.commandCapabilities, substituted, substituted.steps[0], 0), /differs from its command capability/);
  const home = temporaryDirectory("runner-v2-home-");
  try { assert.throws(() => minimalChildEnvironment({ GITHUB_TOKEN: "must-not-enter-child" }, home), /undeclared child environment capability/); }
  finally { fs.rmSync(home, { recursive: true, force: true }); }
  const root = gitFixture();
  const unregistered = suite("unregistered", "true");
  const result = await runSuiteV2(unregistered, { root, profile: { install: null }, workspaceFactory: () => fixtureWorkspace(root) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /production execution requires the assertion command capability registry/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a failed suite does not hide a later passing suite", async () => {
  const root = gitFixture();
  const suites = [suite("first", "exit 7"), suite("second", "true")];
  const results = await runSuitesV2(suites, {
    root, profile: { install: null }, commandCapabilities: registryFor(suites), workspaceFactory: () => fixtureWorkspace(root),
  });
  assert.deepEqual(results.map(({ id, status, code }) => ({ id, status, code })), [
    { id: "first", status: "failed", code: 7 }, { id: "second", status: "passed", code: 0 },
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a missing expected file and unexpected workspace mutation are red", async () => {
  const root = gitFixture();
  const missing = suite("missing", "true");
  missing.expectedFiles = ["vanished.test.mjs"];
  assert.equal((await runSuiteV2(missing, { root, profile: { install: null }, commandCapabilities: registryFor([missing]), workspaceFactory: () => fixtureWorkspace(root) })).status, "missing");
  const mutationSuite = suite("mutated", "printf bad > product.txt");
  const mutated = await runSuiteV2(mutationSuite, { root, profile: { install: null }, commandCapabilities: registryFor([mutationSuite]), workspaceFactory: () => fixtureWorkspace(root) });
  assert.equal(mutated.status, "failed");
  assert.match(mutated.reason, /unexpected workspace mutation/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("declared generated output is reported and cleaned with an isolated workspace", async () => {
  const root = gitFixture();
  const isolated = temporaryDirectory("runner-v2-isolated-");
  execFileSync("git", ["clone", "-q", root, isolated]);
  const generated = suite("generated", "mkdir -p reports && printf ok > reports/result.json");
  generated.generatedPaths = ["reports"];
  let cleaned = false;
  const result = await runSuiteV2(generated, { root, profile: { install: null }, commandCapabilities: registryFor([generated]), workspaceFactory: () => ({ root: isolated,
    cleanup() { cleaned = true; fs.rmSync(isolated, { recursive: true, force: true }); } }) });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.allowedCleanup, ["reports/result.json"]);
  assert.equal(cleaned, true);
  assert.equal(fs.existsSync(path.join(root, "reports/result.json")), false, "base checkout must remain untouched");
  fs.rmSync(root, { recursive: true, force: true });
});

test("timeout kills the whole process group, including descendants", async () => {
  const root = temporaryDirectory("runner-v2-timeout-");
  const marker = path.join(root, "descendant-survived");
  const child = `process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),600)`;
  const parent = `const{spawn}=require('child_process');spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  const result = await runInvocation({ command: process.execPath, argv: ["-e", parent] }, { cwd: root, timeoutMs: 100, graceMs: 50 });
  assert.equal(result.timedOut, true);
  assert.equal(result.code, 124);
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(fs.existsSync(marker), false, "descendant escaped the process-group kill");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a successful command cannot leak a background descendant past its suite", async () => {
  const root = temporaryDirectory("runner-v2-background-");
  const marker = path.join(root, "background-survived");
  const descendant = `process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),500)`;
  const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();`;
  const result = await runInvocation({ command: process.execPath, argv: ["-e", parent] }, { cwd: root, timeoutMs: 1_000, graceMs: 50 });
  assert.equal(result.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(fs.existsSync(marker), false, "background descendant escaped the completed suite command");
  fs.rmSync(root, { recursive: true, force: true });
});

test("commands share one suite cache without leaking it into the next suite", async () => {
  const root = gitFixture();
  const installer = suite("cache-installer", "mkdir -p \"$XDG_CACHE_HOME/browser\" && printf ready > \"$XDG_CACHE_HOME/browser/executable\"");
  installer.steps.push({
    name: "browser consumer",
    cwd: ".",
    run: "test -f \"$XDG_CACHE_HOME/browser/executable\"",
    commandId: "assert:cache-installer:02",
    invocation: { kind: "raw-shell", command: "bash", argv: ["-c", "test -f \"$XDG_CACHE_HOME/browser/executable\""] },
  });
  const isolated = suite("cache-isolated", "test ! -e \"$XDG_CACHE_HOME/browser/executable\"");
  try {
    const results = await runSuitesV2([installer, isolated], {
      root,
      profile: { install: null },
      commandCapabilities: registryFor([installer, isolated]),
      workspaceFactory: () => fixtureWorkspace(root),
    });
    assert.deepEqual(results.map(({ status, executed }) => ({ status, executed })), [
      { status: "passed", executed: 2 },
      { status: "passed", executed: 1 },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("suite HOME cleanup completes before pass and a cleanup failure is red", async () => {
  const root = gitFixture();
  const cleanupSuite = suite("cleanup-order", "true");
  try {
    let successfulCleanup = false;
    const passed = await runSuiteV2(cleanupSuite, {
      root, profile: { install: null }, commandCapabilities: registryFor([cleanupSuite]),
      workspaceFactory: () => fixtureWorkspace(root),
      removeHome(home) { successfulCleanup = true; fs.rmSync(home, { recursive: true, force: true }); },
    });
    assert.equal(successfulCleanup, true);
    assert.equal(passed.status, "passed");

    const failed = await runSuiteV2(cleanupSuite, {
      root, profile: { install: null }, commandCapabilities: registryFor([cleanupSuite]),
      workspaceFactory: () => fixtureWorkspace(root),
      removeHome(home) { fs.rmSync(home, { recursive: true, force: true }); throw new Error("root-owned cache"); },
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.ok, false);
    assert.match(failed.reason, /suite HOME cleanup failed: root-owned cache/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("privilege-separated descendant cleanup tolerates only ESRCH and EPERM", () => {
  const supervisor = path.resolve(".github/scripts/ci-batch/process-supervisor.py");
  const probe = [
    "import errno, importlib.util, signal, sys",
    "from unittest import mock",
    "sys.dont_write_bytecode = True",
    "spec = importlib.util.spec_from_file_location('process_supervisor', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "with mock.patch.object(module.os, 'kill', side_effect=PermissionError(errno.EPERM, 'root-owned descendant')):",
    "    module.signal_pid(4242, signal.SIGTERM)",
    "with mock.patch.object(module.os, 'kill', side_effect=PermissionError(errno.EACCES, 'unexpected denial')):",
    "    try:",
    "        module.signal_pid(4242, signal.SIGTERM)",
    "    except PermissionError as error:",
    "        assert error.errno == errno.EACCES",
    "    else:",
    "        raise AssertionError('unrelated signal errors must remain fatal')",
  ].join("\n");
  assert.doesNotThrow(() => execFileSync("python3", ["-c", probe, supervisor], { stdio: "pipe" }));
});

test("Linux subreaper contains immediate double-fork setsid descendants on success and timeout", { skip: process.platform !== "linux" }, async () => {
  for (const mode of ["success", "timeout"]) {
    const root = temporaryDirectory(`runner-v2-double-fork-${mode}-`);
    const marker = path.join(root, "escaped");
    const daemon = `process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),700);setInterval(()=>{},1000)`;
    const middle = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(daemon)}],{detached:true,stdio:'ignore'}).unref()`;
    const parent = mode === "success"
      ? `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(middle)}],{detached:true,stdio:'ignore'}).unref()`
      : `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(middle)}],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000)`;
    const result = await runInvocation({ command: process.execPath, argv: ["-e", parent] }, { cwd: root, timeoutMs: 120, graceMs: 50 });
    assert.equal(result.timedOut, mode === "timeout");
    await new Promise((resolve) => setTimeout(resolve, 850));
    assert.equal(fs.existsSync(marker), false, `${mode} descendant escaped atomic subreaper ownership`);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copy-on-write dependency isolation never aliases the shard installation", () => {
  const root = gitFixture();
  const dependency = path.join(root, "app", "node_modules", "pkg", "index.js");
  fs.mkdirSync(path.dirname(dependency), { recursive: true });
  fs.writeFileSync(dependency, "base\n");
  let workspace;
  try {
    workspace = createIsolatedWorkspace({ root, profile: { install: { cwd: "app" } } });
    const copy = path.join(workspace.root, "app", "node_modules", "pkg", "index.js");
    assert.equal(fs.lstatSync(path.join(workspace.root, "app", "node_modules")).isSymbolicLink(), false);
    fs.writeFileSync(copy, "suite\n");
    assert.equal(fs.readFileSync(dependency, "utf8"), "base\n");
  } finally {
    workspace?.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dependency isolation rebases local file links, rejects external links, and detects shard contamination", async () => {
  const root = gitFixture();
  const modules = path.join(root, "app", "node_modules");
  const localPackage = path.join(root, "packages", "brand-assets");
  const localPackageFile = path.join(localPackage, "index.js");
  const shared = path.join(root, "shared-target.js");
  const dependencyLink = path.join(modules, "@mingla", "brand-assets");
  fs.mkdirSync(path.dirname(dependencyLink), { recursive: true });
  fs.mkdirSync(localPackage, { recursive: true });
  fs.writeFileSync(localPackageFile, "base\n");
  fs.writeFileSync(shared, "base\n");
  execFileSync("git", ["add", "packages/brand-assets", "shared-target.js"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "local dependency fixture"], { cwd: root });
  fs.symlinkSync(path.relative(path.dirname(dependencyLink), localPackage), dependencyLink);
  let workspace;
  try {
    workspace = createIsolatedWorkspace({ root, profile: { install: { cwd: "app" } } });
    const isolatedLink = path.join(workspace.root, "app", "node_modules", "@mingla", "brand-assets");
    const isolatedTarget = fs.realpathSync(isolatedLink);
    assert.equal(isolatedTarget, fs.realpathSync(path.join(workspace.root, "packages", "brand-assets")));
    assert.equal(fs.lstatSync(isolatedLink).isSymbolicLink(), true);
    const sourceStat = fs.statSync(localPackageFile);
    const isolatedStat = fs.statSync(path.join(isolatedTarget, "index.js"));
    assert.notDeepEqual([isolatedStat.dev, isolatedStat.ino], [sourceStat.dev, sourceStat.ino]);
    fs.writeFileSync(path.join(isolatedLink, "index.js"), "isolated\n");
    assert.equal(fs.readFileSync(localPackageFile, "utf8"), "base\n");
    assert.match(execFileSync("git", ["status", "--porcelain=v1"], { cwd: workspace.root, encoding: "utf8" }), /packages\/brand-assets\/index\.js/);
  } finally { workspace?.cleanup(); }

  fs.unlinkSync(dependencyLink);
  fs.symlinkSync(shared, dependencyLink);
  assert.throws(() => createIsolatedWorkspace({ root, profile: { install: { cwd: "app" } } }), /dependency link escapes isolated workspace/);
  fs.unlinkSync(dependencyLink);
  fs.mkdirSync(path.join(modules, "pkg"), { recursive: true });
  const shardDependency = path.join(modules, "pkg", "index.js");
  fs.writeFileSync(shardDependency, "base\n");
  const cloneMetadata = suite("clone-metadata", "true");
  cloneMetadata.generatedPaths = ["app/node_modules"];
  const [cloneResult] = await runSuitesV2([cloneMetadata], { root, profile: { install: { cwd: "app" } },
    commandCapabilities: registryFor([cloneMetadata]), workspaceFactory: () => {
      fs.chmodSync(shardDependency, 0o640);
      return fixtureWorkspace(root);
    } });
  assert.equal(cloneResult.ok, true, "trusted clone-time metadata changes precede the immutable suite baseline");
  const contaminator = suite("contaminator", "printf changed > app/node_modules/pkg/index.js");
  const [result] = await runSuitesV2([contaminator], { root, profile: { install: { cwd: "app" } },
    commandCapabilities: registryFor([contaminator]), workspaceFactory: () => fixtureWorkspace(root) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /shard dependency snapshot changed/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("ordered expected identities cannot be satisfied by duplicate, swapped, or unknown results", () => {
  const expected = [suite("a", "true"), suite("b", "true")];
  const passed = (id) => ({ id, ok: true, code: 0, status: "passed" });
  assert.equal(verdict(expected, [passed("a"), passed("b")]).ok, true);
  assert.equal(verdict(expected, [passed("a"), passed("a")]).ok, false);
  assert.equal(verdict(expected, [passed("b"), passed("a")]).ok, false);
  assert.equal(verdict(expected, [passed("a"), passed("unknown")]).ok, false);
});

test("child output and returned reasons redact secret-bearing environment values", async () => {
  const secret = "ISSUE_2436_IMPLEMENTOR_SECRET_VALUE";
  const prior = process.env.ISSUE_2436_IMPLEMENTOR_SECRET;
  process.env.ISSUE_2436_IMPLEMENTOR_SECRET = secret;
  let transcript = "";
  const sink = { write(chunk) { transcript += String(chunk); return true; } };
  try {
    const result = await runInvocation({ command: process.execPath, argv: ["-e", `console.error(${JSON.stringify(secret)});process.exit(3)`] }, { cwd: process.cwd(), timeoutMs: 2_000, stdout: sink, stderr: sink });
    assert.equal(result.code, 3);
    assert.doesNotMatch(result.reason || "", new RegExp(secret));
    assert.doesNotMatch(transcript, new RegExp(secret));
    assert.match(transcript, /\[REDACTED\]/);
  } finally {
    if (prior === undefined) delete process.env.ISSUE_2436_IMPLEMENTOR_SECRET; else process.env.ISSUE_2436_IMPLEMENTOR_SECRET = prior;
  }
});

test("children receive no job secrets and derived encodings are redacted in defense", async () => {
  const secret = "postgres://runner:password@example.invalid/db";
  const encoded = encodeURIComponent(secret);
  const base64 = Buffer.from(secret).toString("base64");
  const prior = process.env.UNRELATED_CONNECTION_VALUE;
  process.env.UNRELATED_CONNECTION_VALUE = secret;
  let transcript = "";
  const sink = { write(chunk) { transcript += String(chunk); return true; } };
  try {
    const source = `console.log(JSON.stringify({inherited:Boolean(process.env.UNRELATED_CONNECTION_VALUE),home:process.env.HOME}));console.log(${JSON.stringify(encoded)});console.log(${JSON.stringify(base64)})`;
    const result = await runInvocation({ command: process.execPath, argv: ["-e", source] }, { cwd: process.cwd(), timeoutMs: 2_000, stdout: sink, stderr: sink });
    assert.equal(result.ok, true);
    assert.doesNotMatch(transcript, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(transcript, new RegExp(encoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(transcript, new RegExp(base64.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(transcript, /UNRELATED_CONNECTION_VALUE/);
    assert.match(transcript, /"inherited":false/);
    assert.match(transcript, /\[REDACTED\]/);
  } finally {
    if (prior === undefined) delete process.env.UNRELATED_CONNECTION_VALUE; else process.env.UNRELATED_CONNECTION_VALUE = prior;
  }
});

test("secret redaction cannot mutate manifest-owned suite identity before reconciliation", async () => {
  const root = gitFixture();
  const id = "issue-2399-multiday-picker-ticket-box";
  const identitySuite = suite(id, "true");
  const prior = process.env.GITHUB_HEAD_REF;
  process.env.GITHUB_HEAD_REF = "2399-multiday-picker-ticket-box";
  try {
    const [result] = await runSuitesV2([identitySuite], {
      root, profile: { install: null }, commandCapabilities: registryFor([identitySuite]),
      workspaceFactory: () => fixtureWorkspace(root),
    });
    assert.equal(result.id, id, "trusted manifest identity must remain exact");
    const report = buildShardReport("node20-noinstall", [identitySuite], [result], {
      setupProfile: "node20-noinstall", setupExecutions: 1, installExecutions: 0,
    }, 1);
    assert.equal(report.identityMismatch, false);
    assert.equal(report.ok, true);
    assert.equal(report.results[0].id, id);
    assert.match(renderSummary(report), /issue-\[REDACTED\]/, "presentation still redacts excluded environment values");
  } finally {
    if (prior === undefined) delete process.env.GITHUB_HEAD_REF; else process.env.GITHUB_HEAD_REF = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failure annotations redact identities without corrupting raw artifact accounting", () => {
  const id = "issue-2399-multiday-picker-ticket-box";
  const branch = "2399-multiday-picker-ticket-box";
  const prior = process.env.GITHUB_HEAD_REF;
  process.env.GITHUB_HEAD_REF = branch;
  try {
    const expected = [suite(id, "true"), suite("second", "true")];
    const results = [
      { id, ok: false, code: 2, status: "corrupt", reason: `missing setup for ${branch}`, executed: 0, expected: 1, seconds: 0 },
      { id, ok: true, code: 0, status: "passed", reason: null, executed: 1, expected: 1, seconds: 1 },
    ];
    const report = buildShardReport("business-node20-3", expected, results, null, 1);
    assert.deepEqual(report.failed, [id]);
    assert.deepEqual(report.duplicateIds, [id]);
    assert.deepEqual(report.malformedIds, [id]);
    assert.equal(report.results[0].id, id);
    assert.match(JSON.stringify(report), new RegExp(id), "raw artifact retains exact accounting identity");

    const presentation = [...renderAnnotations(report), renderSummary(report)].join("\n");
    assert.doesNotMatch(presentation, new RegExp(branch));
    assert.doesNotMatch(presentation, new RegExp(id));
    assert.match(presentation, /issue-\[REDACTED\]/);
    assert.match(presentation, /missing setup for \[REDACTED\]/);
  } finally {
    if (prior === undefined) delete process.env.GITHUB_HEAD_REF; else process.env.GITHUB_HEAD_REF = prior;
  }
});

test("JSON and GitHub summary counts stay honest", () => {
  const suites = [suite("pass", "true"), suite("timeout", "true")];
  const results = [
    { id: "pass", ok: true, code: 0, status: "passed", executed: 1, expected: 1, seconds: 1 },
    { id: "timeout", ok: false, code: 124, status: "timed-out", executed: 1, expected: 1, seconds: 5, reason: "deadline" },
  ];
  const report = buildShardReport("node20-noinstall", suites, results, { setupProfile: "node20-noinstall", setupExecutions: 1, installExecutions: 0 }, 6000);
  assert.equal(report.expected, 2);
  assert.equal(report.executed, 2);
  assert.equal(report.statuses.passed, 1);
  assert.equal(report.statuses["timed-out"], 1);
  assert.equal(report.ok, false);
  assert.match(renderSummary(report), /Executed \*\*2\/2\*\*/);
});
