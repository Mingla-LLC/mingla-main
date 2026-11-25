/**
 * Shared measurement for the business-web boot budget (issue #1509).
 *
 * ONE definition of "how big is the boot payload", used by all three consumers:
 *   - scripts/ci/orch-1083-initial-bundle-budget.mjs  (the PR gate)
 *   - scripts/ci/bundle-baseline-update.mjs           (the post-merge ratchet)
 *   - scripts/ci/bundle-attribute.mjs                 (the attribution tool)
 *   - scripts/ci/bundle-baseline-movement.mjs         (the PR/main movement gate)
 *
 * It also owns ONE_TIME_PR_ALLOWANCE, the single table of named one-pull-
 * request `__common` exceptions that both `__common` gates read.
 *
 * Before #1509 the gate computed sizes inline, which is why the ratchet and the
 * attribution could not exist without duplicating (and eventually contradicting)
 * it. Any change to what "boot payload" means belongs HERE and nowhere else.
 *
 * Terms:
 *   eager  — every <script> referenced by web-build/index.html. This is what a
 *            visitor downloads before ANY route renders, guest or authenticated.
 *   common — the single `__common` chunk inside `eager`. Metro hoists any module
 *            imported by two or more async chunks into it, so it grows whenever
 *            code is shared between lazy routes, not only when boot code is added.
 *
 * Sizes are reported three ways because they answer different questions:
 *   raw    — what the build produced. Stable, comparable, what the old cap used.
 *   gzip   — the floor any CDN gives you.
 *   brotli — what Vercel actually serves, i.e. what a guest on mobile data waits
 *            for. This is the CUSTOMER-FELT number and the one the product
 *            ceiling is expressed in.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));

/** Deferred specifiers that must never be statically reachable from an eager script. */
export const DEFERRED_SPECIFIERS = [
  "@stripe/connect-js",
  "@stripe/react-connect-js",
  "react-native-qrcode-svg",
  "@expo-google-fonts/",
];

/**
 * One authority for meaningful movement around the recorded boot baseline.
 *
 * Issue #3493 found that pull requests could skip a private 1,024 B guard and
 * then fail it only after merge, while the ratchet treated anything below
 * 2,048 B as noise. Keeping both decisions on this value makes a +1,560 B
 * movement receive the same verdict before and after merge.
 */
export const BASELINE_MOVEMENT_THRESHOLD_BYTES = 1_024;

/**
 * The smallest movement of main the post-merge ratchet records. It must stay
 * below BASELINE_MOVEMENT_THRESHOLD_BYTES: otherwise main can drift by an
 * amount the ratchet never records but the pull-request gate still counts,
 * and that drift blocks the next Business pull request. #4270 hit this: main
 * was +838 B unrecorded under a 2,048 B floor. Both the ratchet and the gate
 * measure on Linux, so a half-threshold floor stays above measurement noise.
 */
export const BASELINE_RECORD_FLOOR_BYTES = BASELINE_MOVEMENT_THRESHOLD_BYTES / 2;

/**
 * Fail-closed verdict for raw `__common` movement from the recorded baseline.
 * The same pure decision is used by pull-request and main builds.
 *
 * `oneTimeCap` is only ever the `common` cap of an ONE_TIME_PR_ALLOWANCE entry
 * that resolveOneTimeAllowance has already matched to this run. Without it the
 * verdict uses BASELINE_MOVEMENT_THRESHOLD_BYTES, unchanged. A cap that is not
 * a safe integer above that threshold is an error, never a silent widening.
 */
