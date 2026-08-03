#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Issue #963 [consumer currency — no GBP fallback] regression check.
 *
 * The consumer explorer app (app-mobile) has NO strict-grep currency gate:
 * `orch-0769-app-wide-currency.mjs` — despite its "app-wide" name — scans only
 * `mingla-business/{app,src}` + `supabase/functions`, never `app-mobile`. So a
 * hardcoded `?? "GBP"` fallback could silently re-enter the explorer app.
 * (The last real one, `useTicketCart.ts` `DEFAULT_CURRENCY = "GBP"`, was removed
 * by this same issue.) This gate closes that hole for the consumer app.
 *
 * WHAT IT BANS (hardcoded GBP *fallback / default* literals, single- OR
 * double-quoted, in production `.ts`/`.tsx` under app-mobile/{app,src}):
 *   - `?? "GBP"`   (nullish-coalescing fallback)
 *   - `|| "GBP"`   (logical-or fallback)
 *   - `= "GBP"`    (assignment / default-parameter — NOT `==`/`===`/`!==`/`=>`)
 *   - `: "GBP"`    (object-literal / ternary value)
 * Comments are stripped first (a `'GBP'` inside `//` or block comments never
 * trips it); string literals are preserved (so a real `"GBP"` literal in code
 * IS seen).
 *
 * ALLOWLIST — the legit multi-currency DATA sites the investigation named, so
 * this gate is precise, not blunt:
 *   1. countryCurrencyService.ts GB row `currencyCode: 'GBP'` — this is the ONLY
 *      data site that matches a ban pattern (value-position `: 'GBP'`). It is
 *      exempted narrowly: ONLY the `currencyCode:` key, ONLY in that file. A
 *      `?? "GBP"` / `|| "GBP"` / `= "GBP"` or any OTHER colon-key (`currency:`,
 *      `defaultCurrency:` …) in that same file is STILL flagged — the allowlist
 *      cannot be abused to hide a real fallback.
 *   2. currencyService.ts `FALLBACK_RATES` `GBP: 0.73` and
 *   3. preferences.ts rate table `GBP: 0.73` — these are KEY-position (`GBP:`),
 *      not value-position, so they do not match any ban pattern. No allowlist
 *      entry is needed and none is added (a rule that never fires is dead code);
 *      they are documented here for completeness.
 *   4. localeDetection.ts comment (`… 'USD', 'GBP', 'EUR'`) — lives inside a
 *      `//` comment, removed by comment-stripping before scanning. No entry
 *      needed.
 *
 * SELF-CONSISTENCY: before scanning the tree, the same `scanSource` used on real
 * files is run against planted snippets proving each of the 4 forms is caught,
 * the allowlisted country-row is exempt, and a real fallback in the allowlisted
 * file is still caught. A broken scanner fails here (exit 1) before it can pass
 * a dirty tree.
 *
 * fails-on-revert: restore `useTicketCart`'s `= "GBP"` (or add any consumer
 * `?? "GBP"` / `|| "GBP"` / `: "GBP"`) → a violation is reported → exit 1.
 *
 * Exit 1 on any FAIL. Registered in app-mobile/package.json (test:issue-0963)
 * and .github/scripts/strict-grep/MANIFEST.json (run-batch class A, P11 totality).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../.."); // app-mobile/

const SCAN_ROOTS = ["app", "src"];
const EXCLUDED_DIRS = new Set(["__tests__", "scripts", "node_modules"]);
const isTestFile = (name) =>
  name.includes(".test.") || name.includes(".spec.");

/**
 * Strip comments while PRESERVING string literals and line numbers.
 * `'GBP'` inside a `//` or block comment becomes spaces; `"GBP"` inside a real
 * string literal is kept; a `//` that appears inside a string does NOT start a
 * comment. Newlines are preserved so reported line numbers stay accurate.
 */
