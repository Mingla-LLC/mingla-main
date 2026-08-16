#!/usr/bin/env node
/**
 * Issue #2113 — A SOURCE-TEXT ASSERTION MAY NOT BE SATISFIED ONLY BY A COMMENT
 * OR ONLY BY A STRING LITERAL.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * A test reads a file as TEXT and asserts the text contains something:
 *
 *     const SHELL = biz("src/components/venue/VenueSuiteShell.tsx");
 *     expect(SHELL).toContain("VenueListingContent");
 *
 * `toContain` matches CHARACTERS. Characters occur in comments. They occur in
 * string literals. So the assertion is satisfied by prose ABOUT the behaviour
 * instead of the behaviour, and the test stays green while the behaviour is
 * absent. The confirmed live instance is exactly the one above: both strings
 * occur in `VenueSuiteShell.tsx` ONLY at lines 30–31, inside a comment block,
 * under a test literally named "renders VenueListingContent as Overview (real
 * UI, not a placeholder)". The component has zero production importers and is
 * in neither the web nor the iOS bundle. Deleting the entire venue tab would
 * not have reddened that test.
 *
 * A second instance was proved by mutation during the #2099 Amendment 7 review
 * (mutation M-6): a FORGED COMMENT left a structural check 9/9 green.
 *
 * ── WHAT THIS GATE DOES ────────────────────────────────────────────────────
 * For every source-text assertion it can statically resolve, it:
 *   1. resolves the target file the assertion reads,
 *   2. classifies EVERY CHARACTER of that target as CODE, COMMENT, or
 *      STRING_INTERIOR (a real scanner, not a regex strip — see TERRITORY),
 *   3. finds every occurrence of the asserted pattern in the target, and
 *   4. FAILS when EVERY occurrence lies wholly in non-executable territory.
 *
 * ── WHY "SPANS A CODE CHARACTER", NOT "STRIP AND RE-MATCH" ─────────────────
 * The naive implementation — delete comments and string literals, then re-run
 * the match — is WRONG in this codebase and would have been muted within a day.
 * `chromeMode="tab"` in real, rendered JSX contains a string literal (`"tab"`).
 * Blanking string interiors deletes the match from CORRECT code and reports a
 * false positive on the very shape the gate exists to protect.
 *
 * So the rule is positional, not textual: an occurrence is EXECUTABLE iff at
 * least one of its characters is CODE. Quote delimiters ARE code (they are
 * syntax). That single rule gets every case right:
 *
 *   <VenueListingContent chromeMode="tab" />   match spans `chromeMode=` + the
 *                                              opening quote  → EXECUTABLE ✔
 *   // ...mounts VenueListingContent with chromeMode="tab" VERBATIM
 *                                              every char is COMMENT → FAIL ✘
 *   const DOC = "renderVenue(props)";          match is wholly inside the
 *                                              string interior → FAIL ✘
 *
 * ── THE STRING-INTERIOR RULE IS DELIBERATELY NARROWER THAN THE COMMENT RULE ─
 * A comment is never executable, so a comment-only match always fails. A string
 * literal is different: half this repo's legitimate assertions are on user-
 * facing copy (`expect(CONTENT).toContain("Add your venue")`), which lives in a
 * string literal by construction and is a fair — if weak — claim. Failing those
 * would produce hundreds of findings, the gate would be muted, and it would
 * then be worth nothing. That is the documented failure mode of the ~45-false-
 * positive gate described in this directory's README.
 *
 * So a string-interior match is reported only when the literal is NARRATING —
 * talking about the behaviour rather than being it. `isNarratingString` below
 * carries the four conditions and the reasoning; the surviving shape is a bare
 * IDENTIFIER mentioned inside a sentence, which is what actually occurs
 * (`const todo = "mount VenueListingContent here once the API lands"`). Route
 * paths, testIDs, enum values, table names, error codes, CSS tokens, module
 * paths, codegen templates and user-facing copy are all NOT reported: in each
 * the literal IS the behaviour. Copy-presence assertions are a milder, different
 * class and are explicitly OUT OF SCOPE here.
 *
 * Every one of those exclusions was a real false positive on a repo scan during
 * development, not a hypothetical. The counts across the four scans were
 * 150 → 98 → 46 → 36 findings, and the whole reduction was false positives.
 *
 * ── WHAT THIS GATE DOES NOT CATCH. READ THIS BEFORE TRUSTING A GREEN RUN. ───
 * L1  ONLY STATICALLY RESOLVABLE BINDINGS. It follows `const X = readFileSync(
 *     <path>)` and one level of reader wrapper (`const biz = (r) =>
 *     readFileSync(join(__dirname, "..", r), "utf8")`), which is the shape of
 *     every confirmed instance. Contents routed through an injected object
 *     (`violations(files)` in the gate scripts here) are out of static reach.
 *     Those are covered by the review-step amendment in #2113, not by this file.
 * L2  IT DOES NOT PROVE THE ASSERTION IS BEHAVIOURAL. An assertion satisfied by
 *     real executable code still only proves the TEXT exists — not that it
 *     renders, is imported, or is reachable. #2111's dead component would pass
 *     this gate once someone writes the JSX. Instances 5–8 in #2113 (criteria
 *     that cannot PASS, mutually-propping checks, circular evidence, layout-
 *     gated blindness) are NOT in this file's reach and never will be; the only
 *     control for those is executing the mutation.
 * L3  IT PARSES TEXT. The JS scanner is a hand-written state machine, not
 *     babel — this is a class-A gate and takes no npm dependency. Known
 *     compromises, each chosen to bias toward FALSE NEGATIVES (missing a real
 *     violation) rather than false positives:
 *       · a `'` or `"` with no closing quote before end-of-line is treated as
 *         CODE, not as a runaway string — this is what keeps a JSX apostrophe
 *         (`<Text>Don't</Text>`) from marking the rest of the file as string.
 *       · `//` preceded by `:` is not a line comment (`https://…` in JSX text).
 *       · dollar-quoted SQL bodies are rescanned AS SQL (they are executable
 *         plpgsql), so `COMMENT ON … IS $$…$$` prose is read as code.
 *       · YAML gets COMMENT stripping only. In YAML a quoted scalar IS the
 *         configuration; treating it as inert would be wrong.
 *     Unknown extensions (.md, .json, .txt, .sh) are SKIPPED, never reported.
 * L4  A raw match that does not occur at all is not reported. That assertion is
 *     already red, or the path resolution was wrong. Both are someone else's
 *     problem and neither is laundering.
 *
 * ── MODE ───────────────────────────────────────────────────────────────────
 * `ENFORCEMENT_MODE` below is "report": every violation is printed with
 * file:line for BOTH the assertion and its non-executable match, and the plain
 * run exits 0. It lands non-blocking because the class it detects predates it —
 * #2113's sweep is being ranked and dispatched separately, and turning this red
 * on day one would red `main` for work this PR is explicitly forbidden to do.
 *
 * TO TURN IT BLOCKING: change ENFORCEMENT_MODE to "block". One line, one diff,
 * visible in review. The precondition is a zero count on `main` (or every
 * survivor carried in the allowlist with a stated reason). `--enforce` forces
 * block mode for a local proof without changing the file.
 *
 * The REPORT mode does not weaken the gate's own falsifiability: `--self-test`
 * drives the pure checker over fixtures in BOTH directions and exits non-zero
 * when a fixture stops behaving. A reporting gate whose self-test is wired
 * still fails CI the moment the detector itself breaks.
 *
 * ── ALLOWLIST ──────────────────────────────────────────────────────────────
 * Some assertions are legitimately about comments or literal text — a required
 * header banner, a `[TRANSITIONAL]` marker, a `// orch-strict-grep-allow` tag.
 * Two mechanisms, both requiring a written reason:
 *   (a) `issue-2113-comment-satisfied-allowlist.json` — an EXACT
 *       {test, target, pattern} triple plus a `reason` of >= 20 characters. No
 *       wildcards, no path prefixes, no pattern globs: an entry excuses exactly
 *       one assertion against exactly one target. A missing or stub reason is a
 *       hard error (exit 2), not a skip.
 *   (b) `// orch-strict-grep-allow comment-satisfied-assertion — <reason>` on
 *       the line immediately above the assertion, matching this directory's
 *       existing convention, for tests written after this gate lands.
 * An over-broad allowlist recreates the defect. Both mechanisms are deliberately
 * un-broadenable: neither accepts a pattern that matches more than one site.
 *
 * Self-test: `node .github/scripts/strict-grep/issue-2113-comment-satisfied-assertion.mjs --self-test`
 * Cross-reference: docs/INVARIANT_REGISTRY.md I-PROPOSED-2113-ASSERTION-NOT-COMMENT-SATISFIED
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const ALLOWLIST_PATH = path.join(HERE, "issue-2113-comment-satisfied-allowlist.json");

/** "report" prints violations and exits 0. "block" exits 1. See §MODE above. */
export const ENFORCEMENT_MODE = "report";

