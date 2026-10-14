#!/usr/bin/env node
// Issue #3645 — Host-facing copy never names the payment provider.
//
// THE RULE. A host connects "a bank" and is paid by "our payment partner". The
// words Stripe and Paystack must not appear in anything a host can read or
// hear in the Host app: visible text, button labels, accessibility labels,
// screen-reader announcements, placeholders, toasts, error messages,
// notification and email templates.
//
// WHAT IS CHECKED. Every string literal, template literal and piece of JSX
// text in the Host app's `app/` and `src/` trees (tests excluded) that
// contains either word. The files are PARSED (TypeScript compiler API), so a
// comment, an import path, an identifier, a type or a property name is never
// mistaken for copy.
//
// WHAT IS NOT COPY (and is skipped, by rule, not by luck):
//   * import / export / require specifiers and dynamic import() arguments;
//   * type positions (a literal type such as `"stripe" | "paystack"`);
//   * property names and object keys;
//   * `testID`, `nativeID`, `key`, `id`, `name`, `href`, `source` JSX attributes;
//   * arguments to `console.*` (developer logs);
//   * a single token with no whitespace that is not the bare brand word
//     (`"stripe"`, `"paystack"`, `"stripe_charges_disabled"`,
//     `"/connect-onboarding"`, `"brand-stripe-onboard"`): provider codes,
//     server reason codes, analytics keys, routes and function names. The bare
//     capitalised word (`"Stripe"`, `"Paystack"`) IS copy;
//   * the word INSIDE an identifier (`stripe_payment_intent_id` in a column
//     list, `fetchBrandStripeBalances: edge fn returned null`): only the
//     standalone word counts. Identifiers are not renamed by this rule.
//
// THE ALLOWLISTS, both explicit:
//   1. A LINE may carry `orch-strict-grep-allow provider-name-host-copy — <why>`
//      on it or on the line above. Used where a string is compared against
//      text the SERVER sends, and is never shown.
//   2. EXEMPT_FILES below: partner surfaces and the activity log, whose copy
//      is swept in the second pull request (#3645), and buyer checkout copy,
//      which is not host-facing. Each entry names why it is listed. Removing
//      a file from the list turns the rule on for it.
//
// IT FAILS CLOSED AND IS AUDIBLE. A file that cannot be read or parsed, an
// allowlisted file that no longer exists, an allowlisted file that no longer
// needs its exemption, or zero files scanned is a failure. Every exemption in
// use is printed. `--self-test` proves the rule is not vacuous.
//
// Usage:
//   node .github/scripts/strict-grep/issue-3645-no-provider-names-in-host-copy.mjs
//   node .github/scripts/strict-grep/issue-3645-no-provider-names-in-host-copy.mjs --self-test
//   node .github/scripts/strict-grep/issue-3645-no-provider-names-in-host-copy.mjs --list   (every finding, exemptions ignored)

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const TAG = "issue-3645-no-provider-names-in-host-copy";
const ALLOW_MARKER = "orch-strict-grep-allow provider-name-host-copy";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_ROOT = path.join(REPO_ROOT, "mingla-business");
const SCAN_DIRS = ["app", "src"];
const PROVIDER_ANYWHERE = /stripe|paystack/i;
// The standalone word: not part of a longer identifier.
const PROVIDER = /(?<![A-Za-z0-9_])(?:stripe|paystack)(?![A-Za-z0-9_])/i;
const BARE_BRAND = /^(?:Stripe|Paystack)[^A-Za-z0-9]*$/;

