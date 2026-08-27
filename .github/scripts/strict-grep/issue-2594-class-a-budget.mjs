#!/usr/bin/env node

/**
 * I-PROPOSED-2594-CLASS-A-BUDGET-ADJUDICATED (issue #2594, SPEC Part 2).
 *
 * Adjudicates the class-A static-gates job against the A7-SC1(1) elapsed-time
 * bound (600 s) from OUTSIDE the job it measures.
 *
 * # Why this lives out-of-band
 *
 * Amendment 7 A7-SC4 forbids a wall-clock / `performance.now()` / elapsed-
 * millisecond threshold INSIDE any gate, and a gate that polices class A's
 * runtime from inside class A adds load to the very job it polices. Worse: the
 * one mechanism that does fire today — the `timeout-minutes` kill — terminates
 * the job before any step OF ITS OWN can report, so an in-job final step cannot
 * observe the case that matters most.
 *
 * The adjudication therefore runs in a sibling job that declares
 * `needs: [static-gates]` with `if: always()`, and reads the class-A job's own
 * `completed_at - started_at` back from the Actions API after it concludes. It
 * consumes ZERO seconds of the 600 s budget, because that budget is measured on
 * class A's own timestamps.
 *
 * # This module names no workflow file, deliberately
 *
 * `discoverWorkflowProviders()` in `.github/scripts/ci-batch/validate-manifest-v2.mjs`
 * derives, for every workflow filename, the sorted set of tracked source files
 * that contain that filename as a literal, and hashes the whole structure
 * against a FROZEN seal. The host workflow's record is inside that seal and has
 * no declared-mutation mechanism, so a single occurrence of its filename in this
 * file — even inside a comment — would add this file to that record and turn the
 * seal RED with no declared escape (SPEC rule R-P2, SC-5).
 *
 * The class-A job's display name therefore arrives from the environment, via
 * `CLASS_A_JOB_NAME`, and this file contains no workflow filename and no
 * workflow file extension of any kind. `grep -c '\.ya\?ml'` over this file must
 * report 0.
 *
 * # Modes
 *
 *   --self-test   drives the whole decision table against in-file fixtures.
 *                 Registered `batch:A`, so it runs on every PR. Pure CPU: no
 *                 network, no filesystem walk, no repository-corpus scan.
 *   --enforce     the sibling job's entry point. Two snapshot REST reads, no
 *                 polling, no pagination beyond per_page=100.
 *
 * # The decision table (SPEC D1-3)
 *
 *   D0  no job matches CLASS_A_JOB_NAME                     INCONCLUSIVE  exit 2
 *   D1  class A not completed / no usable timestamps        INCONCLUSIVE  exit 2
 *   D2  class A concluded `failure`                         PASS-THROUGH  exit 0
 *   D3  `success` and dur >  bound                          FAIL          exit 1
 *   D4  `success` and dur <= bound                          PASS          exit 0
 *   D5  `cancelled` + run cancelled OR simultaneous peers    NEUTRAL       exit 0
 *   D6  `cancelled`, no cancelled peer, dur >= kill floor   FAIL          exit 1
 *   D7  `cancelled`, no cancelled peer, dur <  kill floor   INCONCLUSIVE  exit 2
 *   D8  anything the rows above do not classify             INCONCLUSIVE  exit 2
 *
 * INCONCLUSIVE exits NON-ZERO, on purpose. "I could not look" and "I looked and
 * it is wrong" must never be the same silence — a check that returns green when
 * it could not look is the defect class this issue exists to end. D7 is a
 * deliberate false positive: an unexplained single-job cancellation goes red
 * rather than quietly green, because treating an unexplained `cancelled` as fine
 * is precisely the misreading that happened four separate times on #2148.
 *
 * # What this check is, plainly
 *
 * It is a REPORTING check with the same strength class A itself has: it appears
 * in the PR's check list and goes visibly red. It is not in any ruleset, and
 * putting it in one is out of scope for #2594.
 *
 * Cross-references:
 *   - #2594 SPEC Part 2 (D1-1 .. D1-7), orchestrator rulings R-1 .. R-5
 *   - #2438 Amendment 7, A7-SC1(1) (the 600 s bound) and A7-SC4 (no in-gate timer)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The sibling job's own display name. Excluded from the cancelled-peer set by
 * name so a re-read that reports this job as cancelled can never be mistaken
 * for the second cancellation that turns a timeout kill into an eviction.
 *
 * Kept in lockstep with the job's `name:` by the #2594 wiring assertion in
 * `.github/scripts/ci-batch/__tests__/issue-2437-node-wave-shadow-parity.implementor.test.mjs`.
 */