/** The verbatim inline allowlist tag, per this directory's README convention. */
export const ALLOW_TAG = "orch-strict-grep-allow comment-satisfied-assertion";

/** Minimum length of an allowlist `reason`. Short enough to write, long enough to mean something. */
export const MIN_REASON_LENGTH = 20;

// ───────────────────────────── territory classification ─────────────────────

export const CODE = 0;
export const COMMENT = 1;
export const STRING = 2;

const JS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SQL_EXT = new Set([".sql"]);
const YAML_EXT = new Set([".yml", ".yaml"]);

/** Language for a target path, or null when the file carries no comment grammar we model (L3). */
export function langOf(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (JS_EXT.has(ext)) return "js";
  if (SQL_EXT.has(ext)) return "sql";
  if (YAML_EXT.has(ext)) return "yaml";
  return null;
}

/** A `/` at these preceding significant characters starts a regex literal, not a division. */
const REGEX_PRECEDERS = new Set([
  "", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-",
  "*", "%", "~", "^", ">", "\n",
]);

function scanRegexLiteral(src, start) {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "\n") return -1;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      i++;
      while (i < src.length && /[a-z]/.test(src[i])) i++;
      return i;
    }
    i++;
  }
  return -1;
}

/**
 * Classify every character of a JS/TS/JSX source as CODE / COMMENT / STRING.
 * Quote and backtick delimiters are CODE — they are syntax, and an assertion
 * that spans one is anchored in executable text.
 */
export function classifyJs(src) {
  const n = src.length;
  const t = new Uint8Array(n); // CODE === 0
  const stack = []; // {kind:"tpl"} | {kind:"expr", depth:number}
  let lastSig = "";
  let i = 0;

  while (i < n) {
    const top = stack[stack.length - 1];

    if (top && top.kind === "tpl") {
      const c = src[i];
      if (c === "\\") { t[i] = STRING; if (i + 1 < n) t[i + 1] = STRING; i += 2; continue; }
      if (c === "`") { stack.pop(); i++; lastSig = "`"; continue; } // delimiter stays CODE
      if (c === "$" && src[i + 1] === "{") { stack.push({ kind: "expr", depth: 0 }); i += 2; continue; }
      t[i] = STRING;
      i++;
      continue;
    }

    const c = src[i];
    const c2 = src[i + 1];

    if (top && top.kind === "expr") {
      if (c === "{") { top.depth++; i++; lastSig = "{"; continue; }
      if (c === "}") {
        if (top.depth === 0) { stack.pop(); i++; lastSig = "}"; continue; }
        top.depth--; i++; lastSig = "}"; continue;
      }
    }

    // Line comment. `://` is a URL inside JSX text, not a comment (L3).
    if (c === "/" && c2 === "/" && src[i - 1] !== ":") {
      let j = i;
      while (j < n && src[j] !== "\n") { t[j] = COMMENT; j++; }
      i = j;
      continue;
    }

    // Block comment, incl. the `/* … */` half of a `{/* … */}` JSX comment.
    if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      const end = Math.min(n, j + 2);
      for (let k = i; k < end; k++) t[k] = COMMENT;
      i = end;
      continue;
    }

    if (c === "'" || c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;
        if (d === c) { closed = true; break; }
        j++;
      }
      if (closed) {
        for (let k = i + 1; k < j; k++) t[k] = STRING;
        i = j + 1;
        lastSig = c;
        continue;
      }
      // Unterminated before end-of-line: a prose apostrophe in JSX text, not a
      // string. Treated as CODE so it cannot poison the rest of the file (L3).
      i++;
      lastSig = "'";
      continue;
    }

    if (c === "`") { stack.push({ kind: "tpl" }); i++; continue; }

    if (c === "/" && REGEX_PRECEDERS.has(lastSig)) {
      const end = scanRegexLiteral(src, i);
      if (end > 0) { i = end; lastSig = "/"; continue; } // regex body is executable
    }

    if (!/\s/.test(c)) lastSig = c;
    i++;
  }

  return t;
}

