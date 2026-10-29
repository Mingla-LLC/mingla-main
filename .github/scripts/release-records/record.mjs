#!/usr/bin/env node
// Issue #3980 — the merge bot (G3, G6). When a pull request merges into main,
// and again whenever its deploys, the production migrations status or a live
// check change, it writes one release-record comment on each linked issue (on
// the pull request itself when none is linked), updated in place. It is the
// only writer of those comments; Mingla reads them back.
//
// Reads GITHUB_EVENT_PATH, GITHUB_TOKEN and GITHUB_REPOSITORY only. Talks to
// the GitHub REST API with fetch. Pull request text is data: never executed.

import { readFileSync } from "node:fs";
import {
  deployState,
  edgeFunctions,
  edgeSupersessionStatus,
  hasDeployMarker,
  isTestFile,
  mergeRecordData,
  migrationsAdded,
  parseFeatureGuide,
  parseIssueRefs,
  originalEdgeDeployState,
  originalWebDeployState,
  readRecordData,
  recordCommentsFor,
  RECORD_MARKER_PREFIX,
  recordProblems,
  renderRecord,
  REPO,
  visible,
  webSupersessionStatus,
  webProjects,
} from "./lib.mjs";

const API = "https://api.github.com";
const MIGRATIONS_CONTEXT = "mingla/production-migrations";
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let TOKEN = "";

async function gh(method, path, body) {
  const res = await fetch(path.startsWith("https://") ? path : `${API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mingla-release-records/3980",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, link: res.headers.get("link") ?? "" };
}

const lastPage = (link) => {
  const m = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return m ? Number(m[1]) : 1;
};

const MAX_COMMENT_PAGES = 50;
// GitHub lists at most 3,000 files of a pull request (30 pages of 100).
const MAX_FILE_PAGES = 30;

/**
 * #3980 W2 rework 4: a GitHub read that did not answer 200 (with the shape
 * asked for) is an error, never "nothing there": an error read as an empty
 * file list would record "migrations applied: none" and let the issue turn
 * Live before its migration is applied. Only the answers that really mean
 * "not there" are passed in `gone` (a 404 for a pull request, issue or
 * comment that does not exist); every other answer throws.
 */
class GitHubReadError extends Error {}

function ok(r, what, { gone = [], shape = () => true } = {}) {
  if (gone.includes(r.status)) return false;
  if (r.status !== 200 || !shape(r.json)) {
    throw new GitHubReadError(`GitHub did not answer the read of ${what} (HTTP ${r.status})`);
  }
  return true;
}

/** A write GitHub did not accept is an error too (expected status, or 200). */
function wrote(r, what, want = 200) {
  if (r.status !== want) throw new Error(`GitHub refused ${what} (HTTP ${r.status})`);
  return r;
}

/** Errors this run met while reading back; the run ends non-zero if any. */
const readBackErrors = [];

/**
 * Every comment of an issue, all pages, oldest first. A page GitHub does not
 * answer stops the run: an incomplete list could hide the record comment and
 * make the bot post a second one.
 */
async function issueComments(number) {
  const first = await gh("GET", `/repos/${REPO}/issues/${number}/comments?per_page=100`);
  if (first.status !== 200 || !Array.isArray(first.json)) {
    throw new Error(`could not read the comments of #${number} (HTTP ${first.status})`);
  }
  const out = [...first.json];
  const last = Math.min(lastPage(first.link), MAX_COMMENT_PAGES);
  for (let page = 2; page <= last; page += 1) {
    const r = await gh("GET", `/repos/${REPO}/issues/${number}/comments?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) {
      throw new Error(`could not read page ${page} of the comments of #${number} (HTTP ${r.status})`);
    }
    out.push(...r.json);
  }
  return out;
}

/**
 * After a write, the issue keeps exactly one record comment for the pull
 * request even when two runs raced: the oldest record comment stays and
 * carries this run's record merged with all of them (mergeRecords), and
 * every later one is deleted (or, if GitHub
 * refuses the delete, emptied of its marker so it is no longer a record).
 * Every racing run converges on the same survivor.
 */
