#!/usr/bin/env node
/**
 * ISSUE-866 — I-PROPOSED-866-CREATIVE-GUARDS (DRAFT until CLOSE).
 *
 * Two spec-mandated absences, enforced repo-wide (SPEC_ISSUE-866 Amendment A1):
 *
 *  G1 (A1-2): `SNAP_ACCESS_TOKEN` must appear NOWHERE. There is NO static Snap
 *     access token — it is minted per call from SNAPCHAT_REFRESH_TOKEN /
 *     SNAPCHAT_CLIENT_ID / SNAPCHAT_CLIENT_SECRET (proven live: PROOF_LOG
 *     S-P1). An adapter reading SNAP_ACCESS_TOKEN reads a secret that will
 *     never exist and FAILS CLOSED FOREVER — a silent, permanent Snap outage.
 *
 *  G2 (A1-1 / GR-14): the ad-engine platform enum is
 *     ('meta','tiktok','snapchat','google','reddit'). A bare 'snap' platform
 *     literal in the ad-engine creative/channel modules or their migrations
 *     silently breaks the ad_creative_platform_refs cache key and the CHECK.
 *     Scoped to the ad-engine files (repo-wide 'snap' would false-positive on
 *     unrelated code).
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * issue-862-ad-token-env-server-only.mjs).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ── G1: repo-wide forbidden token name ────────────────────────────────────────

const FORBIDDEN_TOKEN_NAME = "SNAP_ACCESS_TOKEN";

const G1_ROOTS = [
  "supabase/functions",
  "supabase/migrations",
  "mingla-admin/src",
  "app-mobile/src",
  "mingla-business/src",
  "mingla-business/app",
  "mingla-marketing",
  "packages",
  ".github/workflows",
];

// ── G2: ad-engine-scoped bare-'snap' platform literal ─────────────────────────

const G2_FILE_MATCH =
  /(adChannel|adCreative|adCreativeMatrix|adCreativeProbe|meta|tiktok|snapchat|google|reddit)\.ts$|admin-ad-[^/]*\/index\.ts$|issue_86[0-9]_.*\.sql$/;

const G2_ROOTS = ["supabase/functions", "supabase/migrations"];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".yml", ".yaml", ".toml"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "build") {
      continue;
    }
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) yield* walk(full);
    else if (SCAN_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) yield full;
  }
}

export const evaluateG1 = (filePath, code) => {
  // This gate file legitimately names the forbidden token to define it.
  if (filePath.endsWith("issue-866-creative-guards.mjs")) return [];
  const failures = [];
  if (code.includes(FORBIDDEN_TOKEN_NAME)) {
    failures.push(
      `${filePath}: references "${FORBIDDEN_TOKEN_NAME}" — no static Snap access token exists (A1-2). ` +
        `Mint per call via SNAPCHAT_REFRESH_TOKEN / SNAPCHAT_CLIENT_ID / SNAPCHAT_CLIENT_SECRET; ` +
        `an adapter reading this name fails closed forever.`,
    );
  }
  return failures;
};

export const evaluateG2 = (filePath, code) => {
  if (!G2_FILE_MATCH.test(filePath)) return [];
  const failures = [];
  // A bare quoted 'snap' or "snap" platform literal (word-exact; 'snapchat' is fine).
  if (/['"]snap['"]/.test(code)) {
    failures.push(
      `${filePath}: bare 'snap' platform literal — the canon enum is 'snapchat' ` +
        `(A1-1/GR-14: 'snap' silently breaks the ad_creative_platform_refs cache key and the CHECK).`,
    );
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const GOOD_ADAPTER = `
    const token = await mintSnapAccessToken(); // SNAPCHAT_REFRESH_TOKEN grant
    const platform = "snapchat";
  `;
  const BAD_TOKEN = `
    const token = Deno.env.get("SNAP_ACCESS_TOKEN");
  `;
  const BAD_ENUM = `
    const platform = 'snap';
  `;
  const g = [
    ...evaluateG1("supabase/functions/_shared/snapchat.ts", GOOD_ADAPTER),
    ...evaluateG2("supabase/functions/_shared/snapchat.ts", GOOD_ADAPTER),
  ];
  const b1 = evaluateG1("supabase/functions/_shared/snapchat.ts", BAD_TOKEN);
  const b2 = evaluateG2("supabase/functions/_shared/adCreative.ts", BAD_ENUM);
  const b3 = evaluateG2("mingla-admin/src/unrelated.ts", BAD_ENUM); // out of G2 scope
  const ok = g.length === 0 && b1.length >= 1 && b2.length >= 1 && b3.length === 0;
  if (!ok) {
    console.error("ISSUE-866 creative-guards SELF-TEST failed:", { g, b1, b2, b3 });
    process.exit(1);
  }
  console.log("ISSUE-866 creative-guards SELF-TEST passed.");
  process.exit(0);
}

const failures = [];
for (const root of G1_ROOTS) {
  for (const file of walk(root)) {
    let code;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    failures.push(...evaluateG1(file, code));
  }
}
for (const root of G2_ROOTS) {
  for (const file of walk(root)) {
    let code;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    failures.push(...evaluateG2(file, code));
  }
}

if (failures.length > 0) {
  console.error("ISSUE-866 creative-guards gate FAILED:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(
  `ISSUE-866 creative-guards gate passed (G1 ${FORBIDDEN_TOKEN_NAME} absent across ${G1_ROOTS.length} roots; G2 no bare-'snap' literal in ad-engine files).`,
);
