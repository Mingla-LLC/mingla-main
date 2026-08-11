#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0892 [App-wide keyboard avoidance — react-native-keyboard-controller]
 * — BLOCKING gate (exit 1 on violation, exit 0 on PASS).
 *
 * Invariants under enforcement: I-PROPOSED-KEYBOARD-LIBRARY-ONLY +
 * I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY (both ACTIVE since ORCH-0892-C,
 * 2026-05-21). All keyboard-avoidance code in mingla-business/ MUST flow
 * through react-native-keyboard-controller primitives. Four patterns are
 * forbidden outside the explicit SAFELIST:
 *
 *   1. Keyboard.addListener(...) for layout-affecting purposes.
 *      (Keyboard.dismiss() is fine — it is not a listener.)
 *   2. KeyboardAvoidingView reached from 'react-native', named OR through a
 *      namespace import — must use the library's drop-in replacement.
 *   3. automaticallyAdjustKeyboardInsets on any ScrollView or fork, in any
 *      truthy spelling including the bare-prop shorthand.
 *   4. ScrollView / FlatList / SectionList value-imported from 'react-native'
 *      in a file that either contains the TextInput identifier OR renders an
 *      input-bearing component inside that container's span.
 *
 * ===========================================================================
 * #1841 [keyboard-guard-blind-spots] — WHAT CHANGED AND WHY.
 *
 * Five holes were proven with differential fixtures on an isolated origin/main
 * harness (issue #1841 INVESTIGATE, Q1–Q5). Each is closed below and named at
 * its fix site. Summarised here so a reader never has to reconstruct them:
 *
 *   H1  token-vs-child. Pattern 4 matched the bare word `TextInput` in the
 *       file's own text, so every screen rendering its fields through the
 *       `Input` primitive — the house style — was invisible. FlatList and
 *       SectionList were not covered at all.
 *   H2  Pattern 1 demanded a LITERAL event string, so the cross-platform-
 *       correct `Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"`
 *       hoist walked straight through. Five uncarved sites, three on payment
 *       routes. The gate punished the naive engineer and rewarded the subtle
 *       one.
 *   H3  The "independent" adversarial test was a verbatim clone of these
 *       regexes. Rewritten to EXECUTE this module — see
 *       mingla-business/src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx
 *       and I-PROPOSED-1841-A-GUARD-MUST-BE-EXECUTED-NOT-RE-DECLARED.
 *   H4  Only the FIRST match line per pattern per file was ever examined, and
 *       the allowlist was checked around that line only — so one approved
 *       marker granted the whole file blanket immunity, forever, including to
 *       sites added years later. Fixed by per-occurrence checking.
 *   H5  Patterns 2 and 3 had trivial evasions: the JSX boolean shorthand
 *       `automaticallyAdjustKeyboardInsets` (the regex required `=`), and
 *       `import * as RN from "react-native"` + `<RN.KeyboardAvoidingView>`.
 *
 * Also: `--self-test` is now real. It was passed in
 * .github/workflows/issue-1532-stay-manager-ux-tests.yml and silently ignored,
 * because this script had no process.argv handling at all.
 *
 * SHAPE. The scanner is a PURE core (`scanKeyboardPlumbing`) plus a CLI shell.
 * The core takes its file list and its reader by injection, so the adversarial
 * test can drive it over synthetic file sets without writing into the repo, and
 * so an emptied scan can be made to THROW rather than print PASS.
 * (I-PROPOSED-1841-A: an empty scan is a failure, never a pass.)
 *
 * CLASS, NOT HOSTS. Pattern 4's reach is DERIVED from the import graph, never
 * written as a list of named host files
 * (I-PROPOSED-1841-B-GUARDS-ENUMERATE-CLASSES-NOT-HOSTS). A host-pinned rule
 * leaves its class unenforced the moment a new host appears.
 * ===========================================================================
 *
 * SAFELIST (carve-outs from the investigation; codified in SPEC §10):
 *   - Sheet primitive: owns sheet-hosted keyboard; library would double-translate.
 *   - ComposerV2Editor: fixed-height body shrink for pell rich editor.
 *   - richEditor.{native.ts,tsx}: WebView sandbox; library can't reach inside.
 *   - KeyboardRoot.native.tsx / KeyboardToolbarRoot.native.tsx / the
 *     SmartScrollView + useKeyboardIsVisible native variants: the legitimate
 *     library mounts themselves.
 *
 * Per-occurrence inline exemption: `// orch-strict-grep-allow orch-0892 — <reason>`
 * within 3 lines of THE offending occurrence (not merely somewhere in the file)
 * suppresses that one occurrence.
 *
 * **Mode:** BLOCKING (exit 1 on violation, exit 0 on PASS).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "../../..");
export const SCAN_ROOTS = [resolve(REPO_ROOT, "mingla-business")];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".expo",
  "dist",
  "build",
  "ios",
  "android",
  "Pods",
  ".git",
  "coverage",
  "__tests__",
]);

