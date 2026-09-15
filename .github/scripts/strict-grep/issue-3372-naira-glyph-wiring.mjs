#!/usr/bin/env node
/**
 * Issue #3372 [naira glyph on trips, experiences and RSVPs] —
 * I-3372-ONE-NAIRA-RULE.
 *
 * `Intl.NumberFormat(..., { style: "currency", currency: "NGN" })` prints
 * "NGN 25,000" on most engines and locales. #3341 (PR #3359) added ONE shared
 * rule, `withCurrencyGlyph` in packages/offering-rendering/currencyGlyph.ts, that
 * turns that into "₦25,000". #3372 sent every trip, experience and RSVP money
 * formatter through it: the shared offering pages, the Business app's public
 * routes and host screens, and the Explorer app's ticket cart, trip card and trip
 * screen.
 *
 * Most of those formatters live inside route and screen files that no unit test
 * can mount, so this gate holds the wiring structurally. The rendered behaviour
 * of the formatters that CAN be mounted is proven by
 * mingla-business/src/components/trip/__tests__/issue_3372_naira_trip_experience_rsvp.test.tsx.
 *
 * It fails when:
 *   - the shared rule disappears or stops mapping NGN to "₦";
 *   - a listed file disappears, or no longer formats currency at all (the list
 *     would silently check nothing — take the file off the list instead);
 *   - any `new Intl.NumberFormat(…, { style: "currency" })` in a listed file, or
 *     anywhere under the trip / experience / RSVP / shared-offering folders, is
 *     not written as `withCurrencyGlyph(new Intl.NumberFormat(…).format(…), code)`;
 *   - a listed file does not import `withCurrencyGlyph` from the shared module,
 *     defines its own copy, or hardcodes the "₦" glyph;
 *   - the experience creator's price-field symbol stops calling the rule.
 *
 * Comments are blanked before anything is matched, so a comment can never
 * satisfy the gate. Pure node, no dependencies (strict-grep class A).
 *
 * `--self-test` proves, on in-memory fixtures and on in-memory mutants of the
 * real files, that each failure mode trips the gate and that correct wiring
 * passes.
 *
 * Exit codes: 0 — clean (or self-test proven) · 1 — violation.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const RULE_FILE = "packages/offering-rendering/currencyGlyph.ts";
const SHARED_SPECIFIER = "@mingla/offering-rendering/currencyGlyph";
const PACKAGE_DIR = "packages/offering-rendering/";

/** Every money formatter #3372 routes through the shared rule, by file. */
export const WIRED_FILES = [
  // Shared offering package — public trip / experience / RSVP pages on buyer web,
  // the Business app and the Explorer app.
  "packages/offering-rendering/useTripOfferingState.ts",
  "packages/offering-rendering/TripPaymentChoice.tsx",
  "packages/offering-rendering/ExperienceOfferingBody.tsx",
  "packages/offering-rendering/RsvpChipInPanel.tsx",
  "packages/offering-rendering/RsvpOfferingBody.tsx",
  // Legacy event page: still renders a password-protected event's tickets once
  // the password is entered.
  "packages/offering-rendering/PublicEventPage.tsx",
  // Business app — public pages and host screens.
  "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx",
  "mingla-business/app/experience/[id]/index.tsx",
  "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  "mingla-business/app/trip/[id]/index.tsx",
  "mingla-business/app/trip/[id]/money/index.tsx",
  "mingla-business/app/trip/[id]/travelers/index.tsx",
  "mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx",
  "mingla-business/src/components/experience/ExperiencePreview.tsx",
  "mingla-business/src/components/offering/ExperienceStopsGalleryTile.tsx",
  "mingla-business/src/components/rsvp/RsvpStep5Setup.tsx",
  "mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx",
  "mingla-business/src/components/trip/PaymentPlanEditor.tsx",
  "mingla-business/src/components/trip/RefundPreviewBody.tsx",
  "mingla-business/src/components/trip/RefundPreviewSheet.tsx",
  "mingla-business/src/components/trip/TripCheckoutFlow.tsx",
  "mingla-business/src/components/trip/TripCreatorStep6Intake.tsx",
  "mingla-business/src/components/trip/TripPreview.tsx",
  "mingla-business/src/components/event/ChangeSummaryModal.tsx",
  // Explorer app.
  "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
  "app-mobile/src/components/discover/TripCard.tsx",
  "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
];

