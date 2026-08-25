#!/usr/bin/env node

/**
 * #1999 — keep both independently owned provider-schema contracts live in CI.
 *
 * [#2439 SC-15 item 3] This gate used to read
 * `WORKFLOW_PATH` off disk and assert against the workflow's TEXT. Phase 3C
 * deletes that wrapper at cutover, so the read resolves to nothing and the gate
 * would have reported `workflow missing` — a controlled failure, but a failure,
 * and a permanent red on a correct tree. It now asserts the SAME five
 * protections against the CI registry, which is where #1999's triggers and its
 * exact Deno command actually live from the shadow commit onward:
 *
 *   1. both trigger events are declared,
 *   2. every guarded source path is wired for push AND pull_request,
 *   3. every exact test target is in both trigger path lists AND in the command,
 *   4. the exact unconditional dual-test Deno command exists, permissions and
 *      all, and
 *   5. execution is unconditional — a typed predicate the runner can see, never
 *      a shell `test -f` that turns a missing suite into a silent skip.
 *
 * SC-15.1 adds what a filename read could never see: provider identity, the
 * owning wave, the pinned Deno action and runtime, cwd, and an empty
 * environment. `--self-test` proves the checker still sees omitted targets,
 * conditional execution and incomplete source coverage.
 *
 * The wrapper path below is an IDENTITY the registry itself carries (each
 * suite's `origin`), not a file this gate opens. Nothing here touches disk
 * except the registry.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const REGISTRY_PATH = ".github/ci-batch/MANIFEST.json";
const SUITE_ID = "issue-1999-ari-provider-schema-tests";
const ORIGIN = ".github/workflows/issue-1999-ari-provider-schema-tests.yml";
const WAVE = "phase3c-deno-wave";
const DENO_1_46_ACTION = "denoland/setup-deno@11b63cf76cfcafb4e43f97b6cad24d8e8438f62d";
const IMPLEMENTOR_TEST_PATH =
  "supabase/functions/_shared/__tests__/issue_1999_ari_provider_schema_contract.test.ts";
const TESTER_TEST_PATH =
  "supabase/functions/_shared/__tests__/issue_1999_ari_provider_schema_contract.tester_adversarial.test.ts";
const TEST_PATHS = [IMPLEMENTOR_TEST_PATH, TESTER_TEST_PATH];
const SOURCE_PATHS = [
  "supabase/functions/_shared/agentGemini.ts",
  "supabase/functions/_shared/agentTools.ts",
  "supabase/functions/_shared/agentDomainTools.ts",
  "supabase/functions/_shared/agentToolHelpers.ts",
  "supabase/functions/agent-chat/**",
];
const EXACT_RUN =
  `deno test --allow-read ${IMPLEMENTOR_TEST_PATH} ${TESTER_TEST_PATH}`;

/**
 * @param {object} registry parsed `.github/ci-batch/MANIFEST.json`
 * @param {string[]} failures accumulator
 */
