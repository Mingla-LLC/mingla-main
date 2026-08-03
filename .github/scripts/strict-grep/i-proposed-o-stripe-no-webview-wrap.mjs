#!/usr/bin/env node
/**
 * I-PROPOSED-O strict-grep gate — Stripe Connect Embedded Components via official SDK only.
 *
 * Gate logic:
 *   For every .ts / .tsx file in mingla-business/src/ + mingla-business/app/:
 *     If file imports BOTH `@stripe/connect-js` AND `react-native-webview`
 *     → VIOLATION (exit 1)
 *     Unless an allowlist comment exists in the file:
 *       // orch-strict-grep-allow stripe-connect-js-with-webview — <reason>
 *
 * Per B2a SPEC §8.2 + INVARIANT_REGISTRY I-PROPOSED-O — registry pattern.
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

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] with `rel` the repo-relative
 * POSIX path (used for reporting). A file violates iff it imports BOTH
 * @stripe/(react-)connect-js AND react-native-webview and carries no allowlist
 * tag. Pushes one { rel } record per offending file into `failures`.
 * Behavior-preserving refactor of the original scanFile logic.
 */
function check(fileEntries, failures) {
  for (const { rel, content } of fileEntries) {
    if (content.includes(ALLOWLIST_TAG)) continue;
    if (!CONNECT_JS_REGEX.test(content)) continue;
    if (!WEBVIEW_REGEX.test(content)) continue;
    failures.push({ rel });
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (entries) => {
    const f = [];
    check(entries, f);
    return f;
  };

  // GOOD: a file importing only ONE of the two packages → silent (specificity).
  let f = run([
    {
      rel: "mingla-business/app/connect-onboarding.tsx",
      content: 'import { loadConnectAndInitialize } from "@stripe/connect-js";\n',
    },
  ]);
  if (f.length) self.push("GOOD (connect-js only, no webview) wrongly flagged");

  // BAD1 (revert-style): the DIY WebView-wrap — connect-js + react-native-webview.
  f = run([
    {
      rel: "mingla-business/src/screens/OnboardWrap.tsx",
      content:
        'import { loadConnectAndInitialize } from "@stripe/connect-js";\n' +
        'import { WebView } from "react-native-webview";\n',
    },
  ]);
  if (f.length === 0) self.push("BAD1 (connect-js + react-native-webview) not flagged");

  // BAD2 (regression, different angle): the @stripe/react-connect-js binding still
  // wrapped in react-native-webview — proves the (react-)? alternation stays load-bearing.
  f = run([
    {
      rel: "mingla-business/src/screens/OnboardWrap2.tsx",
      content:
        'import { ConnectComponentsProvider } from "@stripe/react-connect-js";\n' +
        'import { WebView } from "react-native-webview";\n',
    },
  ]);
  if (f.length === 0) self.push("BAD2 (react-connect-js + react-native-webview) not flagged");

  // SPECIFICITY: a file importing BOTH but carrying the allowlist tag stays silent.
  f = run([
    {
      rel: "mingla-business/src/screens/ApprovedWrap.tsx",
      content:
        "// orch-strict-grep-allow stripe-connect-js-with-webview — approved exception\n" +
        'import { loadConnectAndInitialize } from "@stripe/connect-js";\n' +
        'import { WebView } from "react-native-webview";\n',
    },
  ]);
  if (f.length) self.push("allowlisted connect-js + webview wrongly flagged");

  if (self.length) {
    console.error("I-PROPOSED-O self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-PROPOSED-O self-test PASS (4/4 cases).");
  process.exit(0);
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

function reportViolation(rel) {
  console.error(`ERROR: I-PROPOSED-O violation in ${rel}`);
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
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-O`,
  );
  console.error("");
}

const fileEntries = [];
try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTsTsx(dir)) {
      filesScanned += 1;
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch (err) {
        console.error(`READ-FAIL: ${rel} — ${err.message}`);
        readFailures += 1;
        continue;
      }
      fileEntries.push({ rel, content: source });
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

const failures = [];
check(fileEntries, failures);
for (const v of failures) {
  reportViolation(v.rel);
}
violations = failures.length;

console.error("");
console.error(
  `I-PROPOSED-O gate: scanned ${filesScanned} .ts/.tsx files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
