import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASELINE_PATH,
  BASELINE_SHA256,
  compilePlans,
  readSealedBaseline,
} from "../load-plan.mjs";
import { runLane } from "../run.mjs";
import {
  CONTRACT_PATH,
  CONFIG_PATH,
  CONTRACT_SHA256,
  loadEffectiveFunctionPolicy,
} from "../function-policy.mjs";
import {
  findWorkflowByDisplayName,
  verifyWorkflowLiteralPolicy,
} from "../workflow-literal-policy.mjs";
import {
  BOOTSTRAP_PATH as CI_BATCH_BOOTSTRAP,
  loadBootstrap as loadCiBatchBootstrap,
  loadEffectiveManifest as loadCiBatchManifest,
} from "../../ci-batch/load-manifest.mjs";
import {
  BOOTSTRAP_PATH as STRICT_BOOTSTRAP,
  loadBootstrap as loadStrictBootstrap,
  loadEffectiveManifest as loadStrictManifest,
} from "../../strict-grep/load-manifest.mjs";
import {
  SHARD_COUNT_FIELD,
  classAShardPlan,
  expectedExecutions,
  expectedForClass,
  loadManifest as loadRunnerManifest,
  loadShardCosts,
} from "../../strict-grep/run-batch.mjs";
import {
  EXIT_OK,
  aggregate,
} from "../../strict-grep/issue-3449-class-a-shard-completeness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");

function temporary(label) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `issue-3643-${label}-`));
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

function minimalBaseline() {
  return {
    schemaVersion: 1,
    immutable: true,
    sourceSha: "synthetic",
    profiles: {
      "deno-2-unit": {
        command: "deno",
        argv: ["test", "--allow-env", "--allow-net", "--allow-read", "--no-check"],
        runtime: "2.x",
        attempts: 1,
      },
      "psql-pg17-post-replay": {
        command: "psql",
        argv: ["-h", "localhost", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f"],
        postgresWaitSeconds: 90,
      },
    },
    lanes: {
      migrations: [],
      "stripe-deno": [],
      "notification-deno": [],
      "deno2-discovered": [],
    },
    candidateSnapshot: { sql: [], deno: [] },
  };
}

function declareSuite(root, suitePath, declaration) {
  write(root, suitePath, "// synthetic fixture\n");
  writeJson(root, `${suitePath}.ci-suite.json`, {
    schemaVersion: 1,
    kind: "suite",
    path: suitePath,
    ...declaration,
  });
}

function workflowEventPaths(source, eventName) {
  const lines = source.split("\n");
  const eventStart = lines.findIndex((line) => line === `  ${eventName}:`);
  assert.notEqual(eventStart, -1, `workflow must declare the ${eventName} event`);
  const eventEnd = lines.findIndex((line, index) => index > eventStart && /^  [a-z_]+:/.test(line));
  const boundedEnd = eventEnd === -1 ? lines.length : eventEnd;
  const pathsStart = lines.findIndex((line, index) =>
    index > eventStart && index < boundedEnd && line === "    paths:"
  );
  assert.notEqual(pathsStart, -1, `${eventName} must declare a paths filter`);
  const paths = [];
  for (let index = pathsStart + 1; index < boundedEnd; index += 1) {
    const line = lines[index];
    const match = /^      - "([^"]+)"$/.exec(line);
    if (match) paths.push(match[1]);
    else if (line.trim() && !line.trimStart().startsWith("#")) break;
  }
  return paths;
}