async function settle(issue, number, data) {
  const mine = recordCommentsFor(await issueComments(issue), number);
  if (mine.length <= 1) return mine.length === 1 ? "" : "missing";
  const [keep, ...extra] = mine;
  // The survivor carries every field the racing records held (forward only).
  const body = renderRecord(await mergeRecords(data, mine));
  if (keep.body !== body) wrote(await gh("PATCH", `/repos/${REPO}/issues/comments/${keep.id}`, { body }), `the update of comment ${keep.id}`);
  for (const c of extra) {
    const del = await gh("DELETE", `/repos/${REPO}/issues/comments/${c.id}`);
    if (del.status === 204) continue;
    // Not deleted by this run (refused, or the other run got there first):
    // take the marker out, so it is not a record either way.
    const r = await gh("PATCH", `/repos/${REPO}/issues/comments/${c.id}`, {
      body: `A second release record for PR #${number} was written at the same time; the record is ${keep.html_url ?? "the earlier comment"}.`,
    });
    // Gone already (the other run deleted it) is fine; anything else leaves a duplicate.
    if (r.status !== 404) wrote(r, `the clean-up of duplicate comment ${c.id}`);
  }
  return ` (${extra.length} duplicate${extra.length === 1 ? "" : "s"} removed)`;
}

// Whether a comment's author may record a live check. author_association is
// the first answer, but through the Actions token a member whose organisation
// membership is private reads as CONTRIBUTOR or NONE, so anyone else is asked
// about once: write access or above to the repository counts. A GitHub error
// is an error, never a quiet "not trusted".
const PERMITTED = new Set(["admin", "maintain", "write"]);
const permissionCache = new Map();
async function trustedAuthor(c) {
  if (TRUSTED.has(c?.author_association)) return true;
  const login = String(c?.user?.login ?? "");
  if (!login || c?.user?.type === "Bot" || login.endsWith("[bot]")) return false;
  if (!permissionCache.has(login)) {
    const r = await gh("GET", `/repos/${REPO}/collaborators/${encodeURIComponent(login)}/permission`);
    const known = ok(r, `the repository permission of ${login}`, { gone: [404], shape: (j) => j && typeof j.permission === "string" });
    permissionCache.set(login, known ? PERMITTED.has(r.json.permission) : false);
  }
  return permissionCache.get(login);
}

/** A trusted person's "Live check:" comment made after the merge, as the record keeps it, or null. */
async function liveCheckFrom(c, mergedAt) {
  if (!c || !String(c.body ?? "").startsWith("Live check:")) return null;
  if (!(await trustedAuthor(c))) return null;
  if (!(Date.parse(c.created_at) >= Date.parse(mergedAt))) return null;
  return {
    text: visible(String(c.body).slice("Live check:".length), 500),
    by_login: c.user?.login ?? "",
    url: c.html_url,
    at: c.created_at,
  };
}

/**
 * #3980 W2 rework: this run's record merged with every record already on the
 * issue. Runs in different queues (a "Live check:" comment, a deploy status
 * and the production migrations status for the same merge) can each read the
 * comments before another wrote, so the later writer must not drop news it
 * never saw. W2 rework 3: every field, not only the live check
 * (mergeRecordData: forward only, pending -> value, and a field only the
 * other record has survives). The records are the bot's own comments. A live
 * check is kept only when its comment is still there and still counts (read
 * again from GitHub): a deleted or edited comment stops counting.
 */
async function mergeRecords(data, records) {
  let out = data;
  for (const c of records) {
    const prev = readRecordData(c.body);
    if (!prev || prev.pr !== out.pr) continue;
    // Every field but the live check, which is checked against GitHub below.
    out = mergeRecordData(out, { ...prev, live_check: null });
    const lc = prev.live_check;
    if (!lc || typeof lc.url !== "string" || lc.url === out.live_check?.url) continue;
    if (out.live_check && !(Date.parse(lc.at) > Date.parse(out.live_check.at))) continue;
    const m = /^https:\/\/github\.com\/Mingla-LLC\/mingla-main\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(lc.url);
    if (!m) continue;
    const r = await gh("GET", `/repos/${REPO}/issues/comments/${m[1]}`);
    // A deleted comment (404) stops counting; a GitHub error is not news.
    const check = ok(r, `comment ${m[1]}`, { gone: [404], shape: (j) => j && typeof j === "object" }) ? await liveCheckFrom(r.json, data.merged_at) : null;
    if (check && check.url === lc.url) out = mergeRecordData(out, { pr: out.pr, live_check: check });
  }
  return out;
}

