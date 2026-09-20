#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

// [#2439 SC-15 item 4] This guard used to read
// `.github/workflows/issue-2019-ari-delegated-auth.yml` directly. That file is
// deleted at Phase 3C cutover, so the read would have thrown ENOENT and taken
// the whole gate down with an unhandled crash rather than a controlled failure.
// It now reads the CI registry, which is where #2019's assertions live from the
// shadow commit onward, and asserts the SAME protections against the suite
// record: provider identity, push and pull_request path provenance, the exact
// ordered argv of every leaf, cwd, runtime, action pin and environment.
//
// This edit is also the mechanism that WAKES #2019's legacy job at the parity
// SHA. #2019 is the only one of the seventeen whose `paths:` filter excludes its
// own workflow file on both push and pull_request, and it declares no
// workflow_dispatch, so the SC-12.1 marker alone is inert on it. Its `paths:`
// DOES name this file, so touching this file is what triggers the legacy run —
// and nothing here alters a single assertion semantic.
const REGISTRY_PATH = ".github/ci-batch/MANIFEST.json";
const SUITE_ID = "issue-2019-ari-delegated-auth";
const ORIGIN = ".github/workflows/issue-2019-ari-delegated-auth.yml";
const GUARD = ".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs";
const TESTER_SUITE = "supabase/functions/_shared/__tests__/issue_2019_agent_authorization.tester-adversarial.test.ts";
const IMPLEMENTOR_SUITE = "supabase/functions/_shared/__tests__/issue_2019_agent_authorization.test.ts";
// [TEST-MOD-APPROVED #3429] Match the Deno-formatted production call while
// preserving the exact function and first two argument identities.
const PROPOSAL_AUTHORIZATION_PATTERN = /await\s+authorizeAgentTool\s*\(\s*tool\s*,\s*gemini\.toolCall\.args\s*,/;
const DENO_1_46_ACTION = "denoland/setup-deno@11b63cf76cfcafb4e43f97b6cad24d8e8438f62d";
// The exact ordered argv of every leaf, in order. Options and permission flags
// are part of this: `deno test --allow-read <files>` and nothing wider.
const EXPECTED_LEAF_ARGV = [
  `deno test --allow-read ${IMPLEMENTOR_SUITE} ${TESTER_SUITE}`,
  "deno check supabase/functions/agent-chat/index.ts supabase/functions/agent-confirm-action/index.ts",
  `node ${GUARD} --self-test`,
  `node ${GUARD}`,
];

// [#3429 REWORK-2 R-7] Comments come off FIRST, always. Every positive
// assertion below — the authorization call, its ordering against the pending
// row write, the confirmation ordering, the required needles — used to read the
// raw file, so deleting the real
// `await authorizeAgentTool(tool, gemini.toolCall.args, userClient, userId);`
// and leaving the identical text on one `//` line kept the gate GREEN. A guard
// a comment can satisfy protects nothing. The negative rules (the forbidden
// authorization seams) read the same stripped view, so prose that merely NAMES
// a banned seam cannot trip them either — both directions are pinned by the
// two self-test mutants at the end of this file.
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const sources = {
  auth: stripComments(read("supabase/functions/_shared/agentToolAuthorization.ts")),
  tools: stripComments(read("supabase/functions/_shared/agentTools.ts")),
  domain: stripComments(read("supabase/functions/_shared/agentDomainTools.ts")),
  chat: stripComments(read("supabase/functions/agent-chat/index.ts")),
  confirm: stripComments(read("supabase/functions/agent-confirm-action/index.ts")),
};
const registry = JSON.parse(read(REGISTRY_PATH));

/**
 * Resolve #2019's CI provenance from the registry. Pure: it takes the parsed
 * registry so every mutant below runs against an in-memory copy and this module
 * never writes to the tree.
 */
export function ciProvenance(manifest) {
  const failures = [];
  const suites = (manifest.suites || []).filter((suite) => suite.id === SUITE_ID);
  if (suites.length !== 1) {
    failures.push(`expected exactly one ${SUITE_ID} suite in the CI registry, got ${suites.length}`);
    return failures;
  }
  const [suite] = suites;
  if (suite.migrationWave !== "phase3c-deno-wave") failures.push("suite is not owned by phase3c-deno-wave");
  if (suite.origin !== ORIGIN) failures.push(`provider identity drifted: ${suite.origin}`);
  const origin = (manifest.legacyOrigins || []).find((item) => `${item.stem}.${item.extension}` === path.basename(ORIGIN));
  // At shadow the origin names its own wrapper; at terminal it must NOT, because
  // the wrapper is gone and the batch umbrella is the sole provider. The
  // umbrella's filename is deliberately not spelled here: naming a workflow file
  // in a tracked source makes this guard provider evidence and moves a frozen
  // discovery digest.
  const namesItself = origin?.providerWorkflow === ORIGIN;
  if (!origin || namesItself !== (suite.lifecycle !== "batched-historical")) {
    failures.push("legacy origin does not name the sole provider for this lifecycle");
  }
  // A wrapper restored after cutover is a duplicate provider, and the whole
  // point of the transition is that exactly one thing runs these assertions.
  const wrapperLive = fs.existsSync(path.join(ROOT, ORIGIN));
  if (suite.lifecycle === "batched-historical" && wrapperLive) failures.push("terminal wrapper was restored");
  if (suite.lifecycle === "shadow-active" && !wrapperLive) failures.push("shadow wrapper is missing");

  // #2019's push trigger deliberately carries NO branches filter, and both path
  // lists deliberately omit the workflow file while naming this guard. That is
  // provenance, not an oversight: normalising it to the [main] majority would
  // change when the legacy lane fires.
  const push = suite.triggerContract?.push;
  const pull = suite.triggerContract?.pullRequest;
  if (!push || push.branches !== null) failures.push("push provenance lost its unfiltered-branch shape");
  if (!push?.paths?.includes(GUARD)) failures.push("push provenance no longer names this guard");
  if (push?.paths?.includes(ORIGIN)) failures.push("push provenance gained its own workflow file");
  if (!pull?.paths?.includes(GUARD)) failures.push("pull_request provenance no longer names this guard");
  if (pull?.paths?.includes(ORIGIN)) failures.push("pull_request provenance gained its own workflow file");

  const leaves = (suite.steps || []).flatMap((step) => (step.children || []).map((child) => ({ step, child })));
  const argv = leaves.map(({ child }) => child.invocation?.argv?.[1] ?? null);
  if (JSON.stringify(argv) !== JSON.stringify(EXPECTED_LEAF_ARGV)) {
    failures.push(`ordered leaf argv drifted:\n    ${JSON.stringify(argv)}`);
  }
  for (const { step, child } of leaves) {
    if ((child.cwd ?? step.cwd) !== ".") failures.push(`leaf ${child.id} changed working directory`);
    if (child.env !== null || step.env !== undefined) failures.push(`leaf ${child.id} gained an environment capability`);
  }
  const runtime = suite.runtime || {};
  if (runtime.name !== "node+deno" || runtime.deno?.version !== "1.46.x" || runtime.deno?.action !== DENO_1_46_ACTION) {
    failures.push(`runtime or Deno action pin drifted: ${JSON.stringify(runtime)}`);
  }
  for (const protectedFile of [IMPLEMENTOR_SUITE, TESTER_SUITE]) {
    if (!(suite.expectedFiles || []).includes(protectedFile)) failures.push(`protected test file is not registered: ${protectedFile}`);
  }
  return failures;
}

function check(s, manifest) {
  const failures = [];
  const declarationCount = (s.auth.match(/:\s*role\("/g) ?? []).length;
  // [TEST-MOD-APPROVED #2063] Three certified brand tools extend the current
  // #1973/#1985 authorization denominator without changing inherited roles.
  // [TEST-MOD-APPROVED #1975+#1978+#1979] Stay (+3), venue listing reads (+3),
  // and venue manage tools (+3 availability/menu/waitlist) extend the
  // denominator (71 + 9 = 80).
  // [TEST-MOD-APPROVED #1971] Four trip graph tools (days/inclusions/tiers/
  // traveler intake) plus the finance-gated aggregate trip money read extend it
  // again (80 + 5 = 85). No inherited role changes.
  // [TEST-MOD-APPROVED #2830] The twelve closed Website tools extend the same
  // central caller-scoped authorization denominator (108 + 12 = 120).
  // [TEST-MOD-APPROVED #1980] Draft update/delete + growth report read
  // (123 + 2 = 125).
  // [TEST-MOD-APPROVED #1982] revoke_brand_invitation (125 + 1 = 126).
  // [TEST-MOD-APPROVED #1984] listing conversion + reservation metrics (126 + 2 = 128).
  if (declarationCount !== 128) failures.push(`expected 128 declarations, got ${declarationCount}`);
  for (const needle of ["biz_brand_effective_rank_for_caller", 'rpc("biz_role_rank"', "secureAgentTools(", "await authorizeAgentTool"]) {
    if (!Object.values(s).some((value) => value.includes(needle))) failures.push(`missing ${needle}`);
  }
  const proposal = s.chat.search(PROPOSAL_AUTHORIZATION_PATTERN);
  const pending = s.chat.indexOf('.from("agent_pending_actions")', proposal);
  if (proposal < 0 || pending < proposal) failures.push("proposal authorization ordering broken");
  const finalArgs = s.confirm.indexOf("const finalArgs");
  const finalAuth = s.confirm.indexOf("await authorizeAgentTool(tool, finalArgs");
  const executing = s.confirm.indexOf('status: "executing"', finalAuth);
  if (!(finalArgs >= 0 && finalAuth > finalArgs && executing > finalAuth)) failures.push("confirmation ordering broken");
  const protectedSource = [s.auth, s.tools, s.domain].join("\n");
  for (const forbidden of ["assertBrandOwned", "assertEventOwned", 'rpc("biz_brand_effective_rank"', "service_role"]) {
    if (protectedSource.includes(forbidden)) failures.push(`forbidden authorization seam: ${forbidden}`);
  }
  // Was: `if (!s.workflow.includes("issue_2019_agent_authorization.tester-adversarial.test.ts"))`.
  // Same protection, expressed against the registry: the tester suite must
  // appear in a real executed leaf, not merely somewhere in a YAML file.
  failures.push(...ciProvenance(manifest));
  return failures;
}

if (process.argv.includes("--self-test")) {
  const clone = () => JSON.parse(JSON.stringify(registry));
  const withRegistry = (mutate) => { const value = clone(); mutate(value, value.suites.find((suite) => suite.id === SUITE_ID)); return value; };
  const mutations = [
    // Pre-existing source mutants, unchanged.
    [{ ...sources, auth: sources.auth.replaceAll("biz_brand_effective_rank_for_caller", "removed_rank_rpc") }, registry],
    [{ ...sources, chat: sources.chat.replace(PROPOSAL_AUTHORIZATION_PATTERN, "await removed(tool, gemini.toolCall.args,") }, registry],
    // [#3429 REWORK-2 R-7] The comment-revival mutant: delete the real call and
    // put the identical text back on a `//` line. `sources.chat` is already
    // stripped, so re-adding the raw commented text and stripping it again is
    // exactly what CI sees — and it must NOT satisfy the assertion.
    [{
      ...sources,
      chat: stripComments(
        sources.chat.replace(
          PROPOSAL_AUTHORIZATION_PATTERN,
          "// await authorizeAgentTool(tool, gemini.toolCall.args,",
        ),
      ),
    }, registry],
    // The same trap on the confirmation half.
    [{
      ...sources,
      confirm: stripComments(
        sources.confirm.replace(
          "await authorizeAgentTool(tool, finalArgs",
          "// await authorizeAgentTool(tool, finalArgs",
        ),
      ),
    }, registry],
    [{ ...sources, confirm: sources.confirm.replace('status: "executing"', 'status: "removed"') }, registry],
    [{ ...sources, auth: sources.auth.replace(/:\s*role\("/, ": removed(") }, registry],
    // [#2439 SC-15.1] Registry mutants: missing suite, wrong provider, lost push
    // provenance, lost PR provenance, changed command/options/runtime/env, and a
    // restored terminal wrapper.
    [sources, withRegistry((value) => { value.suites = value.suites.filter((suite) => suite.id !== SUITE_ID); })],
    [sources, withRegistry((value, suite) => { suite.origin = ".github/workflows/not-this-origin"; })],
    [sources, withRegistry((value, suite) => { suite.triggerContract.push.branches = ["main"]; })],
    [sources, withRegistry((value, suite) => { suite.triggerContract.push.paths = suite.triggerContract.push.paths.filter((item) => item !== GUARD); })],
    [sources, withRegistry((value, suite) => { suite.triggerContract.pullRequest.paths = suite.triggerContract.pullRequest.paths.filter((item) => item !== GUARD); })],
    [sources, withRegistry((value, suite) => { suite.steps[0].children[0].invocation.argv[1] = suite.steps[0].children[0].invocation.argv[1].replace("--allow-read ", "--allow-read --allow-net "); })],
    [sources, withRegistry((value, suite) => { suite.steps[0].children[0].invocation.argv[1] = suite.steps[0].children[0].invocation.argv[1].replace(TESTER_SUITE, ""); })],
    [sources, withRegistry((value, suite) => { suite.steps[0].children[0].cwd = "supabase"; })],
    [sources, withRegistry((value, suite) => { suite.steps[0].children[0].env = { SUPABASE_URL: "x" }; })],
    [sources, withRegistry((value, suite) => { suite.runtime.deno.version = "v2.x"; })],
    [sources, withRegistry((value, suite) => { suite.runtime.deno.action = "denoland/setup-deno@v1"; })],
    [sources, withRegistry((value, suite) => { suite.expectedFiles = suite.expectedFiles.filter((item) => item !== TESTER_SUITE); })],
    // [#2439 SC-19.3] The lifecycle mutant INVERTS rather than pins. Pinned to
    // "batched-historical" it was a mutant that could not fail at terminal —
    // after cutover it mutated the value to what it already is, so the clause it
    // was written to attack went green and stayed green. Inverting fires on both
    // sides of cutover: at shadow it claims terminal while the wrapper is live,
    // at terminal it claims shadow while the wrapper is gone.
    [sources, withRegistry((value, suite) => {
      suite.lifecycle = suite.lifecycle === "batched-historical" ? "shadow-active" : "batched-historical";
    })],
  ];
  const survivors = mutations.filter(([mutatedSources, mutatedRegistry]) => check(mutatedSources, mutatedRegistry).length === 0);
  if (survivors.length) {
    console.error(`issue-2019 self-test FAIL: ${survivors.length} material revert(s) escaped`);
    process.exit(1);
  }
  console.log(`issue-2019 self-test PASS (${mutations.length} mutants rejected)`);
  process.exit(0);
}

const failures = check(sources, registry);
if (failures.length) {
  console.error("issue-2019 FAIL:\n" + failures.map((item) => `  - ${item}`).join("\n"));
  process.exit(1);
}
console.log("issue-2019 PASS");
