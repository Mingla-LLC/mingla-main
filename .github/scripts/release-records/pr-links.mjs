#!/usr/bin/env node
// Issue #3980 — the PR links check (G4). Every pull request description has
// an issue link and a "Feature Guide:" line. For its first week after landing
// the check only reminds (one comment, updated in place); after that it fails
// when a line is missing. A pull request opened before the check landed, and
// any bot's pull request, never fails.
//
// Reads GITHUB_EVENT_PATH, GITHUB_TOKEN and GITHUB_REPOSITORY only. Talks to
// the GitHub REST API with fetch. Pull request text is data: never executed.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  featureGuideCatalogFromContract,
  featureGuideCatalogFromSql,
  featureGuideImpactVerdict,
  mergeFeatureGuideCatalogs,
  parseFeatureGuide,
  PR_LINKS_MARKER,
  prLinksVerdict,
  REPO,
} from "./lib.mjs";

const API = "https://api.github.com";
const SELF = ".github/scripts/release-records/pr-links.mjs";
const MIGRATIONS = "supabase/migrations";
const IMPACT_CONTRACT = "docs/contracts/feature-guide-impact.json";
const MAX_FILE_PAGES = 30;

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

function baseCapabilityCatalog() {
  const sql = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => readFileSync(`${MIGRATIONS}/${entry.name}`, "utf8"));
  const sqlCatalog = featureGuideCatalogFromSql(sql);
  const contractCatalog = existsSync(IMPACT_CONTRACT)
    ? featureGuideCatalogFromContract(readFileSync(IMPACT_CONTRACT, "utf8"))
    : new Map();
  return { sqlCatalog, contractCatalog };
}

async function pullFiles(token, number, changedFiles) {
  const files = [];
  let lastFull = false;
  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const r = await gh(token, "GET", `/repos/${REPO}/pulls/${number}/files?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`files_page_${page}_http_${r.status}`);
    lastFull = r.json.length === 100;
    files.push(...r.json.filter((file) => typeof file?.filename === "string"));
    if (!lastFull) break;
  }
  if (lastFull || (Number.isInteger(changedFiles) && files.length < changedFiles)) {
    throw new Error(`files_incomplete_${files.length}_of_${changedFiles ?? "unknown"}`);
  }
  return files;
}

async function headMigrationSql(token, files, headSha) {
  const migrations = files.filter((file) => file.status !== "removed" && /^supabase\/migrations\/[^/]+[.]sql$/.test(file.filename));
  if (migrations.length > 50) throw new Error("too_many_changed_migrations");
  const out = [];
  for (const file of migrations) {
    const encoded = file.filename.split("/").map(encodeURIComponent).join("/");
    const r = await gh(token, "GET", `/repos/${REPO}/contents/${encoded}?ref=${encodeURIComponent(headSha)}`);
    if (r.status !== 200 || r.json?.encoding !== "base64" || typeof r.json?.content !== "string") {
      throw new Error(`migration_read_http_${r.status}`);
    }
    out.push(Buffer.from(r.json.content.replace(/\s/g, ""), "base64").toString("utf8"));
  }
  return out;
}

async function headImpactContract(token, files, headSha) {
  const changed = files.find((file) => file.filename === IMPACT_CONTRACT);
  if (!changed) return null;
  if (changed.status === "removed") throw new Error("feature_guide_contract_removed");
  const encoded = IMPACT_CONTRACT.split("/").map(encodeURIComponent).join("/");
  const r = await gh(token, "GET", `/repos/${REPO}/contents/${encoded}?ref=${encodeURIComponent(headSha)}`);
  if (r.status !== 200 || r.json?.encoding !== "base64" || typeof r.json?.content !== "string") {
    throw new Error(`feature_guide_contract_http_${r.status}`);
  }
  return featureGuideCatalogFromContract(Buffer.from(r.json.content.replace(/\s/g, ""), "base64").toString("utf8"));
}

async function impactVerdict(token, pr) {
  const files = await pullFiles(token, pr.number, pr.changed_files);
  const paths = files.map((file) => file.filename);
  const base = baseCapabilityCatalog();
  const migrationCatalog = featureGuideCatalogFromSql(await headMigrationSql(token, files, pr.head?.sha ?? ""));
  const headContract = await headImpactContract(token, files, pr.head?.sha ?? "");
  const baseCatalog = mergeFeatureGuideCatalogs(
    base.sqlCatalog,
    headContract ?? base.contractCatalog,
  );
  return featureGuideImpactVerdict({
    guide: parseFeatureGuide(pr.body),
    paths,
    baseCatalog,
    prCatalog: migrationCatalog,
    declaredKeys: migrationCatalog.keys(),
    knownKeys: [...base.sqlCatalog.keys(), ...migrationCatalog.keys()],
  });
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
  let verdict = prLinksVerdict({
    title: pr.title,
    body: pr.body,
    author: { login: pr.user?.login ?? "", type: pr.user?.type },
    createdAt: pr.created_at,
    landedAt: await landedAt(token),
    now: new Date().toISOString(),
  });
  if (verdict.phase !== "exempt" && verdict.missing.length === 0) {
    try {
      const impact = await impactVerdict(token, pr);
      console.log(`pr-links: PR #${pr.number} impact product_paths=${impact.productPaths?.length ?? 0} expected=${impact.expected?.length ?? 0} problems=${impact.problems.length}`);
      if (!impact.ok) {
        const missing = [...verdict.missing, "a complete Feature Guide impact classification"];
        verdict = {
          ...verdict,
          ok: verdict.phase !== "blocking" && verdict.ok,
          missing,
          comment: true,
          words: `The Feature Guide classification does not cover the changed product surface (${impact.problems.length} ${impact.problems.length === 1 ? "problem" : "problems"}). Name every affected capability key; use “Feature Guide: none — <reason>” only when no product-owned path changed. The check reads the versioned catalog and changed migrations, and fails closed when it cannot prove coverage.`,
        };
      }
    } catch (error) {
      console.log(`pr-links: PR #${pr.number} impact verification stopped (${error.message})`);
      verdict = {
        ...verdict,
        ok: false,
        missing: [...verdict.missing, "a verifiable Feature Guide impact classification"],
        comment: true,
        words: "The Feature Guide impact could not be verified from the complete changed-file list and versioned capability catalog. This check fails closed; rerun it after the GitHub read succeeds.",
      };
    }
  }
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
