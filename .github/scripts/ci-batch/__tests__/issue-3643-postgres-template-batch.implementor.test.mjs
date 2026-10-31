import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BOOTSTRAP_SHA256, loadEffectiveManifest } from "../load-manifest.mjs";
import { POSTGRES_WAVE, postgresAdditionalDatabaseName, postgresDatabaseName } from "../postgres-batch-contract.mjs";
import { migrationsForPostgresTemplate, selectedPostgresSuites, waitForTemplateDrain } from "../postgres-batch.mjs";
import { SUITES_FOLDED_IN_POSTGRES_WAVE, suiteCommandFingerprint, validateRegistry } from "../validate-manifest-v2.mjs";
import { buildShardReport, expectedPrimarySuites, routingReport, runInvocation, runSuiteV2, selectSuites } from "../run-suite-batch.mjs";
import { reconcilePhase3bReports, selectionDocument } from "../select-phase3b-suites.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MANIFEST = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const BATCH = path.join(ROOT, ".github", "workflows", ["ci", "batch.yml"].join("-"));

function manifest() {
  return loadEffectiveManifest({ root: ROOT, manifestPath: MANIFEST, expectedSha: BOOTSTRAP_SHA256, discover: true });
}

test("#3643 folded steps receive declared inputs and preserve shell failures", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-runner-test-"));
  const previous = { PATH: process.env.PATH, PG_BATCH_PASSWORD: process.env.PG_BATCH_PASSWORD, ISSUE_1403_BASE_REF: process.env.ISSUE_1403_BASE_REF };
  try {
    fs.writeFileSync(path.join(temporary, "psql"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    process.env.PATH = `${temporary}:${process.env.PATH}`;
    process.env.PG_BATCH_PASSWORD = "local-fixture-password";
    process.env.ISSUE_1403_BASE_REF = "base-fixture";
    const suite = { id: "probe", migrationWave: POSTGRES_WAVE, lifecycle: "batched-historical", class: "postgres17-probe", databaseName: "suite_probe", timeoutSeconds: 10,
      envNames: ["ISSUE_1403_BASE_REF"], steps: [{ cwd: ".", name: "probe", invocation: { kind: "raw-shell", command: "bash", argv: ["-c", "false\ntrue"] } }] };
    const evidence = { schemaVersion: 1, class: suite.class, replayExecutions: 1, selectedSuiteIds: [suite.id], databases: { probe: suite.databaseName }, port: 5432 };
    let observed;
    const result = await runSuiteV2(suite, { root: temporary, profile: { installs: [] }, postgresEvidence: evidence,
      workspaceFactory: () => ({ root: temporary, cleanup() {} }),
      execute: async (command, options) => { observed = options; return runInvocation(command, options); } });
    assert.equal(result.status, "failed");
    assert.equal(observed.env.ISSUE_1403_BASE_REF, "base-fixture");
    assert.ok(observed.env.RUNNER_TEMP.startsWith(os.tmpdir()));
    assert.equal(observed.offline, false);
    assert.equal(observed.env.PG_BATCH_PASSWORD, undefined);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("#3643 Phase 3E maps every routed suite to one unique deterministic template copy", () => {
  const loaded = manifest();
  const suites = loaded.suites.filter((suite) => suite.migrationWave === POSTGRES_WAVE);
  assert.deepEqual(suites.map((suite) => suite.id), SUITES_FOLDED_IN_POSTGRES_WAVE.map((item) => item.suite));
  assert.equal(new Set(suites.map((suite) => suite.databaseName)).size, suites.length);
  for (const suite of suites) {
    assert.equal(suite.databaseName, postgresDatabaseName(suite.id));
    assert.equal(suite.lifecycle, "batched-historical");
    assert.equal(fs.existsSync(path.join(ROOT, suite.origin)), false);
    assert.ok(suite.steps.every((step) => step.invocation.argv[1] === step.run && step.originJob));
    if (suite.steps.some((step) => step.run.includes("--experimental-strip-types"))) {
      assert.ok(Number(suite.runtime.nodeVersion || suite.runtime.version) >= 22,
        `${suite.id}: retained TypeScript stripping commands require Node 22 or later`);
    }
  }
  for (const klass of new Set(suites.map((suite) => suite.class))) {
    assert.deepEqual(
      selectedPostgresSuites(loaded, klass, { env: {} }).map((suite) => suite.id),
      suites.filter((suite) => suite.class === klass).map((suite) => suite.id),
    );
  }
  const dual = suites.find((suite) => suite.id === "issue-1985-ari-task-state");
  assert.deepEqual(dual.additionalDatabases, {
    vaultless: postgresAdditionalDatabaseName(dual.id, "vaultless"),
  });
  const customReplayIds = suites.filter((suite) => suite.templateReplay).map((suite) => suite.id);
  assert.deepEqual(customReplayIds, [
    "issue-1857-phone-country-authority-tests",
    "issue-1931-private-event-access",
    "issue-2060-ari-reliability",
    "issue-2117-offering-visibility-gate-tests",
  ]);
  for (const suite of suites.filter((item) => item.templateReplay)) {
    assert.equal(suites.filter((item) => item.class === suite.class).length, 1);
    assert.equal(typeof suite.templateReplay.run, "string");
    assert.ok(suite.templateReplay.run.length > 0);
  }
});

test("#3643 one Postgres service/replay replaces per-suite bring-up and stays route-gated", () => {
  const source = fs.readFileSync(BATCH, "utf8");
  assert.equal(source.match(/Replay migrations once and clone routed PostgreSQL suite databases/g)?.length, 1);
  assert.equal(source.match(/image: \$\{\{ startsWith\(matrix\.class, 'postgres17-'\)/g)?.length, 1);
  assert.match(source, /steps\.route\.outputs\.runPrimarySetup != 'false'/);
  assert.match(source, /postgres-batch\.mjs --setup "\$\{\{ matrix\.class \}\}"/);
});

test("#3643 the #3429 dual-database template stops before its self-applied migration", () => {
  const migrations = [
    "supabase/migrations/20270712003428_before.sql",
    "supabase/migrations/20270712003429_issue_3429_ari_chat_context.sql",
    "supabase/migrations/20280209003355_later_dependency.sql",
  ];
  assert.deepEqual(
    migrationsForPostgresTemplate(migrations, "postgres17-deno146-node20-dualdb"),
    [migrations[0]],
  );
  assert.deepEqual(
    migrationsForPostgresTemplate(migrations, "postgres17-deno2-node22-noinstall"),
    migrations,
  );
});

test("#3643 template drain tolerates asynchronous exit but still fails closed", () => {
  const observedSleeps = [];
  const counts = ["1", "1", "0"];
  waitForTemplateDrain(() => counts.shift(), {
    attempts: 3,
    delayMs: 25,
    sleep: (ms) => observedSleeps.push(ms),
  });
  assert.deepEqual(observedSleeps, [25, 25]);

  assert.throws(
    () => waitForTemplateDrain(() => "1", { attempts: 3, sleep() {} }),
    /G-3: 1 backend\(s\) remain attached.*after 3 drain checks/,
  );
  assert.throws(
    () => waitForTemplateDrain(() => "not-a-count", { sleep() {} }),
    /G-3: invalid template backend count/,
  );
});

test("#3643 original unfiltered and live-provider routing cannot narrow during the fold", () => {
  const loaded = manifest();
  const suite = loaded.suites.find((suite) => suite.id === "issue-1614-onconflict-arbiter-audit");
  assert.deepEqual(selectSuites(loaded, [suite], { mode: "routed", changedPaths: ["README.md"] }).suites, [suite]);
  for (const id of ["issue-1403-listing-insights-tests", "issue-1421-venue-organic-insights-tests"]) {
    const candidate = loaded.suites.find((suite) => suite.id === id);
    const origin = loaded.legacyOrigins.find((origin) => origin.stem === id);
    for (const pattern of origin.routing.originPaths) {
      assert.ok(candidate.originPaths.includes(pattern), `${id}: lost prior routing ${pattern}`);
      const file = pattern.endsWith("/**") ? `${pattern.slice(0, -3)}/routing-proof.ts` : pattern.replace(/\*$/, "routing-proof.ts");
      assert.deepEqual(selectSuites(loaded, [candidate], { mode: "routed", changedPaths: [file] }).suites, [candidate]);
    }
  }
});

test("#3643 reconciliation accepts the every-PR audit and rejects its omission", () => {
  const loaded = manifest();
  const host = "postgres17-deno2-node22-noinstall";
  const context = { eventName: "pull_request", mode: "routed", changedPaths: ["supabase/functions/claim-link/index.ts"] };
  const selection = selectSuites(loaded, expectedPrimarySuites(loaded, host), context);
  assert.deepEqual(selection.suites.map((suite) => suite.id), ["issue-1614-onconflict-arbiter-audit"]);
  const decision = selectionDocument(loaded, host, context.changedPaths, { source: {
    eventName: "pull_request", baseSha: "a".repeat(40), headSha: "b".repeat(40),
    mergeBaseSha: "a".repeat(40), pathSource: "local-git-three-dot-nul",
  } });
  const results = selection.suites.map((suite) => ({
    id: suite.id, setupProfile: suite.setupProfile, commandFingerprint: suiteCommandFingerprint(suite),
    expected: suite.steps.length, executed: suite.steps.length, status: "passed", ok: true, code: 0,
  }));
  const report = buildShardReport(host, selection.suites, results, null, 0);
  report.routing = routingReport(context, selection);
  assert.deepEqual(reconcilePhase3bReports(loaded, host, decision, report), []);

  const omitted = buildShardReport(host, [], [], null, 0);
  omitted.routing = { ...report.routing, classSelectedSuiteIds: [] };
  const errors = reconcilePhase3bReports(loaded, host, decision, omitted);
  assert.ok(errors.includes("primary-routing-mismatch"));
  assert.ok(errors.includes("primary-identity-mismatch"));
});

test("#3643 G-1/G-3/G-9 and exact-command mutants are rejected", () => {
  const cases = [
    ["G-1 deterministic database", (loaded, suite) => { suite.databaseName = "suite_wrong"; }, /database|Phase 3E/],
    ["G-3 no template execution", (loaded, suite) => { loaded.migrationWaves[POSTGRES_WAVE].migrationReplayCountPerHost = 2; }, /replay contract/],
    ["G-9 per-suite routing", (loaded, suite) => { suite.originPaths = []; }, /originPaths|routing/],
    ["G-9 retained live-provider routing", (loaded) => {
      const suite = loaded.suites.find((suite) => suite.id === "issue-1403-listing-insights-tests");
      suite.originPaths = suite.originPaths.filter((pattern) => pattern !== "packages/**");
    }, /prior routing/],
    ["exact command", (loaded, suite) => { suite.steps[0].invocation.argv[1] += " --no-check"; }, /typed invocation|capability|contract/],
    ["custom replay", (loaded) => { loaded.suites.find((suite) => suite.templateReplay).templateReplay.run += "\necho weakened"; }, /Phase 3E|contract/],
    ["additional database", (loaded) => { loaded.suites.find((suite) => suite.additionalDatabases).additionalDatabases.vaultless = "wrong"; }, /Phase 3E|database|contract/],
  ];
  for (const [label, mutate, expected] of cases) {
    const loaded = manifest();
    const suite = loaded.suites.find((item) => item.migrationWave === POSTGRES_WAVE);
    mutate(loaded, suite);
    assert.ok(validateRegistry(loaded, { root: ROOT }).some((error) => expected.test(error)), label);
  }
});
