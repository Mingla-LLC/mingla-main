#!/usr/bin/env node
// Issue #3980 — the PR links check (G4). Every pull request description has
// an issue link and a "Feature Guide:" line. For its first week after landing
// the check only reminds (one comment, updated in place); after that it fails
// when a line is missing. A pull request opened before the check landed, and
// any bot's pull request, never fails.
//
// Reads GITHUB_EVENT_PATH, GITHUB_TOKEN and GITHUB_REPOSITORY only. Talks to
// the GitHub REST API with fetch. Pull request text is data: never executed.

import { readFileSync } from "node:fs";
import { PR_LINKS_MARKER, prLinksVerdict, REPO } from "./lib.mjs";

const API = "https://api.github.com";
const SELF = ".github/scripts/release-records/pr-links.mjs";

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function gh(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mingla-pr-links/3980",
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
  return { status: res.status, json };
}

/** When this check landed: the oldest commit on main that touched this file. */
async function landedAt(token) {
  let r;
  try {
    r = await gh(token, "GET", `/repos/${REPO}/commits?sha=main&path=${encodeURIComponent(SELF)}&per_page=100`);
  } catch (error) {
    console.log(`pr-links: could not read when this check landed (${error.message}); reminding only for this run`);
    return null;
  }
  if (r.status !== 200 || !Array.isArray(r.json) || r.json.length === 0) {
    console.log(`pr-links: could not read when this check landed (HTTP ${r.status}); reminding only for this run`);
    return null;
  }
  const oldest = r.json[r.json.length - 1];
  return oldest?.commit?.committer?.date ?? oldest?.commit?.author?.date ?? null;
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== REPO) {
    console.log(`pr-links: runs only on ${REPO}; nothing to do`);
    return 0;
  }
  const token = env("GITHUB_TOKEN");
  const event = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8"));
  const pr = event.pull_request;
  if (!pr || !Number.isInteger(pr.number)) {
    console.log("pr-links: not a pull request event; nothing to do");
    return 0;
  }
  const verdict = prLinksVerdict({
    title: pr.title,
    body: pr.body,
    author: { login: pr.user?.login ?? "", type: pr.user?.type },
    createdAt: pr.created_at,
    landedAt: await landedAt(token),
    now: new Date().toISOString(),
  });
  console.log(`pr-links: PR #${pr.number} phase=${verdict.phase} missing=${verdict.missing.length}`);
  if (!verdict.comment) return 0;

  // The comment is a courtesy: a GitHub hiccup here never changes the verdict.
  try {
    const list = await gh(token, "GET", `/repos/${REPO}/issues/${pr.number}/comments?per_page=100`);
    const mine = Array.isArray(list.json)
      ? list.json.find((c) => c?.user?.login === "github-actions[bot]" && String(c.body ?? "").includes(PR_LINKS_MARKER))
      : undefined;
    const body = `${PR_LINKS_MARKER}\n${verdict.words}\n`;
    if (mine) {
      if (mine.body !== body) {
        const r = await gh(token, "PATCH", `/repos/${REPO}/issues/comments/${mine.id}`, { body });
        console.log(`pr-links: updated the reminder (HTTP ${r.status})`);
      }
    } else if (verdict.missing.length > 0) {
      const r = await gh(token, "POST", `/repos/${REPO}/issues/${pr.number}/comments`, { body });
      console.log(`pr-links: posted the reminder (HTTP ${r.status})`);
    }
  } catch (error) {
    console.log(`pr-links: the reminder comment could not be written: ${error.message}`);
  }
  if (!verdict.ok) {
    console.log(verdict.words);
    return 1;
  }
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}, (error) => {
  console.log(`pr-links: stopped: ${error.message}`);
  process.exitCode = 1;
});