export const SAFELIST = new Set([
  // ORCH-0892-B v2: Sheet.tsx legitimately imports KeyboardAwareScrollView
  // from the library — it's the single owner of sheet body keyboard handling
  // (panel translate / height clamp deleted; KAS does scroll-to-focused).
  "mingla-business/src/components/ui/Sheet.tsx",
  "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.tsx",
  "mingla-business/src/wrappers/KeyboardRoot.native.tsx",
  // ORCH-0892-B v2 (supersedes ORCH-0892-A KAV wrapper): SmartScrollView
  // native variant re-exports KeyboardAwareScrollView; useKeyboardIsVisible
  // native variant delegates to library useKeyboardState. The web variants
  // import from 'react-native' only — not flagged.
  "mingla-business/src/wrappers/SmartScrollView.native.tsx",
  "mingla-business/src/wrappers/useKeyboardIsVisible.native.ts",
  // ORCH-1165: KeyboardToolbarRoot native variant imports KeyboardToolbar from
  // the library (the Done-only accessory bar). Legitimate library mount, same
  // class as KeyboardRoot.native.tsx — safelisted so the gate stays green.
  "mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx",
]);

/**
 * The marker, in either comment syntax.
 *
 * `//` was the only accepted form until #1841, which is a problem the moment
 * allowlisting becomes PER-OCCURRENCE: pattern 4's occurrence is a JSX element,
 * and JSX child position admits no `//` comment — only `{/* … *\/}`. A rule that
 * demands a marker where the language forbids one is unsatisfiable, and an
 * unsatisfiable rule gets satisfied by moving the marker somewhere it does not
 * belong. Accepting the block form is not a loosening: the marker is equally
 * explicit, equally greppable, and TA-V3-5 enumerates it with THIS regex, so
 * the gate and its verifier cannot disagree about what counts.
 *
 * (`TripDayEditor.tsx:183` has carried a `{/* … *\/}` marker since ORCH-1119
 * that has never once been honoured. It is honoured now.)
 */
export const RE_INLINE_ALLOWLIST =
  /(?:\/\/|\/\*)\s*orch-strict-grep-allow\s+orch-0892\s*[—-]/i;

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

function walkSourceFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const path = resolve(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkSourceFiles(path, out);
    } else if (
      stat.isFile() &&
      (name.endsWith(".tsx") || name.endsWith(".ts"))
    ) {
      // Skip d.ts and test files
      if (name.endsWith(".d.ts")) continue;
      if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
      out.push(path);
    }
  }
  return out;
}

/**
 * The gate's own file walk, exported so a verifier can assert WHAT the scan
 * visited rather than trusting that it visited anything (the vacuity guard
 * required by I-PROPOSED-1841-A).
 */
export function collectSourceFiles(roots = SCAN_ROOTS) {
  const out = [];
  for (const root of roots) walkSourceFiles(root, out);
  return out;
}

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

function stripLineComments(content) {
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The gate's ONE comment classifier. Exported because the adversarial test used
 * to carry its own — a *different* one, which stripped trailing `//` comments
 * where this drops only whole-line ones, so the "identical" enforcers could
 * disagree about the same file. Verifiers import THIS
 * (I-PROPOSED-1841-A: execute the gate, never re-declare it).
 */
export function stripComments(content) {
  return stripBlockComments(stripLineComments(content));
}

const clean = stripComments;

/**
 * Length-preserving comment blanking. Used for every OFFSET-sensitive analysis
 * (element spans), because `clean()` deletes characters and would slide every
 * subsequent offset. Same classification as `clean()` — whole-line `//`
 * comments and `/* *\/` blocks — so the two can never disagree about what
 * counts as code.
 */
function blankComments(content) {
  const blockBlanked = content.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  return blockBlanked
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? " ".repeat(line.length) : line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// H2 — argument-agnostic. Any expression form (literal, ternary, hoisted
// identifier, computed) is caught. `Keyboard.dismiss()` is untouched. Every
// census site in mingla-business is a layout listener, so there is no
// legitimate collateral; anything genuinely non-layout takes an inline
// allowlist with a written reason, which is the correct place for that
// judgement to be recorded and reviewed.
const RE_KEYBOARD_ADDLISTENER = /Keyboard\s*\.\s*addListener\s*\(/;

const RE_KAV_FROM_RN_NAMED =
  /import\s+\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s+from\s+["']react-native["']/;

// H5 — `import * as RN from "react-native"` + `<RN.KeyboardAvoidingView>`.
// The named-brace regex above cannot see this shape at all.
const RE_RN_NAMESPACE_IMPORT =
  /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']react-native["']/g;

// H5 — the `=` is no longer required, so the JSX boolean shorthand
// `<ScrollView automaticallyAdjustKeyboardInsets>` (semantically `={true}`) is
// caught. An explicit `={false}` / `= false` is still legal and is the only
// spelling that turns the prop off.
const RE_AUTO_INSETS =
  /automaticallyAdjustKeyboardInsets(?!\s*=\s*\{?\s*false)/;

// Retained VERBATIM from the pre-#1841 gate. Pattern 4 branch (a) below still
// consults exactly this shape, which is what makes the corrected rule a strict
// SUPERSET of the old coverage rather than a swap — a swap could silently
// weaken the gate while looking like a tightening.
const RE_SCROLLVIEW_FROM_RN_NAMED =
  /import\s+\{[^}]*\bScrollView\b[^}]*\}\s+from\s+["']react-native["']/;
const RE_TEXTINPUT_PRESENT = /\bTextInput\b/;

/** The bare containers pattern 4 governs. A CLASS, enumerated once. */
const BARE_CONTAINERS = ["ScrollView", "FlatList", "SectionList"];

/**
 * H1 leaf test. A file "provides an input" if it renders a focusable field
 * directly. `[\s/>]` keeps `<input` from matching `<inputSomething`.
 */
const RE_INPUT_LEAF = /<(TextInput|textarea|input)[\s/>]|contentEditable/;

/**
 * Isolating boundaries. A native <Modal> renders in its OWN window and lifts
 * its own content (measured at runtime in #1834 §6: the picker Modal was lifted
 * by its own KeyboardAvoidingView with the parent ScrollView playing no part),
 * and <Sheet> is SAFELISTed precisely because it owns its scroll via
 * KeyboardAwareScrollView. A field inside either is NOT in the outer
 * container's flow, so blanking these spans before analysis is a runtime-backed
 * boundary, not a convenience: without it the closure flags 43 files instead
 * of 5, and every one of the extra 38 is a false positive on inspection.
 */
const BOUNDARY_TAGS = ["Modal", "Sheet"];

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

/**
 * B1-5 — the `:0` defect. The old implementation tested the regex line by
 * line, so a MULTI-LINE `react-native` import never matched and returned -1,
 * which was then reported as line 0 and made the allowlist window scan lines
 * 0–2 instead of the import site. That is why one file in this repo carries a
 * comment saying its allowlist marker must physically sit in the first three
 * lines. Fall back to a whole-text search and convert the match offset to a
 * line index.
 */
function findLineOfMatch(content, re) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) return i;
  }
  const whole = new RegExp(re.source, re.flags.replace("g", ""));
  const m = whole.exec(content);
  if (m === null) return -1;
  return offsetToLine(content, m.index);
}

