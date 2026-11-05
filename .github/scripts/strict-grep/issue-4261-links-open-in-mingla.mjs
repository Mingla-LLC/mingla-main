#!/usr/bin/env node
// Issue #4261 (amendment 1, section 8) — links open inside Mingla.
//
// MINGLA-INVARIANT: I-4261-LINKS-OPEN-IN-MINGLA | issue #4261 | No raw outside-link call (Linking.openURL, openBrowserAsync, openAuthSessionAsync) in the Explorer app outside the allowlist below; web pages open in Mingla's in-app browser through useOpenInMingla() and documents through its openDocument.
//
// WHY A GATE. Explorer used to send people to Safari / Chrome from about twenty
// places. Every web page now goes through ONE helper,
// app-mobile/src/components/InAppBrowserProvider.tsx (useOpenInMingla). A new
// screen can bring a raw call back with one line, and nothing a person sees in
// review would catch it. This gate makes that line fail CI.
//
// WHAT IS CHECKED. Every app-mobile/src/** and app-mobile/app/** .ts / .tsx
// file, except __tests__/ folders and *.test.* files. Comments are removed
// first (line and block; string- and regex-aware), so a comment that mentions
// Linking.openURL never counts and never hides a call. Then every remaining
// mention of `openURL`, `openBrowserAsync` or `openAuthSessionAsync` as a whole
// word is flagged — a call, an alias (`const { openURL } = Linking`) or an
// import. `canOpenURL` and `Linking.openSettings()` are not flagged.
//
// ALLOWED WITHOUT LISTING. A call whose first argument is a string or template
// literal that starts with `tel:`, `mailto:` or `sms:` (the phone, email and SMS
// apps are the destination, not a web page).
//
// EVERYTHING ELSE must be in ALLOWLIST with the EXACT number of flagged
// mentions in that file and a reason. More than listed fails (a new raw call);
// fewer than listed fails as stale (the list may only shrink, so shrink it in
// the same change that removes a call).
//
// Exit codes: 0 pass, 1 violation, 2 script error.
//
// Usage:
//   node .github/scripts/strict-grep/issue-4261-links-open-in-mingla.mjs
//   node .github/scripts/strict-grep/issue-4261-links-open-in-mingla.mjs --self-test

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "I-4261-LINKS-OPEN-IN-MINGLA";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_ROOT = path.join(REPO_ROOT, "app-mobile");
const SCAN_DIRS = ["src", "app"];

/**
 * Paths are relative to app-mobile/. `count` is the exact number of flagged
 * mentions after comments are removed.
 */
