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
 *     Active app/source URL emitters cannot be allowlisted as historical.
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
 *   updating the canonical constant + env.
 *
 * DETECTION:
 *   - Hardcoded `business.mingla.com` strings (any context)
 *   - Hardcoded `https://mingla.com` URLs and visible `mingla.com/` public-route
 *     copy in active app code
 *
 * EXEMPTIONS:
 *   - `mingla-business/src/constants/platformUrl.ts` (canonical constant file)
 *   - `_shared/stripe.ts` line with `appInfo.url` (one allowed Stripe SDK call;
 *     also tagged with explanatory comment)
 *   - Test files (`*.test.ts`, `*.test.tsx`, `__tests__/`)
 *   - Files using the allowlist tag outside active runtime scan roots only
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

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let REPO_ROOT =
  process.env.I_PROPOSED_Y_SCAN_ROOT || join(__dirname, "..", "..", "..");

const buildScanDirs = () => [
  join(REPO_ROOT, "mingla-business", "app"),
  join(REPO_ROOT, "mingla-business", "src"),
  join(REPO_ROOT, "supabase", "functions"),
];

let SCAN_DIRS = buildScanDirs();

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
  {
    re: /[`"'][^`"']*\bmingla\.com\//,
    label: "visible mingla.com public-route copy (mingla.com is not Mingla-owned)",
    fix: "Use the canonical public URL builder from mingla-business/src/constants/publicUrls.ts.",
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
    "  Active app/source URL emitters cannot be allowlisted as historical.",
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

    // The historical allowlist is intentionally ignored for active scan roots.
    // ORCH-0759 tester proved that allowing it here creates false-green
    // runtime URL emitters.
    const allowStart = Math.max(0, i - 5);
    const allowContext = lines.slice(allowStart, i + 1).join("\n");
    const hasHistoricalAllowlist = allowContext.includes(ALLOWLIST_TAG);

    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.re.test(line)) {
        reportViolation(
          filePath,
          i + 1,
          line,
          hasHistoricalAllowlist
            ? `${pat.label} hidden by active-code historical allowlist`
            : pat.label,
          pat.fix,
        );
        break;
      }
    }
  }
}

function resetCounters() {
  violations = 0;
  filesScanned = 0;
  readFailures = 0;
}

function runScan() {
  resetCounters();
  for (const dir of SCAN_DIRS) {
    for (const file of walkTsTsx(dir)) {
      scanFile(file);
    }
  }

  console.error("");
  console.error(
    `I-PROPOSED-Y gate: scanned ${filesScanned} .ts/.tsx files · ${violations} violations · ${readFailures} read failures`,
  );

  if (readFailures > 0 && filesScanned === readFailures) {
    return 2;
  }
  if (violations > 0) {
    return 1;
  }
  return 0;
}

function withTempRepo(callback) {
  const originalRoot = REPO_ROOT;
  const originalScanDirs = SCAN_DIRS;
  const tmpRoot = mkdtempSync(join(tmpdir(), "i-proposed-y-"));
  try {
    REPO_ROOT = tmpRoot;
    SCAN_DIRS = buildScanDirs();
    callback(tmpRoot);
  } finally {
    REPO_ROOT = originalRoot;
    SCAN_DIRS = originalScanDirs;
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function runSelfTest() {
  let failed = false;

  withTempRepo((tmpRoot) => {
    const appDir = join(tmpRoot, "mingla-business", "app");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(
      join(appDir, "active-bad.tsx"),
      [
        "// orch-strict-grep-allow platform-web-url-historical — historical quote",
        'export const url = "https://business.mingla.com/e/demo/show";',
        "",
      ].join("\n"),
    );
    const exitCode = runScan();
    if (exitCode !== 1 || violations !== 1) {
      failed = true;
      console.error(
        "SELF-TEST FAIL: active bad-domain emitter with historical allowlist must fail.",
      );
    }
  });

  withTempRepo((tmpRoot) => {
    const testDir = join(tmpRoot, "mingla-business", "src", "__tests__");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, "historicalFixture.test.ts"),
      'export const url = "https://business.mingla.com/e/demo/show";\n',
    );
    const exitCode = runScan();
    if (exitCode !== 0 || violations !== 0) {
      failed = true;
      console.error("SELF-TEST FAIL: test fixtures should remain exempt.");
    }
  });

  if (failed) return 1;
  console.error("I-PROPOSED-Y self-test: PASS");
  return 0;
}

try {
  if (process.argv.includes("--self-test")) {
    process.exit(runSelfTest());
  }
  process.exit(runScan());
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}