function offsetToLine(content, offset) {
  let line = 0;
  for (let i = 0; i < offset && i < content.length; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

/**
 * H4 — per-OCCURRENCE. The window is unchanged (3 lines either side); what
 * changed is that it is now anchored on each offending occurrence instead of
 * only the first one in the file. Fixture that proved the old behaviour: one
 * approved marker at the top, then two blatant literal-string listeners 6 and 7
 * lines below — the gate printed PASS.
 */
function hasInlineAllowlist(content, lineIndex) {
  const lines = content.split("\n");
  const start = Math.max(0, lineIndex - 3);
  const end = Math.min(lines.length, lineIndex + 4);
  for (let i = start; i < end; i += 1) {
    if (RE_INLINE_ALLOWLIST.test(lines[i] ?? "")) return true;
  }
  return false;
}

/** Every line index whose text matches `re`. */
function allLinesMatching(content, re) {
  const single = new RegExp(re.source, re.flags.replace("g", ""));
  const out = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (single.test(lines[i])) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import parsing (value bindings only — `import type` stays invisible)
// ---------------------------------------------------------------------------

const RE_IMPORT_STMT =
  /import\s+(type\s+)?([^;]*?)\s+from\s*["']([^"']+)["']/g;

/**
 * B1-6 — type-only imports must stay invisible, in BOTH spellings:
 * `import type { ScrollView } from "react-native"` and
 * `import { type ScrollView } from "react-native"`. A migrated screen keeps a
 * type-only ScrollView import for its imperative scroll handle, and flagging
 * that would make the correct fix trip the gate.
 */
function parseValueImports(text) {
  const out = [];
  RE_IMPORT_STMT.lastIndex = 0;
  let m;
  while ((m = RE_IMPORT_STMT.exec(text)) !== null) {
    const typeOnly = Boolean(m[1]);
    const clause = m[2] ?? "";
    const specifier = m[3];
    if (typeOnly) continue;

    const names = [];
    const braceMatch = clause.match(/\{([\s\S]*)\}/);
    if (braceMatch) {
      for (const rawPart of braceMatch[1].split(",")) {
        const part = rawPart.trim();
        if (part.length === 0) continue;
        if (/^type\s/.test(part)) continue; // inline `{ type X }`
        const asMatch = part.match(/^(\S+)\s+as\s+(\S+)$/);
        names.push(asMatch ? asMatch[2] : part);
      }
    }
    const beforeBrace = clause.split("{")[0];
    const nsMatch = beforeBrace.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (nsMatch) names.push(nsMatch[1]);
    else {
      const defaultMatch = beforeBrace.match(/^\s*([A-Za-z_$][\w$]*)\s*,?\s*$/);
      if (defaultMatch) names.push(defaultMatch[1]);
    }
    out.push({ specifier, names });
  }
  return out;
}

const RESOLVE_SUFFIXES = [
  ".tsx",
  ".ts",
  ".native.tsx",
  ".native.ts",
  ".web.tsx",
  ".web.ts",
  "/index.tsx",
  "/index.ts",
  "/index.native.tsx",
  "/index.native.ts",
];

/**
 * Relative and `@/` specifiers only — everything else (node_modules, workspace
 * packages) is outside the scan domain and therefore cannot be proven to render
 * an input from inside this gate.
 */
function resolveSpecifier(fromFile, specifier, known) {
  let base;
  if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    base = resolve(REPO_ROOT, "mingla-business", specifier.slice(2));
  } else {
    return null;
  }
  if (known.has(base)) return base;
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (known.has(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// JSX element spans
// ---------------------------------------------------------------------------

/** End index (exclusive) of an opening tag that starts at `start`. */
function findTagEnd(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth <= 0) return i + 1;
  }
  return -1;
}

function isTagBoundary(ch) {
  return ch === undefined || /[\s/>]/.test(ch);
}

/**
 * Every `<Tag …>…</Tag>` span in `text`, nesting-aware.
 *
 * B1-3.5 — if the close tag is never found the span runs to EOF. FAIL LOUD:
 * an unbalanced tree must over-report, never silently under-report, because an
 * under-report is indistinguishable from compliance.
 */
function findElementSpans(text, tag) {
  const spans = [];
  const openToken = `<${tag}`;
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const openStart = text.indexOf(openToken, searchFrom);
    if (openStart === -1) break;
    if (!isTagBoundary(text[openStart + openToken.length])) {
      searchFrom = openStart + openToken.length;
      continue;
    }
    // A GENERIC TYPE ARGUMENT is not an element. `useRef<ScrollView>(null)`
    // and `useRef<FlatList<Item>>(null)` are the canonical shapes, and reading
    // them as opening tags made the "span" run from the type annotation all the
    // way to the component's real `</ScrollView>` — i.e. the entire screen body,
    // which contains every field on it. A JSX tag is never glued to a preceding
    // identifier character or a dot; a type argument always is.
    const before = text[openStart - 1];
    if (before !== undefined && /[A-Za-z0-9_$.]/.test(before)) {
      searchFrom = openStart + openToken.length;
      continue;
    }
    const tagEnd = findTagEnd(text, openStart);
    if (tagEnd === -1) {
      spans.push({ start: openStart, end: text.length, selfClosing: false });
      break;
    }
    if (text[tagEnd - 2] === "/") {
      spans.push({ start: openStart, end: tagEnd, selfClosing: true });
      searchFrom = tagEnd;
      continue;
    }
    const closeToken = `</${tag}>`;
    let depth = 1;
    let cursor = tagEnd;
    let end = -1;
    while (cursor < text.length) {
      const nextOpen = text.indexOf(openToken, cursor);
      const nextClose = text.indexOf(closeToken, cursor);
      if (nextClose === -1) break;
      if (
        nextOpen !== -1 &&
        nextOpen < nextClose &&
        isTagBoundary(text[nextOpen + openToken.length])
      ) {
        const nestedEnd = findTagEnd(text, nextOpen);
        if (nestedEnd !== -1 && text[nestedEnd - 2] !== "/") depth += 1;
        cursor = nestedEnd === -1 ? nextOpen + openToken.length : nestedEnd;
        continue;
      }
      depth -= 1;
      cursor = nextClose + closeToken.length;
      if (depth === 0) {
        end = cursor;
        break;
      }
    }
    spans.push({
      start: openStart,
      end: end === -1 ? text.length : end,
      selfClosing: false,
    });
    searchFrom = tagEnd;
  }
  return spans;
}

/** Length-preserving blanking of every isolating-boundary subtree. */
function blankBoundaries(text) {
  let out = text;
  for (const tag of BOUNDARY_TAGS) {
    const spans = findElementSpans(out, tag);
    for (const span of spans) {
      const slice = out.slice(span.start, span.end);
      out =
        out.slice(0, span.start) +
        slice.replace(/[^\n]/g, " ") +
        out.slice(span.end);
    }
  }
  return out;
}

const RE_RENDERED_COMPONENT = /<([A-Z][\w$]*)[\s/>]/g;

function renderedComponentsIn(text) {
  const out = new Set();
  RE_RENDERED_COMPONENT.lastIndex = 0;
  let m;
  while ((m = RE_RENDERED_COMPONENT.exec(text)) !== null) out.add(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// The pure core
// ---------------------------------------------------------------------------

/**
 * Scan a file set for bespoke keyboard plumbing.
 *
 * @param {object} input
 * @param {string[]} input.files   absolute paths; MUST be non-empty
 * @param {(p: string) => string} input.readFile
 * @param {string} [input.repoRoot] root the SAFELIST paths are relative to
 * @returns {{ scanned: number, safelisted: number, warnings: Array }}
 */
export function scanKeyboardPlumbing({
  files,
  readFile,
  repoRoot = REPO_ROOT,
}) {
  if (!Array.isArray(files) || files.length === 0) {
    // I-PROPOSED-1841-A. An emptied SCAN_ROOTS, a broken walk or a renamed
    // directory used to make this gate print `Scanned 0` and `PASS`. A gate
    // that passes because it looked at nothing is worse than no gate: it is a
    // green tick that means nothing. Refuse.
    throw new Error(
      "orch-0892: refusing to scan an EMPTY file set — an empty scan is a failure, not a pass.",
    );
  }
  if (typeof readFile !== "function") {
    throw new Error("orch-0892: `readFile` must be a function.");
  }

  const known = new Set(files);
  const docs = new Map();
  for (const path of files) {
    const raw = readFile(path);
    docs.set(path, {
      raw,
      stripped: clean(raw),
      flow: blankBoundaries(blankComments(raw)),
      imports: parseValueImports(clean(raw)),
    });
  }

  // ---- H1: derive "renders a focusable input" over the import graph. -----
  // Leaf-seeded, closed upward to a fixed point with NO depth cap. This is the
  // CLASS: nothing here names a host file.
  const providesInput = new Set();
  for (const [path, doc] of docs) {
    if (RE_INPUT_LEAF.test(doc.flow)) providesInput.add(path);
  }
  const componentModule = new Map(); // path -> Map(localName -> resolvedPath)
  for (const [path, doc] of docs) {
    const map = new Map();
    for (const imp of doc.imports) {
      const resolved = resolveSpecifier(path, imp.specifier, known);
      if (resolved === null) continue;
      for (const name of imp.names) map.set(name, resolved);
    }
    componentModule.set(path, map);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [path, doc] of docs) {
      if (providesInput.has(path)) continue;
      const map = componentModule.get(path);
      for (const name of renderedComponentsIn(doc.flow)) {
        const target = map.get(name);
        if (target !== undefined && providesInput.has(target)) {
          providesInput.add(path);
          changed = true;
          break;
        }
      }
    }
  }

  const warnings = [];
  let scanned = 0;
  let safelisted = 0;

  const flag = (relPath, lineIdx, pattern, fix) => {
    warnings.push({ path: relPath, line: lineIdx + 1, pattern, fix });
  };

  for (const path of files) {
    scanned += 1;
    const relPath = relative(repoRoot, path);
    if (SAFELIST.has(relPath)) {
      safelisted += 1;
      continue;
    }
    const doc = docs.get(path);
    const { raw, stripped, flow } = doc;

    // ---- Pattern 1 — Keyboard.addListener, any argument form. ------------
    if (RE_KEYBOARD_ADDLISTENER.test(stripped)) {
      for (const lineIdx of allLinesMatching(raw, RE_KEYBOARD_ADDLISTENER)) {
        if (raw.split("\n")[lineIdx].trim().startsWith("//")) continue;
        if (hasInlineAllowlist(raw, lineIdx)) continue;
        flag(
          relPath,
          lineIdx,
          "Keyboard.addListener (layout-affecting event)",
          "Use useKeyboardHandler / useGenericKeyboardHandler / useReanimatedKeyboardAnimation from react-native-keyboard-controller for layout-affecting reads (see src/wrappers/useKeyboardHeight.native.ts), or wrap the parent in <KeyboardAvoidingView from 'react-native-keyboard-controller'>.",
        );
      }
    }

    // ---- Pattern 2 — KeyboardAvoidingView reached from 'react-native'. ---
    if (RE_KAV_FROM_RN_NAMED.test(stripped)) {
      const lineIdx = findLineOfMatch(raw, RE_KAV_FROM_RN_NAMED);
      if (!hasInlineAllowlist(raw, lineIdx)) {
        flag(
          relPath,
          lineIdx,
          "KeyboardAvoidingView imported from 'react-native'",
          "Import KeyboardAvoidingView from 'react-native-keyboard-controller' instead — drop-in replacement with frame-perfect native animation.",
        );
      }
    }
    RE_RN_NAMESPACE_IMPORT.lastIndex = 0;
    let nsMatch;
    while ((nsMatch = RE_RN_NAMESPACE_IMPORT.exec(stripped)) !== null) {
      const alias = nsMatch[1];
      const usage = new RegExp(
        `<\\s*${alias}\\s*\\.\\s*KeyboardAvoidingView\\b`,
      );
      if (!usage.test(stripped)) continue;
      for (const lineIdx of allLinesMatching(raw, usage)) {
        if (hasInlineAllowlist(raw, lineIdx)) continue;
        flag(
          relPath,
          lineIdx,
          "KeyboardAvoidingView reached through a 'react-native' namespace import",
          "Import KeyboardAvoidingView from 'react-native-keyboard-controller' instead. A namespace import (`import * as RN from \"react-native\"`) does not make the dependency any less real.",
        );
      }
    }

    // ---- Pattern 3 — automaticallyAdjustKeyboardInsets, any truthy form. -
    if (RE_AUTO_INSETS.test(stripped)) {
      for (const lineIdx of allLinesMatching(raw, RE_AUTO_INSETS)) {
        if (raw.split("\n")[lineIdx].trim().startsWith("//")) continue;
        if (hasInlineAllowlist(raw, lineIdx)) continue;
        flag(
          relPath,
          lineIdx,
          "automaticallyAdjustKeyboardInsets (truthy, including the bare-prop shorthand)",
          "Wrap the parent in <KeyboardAwareScrollView from 'react-native-keyboard-controller'> — automaticallyAdjustKeyboardInsets is iOS-only and fragile in nested layouts. Only an explicit ={false} turns it off.",
        );
      }
    }

    // ---- Pattern 4 — bare container hosting a focusable field. -----------
    const containerNames = new Set();
    for (const imp of doc.imports) {
      if (imp.specifier !== "react-native") continue;
      for (const name of imp.names) {
        if (BARE_CONTAINERS.includes(name)) containerNames.add(name);
      }
    }
    if (containerNames.size > 0) {
      // (a) THE EXISTING RULE, RETAINED VERBATIM. Keeping it means the
      //     corrected gate is a strict superset of what shipped before, so
      //     this change can never be a silent weakening — only (b) is new.
      const branchA =
        RE_SCROLLVIEW_FROM_RN_NAMED.test(stripped) &&
        RE_TEXTINPUT_PRESENT.test(stripped);

      // (b) THE CLASS. An input-bearing tag inside the container's own span,
      //     where "input-bearing" is derived from the import graph above.
      const map = componentModule.get(path);
      const offending = [];
      for (const name of containerNames) {
        for (const span of findElementSpans(flow, name)) {
          // A self-closing container is NOT exempt. The dominant shape for a
          // virtualised list is `<FlatList renderItem={…} />` — every child it
          // will ever render lives inside the opening tag's props, so skipping
          // self-closing spans would make FlatList/SectionList permanently
          // invisible, which is precisely hole H1's other half. The span
          // therefore always spans the props too.
          const body = flow.slice(span.start, span.end);
          let hosts = RE_INPUT_LEAF.test(body);
          if (!hosts) {
            for (const child of renderedComponentsIn(body)) {
              const target = map.get(child);
              if (target !== undefined && providesInput.has(target)) {
                hosts = true;
                break;
              }
            }
          }
          if (hosts) offending.push(offsetToLine(flow, span.start));
        }
      }

      const fix =
        "Import ScrollView from the SmartScrollView wrapper (src/wrappers/SmartScrollView, correct relative path per file depth) — it resolves to KeyboardAwareScrollView on native, which scrolls the focused field clear of the keyboard's Done bar at the wrapper's DERIVED bottomOffset, and to a plain ScrollView on web. Never pass bottomOffset from a call site. The library ships no keyboard-aware FlatList/SectionList: a virtualised list hosting a field needs either a different composition or an inline allowlist with a written reason.";

      if (offending.length > 0) {
        for (const lineIdx of offending) {
          if (hasInlineAllowlist(raw, lineIdx)) continue;
          flag(
            relPath,
            lineIdx,
            "bare react-native container (ScrollView/FlatList/SectionList) whose span renders a focusable input",
            fix,
          );
        }
      } else if (branchA) {
        const lineIdx = findLineOfMatch(raw, RE_SCROLLVIEW_FROM_RN_NAMED);
        if (!hasInlineAllowlist(raw, lineIdx)) {
          flag(
            relPath,
            lineIdx,
            "ScrollView imported from 'react-native' in a file containing TextInput",
            fix,
          );
        }
      }
    }
  }

  return { scanned, safelisted, warnings };
}

// ---------------------------------------------------------------------------
// Self-test — every closed hole gets a fixture that must go RED
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = "/orch-0892-self-test/mingla-business";

function runFixture(fileMap) {
  const files = Object.keys(fileMap);
  return scanKeyboardPlumbing({
    files,
    readFile: (p) => fileMap[p],
    repoRoot: "/orch-0892-self-test",
  });
}

const GOOD_FIXTURE = {
  [`${FIXTURE_ROOT}/src/good/CleanScreen.tsx`]: `
import React from "react";
import { View, Text } from "react-native";
import { ScrollView } from "../wrappers/SmartScrollView";
import { Input } from "../ui/Input";

export const CleanScreen = () => (
  <ScrollView keyboardShouldPersistTaps="handled">
    <Text>hi</Text>
    <Input value="" onChangeText={() => undefined} />
  </ScrollView>
);
`,
  [`${FIXTURE_ROOT}/src/ui/Input.tsx`]: `
import React from "react";
import { TextInput } from "react-native";
export const Input = (props) => <TextInput {...props} />;
`,
};

/**
 * Each entry: a file map that MUST produce a warning whose `pattern` matches
 * `expect`. Asserting the SPECIFIC pattern (not merely "something failed")
 * means a regex that stops matching for its own reason cannot be masked by an
 * unrelated one still firing.
 */
const BAD_FIXTURES = [
  {
    id: "G-1",
    why: "H1 — inputs rendered through the `Input` primitive, so the file has no TextInput token at all",
    expect: /bare react-native container/,
    files: {
      ...GOOD_FIXTURE,
      [`${FIXTURE_ROOT}/src/bad/PrimitiveForm.tsx`]: `
import React from "react";
import { ScrollView, View } from "react-native";
import { Input } from "../ui/Input";

export const PrimitiveForm = () => (
  <ScrollView>
    <View>
      <Input value="" onChangeText={() => undefined} />
    </View>
  </ScrollView>
);
`,
    },
  },
  {
    id: "G-2",
    why: "H2 — the event name is hoisted into a variable, which the literal-only regex walked straight past",
    expect: /Keyboard\.addListener/,
    files: {
      [`${FIXTURE_ROOT}/src/bad/HoistedListener.tsx`]: `
import { Keyboard, Platform } from "react-native";

export function useBespoke() {
  const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
  const sub = Keyboard.addListener(showEvent, () => undefined);
  return sub;
}
`,
    },
  },
  {
    id: "G-3",
    why: "H1 — FlatList and SectionList were never covered by pattern 4 at all",
    expect: /bare react-native container/,
    files: {
      [`${FIXTURE_ROOT}/src/bad/VirtualForms.tsx`]: `
import React from "react";
import { FlatList, SectionList, TextInput } from "react-native";

export const Lists = () => (
  <FlatList
    data={[]}
    renderItem={() => (
      <TextInput value="" onChangeText={() => undefined} />
    )}
  />
);

export const Sections = () => (
  <SectionList
    sections={[]}
    renderItem={() => (
      <TextInput value="" onChangeText={() => undefined} />
    )}
  />
);
`,
    },
  },
  {
    id: "G-4",
    why: "H5 — the JSX boolean shorthand is semantically ={true} but carries no `=`",
    expect: /automaticallyAdjustKeyboardInsets/,
    files: {
      [`${FIXTURE_ROOT}/src/bad/BareProp.tsx`]: `
import React from "react";
import { ScrollView } from "react-native";

export const BareProp = () => (
  <ScrollView automaticallyAdjustKeyboardInsets>
    <></>
  </ScrollView>
);
`,
    },
  },
  {
    id: "G-5",
    why: "H5 — a namespace import reaches the same forbidden component without any brace to match",
    expect: /namespace import/,
    files: {
      [`${FIXTURE_ROOT}/src/bad/NamespaceKav.tsx`]: `
import React from "react";
import * as RN from "react-native";

export const NamespaceKav = () => (
  <RN.KeyboardAvoidingView behavior="padding">
    <RN.Text>hi</RN.Text>
  </RN.KeyboardAvoidingView>
);
`,
    },
  },
  {
    id: "G-6",
    why: "H4 — a SECOND listener below an approved marker used to inherit that marker's immunity",
    expect: /Keyboard\.addListener/,
    files: {
      [`${FIXTURE_ROOT}/src/bad/SecondListener.tsx`]: `
import { Keyboard } from "react-native";

export function useTwo() {
  // orch-strict-grep-allow orch-0892 — approved: anchored sign-in, no ScrollView
  const a = Keyboard.addListener("keyboardDidShow", () => undefined);



  const b = Keyboard.addListener("keyboardWillShow", () => undefined);
  return [a, b];
}
`,
    },
  },
  {
    id: "G-7",
    why: "B1-5 — a MULTI-LINE import used to report line 0, which put the allowlist window on the wrong lines",
    expect: /bare react-native container|ScrollView imported from/,
    expectLineAbove: 1,
    files: {
      [`${FIXTURE_ROOT}/src/bad/MultiLineImport.tsx`]: `import React from "react";
import {
  ScrollView,
  TextInput,
  View,
} from "react-native";

export const MultiLine = () => (
  <ScrollView>
    <View>
      <TextInput value="" onChangeText={() => undefined} />
    </View>
  </ScrollView>
);
`,
    },
  },
];

const NEGATIVE_FIXTURES = [
  {
    id: "G-8",
    why: "B1-6 — a type-only ScrollView import is not a container; the CORRECT migration keeps one for its scroll handle",
    files: {
      [`${FIXTURE_ROOT}/src/good/TypeOnly.tsx`]: `
import React, { useRef } from "react";
import { View, TextInput } from "react-native";
import type { ScrollView as RNScrollView } from "react-native";
import { ScrollView } from "../wrappers/SmartScrollView";

export const TypeOnly = () => {
  const ref = useRef<RNScrollView | null>(null);
  return (
    <ScrollView ref={ref}>
      <View>
        <TextInput value="" onChangeText={() => undefined} />
      </View>
    </ScrollView>
  );
};
`,
    },
  },
  {
    id: "G-9",
    why: "the isolating-boundary rule — a field inside a <Modal> is in its own native window, not the outer scroll's flow. Written WITHOUT a literal TextInput token so branch (a) cannot fire and the fixture isolates branch (b)",
    files: {
      ...GOOD_FIXTURE,
      [`${FIXTURE_ROOT}/src/good/ModalBoundary.tsx`]: `
import React from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { Input } from "../ui/Input";

export const ModalBoundary = () => (
  <View>
    <ScrollView>
      <Text>no field in this flow</Text>
    </ScrollView>
    <Modal visible>
      <Input value="" onChangeText={() => undefined} />
    </Modal>
  </View>
);
`,
    },
  },
  {
    id: "G-10",
    why: "a bare container with NO focusable field anywhere in its span stays legal — the rule is about hosting an input, not about importing a ScrollView",
    files: {
      [`${FIXTURE_ROOT}/src/good/HorizontalStrip.tsx`]: `
import React from "react";
import { ScrollView, Text, View } from "react-native";

export const HorizontalStrip = () => (
  <ScrollView horizontal>
    <View>
      <Text>chip</Text>
    </View>
  </ScrollView>
);
`,
    },
  },
];

function selfTest() {
  const failures = [];

  const good = runFixture(GOOD_FIXTURE);
  if (good.warnings.length !== 0) {
    failures.push(
      `GOOD control produced ${good.warnings.length} warning(s): ${good.warnings
        .map((w) => `${w.path}:${w.line} ${w.pattern}`)
        .join(", ")}`,
    );
  }

  for (const fixture of BAD_FIXTURES) {
    let result;
    try {
      result = runFixture(fixture.files);
    } catch (err) {
      failures.push(`${fixture.id} threw: ${err.message}`);
      continue;
    }
    const hit = result.warnings.find((w) => fixture.expect.test(w.pattern));
    if (!hit) {
      failures.push(
        `${fixture.id} (${fixture.why}) produced NO warning matching ${fixture.expect} — got [${result.warnings
          .map((w) => w.pattern)
          .join(" | ")}]`,
      );
      continue;
    }
    if (fixture.expectLineAbove !== undefined && hit.line <= fixture.expectLineAbove) {
      failures.push(
        `${fixture.id} reported line ${hit.line}; the :0 defect is back (expected a line above ${fixture.expectLineAbove}).`,
      );
    }
  }

  for (const fixture of NEGATIVE_FIXTURES) {
    const result = runFixture(fixture.files);
    if (result.warnings.length !== 0) {
      failures.push(
        `${fixture.id} (${fixture.why}) must NOT be flagged, but produced: ${result.warnings
          .map((w) => `${w.path}:${w.line} ${w.pattern}`)
          .join(", ")}`,
      );
    }
  }

  let threw = false;
  try {
    scanKeyboardPlumbing({ files: [], readFile: () => "" });
  } catch {
    threw = true;
  }
  if (!threw) {
    failures.push(
      "an EMPTY file set did not throw — an empty scan must be a failure, never a pass (I-PROPOSED-1841-A).",
    );
  }

  if (failures.length > 0) {
    console.error("\norch-0892 self-test FAIL:");
    for (const f of failures) console.error(`  x ${f}`);
    console.error("");
    process.exit(1);
  }
  const count = BAD_FIXTURES.length + NEGATIVE_FIXTURES.length;
  console.log(
    `orch-0892 self-test PASS (GOOD + ${count} fixtures) — every closed hole goes red, every legal shape stays green, an empty scan throws.`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI shell
// ---------------------------------------------------------------------------

function runCli() {
  const files = collectSourceFiles(SCAN_ROOTS);
  const { scanned, safelisted, warnings } = scanKeyboardPlumbing({
    files,
    readFile: (p) => readFileSync(p, "utf8"),
  });

  console.log("\nORCH-0892 no-bespoke-keyboard-plumbing informational gate");
  console.log(`Scanned ${scanned} .ts/.tsx files under mingla-business/.\n`);
  console.log(
    `  ${safelisted} file(s) explicitly safelisted (Sheet / ComposerV2 / richEditor / KeyboardRoot)`,
  );

  if (warnings.length === 0) {
    console.log(
      "\nPASS — zero bespoke keyboard-plumbing violations outside the safelist.\n",
    );
    process.exit(0);
  }

  const offendingFiles = new Set(warnings.map((w) => w.path));
  console.log(
    `\nWARN — ${offendingFiles.size} file(s) using bespoke keyboard plumbing instead of react-native-keyboard-controller (${warnings.length} occurrence(s)):\n`,
  );
  for (const w of warnings) {
    console.log(`  ${w.path}:${w.line}`);
    console.log(`    pattern: ${w.pattern}`);
    console.log(`    fix:     ${w.fix}`);
    console.log("");
  }

  console.log(
    "Each WARN above is a BLOCKER (this gate exits 1 post-ORCH-0892-C). Either\n" +
      "(a) migrate the file to SmartScrollView wrapper (and use library primitives\n" +
      "    for any other keyboard-related code), or\n" +
      "(b) add `// orch-strict-grep-allow orch-0892 — <one-line reason>` within 3\n" +
      "    lines of EACH offending occurrence (per-occurrence since #1841; one\n" +
      "    marker no longer immunises a whole file). Needs operator approval\n" +
      "    before merge, and the file must be registered in the adversarial\n" +
      "    test's EXPECTED_ALLOWLISTED_FILES set in the same commit.\n",
  );
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes("--self-test")) selfTest();
  else runCli();
}