/** Classify a PostgreSQL source. Dollar-quoted bodies are rescanned as SQL (L3). */
export function classifySql(src) {
  const n = src.length;
  const t = new Uint8Array(n);
  let i = 0;

  while (i < n) {
    const c = src[i];

    if (c === "-" && src[i + 1] === "-") {
      let j = i;
      while (j < n && src[j] !== "\n") { t[j] = COMMENT; j++; }
      i = j;
      continue;
    }

    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === "/" && src[j + 1] === "*") { depth++; j += 2; continue; }
        if (src[j] === "*" && src[j + 1] === "/") { depth--; j += 2; continue; }
        j++;
      }
      for (let k = i; k < j; k++) t[k] = COMMENT;
      i = j;
      continue;
    }

    if (c === "'") {
      const escaped = /[Ee]/.test(src[i - 1] ?? "") && !/[A-Za-z0-9_]/.test(src[i - 2] ?? " ");
      let j = i + 1;
      while (j < n) {
        if (escaped && src[j] === "\\") { j += 2; continue; }
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; } // doubled-quote escape
          break;
        }
        j++;
      }
      for (let k = i + 1; k < Math.min(j, n); k++) t[k] = STRING;
      i = Math.min(j + 1, n);
      continue;
    }

    if (c === '"') { // quoted identifier — an identifier is code, not a string
      let j = i + 1;
      while (j < n && src[j] !== '"') j++;
      i = Math.min(j + 1, n);
      continue;
    }

    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(src.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const close = src.indexOf(tag, bodyStart);
        const bodyEnd = close === -1 ? n : close;
        const inner = classifySql(src.slice(bodyStart, bodyEnd));
        for (let k = 0; k < inner.length; k++) t[bodyStart + k] = inner[k];
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }

    i++;
  }

  return t;
}

/** Classify YAML. Comments only — a quoted scalar IS the configuration (L3). */
export function classifyYaml(src) {
  const n = src.length;
  const t = new Uint8Array(n);
  let i = 0;
  let quote = null;

  while (i < n) {
    const c = src[i];
    if (c === "\n") { quote = null; i++; continue; }
    if (quote) {
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      // Only treat it as a scalar quote when it closes on the same line.
      const nl = src.indexOf("\n", i + 1);
      const lineEnd = nl === -1 ? n : nl;
      if (src.slice(i + 1, lineEnd).includes(c)) { quote = c; i++; continue; }
      i++;
      continue;
    }
    if (c === "#" && (i === 0 || /[\s]/.test(src[i - 1]))) {
      let j = i;
      while (j < n && src[j] !== "\n") { t[j] = COMMENT; j++; }
      i = j;
      continue;
    }
    i++;
  }

  return t;
}

export function classify(src, lang) {
  if (lang === "js") return classifyJs(src);
  if (lang === "sql") return classifySql(src);
  if (lang === "yaml") return classifyYaml(src);
  return null;
}

// ───────────────────────────── pattern shape ────────────────────────────────

/**
 * Is the asserted text a CODE-SHAPED claim (an identifier or something carrying
 * syntax), as opposed to prose copy? Gates the STRING-ONLY finding only; a
 * comment-only match is reported whatever its shape.
 */
export function isCodeShaped(text) {
  const t = String(text).trim();
  if (!t) return false;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) return true;   // bare identifier
  if (/[A-Za-z_$][\w$]*\s*\(/.test(t)) return true;        // a call / declaration
  if (/<[A-Za-z_$/]/.test(t)) return true;                 // JSX element or generic
  if (/=>|[^=!<>]=[^=]/.test(t)) return true;              // assignment or JSX attribute
  if (/\.[A-Za-z_$]/.test(t)) return true;                 // member access
  if (/[{}]/.test(t)) return true;                         // block syntax
  return false;
  // Deliberately NOT code-shaped: route paths ("/(tabs)/hub/listing"), slugs,
  // testIDs, storage keys, event names and user-facing copy. Those live in a
  // string literal BY CONSTRUCTION — `href={"/(tabs)/hub/listing"}` IS the
  // behaviour — so reporting them as string-satisfied would be wrong, and the
  // volume would mute the gate. Comment-ONLY matches are still reported for
  // every shape; this predicate gates only the string-interior direction.
}

// ───────────────────────────── literal parsing ──────────────────────────────

/** Parse a JS string literal starting at `i` (which must be a quote/backtick). */
export function parseStringLiteral(src, i) {
  const quote = src[i];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;
  let out = "";
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      const e = src[j + 1];
      out += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
      j += 2;
      continue;
    }
    if (c === quote) return { value: out, end: j + 1 };
    if (quote === "`" && c === "$" && src[j + 1] === "{") return null; // interpolated — unresolvable
    if (quote !== "`" && c === "\n") return null;
    out += c;
    j++;
  }
  return null;
}

/** Parse a JS regex literal starting at `i`. */
export function parseRegexLiteral(src, i) {
  if (src[i] !== "/") return null;
  const end = scanRegexLiteral(src, i);
  if (end < 0) return null;
  const raw = src.slice(i, end);
  const lastSlash = raw.lastIndexOf("/");
  return { source: raw.slice(1, lastSlash), flags: raw.slice(lastSlash + 1), end };
}

/** Parse the first argument of a call whose `(` is at `openParen`. */
export function parseAssertionArgument(src, openParen) {
  let i = openParen + 1;
  while (i < src.length && /\s/.test(src[i])) i++;
  const str = parseStringLiteral(src, i);
  if (str) return { kind: "literal", value: str.value, end: str.end };
  const re = parseRegexLiteral(src, i);
  if (re) return { kind: "regex", source: re.source, flags: re.flags, end: re.end };
  return null;
}

// ───────────────────────────── path resolution ──────────────────────────────

/**
 * Evaluate a path expression to an absolute path, or null when unresolvable.
 * Handles `__dirname`, string literals, `join`/`resolve`/`path.join`/
 * `path.resolve`, previously-bound path constants, simple template literals,
 * and one substituted wrapper parameter.
 */