export const ALLOWLIST = new Map([
  ["src/components/InAppBrowserProvider.tsx", {
    count: 2,
    issue: "#4261",
    reason: "The one helper: Linking.openURL for tel:/mailto:/sms: only, and openBrowserAsync for documents (the in-app overlay; Android's WebView cannot render a PDF).",
  }],
  ["app/index.tsx", {
    count: 1,
    issue: "#4063",
    reason: "Claim-link redirect. resolve_claim_link only returns target_url matching https://*.usemingla.com/checkout/ (a waitlist offer's paid checkout page, not a universal link the app routes); a payment page stays out of Mingla's WebView like every payment flow below.",
  }],
  ["src/components/programs/VideoTile.tsx", {
    count: 2,
    issue: "#3872",
    reason: "Creator video playback (HLS) the in-app WebView cannot play on Android; openBrowserAsync is an overlay that stays inside Mingla. Plain async functions with no React tree to reach a provider.",
  }],
  ["src/payments/nativeCheckoutFlow.ts", {
    count: 1,
    issue: "#2227",
    reason: "Payment provider authorization page (Paystack). openBrowserAsync, never openAuthSession and never a host WebView.",
  }],
  ["src/screens/Event/ConsumerEventDetailScreen.tsx", {
    count: 2,
    issue: "#2227",
    reason: "Payment provider authorization and hosted checkout pages.",
  }],
  ["src/components/stay/ConsumerStayGuestExperience.tsx", {
    count: 1,
    issue: "#2227",
    reason: "Payment provider authorization page for a stay.",
  }],
  ["app/stay/[groupId].tsx", {
    count: 1,
    issue: "#2227",
    reason: "Payment provider authorization page for a stay.",
  }],
  ["src/components/venueOrdering/useConsumerVenueOrdering.ts", {
    count: 2,
    issue: "#2227",
    reason: "Payment provider authorization page for a venue order (create and retry).",
  }],
  ["src/hooks/useReserveTable.ts", {
    count: 1,
    issue: "#2227",
    reason: "Payment provider authorization page for a table deposit.",
  }],
  ["src/services/payoutService.ts", {
    count: 1,
    issue: "#4261",
    reason: "Payout onboarding: an OAuth-style flow that must return to the app through its return URL (openAuthSessionAsync).",
  }],
  ["src/components/MandatoryUpdateGate.tsx", {
    count: 1,
    issue: "#4261",
    reason: "App Store / Google Play listing for a required update; only the store app can install it.",
  }],
  ["src/components/profile/BillingSheet.tsx", {
    count: 2,
    issue: "#4261",
    reason: "Store subscription management (App Store / Google Play); only the store can change a subscription.",
  }],
  ["src/utils/openMapsTarget.ts", {
    count: 4,
    issue: "#4261",
    reason: "Turn-by-turn directions handoff to the maps app the person picks, with its https fallback (open question O-1: kept by default).",
  }],
  ["src/components/onboarding/OnboardingCollaborationStep.tsx", {
    count: 1,
    issue: "#4261",
    reason: "Internal mingla:// chat deep link, not a web page (discovery D-6: the scheme may not be registered; tracked on #4261, not changed here).",
  }],
]);

const FLAGGED = /\b(openURL|openBrowserAsync|openAuthSessionAsync)\b/g;
const SYSTEM_LITERAL = /^\s*(['"`])(tel|mailto|sms):/i;
// After one of these, a `/` starts a regular expression, not a division.
const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_KEYWORDS = /(?:^|[^\w$])(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/**
 * Removes // and /* *\/ comments, keeping strings, template literals and
 * regular expression literals exactly as written. Removed characters become
 * spaces (newlines are kept), so offsets and line numbers do not move.
 */
export function stripComments(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  let lastSignificant = "";
  let lastWordEnd = "";
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      i = j + 1;
      lastSignificant = c;
      continue;
    }
    if (c === "`") {
      // Template literal; `${ ... }` holes are code and may hold strings.
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const t = source[j];
        if (depth === 0) {
          if (t === "\\") { j += 2; continue; }
          if (t === "`") break;
          if (t === "$" && source[j + 1] === "{") { depth = 1; j += 2; continue; }
          j += 1;
        } else {
          if (t === "{") depth += 1;
          else if (t === "}") depth -= 1;
          else if (t === "'" || t === '"') {
            let k = j + 1;
            while (k < n && source[k] !== t && source[k] !== "\n") k += source[k] === "\\" ? 2 : 1;
            j = k;
          }
          j += 1;
        }
      }
      i = j + 1;
      lastSignificant = "`";
      continue;
    }
    if (c === "/" && (REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.test(lastWordEnd))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== "\n") {
        const t = source[j];
        if (t === "\\") { j += 2; continue; }
        if (t === "[") inClass = true;
        else if (t === "]") inClass = false;
        else if (t === "/" && !inClass) break;
        j += 1;
      }
      i = j + 1;
      while (i < n && /[a-z]/i.test(source[i])) i += 1;
      lastSignificant = "/";
      lastWordEnd = "";
      continue;
    }
    if (!/\s/.test(c)) {
      lastSignificant = c;
      lastWordEnd = /[\w$]/.test(c) ? `${lastWordEnd}${c}`.slice(-12) : "";
    }
    i += 1;
  }
  return out.join("");
}