export function check(registry, failures) {
  const suites = (registry.suites || []).filter((suite) => suite.id === SUITE_ID);
  if (suites.length !== 1) {
    failures.push(`expected exactly one ${SUITE_ID} suite in the CI registry, got ${suites.length}`);
    return;
  }
  const [suite] = suites;
  if (suite.migrationWave !== WAVE) failures.push("suite is not owned by phase3c-deno-wave");
  if (suite.origin !== ORIGIN) failures.push(`provider identity drifted: ${suite.origin}`);

  const push = suite.triggerContract?.push;
  const pullRequest = suite.triggerContract?.pullRequest;
  if (!push) failures.push("missing push trigger");
  if (!pullRequest) failures.push("missing pull_request trigger");
  const pathLists = [push?.paths, pullRequest?.paths].map((list) => (Array.isArray(list) ? list : []));

  for (const sourcePath of SOURCE_PATHS) {
    const occurrences = pathLists.filter((list) => list.includes(sourcePath)).length;
    if (occurrences < 2) {
      failures.push(`source path is not wired for push and pull_request: ${sourcePath}`);
    }
  }

  const leaves = (suite.steps || []).flatMap((step) => (step.children || []).map((child) => ({ step, child })));
  const commands = leaves.map(({ child }) => child.invocation?.argv?.[1] || "");
  for (const testPath of TEST_PATHS) {
    const testOccurrences = pathLists.filter((list) => list.includes(testPath)).length
      + (commands.some((command) => command.includes(testPath)) ? 1 : 0);
    if (testOccurrences < 3) {
      failures.push(`exact test must appear in both triggers and the Deno command: ${testPath}`);
    }
  }

  const exact = leaves.find(({ child }) => (child.invocation?.argv?.[1] || "") === EXACT_RUN);
  if (!exact) {
    failures.push("exact unconditional dual-test Deno command is missing");
  } else {
    if ((exact.child.cwd ?? exact.step.cwd ?? ".") !== ".") failures.push("dual-test Deno command moved out of the repository root");
    if (exact.child.predicate?.kind !== "always") {
      failures.push("provider-schema test execution is conditional");
    }
  }
  for (const command of commands) {
    if (/if\s+(?:\[\s+-f|test\s+-f)[^\n]*issue_1999/.test(command)) {
      failures.push("provider-schema test execution is conditional");
    }
  }

  const runtime = suite.runtime || {};
  if (runtime.name !== "node+deno" || runtime.deno?.action !== DENO_1_46_ACTION || runtime.deno?.version !== "1.46.x") {
    failures.push(`runtime or Deno action pin drifted: ${JSON.stringify(runtime)}`);
  }
  if ((suite.envNames || []).length) failures.push("suite gained an environment capability");

  // [#2439 SC-15.1] Lifecycle consistency, asserted PURELY from the registry —
  // no filesystem coupling to a wrapper file, because re-coupling this guard to
  // `.github/workflows/<name>` is exactly what cutover removes. At shadow the
  // legacy origin names its own wrapper as sole provider; at terminal it must
  // not, because the batch umbrella is. A batched record still naming its
  // deleted wrapper is the SC-18.3 attack this catches.
  const legacyOrigin = (registry.legacyOrigins || []).find((item) => `${item.stem}.${item.extension}` === ORIGIN.split("/").pop());
  const namesItself = legacyOrigin?.providerWorkflow === ORIGIN;
  if (!legacyOrigin || namesItself !== (suite.lifecycle !== "batched-historical")) {
    failures.push("legacy origin does not name the sole provider for this lifecycle");
  }
}

if (process.argv.includes("--self-test")) {
  const leaf = (command) => ({ id: "leaf", cwd: ".", invocation: { kind: "argv", command: "bash", argv: ["-c", command] }, predicate: { kind: "always" } });
  const good = {
    legacyOrigins: [{
      stem: "issue-1999-ari-provider-schema-tests",
      extension: "yml",
      disposition: "batched-historical",
      providerWorkflow: ".github/workflows/ci-batch." + "yml",
    }],
    suites: [{
      lifecycle: "batched-historical",
      id: SUITE_ID,
      origin: ORIGIN,
      migrationWave: WAVE,
      envNames: [],
      runtime: { name: "node+deno", nodeVersion: "20", deno: { version: "1.46.x", action: DENO_1_46_ACTION } },
      triggerContract: {
        push: { branches: ["main"], paths: [...SOURCE_PATHS, ...TEST_PATHS, ORIGIN] },
        pullRequest: { branches: null, paths: [...SOURCE_PATHS, ...TEST_PATHS, ORIGIN] },
      },
      steps: [{ commandId: "assert:01", cwd: ".", children: [leaf(EXACT_RUN)] }],
    }],
  };
  const clone = (value) => structuredClone(value);
  const selfFailures = [];
  const goodFailures = [];
  check(good, goodFailures);
  if (goodFailures.length > 0) {
    selfFailures.push(`GOOD fixture rejected: ${goodFailures.join("; ")}`);
  }

  const missingTarget = clone(good);
  missingTarget.suites[0].triggerContract.push.paths = missingTarget.suites[0].triggerContract.push.paths
    .map((entry) => (entry === TESTER_TEST_PATH ? "other.test.ts" : entry));
  missingTarget.suites[0].steps[0].children = [leaf(`deno test --allow-read ${IMPLEMENTOR_TEST_PATH} other.test.ts`)];
  const missingFailures = [];
  check(missingTarget, missingFailures);
  if (!missingFailures.some((failure) => failure.includes(TESTER_TEST_PATH))) {
    selfFailures.push("BAD1 missing exact tester target was not rejected");
  }

  const conditional = clone(good);
  conditional.suites[0].steps[0].children = [
    leaf(`if test -f ${TESTER_TEST_PATH}; then deno test --allow-read ${IMPLEMENTOR_TEST_PATH} ${TESTER_TEST_PATH}; fi`),
  ];
  const conditionalFailures = [];
  check(conditional, conditionalFailures);
  if (!conditionalFailures.some((failure) => failure.includes("conditional"))) {
    selfFailures.push("BAD2 conditional test execution was not rejected");
  }

  const incomplete = clone(good);
  for (const list of [incomplete.suites[0].triggerContract.push.paths, incomplete.suites[0].triggerContract.pullRequest.paths]) {
    list[list.indexOf("supabase/functions/_shared/agentTools.ts")] = "other.ts";
  }
  const incompleteFailures = [];
  check(incomplete, incompleteFailures);
  if (!incompleteFailures.some((failure) => failure.includes("agentTools.ts"))) {
    selfFailures.push("BAD3 missing registry trigger was not rejected");
  }

  const missingHelper = clone(good);
  for (const list of [missingHelper.suites[0].triggerContract.push.paths, missingHelper.suites[0].triggerContract.pullRequest.paths]) {
    list[list.indexOf("supabase/functions/_shared/agentToolHelpers.ts")] = "other-helper.ts";
  }
  const missingHelperFailures = [];
  check(missingHelper, missingHelperFailures);
  if (!missingHelperFailures.some((failure) => failure.includes("agentToolHelpers.ts"))) {
    selfFailures.push("BAD4 missing helper trigger was not rejected");
  }

  // [#2439 SC-15.1] Five more mutants for the protections a filename read could
  // never have seen. Each is a real loss this gate now catches.
  const skipped = clone(good);
  skipped.suites[0].steps[0].children[0].predicate = { kind: "file-exists", paths: [TESTER_TEST_PATH] };
  const skippedFailures = [];
  check(skipped, skippedFailures);
  if (!skippedFailures.some((failure) => failure.includes("conditional"))) {
    selfFailures.push("BAD5 typed conditional predicate was not rejected");
  }

  const permission = clone(good);
  permission.suites[0].steps[0].children[0].invocation.argv[1] = EXACT_RUN.replace("--allow-read", "--allow-read --allow-net");
  const permissionFailures = [];
  check(permission, permissionFailures);
  if (!permissionFailures.some((failure) => failure.includes("exact unconditional dual-test Deno command"))) {
    selfFailures.push("BAD6 widened permission set was not rejected");
  }

  const identity = clone(good);
  identity.suites[0].origin = ".github/workflows/not-a-real-workflow-identity";
  const identityFailures = [];
  check(identity, identityFailures);
  if (!identityFailures.some((failure) => failure.includes("provider identity drifted"))) {
    selfFailures.push("BAD7 provider identity drift was not rejected");
  }

  const pin = clone(good);
  pin.suites[0].runtime.deno.action = "denoland/setup-deno@v1";
  const pinFailures = [];
  check(pin, pinFailures);
  if (!pinFailures.some((failure) => failure.includes("Deno action pin drifted"))) {
    selfFailures.push("BAD8 floated Deno action was not rejected");
  }

  const env = clone(good);
  env.suites[0].envNames = ["SUPABASE_SERVICE_ROLE_KEY"];
  const envFailures = [];
  check(env, envFailures);
  if (!envFailures.some((failure) => failure.includes("environment capability"))) {
    selfFailures.push("BAD9 widened environment was not rejected");
  }

  const lifecycle = clone(good);
  // Inverts rather than pins: a lifecycle mutant fixed at one value cannot fail
  // once the wave actually reaches that value.
  lifecycle.suites[0].lifecycle = lifecycle.suites[0].lifecycle === "batched-historical" ? "shadow-active" : "batched-historical";
  const lifecycleFailures = [];
  check(lifecycle, lifecycleFailures);
  if (!lifecycleFailures.some((failure) => failure.includes("sole provider for this lifecycle"))) {
    selfFailures.push("BAD11 lifecycle/provider disagreement was not rejected");
  }

  const orphan = clone(good);
  orphan.legacyOrigins = [];
  const orphanFailures = [];
  check(orphan, orphanFailures);
  if (!orphanFailures.some((failure) => failure.includes("sole provider for this lifecycle"))) {
    selfFailures.push("BAD12 missing legacy origin was not rejected");
  }

  const absent = clone(good);
  absent.suites = [];
  const absentFailures = [];
  check(absent, absentFailures);
  if (!absentFailures.some((failure) => failure.includes("exactly one"))) {
    selfFailures.push("BAD10 missing suite was not rejected");
  }

  if (selfFailures.length > 0) {
    console.error("issue-1999-ari-provider-schema-ci-wiring self-test FAIL:");
    selfFailures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }
  console.log("issue-1999-ari-provider-schema-ci-wiring self-test PASS (13/13 cases).");
  process.exit(0);
}

const failures = [];
const registryAbsolute = path.join(repoRoot, REGISTRY_PATH);
if (!fs.existsSync(registryAbsolute)) {
  failures.push(`CI registry missing: ${REGISTRY_PATH}`);
} else {
  check(JSON.parse(fs.readFileSync(registryAbsolute, "utf8")), failures);
}
for (const testPath of TEST_PATHS) {
  if (!fs.existsSync(path.join(repoRoot, testPath))) {
    failures.push(`provider-schema test missing: ${testPath}`);
  }
}

if (failures.length > 0) {
  console.error("issue-1999-ari-provider-schema-ci-wiring FAIL:");
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log("issue-1999-ari-provider-schema-ci-wiring PASS.");
process.exit(0);
