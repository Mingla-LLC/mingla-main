#!/usr/bin/env node
/**
 * ORCH-1056 strict-grep gate — connect-*.web.tsx import shared styles.
 *
 * Every `mingla-business/app/connect-*.web.tsx` page MUST import from
 * `src/components/stripe/connectEmbeddedPageHelpers` so it inherits:
 *   - the absolute-positioned page wrapper (iOS WKWebView scroll fix)
 *   - the viewport-meta override (iOS Safari auto-zoom block)
 *
 * Without this gate, a future page might re-inline the styles without
 * the iOS fixes, reproducing the 2026-06-02 partner-onboarding scroll
 * regression on a different route. The gate is the only enforcement.
 *
 * Self-test: pass `--self-test` to verify the file discovery logic.
 */

import { readdirSync, readFileSync } from "node:fs";

const PAGES_DIR = "mingla-business/app";
const REQUIRED_IMPORT_SUBSTRING = "components/stripe/connectEmbeddedPageHelpers";

function discoverConnectPages() {
  let entries;
  try {
    entries = readdirSync(PAGES_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((n) => n.startsWith("connect-") && n.endsWith(".web.tsx"))
    .map((n) => `${PAGES_DIR}/${n}`);
}

function checkFile(path) {
  let src;
  try {
    src = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, reason: `unreadable: ${err.message}` };
  }
  if (!src.includes(REQUIRED_IMPORT_SUBSTRING)) {
    return {
      ok: false,
      reason: `missing import of "${REQUIRED_IMPORT_SUBSTRING}"`,
    };
  }
  return { ok: true };
}

if (process.argv.includes("--self-test")) {
  const pages = discoverConnectPages();
  if (pages.length === 0) {
    console.error(
      "ORCH-1056 strict-grep self-test FAILED: zero connect-*.web.tsx pages discovered.",
    );
    process.exit(1);
  }
  console.log(
    `ORCH-1056 connect-page-shared-styles strict-grep self-test PASS (discovered ${pages.length} pages).`,
  );
  process.exit(0);
}

const pages = discoverConnectPages();
if (pages.length === 0) {
  console.error(
    "ORCH-1056 strict-grep FAILED: no connect-*.web.tsx pages found under mingla-business/app/. Did the discovery path move?",
  );
  process.exit(1);
}

const violations = [];
for (const page of pages) {
  const result = checkFile(page);
  if (!result.ok) violations.push({ page, reason: result.reason });
}

if (violations.length > 0) {
  console.error(
    "ORCH-1056 strict-grep FAILED: every connect-*.web.tsx must import shared helpers from src/components/stripe/connectEmbeddedPageHelpers.",
  );
  for (const v of violations) {
    console.error(`  ${v.page} — ${v.reason}`);
  }
  console.error(
    "Required: `import { connectEmbeddedPageStyles, useStripeConnectViewportZoomLock } from \"../src/components/stripe/connectEmbeddedPageHelpers\";`",
  );
  process.exit(1);
}

console.log(
  `ORCH-1056 connect-page-shared-styles strict-grep PASS — all ${pages.length} connect-*.web.tsx pages import shared helpers.`,
);