/** Flagged mentions in one file's source: [{ line, word, inlineAllowed }]. */
export function scanSource(source) {
  const code = stripComments(source);
  const hits = [];
  for (const match of code.matchAll(FLAGGED)) {
    const after = code.slice(match.index + match[0].length);
    const call = /^\s*\(/.exec(after);
    const inlineAllowed = call !== null && SYSTEM_LITERAL.test(after.slice(call[0].length));
    const line = code.slice(0, match.index).split("\n").length;
    hits.push({ line, word: match[1], inlineAllowed });
  }
  return hits;
}

function isScanned(relative) {
  if (!/\.(ts|tsx)$/.test(relative)) return false;
  if (relative.split("/").includes("__tests__")) return false;
  if (/\.test\.[^/]+$/.test(relative)) return false;
  return true;
}

function walk(root, relative, files) {
  const absolute = path.join(root, relative);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, child, files);
    else if (entry.isFile() && isScanned(child)) files.set(child, fs.readFileSync(path.join(root, child), "utf8"));
  }
}

export function loadTree(appRoot = APP_ROOT) {
  const files = new Map();
  for (const dir of SCAN_DIRS) {
    if (!fs.existsSync(path.join(appRoot, dir))) throw new Error(`missing scan root app-mobile/${dir}`);
    walk(appRoot, dir, files);
  }
  return files;
}

/** Returns the list of failures for a file map against an allowlist. */
export function evaluate(files, allowlist = ALLOWLIST) {
  const failures = [];
  for (const [file, source] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const flagged = scanSource(source).filter((hit) => !hit.inlineAllowed);
    const entry = allowlist.get(file);
    const allowed = entry?.count ?? 0;
    if (flagged.length > allowed) {
      const where = flagged.map((hit) => `${hit.word} at line ${hit.line}`).join(", ");
      failures.push(
        `${file}: ${flagged.length} raw outside-link call(s), ${allowed} allowed (${where}). ` +
          "Open web pages with useOpenInMingla().open and documents with openDocument " +
          "(app-mobile/src/components/InAppBrowserProvider.tsx).",
      );
    } else if (entry && flagged.length < allowed) {
      failures.push(
        `${file}: allowlist says ${allowed} call(s) but ${flagged.length} remain. ` +
          "The list may only shrink: lower its count (or remove the entry) in this change.",
      );
    }
  }
  for (const [file, entry] of allowlist) {
    if (!files.has(file)) failures.push(`${file}: allowlisted (${entry.count}) but the file is not in the scanned tree; remove the stale entry.`);
    if (!entry.reason || !entry.issue) failures.push(`${file}: allowlist entry needs a reason and an issue.`);
  }
  return failures;
}

