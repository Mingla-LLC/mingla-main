#!/usr/bin/env node
/**
 * ISSUE-862 — I-PROPOSED-862-REDDIT-CONFIGURED-STATUS-EXPLICIT (DRAFT until CLOSE).
 *
 * SPEC A4.a / R-7 (GR-11): Reddit's create schema defaults `configured_status`
 * to ACTIVE — omitting it on a create body PUBLISHES A LIVE, SPENDING
 * CAMPAIGN. The Reddit adapter must send `configured_status: "PAUSED"`
 * explicitly at ALL THREE levels (campaign, ad group, ad), and its rollback is
 * `PATCH configured_status: "DELETED"` (no DELETE verb exists — R-5).
 *
 * This gate targets the FUTURE supabase/functions/_shared/reddit.ts (WP6):
 *   - file absent → PASS trivially (nothing to guard yet — by design, so the
 *     gate is armed from WP1 and bites the moment the adapter lands).
 *   - file present → every create-endpoint POST (/campaigns, /ad_groups, /ads
 *     collections) must be matched by explicit `configured_status` bodies:
 *     the file must reference `configured_status` at least as many times as it
 *     has create POSTs, and must contain the literal PAUSED assignment.
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * orch-1331-share-single-source.mjs).
 */
import { existsSync, readFileSync } from "node:fs";

const REDDIT_ADAPTER = "supabase/functions/_shared/reddit.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

export const evaluateRedditAdapter = (rawCode) => {
  const code = stripComments(rawCode);
  const failures = [];

  // Create-endpoint POSTs: the Reddit Ads API v3 create collections.
  const createEndpointMatches = code.match(
    /["'`][^"'`]*\/(campaigns|ad_groups|ads)["'`]/g,
  ) ?? [];
  const createCount = createEndpointMatches.length;

  const configuredStatusCount = (code.match(/\bconfigured_status\b/g) ?? []).length;

  if (createCount > 0 && configuredStatusCount < createCount) {
    failures.push(
      `${REDDIT_ADAPTER}: found ${createCount} create-endpoint reference(s) (/campaigns, /ad_groups, /ads) but only ${configuredStatusCount} configured_status occurrence(s) — Reddit defaults configured_status to ACTIVE, so an omitted field publishes a LIVE, SPENDING campaign (R-7/GR-11). Every create body must set it explicitly. I-PROPOSED-862-REDDIT-CONFIGURED-STATUS-EXPLICIT.`,
    );
  }
  if (createCount > 0 && !/configured_status\s*[:=]\s*["'`]PAUSED["'`]/.test(code)) {
    failures.push(
      `${REDDIT_ADAPTER}: no explicit configured_status: "PAUSED" assignment found — creates must be PAUSED at campaign, ad-group AND ad level (A4.a / R-7). I-PROPOSED-862-REDDIT-CONFIGURED-STATUS-EXPLICIT.`,
    );
  }
  // Rollback must be the PATCH-to-DELETED shape, never a DELETE verb (R-5).
  if (/\bmethod\s*:\s*["'`]DELETE["'`]/.test(code) || /\.delete\s*\(\s*["'`][^"'`]*\/(campaigns|ad_groups|ads)\//.test(code)) {
    failures.push(
      `${REDDIT_ADAPTER}: a DELETE verb against a Reddit ads resource — no DELETE verb exists on Reddit Ads v3; rollback = PATCH configured_status: "DELETED" (R-5). I-PROPOSED-862-REDDIT-CONFIGURED-STATUS-EXPLICIT.`,
    );
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const GOOD = `
    const campaign = await redditApi("POST", \`/ad_accounts/\${id}/campaigns\`, {
      data: { objective: "CLICKS", configured_status: "PAUSED" },
    });
    const adGroup = await redditApi("POST", \`/ad_accounts/\${id}/ad_groups\`, {
      data: { campaign_id, configured_status: "PAUSED" },
    });
    const ad = await redditApi("POST", \`/ad_accounts/\${id}/ads\`, {
      data: { ad_group_id, post_id, profile_id, configured_status: "PAUSED" },
    });
    // rollback (R-5): PATCH, never DELETE
    await redditApi("PATCH", \`/campaigns/\${campaignId}\`, { data: { configured_status: "DELETED" } });
  `;
  // BAD-1 — a create body with no configured_status (Reddit defaults to ACTIVE).
  const BAD_MISSING = `
    const campaign = await redditApi("POST", \`/ad_accounts/\${id}/campaigns\`, {
      data: { objective: "CLICKS" },
    });
  `;
  // BAD-2 — configured_status present somewhere but never PAUSED.
  const BAD_NEVER_PAUSED = `
    const campaign = await redditApi("POST", \`/ad_accounts/\${id}/campaigns\`, {
      data: { objective: "CLICKS", configured_status: "ACTIVE" },
    });
  `;
  // BAD-3 — DELETE verb rollback (no DELETE verb exists on Reddit Ads v3).
  const BAD_DELETE = `
    const campaign = await redditApi("POST", \`/ad_accounts/\${id}/campaigns\`, {
      data: { objective: "CLICKS", configured_status: "PAUSED" },
    });
    await fetch(url, { method: "DELETE" });
  `;
  const g = evaluateRedditAdapter(GOOD);
  const b1 = evaluateRedditAdapter(BAD_MISSING);
  const b2 = evaluateRedditAdapter(BAD_NEVER_PAUSED);
  const b3 = evaluateRedditAdapter(BAD_DELETE);
  const ok = g.length === 0 && b1.length >= 1 && b2.length >= 1 && b3.length >= 1;
  if (!ok) {
    console.error("ISSUE-862 reddit-configured-status SELF-TEST failed:", { g, b1, b2, b3 });
    process.exit(1);
  }
  console.log("ISSUE-862 reddit-configured-status SELF-TEST passed.");
  process.exit(0);
}

if (!existsSync(REDDIT_ADAPTER)) {
  console.log(
    `ISSUE-862 reddit-configured-status gate: ${REDDIT_ADAPTER} does not exist yet (WP6) — pass (gate armed).`,
  );
  process.exit(0);
}

const failures = evaluateRedditAdapter(readFileSync(REDDIT_ADAPTER, "utf8"));
if (failures.length > 0) {
  console.error("ISSUE-862 reddit-configured-status gate FAILED:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("ISSUE-862 reddit-configured-status gate passed.");
