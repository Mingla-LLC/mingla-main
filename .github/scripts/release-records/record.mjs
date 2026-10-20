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
  hasDeployMarker,
  isTestFile,
  mergeRecordData,
  migrationsAdded,
  parseFeatureGuide,
  parseIssueRefs,
  readRecordData,
  recordCommentsFor,
  RECORD_MARKER_PREFIX,
  recordProblems,
  renderRecord,
  REPO,
  visible,
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
 * carries this run's record (keeping the newest live check any of them
 * held), and every later one is deleted (or, if GitHub
 * refuses the delete, emptied of its marker so it is no longer a record).
 * Every racing run converges on the same survivor.
 */
async function settle(issue, number, data) {
  const mine = recordCommentsFor(await issueComments(issue), number);
  if (mine.length <= 1) return mine.length === 1 ? "" : "missing";
  const [keep, ...extra] = mine;
  // The survivor carries the newest live check the racing records held.
  const body = renderRecord(await keepLiveChecks(data, mine));
  if (keep.body !== body) await gh("PATCH", `/repos/${REPO}/issues/comments/${keep.id}`, { body });
  for (const c of extra) {
    const del = await gh("DELETE", `/repos/${REPO}/issues/comments/${c.id}`);
    if (del.status === 204) continue;
    // Not deleted by this run (refused, or the other run got there first):
    // take the marker out, so it is not a record either way.
    await gh("PATCH", `/repos/${REPO}/issues/comments/${c.id}`, {
      body: `A second release record for PR #${number} was written at the same time; the record is ${keep.html_url ?? "the earlier comment"}.`,
    });
  }
  return ` (${extra.length} duplicate${extra.length === 1 ? "" : "s"} removed)`;
}

/** A trusted person's "Live check:" comment made after the merge, as the record keeps it, or null. */
function liveCheckFrom(c, mergedAt) {
  if (!c || !String(c.body ?? "").startsWith("Live check:") || !TRUSTED.has(c.author_association)) return null;
  if (!(Date.parse(c.created_at) >= Date.parse(mergedAt))) return null;
  return {
    text: visible(String(c.body).slice("Live check:".length), 500),
    by_login: c.user?.login ?? "",
    url: c.html_url,
    at: c.created_at,
  };
}

/**
 * #3980 W2 rework: this run's record, keeping a newer live check that a
 * record already on the issue holds. Runs in different queues (a "Live
 * check:" comment and a deploy status for the same merge) can each read the
 * comments before the other wrote, so the later writer must not drop the
 * live check it never saw. The live check is kept only when its comment is
 * still there and still counts (read again from GitHub): a deleted or edited
 * comment stops counting.
 */
async function keepLiveChecks(data, records) {
  let out = data;
  for (const c of records) {
    const prev = readRecordData(c.body)?.live_check;
    if (!prev || typeof prev.url !== "string" || prev.url === out.live_check?.url) continue;
    if (out.live_check && !(Date.parse(prev.at) > Date.parse(out.live_check.at))) continue;
    const m = /^https:\/\/github\.com\/Mingla-LLC\/mingla-main\/(?:issues|pull)\/\d+#issuecomment-(\d+)$/.exec(prev.url);
    if (!m) continue;
    const r = await gh("GET", `/repos/${REPO}/issues/comments/${m[1]}`);
    const check = r.status === 200 ? liveCheckFrom(r.json, data.merged_at) : null;
    if (check && check.url === prev.url) out = mergeRecordData(out, { pr: out.pr, live_check: check });
  }
  return out;
}

const STABLE_ROUNDS = 3;

/** The newest trusted "Live check:" comment made after the merge, or null. */
function newestLiveCheck(comments, mergedAt) {
  let live = null;
  for (const c of comments) {
    const check = liveCheckFrom(c, mergedAt);
    if (check && (!live || Date.parse(check.at) > Date.parse(live.at))) live = check;
  }
  return live;
}

/**
 * #3980 W2 rework 2: after writing, read the record back and merge again
 * until it holds, at most three rounds. Another run (a "Live check:" comment
 * and a deploy status for the same merge) can write between this run's last
 * read and its write; the write then overwrites a live check this run never
 * saw. Each round reads every comment again, keeps the newest live check
 * from the "Live check:" comments and from the records on the issue, and
 * writes only when the record differs. Returns the rounds that wrote, as
 * words for the log.
 */
