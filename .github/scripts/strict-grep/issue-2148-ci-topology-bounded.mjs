#!/usr/bin/env node
/**
 * I-PROPOSED-2148-CI-TOPOLOGY-BOUNDED (issue #2431, parent #2148).
 *
 * Ordinary work adds suites to a stable registry; it does not add another
 * issue/ORCH/META workflow wrapper. A genuinely new runtime or trust boundary
 * may add a capability-named workflow only after its exact exception contract
 * has already landed in the base branch registry. The workflow commit must
 * then carry a token that exactly matches that pre-approved contract.
 *
 * Exit 0: no new workflow, or every new workflow has a valid capability exception.
 * Exit 1: topology policy violation.
 * Exit 2: the PR/push comparison could not be established honestly.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const WORKFLOW_PREFIX = ".github/workflows/";
const REGISTRY_PATH = ".github/ci-capability-workflows.json";
const CANONICAL_REPOSITORY = "Mingla-LLC/mingla-main";
const WORKFLOW_FILE = /\.ya?ml$/i;
const HISTORICAL_WRAPPER = /^(?:issue|orch|meta)-.+\.ya?ml$/i;
const CAPABILITY_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+\.ya?ml$/;
const APPROVAL = /(?:^|\n)CI-WORKFLOW-APPROVED #([1-9]\d*): ([^\r\n]{20,})(?=\r?$|\n)/g;
const PLACEHOLDER_REASON = /^unique runtime or trust boundary reason\.?$/i;
const ALLOWED_BOUNDARY =
  /(?:runner|operating system|\bOS\b|architecture|secret|environment authority|deploy|production operation|service container|required (?:status )?context)/i;
const CONTRACT_APPROVAL =
  /(?:^|\n)CI-WORKFLOW-APPROVED #([1-9]\d*) \[([a-z]+(?:-[a-z]+)*)\]: ([^\r\n]+)(?=\r?$|\n)/g;
const BOUNDARY_CATEGORIES = new Set([
  "runner",
  "operating-system",
  "architecture",
  "secret",
  "environment-authority",
  "deploy",
  "production-operation",
  "service-container",
  "required-context",
]);
const INVALID_RATIONALE =
  /(?:\b(?:tbd|todo|placeholder|example|dummy|fake)\b|\bn\/?a\b|convenience only|secret word|does not require|no unique boundary)/i;

function git(args, { cwd = REPO_ROOT, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return result.stdout.trim();
  if (allowFailure) return "";
  const detail = (result.stderr || result.stdout || "git command failed").trim();
  throw new Error(`git ${args.join(" ")} failed: ${detail}`);
}

export function validApproval(body) {
  const matches = [...String(body ?? "").matchAll(APPROVAL)];
  return matches.some((match) => {
    const reason = match[2].trim();
    return !PLACEHOLDER_REASON.test(reason) && ALLOWED_BOUNDARY.test(reason);
  });
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

export function validateRegistry(value, source = REGISTRY_PATH) {
  if (!exactKeys(value, ["version", "workflows"]) || value.version !== 1 || !Array.isArray(value.workflows)) {
    throw new Error(`${source}: expected exactly { version: 1, workflows: [] }`);
  }

  const paths = new Set();
  for (const [index, entry] of value.workflows.entries()) {
    const label = `${source}: workflows[${index}]`;
    if (!exactKeys(entry, ["path", "issue", "category", "rationale"])) {
      throw new Error(`${label}: expected exactly path, issue, category, and rationale`);
    }
    if (
      typeof entry.path !== "string" ||
      !entry.path.startsWith(WORKFLOW_PREFIX) ||
      !WORKFLOW_FILE.test(entry.path) ||
      path.posix.basename(entry.path) !== entry.path.slice(WORKFLOW_PREFIX.length)
    ) {
      throw new Error(`${label}: path must name one direct .github/workflows/*.yml or *.yaml file`);
    }
    if (HISTORICAL_WRAPPER.test(path.posix.basename(entry.path))) {
      throw new Error(`${label}: issue/ORCH/META wrapper paths can never be registered`);
    }
    if (!CAPABILITY_NAME.test(path.posix.basename(entry.path))) {
      throw new Error(`${label}: path is not a stable capability name`);
    }
    if (!Number.isSafeInteger(entry.issue) || entry.issue <= 0) {
      throw new Error(`${label}: issue must be a positive integer`);
    }
    if (!BOUNDARY_CATEGORIES.has(entry.category)) {
      throw new Error(`${label}: category is not one of the locked boundary categories`);
    }
    if (
      typeof entry.rationale !== "string" ||
      entry.rationale !== entry.rationale.trim() ||
      entry.rationale.length < 20 ||
      INVALID_RATIONALE.test(entry.rationale)
    ) {
      throw new Error(`${label}: rationale is missing, placeholder, contradictory, or convenience-only`);
    }
    if (paths.has(entry.path)) throw new Error(`${label}: duplicate workflow path ${entry.path}`);
    paths.add(entry.path);
  }
  return value;
}

function exactContractApproval(body, entry) {
  return [...String(body ?? "").matchAll(CONTRACT_APPROVAL)].some(
    (match) =>
      Number(match[1]) === entry.issue &&
      match[2] === entry.category &&
      match[3] === entry.rationale,
  );
}

export function evaluateCanonicalWorkflowTopology({
  addedWorkflows,
  touchingCommitBodies = {},
  baseRegistry,
}) {
  const failures = [];
  const entries = new Map(baseRegistry.workflows.map((entry) => [entry.path, entry]));
  for (const workflow of addedWorkflows) {
    const filename = path.posix.basename(workflow);
    if (HISTORICAL_WRAPPER.test(filename)) {
      failures.push(
        `${workflow}: issue/ORCH/META workflow wrappers are forbidden regardless of registry or token.`,
      );
      continue;
    }
    if (!CAPABILITY_NAME.test(filename)) {
      failures.push(`${workflow}: workflow filename is not a stable capability name.`);
      continue;
    }
    const entry = entries.get(workflow);
    if (!entry) {
      failures.push(`${workflow}: no exact pre-approved exception exists in the BASE registry.`);
      continue;
    }
    const bodies = touchingCommitBodies[workflow] ?? [];
    if (!bodies.some((body) => exactContractApproval(body, entry))) {
      failures.push(
        `${workflow}: no touching commit has an issue, category, and rationale exactly matching the BASE registry entry.`,
      );
    }
  }
  return failures;
}

export function evaluateWorkflowTopology({ addedWorkflows, touchingCommitBodies = {} }) {
  const failures = [];
  for (const workflow of addedWorkflows) {
    const filename = path.posix.basename(workflow);
    if (HISTORICAL_WRAPPER.test(filename)) {
      failures.push(
        `${workflow}: issue/ORCH/META workflow wrappers are forbidden even when an approval token is present. ` +
          "Register the test in the shared suite registry, or use a capability name after a reviewed SPEC exception.",
      );
      continue;
    }

    const bodies = touchingCommitBodies[workflow] ?? [];
    if (!bodies.some(validApproval)) {
      failures.push(
        `${workflow}: new capability workflow has no valid approval token in a PR-range commit touching this file. ` +
          "Required form: CI-WORKFLOW-APPROVED #<issue>: <20+ character runner/runtime/trust-boundary reason>.",
      );
    }
  }
  return failures;
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot parse GITHUB_EVENT_PATH ${eventPath}: ${error.message}`);
  }
}

function ensureComparisonHistory(event, base, head, repoRoot = REPO_ROOT) {
  if (git(["merge-base", base, head], { cwd: repoRoot, allowFailure: true })) return;

  const refspecs = [];
  if (event.pull_request?.number) {
    refspecs.push(
      `+refs/pull/${event.pull_request.number}/head:refs/remotes/origin/pull/${event.pull_request.number}/head`,
    );
  }
  if (event.pull_request?.base?.ref) {
    refspecs.push(
      `+refs/heads/${event.pull_request.base.ref}:refs/remotes/origin/${event.pull_request.base.ref}`,
    );
  } else if (event.ref?.startsWith("refs/heads/")) {
    const branch = event.ref.slice("refs/heads/".length);
    refspecs.push(`+refs/heads/${branch}:refs/remotes/origin/${branch}`);
  }

  if (refspecs.length) {
    git(["fetch", "--no-tags", "--filter=blob:none", "--depth=1024", "origin", ...refspecs], {
      cwd: repoRoot,
    });
  }
  if (!git(["merge-base", base, head], { cwd: repoRoot, allowFailure: true })) {
    throw new Error(
      `cannot establish a complete comparison history for ${base}..${head}; refusing a vacuous green`,
    );
  }
}

export function resolveComparison({ argv = process.argv.slice(2), event = readEvent() } = {}) {
  const baseIndex = argv.indexOf("--base");
  const headIndex = argv.indexOf("--head");
  const explicitBase = baseIndex >= 0 ? argv[baseIndex + 1] : "";
  const explicitHead = headIndex >= 0 ? argv[headIndex + 1] : "";
  const base =
    explicitBase ||
    process.env.CI_TOPOLOGY_BASE_SHA ||
    event.pull_request?.base?.sha ||
    (event.before && !/^0+$/.test(event.before) ? event.before : "") ||
    "origin/main";
  const head =
    explicitHead ||
    process.env.CI_TOPOLOGY_HEAD_SHA ||
    event.pull_request?.head?.sha ||
    event.after ||
    "HEAD";
  return { base, head, event };
}

export function canonicalRepositoryMode(repoRoot = REPO_ROOT, environment = process.env) {
  const environmentRepository = environment.GITHUB_REPOSITORY || "";
  const workspace = environment.GITHUB_WORKSPACE || "";
  const origin = git(["remote", "get-url", "origin"], { cwd: repoRoot, allowFailure: true });
  const canonicalOrigin = /(?:github\.com[/:])Mingla-LLC\/mingla-main(?:\.git)?$/i.test(origin);
  const environmentCanonical = environmentRepository.toLowerCase() === CANONICAL_REPOSITORY.toLowerCase();

  if (workspace) {
    let realWorkspace;
    let realRepoRoot;
    try {
      realWorkspace = fs.realpathSync(workspace);
      realRepoRoot = fs.realpathSync(repoRoot);
    } catch (error) {
      throw new Error(`cannot establish real GitHub workspace identity: ${error.message}`);
    }
    if (realWorkspace !== realRepoRoot) return "noncanonical-fixture";
  } else if (environment.GITHUB_ACTIONS === "true") {
    throw new Error("GITHUB_WORKSPACE is missing in CI; refusing ambiguous repository identity");
  }

  if (workspace && environmentRepository && environmentCanonical !== canonicalOrigin && origin) {
    throw new Error(
      `ambiguous repository identity: GITHUB_REPOSITORY=${environmentRepository}, origin=${origin}`,
    );
  }
  if ((workspace && environmentCanonical) || canonicalOrigin) return "canonical";
  if (environment.GITHUB_ACTIONS === "true" && !environmentRepository && !origin) {
    throw new Error("ambiguous repository identity in CI; refusing the noncanonical fixture path");
  }
  return "noncanonical-fixture";
}

function registryAt(repoRoot, revision, required) {
  const raw = git(["show", `${revision}:${REGISTRY_PATH}`], { cwd: repoRoot, allowFailure: true });
  if (!raw) {
    if (required) throw new Error(`${REGISTRY_PATH} is missing at ${revision}`);
    return null;
  }
  try {
    return validateRegistry(JSON.parse(raw), `${revision}:${REGISTRY_PATH}`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${revision}:${REGISTRY_PATH}: invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

export function inspectRepository({ repoRoot = REPO_ROOT, base, head, event = {} }) {
  ensureComparisonHistory(event, base, head, repoRoot);
  // Issue #2681: THREE dots, deliberately. `git diff A B` compares two tips;
  // `git diff A...B` compares the MERGE BASE of A and B against B — the same
  // question `git log A..B` below already asks when it attributes tokens.
  // With two dots a branch cut before a workflow was deleted on the base branch
  // is reported as having ADDED that file (nine phantom violations on PR #2677),
  // and, in the other direction, a workflow added at a path the base branch
  // already has is invisible to --diff-filter=A and passes. ensureComparisonHistory
  // above has already proven the merge base is computable or exited 2, so this
  // adds no history requirement. Do NOT "simplify" this back to two dots.
  const raw = git(
    ["diff", "--diff-filter=A", "--name-only", `${base}...${head}`, "--", WORKFLOW_PREFIX],
    { cwd: repoRoot },
  );
  const addedWorkflows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((file) => file.startsWith(WORKFLOW_PREFIX) && WORKFLOW_FILE.test(file));

  const touchingCommitBodies = {};
  for (const workflow of addedWorkflows) {
    const bodies = git(
      ["log", "--format=%B%x00", `${base}..${head}`, "--", workflow],
      { cwd: repoRoot },
    );
    touchingCommitBodies[workflow] = bodies.split("\0").filter(Boolean);
  }
  const repositoryMode = canonicalRepositoryMode(repoRoot);
  if (repositoryMode === "canonical") {
    const headRegistry = registryAt(repoRoot, head, true);
    const baseRegistry = registryAt(repoRoot, base, addedWorkflows.length > 0);
    return { addedWorkflows, touchingCommitBodies, repositoryMode, baseRegistry, headRegistry };
  }
  return { addedWorkflows, touchingCommitBodies, repositoryMode };
}

function selfTest() {
  const capability = ".github/workflows/business-web-build.yml";
  const issue = ".github/workflows/issue-9999-tests.yml";
  const cases = [
    {
      name: "no workflow additions pass",
      input: { addedWorkflows: [] },
      failures: 0,
    },
    {
      name: "issue wrapper fails without a token",
      input: { addedWorkflows: [issue] },
      failures: 1,
    },
    {
      name: "issue wrapper still fails with an otherwise valid token",
      input: {
        addedWorkflows: [issue],
        touchingCommitBodies: {
          [issue]: ["CI-WORKFLOW-APPROVED #9999: required status context cannot be supplied by an existing lane"],
        },
      },
      failures: 1,
    },
    {
      name: "ORCH/META and yaml spelling cannot bypass the prefix rule",
      input: { addedWorkflows: [
        ".github/workflows/ORCH-9999-tests.yaml",
        ".github/workflows/meta-9999-tests.yml",
      ] },
      failures: 2,
    },
    {
      name: "capability workflow without approval fails",
      input: { addedWorkflows: [capability] },
      failures: 1,
    },
    {
      name: "malformed and placeholder approvals fail",
      input: {
        addedWorkflows: [capability],
        touchingCommitBodies: {
          [capability]: [
            "CI-WORKFLOW-APPROVED 9999: required status context cannot be supplied elsewhere",
            "CI-WORKFLOW-APPROVED #09999: deployment production operation is isolated",
            "CI-WORKFLOW-APPROVED #9999: unique runtime or trust boundary reason",
          ],
        },
      },
      failures: 1,
    },
    {
      name: "approval on an unrelated file does not authorize the workflow",
      input: {
        addedWorkflows: [capability],
        touchingCommitBodies: {
          ".github/workflows/another-capability.yml": [
            "CI-WORKFLOW-APPROVED #9999: service container cannot be expressed by an existing profile",
          ],
        },
      },
      failures: 1,
    },
    {
      name: "valid capability exception passes",
      input: {
        addedWorkflows: [capability],
        touchingCommitBodies: {
          [capability]: [
            "CI-WORKFLOW-APPROVED #9999: required status context cannot be supplied by an existing stable workflow",
          ],
        },
      },
      failures: 0,
    },
    {
      name: "deletion and modification-only diffs pass because they are not additions",
      input: { addedWorkflows: [] },
      failures: 0,
    },
  ];

  let failed = 0;
  for (const testCase of cases) {
    const failures = evaluateWorkflowTopology(testCase.input);
    const ok = failures.length === testCase.failures;
    console.log(`${ok ? "ok  " : "FAIL"}  ${testCase.name}`);
    if (!ok) {
      failed += 1;
      console.log(`      expected ${testCase.failures} failure(s), saw ${failures.length}:`);
      for (const failure of failures) console.log(`      - ${failure}`);
    }
  }
  if (failed) {
    console.error(`\nIssue #2148 CI topology self-test FAILED: ${failed}/${cases.length} cases.`);
    process.exit(1);
  }

  const approved = {
    path: capability,
    issue: 2431,
    category: "required-context",
    rationale: "required status context cannot be supplied by an existing stable workflow",
  };
  const registry = { version: 1, workflows: [approved] };
  const exactToken =
    "CI-WORKFLOW-APPROVED #2431 [required-context]: required status context cannot be supplied by an existing stable workflow";
  const canonicalCases = [
    {
      name: "exact pre-merged contract and attributed token pass",
      registry,
      workflow: capability,
      bodies: [exactToken],
      failures: 0,
    },
    {
      name: "fabricated issue without a base entry fails",
      registry: { version: 1, workflows: [] },
      workflow: capability,
      bodies: ["CI-WORKFLOW-APPROVED #999999999 [secret]: secret word included only to fool the parser"],
      failures: 1,
    },
    {
      name: "keyword stuffing and convenience-only prose fail",
      registry: { version: 1, workflows: [] },
      workflow: capability,
      bodies: ["CI-WORKFLOW-APPROVED #1 [runner]: ordinary test runner convenience only; no unique boundary exists"],
      failures: 1,
    },
    {
      name: "explicit negation fails",
      registry: { version: 1, workflows: [] },
      workflow: capability,
      bodies: ["CI-WORKFLOW-APPROVED #2431 [required-context]: this does not require a required status context at all"],
      failures: 1,
    },
    ...["path", "issue", "category", "rationale"].map((field) => {
      const changed = { ...approved };
      if (field === "path") changed.path = ".github/workflows/another-capability.yml";
      if (field === "issue") changed.issue = 2432;
      if (field === "category") changed.category = "runner";
      if (field === "rationale") changed.rationale = "a different pre-approved rationale that is sufficiently detailed";
      return {
        name: `${field} mismatch fails`,
        registry: { version: 1, workflows: [changed] },
        workflow: capability,
        bodies: [exactToken],
        failures: 1,
      };
    }),
    {
      name: "issue wrapper remains forbidden with registry and token",
      registry: { version: 1, workflows: [] },
      workflow: issue,
      bodies: [exactToken],
      failures: 1,
    },
  ];

  for (const testCase of canonicalCases) {
    const failures = evaluateCanonicalWorkflowTopology({
      addedWorkflows: [testCase.workflow],
      touchingCommitBodies: { [testCase.workflow]: testCase.bodies },
      baseRegistry: testCase.registry,
    });
    const ok = failures.length === testCase.failures;
    console.log(`${ok ? "ok  " : "FAIL"}  ${testCase.name}`);
    if (!ok) failed += 1;
  }

  const invalidRegistries = [
    { name: "duplicate registry paths fail", value: { version: 1, workflows: [approved, approved] } },
    { name: "malformed registry entries fail", value: { version: 1, workflows: [{ path: capability }] } },
    {
      name: "contradictory registry rationale fails",
      value: { version: 1, workflows: [{ ...approved, rationale: "runner convenience only; no unique boundary exists" }] },
    },
  ];
  for (const testCase of invalidRegistries) {
    let rejected = false;
    try {
      validateRegistry(testCase.value, "self-test registry");
    } catch {
      rejected = true;
    }
    console.log(`${rejected ? "ok  " : "FAIL"}  ${testCase.name}`);
    if (!rejected) failed += 1;
  }

  const identityRoot = fs.mkdtempSync(path.join(process.cwd(), ".issue-2431-identity-"));
  const nestedFixture = path.join(identityRoot, "nested-fixture");
  const workspaceAlias = `${identityRoot}-alias`;
  fs.mkdirSync(nestedFixture);
  fs.symlinkSync(identityRoot, workspaceAlias);
  const canonicalEnvironment = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: CANONICAL_REPOSITORY,
    GITHUB_WORKSPACE: workspaceAlias,
  };
  const identityCases = [];
  try {
    identityCases.push({
      name: "the realpath GitHub workspace is canonical",
      passed: canonicalRepositoryMode(identityRoot, canonicalEnvironment) === "canonical",
    });
    identityCases.push({
      name: "a nested fixture inheriting canonical CI variables remains noncanonical",
      passed: canonicalRepositoryMode(nestedFixture, canonicalEnvironment) === "noncanonical-fixture",
    });

    git(["init", "-q"], { cwd: identityRoot });
    git(["remote", "add", "origin", "https://github.com/not-mingla/not-mingla.git"], { cwd: identityRoot });
    let conflictRejected = false;
    try {
      canonicalRepositoryMode(identityRoot, canonicalEnvironment);
    } catch (error) {
      conflictRejected = /ambiguous repository identity/.test(error.message);
    }
    identityCases.push({
      name: "canonical workspace environment conflicting with origin is inconclusive",
      passed: conflictRejected,
    });

    let missingWorkspaceRejected = false;
    try {
      canonicalRepositoryMode(nestedFixture, {
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: CANONICAL_REPOSITORY,
      });
    } catch (error) {
      missingWorkspaceRejected = /GITHUB_WORKSPACE is missing in CI/.test(error.message);
    }
    identityCases.push({
      name: "canonical CI environment without a workspace fails closed",
      passed: missingWorkspaceRejected,
    });
  } finally {
    fs.rmSync(workspaceAlias, { force: true });
    fs.rmSync(identityRoot, { recursive: true, force: true });
  }
  for (const testCase of identityCases) {
    console.log(`${testCase.passed ? "ok  " : "FAIL"}  ${testCase.name}`);
    if (!testCase.passed) failed += 1;
  }

  const total = cases.length + canonicalCases.length + invalidRegistries.length + identityCases.length;
  if (failed) {
    console.error(`\nIssue #2148 CI topology self-test FAILED: ${failed}/${total} cases.`);
    process.exit(1);
  }
  console.log(`\nIssue #2148 CI topology self-test: ${total}/${total} PASS.`);
}

function main() {
  try {
    const { base, head, event } = resolveComparison();
    const evidence = inspectRepository({ base, head, event });
    const failures = evidence.repositoryMode === "canonical"
      ? evaluateCanonicalWorkflowTopology({
          addedWorkflows: evidence.addedWorkflows,
          touchingCommitBodies: evidence.touchingCommitBodies,
          baseRegistry: evidence.baseRegistry ?? { version: 1, workflows: [] },
        })
      : evaluateWorkflowTopology(evidence);
    console.log(`Issue #2148 CI topology: ${evidence.addedWorkflows.length} added workflow(s) in ${base}..${head}.`);
    console.log(`Issue #2148 CI topology authority: ${evidence.repositoryMode}.`);
    if (failures.length) {
      console.error(`\nI-PROPOSED-2148-CI-TOPOLOGY-BOUNDED FAILED — ${failures.length} violation(s):`);
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exit(1);
    }
    console.log("I-PROPOSED-2148-CI-TOPOLOGY-BOUNDED: PASS.");
  } catch (error) {
    console.error(`I-PROPOSED-2148-CI-TOPOLOGY-BOUNDED INCONCLUSIVE: ${error.message}`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