/** Files whose currency SYMBOL helper (no Intl call of its own) must call the rule. */
export const SYMBOL_HELPERS = [
  {
    file: "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx",
    helper: "currencySymbolFor",
  },
];

/** Folders where every Intl currency formatter must use the rule (non-test files). */
export const SWEPT_DIRS = [
  "packages/offering-rendering",
  "mingla-business/app/exp",
  "mingla-business/app/experience",
  "mingla-business/app/t",
  "mingla-business/app/trip",
  "mingla-business/app/checkout-trip",
  "mingla-business/app/checkout-experience",
  "mingla-business/src/components/experience",
  "mingla-business/src/components/trip",
  "mingla-business/src/components/rsvp",
  "app-mobile/src/screens/Trip",
  "app-mobile/src/screens/Experience",
];

// ---------------------------------------------------------------------------
// Source scanning (no parser dependency)
// ---------------------------------------------------------------------------

const IDENT = /[\w$]/;
// A `/` after one of these (or at the start) opens a regex literal, not a division.
const REGEX_PRECEDERS = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|of|in|void|delete|throw|yield|await|else)\s*$/;

/**
 * Replace every comment with spaces (newlines kept), leaving strings, template
 * literals, regex literals and code untouched, so offsets and line numbers still
 * point into the real file.
 *
 * A quote only opens a string when the same line closes it: JS strings cannot
 * span lines, and an apostrophe in JSX text ("Don't") must not swallow code.
 */
export function blankComments(src) {
  const out = src.split("");
  const n = src.length;
  const tplStack = []; // brace depth inside each open `${ … }`
  let i = 0;
  let inTemplate = false;
  let lastSignificant = "";

  const closesOnLine = (from, quote) => {
    for (let j = from; j < n; j++) {
      const c = src[j];
      if (c === "\\") { j++; continue; }
      if (c === "\n") return -1;
      if (c === quote) return j;
    }
    return -1;
  };
  const regexEnd = (from) => {
    let inClass = false;
    for (let j = from; j < n; j++) {
      const c = src[j];
      if (c === "\\") { j++; continue; }
      if (c === "\n") return -1;
      if (inClass) { if (c === "]") inClass = false; continue; }
      if (c === "[") { inClass = true; continue; }
      if (c === "/") return j;
    }
    return -1;
  };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (inTemplate) {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { inTemplate = false; lastSignificant = "`"; i++; continue; }
      if (c === "$" && next === "{") { tplStack.push(0); inTemplate = false; i += 2; lastSignificant = "{"; continue; }
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (; i < stop; i++) if (src[i] !== "\n") out[i] = " ";
      continue;
    }
    if (c === "'" || c === '"') {
      const end = closesOnLine(i + 1, c);
      if (end !== -1) { i = end + 1; lastSignificant = c; continue; }
      i++;
      continue;
    }
    if (c === "`") { inTemplate = true; i++; continue; }
    if (c === "/") {
      const before = src.slice(Math.max(0, i - 12), i);
      if (lastSignificant === "" || REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.test(before)) {
        const end = regexEnd(i + 1);
        if (end !== -1) {
          i = end + 1;
          while (i < n && IDENT.test(src[i])) i++;
          lastSignificant = "/";
          continue;
        }
      }
    }
    if (tplStack.length > 0) {
      if (c === "{") tplStack[tplStack.length - 1] += 1;
      if (c === "}") {
        if (tplStack[tplStack.length - 1] === 0) { tplStack.pop(); inTemplate = true; i++; continue; }
        tplStack[tplStack.length - 1] -= 1;
      }
    }
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return out.join("");
}

