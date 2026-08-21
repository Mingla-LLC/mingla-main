#!/usr/bin/env node
/**
 * I-PROPOSED-2148-CI-TOPOLOGY-BOUNDED (issue #2431, parent #2148).
 *
 * Ordinary work adds suites to a stable registry; it does not add another
 * issue/ORCH/META workflow wrapper. A genuinely new runtime or trust boundary
 * may add a capability-named workflow only when a commit touching that file
 * carries an explicit, issue-cited approval token.
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
const WORKFLOW_FILE = /\.ya?ml$/i;
const HISTORICAL_WRAPPER = /^(?:issue|orch|meta)-.+\.ya?ml$/i;
const APPROVAL = /(?:^|\n)CI-WORKFLOW-APPROVED #([1-9]\d*): ([^\r\n]{20,})(?=\r?$|\n)/g;
const PLACEHOLDER_REASON = /^unique runtime or trust boundary reason\.?$/i;
const ALLOWED_BOUNDARY =
  /(?:runner|operating system|\bOS\b|architecture|secret|environment authority|deploy|production operation|service container|required (?:status )?context)/i;

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

export function inspectRepository({ repoRoot = REPO_ROOT, base, head, event = {} }) {
  ensureComparisonHistory(event, base, head, repoRoot);
  const raw = git(
    ["diff", "--diff-filter=A", "--name-only", base, head, "--", WORKFLOW_PREFIX],
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
  return { addedWorkflows, touchingCommitBodies };
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
  console.log(`\nIssue #2148 CI topology self-test: ${cases.length}/${cases.length} PASS.`);
}

function main() {
  try {
    const { base, head, event } = resolveComparison();
    const evidence = inspectRepository({ base, head, event });
    const failures = evaluateWorkflowTopology(evidence);
    console.log(`Issue #2148 CI topology: ${evidence.addedWorkflows.length} added workflow(s) in ${base}..${head}.`);
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