export const SELF_JOB_NAME = "Strict grep — class A elapsed-time budget (out-of-band)";

/** Class A's `timeout-minutes` cap expressed in seconds, for the D6 message. */
export const CLASS_A_TIMEOUT_CAP_SECONDS = 900;

/** How far apart two cancellations may be and still count as the same instant. */
export const SIMULTANEOUS_WINDOW_SECONDS = 2;

export const VERDICTS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  NEUTRAL: "NEUTRAL",
  PASS_THROUGH: "PASS-THROUGH",
  INCONCLUSIVE: "INCONCLUSIVE",
});

const EXIT_FOR_VERDICT = Object.freeze({
  [VERDICTS.PASS]: 0,
  [VERDICTS.NEUTRAL]: 0,
  [VERDICTS.PASS_THROUGH]: 0,
  [VERDICTS.FAIL]: 1,
  [VERDICTS.INCONCLUSIVE]: 2,
});

// ---------------------------------------------------------------------------
// Pure adjudication
// ---------------------------------------------------------------------------

const epochSeconds = (value) => {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
};

const round = (seconds) => Math.round(seconds * 10) / 10;

/**
 * Adjudicate one class-A conclusion. Pure: no network, no clock, no filesystem.
 *
 * @param {object} input
 * @param {Array<object>} input.jobs      the attempt's job list, as returned by the API
 * @param {object} input.run              the run object, as returned by the API
 * @param {string} input.jobName          exact display name of the class-A job
 * @param {number} input.budgetSeconds    the A7-SC1(1) bound
 * @param {number} input.timeoutKillSeconds  the floor above which a cancellation is a cap kill
 * @param {string} [input.selfJobName]    this adjudicator's own display name
 * @returns {{row: string, verdict: string, exit: number, durationSeconds: number|null, lines: string[]}}
 */