export function assessCommonBaselineMovement(baselineRaw, measuredRaw, { oneTimeCap } = {}) {
  for (const [label, value] of [
    ["baselineRaw", baselineRaw],
    ["measuredRaw", measuredRaw],
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive safe integer, got ${String(value)}`);
    }
  }
  const delta = measuredRaw - baselineRaw;
  if (oneTimeCap === undefined) {
    return {
      ok: delta <= BASELINE_MOVEMENT_THRESHOLD_BYTES,
      delta,
      threshold: BASELINE_MOVEMENT_THRESHOLD_BYTES,
    };
  }
  if (!Number.isSafeInteger(oneTimeCap) || oneTimeCap <= BASELINE_MOVEMENT_THRESHOLD_BYTES) {
    throw new Error(`oneTimeCap must be a safe integer above ${BASELINE_MOVEMENT_THRESHOLD_BYTES}, got ${String(oneTimeCap)}`);
  }
  return {
    ok: delta <= oneTimeCap,
    delta,
    threshold: oneTimeCap,
    normalThreshold: BASELINE_MOVEMENT_THRESHOLD_BYTES,
    normalOk: delta <= BASELINE_MOVEMENT_THRESHOLD_BYTES,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE-TIME ALLOWANCE — a named exception for ONE pull request, shared by BOTH
// `__common` gates. NOT a second limit, and not a place to park a number so a
// PR can land.
//
// Two gates read this one table (there is no second copy anywhere):
//   - orch-1083-initial-bundle-budget.mjs: the per-PR delta allowance
//     (normally 12,000 B of `__common`);
//   - bundle-baseline-movement.mjs: the shared movement threshold
//     (BASELINE_MOVEMENT_THRESHOLD_BYTES, normally 1,024 B of `__common`).
// Each gate passes its own normal limit in. Neither normal limit moves for an
// entry; an entry replaces it, for one run, with the entry's `common` CAP, for
// one pull request Seth approved by name, and for nothing else:
//
//   - PULL REQUEST RUNS: only when the runner reports this exact head branch
//     AND this exact pull request (`refs/pull/<pr>/merge`). A different
//     branch, a different pull request number, a manual dispatch, a missing
//     value: the normal limit.
//   - MAIN, AFTER THE MERGE: the lanes that re-run these gates on a push to
//     main measure main against a baseline that has not recorded the merge
//     yet, and there is no head branch on a push. So on `refs/heads/main`
//     only, the entry applies while git shows the pull request's squash commit
//     (subject ending `(#<pr>)`) AFTER the commit the baseline was measured
//     at. The ratchet then records a baseline measured at or after that merge
//     (the baseline is banked after merge), the commit drops out of that
//     range, and the entry is dead on main for good. Nobody has to "put it
//     back".
//   - A HARD END DATE: after `expiresAfter` the entry is inert on every path,
//     so a reused branch name cannot inherit it.
//   - NEVER INSIDE A TEST HARNESS: the budget suites run these gates against
//     synthetic exports and must keep meeting the normal limit on every branch.
//
// It raises `common`, and, only when an entry carries an optional `eager` cap
// (issue #4490: eager includes __common, so shared code is counted in both),
// the eager per-PR allowance of the orch-1083 gate, scoped by exactly the same
// checks. An entry without `eager` leaves eager at its normal 25,000 B. Both
// PRODUCT CEILINGS are untouched and still enforced first. Every run an entry applies to prints the
// normal limit, the granted cap, the measured delta, the reason and the
// approver, and every run it does NOT apply to says so in one line.
//
// orch-1083's `--self-test` pins this table to exactly the entry below. Adding
// or editing an entry therefore fails `--self-test` until that pin is changed
// in the same reviewed diff, which is the point: an exception is Seth's
// decision, named, dated and visible, never a quiet edit.
//
// #4594: Seth approved the orch-1083 cap on 2026-11-24 and, the same day,
// extended this same entry to the movement gate ("Decision from Seth
// (2026-11-24): the two #4594 gates", on #4522).
// ═══════════════════════════════════════════════════════════════════════════
export const ONE_TIME_PR_ALLOWANCE = Object.freeze([
  Object.freeze({
    issue: 4522,
    pr: 4594,
    headRef: "4522-young-polish",
    common: 23_000,
    expiresAfter: "2026-12-08",
    approvedBy: "Seth, 2026-11-24",
    reason:
      "Trip partial payments, one calendar and add-ons (#4522, #4523, #3281): code genuinely " +
      "shared by Host and buyer routes (trip balance helper, plan maths, instalments and add-ons " +
      "services) lands in the shared chunk (+22,349 B measured against the #4589 baseline). The " +
      "nested lazy load was already removed; splitting cohesive modules only to pass is not allowed.",
  }),
  Object.freeze({
    issue: 4490,
    pr: 4600,
    headRef: "4490-venue-features",
    common: 162_000,
    eager: 165_000,
    expiresAfter: "2026-12-08",
    approvedBy: "Seth, 2026-11-24",
    reason:
      "Venue features (#4490): the host and guest venue pages genuinely share about 161 KB of " +
      "code (Till, Close the day, offers, venue models and services) that lands in the shared " +
      "chunk (+161,172 B in __common and +163,802 B in the eager payload, measured against the #4589 baseline). Splitting cohesive modules only " +
      "to pass is not allowed.",
  }),
]);

/**
 * The per-pull-request `__common` and eager caps a resolved entry grants.
 * `entry` is what resolveOneTimeAllowance returned (null for a run it does not
 * apply to: another PR, another branch, expired, a test harness). An absent or
 * unusable `eager` on an entry means the normal eager allowance, never a grant.
 * Pure; it never touches PR_DELTA_ALLOWANCE or the product ceilings.
 */
export function effectivePerPrAllowance(entry, normal) {
  const common = entry && Number.isSafeInteger(entry.common) && entry.common > normal.common
    ? entry.common
    : normal.common;
  const eager = entry && Number.isSafeInteger(entry.eager) && entry.eager > normal.eager
    ? entry.eager
    : normal.eager;
  return { common, eager };
}

const MAIN_REF = "refs/heads/main";
const MAIN_EVENTS = new Set(["push", "workflow_dispatch"]);

/**
 * Decide whether a one-time entry applies to THIS run. Pure: everything it
 * reads is passed in, so the self-tests can prove each refusal.
 *
 * `normalLimit` is the calling gate's own normal `__common` limit; an entry
 * whose cap is not above it grants nothing and is refused.
 * `subjectsSinceBaseline` returns the commit subjects reachable from HEAD but
 * not from the commit the baseline was measured at, or throws. A throw is a
 * refusal, never a grant.
 */
export function resolveOneTimeAllowance({
  env,
  today,
  baselineCommit,
  subjectsSinceBaseline,
  normalLimit,
  table = ONE_TIME_PR_ALLOWANCE,
}) {
  const refusals = [];
  if (!Number.isSafeInteger(normalLimit) || normalLimit <= 0) {
    refusals.push(`the calling gate passed no usable normal limit (${String(normalLimit)})`);
    return { entry: null, via: null, refusals };
  }
  for (const entry of table) {
    const name = `issue #${entry.issue}, PR #${entry.pr}`;
    if (!Number.isSafeInteger(entry.common) || entry.common <= normalLimit) {
      refusals.push(`${name}: entry grants no usable cap`);
      continue;
    }
    if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today) || today > entry.expiresAfter) {
      refusals.push(`${name}: expired after ${entry.expiresAfter}`);
      continue;
    }
    // `node --test` marks every process it starts, and the budget suites run
    // these gates against synthetic exports from inside it. Those are
    // fixtures, not the pull request's payload: they must always meet the
    // normal limit, whichever pull request or branch the suite runs on.
    if (env.NODE_TEST_CONTEXT) {
      refusals.push(`${name}: running inside a test harness`);
      continue;
    }
    const event = env.GITHUB_EVENT_NAME ?? "";
    const ref = env.GITHUB_REF ?? "";
    const headRef = env.GITHUB_HEAD_REF ?? "";

    if (event === "pull_request") {
      if (headRef === entry.headRef && ref === `refs/pull/${entry.pr}/merge`) {
        return { entry, via: `pull request #${entry.pr} from branch ${entry.headRef}`, refusals };
      }
      refusals.push(`${name}: this is not that pull request (head "${headRef}", ref "${ref}")`);
      continue;
    }

    if (ref === MAIN_REF && MAIN_EVENTS.has(event)) {
      if (typeof baselineCommit !== "string" || !/^[0-9a-f]{40}$/.test(baselineCommit)) {
        refusals.push(`${name}: the baseline does not name the commit it was measured at`);
        continue;
      }
      let subjects;
      try {
        subjects = subjectsSinceBaseline(baselineCommit);
      } catch (err) {
        refusals.push(`${name}: could not read git history since the baseline (${String(err?.message ?? err).split("\n")[0]})`);
        continue;
      }
      const marker = `(#${entry.pr})`;
      if (Array.isArray(subjects) && subjects.some((s) => typeof s === "string" && s.endsWith(marker))) {
        return {
          entry,
          via: `main, where the merge of PR #${entry.pr} is not yet in the recorded baseline (measured at ${baselineCommit.slice(0, 9)})`,
          refusals,
        };
      }
      refusals.push(`${name}: the recorded baseline already includes PR #${entry.pr}, or it has not merged`);
      continue;
    }

    refusals.push(`${name}: not a pull request run and not main (event "${event}", ref "${ref}")`);
  }
  return { entry: null, via: null, refusals };
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: LIB_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Commit subjects reachable from HEAD but not from `commit`. Throws on any git
 * error, which resolveOneTimeAllowance treats as a refusal.
 *
 * The two main-side movement lanes keep full history so an intervening commit
 * cannot hide an approved merge that the recorded baseline has not banked yet.
 * Other callers may still be shallow. Only then, and only when the baseline
 * commit is absent, this returns HEAD's own subject: the baseline file in
 * HEAD's tree names a commit measured before that file was committed, so HEAD
 * is always inside `commit..HEAD` and never the baseline commit itself. A
 * subset of the true range can only find FEWER merge markers, so the fallback
 * can never grant more than the full history would. It covers the immediate
 * squash-commit push, but deliberately cannot prove an older merge after an
 * intervening commit. A missing commit in a full clone is still an error.
 */
export function gitSubjectsSince(commit, { git = runGit } = {}) {
  let present = true;
  try {
    git(["cat-file", "-e", `${commit}^{commit}`]);
  } catch {
    present = false;
  }
  if (present) {
    return git(["log", "--format=%s", `${commit}..HEAD`])
      .split("\n")
      .filter(Boolean);
  }
  if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "true") {
    throw new Error(`the baseline commit ${commit} is not in this full clone`);
  }
  if (git(["rev-parse", "HEAD"]).trim() === commit) return [];
  return [git(["log", "-1", "--format=%s", "HEAD"]).replace(/\n+$/, "")].filter(Boolean);
}

/** Compress with the settings a CDN would use for a static asset it serves repeatedly. */
function compressedSizes(buf) {
  return {
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length,
  };
}

const zero = () => ({ raw: 0, gzip: 0, brotli: 0 });
const add = (acc, s) => {
  acc.raw += s.raw;
  acc.gzip += s.gzip;
  acc.brotli += s.brotli;
  return acc;
};

/**
 * Measure a `expo export -p web` output directory.
 *
 * @param {string} webBuild path to the export directory
 * @returns {{
 *   eager: {raw:number,gzip:number,brotli:number},
 *   common: {raw:number,gzip:number,brotli:number}|null,
 *   commonRel: string|null,
 *   mainEntryRel: string,
 *   scriptRels: string[],
 *   chunkCount: number,
 *   perScript: Array<{rel:string,raw:number,gzip:number,brotli:number}>,
 * }}
 */
export function measureWebBuild(webBuild) {
  const indexPath = join(webBuild, "index.html");
  let html;
  try {
    html = readFileSync(indexPath, "utf8");
  } catch (err) {
    throw new Error(
      `cannot read ${indexPath} (run \`npm run web:export\` first): ${err.message}`,
    );
  }

  const scriptRels = [
    ...html.matchAll(/\/_expo\/static\/js\/web\/[^"']+\.js/g),
  ].map((m) => m[0]);
  if (scriptRels.length === 0) {
    throw new Error(`no <script> references found in ${indexPath}`);
  }

  const perScript = [];
  const eager = zero();
  for (const rel of scriptRels) {
    const buf = readFileSync(join(webBuild, rel.replace(/^\//, "")));
    const entry = { rel, raw: buf.length, ...compressedSizes(buf) };
    perScript.push(entry);
    add(eager, entry);
  }

  const commonEntry = perScript.find((e) => e.rel.includes("__common")) ?? null;

  // The main entry chunk is the largest index-*.js — the app bulk.
  const indexEntries = perScript
    .filter((e) => /\/index-[0-9a-f]+\.js$/.test(e.rel))
    .sort((a, b) => b.raw - a.raw);
  if (indexEntries.length === 0) {
    throw new Error("could not identify the main entry chunk (index-*.js) in index.html");
  }

  const jsDir = join(webBuild, "_expo", "static", "js", "web");
  const chunkCount = readdirSync(jsDir).filter((n) => n.endsWith(".js")).length;

  return {
    eager,
    common: commonEntry
      ? { raw: commonEntry.raw, gzip: commonEntry.gzip, brotli: commonEntry.brotli }
      : null,
    commonRel: commonEntry?.rel ?? null,
    mainEntryRel: indexEntries[0].rel,
    scriptRels,
    chunkCount,
    perScript,
  };
}

/** Format a byte count as `1,234,567 B (1.18 MB)`. */
export function fmt(bytes) {
  return `${bytes.toLocaleString("en-US")} B (${(bytes / 1_048_576).toFixed(2)} MB)`;
}

/** Format a size triple on one line. */
export function fmtTriple(s) {
  return `raw ${s.raw.toLocaleString("en-US")} · gzip ${s.gzip.toLocaleString(
    "en-US",
  )} · brotli ${s.brotli.toLocaleString("en-US")}`;
}

/** Signed byte delta, e.g. `+3,660` / `-12,004`. */
export function fmtDelta(n) {
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toLocaleString("en-US")}`;
}

export { statSync };
