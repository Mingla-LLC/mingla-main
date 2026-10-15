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
  CONFIG_SHA256,
  loadEffectiveFunctionPolicy,
  policySha256,
} from "../function-policy.mjs";
import {
  scanFunctionSources,
  validateFunctionEnvContract,
} from "../../../../scripts/secrets/audit-function-secret-contract.mjs";
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

test("the immutable post-#3875 plan is sealed as the exact prefix of every effective lane", () => {
  const baseline = readSealedBaseline();
  assert.equal(baseline.sourceSha, "2653c9618b85a3a9e3a3b15adf155d25166c8be8");
  assert.deepEqual(
    Object.fromEntries(Object.entries(baseline.lanes).map(([lane, rows]) => [lane, rows.length])),
    { migrations: 166, "stripe-deno": 95, "notification-deno": 51 },
  );
  const compiled = compilePlans();
  for (const lane of ["migrations", "stripe-deno", "notification-deno"]) {
    // [TEST-MOD-APPROVED #3643] The historical aggregate remains exact as a
    // prefix while valid issue-owned descriptors may extend the effective plan.
    const historical = compiled.plans[lane].slice(0, baseline.lanes[lane].length);
    assert.deepEqual(
      historical.map(({ orderKey, path: suitePath, profile }) => ({ orderKey, path: suitePath, profile })),
      baseline.lanes[lane].map(({ orderKey, path: suitePath, profile }) => ({ orderKey, path: suitePath, profile })),
      `${lane} historical membership, order and profile must remain the sealed effective-plan prefix`,
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
  for (const pattern of [
    '      - "supabase/**/*.test.ts"\n',
    '      - "packages/**/*.test.ts"\n',
    '      - "mingla-business/**/*.deno.test.ts"\n',
    '      - "**/*.ci-suite.json"\n',
    '      - "**/*.ci-exclude.json"\n',
  ]) {
    const reverted = source.replaceAll(pattern, "");
    assert.notEqual(reverted, source, `fixture pattern missing: ${pattern.trim()}`);
    assert.throws(() => assertDiscoveryTriggerCoverage(reverted), /paths_do_not_cover/);
  }
  assertDiscoveryTriggerCoverage(source);
});

test("#3859's four PostgreSQL and ten Deno 2 suites are admitted locally in the recorded order", () => {
  const root = temporary("3859");
  const sql = [
    ["supabase/migrations/__tests__/issue_3859_installment_capability_refusal.implementor.happy.pg17.test.sql", "supabase/migrations/20271015003859_issue_3859_installment_capability_refusal.sql"],
    ["supabase/migrations/__tests__/issue_3859_checkout_line_authority.implementor.happy.pg17.test.sql", "supabase/migrations/20271016003859_issue_3859_checkout_line_authority.sql"],
    ["supabase/migrations/__tests__/issue_3859_private_intake_claims.implementor.happy.pg17.test.sql", "supabase/migrations/20271017003859_issue_3859_intake_upload_claims.sql"],
    ["supabase/migrations/__tests__/issue_3859_public_installment_capability.implementor.happy.pg17.test.sql", "supabase/migrations/20271018003859_issue_3859_public_installment_capability.sql"],
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
  sql.forEach(([, migration]) => write(root, migration, "-- synthetic mapped migration\n"));
  deno.forEach((suitePath, index) => declareSuite(root, suitePath, {
    lane: "deno2-discovered",
    orderKey: `3859-deno-${String(index + 1).padStart(2, "0")}`,
    profile: "deno-2-unit",
  }));
  const compiled = compilePlans({ root, baseline: minimalBaseline() });
  // [TEST-MOD-APPROVED #3643] The assertion now pins the binding full repository-relative setup path.
  assert.deepEqual(compiled.plans.migrations.map((row) => row.path), sql.map(([suitePath]) => suitePath));
  assert.deepEqual(compiled.plans.migrations.map((row) => row.setup.migration), sql.map(([, migration]) => migration));
  assert.deepEqual(compiled.plans["deno2-discovered"].map((row) => row.path), deno);

  const sqlCalls = [];
  const originalLog = console.log;
  console.log = () => {};
  try {
    assert.equal(runLane("migrations", {
      planOptions: { root, baseline: minimalBaseline() },
      databaseName(entry) { return `ci_suite_${entry.orderKey.replaceAll("-", "_")}`; },
      executeCommand(command, argv) {
        sqlCalls.push({ command, argv });
        return 0;
      },
    }), 0);
  } finally {
    console.log = originalLog;
  }
  assert.equal(sqlCalls.length, 16);
  sql.forEach(([suitePath, migration], index) => {
    const database = `ci_suite_3859_sql_${String(index + 1).padStart(2, "0")}`;
    const calls = sqlCalls.slice(index * 4, index * 4 + 4);
    assert.deepEqual(calls.map((call) => call.command), ["psql", "psql", "psql", "psql"]);
    assert.match(calls[0].argv.at(-1), new RegExp(`^CREATE DATABASE "${database}" TEMPLATE postgres;$`));
    assert.deepEqual(calls[1].argv.slice(-2), ["-f", migration]);
    assert.deepEqual(calls[2].argv.slice(-2), ["-f", suitePath]);
    assert.match(calls[3].argv.at(-1), new RegExp(`^DROP DATABASE IF EXISTS "${database}" WITH \\(FORCE\\);$`));
  });

  const denoCalls = [];
  console.log = () => {};
  try {
    assert.equal(runLane("deno2-discovered", {
      planOptions: { root, baseline: minimalBaseline() },
      executeCommand(command, argv) {
        denoCalls.push({ command, argv });
        return 0;
      },
    }), 0);
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(denoCalls, [{
    command: "deno",
    argv: ["test", "--allow-env", "--allow-net", "--allow-read", "--no-check", ...deno],
  }]);
});

test("local SQL setup and Deno profile contracts fail closed before or at the bound command", async (t) => {
  const localSqlFixture = (label) => {
    const root = temporary(`runner-${label}`);
    const suite = "supabase/migrations/__tests__/future_owner.test.sql";
    const migration = "supabase/migrations/20990101000000_future_owner.sql";
    declareSuite(root, suite, {
      lane: "migrations",
      orderKey: "future-sql-001",
      profile: "psql-pg17-post-replay",
      database: { database: "postgres", user: "postgres", reset: "isolated-per-suite" },
      setup: { migration },
    });
    write(root, migration, "-- synthetic migration\n");
    return { root, suite, migration };
  };

  await t.test("setup failure cleans up and stops later rows", () => {
    const { root } = localSqlFixture("setup-failure");
    const later = "supabase/migrations/__tests__/future_owner_later.test.sql";
    const migration = "supabase/migrations/20990101000001_future_owner_later.sql";
    declareSuite(root, later, {
      lane: "migrations",
      orderKey: "future-sql-002",
      profile: "psql-pg17-post-replay",
      database: { database: "postgres", user: "postgres", reset: "isolated-per-suite" },
      setup: { migration },
    });
    write(root, migration, "-- later migration\n");
    const calls = [];
    const originalLog = console.log;
    console.log = () => {};
    try {
      assert.equal(runLane("migrations", {
        planOptions: { root, baseline: minimalBaseline() },
        databaseName: () => "ci_suite_setup_failure",
        executeCommand(command, argv) {
          calls.push({ command, argv });
          return calls.length === 2 ? 41 : 0;
        },
      }), 41);
    } finally {
      console.log = originalLog;
    }
    assert.equal(calls.length, 3);
    assert.match(calls.at(-1).argv.at(-1), /^DROP DATABASE IF EXISTS/);
    assert.ok(calls.every((call) => !call.argv.includes(later)));
  });

  await t.test("suite failure cleans up and stops later rows", () => {
    const { root, suite } = localSqlFixture("suite-failure");
    const calls = [];
    const originalLog = console.log;
    console.log = () => {};
    try {
      assert.equal(runLane("migrations", {
        planOptions: { root, baseline: minimalBaseline() },
        databaseName: () => "ci_suite_test_failure",
        executeCommand(command, argv) {
          calls.push({ command, argv });
          return argv.includes(suite) ? 42 : 0;
        },
      }), 42);
    } finally {
      console.log = originalLog;
    }
    assert.equal(calls.length, 4);
    assert.match(calls.at(-1).argv.at(-1), /^DROP DATABASE IF EXISTS/);
  });

  const rejectBeforeExecution = (label, declaration, expected) => t.test(label, () => {
    const root = temporary(`runner-${label}`);
    const suite = "packages/future-owner/future.test.ts";
    declareSuite(root, suite, declaration);
    let calls = 0;
    assert.throws(() => runLane("deno2-discovered", {
      planOptions: { root, baseline: minimalBaseline() },
      executeCommand() { calls += 1; return 0; },
    }), expected);
    assert.equal(calls, 0);
  });
  await rejectBeforeExecution("known wrong Deno profile", {
    lane: "deno2-discovered", orderKey: "future-deno-001", profile: "psql-pg17-post-replay",
  }, /lane_profile_mismatch/);
  await rejectBeforeExecution("unsupported Deno setup", {
    lane: "deno2-discovered", orderKey: "future-deno-001", profile: "deno-2-unit", setup: { command: "echo nope" },
  }, /unsupported_deno_setup/);

  for (const [label, mutate, expected] of [
    ["missing setup", (entry) => { delete entry.setup; }, /malformed_sql_setup/],
    ["extra setup key", (entry) => { entry.setup.extra = true; }, /malformed_sql_setup/],
    ["unknown reset", (entry) => { entry.database.reset = "shared"; }, /malformed_database_profile/],
    ["absolute setup", (entry) => { entry.setup.migration = "/tmp/fixture.sql"; }, /invalid_sql_setup_path/],
    ["traversal setup", (entry) => { entry.setup.migration = "supabase/migrations/../fixture.sql"; }, /invalid_sql_setup_path/],
    ["glob setup", (entry) => { entry.setup.migration = "supabase/migrations/*.sql"; }, /invalid_sql_setup_path/],
    ["missing setup file", (entry) => { entry.setup.migration = "supabase/migrations/20990101000002_missing.sql"; }, /invalid_sql_setup_path/],
  ]) {
    await t.test(label, () => {
      const fixture = localSqlFixture(label.replaceAll(" ", "-"));
      const descriptor = `${fixture.suite}.ci-suite.json`;
      const entry = JSON.parse(fs.readFileSync(path.join(fixture.root, descriptor), "utf8"));
      mutate(entry);
      writeJson(fixture.root, descriptor, entry);
      assert.throws(() => compilePlans({ root: fixture.root, baseline: minimalBaseline() }), expected);
    });
  }
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
  // [TEST-MOD-APPROVED #3643] Runner parity now follows the effective plan;
  // the sealed prefix remains independently pinned above.
  const expected = compilePlans().plans["stripe-deno"].map((row) => row.path);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.argv.slice(-expected.length)), [expected, expected, expected]);
  assert.deepEqual(waits, [10, 10]);
  assert.equal(lines.at(-1), "Stripe Deno tests failed after 3 attempts (esm.sh flake?)");
});

test("the split migration runner preserves every effective SQL suite around the fixed #3313 Node invocation", () => {
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
  // [TEST-MOD-APPROVED #3643] The split boundary is still the sealed legacy
  // identity, while each side derives its length from the effective plan.
  const effective = compilePlans().plans.migrations;
  const splitIndex = effective.findIndex((row) => row.orderKey === "legacy-0113");
  assert.notEqual(splitIndex, -1);
  assert.equal(before.length, splitIndex + 1);
  assert.equal(after.length, effective.length - splitIndex - 1);
  assert.deepEqual([...before, ...after].map((call) => call.argv.at(-1)), effective.map((row) => row.path));
  assert.ok([...before, ...after].every((call) => call.command === "psql"));
});

test("CI-batch keeps every sealed suite and admits one complete local suite without an aggregate edit", async (t) => {
  const bootstrap = loadCiBatchBootstrap();
  const live = loadCiBatchManifest();
  assert.equal(bootstrap.suites.length, 85);
  // [TEST-MOD-APPROVED #3643] Preserve the sealed bootstrap as an exact prefix
  // without making valid local suites change this test.
  assert.deepEqual(live.suites.slice(0, bootstrap.suites.length), bootstrap.suites);
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
  // [TEST-MOD-APPROVED #3643] The effective total derives from this fixture's
  // bootstrap plus its single descriptor rather than a shared absolute count.
  assert.equal(effective.suites.length, bootstrap.suites.length + 1);
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

test("the sealed function aggregates stay byte-exact while the effective projection covers disk", () => {
  const effective = loadEffectiveFunctionPolicy();
  const contractBytes = fs.readFileSync(CONTRACT_PATH);
  const configBytes = fs.readFileSync(CONFIG_PATH);
  // [TEST-MOD-APPROVED #3643] Raw bytes remain sealed independently; effective
  // membership is derived so a valid local function or CAS patch does not red it.
  assert.deepEqual(effective.diskFunctions, Object.keys(effective.contract.functions).sort());
  assert.equal(crypto.createHash("sha256").update(contractBytes).digest("hex"), CONTRACT_SHA256);
  assert.equal(crypto.createHash("sha256").update(configBytes).digest("hex"), CONFIG_SHA256);
});

function functionFixture(label) {
  const root = temporary(`function-${label}`);
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  write(root, "supabase/function-env.contract.json", fs.readFileSync(CONTRACT_PATH));
  write(root, "supabase/config.toml", fs.readFileSync(CONFIG_PATH));
  write(root, "supabase/secrets.manifest.json", fs.readFileSync(path.join(ROOT, "supabase/secrets.manifest.json")));
  for (const name of Object.keys(contract.functions)) write(root, `supabase/functions/${name}/index.ts`, "// fixture\n");
  fs.mkdirSync(path.join(root, "supabase/functions/_shared"), { recursive: true });
  return { root, contract, baseFunctionCount: Object.keys(contract.functions).length };
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

test("a future function is derived from disk plus local env/JWT policy without editing either aggregate", () => {
  const { root, baseFunctionCount } = functionFixture("future");
  const name = "issue-3643-future-function";
  write(root, `supabase/functions/${name}/index.ts`, "// fixture\n");
  writeJson(root, `supabase/functions/${name}/function-policy.json`, localFunctionPolicy(name));
  const effective = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  // [TEST-MOD-APPROVED #3643] The expected total follows the fixture's sealed
  // bootstrap population, so the next legitimate function needs no count edit.
  assert.equal(effective.diskFunctions.length, baseFunctionCount + 1);
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

function functionPolicyRow(effective, name) {
  return { env: effective.contract.functions[name], jwt: effective.jwtPolicy[name] };
}

function writeFunctionPatch(root, name, issue, base, operations, result, overrides = {}) {
  return writeJson(root, `supabase/functions/${name}/function-policy.issue-${issue}.patch.json`, {
    schemaVersion: 1,
    kind: "edge-function-policy-patch",
    ownerIssue: `#${issue}`,
    target: { kind: "function", name },
    basePolicySha256: policySha256(base),
    operations,
    resultPolicySha256: policySha256(result),
    reason: `Issue #${issue} synthetic target-local function policy proof.`,
    ...overrides,
  });
}

function writeSharedPatch(root, modulePath, issue, base, operations, result, overrides = {}) {
  return writeJson(root, `${modulePath}.function-policy.issue-${issue}.patch.json`, {
    schemaVersion: 1,
    kind: "shared-module-policy-patch",
    ownerIssue: `#${issue}`,
    target: { kind: "shared_module", module_path: modulePath },
    basePolicySha256: policySha256(base),
    operations,
    resultPolicySha256: policySha256(result),
    reason: `Issue #${issue} synthetic target-local shared policy proof.`,
    ...overrides,
  });
}

function effectiveAudit(root, contract) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "supabase/secrets.manifest.json"), "utf8"));
  const scan = scanFunctionSources({ functionsRoot: path.join(root, "supabase/functions"), repoRoot: root });
  return validateFunctionEnvContract({ contract, manifest, scan });
}

test("the exact synthetic #3697 CAS patch classifies its imported literal and reverts to the exact audit failure", () => {
  const { root, contract } = functionFixture("3697-cas");
  contract.shared_modules = {};
  writeJson(root, "supabase/function-env.contract.json", contract);
  write(root, "supabase/functions/_shared/adDestination.ts", fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/adDestination.ts")));
  write(root, "supabase/functions/_shared/businessWebOrigin.ts", fs.readFileSync(path.join(ROOT, "supabase/functions/_shared/businessWebOrigin.ts")));
  write(root, "supabase/functions/admin-ad-spend-sync/index.ts", 'import "../_shared/adDestination.ts";\n');

  const before = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  const base = functionPolicyRow(before, "admin-ad-spend-sync");
  assert.equal(policySha256(base), "4389ee753fa603003a163e2ce18bec6b573d66b777b3aa683ef71d4031097212");
  assert.deepEqual(effectiveAudit(root, before.contract), ["admin-ad-spend-sync:BUSINESS_WEB_ORIGIN:unclassified_literal"]);

  const result = structuredClone(base);
  result.env.optional_top_level = ["BUSINESS_WEB_ORIGIN"];
  assert.equal(policySha256(result), "0c2213a6c2ec2299425007c3f320e4cdf8f3ec4abc0c578fbe6a50007f42d175");
  const patchPath = writeFunctionPatch(root, "admin-ad-spend-sync", 3697, base, [{
    op: "add_env_name",
    classification: "optional_top_level",
    name: "BUSINESS_WEB_ORIGIN",
    expectedAbsent: true,
  }], result, {
    reason: "Destination safety imports adDestination; BUSINESS_WEB_ORIGIN is optional because the production-origin fallback remains.",
  });
  const effective = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  assert.deepEqual(effective.contract.functions["admin-ad-spend-sync"].optional_top_level, ["BUSINESS_WEB_ORIGIN"]);
  assert.deepEqual(effective.jwtPolicy["admin-ad-spend-sync"], before.jwtPolicy["admin-ad-spend-sync"]);
  assert.equal(effective.configToml, before.configToml);
  assert.deepEqual(effectiveAudit(root, effective.contract), []);

  fs.rmSync(patchPath);
  const reverted = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  assert.deepEqual(effectiveAudit(root, reverted.contract), ["admin-ad-spend-sync:BUSINESS_WEB_ORIGIN:unclassified_literal"]);
});

test("an existing-function JWT CAS overlay materializes exactly one section and restores cleanly", () => {
  const { root } = functionFixture("jwt-cas");
  const name = "admin-ad-spend-sync";
  const before = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  const base = functionPolicyRow(before, name);
  const result = structuredClone(base);
  result.jwt.verify_jwt = true;
  const tracked = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const patchPath = writeFunctionPatch(root, name, 3643, base, [{
    op: "set_verify_jwt", expectedOld: false, newValue: true,
  }], result);
  const effective = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  assert.deepEqual(effective.jwtPolicy[name], { explicit: true, verify_jwt: true });
  assert.equal((effective.configToml.match(/\[functions\.admin-ad-spend-sync\]/g) ?? []).length, 1);
  assert.match(effective.configToml, /\[functions\.admin-ad-spend-sync\]\nverify_jwt = true/);
  assert.equal(fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8"), tracked);
  fs.rmSync(patchPath);
  const reverted = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  assert.equal(reverted.configToml, tracked);
  assert.deepEqual(reverted.jwtPolicy[name], { explicit: true, verify_jwt: false });

  const implicitName = Object.entries(reverted.jwtPolicy).find(([, value]) => !value.explicit)[0];
  const implicitBase = functionPolicyRow(reverted, implicitName);
  const implicitResult = structuredClone(implicitBase);
  implicitResult.jwt.verify_jwt = false;
  implicitResult.jwt.explicit = true;
  writeFunctionPatch(root, implicitName, 3644, implicitBase, [{
    op: "set_verify_jwt", expectedOld: true, newValue: false,
  }], implicitResult);
  const materializedDefault = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  assert.deepEqual(materializedDefault.jwtPolicy[implicitName], { explicit: true, verify_jwt: false });
  assert.equal((materializedDefault.configToml.match(new RegExp(`\\[functions\\.${implicitName}\\]`, "g")) ?? []).length, 1);
  assert.equal(fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8"), tracked);
});

test("an existing shared-module CAS overlay reaches the effective audit without weakening function classification", () => {
  const { root, contract } = functionFixture("shared-cas");
  const modulePath = "supabase/functions/_shared/marketingBookQuote.ts";
  contract.shared_modules = { [modulePath]: contract.shared_modules[modulePath] };
  writeJson(root, "supabase/function-env.contract.json", contract);
  write(root, modulePath, [
    "export function getEnv(name: string): string | undefined { return Deno.env.get(name); }",
    "export function resolveMarketingTrackingOrigin(): string {",
    '  getEnv("MINGLA_TRACKING_LINK_ORIGIN");',
    '  return getEnv("BUSINESS_WEB_ORIGIN") ?? "";',
    "}",
    "",
  ].join("\n"));
  write(root, "supabase/functions/admin-ad-spend-sync/index.ts", 'import { resolveMarketingTrackingOrigin } from "../_shared/marketingBookQuote.ts";\nresolveMarketingTrackingOrigin();\n');
  const before = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  assert.match(effectiveAudit(root, before.contract).join("\n"), /BUSINESS_WEB_ORIGIN:dynamic_getter_name_undeclared/);
  const base = before.contract.shared_modules[modulePath];
  const result = structuredClone(base);
  result.allowed_top_level = [...result.allowed_top_level, "BUSINESS_WEB_ORIGIN"].sort();
  writeSharedPatch(root, modulePath, 3643, base, [{
    op: "add_member", field: "allowed_top_level", value: "BUSINESS_WEB_ORIGIN", expectedAbsent: true,
  }], result);
  const effective = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
  assert.deepEqual(effective.contract.shared_modules[modulePath].allowed_top_level, [
    "BUSINESS_WEB_ORIGIN", "MINGLA_TRACKING_LINK_ORIGIN",
  ]);
  assert.deepEqual(effectiveAudit(root, effective.contract), []);
  assert.deepEqual(effective.contract.functions["admin-ad-spend-sync"].optional_top_level, []);
});

test("function-policy CAS overlays fail closed for malformed ownership, chains, operations, and semantic rows", async (t) => {
  const fixture = (label, name = "admin-ad-spend-sync") => {
    const value = functionFixture(`cas-negative-${label}`);
    const effective = loadEffectiveFunctionPolicy({ root: value.root, sealBootstrap: false });
    return { ...value, name, base: functionPolicyRow(effective, name) };
  };
  const optionalResult = (base, name = "BUSINESS_WEB_ORIGIN") => {
    const result = structuredClone(base);
    result.env.optional_top_level = [...result.env.optional_top_level, name].sort();
    return result;
  };
  const addOptional = (name = "BUSINESS_WEB_ORIGIN") => ({
    op: "add_env_name", classification: "optional_top_level", name, expectedAbsent: true,
  });

  await t.test("stale base digest", () => {
    const { root, name, base } = fixture("stale-base");
    const result = optionalResult(base);
    writeFunctionPatch(root, name, 4001, base, [addOptional()], result, { basePolicySha256: "0".repeat(64) });
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /cas_stale_or_orphan/);
  });
  await t.test("bad result digest", () => {
    const { root, name, base } = fixture("bad-result");
    writeFunctionPatch(root, name, 4002, base, [addOptional()], optionalResult(base), { resultPolicySha256: "0".repeat(64) });
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /result_digest_mismatch/);
  });
  await t.test("wrong target", () => {
    const { root, name, base } = fixture("wrong-target");
    writeFunctionPatch(root, name, 4003, base, [addOptional()], optionalResult(base), {
      target: { kind: "function", name: "weather" },
    });
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /patch_location_mismatch/);
  });
  await t.test("wrong owner and filename", () => {
    const { root, name, base } = fixture("wrong-owner");
    writeFunctionPatch(root, name, 4004, base, [addOptional()], optionalResult(base), { ownerIssue: "#4005" });
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /patch_location_mismatch/);
  });
  await t.test("malformed owner", () => {
    const { root, name, base } = fixture("malformed-owner");
    writeFunctionPatch(root, name, 4006, base, [addOptional()], optionalResult(base), { ownerIssue: "4006" });
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /malformed_patch/);
  });
  await t.test("wrong location", () => {
    const { root, name, base } = fixture("wrong-location");
    const result = optionalResult(base);
    const correct = writeFunctionPatch(root, name, 4007, base, [addOptional()], result);
    const wrong = path.join(root, "supabase/functions/weather/function-policy.issue-4007.patch.json");
    fs.renameSync(correct, wrong);
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /patch_location_mismatch/);
  });
  await t.test("wrong filename", () => {
    const { root, name, base } = fixture("wrong-filename");
    const correct = writeFunctionPatch(root, name, 4008, base, [addOptional()], optionalResult(base));
    fs.renameSync(correct, path.join(path.dirname(correct), "wrong.patch.json"));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /patch_location_mismatch/);
  });
  await t.test("missing disk function", () => {
    const { root, name, base } = fixture("missing-function");
    writeFunctionPatch(root, name, 4009, base, [addOptional()], optionalResult(base));
    fs.rmSync(path.join(root, `supabase/functions/${name}/index.ts`));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /stale_function_patch/);
  });
  await t.test("new nonbootstrap target", () => {
    const { root } = fixture("new-target");
    const name = "issue-3643-new-target";
    write(root, `supabase/functions/${name}/index.ts`, "// fixture\n");
    const base = {
      env: localFunctionPolicy(name).env,
      jwt: { explicit: false, verify_jwt: true },
    };
    writeFunctionPatch(root, name, 4010, base, [addOptional()], optionalResult(base));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /nonbootstrap_patch_target/);
  });
  await t.test("no-op", () => {
    const { root, name, base } = fixture("noop");
    writeFunctionPatch(root, name, 4011, base, [{
      op: "set_verify_jwt", expectedOld: base.jwt.verify_jwt, newValue: base.jwt.verify_jwt,
    }], base);
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /patch_noop/);
  });
  for (const [label, operation] of [
    ["unknown field", { ...addOptional(), unexpected: true }],
    ["whole replacement", { op: "replace_env", value: {} }],
    ["row deletion", { op: "delete_row" }],
    ["direct explicit mutation", { op: "set_explicit", expectedOld: true, newValue: false }],
  ]) {
    await t.test(label, () => {
      const { root, name, base } = fixture(label.replaceAll(" ", "-"));
      writeFunctionPatch(root, name, 4012, base, [operation], optionalResult(base));
      assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /unknown_operation/);
    });
  }
  await t.test("conflicting branches", () => {
    const { root, name, base } = fixture("branches");
    writeFunctionPatch(root, name, 4013, base, [addOptional()], optionalResult(base));
    writeFunctionPatch(root, name, 4014, base, [addOptional("SUPPORT_EMAIL")], optionalResult(base, "SUPPORT_EMAIL"));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /cas_branch_conflict/);
  });
  await t.test("orphan chain", () => {
    const { root, name, base } = fixture("orphan-chain");
    writeFunctionPatch(root, name, 4015, base, [addOptional()], optionalResult(base));
    const orphanBase = structuredClone(base);
    orphanBase.jwt.verify_jwt = !orphanBase.jwt.verify_jwt;
    writeFunctionPatch(root, name, 4016, orphanBase, [addOptional("SUPPORT_EMAIL")], optionalResult(orphanBase, "SUPPORT_EMAIL"));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /cas_stale_or_orphan/);
  });
  await t.test("cycle", () => {
    const { root, name, base } = fixture("cycle");
    const first = optionalResult(base);
    writeFunctionPatch(root, name, 4017, base, [addOptional()], first);
    writeFunctionPatch(root, name, 4018, first, [{
      op: "remove_env_name", classification: "optional_top_level", name: "BUSINESS_WEB_ORIGIN", expectedPresent: true,
    }], base);
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /cas_cycle/);
  });
  await t.test("duplicate issue and target", () => {
    const { root, name, base } = fixture("duplicate-owner");
    const original = writeFunctionPatch(root, name, 4019, base, [addOptional()], optionalResult(base));
    const duplicate = path.join(root, `supabase/functions/weather/function-policy.issue-4019.patch.json`);
    fs.copyFileSync(original, duplicate);
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /duplicate_issue_target/);
  });
  await t.test("duplicate semantic operation", () => {
    const { root, name, base } = fixture("duplicate-operation");
    writeFunctionPatch(root, name, 4020, base, [addOptional(), addOptional()], optionalResult(base));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /duplicate_operation/);
  });
  await t.test("unmet expected value", () => {
    const { root, name, base } = fixture("unmet-expected");
    writeFunctionPatch(root, name, 4021, base, [{ ...addOptional(), expectedAbsent: false }], optionalResult(base));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /unmet_expectation/);
  });
  await t.test("classification overlap", () => {
    const { root, contract } = functionFixture("cas-negative-overlap");
    const name = Object.entries(contract.functions).find(([, row]) => row.required_top_level.length > 0)[0];
    const effective = loadEffectiveFunctionPolicy({ root, sealBootstrap: false });
    const base = functionPolicyRow(effective, name);
    const value = base.env.required_top_level[0];
    writeFunctionPatch(root, name, 4022, base, [addOptional(value)], optionalResult(base, value));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /classification_overlap/);
  });
  await t.test("unowned required name", () => {
    const { root, name, base } = fixture("unowned-required");
    const result = structuredClone(base);
    result.env.required_top_level = ["NOT_GOVERNED_BY_MANIFEST"];
    writeFunctionPatch(root, name, 4023, base, [{
      op: "add_env_name", classification: "required_top_level", name: "NOT_GOVERNED_BY_MANIFEST", expectedAbsent: true,
    }], result);
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /unowned_required_name/);
  });
  await t.test("unowned bundle field", () => {
    const { root, name, base } = fixture("unowned-bundle");
    const result = structuredClone(base);
    result.env.required_bundle_fields = { AD_CONVERSION_TOKENS: ["NOT_AN_OWNED_FIELD"] };
    writeFunctionPatch(root, name, 4024, base, [{
      op: "add_bundle_field", bundle: "AD_CONVERSION_TOKENS", field: "NOT_AN_OWNED_FIELD", expectedAbsent: true,
    }], result);
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /unowned_bundle_field/);
  });
});

