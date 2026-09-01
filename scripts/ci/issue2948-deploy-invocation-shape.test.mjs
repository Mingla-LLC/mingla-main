#!/usr/bin/env node
/**
 * Issue #2948 — a workflow may not invoke the edge-deploy wrapper in a shape the
 * wrapper forbids, and a failed deploy may not stay silent.
 *
 * The 2026-09-01 06:48 breakage was not a bad deploy. It was a caller that no
 * longer matched its callee: `.github/workflows/deploy-functions.yml` invoked
 * `scripts/deploy-supabase-functions.sh` bare, and #2886 had replaced the
 * wrapper's contract with explicit `--function` + `--merged-commit`. The wrapper
 * refused, correctly, and deployed nothing — and the only place that mismatch
 * could be discovered was production.
 *
 * These assertions move that discovery to CI. They deliberately EXECUTE the
 * workflow's own deploy command against a recorder rather than reading it, so a
 * revert to the bare invocation fails here instead of at the production
 * boundary. Nothing here relaxes the wrapper's guard; #1456 owns proving the
 * wrapper itself still refuses.
 */

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const workflowPath = join(repoRoot, ".github/workflows/deploy-functions.yml");
const workflow = readFileSync(workflowPath, "utf8");
const wrapperPath = "scripts/deploy-supabase-functions.sh";
const selectorPath = "scripts/ci/select-changed-edge-functions.mjs";

/**
 * Comments discuss the very shapes these assertions forbid, so every text
 * assertion reads a comment-stripped copy. Executable assertions read the raw
 * file — `runBlockFor` must return the real shell, comments included.
 */
function withoutComments(source) {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const workflowCode = withoutComments(workflow);

let failures = 0;
function check(label, run) {
  try {
    run();
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}`);
    console.error(`       ${error?.message ?? error}`);
  }
}

/**
 * Pull one step's literal `run: |` block out of the workflow. Deliberately a
 * small, exact reader rather than a YAML dependency: the repository ships no
 * YAML parser to CI and adding one to prove a five-line shell block is not a
 * trade worth making.
 */
function runBlockFor(stepName) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.includes(`- name: ${stepName}`));
  assert.notEqual(start, -1, `step not found: ${stepName}`);
  let index = start + 1;
  while (index < lines.length && !/^\s*run:\s*\|\s*$/.test(lines[index])) {
    assert.ok(
      !/^\s*-\s+name:/.test(lines[index]),
      `step "${stepName}" reached the next step before its run block`,
    );
    index += 1;
  }
  const indent = lines[index].match(/^\s*/)[0].length + 2;
  const body = [];
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  while (body.length > 0 && body.at(-1) === "") body.pop();
  return body.join("\n");
}

// ---------------------------------------------------------------------------
// 1. The workflow's own deploy command, EXECUTED against a recorder.
// ---------------------------------------------------------------------------

async function executeDeployStep(selection) {
  const root = await mkdtemp(join(tmpdir(), "mingla-2948-"));
  await mkdir(join(root, "scripts"), { recursive: true });
  const argvPath = join(root, "argv.txt");
  await writeFile(
    join(root, wrapperPath),
    `#!/usr/bin/env bash\nset -u\nprintf '%s\\n' "$@" > "${argvPath}"\n`,
  );
  await chmod(join(root, wrapperPath), 0o755);
  const selectionPath = join(root, "edge-deploy-functions");
  await writeFile(selectionPath, selection);
  const scriptPath = join(root, "step.sh");
  await writeFile(scriptPath, runBlockFor("Deploy the selected edge functions"));
  const result = spawnSync("bash", [scriptPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      MINGLA_DEPLOY_SELECTION_PATH: selectionPath,
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      SUPABASE_PROJECT_ID: "gqnoajqerqhnvulmnyvv",
    },
  });
  let argv = [];
  try {
    argv = (await readFile(argvPath, "utf8")).split("\n").filter(Boolean);
  } catch {
    argv = [];
  }
  return { result, argv };
}

const twoFunctions = await executeDeployStep("weather\nstripe-mode\n");
check("the deploy step passes an explicit --function for every selected name", () => {
  assert.equal(twoFunctions.result.status, 0, twoFunctions.result.stderr);
  assert.deepEqual(twoFunctions.argv, [
    "--merged-commit",
    "0123456789abcdef0123456789abcdef01234567",
    "--function",
    "weather",
    "--function",
    "stripe-mode",
  ]);
});

check("the deploy step never invokes the wrapper bare", () => {
  assert.ok(
    twoFunctions.argv.includes("--function"),
    "a bare invocation is the exact #2948 breakage and must not be reachable",
  );
  assert.ok(twoFunctions.argv.includes("--merged-commit"));
});

const emptySelection = await executeDeployStep("\n");
check("an empty selection file fails loudly rather than deploying nothing quietly", () => {
  assert.notEqual(
    emptySelection.result.status,
    0,
    "an empty selection reaching the deploy step is a contradiction and must be fatal",
  );
  assert.deepEqual(emptySelection.argv, []);
});

const hostile = await executeDeployStep("weather; touch /tmp/mingla-2948-pwned\n");
check("a selection value cannot become a shell command", () => {
  assert.ok(
    hostile.argv.includes("weather; touch /tmp/mingla-2948-pwned"),
    "names must arrive as one argv entry, never re-parsed by the shell",
  );
});

// ---------------------------------------------------------------------------
// 2. The selection is computed, not assumed.
// ---------------------------------------------------------------------------

