#!/usr/bin/env node
/**
 * ISSUE-862 — I-PROPOSED-862-AD-TOKEN-ENV-SERVER-ONLY (DRAFT until CLOSE).
 *
 * SPEC RT-3 as widened by Amendment A3 §E: EVERY ad-platform token /
 * refresh-secret env-var NAME (all five channels — Meta, TikTok, Snapchat,
 * Google, Reddit) may appear ONLY under supabase/functions/** and NEVER in any
 * client tree (mingla-admin, app-mobile, mingla-business, mingla-marketing,
 * packages). A client-side reference means the credential is one
 * EXPO_PUBLIC/import.meta.env away from shipping in a bundle.
 *
 * The DB stores env-var NAMES only (ad_connections.token_env_var); the values
 * live exclusively in Supabase Edge Function Secrets (Deno.env).
 *
 * Reverting _shared/meta.ts's env-only token resolution (e.g. hardcoding a
 * token or referencing the secret name from the admin client) = RED.
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * orch-1331-share-single-source.mjs).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Token/secret env-var NAMES (names only — never values). A3 §D/§E registry +
// A2 business-lane names. Non-secret ID vars (META_AD_ACCOUNT_ID etc.) are
// deliberately NOT listed — IDs are not credentials.
const TOKEN_ENV_NAMES = [
  "META_SYSTEM_USER_TOKEN",
  "META_MINGLABIZ_SYSTEM_USER_TOKEN",
  "META_CAPI_ACCESS_TOKEN",
  "META_MINGLABIZ_CAPI_ACCESS_TOKEN",
  "META_APP_SECRET",
  "TIKTOK_ACCESS_TOKEN",
  "TIKTOK_EVENTS_ACCESS_TOKEN",
  "SNAPCHAT_REFRESH_TOKEN",
  "SNAPCHAT_CLIENT_SECRET",
  "SNAPCHAT_CAPI_TOKEN",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  "REDDIT_ADS_REFRESH_TOKEN",
  "REDDIT_ADS_CLIENT_SECRET",
  "REDDIT_ADS_CAPI_TOKEN",
];

// Client trees that must NEVER reference a token env name.
const FORBIDDEN_ROOTS = [
  "mingla-admin/src",
  "app-mobile/src",
  "app-mobile/app",
  "mingla-business/src",
  "mingla-business/app",
  "mingla-marketing",
  "packages",
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);

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

export const evaluateClientSource = (filePath, code) => {
  const failures = [];
  for (const name of TOKEN_ENV_NAMES) {
    if (code.includes(name)) {
      failures.push(
        `${filePath}: references ad-platform token env name "${name}" — platform credentials are server-only (supabase/functions/**). I-PROPOSED-862-AD-TOKEN-ENV-SERVER-ONLY.`,
      );
    }
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const GOOD = `
    import { supabase, invokeWithRefresh } from "../lib/supabase";
    export async function connectMeta() {
      return invokeWithRefresh("admin-ad-connect", { body: { platform: "meta" } });
    }
  `;
  const BAD_DIRECT = `
    const token = import.meta.env.META_SYSTEM_USER_TOKEN;
    fetch("https://graph.facebook.com/v25.0/me", { headers: { Authorization: "Bearer " + token } });
  `;
  const BAD_REDDIT = `
    const secret = process.env.REDDIT_ADS_CLIENT_SECRET;
  `;
  const g = evaluateClientSource("fixture-good.js", GOOD);
  const b1 = evaluateClientSource("fixture-bad-meta.js", BAD_DIRECT);
  const b2 = evaluateClientSource("fixture-bad-reddit.js", BAD_REDDIT);
  const ok = g.length === 0 && b1.length >= 1 && b2.length >= 1;
  if (!ok) {
    console.error("ISSUE-862 ad-token-env-server-only SELF-TEST failed:", { g, b1, b2 });
    process.exit(1);
  }
  console.log("ISSUE-862 ad-token-env-server-only SELF-TEST passed.");
  process.exit(0);
}

const failures = [];
for (const root of FORBIDDEN_ROOTS) {
  for (const file of walk(root)) {
    let code;
    try {
      code = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    failures.push(...evaluateClientSource(file, code));
  }
}

if (failures.length > 0) {
  console.error("ISSUE-862 ad-token-env-server-only gate FAILED:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(
  `ISSUE-862 ad-token-env-server-only gate passed (${TOKEN_ENV_NAMES.length} token names, ${FORBIDDEN_ROOTS.length} client trees clean).`,
);
