#!/usr/bin/env node
/**
 * Issue #2113 — I-PROPOSED-2113-NEGATIVE-ASSERTION-OVER-GUARDED-WINDOW.
 *
 * THE EMPTY-WINDOW RULE (gate 2 of the three cheap gates in issue #2113).
 *
 * A test captures a slice of a source file between two markers, then asserts the
 * slice does NOT contain something dangerous. When one marker is a COMMENT,
 * deleting (or adding) that comment collapses the captured slice to the empty
 * string — and every negative assertion in JS is vacuously true on "":
 *
 *     assert.doesNotMatch("", /randomUUID/)      // passes
 *     "".includes("rpc(\"admin_edit_place\"")    // false  -> assert.equal(.., false) passes
 *     expect("").not.toContain("anything")       // passes
 *
 * The guard silently becomes unconditional while still reading as coverage.
 *
 * Two P0s were proven by executing the mutation and watching the check stay green:
 *
 *   mingla-admin/src/__tests__/issue1175_admin_refund_idempotency.test.js
 *     window terminated by the comment `// ── W2-B`, `?.[0] ?? ""` fallback, then
 *     doesNotMatch(body, /randomUUID/). DELETE the comment + rotate the caller's
 *     Idempotency-Key inside refundOrder -> 4 passed, 0 failed. Live consequence:
 *     admin-refund-order stops deduplicating a retried multi-item refund.
 *
 *   mingla-admin/src/lib/__tests__/issue1384DiscoveryPriceAdmin.test.js
 *     window terminated by `// META-ORCH-1009 Sub-D`. ADD that comment as the first
 *     line of handleSave + put the banned partial write first -> 3 passed, 0 failed.
 *
 * RULE ENFORCED HERE
 * ------------------
 * Refuse any NEGATIVE assertion over a source window whose capture expression
 * carries a COMMENT-token boundary literal, unless a NON-EMPTY GUARD on that same
 * window executes BEFORE the negative assertion.
 *
 * "Before" is textual position within the file. Both node:test and jest abort a
 * test at the first failing assertion, so a guard that appears after the negative
 * assertion cannot stop the vacuous pass from being reported as a pass.
 *
 * Accepted non-empty guards (all prove the window is not ""):
 *   assert.ok(win, ...)                      assert.match(win, /.../)
 *   assert.notEqual(win, "")                 assert.ok(win.length > 0)
 *   assert.ok(win.length >= N)               assert.ok(win.length > N && win.length < M)
 *   expect(win).toContain(..) / .toMatch(..) / .toBeTruthy()
 *   expect(win.length).toBeGreaterThan(N)    expect(win.length).not.toBe(0)
 *   if (!win) throw ...                      if (win.length === 0) throw ...
 *
 * WHY POSITIONAL, NOT TEXTUAL: the rule keys off the *capture expression's*
 * boundary literals, not off the target file's contents. It is therefore
 * independent of PR #2118's comment-satisfied gate, which keys off the target.
 *
 * SCOPE: test files and CI gate scripts — the only places a source window is
 * captured for assertion. Product code is never read by this gate.
 *
 * `--self-test` proves the detector fires and does not fire, in both directions,
 * on the four required fixtures plus every false positive found in development.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/**
 * ENFORCEMENT_MODE — "block" fails CI on a violation; "report" prints and exits 0.
 * Landed as "block": the nine in-scope windows are fixed in the same PR, so the
 * violation count on `main` is zero. See the PR body for the executed proof.
 */
export const ENFORCEMENT_MODE = "block";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tokenizer — classify every character as code / string / template / regex /
//    comment, then produce a MASK of identical length where every non-code region
//    is blanked. Regex/string offsets in the mask are valid offsets in the source,
//    so downstream regexes can never match inside a literal or a comment.
//
//    A naive "track quotes" scanner mis-parses `/["']netinfo["']/` (the `'` inside
//    a regex character class opens a phantom string that swallows the next 40
//    lines) and reported two false positives during development. Both are asserted
//    as PASS fixtures in the self-test so the regression cannot return.
// ─────────────────────────────────────────────────────────────────────────────