function runPlain() {
  const files = loadTree();
  if (files.size < 200) {
    console.error(`FAIL [${TAG}]: only ${files.size} files scanned under app-mobile/src and app-mobile/app; the tree looks wrong.`);
    return 1;
  }
  const failures = evaluate(files);
  if (failures.length > 0) {
    console.error(`FAIL [${TAG}] — ${failures.length} problem(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  const allowedCalls = [...ALLOWLIST.values()].reduce((sum, entry) => sum + entry.count, 0);
  console.log(`PASS [${TAG}]: ${files.size} files scanned; ${allowedCalls} allowlisted call(s) in ${ALLOWLIST.size} file(s); no raw outside-link call elsewhere.`);
  return 0;
}

function runSelfTest() {
  const cases = [];
  const expect = (name, files, allowlist, shouldPass) => {
    const failures = evaluate(new Map(Object.entries(files)), allowlist);
    const passed = failures.length === 0;
    cases.push({ name, ok: passed === shouldPass, failures });
  };
  const none = new Map();
  const one = (file, count) => new Map([[file, { count, issue: "#0", reason: "fixture" }]]);

  expect("FAIL on a new raw Linking.openURL(url)", { "src/a.tsx": "Linking.openURL(url);\n" }, none, false);
  expect("FAIL on a raw Linking.openURL(\"https://...\")", { "src/a.tsx": "void Linking.openURL(\"https://example.com\");\n" }, none, false);
  expect("FAIL on a raw WebBrowser.openBrowserAsync(url)", { "src/a.tsx": "await WebBrowser.openBrowserAsync(url);\n" }, none, false);
  expect("FAIL on openAuthSessionAsync", { "app/x.tsx": "await WebBrowser.openAuthSessionAsync(u, r);\n" }, none, false);
  expect("FAIL on an aliased openURL", { "src/a.tsx": "const { openURL } = Linking;\nopenURL(u);\n" }, none, false);
  expect("FAIL on a call split across lines", { "src/a.tsx": "Linking\n  .openURL(\n    url,\n  );\n" }, none, false);
  expect("FAIL on a stale allowlist count (fewer calls than listed)", { "src/a.tsx": "Linking.openURL(url);\n" }, one("src/a.tsx", 2), false);
  expect("FAIL on more calls than listed", { "src/a.tsx": "Linking.openURL(a);\nLinking.openURL(b);\n" }, one("src/a.tsx", 1), false);
  expect("FAIL on an allowlist entry for a missing file", { "src/a.tsx": "" }, one("src/gone.tsx", 1), false);
  expect("FAIL when a regex literal with // precedes a call on the same line", {
    "src/a.tsx": "const ok = /^https?:\\/\\//.test(u); Linking.openURL(u);\n",
  }, none, false);
  expect("FAIL when a string holds // before a call", { "src/a.tsx": "const u = \"https://x.com\"; Linking.openURL(u);\n" }, none, false);
  expect("PASS on a tel: string literal", { "src/a.tsx": "Linking.openURL(\"tel:+15551234\");\n" }, none, true);
  expect("PASS on a tel: template literal", { "src/a.tsx": "Linking.openURL(`tel:${phone}`).catch(() => {});\n" }, none, true);
  expect("PASS on mailto: and sms: literals", { "src/a.tsx": "Linking.openURL('mailto:a@b.co');\nLinking.openURL(`sms:${n}`);\n" }, none, true);
  expect("PASS when the call is only in a line comment", { "src/a.tsx": "// Linking.openURL(url) was removed\nconst a = 1;\n" }, none, true);
  expect("PASS when the call is only in a block comment", { "src/a.tsx": "/**\n * never Linking.openURL(url) or openBrowserAsync(x)\n */\nconst a = 1;\n" }, none, true);
  expect("PASS on canOpenURL and openSettings", { "src/a.tsx": "await Linking.canOpenURL(u);\nLinking.openSettings();\n" }, none, true);
  expect("PASS on an exact allowlist count", { "src/a.tsx": "Linking.openURL(a); // why\n" }, one("src/a.tsx", 1), true);

  // Scope: test files are not scanned.
  const scoped = ["src/__tests__/a.ts", "src/a.test.ts", "src/a.md", "src/a.tsx"].filter(isScanned);
  cases.push({ name: "scope skips __tests__, *.test.* and non-TS files", ok: scoped.length === 1 && scoped[0] === "src/a.tsx", failures: [] });

  // The real tree passes.
  const realFailures = evaluate(loadTree());
  cases.push({ name: "PASS on the real tree", ok: realFailures.length === 0, failures: realFailures });

  let bad = 0;
  for (const result of cases) {
    if (result.ok) {
      console.log(`  ok   ${result.name}`);
    } else {
      bad += 1;
      console.error(`  FAIL ${result.name}`);
      for (const failure of result.failures) console.error(`       ${failure}`);
    }
  }
  if (bad > 0) {
    console.error(`FAIL [${TAG}] self-test: ${bad} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(`PASS [${TAG}] self-test: ${cases.length} case(s).`);
  return 0;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    process.exit(process.argv.includes("--self-test") ? runSelfTest() : runPlain());
  } catch (error) {
    console.error(`ERROR [${TAG}]: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(2);
  }
}