function githubPathPatternRegex(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

function assertDiscoveryTriggerCoverage(source) {
  const representatives = {
    migration_sql: "supabase/migrations/__tests__/future-owner.test.sql",
    supabase_deno: "supabase/functions/future-owner/__tests__/future-owner.test.ts",
    package_deno: "packages/future-owner/__tests__/future-owner.test.ts",
    business_deno: "mingla-business/future-owner/__tests__/future-owner.deno.test.ts",
    suite_descriptor: "future-owner/deep/future-owner.test.ts.ci-suite.json",
    exclusion_descriptor: "future-owner/deep/future-owner.test.ts.ci-exclude.json",
  };
  for (const eventName of ["push", "pull_request"]) {
    const patterns = workflowEventPaths(source, eventName);
    for (const [candidateClass, representative] of Object.entries(representatives)) {
      assert.ok(
        patterns.some((pattern) => githubPathPatternRegex(pattern).test(representative)),
        `${eventName}_paths_do_not_cover:${candidateClass}:${representative}`,
      );
    }
  }
}

test("the immutable post-#3875 plan is sealed and preserves all three exact ordered sets", () => {
  const baseline = readSealedBaseline();
  assert.equal(baseline.sourceSha, "2653c9618b85a3a9e3a3b15adf155d25166c8be8");
  assert.deepEqual(
    Object.fromEntries(Object.entries(baseline.lanes).map(([lane, rows]) => [lane, rows.length])),
    { migrations: 166, "stripe-deno": 95, "notification-deno": 51 },
  );
  const compiled = compilePlans();
  for (const lane of ["migrations", "stripe-deno", "notification-deno"]) {
    assert.deepEqual(
      compiled.plans[lane].map(({ orderKey, path: suitePath, profile }) => ({ orderKey, path: suitePath, profile })),
      baseline.lanes[lane].map(({ orderKey, path: suitePath, profile }) => ({ orderKey, path: suitePath, profile })),
      `${lane} membership, order and profile must remain byte-derived from the sealed baseline`,
    );
  }
});

test("any byte change, addition, removal, reorder or duplicate in the bootstrap plan fails before execution", async (t) => {
  const original = fs.readFileSync(BASELINE_PATH);
  const parsed = JSON.parse(original);
  const mutations = {
    byte_change: Buffer.concat([original, Buffer.from(" ")]),
    addition: Buffer.from(JSON.stringify({ ...parsed, unexpected: true })),
    removal: Buffer.from(JSON.stringify({ ...parsed, lanes: { ...parsed.lanes, migrations: parsed.lanes.migrations.slice(1) } })),
    reorder: Buffer.from(JSON.stringify({ ...parsed, lanes: { ...parsed.lanes, migrations: [...parsed.lanes.migrations].reverse() } })),
    duplicate: Buffer.from(JSON.stringify({ ...parsed, lanes: { ...parsed.lanes, migrations: [...parsed.lanes.migrations, parsed.lanes.migrations[0]] } })),
  };
  for (const [label, contents] of Object.entries(mutations)) {
    await t.test(label, () => {
      const root = temporary(`baseline-${label}`);
      const candidate = write(root, "legacy-baseline.json", contents);
      assert.throws(
        () => readSealedBaseline({ baselinePath: candidate, expectedSha: BASELINE_SHA256 }),
        /baseline_seal_mismatch/,
      );
    });
  }
});

test("the workflow retires only the three authorized lists and seals every fixed invocation", async (t) => {
  const live = verifyWorkflowLiteralPolicy();
  assert.deepEqual(live.counts, { sql: 4, teamAgentNode: 6, specializedDeno: 56, fixedNodeMjs: 10 });

  const { source } = findWorkflowByDisplayName();
  const first = live.projection.flatMap((entry) => entry.paths)[0];
  const second = live.projection.flatMap((entry) => entry.paths)[1];
  const mutations = {
    inserted: source.replace(first, `${first} supabase/functions/_shared/__tests__/new_literal.test.ts`),
    changed: source.replace(first, first.replace(".test.", ".changed.test.")),
    removed: source.replace(first, ""),
    reordered: source.replace(first, "__FIRST__").replace(second, first).replace("__FIRST__", second),
    unwired: source.replace("node .github/scripts/ci-discovery/run.mjs --lane migrations", ""),
  };
  for (const [label, changed] of Object.entries(mutations)) {
    await t.test(label, () => {
      const root = temporary(`workflow-${label}`);
      const directory = path.join(root, ".github", "workflows");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, `fixture${".yml"}`), changed);
      assert.throws(() => verifyWorkflowLiteralPolicy({ root }), /(?:fixed_(?:census|projection_mismatch)|runner_call_census)/);
    });
  }
});

