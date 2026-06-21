#!/usr/bin/env node

/**
 * I-PROPOSED-1187-POSTHOG-HOST-US (META-ORCH-1187 [Growth Analytics Hub] Phase 1)
 *
 * WHY: PostHog ingestion region is dispatch-locked to the US cloud. Every
 * PostHog `init` across all surfaces MUST use the US host
 * `https://us.i.posthog.com`. A drift to `eu.i.posthog.com` or the legacy
 * `app.posthog.com` host would send Mingla's analytics to the wrong region /
 * project — a silent data-loss + compliance hazard.
 *
 * GATE:
 *   (1) Any file that calls `posthog.init(` MUST contain the literal
 *       `https://us.i.posthog.com`.
 *   (2) NO client source may reference `eu.i.posthog.com` or `app.posthog.com`.
 *
 * SCOPE: the client app trees (marketing now; buyer-web + native added in later
 * legs). Tests, gate scripts, and Mingla_Artifacts are exempt (they discuss the
 * hosts in prose).
 *
 * FAILS-ON-REVERT: deleting the US host literal from a posthog.init site, or
 * introducing an eu/app host, fails this gate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const SCAN_DIRS = ["mingla-marketing", "mingla-business", "app-mobile"];
const US_HOST = "https://us.i.posthog.com";
const FORBIDDEN_HOSTS = ["eu.i.posthog.com", "app.posthog.com"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function isExempt(relPath) {
  if (relPath.includes("__tests__")) return true;
  if (/\.test\.[tj]sx?$/.test(relPath)) return true;
  if (relPath.includes("node_modules")) return true;
  if (relPath.includes(".next/")) return true;
  if (relPath.startsWith(".github/")) return true;
  if (relPath.startsWith("Mingla_Artifacts/")) return true;
  return false;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(full, out);
    } else if (CODE_EXT.has(path.extname(e.name))) {
      out.push(full);
    }
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(repoRoot, d), files);

const missingUsHost = [];
const forbiddenHost = [];
let initSites = 0;

for (const file of files) {
  const rel = path.relative(repoRoot, file);
  if (isExempt(rel)) continue;
  const contents = fs.readFileSync(file, "utf8");

  if (FORBIDDEN_HOSTS.some((h) => contents.includes(h))) {
    forbiddenHost.push(rel);
  }

  if (/posthog\.init\s*\(/.test(contents)) {
    initSites++;
    if (!contents.includes(US_HOST)) {
      missingUsHost.push(rel);
    }
  }
}

if (missingUsHost.length > 0 || forbiddenHost.length > 0) {
  console.error("FAIL: I-PROPOSED-1187-POSTHOG-HOST-US violated");
  if (missingUsHost.length > 0) {
    console.error(
      `\n${missingUsHost.length} posthog.init site(s) missing the US host literal "${US_HOST}":`,
    );
    for (const f of missingUsHost) console.error(`  - ${f}`);
  }
  if (forbiddenHost.length > 0) {
    console.error(
      `\n${forbiddenHost.length} file(s) reference a FORBIDDEN PostHog host (${FORBIDDEN_HOSTS.join(", ")}):`,
    );
    for (const f of forbiddenHost) console.error(`  - ${f}`);
  }
  console.error(
    "\nEvery PostHog init MUST use https://us.i.posthog.com (META-ORCH-1187 region lock).",
  );
  process.exit(1);
}

console.log(
  `OK: I-PROPOSED-1187-POSTHOG-HOST-US — ${initSites} init site(s) scanned, all US-hosted, 0 forbidden hosts`,
);