export function adjudicate({
  jobs,
  run,
  jobName,
  budgetSeconds,
  timeoutKillSeconds,
  selfJobName = SELF_JOB_NAME,
}) {
  const list = Array.isArray(jobs) ? jobs : [];
  const decide = (row, verdict, durationSeconds, lines) => ({
    row,
    verdict,
    exit: EXIT_FOR_VERDICT[verdict],
    durationSeconds,
    lines,
  });

  // D0 — the subject is not in the list at all. The check refuses to guess which
  // job was meant, and names every job it did see so the mismatch is one read.
  const classA = list.find((job) => job?.name === jobName);
  if (!classA) {
    return decide("D0", VERDICTS.INCONCLUSIVE, null, [
      `looked for a job named exactly: ${JSON.stringify(jobName)}`,
      `saw ${list.length} job name(s): ${list.map((job) => JSON.stringify(job?.name ?? null)).join(", ") || "(none)"}`,
      "the adjudicator could not look, so it does not report a pass.",
    ]);
  }

  const startedAt = epochSeconds(classA.started_at);
  const completedAt = epochSeconds(classA.completed_at);

  // D1 — the subject exists but has not concluded, or carries no usable
  // timestamps. `needs: [static-gates]` should make this unreachable.
  if (classA.status !== "completed" || completedAt === null || startedAt === null) {
    return decide("D1", VERDICTS.INCONCLUSIVE, null, [
      `status=${JSON.stringify(classA.status ?? null)} ` +
        `started_at=${JSON.stringify(classA.started_at ?? null)} ` +
        `completed_at=${JSON.stringify(classA.completed_at ?? null)}`,
      "a `needs:` dependency on the measured job should make this state unreachable; " +
        "if it is reached, the dependency edge or the timestamps changed.",
      "the adjudicator could not look, so it does not report a pass.",
    ]);
  }

  const durationSeconds = round(completedAt - startedAt);

  // D2 — class A's own red already reports. The budget is not adjudicated on a
  // job that failed for an unrelated reason; a slow red would otherwise be
  // reported twice under two different causes.
  if (classA.conclusion === "failure") {
    return decide("D2", VERDICTS.PASS_THROUGH, durationSeconds, [
      `the measured job concluded \`failure\` after ${durationSeconds}s.`,
      "class A's own red already reports that; the elapsed-time bound is NOT adjudicated here.",
    ]);
  }

  if (classA.conclusion === "success") {
    // D3 — the silent breach this issue exists to end: over the bound, reported
    // as `success`, with nothing anywhere turning red.
    if (durationSeconds > budgetSeconds) {
      return decide("D3", VERDICTS.FAIL, durationSeconds, [
        `the measured job reported \`success\` but took ${durationSeconds}s, ` +
          `over the ${budgetSeconds}s bound by ${round(durationSeconds - budgetSeconds)}s.`,
        "A7-SC1(1) is a written success criterion; before #2594 nothing turned red when it was crossed.",
      ]);
    }
    // D4 — the healthy case.
    return decide("D4", VERDICTS.PASS, durationSeconds, [
      `the measured job took ${durationSeconds}s against the ${budgetSeconds}s bound ` +
        `(${round(budgetSeconds - durationSeconds)}s of headroom).`,
    ]);
  }

  if (classA.conclusion === "cancelled") {
    // Peers: every OTHER completed job that was also cancelled. Class A itself is
    // excluded by identity and this adjudicator by name — counting either is the
    // off-by-one that inverts an eviction and a cap kill.
    const cancelledPeers = list.filter((job) => job !== classA
      && job?.name !== selfJobName
      && job?.conclusion === "cancelled");
    const simultaneous = cancelledPeers.filter((job) => {
      const peerCompletedAt = epochSeconds(job?.completed_at);
      return peerCompletedAt !== null
        && Math.abs(peerCompletedAt - completedAt) <= SIMULTANEOUS_WINDOW_SECONDS;
    });

    // D5 — a concurrency eviction. Several jobs die at the same instant, or the
    // run itself is cancelled. The run-level test reads `status` OR `conclusion`
    // because while this adjudicator runs the run is still in flight and its
    // `conclusion` is null.
    const runCancelled = run?.status === "cancelled" || run?.conclusion === "cancelled";
    if (runCancelled || simultaneous.length >= 1) {
      return decide("D5", VERDICTS.NEUTRAL, durationSeconds, [
        `the measured job was cancelled after ${durationSeconds}s, with ` +
          `${simultaneous.length} other job(s) cancelled within ` +
          `${SIMULTANEOUS_WINDOW_SECONDS}s of the same instant` +
          (runCancelled ? " and the run itself cancelled" : "") + ".",
        "that is a concurrency eviction, not a budget breach. NEUTRAL: the pool was busy, " +
          "and the superseding run supplies a fresh verdict.",
      ]);
    }

    if (cancelledPeers.length === 0) {
      // D6 — the case GitHub reports as `cancelled` and four readers on #2148
      // read as noise. One job dies, alone, at its cap.
      if (durationSeconds >= timeoutKillSeconds) {
        return decide("D6", VERDICTS.FAIL, durationSeconds, [
          `the measured job was cancelled ALONE after ${durationSeconds}s, at or above the ` +
            `${timeoutKillSeconds}s kill floor and at its ${CLASS_A_TIMEOUT_CAP_SECONDS}s cap.`,
          "that is a `timeout-minutes` kill. GitHub reports it as `cancelled`, NOT as `failure`, " +
            "which is why it was misread as noise four separate times on #2148.",
        ]);
      }
      // D7 — neither the cap nor an eviction. Deliberately red.
      return decide("D7", VERDICTS.INCONCLUSIVE, durationSeconds, [
        `the measured job was cancelled ALONE after ${durationSeconds}s — below the ` +
          `${timeoutKillSeconds}s kill floor, and with no peer cancelled at the same instant.`,
        "that is neither a cap kill nor a concurrency eviction. The adjudicator refuses to call " +
          "it a pass: an unexplained cancellation read as fine is the exact misreading #2594 ends.",
      ]);
    }

    // Cancelled, with peers that died at some OTHER instant. Not classified by
    // any row above, so it is not classified at all.
    return decide("D8", VERDICTS.INCONCLUSIVE, durationSeconds, [
      `the measured job concluded ${JSON.stringify(classA.conclusion)} after ${durationSeconds}s, ` +
        `with ${cancelledPeers.length} peer cancellation(s) but none within ` +
        `${SIMULTANEOUS_WINDOW_SECONDS}s of it.`,
      "no row of the decision table classifies that shape, so the adjudicator does not report a pass.",
    ]);
  }

  // D8 — `skipped`, null, `action_required`, `neutral`, `timed_out`, anything new.
  return decide("D8", VERDICTS.INCONCLUSIVE, durationSeconds, [
    `the measured job concluded ${JSON.stringify(classA.conclusion ?? null)} after ${durationSeconds}s.`,
    "no row of the decision table classifies that conclusion, so the adjudicator does not report a pass.",
  ]);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function formatVerdict(result, { jobName, budgetSeconds }) {
  const out = [
    `[issue-2594] ${result.row} ${result.verdict} (exit ${result.exit})`,
    `[issue-2594]   subject : ${jobName}`,
    `[issue-2594]   bound   : ${budgetSeconds}s (A7-SC1(1))`,
    `[issue-2594]   elapsed : ${result.durationSeconds === null ? "unavailable" : `${result.durationSeconds}s`}`,
  ];
  for (const line of result.lines) out.push(`[issue-2594]   ${line}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// --enforce
// ---------------------------------------------------------------------------

const readInt = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number of seconds; saw ${JSON.stringify(raw)}`);
  }
  return parsed;
};