test("both workflow event filters cover every discovery candidate and declaration class", () => {
  const { source } = findWorkflowByDisplayName();
  assertDiscoveryTriggerCoverage(source);
});

test("#3859's four PostgreSQL and ten Deno 2 suites are admitted locally in the recorded order", () => {
  const root = temporary("3859");
  const sql = [
    ["supabase/migrations/__tests__/issue_3859_installment_capability_refusal.implementor.happy.pg17.test.sql", "20271015003859_issue_3859_installment_capability_refusal.sql"],
    ["supabase/migrations/__tests__/issue_3859_checkout_line_authority.implementor.happy.pg17.test.sql", "20271016003859_issue_3859_checkout_line_authority.sql"],
    ["supabase/migrations/__tests__/issue_3859_private_intake_claims.implementor.happy.pg17.test.sql", "20271017003859_issue_3859_intake_upload_claims.sql"],
    ["supabase/migrations/__tests__/issue_3859_public_installment_capability.implementor.happy.pg17.test.sql", "20271018003859_issue_3859_public_installment_capability.sql"],
  ];
  const deno = [
    "packages/offering-rendering/__tests__/issue_3859_installment_capability.implementor.happy.test.ts",
    "packages/offering-rendering/__tests__/issue_3859_public_installment_capability.implementor.happy.test.ts",
    "packages/offering-rendering/__tests__/issue_3859_mixed_checkout_money.implementor.happy.test.ts",
    "packages/offering-rendering/__tests__/issue_3859_checkout_client_attempt.implementor.happy.test.ts",
    "packages/offering-rendering/__tests__/issue_3859_public_parity.implementor.happy.test.ts",
    "supabase/functions/_shared/__tests__/issue_3859_stripe_confirmation_status.implementor.happy.test.ts",
    "supabase/functions/record-consent/issue_3859_scope_aware_writer.implementor.happy.test.ts",
    "supabase/functions/ticket-checkout-create/__tests__/issue_3859_installment_capability_refusal.implementor.happy.test.ts",
    "supabase/functions/ticket-checkout-create/__tests__/issue_3859_checkout_v2_contract.implementor.happy.test.ts",
    "supabase/functions/trip-intake-upload-signed-url/__tests__/issue_3859_private_intake_claim.implementor.happy.test.ts",
  ];
  sql.forEach(([suitePath, migration], index) => declareSuite(root, suitePath, {
    lane: "migrations",
    orderKey: `3859-sql-${String(index + 1).padStart(2, "0")}`,
    profile: "psql-pg17-post-replay",
    database: { database: "postgres", user: "postgres", reset: "isolated-per-suite" },
    setup: { migration },
  }));
  deno.forEach((suitePath, index) => declareSuite(root, suitePath, {
    lane: "deno2-discovered",
    orderKey: `3859-deno-${String(index + 1).padStart(2, "0")}`,
    profile: "deno-2-unit",
  }));
  const compiled = compilePlans({ root, baseline: minimalBaseline() });
  assert.deepEqual(compiled.plans.migrations.map((row) => row.path), sql.map(([suitePath]) => suitePath));
  assert.deepEqual(compiled.plans.migrations.map((row) => row.setup.migration), sql.map(([, migration]) => migration));
  assert.deepEqual(compiled.plans["deno2-discovered"].map((row) => row.path), deno);
});

