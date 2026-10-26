#!/usr/bin/env node

/**
 * ORCH-1187 TESTER ADVERSARIAL GATE — consent-gate deletion robustness
 * (META-ORCH-1187 [Growth Analytics Hub] Phase 1, LEG 1 — marketing web)
 *
 * WHY THIS EXISTS (different angle from the implementor's gates):
 *   The implementor's `i-proposed-1187-consent-gate-before-cookies.mjs` checks
 *   for `opt_out_capturing_by_default: true` against the RAW (un-comment-stripped)
 *   file contents. The marketing provider's doc-comment ALSO contains the literal
 *   `opt_out_capturing_by_default: true` (in backticks). Consequence: if a
 *   developer DELETES the real init line (revert-by-deletion, not flip-to-false),
 *   the implementor's gate STILL PASSES because the comment satisfies the regex —
 *   a fails-on-revert blind spot on the #1 security gate (TEST finding P2).
 *
 *   This adversarial gate closes that gap: it comment-strips FIRST, then asserts
 *   the real `posthog.init(...)` call object carries `opt_out_capturing_by_default:
 *   true`. It also re-asserts the masking literal survives comment-stripping.
 *
 * GATE (marketing provider, comment-stripped real code only):
 *   1. `opt_out_capturing_by_default: true` present in REAL code (post-strip).
 *   2. `maskAllInputs: true` present in REAL code (post-strip).
 *   3. No `posthog.opt_in_capturing(` outside the provider's opt-in helper /
 *      banner Accept path (no auto opt-in on mount = no pre-consent capture).
 *
 * #2331 (I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF): analytics is now on unless
 * the visitor turned it off, so the opt-in runs in the provider's boot helper
 * on arrival. What this gate keeps proving: PostHog stores nothing until that
 * helper opts in, the mount never opts in directly, replay stays masked, the
 * privacy bar saves the choice, and a turn-off opts PostHog out again.
 *
 * FAILS-ON-REVERT: deleting the real opt-out-by-default line, deleting the real
 * mask line, or auto-opt-in-on-mount each fails this gate. PASSES on the shipped
 * code. Verified by the tester at branch HEAD 66acb0d17.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const PROVIDER = "mingla-marketing/components/marketing/posthog-provider.tsx";
const BANNER = "mingla-marketing/components/marketing/consent-banner.tsx";

// Strip // line comments and /* */ block comments so doc-comment prose cannot
// satisfy a structural code check (this is the gap the implementor gate missed).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const errors = [];

function read(rel) {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) {
    errors.push(`Missing required file: ${rel}`);
    return null;
  }
  return fs.readFileSync(full, "utf8");
}

// (1) + (2): real-code-only consent + mask literals in the provider.
const providerRaw = read(PROVIDER);
if (providerRaw) {
  const code = stripComments(providerRaw);
  if (!/opt_out_capturing_by_default\s*:\s*true/.test(code)) {
    errors.push(
      `${PROVIDER}: REAL (comment-stripped) code must set "opt_out_capturing_by_default: true" — a doc-comment mention does NOT count (consent gate, deletion-robust).`,
    );
  }
  if (!/maskAllInputs\s*:\s*true/.test(code)) {
    errors.push(
      `${PROVIDER}: REAL (comment-stripped) code must set "maskAllInputs: true" (replay PII security gate, deletion-robust).`,
    );
  }
  // (3): the ONLY opt-in call must live in the exported helper, never an
  // auto-opt-in at provider mount (which would capture pre-consent).
  const initBlock = code.slice(
    code.indexOf("export function PostHogProvider"),
  );
  if (/opt_in_capturing\s*\(/.test(initBlock)) {
    errors.push(
      `${PROVIDER}: PostHogProvider mount must NOT call opt_in_capturing() — that defeats the consent gate (pre-consent capture).`,
    );
  }
}

// The bar owns the saved choice, and a turn-off opts PostHog out again (#2331).
const bannerRaw = read(BANNER);
if (bannerRaw) {
  const code = stripComments(bannerRaw);
  if (!/saveMarketingPrivacy\s*\(\s*choice\s*\)/.test(code)) {
    errors.push(
      `${BANNER}: the privacy bar must save the visitor's choice via saveMarketingPrivacy(choice).`,
    );
  }
}
if (providerRaw) {
  const code = stripComments(providerRaw);
  const stopStart = code.indexOf("function stopMarketingAnalytics");
  const stopBody = stopStart === -1 ? "" : code.slice(stopStart, code.indexOf("\n}\n", stopStart));
  if (!/opt_out_capturing\s*\(\s*\)/.test(stopBody)) {
    errors.push(
      `${PROVIDER}: stopMarketingAnalytics() must opt PostHog out (a turn-off stops capture now).`,
    );
  }
}

if (errors.length > 0) {
  console.error(
    "FAIL: ORCH-1187 tester consent-gate deletion-robustness gate violated",
  );
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  "OK: ORCH-1187 tester gate — opt-out-by-default + masking present in REAL code (deletion-robust), no mount-time opt-in, turn-off opts out (#2331)",
);