const REGEX_PRECEDING_PUNCT = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", "\n"]);
const REGEX_PRECEDING_WORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "do", "else", "yield", "await", "case", "throw"]);

function regexAllowedAt(src, i) {
  let j = i - 1;
  while (j >= 0 && (src[j] === " " || src[j] === "\t")) j--;
  if (j < 0) return true;
  const c = src[j];
  if (REGEX_PRECEDING_PUNCT.has(c)) return true;
  if (/[A-Za-z_$0-9]/.test(c)) {
    let k = j;
    while (k >= 0 && /[A-Za-z_$0-9]/.test(src[k])) k--;
    return REGEX_PRECEDING_WORDS.has(src.slice(k + 1, j + 1));
  }
  return false;
}

/** @returns {{mask: string, literals: Array<{kind:string,start:number,end:number,body:string}>}} */
export function tokenize(src) {
  const mask = new Array(src.length);
  const literals = [];
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to; k++) mask[k] = src[k] === "\n" ? "\n" : " ";
  };

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    if (c === "/" && d === "/") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? src.length : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      let body = "";
      while (j < src.length) {
        if (src[j] === "\\") { body += src[j] + (src[j + 1] ?? ""); j += 2; continue; }
        if (src[j] === q) break;
        if (src[j] === "\n" && q !== "`") break; // unterminated single-line string
        body += src[j];
        j++;
      }
      const end = Math.min(j + 1, src.length);
      literals.push({ kind: q === "`" ? "template" : "string", start: i, end, body });
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && regexAllowedAt(src, i)) {
      let j = i + 1;
      let body = "";
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const ch = src[j];
        if (ch === "\\") { body += ch + (src[j + 1] ?? ""); j += 2; continue; }
        if (ch === "\n") break;
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) { closed = true; break; }
        body += ch;
        j++;
      }
      if (closed && body.length > 0) {
        let end = j + 1;
        while (end < src.length && /[dgimsuvy]/.test(src[end])) end++;
        literals.push({ kind: "regex", start: i, end, body });
        blank(i, end);
        i = end;
        continue;
      }
    }
    mask[i] = c;
    i++;
  }
  return { mask: mask.join(""), literals };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Comment-boundary classification.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A boundary literal is comment-bounded when its CONTENT opens or closes a
 * comment in some language the repo reads as a source window: JS/TS (`//`, `/*`),
 * JSX (`{/*`), HTML (`<!--`), SQL (`-- `).
 *
 * `\/\/` inside a regex literal is unescaped first — that is exactly the shape of
 * the #1175 P0. `https://` is excluded: a `//` preceded by `:` is a URL scheme.
 */