async function apiGet(url, token) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "mingla-issue-2594-class-a-budget",
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${url} -> HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function enforce() {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const token = process.env.GITHUB_TOKEN;
  const jobName = process.env.CLASS_A_JOB_NAME;
  // A malformed threshold is "could not look", not "looked and it is wrong": it
  // must land on exit 2, never on the exit 1 an unhandled throw would produce.
  let budgetSeconds;
  let timeoutKillSeconds;
  try {
    budgetSeconds = readInt("CLASS_A_BUDGET_SECONDS", 600);
    timeoutKillSeconds = readInt("CLASS_A_TIMEOUT_KILL_SECONDS", 890);
  } catch (error) {
    console.error(`[issue-2594] INCONCLUSIVE (exit 2): ${error.message}`);
    console.error("[issue-2594]   the adjudicator could not look, so it does not report a pass.");
    return 2;
  }

  const missing = Object.entries({ GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId, GITHUB_TOKEN: token, CLASS_A_JOB_NAME: jobName })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    console.error(`[issue-2594] INCONCLUSIVE (exit 2): missing environment: ${missing.join(", ")}`);
    console.error("[issue-2594]   the adjudicator could not look, so it does not report a pass.");
    return 2;
  }

  const base = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  let jobsPayload;
  let run;
  try {
    // Attempt-scoped, so a re-run cannot mix a prior attempt's jobs into the
    // simultaneous-cancellation set.
    jobsPayload = await apiGet(`${base}/attempts/${encodeURIComponent(attempt)}/jobs?per_page=100`, token);
    run = await apiGet(base, token);
  } catch (error) {
    console.error(`[issue-2594] INCONCLUSIVE (exit 2): ${error.message}`);
    console.error("[issue-2594]   the adjudicator could not look, so it does not report a pass.");
    return 2;
  }

  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
  if (typeof jobsPayload?.total_count === "number" && jobsPayload.total_count > jobs.length) {
    console.error(`[issue-2594] INCONCLUSIVE (exit 2): the attempt reports ${jobsPayload.total_count} jobs but only ${jobs.length} were returned.`);
    console.error("[issue-2594]   a truncated job list can hide the peer cancellation that separates an eviction from a cap kill.");
    return 2;
  }

  const result = adjudicate({ jobs, run, jobName, budgetSeconds, timeoutKillSeconds });
  const report = formatVerdict(result, { jobName, budgetSeconds });
  if (result.exit === 0) console.log(report);
  else console.error(report);
  return result.exit;
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

const job = (name, overrides = {}) => ({
  name,
  status: "completed",
  conclusion: "success",
  started_at: "2026-08-26T10:00:00Z",
  completed_at: "2026-08-26T10:08:00Z",
  ...overrides,
});

const CLASS_A = "Strict grep — static gates (class A)";
const IN_FLIGHT_RUN = { status: "in_progress", conclusion: null };

/**
 * One fixture per row of the decision table, plus the residual cancelled shape
 * and the two invariants the peer set depends on. Every case names the row it
 * drives, the verdict it must produce and the exit code that verdict carries;
 * a divergence in EITHER is a failure.
 */