// Paths are relative to mingla-business/. A trailing "/" exempts a directory.
const TRANCHE_2_FILES = [
  // --- Swept in the SECOND pull request of #3645 ---------------------------
  // Partner (affiliate) earnings and payout setup: a separate audience and a
  // separate approval; not part of the host bank-setup tranche.
  "app/partner/",
  "app/connect-partner-account-management.tsx",
  "src/components/partner/",
  "src/components/stripe/connect-pages/ConnectPartnerOnboardingBody.web.tsx",
  "src/components/stripe/connect-pages/ConnectPartnerAccountManagementBody.web.tsx",
  // The brand activity log: about fifty action labels that describe provider
  // events to the host; reworded together in the second pull request.
  "src/utils/auditActionLabels.ts",
  // --- Not host-facing ------------------------------------------------------
  // Buyer checkout. A BUYER reads these, at the moment of paying; naming who
  // handles the card there is a separate product decision (#3645 covers what
  // a HOST is told).
  "src/components/experience/ExperienceCheckoutFlow.tsx",
  "src/components/trip/TripCheckoutFlow.tsx",
  "src/payments/nativeCheckoutFlow.native.ts",
  // An engineer's diagnostic for a mis-built app (test keys against a live
  // backend). It names the admin page and the runbook; it is not host copy.
  "src/services/stripeModeHandshake.ts",
];

// TypeScript is installed for class B gates at the repo root; a local run
// finds it in the Host app's own node_modules.
function loadTypeScript() {
  const bases = [
    path.join(REPO_ROOT, "package.json"),
    path.join(APP_ROOT, "package.json"),
  ];
  for (const base of bases) {
    try {
      return createRequire(base)("typescript");
    } catch {
      // try the next location
    }
  }
  return null;
}

function isTestPath(rel) {
  return /(^|\/)__tests__\//.test(rel) || /\.(test|spec)\.[A-Za-z0-9]+$/.test(rel) ||
    /(^|\/)__mocks__\//.test(rel);
}

function listFiles(root, dirs) {
  const out = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const next = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const rel = path.relative(root, next).split(path.sep).join("/");
        if (!isTestPath(rel)) out.push(rel);
      }
    }
  };
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out.sort();
}

const SKIPPED_JSX_ATTRIBUTES = new Set([
  "testID", "nativeID", "key", "id", "name", "href", "source",
]);

