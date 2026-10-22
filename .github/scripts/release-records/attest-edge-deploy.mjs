#!/usr/bin/env node
// Issue #4084 — attest a later reviewed deployment against an earlier pull
// request only after proving the current main SHA descends from its merge and
// the deployed selection exactly equals every concrete function it changed.

import { readFileSync } from "node:fs";
import {
  EDGE_SUPERSESSION_CONTEXT,
  edgeSupersessionVerdict,
  REPO,
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
      "User-Agent": "mingla-edge-supersession/4084",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
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

async function main() {
  if (env("GITHUB_REPOSITORY") !== REPO) throw new Error(`This attestation runs only on ${REPO}`);
  token = env("GITHUB_TOKEN");
  const number = Number(env("MINGLA_SUPERSEDES_PR"));
  if (!Number.isInteger(number) || number <= 0) throw new Error("MINGLA_SUPERSEDES_PR must be a pull request number");

  const currentSha = env("GITHUB_SHA");
  const runId = env("GITHUB_RUN_ID");
  const runUrl = `${env("GITHUB_SERVER_URL")}/${REPO}/actions/runs/${runId}`;
  const selected = readFileSync(env("MINGLA_DEPLOY_SELECTION_PATH"), "utf8").split(/\r?\n/).filter(Boolean);
  const pr = await gh("GET", `/repos/${REPO}/pulls/${number}`);
  const paths = await pullFiles(number);
  const comparison = await gh("GET", `/repos/${REPO}/compare/${pr.merge_commit_sha}...${currentSha}`);
  const verdict = edgeSupersessionVerdict({
    pr,
    paths,
    selected,
    compareStatus: comparison?.status,
    currentSha,
    preflightOnly: env("MINGLA_PREFLIGHT_ONLY") === "true",
  });
  if (!verdict.ok) throw new Error(`Edge supersession refused: ${verdict.reason}`);

  const description = `Later reviewed run ${runId} deployed all ${verdict.expected.length} changed edge functions`;
  if (description.length > 140) throw new Error("The edge supersession status description is too long");
  await gh("POST", `/repos/${REPO}/statuses/${pr.merge_commit_sha}`, {
    state: "success",
    context: EDGE_SUPERSESSION_CONTEXT,
    description,
    target_url: runUrl,
  });
  console.log(`PASS edge supersession: PR #${number} <- run ${runId} (${verdict.expected.join(", ")})`);
}

main().catch((error) => {
  console.error(`FAIL edge supersession: ${error.message}`);
  process.exitCode = 1;
});