const STABLE_ROUNDS = 3;

/** The newest trusted "Live check:" comment made after the merge, or null. */
async function newestLiveCheck(comments, mergedAt) {
  let live = null;
  for (const c of comments) {
    const check = await liveCheckFrom(c, mergedAt);
    if (check && (!live || Date.parse(check.at) > Date.parse(live.at))) live = check;
  }
  return live;
}

/**
 * #3980 W2 rework 2: after writing, read the record back and merge again
 * until it holds, at most three rounds. Another run (a "Live check:" comment,
 * a deploy status or the migrations status for the same merge) can write
 * between this run's last read and its write; the write then overwrites news
 * this run never saw. Each round reads every comment again and (W2 rework 3)
 * what GitHub says now about the pull request (collect), keeps the newest
 * live check from the "Live check:" comments, merges every field of the
 * records on the issue forward only, and writes only when the record
 * differs. Returns the rounds that wrote, as words for the log.
 */
async function stabilize(issue, number, data) {
  let out = data;
  for (let round = 1; round <= STABLE_ROUNDS; round += 1) {
    const comments = await issueComments(issue);
    const mine = recordCommentsFor(comments, number);
    if (mine.length === 0) return " (record gone on re-read)";
    // W2 rework 3: what GitHub says now, kept forward only against what this
    // run wrote, then merged with every record on the issue.
    // W2 rework 4: when GitHub does not answer one of those reads, this run
    // keeps its own record for this round (never an emptier one), says so as
    // an ERROR, and the run ends non-zero.
    let now = null;
    try {
      now = await collect(number);
    } catch (error) {
      if (!(error instanceof GitHubReadError)) throw error;
      readBackErrors.push(`#${issue}: ${error.message}`);
      console.log(`release-record: ERROR: PR #${number}: re-reading GitHub for the record on #${issue} failed (${error.message}); this run's record is kept as it is.`);
    }
    let next = now ? mergeRecordData(now.data, out) : out;
    const fresh = await newestLiveCheck(comments, next.merged_at);
    if (fresh) next = mergeRecordData(next, { pr: next.pr, live_check: fresh });
    next = await mergeRecords(next, mine);
    const body = renderRecord(next);
    if (mine.length === 1 && mine[0].body === body) return round === 1 ? "" : ` (re-merged ${round - 1}x)`;
    if (mine.length > 1) await settle(issue, number, next);
    else wrote(await gh("PATCH", `/repos/${REPO}/issues/comments/${mine[0].id}`, { body }), `the update of comment ${mine[0].id}`);
    out = next;
  }
  return ` (still changing after ${STABLE_ROUNDS} re-reads)`;
}

/** Which of the five events this payload is, read from its shape. */
function eventKind(event) {
  if (event?.workflow_run) return "workflow_run";
  if (event?.comment && event?.issue) return "issue_comment";
  if (event?.pull_request) return "pull_request_target";
  if (typeof event?.ref === "string" && typeof event?.after === "string") return "push";
  if (event?.inputs && Object.hasOwn(event.inputs, "pr")) return "workflow_dispatch";
  if (typeof event?.sha === "string" && typeof event?.context === "string") return "status";
  return "unknown";
}

const MAX_LIVE_CHECK_RECORDS = 20;

/**
 * The merged pull requests this event is about (newest record first for a
 * comment), or an empty list. A "Live check:" comment refreshes every record
 * on its issue: each record then takes the newest trusted live check made
 * after its own merge, so the comment counts for each record it applies to.
 */
async function resolvePrs(eventName, event) {
  if (eventName === "issue_comment") {
    const seen = [];
    for (const c of (await issueComments(event.issue.number)).reverse()) {
      if (c?.user?.login !== "github-actions[bot]") continue;
      const m = new RegExp(`<!-- ${RECORD_MARKER_PREFIX}(\\d+) -->`).exec(String(c.body ?? ""));
      if (m && !seen.includes(Number(m[1]))) seen.push(Number(m[1]));
    }
    return seen.slice(0, MAX_LIVE_CHECK_RECORDS);
  }
  const one = await resolvePr(eventName, event);
  return one ? [one] : [];
}