export function resolvePathExpression(expr, ctx) {
  const text = expr.trim();
  if (!text) return null;

  const call = /^(?:path\s*\.\s*)?(join|resolve)\s*\(([\s\S]*)\)$/.exec(text);
  if (call) {
    const parts = splitTopLevelArgs(call[2]);
    const resolved = [];
    for (const part of parts) {
      const piece = resolvePathExpression(part, ctx);
      if (piece == null) return null;
      resolved.push(piece);
    }
    if (!resolved.length) return null;
    return path.resolve(resolved[0], ...resolved.slice(1));
  }

  if (text === "__dirname") return ctx.dirname;

  const lit = parseStringLiteral(text, 0);
  if (lit && lit.end === text.length) return lit.value;

  const tpl = /^`([^`$]*)`$/.exec(text);
  if (tpl) return tpl[1];

  const tplDir = /^`\$\{__dirname\}([^`$]*)`$/.exec(text);
  if (tplDir) return path.resolve(ctx.dirname, `.${tplDir[1]}`);

  if (Object.prototype.hasOwnProperty.call(ctx.constants, text)) return ctx.constants[text];
  if (ctx.param && text === ctx.param.name) return ctx.param.value;

  return null;
}

/** Split `a, b, c` on top-level commas (respecting parens, brackets, quotes). */
export function splitTopLevelArgs(src) {
  const out = [];
  let depth = 0;
  let cur = "";
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      cur += c;
      if (c === "\\") { cur += src[i + 1] ?? ""; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const READ_CALL = String.raw`(?:await\s+)?(?:fs\s*\.\s*|fsp\s*\.\s*|node:fs\s*\.\s*)?(?:promises\s*\.\s*)?readFileSync?\s*\(`;

/** Find the matching `)` for the `(` at `open`. */
function matchParen(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Collect the source-text bindings of a test file: `name -> absolute target
 * path`. Handles direct reads, one level of reader wrapper, and path constants.
 */
export function collectBindings(testSource, testAbsPath) {
  const dirname = path.dirname(testAbsPath);
  const constants = Object.create(null);
  const bindings = Object.create(null);
  const wrappers = Object.create(null);

  // Path constants: const ROOT = path.resolve(__dirname, "../../..")
  const constRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*((?:path\s*\.\s*)?(?:join|resolve)\s*\()/g;
  for (let m; (m = constRe.exec(testSource)); ) {
    const open = testSource.indexOf("(", m.index + m[1].length);
    const close = matchParen(testSource, open);
    if (close === -1) continue;
    const expr = testSource.slice(m.index + m[0].indexOf(m[2]), close + 1);
    const value = resolvePathExpression(expr, { dirname, constants, param: null });
    if (value != null) constants[m[1]] = value;
  }

  // Reader wrappers: const biz = (rel) => readFileSync(join(__dirname, "..", rel), "utf8")
  const arrowRe = new RegExp(
    String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z<>\[\]\s|]+)?\)?\s*(?::\s*[A-Za-z<>\[\]\s|]+)?\s*=>\s*(?:\{\s*return\s+)?` + READ_CALL,
    "g",
  );
  const fnRe = new RegExp(
    String.raw`function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z<>\[\]\s|]+)?\)\s*(?::\s*[A-Za-z<>\[\]\s|]+)?\s*\{\s*return\s+` + READ_CALL,
    "g",
  );
  for (const re of [arrowRe, fnRe]) {
    for (let m; (m = re.exec(testSource)); ) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(testSource, open);
      if (close === -1) continue;
      const args = splitTopLevelArgs(testSource.slice(open + 1, close));
      if (!args.length) continue;
      wrappers[m[1]] = { param: m[2], pathExpr: args[0] };
    }
  }

  // Direct bindings: const SRC = readFileSync(<path>, "utf8")
  const directRe = new RegExp(
    String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*` + READ_CALL,
    "g",
  );
  for (let m; (m = directRe.exec(testSource)); ) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(testSource, open);
    if (close === -1) continue;
    const args = splitTopLevelArgs(testSource.slice(open + 1, close));
    if (!args.length) continue;
    const value = resolvePathExpression(args[0], { dirname, constants, param: null });
    if (value != null) bindings[m[1]] = value;
  }

  // Wrapper call sites: const SHELL = biz("src/components/…")
  const wrapperNames = Object.keys(wrappers);
  if (wrapperNames.length) {
    const callRe = new RegExp(
      String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(` +
        wrapperNames.map((w) => w.replace(/[$]/g, "\\$")).join("|") +
        String.raw`)\s*\(`,
      "g",
    );
    for (let m; (m = callRe.exec(testSource)); ) {
      const open = testSource.indexOf("(", m.index + m[0].length - 1);
      const close = matchParen(testSource, open);
      if (close === -1) continue;
      const args = splitTopLevelArgs(testSource.slice(open + 1, close));
      if (!args.length) continue;
      const lit = parseStringLiteral(args[0].trim(), 0);
      if (!lit) continue;
      const w = wrappers[m[2]];
      const value = resolvePathExpression(w.pathExpr, {
        dirname,
        constants,
        param: { name: w.param, value: lit.value },
      });
      if (value != null) bindings[m[1]] = value;
    }
  }

  return bindings;
}

// ───────────────────────────── assertion extraction ─────────────────────────

/**
 * Extract POSITIVE source-text assertions. Negative forms (`.not.toContain`,
 * `.toBe(false)`, `forbid(`) are deliberately not matched: a negative assertion
 * satisfied by a comment FAILS the test, which is the safe direction.
 */
export function collectAssertions(testSource, territory) {
  const found = [];
  const inComment = (idx) => territory && territory[idx] === COMMENT;

  const push = (index, bindingName, argIndex, form) => {
    if (inComment(index)) return;
    const arg = parseAssertionArgument(testSource, argIndex);
    if (!arg) return;
    found.push({ index, binding: bindingName, pattern: arg, form });
  };

  // expect(X).toContain("…") / expect(X).toMatch(…)
  const expectRe = /expect\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*(toContain|toMatch)\s*\(/g;
  for (let m; (m = expectRe.exec(testSource)); ) {
    push(m.index, m[1], m.index + m[0].length - 1, `expect().${m[2]}()`);
  }

  // expect(X.includes("…")).toBe(true) / .toBeTruthy()
  const includesRe = /expect\(\s*([A-Za-z_$][\w$]*)\s*\.\s*includes\s*\(/g;
  for (let m; (m = includesRe.exec(testSource)); ) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(testSource, open);
    if (close === -1) continue;
    const tail = testSource.slice(close, close + 40).replace(/\s+/g, "");
    if (!/^\)\)\.(toBe\(true\)|toBeTruthy\(\))/.test(tail)) continue;
    push(m.index, m[1], open, "expect(x.includes()).toBe(true)");
  }

  // if (!X.includes("…"))  — the gate-script shape
  const negIfRe = /if\s*\(\s*!\s*([A-Za-z_$][\w$]*)\s*\.\s*includes\s*\(/g;
  for (let m; (m = negIfRe.exec(testSource)); ) {
    push(m.index, m[1], m.index + m[0].length - 1, "if (!x.includes())");
  }

  // assert(X.includes("…")) / assert.ok(X.includes("…"))
  const assertIncludesRe = /assert(?:\.ok)?\(\s*([A-Za-z_$][\w$]*)\s*\.\s*includes\s*\(/g;
  for (let m; (m = assertIncludesRe.exec(testSource)); ) {
    push(m.index, m[1], m.index + m[0].length - 1, "assert(x.includes())");
  }

  // assert.match(X, /…/)
  const assertMatchRe = /assert\.match\(\s*([A-Za-z_$][\w$]*)\s*,/g;
  for (let m; (m = assertMatchRe.exec(testSource)); ) {
    push(m.index, m[1], m.index + m[0].length - 1 + 0, "assert.match()");
  }

  return found;
}

// ───────────────────────────── occurrence analysis ──────────────────────────

export function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
}

/** Every occurrence of `pattern` in `source`, as {start, end}. */
export function findOccurrences(source, pattern) {
  const out = [];
  if (pattern.kind === "literal") {
    if (!pattern.value) return out;
    let from = 0;
    for (;;) {
      const idx = source.indexOf(pattern.value, from);
      if (idx === -1) break;
      out.push({ start: idx, end: idx + pattern.value.length });
      from = idx + Math.max(1, pattern.value.length);
    }
    return out;
  }
  let re;
  try {
    const flags = new Set([...(pattern.flags || "")].filter((f) => "gimsuy".includes(f)));
    flags.add("g");
    flags.delete("y");
    re = new RegExp(pattern.source, [...flags].join(""));
  } catch {
    return out;
  }
  let guard = 0;
  for (let m; (m = re.exec(source)) && guard < 5000; guard++) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** CODE / COMMENT / STRING for a span: CODE if ANY character of it is CODE. */
export function territoryOf(t, span) {
  let sawComment = false;
  let sawString = false;
  for (let i = span.start; i < span.end && i < t.length; i++) {
    if (t[i] === CODE) return "code";
    if (t[i] === COMMENT) sawComment = true;
    else if (t[i] === STRING) sawString = true;
  }
  if (sawComment) return "comment";
  if (sawString) return "string";
  return "code";
}

/** The contiguous run of STRING territory containing `span`. */
export function enclosingStringRun(t, span) {
  let start = span.start;
  let end = span.end;
  while (start > 0 && t[start - 1] === STRING) start--;
  while (end < t.length && t[end] === STRING) end++;
  return { start, end };
}

/**
 * Is a string-interior match LAUNDERING, or is the literal itself the behaviour?
 *
 * In this codebase most string literals ARE the behaviour: a table name in
 * `.from("profiles_with_segment")`, an error code `"not_authorized"`, an audit
 * enum `'INSTALLMENT_CHARGED_MANUALLY'`, a CSS token `"var(--color-brand-200)"`,
 * a module path `"./stripeConnectNativeStub.js"`, a route, a testID, a label.
 * Reporting those is wrong AND would bury the comment-only findings under ~40
 * false positives — the documented way a gate in this directory gets muted.
 *
 * A NARRATING string is different: the asserted token is buried inside a longer
 * sentence that talks ABOUT the behaviour, e.g.
 *   const todo = "mount VenueListingContent here once the API lands";
 * That is the same laundering a comment performs, wearing quotes.
 *
 * All four must hold, conjunctively, precision first:
 *   (a) the match is a PROPER SUBSTRING of the enclosing literal — if it IS the
 *       whole literal, the literal is a value, not prose about one;
 *   (b) the enclosing literal has whitespace OUTSIDE the match — a sentence;
 *   (c) the WHOLE enclosing literal is NOT code-shaped — a literal carrying
 *       syntax is a CODEGEN TEMPLATE or a search pattern (injected HTML, an
 *       injected script, a `pod '${p}', :modular_headers => true` Podfile line,
 *       a PostgREST `select`, a CSS shorthand, a `source.indexOf("const x = …")`
 *       needle). Its contents execute somewhere, so they are not laundering.
 *       EVERY residual false positive on the first three repo scans was one of
 *       these. The cost is a DECLARED MISS: a syntax-carrying pattern buried in
 *       a sentence is not reported, because the sentence then looks like a
 *       template. What survives is the shape that actually occurs — a bare
 *       IDENTIFIER mentioned inside prose that wears quotes;
 *   (d) the asserted pattern is code-shaped — a behavioural claim, not copy.
 */
export function isNarratingString(targetSource, territory, span, patternText) {
  const run = enclosingStringRun(territory, span);
  if (run.start === span.start && run.end === span.end) return false;      // (a)
  const before = targetSource.slice(run.start, span.start);
  const after = targetSource.slice(span.end, run.end);
  if (!/\s/.test(before) && !/\s/.test(after)) return false;               // (b)
  if (isCodeShaped(targetSource.slice(run.start, run.end))) return false;  // (c)
  return isCodeShaped(patternText);                                        // (d)
}

function describePattern(pattern) {
  return pattern.kind === "literal"
    ? JSON.stringify(pattern.value)
    : `/${pattern.source}/${pattern.flags}`;
}

function allowKey(testRel, targetRel, pattern) {
  return `${testRel} ${targetRel} ${describePattern(pattern)}`;
}

/**
 * The pure checker. All I/O is injected so `--self-test` drives every path.
 *
 * @param {object}   args
 * @param {string}   args.testRel      repo-relative path of the test file
 * @param {string}   args.testSource   its contents
 * @param {(abs:string)=>({rel:string,source:string}|null)} args.readTarget
 * @param {Set<string>} [args.allowKeys] allowlist triples (see allowKey)
 * @returns {{findings:Array, stats:object}}
 */
export function analyzeTest({ testRel, testAbsPath, testSource, readTarget, allowKeys }) {
  const abs = testAbsPath ?? testRel;
  const findings = [];
  const stats = { assertions: 0, resolved: 0, skippedLang: 0, skippedMissing: 0, allowed: 0 };

  const bindings = collectBindings(testSource, abs);
  if (!Object.keys(bindings).length) return { findings, stats };

  const testTerritory = classifyJs(testSource);
  const assertions = collectAssertions(testSource, testTerritory);
  const cache = new Map();

  for (const a of assertions) {
    stats.assertions++;
    const targetAbs = bindings[a.binding];
    if (!targetAbs) continue;

    const lang = langOf(targetAbs);
    if (!lang) { stats.skippedLang++; continue; }

    if (!cache.has(targetAbs)) {
      const loaded = readTarget(targetAbs);
      cache.set(targetAbs, loaded ? { ...loaded, territory: classify(loaded.source, lang) } : null);
    }
    const target = cache.get(targetAbs);
    if (!target) { stats.skippedMissing++; continue; }
    stats.resolved++;

    const occurrences = findOccurrences(target.source, a.pattern);
    if (!occurrences.length) continue; // L4 — already red, or resolution was wrong

    const patternText = a.pattern.kind === "literal" ? a.pattern.value : a.pattern.source;
    const kinds = occurrences.map((o) => territoryOf(target.territory, o));

    // An occurrence LAUNDERS the claim when it cannot be the behaviour: any
    // comment, or a narrating string. A code occurrence, or a string literal
    // that IS the value, ends the enquiry — the assertion has real ground.
    const laundered = occurrences.map((o, idx) => {
      if (kinds[idx] === "code") return false;
      if (kinds[idx] === "comment") return true;
      return isNarratingString(target.source, target.territory, o, patternText);
    });
    if (laundered.some((l) => !l)) continue;

    const allComment = kinds.every((k) => k === "comment");
    const anyComment = kinds.includes("comment");

    // Inline allowlist: the line immediately above the assertion.
    const assertionLine = lineOf(testSource, a.index);
    const prevLine = testSource.split("\n")[assertionLine - 2] ?? "";
    if (prevLine.includes(ALLOW_TAG)) { stats.allowed++; continue; }

    if (allowKeys && allowKeys.has(allowKey(testRel, target.rel, a.pattern))) {
      stats.allowed++;
      continue;
    }

    findings.push({
      testRel,
      testLine: assertionLine,
      form: a.form,
      binding: a.binding,
      pattern: describePattern(a.pattern),
      targetRel: target.rel,
      kind: allComment ? "comment-only" : anyComment ? "comment-or-string-only" : "string-literal-only",
      matches: occurrences.map((o, idx) => ({
        line: lineOf(target.source, o.start),
        territory: kinds[idx],
      })),
    });
  }

  return { findings, stats };
}

// ───────────────────────────── allowlist loading ────────────────────────────

export function parseAllowlist(json, sourceLabel) {
  const entries = json?.entries;
  if (!Array.isArray(entries)) throw new Error(`${sourceLabel}: "entries" must be an array.`);
  const keys = new Set();
  for (const [i, e] of entries.entries()) {
    for (const field of ["test", "target", "pattern", "reason"]) {
      if (typeof e?.[field] !== "string" || !e[field].trim()) {
        throw new Error(`${sourceLabel}: entry ${i} is missing a non-empty "${field}".`);
      }
    }
    if (e.reason.trim().length < MIN_REASON_LENGTH) {
      throw new Error(
        `${sourceLabel}: entry ${i} ("${e.test}") has a ${e.reason.trim().length}-character reason; ` +
          `>= ${MIN_REASON_LENGTH} is required. An allowlist without a real reason recreates #2113.`,
      );
    }
    if (/[*?]/.test(e.test) || /[*?]/.test(e.target)) {
      throw new Error(`${sourceLabel}: entry ${i} uses a wildcard. Entries must name exactly one site.`);
    }
    keys.add(`${e.test} ${e.target} ${e.pattern}`);
  }
  return keys;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return new Set();
  return parseAllowlist(
    JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8")),
    path.relative(ROOT, ALLOWLIST_PATH),
  );
}

// ───────────────────────────── repo scan ────────────────────────────────────

const TEST_PATTERNS = [
  /(^|\/)__tests__\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /^\.github\/scripts\/strict-grep\/.*\.mjs$/,
];

export function isTestFile(rel) {
  if (rel.includes("node_modules/")) return false;
  return TEST_PATTERNS.some((re) => re.test(rel));
}

function listRepoFiles() {
  const out = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  if (out.status === 0 && out.stdout) return out.stdout.split("\0").filter(Boolean);
  const acc = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else acc.push(path.relative(ROOT, p));
    }
  };
  walk(ROOT);
  return acc;
}