check("the workflow computes its selection with the selector script", () => {
  assert.match(workflowCode, new RegExp(`node ${selectorPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(workflowCode, /MINGLA_DEPLOY_BEFORE:/);
  assert.match(workflowCode, /MINGLA_DEPLOY_SHA:/);
});

check("the checkout is deep enough to resolve the pushed range", () => {
  assert.match(
    workflowCode,
    /fetch-depth:\s*0/,
    "a shallow clone cannot diff github.event.before, and the selector fails closed on that",
  );
});

check("the selector's own self-test passes", () => {
  const result = spawnSync("node", [join(repoRoot, selectorPath), "--self-test"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /self-test: PASS/);
});

check("workflow_dispatch cannot mean deploy-all", () => {
  const dispatch = workflowCode.slice(workflowCode.indexOf("workflow_dispatch:"));
  assert.match(dispatch, /functions:/);
  assert.match(dispatch, /required:\s*true/);
});

// ---------------------------------------------------------------------------
// 3. No workflow anywhere may invoke the wrapper in a forbidden shape.
// ---------------------------------------------------------------------------

/**
 * A workflow "invokes" the wrapper when it runs it. Two look-alikes are not
 * invocations and must not be flagged: a `paths:` trigger entry naming the
 * wrapper (quoted list item), and `bash -n <wrapper>`, which is the syntax
 * check `production-supabase-authority.yml` already runs.
 */
export function invokesDeployWrapper(source) {
  const code = withoutComments(source);
  const escaped = wrapperPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const occurrence = new RegExp(escaped, "g");
  let match;
  while ((match = occurrence.exec(code)) !== null) {
    const before = code.slice(Math.max(0, match.index - 40), match.index);
    const lineStart = before.lastIndexOf("\n") + 1;
    const prefix = before.slice(lineStart);
    if (/-\s*['"]$/.test(prefix)) continue; // a paths: list entry
    if (/(?:^|\s)-n\s+$/.test(prefix)) continue; // bash -n syntax check
    return true;
  }
  return false;
}

check("every workflow that invokes the deploy wrapper names its functions", () => {
  const dir = join(repoRoot, ".github/workflows");
  const offenders = [];
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const source = readFileSync(join(dir, name), "utf8");
    if (!source.includes(wrapperPath)) continue;
    if (!invokesDeployWrapper(source)) continue;
    const code = withoutComments(source);
    if (!code.includes("--function") || !code.includes("--merged-commit")) {
      offenders.push(name);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these workflows invoke the deploy wrapper without explicit selection: " +
      offenders.join(", "),
  );
});

check("the invocation detector distinguishes a run from a trigger or a lint", () => {
  assert.equal(invokesDeployWrapper(`      - '${wrapperPath}'\n`), false);
  assert.equal(invokesDeployWrapper(`        run: bash -n ${wrapperPath}\n`), false);
  assert.equal(invokesDeployWrapper(`        run: ${wrapperPath}\n`), true);
  assert.equal(invokesDeployWrapper(`          ${wrapperPath} --function a\n`), true);
  assert.equal(invokesDeployWrapper(`# ${wrapperPath} in prose\n`), false);
});

// ---------------------------------------------------------------------------
// 4. The Supabase CLI is pinned — `latest` is a rate-limited network lookup.
// ---------------------------------------------------------------------------

check("the Supabase CLI version is pinned, not resolved at run time", () => {
  const setup = workflowCode.slice(workflowCode.indexOf("supabase/setup-cli"));
  const version = setup.match(/version:\s*([^\s#]+)/);
  assert.ok(version, "supabase/setup-cli must declare a version");
  assert.notEqual(
    version[1],
    "latest",
    "`latest` resolves through an unauthenticated GitHub release lookup and " +
      "rate-limited main red twice in three days while deploying nothing",
  );
  assert.match(version[1], /^\d+\.\d+\.\d+$/);
});

// ---------------------------------------------------------------------------
// 5. A failed deploy reaches a human, from inside the same run.
// ---------------------------------------------------------------------------

check("a failed deploy alerts a human deterministically", () => {
  const alert = workflowCode.slice(workflowCode.indexOf("\n  alert:"));
  assert.ok(alert.length > 0, "the alert job must exist");
  assert.match(alert, /needs:\s*deploy/, "the alert must be threaded to the deploy job");
  assert.match(
    alert,
    /if:\s*always\(\)\s*&&\s*needs\.deploy\.result\s*!=\s*'success'/,
    "always() is what makes the alert reachable when the deploy fails or is cancelled",
  );
  assert.match(alert, /issues:\s*write/, "the alert cannot post without issues: write");
  assert.match(alert, /EDGE_DEPLOY_ALERT/, "the alert must carry a greppable code");
  assert.match(alert, /issues\/\$\{MINGLA_EDGE_DEPLOY_ALERT_ISSUE\}\/comments/);
  assert.match(
    workflowCode,
    /MINGLA_EDGE_DEPLOY_ALERT_ISSUE:\s*'\d+'/,
    "the alert must name the thread it escalates to",
  );
});

check("the alert is not conditioned away on any event", () => {
  const alert = workflowCode.slice(workflowCode.indexOf("\n  alert:"));
  assert.doesNotMatch(
    alert,
    /github\.event_name\s*==/,
    "a deploy failure is worth telling a human about however the deploy started",
  );
});

if (failures > 0) {
  console.error(`\nissue #2948 deploy invocation shape: ${failures} FAILED`);
  process.exit(1);
}
console.log("\nissue #2948 deploy invocation shape: PASS");