export function stripComments(src) {
  let out = "";
  let state = "code"; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const c2 = src[i + 1];
    switch (state) {
      case "code":
        if (c === "/" && c2 === "/") { out += "  "; i++; state = "line"; }
        else if (c === "/" && c2 === "*") { out += "  "; i++; state = "block"; }
        else if (c === "'") { out += c; state = "sq"; }
        else if (c === '"') { out += c; state = "dq"; }
        else if (c === "`") { out += c; state = "tpl"; }
        else out += c;
        break;
      case "line":
        if (c === "\n") { out += c; state = "code"; }
        else out += " ";
        break;
      case "block":
        if (c === "*" && c2 === "/") { out += "  "; i++; state = "code"; }
        else out += c === "\n" ? "\n" : " ";
        break;
      case "sq":
        if (c === "\\") { out += c + (c2 ?? ""); i++; }
        else { out += c; if (c === "'") state = "code"; }
        break;
      case "dq":
        if (c === "\\") { out += c + (c2 ?? ""); i++; }
        else { out += c; if (c === '"') state = "code"; }
        break;
      case "tpl":
        if (c === "\\") { out += c + (c2 ?? ""); i++; }
        else { out += c; if (c === "`") state = "code"; }
        break;
    }
  }
  return out;
}

// The 4 banned fallback forms. Each matches single- OR double-quoted GBP.
export const PATTERNS = [
  { id: "nullish", form: '?? "GBP"', re: /\?\?\s*(['"])GBP\1/g },
  { id: "or", form: '|| "GBP"', re: /\|\|\s*(['"])GBP\1/g },
  // assignment / default-param, but NOT ==, ===, !=, !==, >=, <= (comparisons)
  // and NOT => (arrow). Negative lookbehind guards the operator families.
  { id: "assign", form: '= "GBP"', re: /(?<![=!<>])=\s*(['"])GBP\1/g },
  { id: "colon", form: ': "GBP"', re: /:\s*(['"])GBP\1/g },
];

// Legit multi-currency DATA — exempted NARROWLY (file + colon-key). Only the one
// site that actually matches a ban pattern is listed; see header for the rest.
export const ALLOWLIST = [
  {
    file: "src/services/countryCurrencyService.ts",
    colonKey: "currencyCode",
    reason:
      "country→currency reference table row (GB → GBP): legit multi-currency data, not a fallback",
  },
];

/** The identifier immediately before a colon match, or null (e.g. a ternary). */
function keyBeforeColon(codeLine, colonMatchIndex) {
  const before = codeLine.slice(0, colonMatchIndex);
  const m = before.match(/([A-Za-z_$][\w$]*)\s*$/);
  return m ? m[1] : null;
}

function isAllowlisted(fileRel, form, key) {
  if (form !== ': "GBP"') return false; // ?? / || / = are NEVER exempt
  return ALLOWLIST.some((a) => a.file === fileRel && a.colonKey === key);
}

/**
 * Scan one source file's content. Returns an array of violations
 * { file, line, col, form, snippet }. Shared by the real-file scan AND the
 * self-consistency assertion so the self-test exercises the real code path.
 */
export function scanSource(fileRel, content) {
  const violations = [];
  const codeLines = stripComments(content).split("\n");
  for (let i = 0; i < codeLines.length; i++) {
    const codeLine = codeLines[i];
    for (const { form, re } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(codeLine)) !== null) {
        const key = form === ': "GBP"' ? keyBeforeColon(codeLine, m.index) : null;
        if (isAllowlisted(fileRel, form, key)) continue;
        violations.push({
          file: fileRel,
          line: i + 1,
          col: m.index + 1,
          form,
          snippet: codeLine.trim().slice(0, 120),
        });
      }
    }
  }
  return violations;
}

function walk(absDir, acc) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(path.join(absDir, entry.name), acc);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !isTestFile(entry.name)
    ) {
      acc.push(path.join(absDir, entry.name));
    }
  }
}

// ── Self-consistency assertion (runs before the tree scan). ──
function selfCheck() {
  const cases = [
    { name: "?? double-quote caught", src: 'const c = ev.currency ?? "GBP";', file: "src/x.ts", expect: 1 },
    { name: "?? single-quote caught", src: "const c = ev.currency ?? 'GBP';", file: "src/x.ts", expect: 1 },
    { name: "|| double-quote caught", src: 'const c = ev.currency || "GBP";', file: "src/x.ts", expect: 1 },
    { name: "= default-param caught", src: 'const DEFAULT_CURRENCY = "GBP";', file: "src/x.ts", expect: 1 },
    { name: ": object-value caught", src: 'return { currency: "GBP" };', file: "src/x.ts", expect: 1 },
    { name: ": ternary-value caught", src: 'const c = ok ? "USD" : "GBP";', file: "src/x.ts", expect: 1 },
    { name: "comment // not caught", src: "// fallback ev.currency ?? 'GBP'", file: "src/x.ts", expect: 0 },
    { name: "block comment not caught", src: "/* default 'GBP' here */ const c = ev.currency;", file: "src/x.ts", expect: 0 },
    { name: "comparison === not caught", src: 'if (c === "GBP") log();', file: "src/x.ts", expect: 0 },
    { name: "!== not caught", src: "if (c !== 'GBP') log();", file: "src/x.ts", expect: 0 },
    { name: "allowlisted country row exempt", src: "{ countryCode: 'GB', currencyCode: 'GBP', currencySymbol: '£' },", file: "src/services/countryCurrencyService.ts", expect: 0 },
    { name: "real ?? in allowlisted file STILL caught", src: 'const c = ev.currency ?? "GBP";', file: "src/services/countryCurrencyService.ts", expect: 1 },
    { name: "non-currencyCode colon in allowlisted file STILL caught", src: "{ currency: 'GBP' },", file: "src/services/countryCurrencyService.ts", expect: 1 },
    { name: "// inside a string does not start a comment", src: 'const u = "http://x"; const c = a ?? "GBP";', file: "src/x.ts", expect: 1 },
  ];
  const failures = [];
  for (const c of cases) {
    const got = scanSource(c.file, c.src).length;
    if (got !== c.expect) failures.push(`${c.name}: expected ${c.expect}, got ${got}`);
  }
  return failures;
}

function main() {
  const selfFailures = selfCheck();
  if (selfFailures.length > 0) {
    console.error("[FAIL] issue-0963 scanner self-consistency BROKEN:");
    for (const f of selfFailures) console.error(`   - ${f}`);
    console.error("\nThe scanner cannot be trusted; refusing to report a green tree.");
    process.exit(1);
  }
  console.log(`[PASS] scanner self-consistency: ${14} planted cases behave as expected`);

  const files = [];
  for (const rel of SCAN_ROOTS) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) walk(abs, files);
  }

  const violations = [];
  for (const abs of files) {
    const rel = path.relative(ROOT, abs);
    violations.push(...scanSource(rel, fs.readFileSync(abs, "utf8")));
  }

  if (violations.length > 0) {
    console.error(
      `\n[FAIL] ${violations.length} hardcoded GBP fallback literal(s) in the consumer app:`,
    );
    for (const v of violations) {
      console.error(`   ${v.file}:${v.line}:${v.col} — banned form \`${v.form}\` — ${v.snippet}`);
    }
    console.error(
      "\nThe consumer explorer app floors missing currency to USD (issue #962/#963).\n" +
        "Use `?? \"USD\"` (or the caller-supplied fallback), never a hardcoded GBP.\n" +
        "Legit multi-currency DATA belongs in the allowlist (see the header).",
    );
    process.exit(1);
  }

  console.log(
    `[PASS] scanned ${files.length} consumer .ts/.tsx file(s) under app-mobile/{${SCAN_ROOTS.join(",")}} — no GBP fallback literals`,
  );
  console.log("\nissue-0963 consumer no-GBP-fallback check: all PASS");
}

// Entry-point guard — MUST use pathToFileURL so a checkout path containing `[`/`]`
// (the per-ORCH worktree `963-[consumer-currency-gate]`) still matches; a naive
// `file://${process.argv[1]}` percent-encodes differently and would silently skip
// main() (a green run that scanned nothing). The adversarial twin imports the
// exports above without triggering this.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