/** Index of the bracket that closes the one at `open` (quote-aware), or -1. */
function matchClose(code, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [pairs[code[open]]];
  for (let j = open + 1; j < code.length; j++) {
    const c = code[j];
    if (c === "'" || c === '"' || c === "`") {
      for (j++; j < code.length && code[j] !== c; j++) if (code[j] === "\\") j++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return j;
    }
  }
  return -1;
}

/** Split an argument list's text on top-level commas. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (c === "'" || c === '"' || c === "`") {
      for (j++; j < text.length && text[j] !== c; j++) if (text[j] === "\\") j++;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { parts.push(text.slice(start, j)); start = j + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

const prevNonSpace = (code, from) => {
  let j = from - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  return j;
};
const nextNonSpace = (code, from) => {
  let j = from;
  while (j < code.length && /\s/.test(code[j])) j++;
  return j;
};
const lineOf = (code, index) => code.slice(0, index).split("\n").length;
const RULE_CALL = /(?<![\w$.])withCurrencyGlyph\s*\(/;

/**
 * Every `new Intl.NumberFormat(…, { style: "currency" })` in already-blanked
 * code, with whether it is the first argument of a two-argument
 * `withCurrencyGlyph(new Intl.NumberFormat(…).format(…), code)` call.
 */
export function currencyFormatters(code) {
  const found = [];
  const NEW_INTL = /\bnew\s+Intl\s*\.\s*NumberFormat\s*\(/g;
  let m;
  while ((m = NEW_INTL.exec(code)) !== null) {
    const argsOpen = m.index + m[0].length - 1;
    const argsClose = matchClose(code, argsOpen);
    if (argsClose === -1) continue;
    const args = code.slice(argsOpen + 1, argsClose);
    if (!/(?:^|[{,\s])style\s*:\s*(["'`])currency\1/.test(args)) continue;
    found.push({ line: lineOf(code, m.index), wrapped: isWrapped(code, m.index, argsClose) });
  }
  return found;
}

function isWrapped(code, start, end) {
  let exprStart = start;
  let exprEnd = end + 1;
  // Step out of grouping parens: `(new Intl.NumberFormat(…))`.
  for (;;) {
    const p = prevNonSpace(code, exprStart);
    const q = nextNonSpace(code, exprEnd);
    if (p < 0 || code[p] !== "(" || code[q] !== ")") break;
    const beforeParen = prevNonSpace(code, p);
    if (beforeParen >= 0 && /[\w$)\]]/.test(code[beforeParen])) break; // a call, not a group
    exprStart = p;
    exprEnd = q + 1;
  }
  const format = /^\s*\.\s*format\s*\(/.exec(code.slice(exprEnd));
  if (!format) return false;
  const formatOpen = exprEnd + format[0].length - 1;
  const formatClose = matchClose(code, formatOpen);
  if (formatClose === -1) return false;
  const call = /(?<![\w$.])withCurrencyGlyph\s*\(\s*$/.exec(code.slice(0, exprStart));
  if (!call) return false;
  const callOpen = call.index + call[0].replace(/\s*$/, "").length - 1;
  const callClose = matchClose(code, callOpen);
  if (callClose === -1 || callClose < formatClose) return false;
  const argText = code.slice(callOpen + 1, callClose);
  const args = splitTopLevel(argText);
  if (args.length > 1 && args[args.length - 1].trim() === "") args.pop(); // trailing comma
  if (args.length !== 2 || args[1].trim() === "") return false;
  // The formatted string must be the WHOLE first argument.
  return args[0].trim() === code.slice(exprStart, formatClose + 1).trim();
}

export function importsSharedRule(code, rel) {
  const allowed = rel.startsWith(PACKAGE_DIR)
    ? new Set(["./currencyGlyph", SHARED_SPECIFIER])
    : new Set([SHARED_SPECIFIER]);
  const IMPORT = /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*(["'])([^"']+)\3/g;
  let m;
  while ((m = IMPORT.exec(code)) !== null) {
    if (m[1] || !allowed.has(m[4])) continue;
    if (m[2].split(",").map((s) => s.trim()).includes("withCurrencyGlyph")) return true;
  }
  return false;
}

export const definesOwnCopy = (code) =>
  /(?:\bfunction\s*\*?\s*withCurrencyGlyph\b|\b(?:const|let|var)\s+withCurrencyGlyph\b)/.test(code);

export const hardcodesNaira = (code) => /₦|\\u20a6|\\u\{20a6\}|&#8358;|&#x20a6;/i.test(code);

/** The body of `const helper = (…) => …` or `function helper(…) {…}`, or null. */
function helperBody(code, helper) {
  const decl = new RegExp(`\\b(?:(?:const|let|var)\\s+${helper}\\b[^=]*=|function\\s+${helper}\\s*\\()`).exec(code);
  if (!decl) return null;
  const from = decl.index + decl[0].length;
  const arrow = code.indexOf("=>", from);
  const brace = code.indexOf("{", from);
  let bodyStart;
  if (decl[0].startsWith("function")) bodyStart = brace;
  else if (arrow !== -1) bodyStart = nextNonSpace(code, arrow + 2);
  else return null;
  if (code[bodyStart] === "{") {
    const close = matchClose(code, bodyStart);
    return close === -1 ? null : code.slice(bodyStart, close + 1);
  }
  const semi = code.indexOf(";", bodyStart);
  return code.slice(bodyStart, semi === -1 ? code.length : semi);
}

// ---------------------------------------------------------------------------
// Checks (all I/O injected so --self-test can drive them)
// ---------------------------------------------------------------------------

export function checkWiredSource(rel, src) {
  const failures = [];
  const code = blankComments(src);
  const formatters = currencyFormatters(code);
  if (formatters.length === 0) {
    failures.push(`${rel}: no currency formatter found — the file no longer formats money, so take it off WIRED_FILES rather than let the gate check nothing.`);
  }
  for (const f of formatters.filter((x) => !x.wrapped)) {
    failures.push(`${rel}:${f.line}: currency formatter is not wrapped. Write it as withCurrencyGlyph(new Intl.NumberFormat(…).format(amount), currency).`);
  }
  if (!importsSharedRule(code, rel)) {
    failures.push(`${rel}: does not import withCurrencyGlyph from "${rel.startsWith(PACKAGE_DIR) ? "./currencyGlyph" : SHARED_SPECIFIER}".`);
  }
  if (definesOwnCopy(code)) failures.push(`${rel}: defines its own withCurrencyGlyph — use the shared rule, never a second copy.`);
  if (hardcodesNaira(code)) failures.push(`${rel}: hardcodes the naira glyph — add currencies to LOCAL_CURRENCY_GLYPHS in ${RULE_FILE} instead.`);
  return failures;
}

export function checkSymbolHelperSource({ file, helper }, src) {
  const failures = [];
  const code = blankComments(src);
  if (!importsSharedRule(code, file)) failures.push(`${file}: does not import withCurrencyGlyph from "${SHARED_SPECIFIER}".`);
  if (definesOwnCopy(code)) failures.push(`${file}: defines its own withCurrencyGlyph.`);
  if (hardcodesNaira(code)) failures.push(`${file}: hardcodes the naira glyph.`);
  const body = helperBody(code, helper);
  if (body === null) failures.push(`${file}: ${helper} not found.`);
  else if (!RULE_CALL.test(body)) failures.push(`${file}: ${helper} no longer calls withCurrencyGlyph, so the price-field symbol reads "NGN ".`);
  return failures;
}

export function checkRuleSource(src) {
  const code = blankComments(src);
  const failures = [];
  if (!/\bexport\s+const\s+withCurrencyGlyph\b/.test(code)) failures.push(`${RULE_FILE}: withCurrencyGlyph is no longer exported.`);
  if (!/\bNGN\s*:\s*(["'])₦\1/.test(code)) failures.push(`${RULE_FILE}: LOCAL_CURRENCY_GLYPHS no longer maps NGN to "₦".`);
  return failures;
}

/**
 * @param {{ read: (rel: string) => string | null, list: (relDir: string) => string[] | null }} io
 */
export function runChecks(io) {
  const failures = [];
  const rule = io.read(RULE_FILE);
  if (rule === null) failures.push(`${RULE_FILE}: the shared rule is missing.`);
  else failures.push(...checkRuleSource(rule));

  for (const rel of WIRED_FILES) {
    const src = io.read(rel);
    if (src === null) failures.push(`${rel}: listed file is missing.`);
    else failures.push(...checkWiredSource(rel, src));
  }
  for (const entry of SYMBOL_HELPERS) {
    const src = io.read(entry.file);
    if (src === null) failures.push(`${entry.file}: listed file is missing.`);
    else failures.push(...checkSymbolHelperSource(entry, src));
  }

  let scanned = 0;
  for (const dir of SWEPT_DIRS) {
    const files = io.list(dir);
    if (files === null) { failures.push(`${dir}: swept folder is missing.`); continue; }
    for (const rel of files) {
      const src = io.read(rel);
      if (src === null || !src.includes("NumberFormat")) continue;
      for (const f of currencyFormatters(blankComments(src))) {
        scanned += 1;
        if (!f.wrapped) failures.push(`${rel}:${f.line}: currency formatter is not wrapped with withCurrencyGlyph (folder sweep).`);
      }
    }
  }
  if (scanned === 0) failures.push("folder sweep found ZERO currency formatters — the sweep checked nothing.");
  return failures;
}

const readCache = new Map();
const listCache = new Map();
const diskIO = {
  read: (rel) => {
    if (!readCache.has(rel)) {
      const abs = join(ROOT, rel);
      readCache.set(rel, existsSync(abs) ? readFileSync(abs, "utf8") : null);
    }
    return readCache.get(rel);
  },
  list: (relDir) => {
    if (listCache.has(relDir)) return listCache.get(relDir);
    const absDir = join(ROOT, relDir);
    if (!existsSync(absDir)) return null;
    const out = [];
    const visit = (abs) => {
      for (const name of readdirSync(abs)) {
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        const child = join(abs, name);
        if (statSync(child).isDirectory()) visit(child);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
          out.push(relative(ROOT, child).split("\\").join("/"));
        }
      }
    };
    visit(absDir);
    listCache.set(relDir, out);
    return out;
  },
};

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const problems = [];
  const expect = (label, actual, wanted) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      problems.push(`${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
    }
  };
  const fmt = (src) => currencyFormatters(blankComments(src));
  const CURRENCY = `new Intl.NumberFormat(undefined, { style: "currency", currency: code })`;

  // Formatter shapes.
  expect("bare formatter", fmt(`const f = (c, code) => ${CURRENCY}.format(c);`), [{ line: 1, wrapped: false }]);
  expect("wrapped formatter", fmt(`const f = (c, code) => withCurrencyGlyph(${CURRENCY}.format(c), code);`), [{ line: 1, wrapped: true }]);
  expect(
    "prettier multi-line wrap with trailing comma",
    fmt(`return withCurrencyGlyph(\n  new Intl.NumberFormat(undefined, {\n    style: "currency",\n    currency: code,\n  }).format(c / 100),\n  code,\n);`),
    [{ line: 2, wrapped: true }],
  );
  expect("grouped formatter", fmt(`x = withCurrencyGlyph((${CURRENCY}).format(c), code);`), [{ line: 1, wrapped: true }]);
  expect("commented-out wrap", fmt(`// withCurrencyGlyph(\nconst f = (c, code) => ${CURRENCY}.format(c);`), [{ line: 2, wrapped: false }]);
  expect("block-commented wrap", fmt(`/* withCurrencyGlyph( */ ${CURRENCY}.format(c) /* , code) */;`), [{ line: 1, wrapped: false }]);
  expect("wraps something else", fmt(`withCurrencyGlyph(String(${CURRENCY}.format(c)), code);`), [{ line: 1, wrapped: false }]);
  expect("drops the currency argument", fmt(`withCurrencyGlyph(${CURRENCY}.format(c));`), [{ line: 1, wrapped: false }]);
  expect("extra argument", fmt(`withCurrencyGlyph(${CURRENCY}.format(c), code, extra);`), [{ line: 1, wrapped: false }]);
  expect("formatted value plus more", fmt(`withCurrencyGlyph(${CURRENCY}.format(c) + " each", code);`), [{ line: 1, wrapped: false }]);
  expect("formatter stored then used", fmt(`const nf = ${CURRENCY};\nreturn withCurrencyGlyph(nf.format(c), code);`), [{ line: 1, wrapped: false }]);
  expect("member call named alike", fmt(`util.withCurrencyGlyph(${CURRENCY}.format(c), code);`), [{ line: 1, wrapped: false }]);
  expect("non-currency number format", fmt(`const n = new Intl.NumberFormat("en-GB").format(3);`), []);
  expect("JSX apostrophe does not hide a formatter", fmt(`<Text>Don't pay</Text>\n{${CURRENCY}.format(c)}`), [{ line: 2, wrapped: false }]);
  expect("regex literal with quotes", fmt(`const r = /"(?:[^"])*"/g;\n${CURRENCY}.format(c);`), [{ line: 2, wrapped: false }]);
  expect("URL string is not a comment", fmt(`const u = "https://x.test"; withCurrencyGlyph(${CURRENCY}.format(c), code);`), [{ line: 1, wrapped: true }]);

  // Imports, copies, hardcoded glyphs.
  const good = `import { withCurrencyGlyph } from "${SHARED_SPECIFIER}";\nexport const f = (c, code) => withCurrencyGlyph(${CURRENCY}.format(c), code);\n`;
  const biz = "mingla-business/src/components/trip/Fixture.tsx";
  const pkg = "packages/offering-rendering/Fixture.tsx";
  expect("correct business file", checkWiredSource(biz, good), []);
  expect("correct package file (relative import)", checkWiredSource(pkg, good.replace(SHARED_SPECIFIER, "./currencyGlyph")), []);
  const trips = (label, rel, src) => { if (checkWiredSource(rel, src).length === 0) problems.push(`${label}: was not rejected`); };
  trips("business file with relative import", biz, good.replace(SHARED_SPECIFIER, "./currencyGlyph"));
  trips("missing import", biz, good.replace(/^import[^\n]*\n/, ""));
  trips("commented-out import", biz, `// ${good}`);
  trips("type-only import", biz, good.replace("import {", "import type {"));
  trips("aliased import", biz, good.replace("{ withCurrencyGlyph }", "{ withCurrencyGlyph as g }"));
  trips("own copy", biz, `${good}const withCurrencyGlyph = (s) => s;\n`);
  trips("hardcoded glyph", biz, `${good}const sym = "₦";\n`);
  trips("hardcoded escaped glyph", biz, `${good}const sym = "\\u20a6";\n`);
  trips("no formatter at all", biz, `import { withCurrencyGlyph } from "${SHARED_SPECIFIER}";\nexport const x = 1;\n`);
  trips("one of two formatters unwrapped", biz, `${good}export const g = (c, code) => ${CURRENCY}.format(c);\n`);
  expect("glyph only in a comment is fine", checkWiredSource(biz, `${good}// reads "₦25,000"\n`), []);

  // Symbol helper.
  const wizard = SYMBOL_HELPERS[0];
  const helperOk = `import { withCurrencyGlyph } from "${SHARED_SPECIFIER}";\nconst currencySymbolFor = (currency) => {\n  if (currency === "USD") return "$";\n  const glyph = withCurrencyGlyph(currency, currency);\n  return glyph !== currency ? glyph : \`\${currency} \`;\n};\n`;
  expect("symbol helper calling the rule", checkSymbolHelperSource(wizard, helperOk), []);
  if (checkSymbolHelperSource(wizard, helperOk.replace("withCurrencyGlyph(currency, currency)", "currency")).length === 0) problems.push("symbol helper without the rule call: was not rejected");
  if (checkSymbolHelperSource(wizard, helperOk.replace("const glyph = withCurrencyGlyph(currency, currency);", "// withCurrencyGlyph(currency, currency)\n  const glyph = currency;")).length === 0) problems.push("symbol helper with a commented-out call: was not rejected");
  if (checkSymbolHelperSource(wizard, helperOk.replace("currencySymbolFor", "symbolFor")).length === 0) problems.push("renamed symbol helper: was not rejected");

  // Shared rule.
  const ruleOk = `export const LOCAL_CURRENCY_GLYPHS = Object.freeze({ NGN: "₦" });\nexport const withCurrencyGlyph = (f, c) => f;\n`;
  expect("shared rule intact", checkRuleSource(ruleOk), []);
  if (checkRuleSource(ruleOk.replace(`NGN: "₦"`, `NGN: "NGN"`)).length === 0) problems.push("rule without the NGN row: was not rejected");
  if (checkRuleSource(ruleOk.replace("export const withCurrencyGlyph", "const withCurrencyGlyph")).length === 0) problems.push("rule no longer exported: was not rejected");

  // The real tree passes, and in-memory mutants of the real files each trip it.
  const baseline = runChecks(diskIO);
  if (baseline.length) problems.push(`real tree is not clean:\n  ${baseline.join("\n  ")}`);
  const overlay = (rel, transform) => ({
    read: (p) => {
      const src = diskIO.read(p);
      return p === rel && src !== null ? transform(src) : src;
    },
    list: diskIO.list,
  });
  const unwrapCalls = (src) => src.replace(/(?<![\w$.])withCurrencyGlyph\s*\(/g, "identityFormat(");
  for (const rel of WIRED_FILES) {
    if (runChecks(overlay(rel, unwrapCalls)).length === 0) problems.push(`${rel}: removing its withCurrencyGlyph calls was not rejected`);
    if (runChecks(overlay(rel, (s) => s.replace(/^import[^;]*\bwithCurrencyGlyph\b[^;]*;\s*$/m, ""))).length === 0) problems.push(`${rel}: removing its import was not rejected`);
    if (runChecks({ read: (p) => (p === rel ? null : diskIO.read(p)), list: diskIO.list }).length === 0) problems.push(`${rel}: deleting the file was not rejected`);
  }
  for (const { file } of SYMBOL_HELPERS) {
    if (runChecks(overlay(file, unwrapCalls)).length === 0) problems.push(`${file}: removing its withCurrencyGlyph call was not rejected`);
  }
  if (runChecks(overlay(RULE_FILE, (s) => s.replace(/NGN\s*:\s*"₦"/, `NGN: "NGN"`))).length === 0) problems.push("dropping the NGN row from the real rule was not rejected");
  if (runChecks({ read: diskIO.read, list: () => [] }).length === 0) problems.push("an empty folder sweep was not rejected");

  if (problems.length) {
    console.error(`issue #3372 naira glyph wiring self-test FAILED:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`issue #3372 naira glyph wiring self-test passed (fixtures, plus ${WIRED_FILES.length + SYMBOL_HELPERS.length} real files each mutated in memory).`);
  process.exit(0);
}

if (process.argv.includes("--self-test")) selfTest();

const failures = runChecks(diskIO);
if (failures.length) {
  console.error(`FAIL [I-3372-ONE-NAIRA-RULE] ${failures.length} violation(s):\n  ${failures.join("\n  ")}`);
  console.error(`\nEvery trip, experience and RSVP money display must go through withCurrencyGlyph (${RULE_FILE}) so naira reads "₦", not "NGN". See issue #3372.`);
  process.exit(1);
}
console.log(`OK [I-3372-ONE-NAIRA-RULE] ${WIRED_FILES.length} wired files, ${SYMBOL_HELPERS.length} symbol helper and ${SWEPT_DIRS.length} swept folders use the shared naira rule.`);
