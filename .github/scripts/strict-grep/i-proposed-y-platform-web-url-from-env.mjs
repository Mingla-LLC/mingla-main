#!/usr/bin/env node
/**
 * I-PROPOSED-Y strict-grep gate — PLATFORM-WEB-URL-FROM-ENV-ONLY.
 *
 * Status: DRAFT — flips ACTIVE on B2a Path C V3 CLOSE.
 *
 * Gate logic:
 *   For every .ts / .tsx file in mingla-business/{app,src}/ + supabase/functions/:
 *     Flag hardcoded literals matching `business.mingla.com`, `https://mingla.com`
 *     (URL form, NOT slug-prefix UI like `mingla.com/{slug}`), or other
 *     non-canonical platform URLs.
 *     Allowlist tag exemption: `// orch-strict-grep-allow platform-web-url-historical — <reason>`
 *     within 5 lines above the literal.
 *
 * Per B2a Path C V3 forensics report + INVARIANT_REGISTRY I-PROPOSED-Y.
 *
 * RATIONALE:
 *   The B2a Path C V3 forensics audit (2026-05-07) found 19+ references to
 *   `business.mingla.com` (NXDOMAIN) + `mingla.com` (non-Mingla third-party
 *   site) across the codebase. The drift caused Phase 16 in-app onboarding to
 *   fail completely because `brand-stripe-onboard` returned a non-resolvable
 *   host as the `onboarding_url`. The canonical Mingla Business public web URL
 *   is sourced from `mingla-business/src/constants/platformUrl.ts` which reads
 *   `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` env var (production: `business.usemingla.com`).
 *
 *   This gate prevents regression: future implementors cannot accidentally
 *   re-introduce hardcoded `business.mingla.com` or `https://mingla.com` without
 *   either (a) updating the canonical constant + env, OR (b) adding the
 *   allowlist tag with a justified reason (e.g., historical SPEC quote).
 *
 * DETECTION:
 *   - Hardcoded `business.mingla.com` strings (any context)
 *   - Hardcoded `https://mingla.com` URLs (NOT plain `mingla.com/{slug}` slug
 *     placeholder text in UI which is intentional copy-text)
 *
 * EXEMPTIONS:
 *   - `mingla-business/src/constants/platformUrl.ts` (canonical constant file)
 *   - `_shared/stripe.ts` line with `appInfo.url` (one allowed Stripe SDK call;
 *     also tagged with explanatory comment)
 *   - Test files (`*.test.ts`, `*.test.tsx`, `__tests__/`)
 *   - Files using the allowlist tag
 *   - `mingla-business/dist/` (compiled build output)
 *   - `Mingla_Artifacts/`, `docs/`, `outputs/` (documentation, not active code)
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a Path C V3 config-drift forensics fix [confirmed at V3 CLOSE].
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
  join(REPO_ROOT, "supabase", "functions"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow platform-web-url-historical";

// Forbidden literal patterns. Includes backtick (template literal) delimiter.
const FORBIDDEN_PATTERNS = [
  {
    re: /[`"']https:\/\/business\.mingla\.com[`"'/]/,
    label: "https://business.mingla.com URL literal",
    fix: "Read MINGLA_BUSINESS_WEB_URL from constants/platformUrl.ts (frontend) or Deno.env.get('MINGLA_BUSINESS_WEB_URL') (edge fn).",
  },
  {
    re: /[`"']business\.mingla\.com[`"'/]/,
    label: "business.mingla.com hostname literal",
    fix: "Use MINGLA_BUSINESS_WEB_HOST from constants/platformUrl.ts.",
  },
  {
    re: /[`"']https:\/\/mingla\.com\b/,
    label: "https://mingla.com URL literal (likely platform-web-URL drift; mingla.com is not Mingla-owned)",
    fix: "If this is a platform/web URL, use platformUrl constant; if it's intentional copy text (e.g., slug placeholder), add allowlist tag.",
  },
];

const EXEMPT_FILE_PATTERNS = [
  /\/constants\/platformUrl\.ts$/,
  /\.test\.ts$/,
  /\.test\.tsx$/,
  /\/__tests__\//,
  /\/dist\//,
];

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

function isExemptFile(filePath) {
  return EXEMPT_FILE_PATTERNS.some((p) => p.test(filePath));
}

function* walkTsTsx(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".git" || entry === ".expo" ||
          entry === "dist" || entry === ".well-known") {
        continue;
      }
      yield* walkTsTsx(full);
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx"))
    ) {
      yield full;
    }
  }
}

function reportViolation(filePath, lineNumber, lineText, label, fix) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-Y violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(`  Forbidden: ${label}`);
  console.error(`  ${fix}`);
  console.error(
    `  Allowlist (with justification): // orch-strict-grep-allow platform-web-url-historical — <reason>`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-Y`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  if (isExemptFile(filePath)) return;

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
    console.error(`READ-FAIL: ${rel} — ${err.message}`);
    readFailures += 1;
    return;
  }

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Allowlist within 5 lines above the violating line
    const allowStart = Math.max(0, i - 5);
    const allowContext = lines.slice(allowStart, i + 1).join("\n");
    if (allowContext.includes(ALLOWLIST_TAG)) continue;

    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.re.test(line)) {
        reportViolation(filePath, i + 1, line, pat.label, pat.fix);
        break;
      }
    }
  }
}

try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTsTsx(dir)) {
      scanFile(file);
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-Y gate: scanned ${filesScanned} .ts/.tsx files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