test("suite discovery fails closed for every malformed ownership shape and accepts a reasoned exclusion", async (t) => {
  const expectFailure = async (label, build, pattern) => t.test(label, () => {
    const root = temporary(`plan-${label}`);
    const baseline = minimalBaseline();
    build(root, baseline);
    assert.throws(() => compilePlans({ root, baseline }), pattern);
  });

  await expectFailure("undeclared", (root) => write(root, "packages/x/undeclared.test.ts"), /undeclared_candidate/);
  await expectFailure("duplicate-order", (root) => {
    for (const name of ["one", "two"]) declareSuite(root, `packages/x/${name}.test.ts`, {
      lane: "deno2-discovered", orderKey: "same-order", profile: "deno-2-unit",
    });
  }, /duplicate_order_key/);
  await expectFailure("duplicate-path", (root) => {
    const suitePath = "packages/x/one.test.ts";
    write(root, suitePath);
    for (const name of ["first", "second"]) writeJson(root, `packages/x/${name}.ci-suite.json`, {
      schemaVersion: 1, kind: "suite", path: suitePath, lane: "deno2-discovered",
      orderKey: `${name}-order`, profile: "deno-2-unit",
    });
  }, /duplicate_path/);
  await expectFailure("stale", (root) => writeJson(root, "packages/x/stale.ci-suite.json", {
    schemaVersion: 1, kind: "suite", path: "packages/x/missing.test.ts", lane: "deno2-discovered",
    orderKey: "stale-order", profile: "deno-2-unit",
  }), /stale_local_path/);
  await expectFailure("unknown-lane", (root) => declareSuite(root, "packages/x/lane.test.ts", {
    lane: "unknown", orderKey: "lane-order", profile: "deno-2-unit",
  }), /unknown_lane/);
  await expectFailure("unknown-profile", (root) => declareSuite(root, "packages/x/profile.test.ts", {
    lane: "deno2-discovered", orderKey: "profile-order", profile: "unknown",
  }), /unknown_profile/);
  await expectFailure("malformed", (root) => {
    write(root, "packages/x/bad.test.ts");
    write(root, "packages/x/bad.test.ts.ci-suite.json", "{");
  }, /malformed_declaration/);
  await expectFailure("legacy-shadow", (root, baseline) => {
    const suitePath = "packages/x/legacy.test.ts";
    baseline.lanes["deno2-discovered"].push({ orderKey: "legacy-001", path: suitePath, profile: "deno-2-unit" });
    declareSuite(root, suitePath, { lane: "deno2-discovered", orderKey: "local-001", profile: "deno-2-unit" });
  }, /legacy_shadow/);

  const root = temporary("reasoned-exclusion");
  const suitePath = "packages/x/other-lane.test.ts";
  write(root, suitePath);
  writeJson(root, `${suitePath}.ci-exclude.json`, {
    schemaVersion: 1,
    kind: "exclude",
    path: suitePath,
    reason: "Owned by a separately sealed specialized invocation.",
  });
  const compiled = compilePlans({ root, baseline: minimalBaseline() });
  assert.deepEqual(compiled.exclusions, [suitePath]);
});

test("the lane runner preserves exact whole-array retry status, ordering and final diagnostic", () => {
  const calls = [];
  const waits = [];
  const lines = [];
  const originalLog = console.log;
  console.log = (...parts) => lines.push(parts.join(" "));
  try {
    const status = runLane("stripe-deno", {
      executeCommand(command, argv) {
        calls.push({ command, argv });
        return calls.length < 3 ? 19 : 37;
      },
      wait(seconds) { waits.push(seconds); },
    });
    assert.equal(status, 37);
  } finally {
    console.log = originalLog;
  }
  const expected = readSealedBaseline().lanes["stripe-deno"].map((row) => row.path);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.argv.slice(-expected.length)), [expected, expected, expected]);
  assert.deepEqual(waits, [10, 10]);
  assert.equal(lines.at(-1), "Stripe Deno tests failed after 3 attempts (esm.sh flake?)");
});

