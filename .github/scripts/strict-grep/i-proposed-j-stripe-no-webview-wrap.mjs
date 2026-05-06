#!/usr/bin/env node
/**
 * I-PROPOSED-J strict-grep gate — Stripe Connect Embedded Components via official SDK only.
 *
 * Gate logic:
 *   For every .ts / .tsx file in mingla-business/src/ + mingla-business/app/:
 *     If file imports BOTH `@stripe/connect-js` AND `react-native-webview`
 *     → VIOLATION (exit 1)
 *     Unless an allowlist comment exists in the file:
 *       // orch-strict-grep-allow stripe-connect-js-with-webview — <reason>
 *
 * Per B2a SPEC §8.2 + INVARIANT_REGISTRY I-PROPOSED-J — registry pattern.
 *
 * RATIONALE:
 *   Stripe explicitly prohibits Connect Embedded Components inside embedded
 *   WebViews in mobile apps per docs.stripe.com/connect/get-started-connect-embedded-components.
 *   Verbatim: "You can't use Connect embedded components in embedded web views
 *   inside mobile or desktop applications."
 *
 *   Mingla Path B (B2a): Mingla-hosted web page renders connect-js, opened via
 *   expo-web-browser system browser (sandboxed, NOT host-controlled).
 *   This pattern is endorsed by Stripe.
 *
 *   Path A future upgrade: Stripe's native @stripe/stripe-react-native preview
 *   SDK with <ConnectAccountOnboarding> component. Internally uses
 *   react-native-webview as Stripe's chosen impl detail; from Mingla's code it
 *   looks like a native RN component (allowed via the SDK's own dependency).
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a SPEC + DEC-114 + DEC-115 [confirmed at CLOSE].
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
];

const ALLOWLIST_TAG = "orch-strict-grep-allow stripe-connect-js-with-webview";

const CONNECT_JS_REGEX = /from\s+["']@stripe\/(react-)?connect-js["']/;
const WEBVIEW_REGEX = /from\s+["']react-native-webview["']/;

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

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
      if (entry === "node_modules" || entry === ".git" || entry === ".expo") {
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

function reportViolation(filePath) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-J violation in ${rel}`);
  console.error(
    `  File imports BOTH @stripe/connect-js AND react-native-webview.`,
  );
  console.error(
    `  Stripe explicitly prohibits Connect Embedded Components inside embedded`,
  );
  console.error(
    `  WebViews — see docs.stripe.com/connect/get-started-connect-embedded-components.`,
  );
  console.error(
    `  Use Path B: Mingla-hosted web page (mingla-business/app/connect-onboarding.tsx)`,
  );
  console.error(
    `  rendering connect-js, opened via expo-web-browser (system browser, sandboxed).`,
  );
  console.error(
    `  Allowlist: add // orch-strict-grep-allow stripe-connect-js-with-webview — <reason>`,
  );
  console.error(`             at the top of the file.`);
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-J`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
    console.error(`READ-FAIL: ${rel} — ${err.message}`);
    readFailures += 1;
    return;
  }

  if (source.includes(ALLOWLIST_TAG)) return;
  if (!CONNECT_JS_REGEX.test(source)) return;
  if (!WEBVIEW_REGEX.test(source)) return;

  reportViolation(filePath);
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
  `I-PROPOSED-J gate: scanned ${filesScanned} .ts/.tsx files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