export function commentTokenIn(body) {
  const unescaped = body.replace(/\\\//g, "/");
  const m = unescaped.match(/(?<![:/])\/\/|\/\*|\*\/|<!--|-->|(?:^|\s)--\s/);
  return m ? m[0].trim() : null;
}

const WINDOW_OP = /\.\s*(slice|substring|substr|match|matchAll|exec|split)\s*\(/;
const WINDOW_OP_G = /\.\s*(slice|substring|substr|match|matchAll|exec|split)\s*\(/g;

/**
 * Argument spans of every windowing call inside [from, to).
 *
 * A boundary literal must be an ARGUMENT TO THE WINDOWING CALL ITSELF. Literals
 * that merely appear later in the same chain are not boundaries — most
 * importantly the comment-STRIPPING regexes of
 * `.replace(/\/\/.*$/gm, "")`, which are the opposite of the defect: they remove
 * comments from an already-captured window. Treating them as boundaries produced
 * 26 false positives across 5 files during development (KeyboardRoot,
 * AuthContext.authFailureCapture, orch_0893a_hydration_gate,
 * issue_1014_null_currency_display, and the cache-invalidate cascade suite), and
 * each of those shapes is now a PASS fixture in the self-test.
 */
function windowArgSpans(mask, from, to) {
  const spans = [];
  const seg = mask.slice(from, to);
  WINDOW_OP_G.lastIndex = 0;
  let m;
  while ((m = WINDOW_OP_G.exec(seg))) {
    const open = from + m.index + m[0].length - 1; // index of '('
    let depth = 0;
    let i = open;
    while (i < to) {
      const c = mask[i];
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { depth--; if (depth === 0) break; }
      i++;
    }
    spans.push([open + 1, i]);
  }
  return spans;
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

/**
 * Read a declaration initializer using the MASK, so parens/semicolons inside
 * literals and comments cannot terminate it early or late.
 */
function readInitializer(mask, start) {
  let depth = 0;
  let i = start;
  const cap = Math.min(mask.length, start + 8000);
  while (i < cap) {
    const c = mask[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
    else if (c === ";" && depth === 0) break;
    else if (c === "\n" && depth === 0) {
      const rest = mask.slice(i + 1, i + 60);
      if (/^\s*(const|let|var|assert|expect|it|test|describe|return|}|\))/.test(rest)) break;
    }
    i++;
  }
  return i;
}

/**
 * Every window binding in the file whose capture expression carries a
 * comment-token boundary literal.
 */
export function findCommentBoundedWindows(src) {
  const { mask, literals } = tokenize(src);
  const out = [];
  const declRx = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m;
  while ((m = declRx.exec(mask))) {
    const name = m[1];
    const initStart = m.index + m[0].length;
    const initEnd = readInitializer(mask, initStart);
    const initMask = mask.slice(initStart, initEnd);
    if (!WINDOW_OP.test(initMask)) continue;

    // The boundary literal must sit inside a WINDOWING call's own argument list.
    // `const RX = /require\(...\)/` has no windowing operator at all and is never
    // a window; `.replace(/\/\/.*$/gm, "")` is a comment stripper, not a boundary.
    const spans = windowArgSpans(mask, initStart, initEnd);
    const boundaries = literals
      .filter((l) => spans.some(([a, b]) => l.start >= a && l.end <= b))
      .map((l) => ({ ...l, token: commentTokenIn(l.body) }))
      .filter((l) => l.token);
    if (boundaries.length === 0) continue;

    out.push({
      name,
      declIndex: m.index,
      line: lineOf(src, m.index),
      expression: src.slice(m.index, initEnd).replace(/\s+/g, " ").slice(0, 200),
      boundaries: boundaries.map((b) => ({ kind: b.kind, token: b.token, body: b.body.slice(0, 80) })),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Assertion classification — negative assertions and non-empty guards.
//
// Every form below was enumerated from the real repo, not guessed:
//   assert.doesNotMatch  599   not.toContain 1116   not.toMatch 908
//   assert.ok(!          271   toBe(false)    974   assert.equal(x, false) 16
// ─────────────────────────────────────────────────────────────────────────────

/** Read one assertion statement from `at`, following the whole `.foo(..).bar(..)` chain. */
function readStatement(mask, at) {
  let i = at;
  let depth = 0;
  let started = false;
  const cap = Math.min(mask.length, at + 4000);
  while (i < cap) {
    const c = mask[i];
    if ("([{".includes(c)) { depth++; started = true; }
    else if (")]}".includes(c)) {
      depth--;
      if (started && depth === 0) {
        // continue through a chained `.not.toContain(...)`
        let j = i + 1;
        while (j < cap && /[\s.]/.test(mask[j])) j++;
        if (mask[j] === "." || (mask[i + 1] === "." )) { /* handled by loop */ }
        const tail = mask.slice(i + 1, i + 40);
        if (/^\s*\./.test(tail)) { i++; continue; }
        return i + 1;
      }
    } else if (c === ";" && depth === 0 && started) return i;
    i++;
  }
  return Math.min(cap, mask.length);
}

const ASSERT_ENTRY = /\b(assert\s*\.\s*[A-Za-z]+|expect)\s*\(/g;

function statementsIn(mask) {
  const out = [];
  let m;
  ASSERT_ENTRY.lastIndex = 0;
  while ((m = ASSERT_ENTRY.exec(mask))) {
    const start = m.index;
    const end = readStatement(mask, m.index + m[0].length - 1);
    out.push({ start, end, mask: mask.slice(start, end) });
    ASSERT_ENTRY.lastIndex = Math.max(end, m.index + 1);
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isNegativeOver(stmtMask, name) {
  const n = esc(name);
  return [
    new RegExp(`^assert\\s*\\.\\s*doesNotMatch\\s*\\(\\s*${n}\\s*[,)]`),
    new RegExp(`^assert\\s*\\.\\s*doesNotInclude\\s*\\(\\s*${n}\\s*[,)]`),
    new RegExp(`^assert\\s*\\.\\s*ok\\s*\\(\\s*!\\s*${n}\\b`),
    new RegExp(`^assert\\s*\\.\\s*(?:equal|strictEqual|deepEqual|deepStrictEqual)\\s*\\(\\s*!\\s*${n}\\b`),
    new RegExp(`^assert\\s*\\.\\s*(?:equal|strictEqual|deepEqual|deepStrictEqual)\\s*\\(\\s*${n}\\s*\\.\\s*(?:includes|match|search|indexOf)\\s*\\([\\s\\S]*\\)\\s*(?:>=?\\s*0\\s*)?,\\s*false\\s*[,)]`),
    new RegExp(`^expect\\s*\\(\\s*${n}\\s*\\)\\s*\\.\\s*not\\s*\\.\\s*(?:toContain|toMatch|toContainEqual|toBeTruthy)`),
    new RegExp(`^expect\\s*\\(\\s*!\\s*${n}\\b`),
    new RegExp(`^expect\\s*\\(\\s*${n}\\s*\\.\\s*(?:includes|match|search|test)\\s*\\([\\s\\S]*\\)\\s*\\)\\s*\\.\\s*(?:toBe|toEqual)\\s*\\(\\s*false\\s*\\)`),
  ].some((rx) => rx.test(stmtMask));
}

export function isNonEmptyGuardOver(stmtMask, name) {
  const n = esc(name);
  return [
    // length-bounded — the strongest form, and the one the fixes below use.
    new RegExp(`^(?:assert\\s*\\.\\s*ok|expect)\\s*\\([\\s\\S]*${n}\\s*\\.\\s*length\\s*(?:>|>=|!==?)\\s*\\d`),
    new RegExp(`^expect\\s*\\(\\s*${n}\\s*\\.\\s*length\\s*\\)\\s*\\.\\s*(?:toBeGreaterThan|toBeGreaterThanOrEqual)\\s*\\(`),
    new RegExp(`^expect\\s*\\(\\s*${n}\\s*\\.\\s*length\\s*\\)\\s*\\.\\s*not\\s*\\.\\s*(?:toBe|toEqual)\\s*\\(\\s*0`),
    new RegExp(`^assert\\s*\\.\\s*(?:notEqual|notStrictEqual)\\s*\\(\\s*${n}\\s*\\.\\s*length\\s*,\\s*0`),
    // truthiness / positive-content — "" is falsy and matches no pattern.
    new RegExp(`^assert\\s*\\.\\s*ok\\s*\\(\\s*${n}\\s*[,)]`),
    new RegExp(`^assert\\s*\\.\\s*match\\s*\\(\\s*${n}\\s*,`),
    new RegExp(`^assert\\s*\\.\\s*(?:notEqual|notStrictEqual)\\s*\\(\\s*${n}\\s*,\\s*$`),
    new RegExp(`^expect\\s*\\(\\s*${n}\\s*\\)\\s*\\.\\s*(?:toContain|toMatch|toBeTruthy)\\s*\\(`),
  ].some((rx) => rx.test(stmtMask));
}

/** Every `const|let|var NAME =` declaration index for NAME, in the mask. */
function findAllDeclIndexes(mask, name) {
  const rx = new RegExp(`\\b(?:const|let|var)\\s+${esc(name)}\\s*=`, "g");
  const out = [];
  let m;
  while ((m = rx.exec(mask))) out.push(m.index);
  return out;
}

/** Non-assertion guards: `if (!win) throw ...` / `if (win.length === 0) throw ...`. */
function throwGuardsFor(mask, name) {
  const n = esc(name);
  const out = [];
  for (const rx of [
    new RegExp(`if\\s*\\(\\s*!\\s*${n}\\s*\\)[\\s\\S]{0,120}?throw`, "g"),
    new RegExp(`if\\s*\\(\\s*${n}\\s*\\.\\s*length\\s*(?:===?|<)\\s*\\d+\\s*\\)[\\s\\S]{0,120}?throw`, "g"),
  ]) {
    let m;
    while ((m = rx.exec(mask))) out.push(m.index);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. The rule.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} src  source of ONE test / gate file
 * @param {string} rel  repo-relative path, for the message only
 * @returns {Array<{file:string,line:number,window:string,boundary:string,assertionLine:number,assertion:string}>}
 */
export function violationsInFile(src, rel = "<fixture>") {
  const windows = findCommentBoundedWindows(src);
  if (windows.length === 0) return [];
  const { mask } = tokenize(src);
  const stmts = statementsIn(mask);
  const out = [];

  // A window binding owns only the assertions between its own declaration and
  // the NEXT re-declaration of the same identifier. Without this, a file that
  // declares `const stripped = ...` once per test block attributes every later
  // block's assertions to the first binding — 10 duplicate reports in
  // KeyboardRoot.test.tsx alone during development.
  const nextRedeclare = (name, from) => {
    const later = findAllDeclIndexes(mask, name).find((i) => i > from);
    return later ?? Infinity;
  };

  for (const win of windows) {
    const scopeEnd = nextRedeclare(win.name, win.declIndex);
    const inScopeStmt = (p) => p > win.declIndex && p < scopeEnd;
    const guardPositions = [
      ...stmts.filter((s) => inScopeStmt(s.start) && isNonEmptyGuardOver(s.mask, win.name)).map((s) => s.start),
      ...throwGuardsFor(mask, win.name).filter((p) => inScopeStmt(p)),
    ];
    const negatives = stmts.filter((s) => inScopeStmt(s.start) && isNegativeOver(s.mask, win.name));
    for (const neg of negatives) {
      if (guardPositions.some((g) => g < neg.start)) continue;
      out.push({
        file: rel,
        line: win.line,
        window: win.name,
        boundary: `${win.boundaries[0].kind} "${win.boundaries[0].token}" in <${win.boundaries[0].body}>`,
        expression: win.expression,
        assertionLine: lineOf(src, neg.start),
        assertion: src.slice(neg.start, neg.end).replace(/\s+/g, " ").slice(0, 140),
      });
    }
  }
  return out;
}

/** @param {Record<string,string>} files repo-relative path -> source */
export function violations(files) {
  const out = [];
  for (const [rel, src] of Object.entries(files)) out.push(...violationsInFile(src, rel));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Scope — test files and CI gate scripts only.
// ─────────────────────────────────────────────────────────────────────────────

export function inScope(rel) {
  if (!/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(rel)) return false;
  if (/(^|\/)node_modules\//.test(rel)) return false;
  return (
    /(^|\/)__tests__\//.test(rel) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) ||
    /\.(tester|adversarial|implementor)\..*\.[cm]?[jt]sx?$/.test(rel) ||
    /^\.github\/scripts\/strict-grep\//.test(rel)
  );
}

function repoFiles() {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, maxBuffer: 1 << 28 })
    .toString()
    .split("\0")
    .filter(Boolean);
  return listed.filter(inScope);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Self-test — both directions, on the four required fixtures plus every false
//    positive found in development. A gate about falsifiability must itself be
//    falsifiable, so each fixture asserts a COUNT, not merely "no throw".
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURES = {
  // (1) comment-bounded window, no non-empty guard -> MUST FAIL. This is the
  //     #1175 P0 shape verbatim: regex window terminated by `\/\/ ── W2-B`,
  //     `?.[0] ?? ""` fallback, doesNotMatch.
  commentBoundedUnguarded: {
    expect: 1,
    src: `
const serviceSource = readFileSync(SERVICE, "utf8");
test("refundOrder never rotates the caller key", () => {
  const refundBody = serviceSource.match(
    /export async function refundOrder[\\s\\S]*?\\n}\\n\\n\\/\\/ ── W2-B/,
  )?.[0] ?? "";
  assert.doesNotMatch(refundBody, /randomUUID/, "must never rotate the caller's key");
});
`,
  },

  // (2) same slice WITH a non-empty guard -> MUST PASS.
  commentBoundedGuarded: {
    expect: 0,
    src: `
const serviceSource = readFileSync(SERVICE, "utf8");
test("refundOrder never rotates the caller key", () => {
  const refundBody = serviceSource.match(
    /export async function refundOrder[\\s\\S]*?\\n}\\n\\n\\/\\/ ── W2-B/,
  )?.[0] ?? "";
  assert.ok(refundBody.length > 200, "window collapsed - boundary comment gone");
  assert.doesNotMatch(refundBody, /randomUUID/, "must never rotate the caller's key");
});
`,
  },

  // (3) non-comment-bounded slice -> MUST PASS even with no guard. The boundary is
  //     executable JSX, which a comment edit cannot delete.
  structuralBoundaryUnguarded: {
    expect: 0,
    src: `
test("current card window", () => {
  const current = swipeable.slice(
    swipeable.indexOf('<GestureDetector key={currentRec.id}>'),
    swipeable.indexOf('</GestureDetector>'),
  );
  assert.doesNotMatch(current, /<CardHeroImage/);
});
`,
  },

  // (4) a negative assertion over a window that is EMPTY at runtime -> MUST FAIL.
  //     Modelled on the #1384 P0: adding the boundary comment as the function's
  //     first line makes indexOf(end) === indexOf(start), so the slice is "" and
  //     `"".includes(x) === false` passes unconditionally.
  emptyAtRuntime: {
    expect: 2,
    src: `
test("no partial write", () => {
  const handleSave = page.slice(
    page.indexOf("const handleSave"),
    page.indexOf("// META-ORCH-1009 Sub-D", page.indexOf("const handleSave")),
  );
  assert.equal(handleSave.includes('rpc("admin_edit_place"'), false);
  assert.equal(handleSave.includes('from("place_pool").update'), false);
});
`,
  },

  // ── the four required fixtures end here; everything below is regression armour ──

  // jest vocabulary must be caught too, not only node:assert.
  jestNotToContainUnguarded: {
    expect: 1,
    src: `
it("shell", () => {
  const body = src.slice(src.indexOf("function render"), src.indexOf("/* END RENDER */"));
  expect(body).not.toContain("VenueListingContent");
});
`,
  },
  jestGuarded: {
    expect: 0,
    src: `
it("shell", () => {
  const body = src.slice(src.indexOf("function render"), src.indexOf("/* END RENDER */"));
  expect(body.length).toBeGreaterThan(50);
  expect(body).not.toContain("VenueListingContent");
});
`,
  },
  jestIncludesFalseUnguarded: {
    expect: 1,
    src: `
it("shell", () => {
  const body = src.slice(src.indexOf("function render"), src.indexOf("// END RENDER"));
  expect(body.includes("VenueListingContent")).toBe(false);
});
`,
  },

  // A guard placed AFTER the negative assertion does not help: the runner reports
  // the vacuous pass before ever reaching the guard.
  guardAfterAssertion: {
    expect: 1,
    src: `
test("ordering matters", () => {
  const win = src.slice(src.indexOf("start"), src.indexOf("// end marker"));
  assert.doesNotMatch(win, /forbidden/);
  assert.ok(win.length > 10);
});
`,
  },

  // `assert.match` is a valid non-empty guard: no pattern matches "".
  positiveMatchIsAGuard: {
    expect: 0,
    src: `
test("match guards", () => {
  const win = src.slice(src.indexOf("start"), src.indexOf("// end marker"));
  assert.match(win, /pointerEvents="none"/);
  assert.doesNotMatch(win, /forbidden/);
});
`,
  },

  // A hard throw-guard before the assertion is accepted.
  throwGuard: {
    expect: 0,
    src: `
test("throw guards", () => {
  const win = src.slice(src.indexOf("start"), src.indexOf("// end marker"));
  if (!win) throw new Error("window collapsed");
  assert.doesNotMatch(win, /forbidden/);
});
`,
  },

  // FALSE POSITIVE #1 (found in development, mingla-business/__tests__/
  // issue1758NetinfoSoleOwner.test.ts): a regex CONSTANT is not a window. A naive
  // quote-tracking scanner lets the `'` inside `["']` open a phantom string that
  // swallows the following comment lines and reports a boundary that is not there.
  regexConstantIsNotAWindow: {
    expect: 0,
    src: `
// CommonJS reach — only netinfoSafe.ts may do this (inside try/catch).
const REQUIRE_CALL = /require\\(\\s*["']@react-native-community\\/netinfo["']\\s*\\)/;
// mentions @react-native-community/netinfo in prose only
it("liveness", () => {
  expect(REQUIRE_CALL.test(src)).toBe(true);
  expect(STATIC_IMPORT.test(src)).toBe(false);
});
`,
  },

  // FALSE POSITIVE #2 (mingla-business/src/hooks/__tests__/
  // cache-invalidate-cascade-fix.test.ts): the comment-STRIPPING regexes are not
  // window boundaries, and the real window is guarded by `not.toBeNull()`.
  commentStrippingIsNotABoundary: {
    expect: 0,
    src: `
test("no detail invalidation", () => {
  const match = source.match(/const\\s+writePublishedEventCaches[\\s\\S]*?\\}\\s*;/m);
  expect(match).not.toBeNull();
  const body = match[0];
  const stripped = body.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "").replace(/\\/\\/[^\\n]*/g, "");
  const detailInvalidatePattern = /invalidateQueries\\s*\\(/;
  expect(detailInvalidatePattern.test(stripped)).toBe(false);
});
`,
  },

  // FALSE POSITIVE #3 (mingla-business/src/wrappers/__tests__/KeyboardRoot.test.tsx,
  // AuthContext.authFailureCapture.adversarial.issue1044.test.ts, orch_0893a_
  // hydration_gate.test.ts, issue_1014_null_currency_display_adversarial.test.ts):
  // a comment-STRIPPING `.replace()` later in the chain is the OPPOSITE of the
  // defect — it removes comments from an already-captured window. It is not a
  // boundary, and the `.slice()` here has no literal boundary at all.
  commentStripperInChainIsNotABoundary: {
    expect: 0,
    src: `
test("stripper chain", () => {
  const block = lines
    .slice(start, close + 1)
    .join("\\n")
    .replace(/\\/\\/.*$/gm, "");
  expect(block).not.toMatch(/\\breturn\\b/);
});
`,
  },
  splitMapReplaceIsNotABoundary: {
    expect: 0,
    src: `
test("split/map/replace chain", () => {
  const code = source
    .split("\\n")
    .map((line) => line.replace(/\\/\\/.*$/, ""))
    .join("\\n");
  expect(code).not.toMatch(/createClientDraft\\s*\\(/);
});
`,
  },
  filterPredicateIsNotABoundary: {
    expect: 0,
    src: `
test("filter predicate", () => {
  const block = src
    .slice(start, end)
    .split("\\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\\n");
  expect(block).not.toContain('?? "USD"');
});
`,
  },

  // FALSE POSITIVE #4: a window identifier re-declared once per test block. The
  // SECOND binding is guarded; without per-binding scoping the FIRST binding
  // claims the second block's assertions and both are misreported.
  redeclaredNameScoping: {
    expect: 1,
    src: `
test("block one", () => {
  const win = src.slice(src.indexOf("start"), src.indexOf("// end marker"));
  assert.doesNotMatch(win, /forbidden/);
});
test("block two", () => {
  const win = src.slice(src.indexOf("start"), src.indexOf("// end marker"));
  assert.ok(win.length > 10);
  assert.doesNotMatch(win, /forbidden/);
});
`,
  },

  // A URL is not a comment boundary — `https://` must never trip the rule.
  urlIsNotAComment: {
    expect: 0,
    src: `
test("url boundary", () => {
  const win = src.slice(src.indexOf("https://cdn.example.com/a"), src.indexOf("https://cdn.example.com/z"));
  assert.doesNotMatch(win, /forbidden/);
});
`,
  },

  // A POSITIVE assertion over a comment-bounded window is out of scope: an empty
  // window makes a positive assertion FAIL, which is the safe direction.
  positiveAssertionIsOutOfScope: {
    expect: 0,
    src: `
test("positive only", () => {
  const win = src.slice(src.indexOf("start"), src.indexOf("// end marker"));
  assert.match(win, /required/);
});
`,
  },

  // SQL windows count: `-- ` opens a line comment in a migration read as text.
  sqlCommentBoundary: {
    expect: 1,
    src: `
test("sql window", () => {
  const body = migration.slice(migration.indexOf("create function f"), migration.indexOf("-- end of f"));
  assert.doesNotMatch(body, /security definer/i);
});
`,
  },
};

function selfTest() {
  let checks = 0;
  const fail = (msg) => { throw new Error(`issue-2113 empty-window self-test FAILED: ${msg}`); };

  for (const [name, { src, expect: want }] of Object.entries(FIXTURES)) {
    const got = violationsInFile(src, `<fixture:${name}>`);
    checks++;
    if (got.length !== want) {
      fail(`fixture "${name}" expected ${want} violation(s), got ${got.length}` +
           (got.length ? `:\n${got.map((v) => `    L${v.assertionLine} ${v.assertion}`).join("\n")}` : ""));
    }
    process.stdout.write(`  ok  ${name.padEnd(34)} -> ${got.length} violation(s) [expected ${want}]\n`);
  }

  // Direction proof on the detector itself: removing the guard from the PASSING
  // fixture must FLIP it to failing. A detector that returns 0 unconditionally
  // would satisfy every "expect 0" fixture above; this makes that impossible.
  const flipped = violationsInFile(
    FIXTURES.commentBoundedGuarded.src.replace(/\s*assert\.ok\(refundBody\.length > 200.*\n/, "\n"),
    "<fixture:flip>",
  );
  checks++;
  if (flipped.length !== 1) fail(`removing the non-empty guard did not flip the gate (got ${flipped.length})`);
  process.stdout.write(`  ok  ${"flip: guard removed".padEnd(34)} -> 1 violation(s) [expected 1]\n`);

  // And the inverse: adding a guard to the FAILING fixture must silence it.
  const silenced = violationsInFile(
    FIXTURES.commentBoundedUnguarded.src.replace(
      "  assert.doesNotMatch(refundBody",
      "  assert.ok(refundBody.length > 200);\n  assert.doesNotMatch(refundBody",
    ),
    "<fixture:silence>",
  );
  checks++;
  if (silenced.length !== 0) fail(`adding a non-empty guard did not silence the gate (got ${silenced.length})`);
  process.stdout.write(`  ok  ${"flip: guard added".padEnd(34)} -> 0 violation(s) [expected 0]\n`);

  process.stdout.write(`issue-2113 empty-window negative-assertion self-test passed (${checks} checks)\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. CLI
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  if (process.argv.slice(2).includes("--self-test")) {
    selfTest();
    return;
  }

  const files = repoFiles();
  const found = [];
  for (const rel of files) {
    let src;
    try { src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"); } catch { continue; }
    if (!WINDOW_OP.test(src)) continue;
    found.push(...violationsInFile(src, rel));
  }

  if (found.length === 0) {
    process.stdout.write(`issue-2113 empty-window negative-assertion passed (${files.length} files scanned, 0 violations)\n`);
    return;
  }

  for (const v of found) {
    process.stdout.write(
      `VIOLATION ${v.file}:${v.assertionLine}\n` +
      `  window    : \`${v.window}\` declared at ${v.file}:${v.line}\n` +
      `  boundary  : ${v.boundary}\n` +
      `  capture   : ${v.expression}\n` +
      `  assertion : ${v.assertion}\n` +
      `  fix       : assert the window is non-empty (ideally length-bounded) BEFORE the negative assertion.\n`,
    );
  }
  const summary = `issue-2113 empty-window negative-assertion: ${found.length} violation(s) across ${files.length} scanned files\n`;
  if (ENFORCEMENT_MODE === "block") {
    process.stderr.write(summary);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${summary}(ENFORCEMENT_MODE=report — exiting 0)\n`);
}

main();