/** The merged pull request this event is about, or null. */
async function resolvePr(eventName, event) {
  if (eventName === "pull_request_target") return event.pull_request?.merged ? event.pull_request.number : null;
  if (eventName === "push" && event.ref !== "refs/heads/main") return null;
  if (eventName === "workflow_dispatch") {
    const n = Number(event.inputs?.pr);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const sha = eventName === "status" ? event.sha
    : eventName === "workflow_run" ? event.workflow_run?.head_sha
    : eventName === "push" ? event.after
    : null;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return null;
  const r = await gh("GET", `/repos/${REPO}/commits/${sha}/pulls`);
  ok(r, `the pull requests of ${sha.slice(0, 7)}`, { shape: Array.isArray });
  const merged = r.json.find((p) => p?.merged_at && p?.base?.ref === "main" && p?.merge_commit_sha === sha);
  return merged ? merged.number : null;
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== REPO) {
    console.log(`release-record: runs only on ${REPO}; nothing to do`);
    return 0;
  }
  TOKEN = env("GITHUB_TOKEN");
  const event = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8"));
  const eventName = eventKind(event);
  const numbers = await resolvePrs(eventName, event);
  if (numbers.length === 0) {
    console.log(`release-record: no merged pull request for this ${eventName} event; nothing to do`);
    return 0;
  }
  // W2 rework 4: one pull request that fails does not stop the others; the
  // run ends non-zero at the end.
  const stopped = [];
  for (const number of numbers) {
    try {
      await refresh(number);
    } catch (error) {
      stopped.push(`PR #${number}: ${error.message}`);
      console.log(`release-record: ERROR: PR #${number}: ${error.message}`);
    }
  }
  if (readBackErrors.length > 0) {
    console.log(`release-record: ERROR: ${readBackErrors.length} GitHub read${readBackErrors.length === 1 ? "" : "s"} failed while reading records back; the records written keep this run's data. ${readBackErrors.join("; ")}`);
  }
  if (stopped.length > 0) throw new Error(stopped.join("; "));
  return readBackErrors.length > 0 ? 1 : 0;
}

/**
 * What GitHub says now about one merged pull request: its record data and
 * the issues the record goes on, or null when it is not merged into main.
 * #3980 W2 rework 3: read once before writing and again on every read-back
 * round, so news another run wrote and this run's write overwrote (the
 * production migrations status, a deploy, the Feature Guide line, a live
 * check) is read from its source again and written back.
 */