/** Every provider-naming piece of copy in one file: [{ line, text }]. */
function findCopy(ts, rel, sourceText) {
  const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, sourceText, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) {
    throw new Error(`parse error: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}`);
  }
  const found = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const inTypePosition = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
      if (ts.isExpression(p) && !ts.isLiteralTypeNode(p)) return false;
    }
    return false;
  };
  const isSkippedPosition = (node) => {
    const parent = node.parent;
    if (!parent) return false;
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) ||
      ts.isExternalModuleReference(parent) || ts.isImportTypeNode(parent)) return true;
    if (ts.isLiteralTypeNode(parent) || inTypePosition(node)) return true;
    if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) ||
      ts.isEnumMember(parent)) && parent.name === node) return true;
    if (ts.isComputedPropertyName(parent)) return true;
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
    if (ts.isJsxAttribute(parent) && SKIPPED_JSX_ATTRIBUTES.has(parent.name.getText(sf))) return true;
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
      if (ts.isIdentifier(callee) && callee.text === "require") return true;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
        callee.expression.text === "console") return true;
    }
    return false;
  };
  const consider = (node, text) => {
    if (!PROVIDER.test(text)) return;
    const trimmed = text.trim();
    // A single token is a code, key, route or function name, unless it is the
    // bare capitalised brand word.
    if (!/\s/.test(trimmed) && !BARE_BRAND.test(trimmed)) return;
    found.push({ line: lineOf(node), text: trimmed.replace(/\s+/g, " ").slice(0, 160) });
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isSkippedPosition(node)) consider(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      if (!isSkippedPosition(node)) {
        // The whole template as one sentence, holes shown as "{}".
        const whole = node.head.text + node.templateSpans.map((s) => `{}${s.literal.text}`).join("");
        consider(node, whole);
      }
    } else if (ts.isJsxText(node)) {
      consider(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function lineIsAllowed(lines, line) {
  const here = lines[line - 1] ?? "";
  const above = lines[line - 2] ?? "";
  return here.includes(ALLOW_MARKER) || above.includes(ALLOW_MARKER);
}

function isTranche2(rel) {
  return TRANCHE_2_FILES.some((entry) =>
    entry.endsWith("/") ? rel.startsWith(entry) : rel === entry);
}

/** Runs the rule over a tree. Returns { failures: string[], notes: string[] }. */
function run(ts, root, { list = false } = {}) {
  const failures = [];
  const notes = [];
  const files = listFiles(root, SCAN_DIRS);
  if (files.length === 0) {
    failures.push("no files were scanned (the Host app tree was not found)");
    return { failures, notes, files: 0 };
  }
  const tranche2Used = new Set();
  for (const rel of files) {
    let text;
    let found;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
      if (!PROVIDER_ANYWHERE.test(text)) continue;
      found = findCopy(ts, rel, text);
    } catch (error) {
      failures.push(`${rel}: could not be checked (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (found.length === 0) continue;
    const lines = text.split("\n");
    if (!list && isTranche2(rel)) {
      const entry = TRANCHE_2_FILES.find((e) => (e.endsWith("/") ? rel.startsWith(e) : rel === e));
      tranche2Used.add(entry);
      notes.push(`EXEMPT (listed file): ${rel} — ${found.length} string(s)`);
      continue;
    }
    for (const hit of found) {
      if (!list && lineIsAllowed(lines, hit.line)) {
        notes.push(`EXEMPT (line marker): ${rel}:${hit.line} — "${hit.text}"`);
        continue;
      }
      failures.push(`${rel}:${hit.line} names the payment provider in host-facing copy: "${hit.text}"`);
    }
  }
  if (!list) {
    for (const entry of TRANCHE_2_FILES) {
      const abs = path.join(root, entry);
      if (!fs.existsSync(abs)) {
        failures.push(`TRANCHE_2_FILES lists "${entry}", which does not exist. Remove the entry.`);
      } else if (!tranche2Used.has(entry)) {
        failures.push(`TRANCHE_2_FILES lists "${entry}", but nothing in it names a provider any more. Remove the entry so the rule protects it.`);
      }
    }
  }
  return { failures, notes, files: files.length };
}

function report({ failures, notes, files }) {
  for (const note of notes) console.log(`[${TAG}] ${note}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[${TAG}] FAIL ${failure}`);
    console.error(
      `[${TAG}] ${failures.length} problem(s). Host copy says "bank", "payout account" or "our payment partner", never the provider's name.\n` +
        `  If the string is compared against server text and never shown, put this on the line above it:\n` +
        `    // ${ALLOW_MARKER} — <why it is never shown>\n` +
        `  Rule and history: docs/INVARIANT_REGISTRY.md, I-PROPOSED-3645-HOST-COPY-NO-PROVIDER-NAME.`,
    );
    return 1;
  }
  console.log(`[${TAG}] PASS ${files} file(s) scanned, ${notes.length} exemption(s) in use, no provider name in host-facing copy.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test: the rule must fail, by the right line, on each kind of copy, and
// must stay quiet on each kind of non-copy.
// ---------------------------------------------------------------------------
function selfTest(ts) {
  const os = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), `${TAG}-`));
  const write = (rel, body) => {
    const abs = path.join(os, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  let bad = 0;
  const expect = (name, ok) => {
    console.log(`[${TAG}] self-test ${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) bad += 1;
  };
  const exemptDirs = () => {
    // Every tranche-2 entry must exist and be in use, or the run fails for
    // that reason instead of the one under test.
    for (const entry of TRANCHE_2_FILES) {
      const rel = entry.endsWith("/") ? `${entry}x.tsx` : entry;
      write(rel, `export const t = "Powered by Stripe";\n`);
    }
  };
  try {
    exemptDirs();
    // 1. Non-copy is quiet.
    write("src/clean.tsx", [
      `import { a } from "../services/brandStripeService";`,
      `// Stripe is named in a comment`,
      `type Rail = "stripe" | "paystack";`,
      `const provider: Rail = "stripe";`,
      `const code = "stripe_charges_disabled";`,
      `const fn = "brand-paystack-onboard";`,
      `const cols = "id, stripe_payment_intent_id, stripe_charge_id, paystack_reference";`,
      `export function g() { throw new Error("fetchBrandStripeBalances: edge fn returned null"); }`,
      `console.error("[x] Stripe call failed", provider);`,
      `const map = { "Stripe fee": 1 };`,
      `export const C = () => <View testID="stripe banner" />;`,
      `export const ok = [a, code, fn, map];`,
      ``,
    ].join("\n"));
    expect("identifiers, codes, column lists, comments, types, keys, logs and test ids are not copy",
      run(ts, os).failures.length === 0);

    // 2. Each kind of copy fails.
    const cases = {
      "a string literal": `export const t = "Your bank details go directly to Stripe.";\n`,
      "a template literal": "export const t = (c: string) => `Stripe is connected for ${c}.`;\n",
      "JSX text": `export const C = () => <Text>Powered by Stripe. Your data is encrypted.</Text>;\n`,
      "an accessibility label": `export const C = () => <Button accessibilityLabel="Disconnect Stripe" />;\n`,
      "an error message": `export function f() { throw new Error("Paystack could not verify this account."); }\n`,
      "the bare brand word": `export const sublabel = "Paystack";\n`,
      "an announcement": `export const f = () => announce("Confirming your Stripe status.");\n`,
    };
    for (const [name, body] of Object.entries(cases)) {
      write("src/copy.tsx", body);
      const result = run(ts, os);
      expect(`${name} is caught`, result.failures.length === 1 && result.failures[0].includes("src/copy.tsx:1"));
    }
    // 3. The line marker exempts exactly its line.
    write("src/copy.tsx", [
      `// ${ALLOW_MARKER} — compared against server text, never shown`,
      `export const a = message.includes("Stripe account");`,
      `export const b = "Stripe is verifying your details.";`,
      ``,
    ].join("\n"));
    const marked = run(ts, os);
    expect("a line marker exempts its own line only",
      marked.failures.length === 1 && marked.failures[0].includes("src/copy.tsx:3"));
    fs.rmSync(path.join(os, "src/copy.tsx"));

    // 4. A test file is out of scope.
    write("src/__tests__/x.test.ts", `export const t = "Powered by Stripe";\n`);
    expect("test files are out of scope", run(ts, os).failures.length === 0);

    // 5. A stale exemption fails.
    const first = TRANCHE_2_FILES[0];
    const firstRel = first.endsWith("/") ? `${first}x.tsx` : first;
    write(firstRel, `export const t = "Payout account";\n`);
    expect("an exemption nothing needs any more is a failure",
      run(ts, os).failures.some((f) => f.includes(first) && f.includes("Remove the entry")));
    fs.rmSync(path.join(os, firstRel));
    expect("an exemption for a missing path is a failure",
      first.endsWith("/")
        ? (fs.rmSync(path.join(os, first), { recursive: true, force: true }),
          run(ts, os).failures.some((f) => f.includes("does not exist")))
        : run(ts, os).failures.some((f) => f.includes("does not exist")));
    exemptDirs();

    // 6. An unparsable file fails closed.
    write("src/broken.tsx", `export const t = "Stripe is here" +;\n`);
    expect("a file that cannot be parsed is a failure",
      run(ts, os).failures.some((f) => f.includes("src/broken.tsx") && f.includes("could not be checked")));
    fs.rmSync(path.join(os, "src/broken.tsx"));

    // 7. An empty tree fails closed.
    const empty = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), `${TAG}-empty-`));
    expect("an empty tree is a failure", run(ts, empty).failures.length === 1);
    fs.rmSync(empty, { recursive: true, force: true });
  } finally {
    fs.rmSync(os, { recursive: true, force: true });
  }
  if (bad > 0) {
    console.error(`[${TAG}] self-test: ${bad} check(s) failed.`);
    return 1;
  }
  console.log(`[${TAG}] self-test PASS`);
  return 0;
}

const ts = loadTypeScript();
if (ts === null) {
  console.error(`[${TAG}] FAIL the TypeScript compiler is not installed; this gate cannot read the files.`);
  process.exit(2);
}
if (process.argv.includes("--self-test")) process.exit(selfTest(ts));
process.exit(report(run(ts, APP_ROOT, { list: process.argv.includes("--list") })));
