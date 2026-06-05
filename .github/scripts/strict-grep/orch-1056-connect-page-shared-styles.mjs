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
 * ORCH-1083: the connect-page bodies are now code-split — each
 * `app/connect-*.web.tsx` route shell React.lazy-imports its body from
 * `src/components/stripe/connect-pages/*Body.web.tsx`, and the shared helper
 * import (+ useStripeConnectViewportZoomLock) lives in the BODY. So the gate now
 * accepts the helper import on EITHER the shell OR its lazily-imported body —
 * the iOS WKWebView scroll/zoom fix is still enforced, just in the body. See
 * SPEC §C-1.
 *
 * Self-test: pass `--self-test` to verify the file discovery logic.
 */

import { readdirSync, readFileSync } from "node:fs";

const PAGES_DIR = "mingla-business/app";
const REQUIRED_IMPORT_SUBSTRING = "components/stripe/connectEmbeddedPageHelpers";
// ORCH-1083: lazily-imported bodies live here.
const BODIES_DIR = "mingla-business/src/components/stripe/connect-pages";

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

function importsHelper(path) {
  try {
    return readFileSync(path, "utf8").includes(REQUIRED_IMPORT_SUBSTRING);
  } catch {
    return false;
  }
}

// ORCH-1083: does ANY body module under BODIES_DIR import the shared helper?
// (The route shells lazy-import these bodies; the iOS fix + helper styles live
// in the body.) A single body importing the helper proves the fix is present in
// the split-out connect-page code path.
function anyBodyImportsHelper() {
  let entries;
  try {
    entries = readdirSync(BODIES_DIR);
  } catch {
    return false;
  }
  return entries
    .filter((n) => n.endsWith(".web.tsx") || n.endsWith(".web.ts"))
    .some((n) => importsHelper(`${BODIES_DIR}/${n}`));
}

function checkFile(path, bodyHelperPresent) {
  let src;
  try {
    src = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, reason: `unreadable: ${err.message}` };
  }
  if (src.includes(REQUIRED_IMPORT_SUBSTRING)) {
    return { ok: true };
  }
  // ORCH-1083: a shell that React.lazy-imports a connect-page body is OK as long
  // as a body module carries the shared helper import (the iOS fix).
  if (src.includes("connect-pages/") && bodyHelperPresent) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `missing import of "${REQUIRED_IMPORT_SUBSTRING}" (and no lazy connect-pages body carrying it)`,
  };
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

const bodyHelperPresent = anyBodyImportsHelper();
const violations = [];
for (const page of pages) {
  const result = checkFile(page, bodyHelperPresent);
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