test("the split migration runner preserves all 166 SQL suites around the fixed #3313 Node invocation", () => {
  const before = [];
  const after = [];
  const originalLog = console.log;
  console.log = () => {};
  try {
    assert.equal(runLane("migrations", {
      through: "legacy-0113",
      executeCommand(command, argv) {
        before.push({ command, argv });
        return 0;
      },
    }), 0);
    assert.equal(runLane("migrations", {
      after: "legacy-0113",
      executeCommand(command, argv) {
        after.push({ command, argv });
        return 0;
      },
    }), 0);
  } finally {
    console.log = originalLog;
  }
  const expected = readSealedBaseline().lanes.migrations.map((row) => row.path);
  assert.equal(before.length, 113);
  assert.equal(after.length, 53);
  assert.deepEqual([...before, ...after].map((call) => call.argv.at(-1)), expected);
  assert.ok([...before, ...after].every((call) => call.command === "psql"));
});

test("CI-batch keeps all 85 sealed suites and admits one complete local suite without an aggregate edit", async (t) => {
  const bootstrap = loadCiBatchBootstrap();
  const live = loadCiBatchManifest();
  assert.equal(bootstrap.suites.length, 85);
  assert.deepEqual(live.suites, bootstrap.suites);
  const root = temporary("ci-batch");
  const expectedFile = ".github/scripts/ci-batch/fixtures/synthetic.test.mjs";
  write(root, expectedFile, "// synthetic\n");
  const descriptor = `${expectedFile}.ci-batch.json`;
  const declaration = (id = "issue-3643-synthetic-local-suite") => ({
    schemaVersion: 1,
    kind: "ci-batch-suite",
    ownerIssue: "#3643",
    suite: {
      id,
      class: "node20-noinstall",
      originPaths: [expectedFile],
      steps: [{
        name: "Run synthetic",
        cwd: ".",
        run: `node --test ${expectedFile}`,
        commandId: `assert:${id}:01`,
        invocation: { kind: "raw-shell", command: "bash", argv: ["-c", `node --test ${expectedFile}`] },
        exceptionRationale: "Raw shell matches the legacy workflow command contract in this isolated fixture.",
      }],
      lifecycle: "batched-active",
      ownerIssue: "#3643",
      runtime: { name: "node", version: "20" },
      setupProfile: "node20-noinstall",
      cwd: ".",
      envNames: [],
      isolation: "clean-worktree",
      expectedFiles: [expectedFile],
      externalReferenceFiles: [],
      requiredContext: "synthetic loader proof",
      timingSeconds: { p50: null, p95: null, evidence: "not-yet-measured" },
      generatedPaths: ["suite-results.json"],
      exceptionRationale: "Raw shell is retained for the isolated issue-owned fixture command.",
      timeoutSeconds: 60,
    },
  });
  writeJson(root, descriptor, declaration());
  const effective = loadCiBatchManifest({ root, manifestPath: CI_BATCH_BOOTSTRAP });
  assert.equal(effective.suites.length, 86);
  assert.equal(effective.suites.filter((suite) => suite.id === "issue-3643-synthetic-local-suite").length, 1);
  assert.equal(effective.commandCapabilities.commands.filter((command) =>
    command.id === "assert:issue-3643-synthetic-local-suite:01"
  ).length, 1);

  await t.test("malformed descriptor", () => {
    fs.writeFileSync(path.join(root, descriptor), "{");
    assert.throws(() => loadCiBatchManifest({ root, manifestPath: CI_BATCH_BOOTSTRAP }), /malformed_descriptor/);
  });
  await t.test("missing owned file", () => {
    fs.rmSync(path.join(root, expectedFile));
    writeJson(root, descriptor, declaration("issue-3643-stale"));
    assert.throws(() => loadCiBatchManifest({ root, manifestPath: CI_BATCH_BOOTSTRAP }), /missing_suite_path/);
  });
  await t.test("bootstrap shadow", () => {
    write(root, expectedFile);
    const shadow = structuredClone(JSON.parse(fs.readFileSync(path.join(root, descriptor), "utf8")));
    shadow.suite.id = bootstrap.suites[0].id;
    writeJson(root, descriptor, shadow);
    assert.throws(() => loadCiBatchManifest({ root, manifestPath: CI_BATCH_BOOTSTRAP }), /bootstrap_shadow/);
  });
});