async function stabilize(issue, number, data) {
  let out = data;
  for (let round = 1; round <= STABLE_ROUNDS; round += 1) {
    const comments = await issueComments(issue);
    const mine = recordCommentsFor(comments, number);
    if (mine.length === 0) return " (record gone on re-read)";
    const fresh = newestLiveCheck(comments, out.merged_at);
    let next = fresh ? mergeRecordData(out, { pr: out.pr, live_check: fresh }) : out;
    next = await keepLiveChecks(next, mine);
    const body = renderRecord(next);
    if (mine.length === 1 && mine[0].body === body) return round === 1 ? "" : ` (re-merged ${round - 1}x)`;
    if (mine.length > 1) await settle(issue, number, next);
    else await gh("PATCH", `/repos/${REPO}/issues/comments/${mine[0].id}`, { body });
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
  const merged = Array.isArray(r.json)
    ? r.json.find((p) => p?.merged_at && p?.base?.ref === "main" && p?.merge_commit_sha === sha)
    : null;
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
  for (const number of numbers) await refresh(number);
  return 0;
}

/** Writes or refreshes the record of one merged pull request. */
async function refresh(number) {
  const prRes = await gh("GET", `/repos/${REPO}/pulls/${number}`);
  const pr = prRes.json;
  if (prRes.status !== 200 || !pr?.merged_at || pr?.base?.ref !== "main" || !/^[0-9a-f]{40}$/.test(pr?.merge_commit_sha ?? "")) {
    console.log(`release-record: PR #${number} is not merged into main; nothing to do`);
    return;
  }
  const sha = pr.merge_commit_sha;
  const commit = await gh("GET", `/repos/${REPO}/commits/${sha}`);
  const subject = String(commit.json?.commit?.message ?? "").split("\n")[0];

  const files = [];
  for (let page = 1; page <= 3; page += 1) {
    const r = await gh("GET", `/repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(r.json) || r.json.length === 0) break;
    files.push(...r.json.map((f) => ({ filename: f.filename, status: f.status })));
    if (r.json.length < 100) break;
  }
  const paths = files.map((f) => f.filename);
  const status = await gh("GET", `/repos/${REPO}/commits/${sha}/status?per_page=100`);
  const statuses = Array.isArray(status.json?.statuses) ? status.json.statuses : [];
  // A merge commit carries well over 100 check runs; read them all (up to
  // five pages) so Vercel's own run is never missed.
  const checks = [];
  for (let page = 1; page <= 5; page += 1) {
    const r = await gh("GET", `/repos/${REPO}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    const list = Array.isArray(r.json?.check_runs) ? r.json.check_runs : [];
    checks.push(...list);
    if (list.length < 100) break;
  }
  const runRes = await gh("GET", `/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=20`);
  const edgeRuns = Array.isArray(runRes.json?.workflow_runs) ? runRes.json.workflow_runs : [];

  // Linked issues: drop pull requests and numbers that do not exist.
  const issues = [];
  for (const ref of parseIssueRefs(pr.title, pr.body)) {
    if (ref.number === number) continue;
    const r = await gh("GET", `/repos/${REPO}/issues/${ref.number}`);
    if (r.status !== 200 || r.json?.pull_request) continue;
    issues.push(ref);
  }
  const targets = issues.length > 0 ? issues.map((i) => i.number) : [number];

  // The newest "Live check:" comment by a trusted person on a target.
  let live = null;
  for (const t of targets) {
    const since = [];
    const first = await gh("GET", `/repos/${REPO}/issues/${t}/comments?since=${encodeURIComponent(pr.merged_at)}&per_page=100`);
    if (Array.isArray(first.json)) since.push(...first.json);
    for (let page = 2; page <= Math.min(lastPage(first.link), MAX_COMMENT_PAGES); page += 1) {
      const r = await gh("GET", `/repos/${REPO}/issues/${t}/comments?since=${encodeURIComponent(pr.merged_at)}&per_page=100&page=${page}`);
      if (Array.isArray(r.json)) since.push(...r.json);
    }
    for (const c of since) {
      const check = liveCheckFrom(c, pr.merged_at);
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
    feature_guide: guide.kind === "keys" ? guide.keys : guide.kind === "none" ? [] : null,
    ...(guide.kind === "invalid" ? { feature_guide_bad: guide.bad } : {}),
    live_check: live,
    test_files: paths.filter(isTestFile).slice(0, 50),
    problems: [],
  };
  data.problems = recordProblems(data);

  // One record per pull request per issue. The comments are read in full
  // right before writing: an existing record is updated, never duplicated;
  // a new one is checked again after posting, in case another run (a push
  // and a Vercel status for the same merge) posted at the same moment.
  const written = [];
  const failed = [];
  for (const t of targets) {
    const mine = recordCommentsFor(await issueComments(t), number);
    const existing = mine[0];
    // Merged with what is on the issue now, so a live check another run
    // wrote since this run read the comments is kept.
    const merged = await keepLiveChecks(data, mine);
    const body = renderRecord(merged);
    if (existing) {
      if (existing.body !== body) {
        const r = await gh("PATCH", `/repos/${REPO}/issues/comments/${existing.id}`, { body });
        written.push(`#${t} updated (HTTP ${r.status})`);
      }
      if (mine.length > 1) written.push(`#${t}${await settle(t, number, merged)}`);
    } else {
      const r = await gh("POST", `/repos/${REPO}/issues/${t}/comments`, { body });
      if (r.status !== 201) {
        written.push(`#${t} created (HTTP ${r.status})`);
        failed.push(t);
        continue;
      }
      written.push(`#${t} created (HTTP ${r.status})${await settle(t, number, merged)}`);
    }
    // Read back and merge again, so a live check written in the window
    // between this run's read and its write is never lost.
    const settled = await stabilize(t, number, merged);
    if (settled) written.push(`#${t}${settled}`);
  }
  console.log(`release-record: PR #${number}: ${written.length > 0 ? written.join(", ") : "unchanged"}`);
  if (failed.length > 0) throw new Error(`GitHub refused the record on ${failed.map((t) => `#${t}`).join(", ")}`);
}

main().then((code) => {
  process.exitCode = code;
}, (error) => {
  console.log(`release-record: stopped: ${error.message}`);
  process.exitCode = 1;
});
