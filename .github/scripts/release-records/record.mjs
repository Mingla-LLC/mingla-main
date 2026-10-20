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
  migrationsAdded,
  parseFeatureGuide,
  parseIssueRefs,
  recordCommentFor,
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

/** The first page and, when there are more, the last page of an issue's comments. */
async function issueComments(number) {
  const first = await gh("GET", `/repos/${REPO}/issues/${number}/comments?per_page=100`);
  const out = Array.isArray(first.json) ? [...first.json] : [];
  const last = lastPage(first.link);
  if (last > 1) {
    const tail = await gh("GET", `/repos/${REPO}/issues/${number}/comments?per_page=100&page=${last}`);
    if (Array.isArray(tail.json)) out.push(...tail.json);
  }
  return out;
}

/** Which of the five events this payload is, read from its shape. */
function eventKind(event) {
  if (event?.workflow_run) return "workflow_run";
  if (event?.comment && event?.issue) return "issue_comment";
  if (event?.pull_request) return "pull_request_target";
  if (event?.inputs && Object.hasOwn(event.inputs, "pr")) return "workflow_dispatch";
  if (typeof event?.sha === "string" && typeof event?.context === "string") return "status";
  return "unknown";
}

/** The merged pull request this event is about, or null. */
async function resolvePr(eventName, event) {
  if (eventName === "pull_request_target") return event.pull_request?.merged ? event.pull_request.number : null;
  if (eventName === "workflow_dispatch") {
    const n = Number(event.inputs?.pr);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  if (eventName === "issue_comment") {
    const comments = await issueComments(event.issue.number);
    for (const c of comments.reverse()) {
      if (c?.user?.login !== "github-actions[bot]") continue;
      const m = new RegExp(`<!-- ${RECORD_MARKER_PREFIX}(\\d+) -->`).exec(String(c.body ?? ""));
      if (m) return Number(m[1]);
    }
    return null;
  }
  const sha = eventName === "status" ? event.sha : eventName === "workflow_run" ? event.workflow_run?.head_sha : null;
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
  const number = await resolvePr(eventName, event);
  if (!number) {
    console.log(`release-record: no merged pull request for this ${eventName} event; nothing to do`);
    return 0;
  }
  const prRes = await gh("GET", `/repos/${REPO}/pulls/${number}`);
  const pr = prRes.json;
  if (prRes.status !== 200 || !pr?.merged_at || pr?.base?.ref !== "main" || !/^[0-9a-f]{40}$/.test(pr?.merge_commit_sha ?? "")) {
    console.log(`release-record: PR #${number} is not merged into main; nothing to do`);
    return 0;
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
  const checkRes = await gh("GET", `/repos/${REPO}/commits/${sha}/check-runs?per_page=100`);
  const checks = Array.isArray(checkRes.json?.check_runs) ? checkRes.json.check_runs : [];
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
    const r = await gh("GET", `/repos/${REPO}/issues/${t}/comments?since=${encodeURIComponent(pr.merged_at)}&per_page=100`);
    for (const c of Array.isArray(r.json) ? r.json : []) {
      if (!String(c.body ?? "").startsWith("Live check:") || !TRUSTED.has(c.author_association)) continue;
      if (Date.parse(c.created_at) < Date.parse(pr.merged_at)) continue;
      if (!live || Date.parse(c.created_at) > Date.parse(live.at)) {
        live = {
          text: visible(String(c.body).slice("Live check:".length), 500),
          by_login: c.user?.login ?? "",
          url: c.html_url,
          at: c.created_at,
        };
      }
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
  const body = renderRecord(data);

  const written = [];
  for (const t of targets) {
    const existing = recordCommentFor(await issueComments(t), number);
    if (existing) {
      if (existing.body === body) continue;
      const r = await gh("PATCH", `/repos/${REPO}/issues/comments/${existing.id}`, { body });
      written.push(`#${t} updated (HTTP ${r.status})`);
    } else {
      const r = await gh("POST", `/repos/${REPO}/issues/${t}/comments`, { body });
      written.push(`#${t} created (HTTP ${r.status})`);
    }
  }
  console.log(`release-record: PR #${number}: ${written.length > 0 ? written.join(", ") : "unchanged"}`);
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}, (error) => {
  console.log(`release-record: stopped: ${error.message}`);
  process.exitCode = 1;
});
