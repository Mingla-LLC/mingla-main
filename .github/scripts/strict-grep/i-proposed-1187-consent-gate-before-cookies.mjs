#!/usr/bin/env node

/**
 * I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES
 *   (META-ORCH-1187 [Growth Analytics Hub] Phase 1)
 *
 * WHY: on the web surfaces, NO analytics cookies / capture may happen before the
 * visitor explicitly accepts. Two structural guarantees enforce that:
 *   (A) PostHog inits with `opt_out_capturing_by_default: true` (PostHog then
 *       stores nothing / captures nothing until opt_in_capturing()).
 *   (B) GA4 Consent Mode v2: a `gtag('consent','default', {...all denied})` call
 *       runs BEFORE the GA tag config / measurement loads.
 * Reverting either re-opens the pre-consent cookie/capture leak.
 *
 * GATE (marketing leg — LEG 1):
 *   1. The PostHog provider MUST contain `opt_out_capturing_by_default: true`.
 *   2. The root layout MUST emit a GA4 `consent` `default` call with all four
 *      v2 signals DENIED, and it must appear BEFORE the <GoogleAnalytics> mount
 *      (source order = execution order via strategy="beforeInteractive").
 *   3. No client file may set `opt_out_capturing_by_default: false`.
 *
 * Later legs (buyer web) add their `webAnalytics.web.ts` + layout to the lists.
 *
 * FAILS-ON-REVERT: removing the opt-out-by-default literal, removing the GA
 * consent-default-denied call, ordering it after <GoogleAnalytics>, or flipping
 * to capture-by-default — any of these fails this gate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

// PostHog init sites that MUST opt out by default.
const POSTHOG_INIT_FILES = [
  "mingla-marketing/components/marketing/posthog-provider.tsx",
  // LEG 2 (buyer web): "mingla-business/src/analytics/webAnalytics.web.ts",
];

// Root layouts that mount GA4 + the consent-default snippet.
const GA_LAYOUT_FILES = [
  "mingla-marketing/app/layout.tsx",
  // LEG 2 (buyer web): the buyer-web GA loader (webAnalytics.web.ts).
];

// Whole client trees scanned for the forbidden capture-by-default flip.
const SCAN_DIRS = ["mingla-marketing", "mingla-business", "app-mobile"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// Strip // line comments and block comments so prose/examples don't trip the
// structural checks (we only want to reason about real code).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const errors = [];

// (1) opt_out_capturing_by_default: true at every PostHog init site.
for (const rel of POSTHOG_INIT_FILES) {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) {
    errors.push(`Missing required PostHog init file: ${rel}`);
    continue;
  }
  const contents = fs.readFileSync(full, "utf8");
  if (!/opt_out_capturing_by_default\s*:\s*true/.test(contents)) {
    errors.push(
      `${rel}: PostHog init must set "opt_out_capturing_by_default: true" (consent gate).`,
    );
  }
}

// (2) GA4 consent default-denied call, ordered BEFORE <GoogleAnalytics>.
const DENIED_SIGNALS = [
  /ad_storage\s*:\s*['"]denied['"]/,
  /analytics_storage\s*:\s*['"]denied['"]/,
  /ad_user_data\s*:\s*['"]denied['"]/,
  /ad_personalization\s*:\s*['"]denied['"]/,
];
for (const rel of GA_LAYOUT_FILES) {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) {
    errors.push(`Missing required GA layout file: ${rel}`);
    continue;
  }
  const contents = stripComments(fs.readFileSync(full, "utf8"));

  const hasConsentDefault = /consent['"]?\s*,\s*['"]default['"]/.test(contents);
  const allDenied = DENIED_SIGNALS.every((re) => re.test(contents));
  if (!hasConsentDefault || !allDenied) {
    errors.push(
      `${rel}: must emit gtag('consent','default', {...all four v2 signals 'denied'}) before GA loads.`,
    );
    continue;
  }
  // Order check: the consent-default snippet must appear before the
  // <GoogleAnalytics ... /> JSX mount (source order = execution order).
  const consentIdx = contents.search(/consent['"]?\s*,\s*['"]default['"]/);
  const gaIdx = contents.search(/<GoogleAnalytics[\s>]/);
  if (gaIdx !== -1 && consentIdx !== -1 && consentIdx > gaIdx) {
    errors.push(
      `${rel}: the GA consent-default-denied snippet must appear BEFORE <GoogleAnalytics> (source order = execution order).`,
    );
  }
}

// (3) no opt_out_capturing_by_default:false anywhere in the client trees.
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
for (const file of files) {
  const rel = path.relative(repoRoot, file);
  if (rel.includes("node_modules")) continue;
  const contents = stripComments(fs.readFileSync(file, "utf8"));
  if (/opt_out_capturing_by_default\s*:\s*false/.test(contents)) {
    errors.push(`${rel}: forbidden "opt_out_capturing_by_default: false" (defeats the consent gate).`);
  }
}

if (errors.length > 0) {
  console.error("FAIL: I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES violated");
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nNo analytics cookies/capture may occur before explicit consent (META-ORCH-1187 §4.E).",
  );
  process.exit(1);
}

console.log(
  "OK: I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES — opt-out-by-default + GA consent-default-denied (pre-GA) verified",
);