function readTargetFromDisk(abs) {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return { rel: path.relative(ROOT, abs), source: fs.readFileSync(abs, "utf8") };
  } catch {
    return null;
  }
}

function runRepoScan(blocking) {
  let allowKeys;
  try {
    allowKeys = loadAllowlist();
  } catch (err) {
    console.error(`issue-2113: allowlist is invalid — ${err.message}`);
    process.exit(2);
  }

  const files = listRepoFiles().filter(isTestFile);
  const all = [];
  const totals = { assertions: 0, resolved: 0, skippedLang: 0, skippedMissing: 0, allowed: 0 };

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    let source;
    try {
      source = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!source.includes("readFile")) continue;
    const { findings, stats } = analyzeTest({
      testRel: rel,
      testAbsPath: abs,
      testSource: source,
      readTarget: readTargetFromDisk,
      allowKeys,
    });
    for (const k of Object.keys(totals)) totals[k] += stats[k];
    all.push(...findings);
  }

  console.log(`issue-2113 comment-satisfied-assertion guard — mode: ${blocking ? "BLOCK" : "REPORT"}`);
  console.log(`  test files scanned:            ${files.length}`);
  console.log(`  source-text assertions read:   ${totals.assertions}`);
  console.log(`  with a resolved target:        ${totals.resolved}`);
  console.log(`  skipped (unmodelled language): ${totals.skippedLang}`);
  console.log(`  skipped (target unreadable):   ${totals.skippedMissing}`);
  console.log(`  allowlisted:                   ${totals.allowed}`);
  console.log(`  VIOLATIONS:                    ${all.length}`);
  console.log("");

  const byKind = all.reduce((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {});
  for (const [kind, n] of Object.entries(byKind)) console.log(`  ${kind}: ${n}`);
  if (all.length) console.log("");

  for (const f of all) {
    console.log(`VIOLATION ${f.testRel}:${f.testLine}`);
    console.log(`  assertion : ${f.form} on ${f.binding} — ${f.pattern}`);
    console.log(`  target    : ${f.targetRel}`);
    console.log(
      `  matches   : ${f.matches.map((m) => `${f.targetRel}:${m.line} [${m.territory}]`).join(", ")}`,
    );
    console.log(
      `  -> every occurrence is non-executable (${f.kind}). The assertion is satisfied by ` +
        `prose or by an inert literal, so the behaviour it names could be absent and this test ` +
        `would still pass. Assert the behaviour, or allowlist with a stated reason ` +
        `(.github/scripts/strict-grep/issue-2113-comment-satisfied-allowlist.json).`,
    );
    console.log("");
  }

  if (all.length && blocking) {
    console.error(`issue-2113: ${all.length} comment/string-satisfied assertion(s). See docs/INVARIANT_REGISTRY.md I-PROPOSED-2113-ASSERTION-NOT-COMMENT-SATISFIED.`);
    process.exit(1);
  }
  if (all.length) {
    console.log(
      "issue-2113: REPORT MODE — these are recorded, not blocking. #2113 is ranking and " +
        "dispatching the backlog separately. Flip ENFORCEMENT_MODE to \"block\" once the count is zero.",
    );
  } else {
    console.log("issue-2113 comment-satisfied-assertion guard PASS (0 violations).");
  }
  process.exit(0);
}