export const SELF_TEST_CASES = Object.freeze([
  {
    label: "D0 — no job carries the configured name",
    input: { jobs: [job("Strict grep — dependency gates (class B)")], run: IN_FLIGHT_RUN },
    row: "D0", verdict: VERDICTS.INCONCLUSIVE, exit: 2,
    mustMention: ["class B", "class A"],
  },
  {
    label: "D0 — an empty job list is still inconclusive, never a pass",
    input: { jobs: [], run: IN_FLIGHT_RUN },
    row: "D0", verdict: VERDICTS.INCONCLUSIVE, exit: 2,
  },
  {
    label: "D1 — the measured job has not concluded",
    input: { jobs: [job(CLASS_A, { status: "in_progress", conclusion: null, completed_at: null })], run: IN_FLIGHT_RUN },
    row: "D1", verdict: VERDICTS.INCONCLUSIVE, exit: 2,
    mustMention: ["unreachable"],
  },
  {
    label: "D1 — a completed job with an unparseable start timestamp",
    input: { jobs: [job(CLASS_A, { started_at: "not-a-timestamp" })], run: IN_FLIGHT_RUN },
    row: "D1", verdict: VERDICTS.INCONCLUSIVE, exit: 2,
  },
  {
    label: "D2 — class A's own red already reports",
    input: { jobs: [job(CLASS_A, { conclusion: "failure", completed_at: "2026-08-26T10:11:00Z" })], run: IN_FLIGHT_RUN },
    row: "D2", verdict: VERDICTS.PASS_THROUGH, exit: 0,
    mustMention: ["NOT adjudicated"],
  },
  {
    label: "D3 — the silent breach: `success` at 622s against a 600s bound",
    input: { jobs: [job(CLASS_A, { completed_at: "2026-08-26T10:10:22Z" })], run: IN_FLIGHT_RUN },
    row: "D3", verdict: VERDICTS.FAIL, exit: 1,
    mustMention: ["622", "600", "success"],
  },
  {
    label: "D3 — one second over the bound is still over the bound",
    input: { jobs: [job(CLASS_A, { completed_at: "2026-08-26T10:10:01Z" })], run: IN_FLIGHT_RUN },
    row: "D3", verdict: VERDICTS.FAIL, exit: 1,
  },
  {
    label: "D4 — exactly at the bound is inside it",
    input: { jobs: [job(CLASS_A, { completed_at: "2026-08-26T10:10:00Z" })], run: IN_FLIGHT_RUN },
    row: "D4", verdict: VERDICTS.PASS, exit: 0,
    mustMention: ["600", "headroom"],
  },
  {
    label: "D4 — today's measured median, 514s",
    input: { jobs: [job(CLASS_A, { completed_at: "2026-08-26T10:08:34Z" })], run: IN_FLIGHT_RUN },
    row: "D4", verdict: VERDICTS.PASS, exit: 0,
    mustMention: ["514", "86"],
  },
  {
    label: "D5 — concurrency eviction: eight jobs cancelled at the same instant",
    input: {
      jobs: [
        job(CLASS_A, { conclusion: "cancelled", completed_at: "2026-08-26T10:05:13Z" }),
        job("Strict grep — dependency gates (class B)", { conclusion: "cancelled", completed_at: "2026-08-26T10:05:13Z" }),
        job("Strict grep — jest suites (class D)", { conclusion: "cancelled", completed_at: "2026-08-26T10:05:14Z" }),
      ],
      run: IN_FLIGHT_RUN,
    },
    row: "D5", verdict: VERDICTS.NEUTRAL, exit: 0,
    mustMention: ["eviction", "313"],
  },
  {
    label: "D5 — the run itself is cancelled, with no peer cancellation at all",
    input: {
      jobs: [job(CLASS_A, { conclusion: "cancelled", completed_at: "2026-08-26T10:01:03Z" })],
      run: { status: "completed", conclusion: "cancelled" },
    },
    row: "D5", verdict: VERDICTS.NEUTRAL, exit: 0,
    mustMention: ["eviction"],
  },
  {
    label: "D6 — the cap kill GitHub reports as `cancelled`, at 902s",
    input: {
      jobs: [
        job(CLASS_A, { conclusion: "cancelled", completed_at: "2026-08-26T10:15:02Z" }),
        job("Strict grep — dependency gates (class B)"),
      ],
      run: IN_FLIGHT_RUN,
    },
    row: "D6", verdict: VERDICTS.FAIL, exit: 1,
    mustMention: ["902", "890", "900", "cancelled"],
  },
  {
    label: "D6 — this adjudicator's own cancellation is not a peer cancellation",
    input: {
      jobs: [
        job(CLASS_A, { conclusion: "cancelled", completed_at: "2026-08-26T10:15:02Z" }),
        job(SELF_JOB_NAME, { conclusion: "cancelled", completed_at: "2026-08-26T10:15:02Z" }),
      ],
      run: IN_FLIGHT_RUN,
    },
    row: "D6", verdict: VERDICTS.FAIL, exit: 1,
  },
  {
    label: "D7 — cancelled alone, far below the cap: red, not green",
    input: {
      jobs: [
        job(CLASS_A, { conclusion: "cancelled", completed_at: "2026-08-26T10:01:30Z" }),
        job("Strict grep — dependency gates (class B)"),
      ],
      run: IN_FLIGHT_RUN,
    },
    row: "D7", verdict: VERDICTS.INCONCLUSIVE, exit: 2,
    mustMention: ["neither", "refuses"],
  },
  {
    label: "D8 — a conclusion no row classifies",
    input: { jobs: [job(CLASS_A, { conclusion: "skipped" })], run: IN_FLIGHT_RUN },
    row: "D8", verdict: VERDICTS.INCONCLUSIVE, exit: 2,
    mustMention: ["skipped"],
  },
  {
    label: "D8 — cancelled with a peer that died at a different instant",
    input: {
      jobs: [
        job(CLASS_A, { conclusion: "cancelled", completed_at: "2026-08-26T10:05:13Z" }),
        job("Strict grep — dependency gates (class B)", { conclusion: "cancelled", completed_at: "2026-08-26T10:02:00Z" }),
      ],
      run: IN_FLIGHT_RUN,
    },
    row: "D8", verdict: VERDICTS.INCONCLUSIVE, exit: 2,
  },
]);