test("shared-policy CAS overlays reject wrong paths, missing owners, bad operations, and malformed rows", async (t) => {
  const sharedFixture = (label) => {
    const { root, contract } = functionFixture(`shared-negative-${label}`);
    const modulePath = "supabase/functions/_shared/marketingBookQuote.ts";
    write(root, modulePath, "export const fixture = true;\n");
    return { root, modulePath, base: contract.shared_modules[modulePath] };
  };
  const resultWithOrigin = (base) => {
    const result = structuredClone(base);
    result.allowed_top_level = [...result.allowed_top_level, "BUSINESS_WEB_ORIGIN"].sort();
    return result;
  };
  const operation = {
    op: "add_member", field: "allowed_top_level", value: "BUSINESS_WEB_ORIGIN", expectedAbsent: true,
  };
  await t.test("wrong target path", () => {
    const { root, modulePath, base } = sharedFixture("wrong-path");
    writeSharedPatch(root, modulePath, 4030, base, [operation], resultWithOrigin(base), {
      target: { kind: "shared_module", module_path: "supabase/functions/_shared/adCreative.ts" },
    });
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /patch_location_mismatch/);
  });
  await t.test("missing source module", () => {
    const { root, modulePath, base } = sharedFixture("missing-module");
    writeSharedPatch(root, modulePath, 4031, base, [operation], resultWithOrigin(base));
    fs.rmSync(path.join(root, modulePath));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /stale_shared_patch/);
  });
  await t.test("nonbootstrap module", () => {
    const { root } = sharedFixture("new-module");
    const modulePath = "supabase/functions/_shared/new.ts";
    write(root, modulePath, "export const fixture = true;\n");
    const base = { allowed_top_level: [], dynamic_getters: [], local_call_identifiers: [], closure_call_identifiers: [], allowed_bundle_fields: {} };
    writeSharedPatch(root, modulePath, 4032, base, [operation], resultWithOrigin(base));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /nonbootstrap_patch_target/);
  });
  await t.test("bad operation", () => {
    const { root, modulePath, base } = sharedFixture("bad-operation");
    writeSharedPatch(root, modulePath, 4033, base, [{
      op: "replace_map", field: "allowed_bundle_fields", value: {}, expectedAbsent: true,
    }], resultWithOrigin(base));
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /unknown_operation/);
  });
  await t.test("malformed semantic member", () => {
    const { root, modulePath, base } = sharedFixture("malformed-member");
    const result = structuredClone(base);
    result.local_call_identifiers = [...result.local_call_identifiers, "not-valid!"].sort();
    writeSharedPatch(root, modulePath, 4034, base, [{
      op: "add_member", field: "local_call_identifiers", value: "not-valid!", expectedAbsent: true,
    }], result);
    assert.throws(() => loadEffectiveFunctionPolicy({ root, sealBootstrap: false }), /malformed_env/);
  });
});

test("all five strict-grep classes preserve every sealed member and execute the local loader gate once", () => {
  const bootstrap = loadStrictBootstrap();
  const effective = loadStrictManifest();
  assert.equal(bootstrap.gates.length, 755);
  assert.equal(bootstrap.expectedStrictGrepMjsFiles, 663);
  assert.equal(bootstrap.selfTestWiredFloor, 423);
  // [TEST-MOD-APPROVED #3643] Each sealed gate remains exact, while additive
  // descriptor-owned gates no longer force a mutable effective-total assertion.
  for (const cls of ["A", "B", "C", "D", "E"]) {
    const before = expectedForClass(bootstrap, cls).map((gate) => gate.script);
    const after = expectedForClass(effective, cls).map((gate) => gate.script);
    for (const script of before) {
      assert.equal(after.filter((candidate) => candidate === script).length, 1, `${cls}:${script}`);
    }
  }
  assert.equal(expectedExecutions(effective, "A").filter((item) => item.gate.script === ".github/scripts/strict-grep/load-manifest.mjs").length, 1);
});