test("strict-grep local metadata reaches the canonical loader, runner, shard plan and completeness authority exactly once", () => {
  const bootstrap = loadStrictBootstrap();
  const root = temporary("strict");
  const script = ".github/scripts/strict-grep/issue-3643-synthetic.mjs";
  write(root, script, "process.exitCode = 0;\n");
  writeJson(root, `${script}.gate.json`, {
    schemaVersion: 1,
    kind: "strict-grep-gate",
    gate: { kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] },
  });
  const loaded = loadStrictManifest({ root, manifestPath: STRICT_BOOTSTRAP });
  const runner = loadRunnerManifest(undefined, { root });
  for (const view of [loaded, runner]) {
    assert.equal(view.gates.filter((gate) => gate.script === script).length, 1);
    assert.deepEqual(view.gates.filter((gate) => bootstrap.gates.some((base) => base.script === gate.script)), bootstrap.gates);
  }
  assert.equal(expectedForClass(runner, "A").filter((gate) => gate.script === script).length, 1);
  const costs = loadShardCosts();
  const plan = classAShardPlan({ manifest: runner, costs, shardCount: runner[SHARD_COUNT_FIELD] });
  assert.equal(plan.shards.flat().filter((item) => item.gate.script === script).length, 1);

  const resultRoot = temporary("strict-results");
  plan.shards.forEach((shard, index) => {
    const directory = path.join(resultRoot, `shard-${index + 1}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "gate-results-A.json"), JSON.stringify(shard.map((item) => ({
      script: item.gate.script,
      jobKeys: item.gate.jobKeys,
      mode: item.mode,
      exit: 0,
      durationMs: 1,
      status: "PASS",
      shard: index + 1,
    }))));
  });
  const complete = aggregate({ inputDir: resultRoot, manifest: runner, costs, shardCount: runner[SHARD_COUNT_FIELD] });
  assert.equal(complete.exitCode, EXIT_OK, complete.errors.join(" | "));
  assert.equal(complete.rows.filter((row) => row.script === script).length, 1);

  fs.rmSync(path.join(root, `${script}.gate.json`));
  assert.throws(() => loadStrictManifest({ root, manifestPath: STRICT_BOOTSTRAP }), /undeclared_gate/);
  fs.rmSync(path.join(root, script));
  assert.equal(loadStrictManifest({ root, manifestPath: STRICT_BOOTSTRAP }).gates.length, bootstrap.gates.length);
});

test("strict-grep rejects a local descriptor that duplicates the sealed bootstrap", () => {
  const root = temporary("strict-shadow");
  const script = loadStrictBootstrap().gates.find((gate) =>
    gate.kind === "file" && gate.script.startsWith(".github/scripts/strict-grep/") && gate.script.endsWith(".mjs")
  ).script;
  write(root, script, "process.exitCode = 0;\n");
  writeJson(root, `${script}.gate.json`, {
    schemaVersion: 1,
    kind: "strict-grep-gate",
    gate: { kind: "file", enforcement: "batch:A", invocation: "node", modes: ["plain"], selfTest: "none", jobKeys: [] },
  });
  assert.throws(() => loadStrictManifest({ root, manifestPath: STRICT_BOOTSTRAP }), /bootstrap_shadow/);
});

test("the live function contract and generated config are semantically and byte-for-byte unchanged", () => {
  const effective = loadEffectiveFunctionPolicy();
  assert.equal(effective.diskFunctions.length, 246);
  assert.deepEqual(effective.contract, JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8")));
  assert.equal(effective.configToml, fs.readFileSync(CONFIG_PATH, "utf8"));
  assert.equal(Object.values(effective.jwtPolicy).filter((entry) => entry.explicit).length, 154);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(CONTRACT_PATH)).digest("hex"), CONTRACT_SHA256);
});

function functionFixture(label) {
  const root = temporary(`function-${label}`);
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  write(root, "supabase/function-env.contract.json", fs.readFileSync(CONTRACT_PATH));
  write(root, "supabase/config.toml", fs.readFileSync(CONFIG_PATH));
  for (const name of Object.keys(contract.functions)) write(root, `supabase/functions/${name}/index.ts`, "// fixture\n");
  fs.mkdirSync(path.join(root, "supabase/functions/_shared"), { recursive: true });
  return { root, contract };
}

function localFunctionPolicy(name, overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "edge-function-policy",
    name,
    verify_jwt: false,
    gateway_reason: "Synthetic local policy verifies exact generated gateway behavior.",
    env: {
      required_top_level: [],
      optional_top_level: [],
      migration_fallback_top_level: [],
      required_bundle_fields: {},
    },
    ...overrides,
  };
}

test("a 247th function is derived from disk plus local env/JWT policy without editing either aggregate", () => {
  const { root } = functionFixture("future");
  const name = "issue-3643-future-function";
  write(root, `supabase/functions/${name}/index.ts`, "// fixture\n");
  writeJson(root, `supabase/functions/${name}/function-policy.json`, localFunctionPolicy(name));
  const effective = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  assert.equal(effective.diskFunctions.length, 247);
  assert.deepEqual(effective.localFunctions, [name]);
  assert.equal(effective.jwtPolicy[name].verify_jwt, false);
  assert.equal(effective.jwtPolicy[name].explicit, true);
  assert.match(effective.configToml, new RegExp(`\\[functions\\.${name}\\]\\nverify_jwt = false`));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "supabase/function-env.contract.json"), "utf8")), JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8")));
});

test("function discovery fails closed on missing, malformed and stale local policy and global aggregate edits", async (t) => {
  await t.test("missing", () => {
    const { root } = functionFixture("missing");
    write(root, "supabase/functions/future/index.ts");
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /missing_policy=future/);
  });
  await t.test("malformed", () => {
    const { root } = functionFixture("malformed");
    write(root, "supabase/functions/future/index.ts");
    writeJson(root, "supabase/functions/future/function-policy.json", localFunctionPolicy("wrong-name"));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /policy:malformed_declaration:future/);
  });
  await t.test("stale", () => {
    const { root } = functionFixture("stale");
    writeJson(root, "supabase/functions/no-entrypoint/function-policy.json", localFunctionPolicy("no-entrypoint"));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /policy:stale_function_policy:no-entrypoint/);
  });
  await t.test("global aggregate edit", () => {
    const { root, contract } = functionFixture("global-edit");
    contract.functions.future = localFunctionPolicy("future").env;
    writeJson(root, "supabase/function-env.contract.json", contract);
    assert.throws(() => loadEffectiveFunctionPolicy({
      root,
      contractPath: path.join(root, "supabase/function-env.contract.json"),
      configPath: path.join(root, "supabase/config.toml"),
      sealBootstrap: true,
    }), /contract:bootstrap_seal_mismatch/);
  });
});

test("all five strict-grep classes preserve every sealed member and add only the local loader gate", () => {
  const bootstrap = loadStrictBootstrap();
  const effective = loadStrictManifest();
  assert.equal(bootstrap.gates.length, 755);
  assert.equal(bootstrap.expectedStrictGrepMjsFiles, 663);
  assert.equal(bootstrap.selfTestWiredFloor, 423);
  assert.equal(effective.gates.length, 756);
  for (const cls of ["A", "B", "C", "D", "E"]) {
    const before = expectedForClass(bootstrap, cls).map((gate) => gate.script);
    const after = expectedForClass(effective, cls).map((gate) => gate.script);
    assert.deepEqual(after.filter((script) => script !== ".github/scripts/strict-grep/load-manifest.mjs"), before);
  }
  assert.equal(expectedExecutions(effective, "A").filter((item) => item.gate.script === ".github/scripts/strict-grep/load-manifest.mjs").length, 1);
});