export function runSelfTest(log = console.log) {
  const failures = [];
  const rowsSeen = new Set();

  for (const testCase of SELF_TEST_CASES) {
    const result = adjudicate({
      ...testCase.input,
      jobName: CLASS_A,
      budgetSeconds: 600,
      timeoutKillSeconds: 890,
    });
    rowsSeen.add(result.row);
    if (result.row !== testCase.row) {
      failures.push(`${testCase.label}: expected row ${testCase.row}, got ${result.row}`);
    }
    if (result.verdict !== testCase.verdict) {
      failures.push(`${testCase.label}: expected verdict ${testCase.verdict}, got ${result.verdict}`);
    }
    if (result.exit !== testCase.exit) {
      failures.push(`${testCase.label}: expected exit ${testCase.exit}, got ${result.exit}`);
    }
    const report = formatVerdict(result, { jobName: CLASS_A, budgetSeconds: 600 });
    for (const token of testCase.mustMention ?? []) {
      if (!report.includes(token)) {
        failures.push(`${testCase.label}: the log must name ${JSON.stringify(token)} and does not`);
      }
    }
    log(`  ${result.row.padEnd(3)} ${result.verdict.padEnd(12)} exit ${result.exit}  ${testCase.label}`);
  }

  // Every row of the table must have been driven by at least one fixture. A
  // table row with no fixture is a branch nothing has ever executed.
  const expectedRows = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"];
  for (const row of expectedRows) {
    if (!rowsSeen.has(row)) failures.push(`decision-table row ${row} has no fixture`);
  }

  // The exit contract itself, asserted rather than assumed: INCONCLUSIVE must
  // never be worth 0. A green "could not look" is the defect this issue ends.
  if (EXIT_FOR_VERDICT[VERDICTS.INCONCLUSIVE] === 0) {
    failures.push("INCONCLUSIVE must exit non-zero");
  }
  if (EXIT_FOR_VERDICT[VERDICTS.FAIL] === 0) {
    failures.push("FAIL must exit non-zero");
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(argv) {
  if (argv.includes("--self-test")) {
    console.log("[issue-2594] class-A elapsed-time budget adjudicator — self-test");
    const failures = runSelfTest();
    if (failures.length) {
      for (const failure of failures) console.error(`[issue-2594] SELF-TEST FAIL: ${failure}`);
      return 1;
    }
    console.log(`[issue-2594] self-test PASSED — ${SELF_TEST_CASES.length} fixtures across all 9 decision-table rows.`);
    return 0;
  }

  if (argv.includes("--enforce")) return enforce();

  console.error("usage: node .github/scripts/strict-grep/issue-2594-class-a-budget.mjs (--self-test | --enforce)");
  return 2;
}

const isDirectInvocation = (() => {
  try {
    const importPath = fs.realpathSync(fileURLToPath(import.meta.url));
    const argvPath = fs.realpathSync(path.resolve(process.argv[1] ?? ""));
    return importPath === argvPath;
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  process.exitCode = await main(process.argv.slice(2));
}
