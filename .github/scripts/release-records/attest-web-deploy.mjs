#!/usr/bin/env node
// Issue #4084 — attest a later reviewed Vercel deployment against an earlier
// pull request only after proving exact current-main ancestry, [deploy], full
// project coverage and newest READY evidence from Vercel itself.

import {
  REPO,
  WEB_SUPERSESSION_CONTEXT,
  webSupersessionVerdict,
} from "./lib.mjs";

const API = "https://api.github.com";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let token = "";

async function gh(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mingla-web-supersession/4084",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub refused ${method} ${path} (HTTP ${response.status})`);
  }
  return json;
}

async function pullFiles(number) {
  const files = [];
  for (let page = 1; page <= 30; page += 1) {
    const list = await gh("GET", `/repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(list)) throw new Error("GitHub returned a malformed pull-request file list");
    files.push(...list.map((item) => String(item?.filename ?? "")));
    if (list.length < 100) return files;
  }
  throw new Error("The pull-request file list is truncated");
}

async function checkRuns(sha) {
  const out = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await gh("GET", `/repos/${REPO}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    if (!Array.isArray(response?.check_runs)) throw new Error("GitHub returned malformed check runs");
    out.push(...response.check_runs);
    if (response.check_runs.length < 100) return out;
  }
  throw new Error("The successor check-run list is truncated");
}

async function main() {
  if (env("GITHUB_REPOSITORY") !== REPO) throw new Error(`This attestation runs only on ${REPO}`);
  if (env("GITHUB_REF") !== "refs/heads/main") throw new Error("Web supersession must run from main");
  token = env("GITHUB_TOKEN");
  const targetNumber = Number(env("MINGLA_TARGET_PR"));
  const successorNumber = Number(env("MINGLA_SUPERSEDING_WEB_PR"));
  if (![targetNumber, successorNumber].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error("Both web supersession pull request inputs must be positive integers");
  }

  const currentSha = env("GITHUB_SHA");
  const runId = env("GITHUB_RUN_ID");
  const runUrl = `${env("GITHUB_SERVER_URL")}/${REPO}/actions/runs/${runId}`;
  const [targetPr, successorPr, main] = await Promise.all([
    gh("GET", `/repos/${REPO}/pulls/${targetNumber}`),
    gh("GET", `/repos/${REPO}/pulls/${successorNumber}`),
    gh("GET", `/repos/${REPO}/branches/main`),
  ]);
  const [targetPaths, successorPaths, successorCommit, successorStatus, successorCheckRuns, targetCompare, currentCompare] = await Promise.all([
    pullFiles(targetNumber),
    pullFiles(successorNumber),
    gh("GET", `/repos/${REPO}/commits/${successorPr.merge_commit_sha}`),
    gh("GET", `/repos/${REPO}/commits/${successorPr.merge_commit_sha}/status?per_page=100`),
    checkRuns(successorPr.merge_commit_sha),
    gh("GET", `/repos/${REPO}/compare/${targetPr.merge_commit_sha}...${successorPr.merge_commit_sha}`),
    gh("GET", `/repos/${REPO}/compare/${successorPr.merge_commit_sha}...${currentSha}`),
  ]);
  const verdict = webSupersessionVerdict({
    targetPr,
    targetPaths,
    successorPr,
    successorPaths,
    successorSubject: String(successorCommit?.commit?.message ?? "").split("\n")[0],
    successorStatuses: successorStatus?.statuses,
    successorChecks: successorCheckRuns,
    targetToSuccessorStatus: targetCompare?.status,
    successorToCurrentStatus: currentCompare?.status,
    currentSha,
    mainHeadSha: main?.commit?.sha,
  });
  if (!verdict.ok) throw new Error(`Web supersession refused: ${verdict.reason}`);

  const description = `Later PR ${successorNumber} deployed all ${verdict.expected.length} changed web projects`;
  if (description.length > 140) throw new Error("The web supersession status description is too long");
  await gh("POST", `/repos/${REPO}/statuses/${targetPr.merge_commit_sha}`, {
    state: "success",
    context: WEB_SUPERSESSION_CONTEXT,
    description,
    target_url: runUrl,
  });
  console.log(`PASS web supersession: PR #${targetNumber} <- PR #${successorNumber} (${verdict.expected.join(", ")})`);
}

main().catch((error) => {
  console.error(`FAIL web supersession: ${error.message}`);
  process.exitCode = 1;
});