async function collect(number) {
  const prRes = await gh("GET", `/repos/${REPO}/pulls/${number}`);
  // A pull request that does not exist (404) has no record; any other
  // answer but 200 is an error (W2 rework 4), from here to the end.
  if (!ok(prRes, `pull request #${number}`, { gone: [404], shape: (j) => j && typeof j === "object" })) return null;
  const pr = prRes.json;
  if (!pr?.merged_at || pr?.base?.ref !== "main" || !/^[0-9a-f]{40}$/.test(pr?.merge_commit_sha ?? "")) {
    return null;
  }
  const sha = pr.merge_commit_sha;
  const commit = await gh("GET", `/repos/${REPO}/commits/${sha}`);
  ok(commit, `merge commit ${sha.slice(0, 7)}`, { shape: (j) => j && typeof j === "object" });
  const subject = String(commit.json?.commit?.message ?? "").split("\n")[0];

  // #3980 W2 follow-up: read the file list up to GitHub's own limit (30
  // pages of 100). A list cut short (the last page read still full, or fewer
  // files than the pull request says it changed) is an error, never a list:
  // a migration past the cut would be recorded as "migrations applied: none".
  const files = [];
  let lastFull = false;
  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const r = await gh("GET", `/repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`);
    ok(r, `page ${page} of the files of #${number}`, { shape: Array.isArray });
    lastFull = r.json.length >= 100;
    if (r.json.length === 0) break;
    files.push(...r.json.map((f) => ({ filename: f.filename, status: f.status })));
    if (!lastFull) break;
  }
  const changed = Number.isInteger(pr.changed_files) ? pr.changed_files : null;
  if (lastFull || (changed !== null && files.length < changed)) {
    throw new GitHubReadError(`the file list of #${number} is cut short (read ${files.length} file${files.length === 1 ? "" : "s"}${changed !== null ? ` of ${changed}` : ""}; GitHub lists at most ${MAX_FILE_PAGES * 100}), so its migrations cannot be known`);
  }
  const paths = files.map((f) => f.filename);
  const status = await gh("GET", `/repos/${REPO}/commits/${sha}/status?per_page=100`);
  ok(status, `the statuses of ${sha.slice(0, 7)}`, { shape: (j) => Array.isArray(j?.statuses) });
  const statuses = status.json.statuses;
  // A merge commit carries well over 100 check runs; read them all (up to
  // five pages) so Vercel's own run is never missed.
  const checks = [];
  for (let page = 1; page <= 5; page += 1) {
    const r = await gh("GET", `/repos/${REPO}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    ok(r, `page ${page} of the check runs of ${sha.slice(0, 7)}`, { shape: (j) => Array.isArray(j?.check_runs) });
    const list = r.json.check_runs;
    checks.push(...list);
    if (list.length < 100) break;
  }
  // A merge commit starts dozens of workflow runs (46 for #4022), so one page
  // of 20 missed the edge deploy run; read every page (up to five of 100).
  const edgeRuns = [];
  for (let page = 1; page <= 5; page += 1) {
    const r = await gh("GET", `/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=100&page=${page}`);
    ok(r, `page ${page} of the workflow runs of ${sha.slice(0, 7)}`, { shape: (j) => Array.isArray(j?.workflow_runs) });
    edgeRuns.push(...r.json.workflow_runs);
    if (r.json.workflow_runs.length < 100) break;
  }

  // Linked issues: drop pull requests and numbers that do not exist (404,
  // or 410 for a deleted issue). Any other answer is an error, never a
  // reason to drop the issue from the record.
  const issues = [];
  for (const ref of parseIssueRefs(pr.title, pr.body)) {
    if (ref.number === number) continue;
    const r = await gh("GET", `/repos/${REPO}/issues/${ref.number}`);
    if (!ok(r, `issue #${ref.number}`, { gone: [404, 410], shape: (j) => j && typeof j === "object" })) continue;
    if (r.json.pull_request) continue;
    issues.push(ref);
  }
  const targets = issues.length > 0 ? issues.map((i) => i.number) : [number];

  // The newest "Live check:" comment by a trusted person on a target.
  let live = null;
  for (const t of targets) {
    const since = [];
    const first = await gh("GET", `/repos/${REPO}/issues/${t}/comments?since=${encodeURIComponent(pr.merged_at)}&per_page=100`);
    ok(first, `the comments of #${t}`, { shape: Array.isArray });
    since.push(...first.json);
    for (let page = 2; page <= Math.min(lastPage(first.link), MAX_COMMENT_PAGES); page += 1) {
      const r = await gh("GET", `/repos/${REPO}/issues/${t}/comments?since=${encodeURIComponent(pr.merged_at)}&per_page=100&page=${page}`);
      ok(r, `page ${page} of the comments of #${t}`, { shape: Array.isArray });
      since.push(...r.json);
    }
    for (const c of since) {
      const check = await liveCheckFrom(c, pr.merged_at);
      if (check && (!live || Date.parse(check.at) > Date.parse(live.at))) live = check;
    }
  }

  const web = webProjects(paths);
  const edge = edgeFunctions(paths);
  const marker = hasDeployMarker(subject);
  const migrationStatus = statuses.find((s) => s.context === MIGRATIONS_CONTEXT);
  const added = migrationsAdded(files);
  const guide = parseFeatureGuide(pr.body);
  const data = {
    v: 1,
    repo: REPO,
    pr: number,
    title: visible(pr.title, 300),
    pr_url: `https://github.com/${REPO}/pull/${number}`,
    merged_at: pr.merged_at,
    merge_sha: sha,
    merged_by: pr.merged_by?.login ?? "",
    author: pr.user?.login ?? "",
    issues,
    migrations_added: added,
    migrations_applied_state: added.length === 0 ? "none"
      : migrationStatus?.state === "success" ? "applied" : "pending",
    migrations_status: migrationStatus ? visible(migrationStatus.description, 140) : null,
    edge_functions: edge,
    web_projects: web,
    deploy_marker: marker,
    deploy: deployState({ web, edge, marker, statuses, checks, edgeRuns }),
    web_original_state: originalWebDeployState({ web, marker, statuses, checks }),
    web_supersession: webSupersessionStatus(statuses),
    edge_original_state: originalEdgeDeployState(edge, edgeRuns),
    edge_supersession: edgeSupersessionStatus(statuses),
    feature_guide: guide.kind === "keys" ? guide.keys : guide.kind === "none" ? [] : null,
    feature_guide_reason: guide.kind === "none" ? guide.reason : null,
    ...(guide.kind === "invalid" ? { feature_guide_bad: guide.bad } : {}),
    live_check: live,
    test_files: paths.filter(isTestFile).slice(0, 50),
    problems: [],
  };
  data.problems = recordProblems(data);
  return { data, targets };
}

