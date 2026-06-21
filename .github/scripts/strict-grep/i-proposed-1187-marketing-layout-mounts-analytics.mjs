#!/usr/bin/env node

/**
 * META-ORCH-1187 marketing-web regression (§9 fails-on-revert contract, LEG 1).
 *
 * Asserts the marketing root layout WIRES analytics:
 *   1. mounts <PostHogProvider /> (the consent-gated PostHog init),
 *   2. mounts <ConsentBanner /> (the real opt-in/out gate),
 *   3. mounts <GoogleAnalytics ... /> (GA4 via @next/third-parties),
 * and that the PostHog provider init uses the US host literal.
 *
 * This is the happy-path regression that FAILS if the provider mount, the
 * banner, the GA mount, or the US host is reverted — and PASSES when restored.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const LAYOUT = "mingla-marketing/app/layout.tsx";
const PROVIDER = "mingla-marketing/components/marketing/posthog-provider.tsx";

const errors = [];

function read(rel) {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) {
    errors.push(`Missing required file: ${rel}`);
    return "";
  }
  return fs.readFileSync(full, "utf8");
}

// Strip comments so the JSX-mount checks don't match prose like "<GoogleAnalytics>".
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const layout = stripComments(read(LAYOUT));
const provider = stripComments(read(PROVIDER));

const checks = [
  [layout, /<PostHogProvider\b/, `${LAYOUT}: must mount <PostHogProvider />`],
  [layout, /<ConsentBanner\b/, `${LAYOUT}: must mount <ConsentBanner />`],
  [layout, /<GoogleAnalytics\s+gaId/, `${LAYOUT}: must mount <GoogleAnalytics gaId=... />`],
  [
    layout,
    /from\s+['"]@next\/third-parties\/google['"]/,
    `${LAYOUT}: must import GoogleAnalytics from @next/third-parties/google`,
  ],
  [
    provider,
    /posthog\.init\s*\(/,
    `${PROVIDER}: must call posthog.init(...)`,
  ],
  [
    provider,
    /https:\/\/us\.i\.posthog\.com/,
    `${PROVIDER}: PostHog init must use the US host https://us.i.posthog.com`,
  ],
];

for (const [src, re, msg] of checks) {
  if (!re.test(src)) errors.push(msg);
}

if (errors.length > 0) {
  console.error("FAIL: META-ORCH-1187 marketing-layout-mounts-analytics");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  "OK: META-ORCH-1187 marketing-layout-mounts-analytics — provider + banner + GA4 mounted; US host wired",
);
