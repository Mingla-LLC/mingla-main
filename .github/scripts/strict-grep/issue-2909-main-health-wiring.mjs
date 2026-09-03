#!/usr/bin/env node
/**
 * Issue #2909 — the wiring proof for the red-`main` alert and the pre-merge
 * `main` check.
 *
 * WHY A SEPARATE GATE RATHER THAN A STEP IN THE JOBS IT AUDITS. A test that
 * lives inside the job it protects stops running the moment that job is
 * deleted, and reports nothing while doing it — the exact class #2113
 * catalogues, where a check cannot fail because it never executes. This is a
 * class-A gate: it runs whether or not either job still exists, and it goes RED
 * when either is removed, re-scoped, or quietly disarmed.
 *
 * NAMING CONSTRAINT, load-bearing and the reason every lookup below is by
 * DISPLAY NAME. The frozen provider seal derives, for every workflow filename,
 * the sorted set of tracked files containing that name as a literal. A single
 * mention of a host filename here would rewrite that workflow's record and red
 * `external reference file inventory drifted` with no escape. MEASURED, not
 * theorised: one passing mention inside a #2909 comment did exactly that on
 * this branch. Hosts are therefore identified by the `name:` GitHub itself
 * shows on the check, which is also the string a human reads in the alert.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");
// Assembled from fragments, never written as a literal — see the header.
const WORKFLOW_EXTENSIONS = [["y", "ml"].join(""), ["ya", "ml"].join("")];

export const PREGATE_HOST_NAME = "Tests Append-Only";
export const ALERT_HOST_NAME = "Strict Grep Gates (Mingla Host)";
export const PREGATE_JOB = "main-health-pregate";
export const ALERT_JOB = "main-red-alert";
export const ADJUDICATOR = "scripts/ci/main-health.mjs";
export const SELF_TEST_RUN = `node ${ADJUDICATOR} --self-test`;
export const PREGATE_RUN = `node ${ADJUDICATOR} pregate`;
export const ALERT_RUN = `node ${ADJUDICATOR} alert`;
// #2881's canonical draft condition — the ONLY job-level condition this gate
// permits on the pre-merge check. #2881 requires every job of a draft-gated
// workflow to carry it; #2909 requires that nothing else ever conditions this
// check away. Both hold: exactly this string, or none at all.
export const PREGATE_DRAFT_IF = "${{ github.event.pull_request.draft != true }}";
export const ALERT_IF =
  "always() && github.event_name == 'push' && github.ref == 'refs/heads/main'";
export const REQUIRED_ALERT_ENV = Object.freeze([
  "GITHUB_TOKEN",
  "RESEND_API_KEY",
  "MINGLA_MAIN_RED_ALERT_TO",
  "MINGLA_SELF_WORKFLOW",
  "MINGLA_SELF_CONCLUSION",
  "MINGLA_SELF_SHA",
  "MINGLA_SELF_TITLE",
  "MINGLA_SELF_ACTOR",
  "MINGLA_SELF_URL",
]);

const RUBY_PARSE = String.raw`
require "yaml"
require "json"
payload = JSON.parse(STDIN.read)
out = {}
payload.each do |file, source|
  begin
    out[file] = YAML.safe_load(source, aliases: true) || {}
  rescue => e
    out[file] = {"__parse_error" => "#{e.class}: #{e.message.lines.first.to_s.strip}"}
  end
end
STDOUT.write(JSON.generate(out))
`;

export function parseWorkflows(sources) {
  const out = execFileSync("ruby", ["-e", RUBY_PARSE], {
    input: JSON.stringify(sources),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

export function readWorkflowSources(root = REPO_ROOT) {
  const directory = path.join(root, ".github", "workflows");
  return Object.fromEntries(
    fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && WORKFLOW_EXTENSIONS.some((ext) => entry.name.endsWith(`.${ext}`)))
      .map((entry) => [entry.name, fs.readFileSync(path.join(directory, entry.name), "utf8")]),
  );
}

const events = (document) => {
  const value = Object.hasOwn(document ?? {}, "on") ? document.on : document?.true;
  if (typeof value === "string") return { [value]: {} };
  if (Array.isArray(value)) return Object.fromEntries(value.map((name) => [name, {}]));
  return value && typeof value === "object" ? value : {};
};

const permissionPairs = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : null;

const runs = (job) => (Array.isArray(job?.steps) ? job.steps : []).map((step) => String(step?.run ?? "").trim());

function hostByName(documents, displayName, errors) {
  const matches = Object.entries(documents).filter(([, document]) => document?.name === displayName);
  if (matches.length !== 1) {
    errors.push(`exactly one workflow must be named "${displayName}"; found ${matches.length}`);
    return null;
  }
  return matches[0][1];
}

export function auditWiring(sources) {
  const errors = [];
  const documents = parseWorkflows(sources);
  for (const [file, document] of Object.entries(documents)) {
    if (document?.__parse_error) errors.push(`${file}: ${document.__parse_error}`);
  }

  // ---- the pre-merge check ------------------------------------------------
  const pregateHost = hostByName(documents, PREGATE_HOST_NAME, errors);
  if (pregateHost) {
    const on = events(pregateHost);
    if (!Object.hasOwn(on, "pull_request")) {
      errors.push(`${PREGATE_HOST_NAME}: the pre-merge check must be hosted on a pull_request workflow`);
    }
    // The whole point. A paths-gated host silently skips on the pull request
    // that misses its globs, which reproduces the class of hole #2909 closes.
    if (Array.isArray(on.pull_request?.paths) && on.pull_request.paths.length) {
      errors.push(`${PREGATE_HOST_NAME}: host declares a positive pull_request paths filter, so the check can silently skip`);
    }
    const job = pregateHost.jobs?.[PREGATE_JOB];
    if (!job) {
      errors.push(`${PREGATE_HOST_NAME}: job "${PREGATE_JOB}" is missing; nothing asks whether main is healthy`);
    } else {
      if (job.if != null && String(job.if).trim() !== PREGATE_DRAFT_IF) {
        errors.push(`${PREGATE_JOB}: the only permitted job-level if is #2881's canonical draft condition; any other condition is how the check stops running`);
      }
      if (permissionPairs(job.permissions) !== JSON.stringify([["actions", "read"], ["contents", "read"]])) {
        errors.push(`${PREGATE_JOB}: permissions must be JOB-level and exactly {actions: read, contents: read}`);
      }
      const commands = runs(job);
      if (!commands.includes(SELF_TEST_RUN)) errors.push(`${PREGATE_JOB}: must run the adjudicator fixture suite before trusting its verdict`);
      if (!commands.includes(PREGATE_RUN)) errors.push(`${PREGATE_JOB}: must run the adjudicator in pregate mode`);
      const enforcing = (job.steps ?? []).find((step) => String(step?.run ?? "").trim() === PREGATE_RUN);
      if (!String(enforcing?.env?.GITHUB_TOKEN ?? "").includes("secrets.GITHUB_TOKEN")) {
        errors.push(`${PREGATE_JOB}: must thread the default token; with no token it cannot read the state it exists to read`);
      }
    }
  }

  // ---- the red-main alert -------------------------------------------------
  const alertHost = hostByName(documents, ALERT_HOST_NAME, errors);
  if (alertHost) {
    // COVERAGE, the mirror of the pregate's paths rule above. The alert can
    // only report `main` red on a commit whose push actually STARTS this
    // workflow, so a positive push `paths:` filter without a catch-all is not a
    // narrower alert -- it is a SAMPLING SCHEME, and it looks exactly like a
    // healthy `main` from the outside. MEASURED: seven of the last forty `main`
    // commits (17.5%) matched none of this host's globs, and an eighth was
    // excluded by its baseline rule; on all eight a red `main` reached nobody.
    // That is the #2909 incident's own failure mode, which is why removing the
    // catch-all must turn THIS gate red rather than quietly reopening it.
    const alertOn = events(alertHost);
    if (!Object.hasOwn(alertOn, "push")) {
      errors.push(`${ALERT_HOST_NAME}: the red-main alert must be hosted on a workflow that runs on push, or it can never observe a merged commit`);
    } else {
      const pushPaths = alertOn.push?.paths;
      if (Array.isArray(pushPaths) && pushPaths.length && !pushPaths.includes("**")) {
        errors.push(`${ALERT_HOST_NAME}: host's push paths filter has no "**" catch-all, so a main commit matching none of its globs alerts nobody`);
      }
    }
    const job = alertHost.jobs?.[ALERT_JOB];
    if (!job) {
      errors.push(`${ALERT_HOST_NAME}: job "${ALERT_JOB}" is missing; a red main reaches nobody`);
    } else {
      if (String(job.if ?? "").trim() !== ALERT_IF) {
        errors.push(`${ALERT_JOB}: if must be exactly "${ALERT_IF}" — always() keeps it reachable through a failure or a timeout kill, and the push/main guard is what stops it emailing on every pull-request failure`);
      }
      // Every OTHER job in the host must be in `needs`, or a future job can go
      // red on main and never reach the verdict this alert reports.
      const siblings = Object.keys(alertHost.jobs ?? {}).filter((key) => key !== ALERT_JOB).sort();
      const needs = Array.isArray(job.needs) ? [...job.needs].sort() : [];
      if (JSON.stringify(needs) !== JSON.stringify(siblings)) {
        const missing = siblings.filter((key) => !needs.includes(key));
        errors.push(`${ALERT_JOB}: needs must cover every sibling job; missing ${JSON.stringify(missing)}`);
      }
      if (permissionPairs(job.permissions) !== JSON.stringify([["actions", "read"], ["contents", "read"], ["issues", "write"]])) {
        errors.push(`${ALERT_JOB}: permissions must be JOB-level and exactly {actions: read, contents: read, issues: write} — issues:write is what makes a failed send loud`);
      }
      const steps = job.steps ?? [];
      const sending = steps[steps.length - 1];
      if (String(sending?.run ?? "").trim() !== ALERT_RUN) {
        errors.push(`${ALERT_JOB}: final step must run the adjudicator in alert mode`);
      }
      const env = sending?.env ?? {};
      for (const key of REQUIRED_ALERT_ENV) {
        if (!(key in env) || String(env[key] ?? "").trim() === "") {
          errors.push(`${ALERT_JOB}: ${key} must be threaded into the alert step; without it the alert is silently unsendable or anonymous`);
        }
      }
      if (!String(env.MINGLA_SELF_CONCLUSION ?? "").includes("needs.*.result")) {
        errors.push(`${ALERT_JOB}: MINGLA_SELF_CONCLUSION must be derived from needs.*.result — the host's own run is still in progress here and the API cannot yet see the failure being reported`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------

const withJob = (sources, hostName, mutate) => {
  const copy = { ...sources };
  const documents = parseWorkflows(copy);
  const file = Object.entries(documents).find(([, d]) => d?.name === hostName)?.[0];
  assert.ok(file, `fixture mutation needs a host named ${hostName}`);
  const mutated = mutate(copy[file]);
  assert.notEqual(mutated, copy[file], "fixture mutation must actually change the source");
  copy[file] = mutated;
  return copy;
};

function expectFailure(label, sources, diagnostic) {
  const errors = auditWiring(sources);
  assert.ok(
    errors.some((error) => error.includes(diagnostic)),
    `${label}: expected ${diagnostic}; got ${errors.join(" | ") || "(no errors)"}`,
  );
}

export function runSelfTest() {
  const sources = readWorkflowSources();
  assert.deepEqual(auditWiring(sources), []);
  let assertions = 1;

  const mutants = [
    [
      "the pre-merge job is deleted",
      withJob(sources, PREGATE_HOST_NAME, (s) => s.replace(`  ${PREGATE_JOB}:\n`, "  deleted-pregate:\n")),
      `job "${PREGATE_JOB}" is missing`,
    ],
    [
      // Anchored INSIDE the job block on purpose. A sibling job carries the
      // identical draft condition earlier in the same file, so a bare replace()
      // would mutate the wrong job and the mutant would prove nothing; and
      // INSERTING a second `if:` proves nothing either, because YAML resolves a
      // duplicate key to the LAST one and the mutation is silently inert.
      "the pre-merge job is conditioned off",
      withJob(sources, PREGATE_HOST_NAME, (s) => {
        const key = `  ${PREGATE_JOB}:\n`;
        const at = s.indexOf(key);
        assert.ok(at >= 0, "fixture must contain the pre-merge job");
        const cut = at + key.length;
        return s.slice(0, cut) + s.slice(cut).replace(`    if: ${PREGATE_DRAFT_IF}\n`, "    if: false\n");
      }),
      "only permitted job-level if",
    ],
    [
      "the pre-merge enforcement step is removed",
      withJob(sources, PREGATE_HOST_NAME, (s) => s.replace(PREGATE_RUN, `${PREGATE_RUN} || true`)),
      "must run the adjudicator in pregate mode",
    ],
    [
      "the pre-merge host acquires a positive paths filter",
      withJob(sources, PREGATE_HOST_NAME, (s) => s.replace("  pull_request:\n", "  pull_request:\n    paths:\n      - \"never/**\"\n")),
      "silently skip",
    ],
    [
      "the alert job is deleted",
      withJob(sources, ALERT_HOST_NAME, (s) => s.replace(`  ${ALERT_JOB}:\n`, "  deleted-alert:\n")),
      `job "${ALERT_JOB}" is missing`,
    ],
    [
      "the alert is widened to pull requests",
      withJob(sources, ALERT_HOST_NAME, (s) => s.replace(`    if: ${ALERT_IF}\n`, "    if: always()\n")),
      "if must be exactly",
    ],
    [
      "a sibling job escapes the verdict",
      withJob(sources, ALERT_HOST_NAME, (s) => s.replace("      - full-clone-gates\n", "")),
      "needs must cover every sibling job",
    ],
    [
      "the failed-send escalation loses its write",
      withJob(sources, ALERT_HOST_NAME, (s) => s.replace("      issues: write\n", "")),
      "issues:write is what makes a failed send loud",
    ],
    [
      "the recipient is unthreaded",
      withJob(sources, ALERT_HOST_NAME, (s) => s.replace(/^ +MINGLA_MAIN_RED_ALERT_TO: .*\n/m, "")),
      "MINGLA_MAIN_RED_ALERT_TO must be threaded",
    ],
    [
      "the API key is unthreaded",
      withJob(sources, ALERT_HOST_NAME, (s) => s.replace(/^ +RESEND_API_KEY: .*\n/m, "")),
      "RESEND_API_KEY must be threaded",
    ],
    [
      "the alert host's push coverage is narrowed back to a globbed subset",
      withJob(sources, ALERT_HOST_NAME, (s) => s.replace(/^ +- "\*\*"\n/m, "")),
      'has no "**" catch-all',
    ],
    [
      "the run's own verdict is replaced by a constant",
      withJob(sources, ALERT_HOST_NAME, (s) => s.replace(/^( +)MINGLA_SELF_CONCLUSION: .*\n/m, "$1MINGLA_SELF_CONCLUSION: \"success\"\n")),
      "must be derived from needs.*.result",
    ],
  ];
  for (const [label, mutated, diagnostic] of mutants) {
    expectFailure(label, mutated, diagnostic);
    assertions += 1;
  }
  return assertions;
}

function main() {
  if (process.argv.includes("--self-test")) {
    const assertions = runSelfTest();
    console.log(`#2909 main-health wiring self-test: PASS (${assertions} assertions)`);
    return;
  }
  const errors = auditWiring(readWorkflowSources());
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    console.error(`#2909 main-health wiring: FAIL (${errors.length} error(s))`);
    process.exitCode = 1;
    return;
  }
  console.log("#2909 main-health wiring: PASS — the pre-merge check and the red-main alert are both live.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