// ───────────────────────────── self-test ────────────────────────────────────

/** A fixture repo: absolute-path map of target contents. */
function fixtureReader(files) {
  return (abs) => {
    const rel = abs.replace(/^\/repo\//, "");
    return Object.prototype.hasOwnProperty.call(files, rel) ? { rel, source: files[rel] } : null;
  };
}

const TEST_ABS = "/repo/pkg/__tests__/fixture.test.ts";
const TEST_REL = "pkg/__tests__/fixture.test.ts";

/** Every fixture uses the same reader-wrapper shape as the live #2113 instance. */
const FIXTURE_TEST = (assertion) => `
import { readFileSync } from "node:fs";
import { join } from "node:path";
const biz = (rel: string): string =>
  readFileSync(join(__dirname, "..", rel), "utf8");
const SHELL = biz("src/VenueSuiteShell.tsx");
describe("venue tab", () => {
  test("renders the real UI", () => {
${assertion}
  });
});
`;

function selfTest() {
  const results = [];
  const check = (name, actual, expected) => {
    const ok = actual === expected;
    results.push({ name, ok, actual, expected });
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  (findings=${actual}, expected=${expected})`);
  };
  const run = (files, assertion, allowKeys) =>
    analyzeTest({
      testRel: TEST_REL,
      testAbsPath: TEST_ABS,
      testSource: FIXTURE_TEST(assertion),
      readTarget: fixtureReader(files),
      allowKeys,
    });

  console.log("issue-2113 self-test — the four required directions");

  // ── D1: match is COMMENT-ONLY → gate FAILS ────────────────────────────────
  // This is the live #2113 instance, reproduced verbatim in shape.
  const COMMENT_ONLY = {
    "pkg/src/VenueSuiteShell.tsx": `/**
 * The Overview module mounts VenueListingContent with chromeMode="tab".
 */
export function VenueSuiteShell() {
  return <View><Text>Coming soon</Text></View>;
}
`,
  };
  const d1 = run(COMMENT_ONLY, '    expect(SHELL).toContain("VenueListingContent");');
  check("D1 comment-only match FAILS the gate", d1.findings.length, 1);
  if (d1.findings[0]?.kind !== "comment-only") {
    results.push({ name: "D1 kind is comment-only", ok: false });
    console.log(`  FAIL  D1 kind is comment-only (got ${d1.findings[0]?.kind})`);
  } else {
    results.push({ name: "D1 kind is comment-only", ok: true });
    console.log(`  PASS  D1 kind is comment-only  (target line ${d1.findings[0].matches[0].line})`);
  }

  // ── D2: match is in EXECUTABLE code → gate PASSES ─────────────────────────
  const EXECUTABLE = {
    "pkg/src/VenueSuiteShell.tsx": `import { VenueListingContent } from "./VenueListingContent";
export function VenueSuiteShell() {
  return <VenueListingContent chromeMode="tab" />;
}
`,
  };
  const d2 = run(EXECUTABLE, '    expect(SHELL).toContain("VenueListingContent");');
  check("D2 executable match PASSES the gate", d2.findings.length, 0);

  // The anti-false-positive proof: a JSX attribute whose VALUE is a string
  // literal. A strip-and-re-match implementation reports this; the span rule
  // must not, because the match is anchored on `chromeMode=` and the quote.
  const d2b = run(EXECUTABLE, '    expect(SHELL).toContain(\'chromeMode="tab"\');');
  check("D2b JSX attribute (string value) PASSES — no false positive", d2b.findings.length, 0);
  const d2c = run(COMMENT_ONLY, '    expect(SHELL).toContain(\'chromeMode="tab"\');');
  check("D2c the SAME pattern in a comment FAILS", d2c.findings.length, 1);

  // ── D3: match is inside a STRING LITERAL → gate FAILS ─────────────────────
  const STRING_ONLY = {
    "pkg/src/VenueSuiteShell.tsx": `export function VenueSuiteShell() {
  const todo = "mount VenueListingContent here once the API lands";
  return <View>{todo}</View>;
}
`,
  };
  const d3 = run(STRING_ONLY, '    expect(SHELL).toContain("VenueListingContent");');
  check("D3 string-literal-only match FAILS the gate", d3.findings.length, 1);
  if (d3.findings[0]?.kind !== "string-literal-only") {
    results.push({ name: "D3 kind is string-literal-only", ok: false });
    console.log(`  FAIL  D3 kind is string-literal-only (got ${d3.findings[0]?.kind})`);
  } else {
    results.push({ name: "D3 kind is string-literal-only", ok: true });
    console.log("  PASS  D3 kind is string-literal-only");
  }

  // ── D4: an ALLOWLISTED fixture → gate PASSES ──────────────────────────────
  const allowKeys = parseAllowlist(
    {
      entries: [
        {
          test: TEST_REL,
          target: "pkg/src/VenueSuiteShell.tsx",
          pattern: '"VenueListingContent"',
          reason: "self-test fixture proving an allowlisted site is excused",
        },
      ],
    },
    "self-test",
  );
  const d4 = run(COMMENT_ONLY, '    expect(SHELL).toContain("VenueListingContent");', allowKeys);
  check("D4 allowlisted site PASSES the gate", d4.findings.length, 0);

  const d4b = run(
    COMMENT_ONLY,
    `    // ${ALLOW_TAG} — inline convention, proven excused\n    expect(SHELL).toContain("VenueListingContent");`,
  );
  check("D4b inline allowlist tag PASSES the gate", d4b.findings.length, 0);

  // ── Allowlist cannot be broadened ─────────────────────────────────────────
  const rejects = (label, json) => {
    let threw = false;
    try { parseAllowlist(json, "self-test"); } catch { threw = true; }
    results.push({ name: label, ok: threw });
    console.log(`  ${threw ? "PASS" : "FAIL"}  ${label}`);
  };
  rejects("A1 allowlist entry with no reason is rejected", {
    entries: [{ test: "a", target: "b", pattern: "c" }],
  });
  rejects("A2 allowlist entry with a stub reason is rejected", {
    entries: [{ test: "a", target: "b", pattern: "c", reason: "because" }],
  });
  rejects("A3 allowlist entry with a wildcard is rejected", {
    entries: [{ test: "src/**", target: "b", pattern: "c", reason: "a sufficiently long reason here" }],
  });

  // ── Negative assertions are not reported (safe direction) ─────────────────
  const neg = run(COMMENT_ONLY, '    expect(SHELL).not.toContain("VenueListingContent");');
  check("N1 .not.toContain is not reported", neg.findings.length, 0);
  const inComment = run(
    COMMENT_ONLY,
    '    // expect(SHELL).toContain("VenueListingContent");',
  );
  check("N2 an assertion inside a test comment is not reported", inComment.findings.length, 0);
  const prose = run(
    { "pkg/src/VenueSuiteShell.tsx": 'const label = "Add your venue";\nexport const x = label;\n' },
    '    expect(SHELL).toContain("Add your venue");',
  );
  check("N3 prose copy in a literal is out of scope (not reported)", prose.findings.length, 0);
  const absent = run(EXECUTABLE, '    expect(SHELL).toContain("SomethingNotPresent");');
  check("N4 a pattern with no occurrence at all is not reported", absent.findings.length, 0);

  // N4b — a codegen template. The injected markup executes in the browser, so
  // the literal is not laundering. Real false positive on the first repo scan
  // (mingla-business/server/socialPreview.js:1198).
  const template = run(
    {
      "pkg/src/VenueSuiteShell.tsx":
        'export const html = `<section class="wrap"><VenueListingContent id="x" /></section>`;\n',
    },
    '    expect(SHELL).toContain("VenueListingContent");',
  );
  check("N4b a codegen template string is not reported", template.findings.length, 0);

  // N5/N6 — the string-interior narrowing. A route path IS the behaviour when
  // it is the value of an href, even though it lives in a string literal, and
  // even when a comment also mentions it. Both were real false positives on the
  // first repo scan (mingla-business/app/brand/[id]/listing.tsx:78).
  const ROUTE_VALUE = {
    "pkg/src/VenueSuiteShell.tsx": `/**
 * Otherwise forward to the card list at "/(tabs)/hub/listing".
 */
export const Redirect = () => <Link href={"/(tabs)/hub/listing"} />;
`,
  };
  const route = run(ROUTE_VALUE, '    expect(SHELL).toContain("/(tabs)/hub/listing");');
  check("N5 a route path that is a real href value is not reported", route.findings.length, 0);
  const routeStringOnly = run(
    { "pkg/src/VenueSuiteShell.tsx": 'export const TABS = [{ path: "/(tabs)/hub/listing" }];\n' },
    '    expect(SHELL).toContain("/(tabs)/hub/listing");',
  );
  check("N6 a route path in a config table is not reported", routeStringOnly.findings.length, 0);

  // ...but the same target, with the route present ONLY as prose, still fails.
  const routeCommentOnly = run(
    { "pkg/src/VenueSuiteShell.tsx": '// forwards to "/(tabs)/hub/listing" one day\nexport const x = 1;\n' },
    '    expect(SHELL).toContain("/(tabs)/hub/listing");',
  );
  check("N7 the same route present ONLY in a comment still FAILS", routeCommentOnly.findings.length, 1);

  // ── Other assertion forms and languages ───────────────────────────────────
  const re = run(COMMENT_ONLY, "    expect(SHELL).toMatch(/chromeMode=\"tab\"/);");
  check("F1 toMatch(regex) comment-only FAILS", re.findings.length, 1);
  const inc = run(
    COMMENT_ONLY,
    '    expect(SHELL.includes("VenueListingContent")).toBe(true);',
  );
  check("F2 expect(x.includes()).toBe(true) comment-only FAILS", inc.findings.length, 1);

  const SQL_TEST = `
import { readFileSync } from "node:fs";
import path from "node:path";
const ROOT = path.resolve(__dirname, "..");
const MIG = readFileSync(path.join(ROOT, "supabase/migrations/x.sql"), "utf8");
test("guard", () => {
  expect(MIG).toContain("checkout_transition_guard_ready");
});
`;
  const sqlCommentOnly = analyzeTest({
    testRel: TEST_REL,
    testAbsPath: TEST_ABS,
    testSource: SQL_TEST,
    readTarget: fixtureReader({
      "pkg/supabase/migrations/x.sql":
        "-- checkout_transition_guard_ready is documented here only\nCREATE TABLE t (id uuid);\n",
    }),
  });
  check("F3 SQL `--` comment-only FAILS", sqlCommentOnly.findings.length, 1);
  const sqlExec = analyzeTest({
    testRel: TEST_REL,
    testAbsPath: TEST_ABS,
    testSource: SQL_TEST,
    readTarget: fixtureReader({
      "pkg/supabase/migrations/x.sql":
        "CREATE FUNCTION public.checkout_transition_guard_ready() RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql;\n",
    }),
  });
  check("F4 SQL executable DDL PASSES", sqlExec.findings.length, 0);
  const sqlRaise = analyzeTest({
    testRel: TEST_REL,
    testAbsPath: TEST_ABS,
    testSource: SQL_TEST,
    readTarget: fixtureReader({
      "pkg/supabase/migrations/x.sql":
        "DO $$ BEGIN RAISE NOTICE 'the checkout_transition_guard_ready predicate lands later'; END $$;\n",
    }),
  });
  check("F5 a narrating SQL literal inside a DO body FAILS", sqlRaise.findings.length, 1);

  // F6 — a DECLARED false negative, asserted so it stays declared. A literal
  // whose ENTIRE body is the asserted token is indistinguishable from a value
  // (`.from('x')`, an enum, an error code), so it is not reported even when it
  // really is a RAISE NOTICE laundering the token. Narrowing this further is
  // what the #1860 gate needed a full SQL grammar model to do; here it is an
  // accepted miss, and this check exists so nobody believes otherwise.
  const sqlBareRaise = analyzeTest({
    testRel: TEST_REL,
    testAbsPath: TEST_ABS,
    testSource: SQL_TEST,
    readTarget: fixtureReader({
      "pkg/supabase/migrations/x.sql":
        "DO $$ BEGIN RAISE NOTICE 'checkout_transition_guard_ready'; END $$;\n",
    }),
  });
  check("F6 DECLARED MISS: a whole-literal token is not reported", sqlBareRaise.findings.length, 0);

  // ── Scanner robustness (L3 compromises, proven not to poison the file) ────
  const apostrophe = run(
    {
      "pkg/src/VenueSuiteShell.tsx": `export function VenueSuiteShell() {
  return <View><Text>Don't panic</Text><VenueListingContent /></View>;
}
`,
    },
    '    expect(SHELL).toContain("VenueListingContent");',
  );
  check("S1 a JSX prose apostrophe does not poison the scan", apostrophe.findings.length, 0);
  const url = run(
    {
      "pkg/src/VenueSuiteShell.tsx": `const HELP = "x";
export const Doc = () => <Text>https://usemingla.com VenueListingContent</Text>;
`,
    },
    '    expect(SHELL).toContain("VenueListingContent");',
  );
  check("S2 a `://` URL in JSX text is not read as a line comment", url.findings.length, 0);

  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length) {
    console.error(`issue-2113 self-test FAILED: ${failed.length}/${results.length}`);
    for (const f of failed) console.error(`  FAILED: ${f.name}`);
    process.exit(1);
  }
  console.log(`issue-2113 self-test PASS (${results.length}/${results.length}).`);
  process.exit(0);
}

// ───────────────────────────── entrypoint ───────────────────────────────────
// pathToFileURL, not `file://${argv[1]}` — the naive form breaks on the
// percent-encoded brackets in the standard per-ORCH worktree name.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry === import.meta.url) {
  if (process.argv.includes("--self-test")) selfTest();
  else runRepoScan(ENFORCEMENT_MODE === "block" || process.argv.includes("--enforce"));
}