/** Writes or refreshes the record of one merged pull request. */
async function refresh(number) {
  const got = await collect(number);
  if (!got) {
    console.log(`release-record: PR #${number} is not merged into main; nothing to do`);
    return;
  }
  const { data, targets } = got;

  // One record per pull request per issue. The comments are read in full
  // right before writing: an existing record is updated, never duplicated;
  // a new one is checked again after posting, in case another run (a push
  // and a Vercel status for the same merge) posted at the same moment.
  const written = [];
  const failed = [];
  const unread = [];
  const unwritten = [];
  for (const t of targets) {
    // W2 rework 4: a GitHub read before the write that fails leaves this
    // issue's record as it was (nothing emptier is written), is said as an
    // ERROR, and the other issues still get theirs; the run ends non-zero.
    let mine;
    let merged;
    try {
      mine = recordCommentsFor(await issueComments(t), number);
      // Merged with what is on the issue now, so a live check another run
      // wrote since this run read the comments is kept.
      merged = await mergeRecords(data, mine);
    } catch (error) {
      unwritten.push(t);
      written.push(`#${t} not written, read failed`);
      console.log(`release-record: ERROR: PR #${number}: reading the record on #${t} before writing failed (${error.message}); it was left as it was.`);
      continue;
    }
    const existing = mine[0];
    const body = renderRecord(merged);
    if (existing) {
      if (existing.body !== body) {
        const r = await gh("PATCH", `/repos/${REPO}/issues/comments/${existing.id}`, { body });
        written.push(`#${t} updated (HTTP ${r.status})`);
        if (r.status !== 200) {
          failed.push(t);
          continue;
        }
      }
    } else {
      const r = await gh("POST", `/repos/${REPO}/issues/${t}/comments`, { body });
      if (r.status !== 201) {
        written.push(`#${t} created (HTTP ${r.status})`);
        failed.push(t);
        continue;
      }
      written.push(`#${t} created (HTTP ${r.status})`);
    }
    // #3980 W2 rework 3: the record is written. Reading it back (to remove a
    // duplicate a racing run posted, and to merge news written in the window
    // between this run's read and its write) can fail; that is said loudly,
    // the PR's other linked issues still get their record, and the run ends
    // non-zero.
    try {
      if (!existing) written[written.length - 1] += await settle(t, number, merged);
      else if (mine.length > 1) written.push(`#${t}${await settle(t, number, merged)}`);
      const settled = await stabilize(t, number, merged);
      if (settled) written.push(`#${t}${settled}`);
    } catch (error) {
      unread.push(t);
      written.push(`#${t} written, read-back failed`);
      console.log(`release-record: ERROR: PR #${number}: the record on #${t} was written but reading it back failed (${error.message}); a duplicate or a racing run's news may remain there until the next refresh. Carrying on with the other issues.`);
    }
  }
  console.log(`release-record: PR #${number}: ${written.length > 0 ? written.join(", ") : "unchanged"}`);
  const problems = [];
  if (failed.length > 0) problems.push(`GitHub refused the record on ${failed.map((t) => `#${t}`).join(", ")}`);
  if (unwritten.length > 0) problems.push(`GitHub could not be read before writing the record on ${unwritten.map((t) => `#${t}`).join(", ")}`);
  if (unread.length > 0) problems.push(`the record could not be read back on ${unread.map((t) => `#${t}`).join(", ")}`);
  if (problems.length > 0) throw new Error(problems.join("; "));
}

main().then((code) => {
  process.exitCode = code;
}, (error) => {
  console.log(`release-record: stopped: ${error.message}`);
  process.exitCode = 1;
});
