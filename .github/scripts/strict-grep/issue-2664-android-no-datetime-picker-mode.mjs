#!/usr/bin/env node
// #2664 [editing a sale window crashes on Android] — class gate.
//
// Enforces I-PROPOSED-2664-ANDROID-NEVER-DATETIME-PICKER-MODE:
//
//   A `@react-native-community/datetimepicker` element that can reach Android
//   must never resolve `mode` to `"datetime"`. Only a POSITIVE
//   `Platform.OS === "ios"` guard lexically enclosing the element makes it
//   unreachable on Android.
//
// WHY THIS EXISTS. The library registers exactly two Android pickers
// (`src/picker.android.js`):
//
//     const pickers = {
//       [ANDROID_MODE.date]: DatePickerAndroid,
//       [ANDROID_MODE.time]: TimePickerAndroid,
//     };
//
// `materialPickers` in `androidUtils.js` carries the same two keys, so `design`
// does not route around it. There is no `datetime` entry anywhere on Android.
//
// But `constants.js` still declares `datetime: 'datetime'` in the SHARED mode
// union, so `mode="datetime"` type-checks, builds clean, and ships. The failure
// is deferred to UNMOUNT: `datetimepicker.android.js:46` registers
// `return () => DateTimePickerAndroid.dismiss(mode, design)` and `dismiss` does
// `pickers[mode].dismiss()` on `pickers['datetime'] === undefined`. The picker
// opens, appears to work, and throws `TypeError: Cannot read property 'dismiss'
// of undefined` when it closes — which is why it read as "it crashed when I
// changed the sale window" rather than "the picker never opened".
// (Sentry MINGLA-BUSINESS-18, SM-A725F / Android 14, production.)
//
// THE TYPE SYSTEM CANNOT CATCH THIS, which is the whole reason for a static
// gate. `mode="datetime"` is a legal value of the shared union on every
// platform; only Android lacks an implementation.
//
// WHY THE RULE IS "ios PIN", NOT "android GUARD". #2664 had TWO instances.
// The reported one was guarded `Platform.OS === "android"`. The second,
// `BookingDeadlinePicker`, was guarded `Platform.OS !== "web"` — which reaches
// Android just as surely, and which any sweep keyed on the literal string
// `Platform.OS === "android"` would have walked straight past. That is exactly
// how the second instance went unnoticed. So this gate inverts the question:
// an element is Android-reachable UNLESS something pins it to iOS.
//
//   Platform.OS === "android"   reaches Android  -> must not be `datetime`
//   Platform.OS !== "web"       reaches Android  -> must not be `datetime`
//   Platform.OS !== "ios"       reaches Android  -> must not be `datetime`
//   (no guard at all)           reaches Android  -> must not be `datetime`
//   Platform.OS === "ios"       iOS only         -> `datetime` is correct there
//
// Note that `Platform.OS !== "ios"` CONTAINS the substring `ios`. The pin
// matcher keys on the `===` operator explicitly for that reason; a substring
// search for `ios` would silently bless the one shape that is most obviously
// Android-reachable.
//
// C-1  an Android-reachable element resolves `mode` to the literal "datetime".
// C-2  the same, where `mode` is an EXPRESSION containing a "datetime" literal
//      — a ternary is not an escape hatch from C-1.
// C-3  census — the sweep must resolve a plausible number of elements overall,
//      AND at least one in each of the two files #2664 fixed. A parser that
//      resolved zero would pass vacuously forever.
//
// FILES ARE SELECTED BY WHAT THEY IMPORT, never by filename. The element can be
// bound to any local name (`import Picker from "@react-native-community/…"`),
// and a file named nothing like a picker can still render one.
//
// Comments are stripped before ANY match. Measured honestly: with stripping
// disabled the plain run over today's source still passes, because the #2664
// fix's comments mention `mode="datetime"` as prose rather than inside a
// `<DateTimePicker …>` tag. The stripping guards the NEXT comment, not this
// one — a developer documenting the bug by pasting the offending element into
// a comment (exactly what M-10 fixtures) would otherwise have the gate fire on
// their documentation, and this repo has already produced a false positive from
// an audit regex matching a word inside a comment in the same file
// (reference_audit_regex_matches_comments_same_file). String CONTENTS are
// deliberately NOT blanked — the value being matched IS a string literal.
//
// `--self-test` proves the gate fires on each reverted shape and passes on the
// shipped shape, so a green run is evidence rather than vacuity.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const SCAN_ROOTS = [
  "mingla-business/src",
  "mingla-business/app",
  "app-mobile/src",
  "packages",
];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".expo",
  "web-build",
  "coverage",
]);

const PACKAGE_ID = "@react-native-community/datetimepicker";

/** Files #2664 fixed. Each must still resolve at least one element (C-3). */
const CENSUS_FILES = [
  "mingla-business/src/components/event/TicketTierEditSheet.tsx",
  "mingla-business/src/components/trip/BookingDeadlinePicker.tsx",
];
/**
 * Floor for total resolved elements across the sweep. Measured at 31 when this
 * gate shipped; 20 leaves room for genuine refactors while still failing loudly
 * if the parser goes blind.
 */
const CENSUS_FLOOR = 20;

// ---------------------------------------------------------------------------
// Source normalisation
// ---------------------------------------------------------------------------

/**
 * Blank comment bodies, preserving newlines and total character offsets so
 * reported line numbers stay true. String and template CONTENTS are preserved —
 * `"datetime"` is the payload — but the scanner still has to know where strings
 * start and end so that a `//` or `/*` inside one is not mistaken for a comment.
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let state = "code"; // code | line | block | sq | dq | tpl
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") { out += "  "; i += 2; state = "line"; continue; }
      if (c === "/" && d === "*") { out += "  "; i += 2; state = "block"; continue; }
      if (c === "'") { out += c; i += 1; state = "sq"; continue; }
      if (c === '"') { out += c; i += 1; state = "dq"; continue; }
      if (c === "`") { out += c; i += 1; state = "tpl"; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { out += "\n"; i += 1; state = "code"; continue; }
      out += " "; i += 1; continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") { out += "  "; i += 2; state = "code"; continue; }
      out += c === "\n" ? "\n" : " "; i += 1; continue;
    }
    // Inside a string/template: contents are KEPT verbatim.
    if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
    const closer = state === "sq" ? "'" : state === "dq" ? '"' : "`";
    if (c === closer) { out += c; i += 1; state = "code"; continue; }
    out += c; i += 1;
  }
  return out;
}

/** Index of the bracket matching the opener at `open`, or -1 if unclosed. */
export function matchGroup(src, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const closer = pairs[src[open]];
  if (closer === undefined) return -1;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return c === closer ? i : -1;
    }
  }
  return -1;
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// ---------------------------------------------------------------------------
// Import binding
// ---------------------------------------------------------------------------

/**
 * The local name the datetimepicker default export is bound to in this file, or
 * null if the file does not import it. Sweeping by IMPORT is the point: the
 * element can be called anything, and `BookingDeadlinePicker.tsx` is not a name
 * any filename-keyed sweep would have selected.
 */
export function pickerBinding(src) {
  const re = new RegExp(
    `import\\s+([A-Za-z_$][\\w$]*)\\s*(?:,\\s*\\{[^}]*\\})?\\s*from\\s*["']${PACKAGE_ID.replace(
      /[/@-]/g,
      (m) => `\\${m}`,
    )}["']`,
  );
  const m = re.exec(src);
  return m === null ? null : m[1];
}

// ---------------------------------------------------------------------------
// Guard analysis
// ---------------------------------------------------------------------------

const IOS_PIN = /Platform\.OS\s*===\s*["']ios["']/;
const ANY_PLATFORM_TEST = /Platform\.OS\s*(===|!==|==|!=)\s*["'][a-z]+["']/g;

/**
 * Tokens on the ANCESTOR path from the start of `prefix` down to the element.
 *
 * Groups that OPEN AND CLOSE inside `prefix` are siblings of the element — a
 * different JSX branch entirely — and are skipped. A group that opens and never
 * closes is an ancestor, so the walk descends into it. Without this the
 * `Platform.OS === "ios" ? (<A/>) : (<Picker/>)` shape would read the `?` from
 * the then-branch and wrongly bless the else-branch.
 */
export function ancestorTokens(prefix) {
  const toks = [];
  let i = 0;
  while (i < prefix.length) {
    const c = prefix[i];
    if (c === "(" || c === "[" || c === "{") {
      const close = matchGroup(prefix, i);
      if (close === -1) {
        toks.push(...ancestorTokens(prefix.slice(i + 1)));
        return toks;
      }
      i = close + 1;
      continue;
    }
    if (c === "?" && prefix[i + 1] !== ".") { toks.push("?"); i += 1; continue; }
    if (c === ":") { toks.push(":"); i += 1; continue; }
    if (c === "&" && prefix[i + 1] === "&") { toks.push("&&"); i += 2; continue; }
    const ahead = prefix.slice(i, i + 40);
    const pm = /^Platform\.OS\s*(===|!==|==|!=)\s*["']([a-z]+)["']/.exec(ahead);
    if (pm !== null) {
      toks.push(pm[1] === "===" && pm[2] === "ios" ? "IOS_EQ" : "PLATFORM_OTHER");
      i += pm[0].length;
      continue;
    }
    i += 1;
  }
  return toks;
}

/**
 * True when the element is pinned to iOS by an enclosing guard.
 *
 * A pin requires a POSITIVE `Platform.OS === "ios"` whose TRUE branch contains
 * the element: the comparison must be followed by `&&` (chain continues) or `?`
 * (then-branch entered) before the element, and must not have been left via a
 * ternary `:` in between.
 */
export function isIosPinned(tokens) {
  let candidate = false;
  let pinned = false;
  for (const t of tokens) {
    if (t === "IOS_EQ") { candidate = true; continue; }
    if (t === "&&") { if (candidate) pinned = true; continue; }
    if (t === "?") { if (candidate) pinned = true; candidate = false; continue; }
    if (t === ":") { pinned = false; candidate = false; continue; }
    if (t === "PLATFORM_OTHER") { candidate = false; continue; }
  }
  return pinned;
}

/** Every `{` before `at` whose matching `}` falls after it — the JSX ancestors. */
function enclosingExpressionStarts(src, at) {
  const starts = [];
  for (let i = 0; i < at; i += 1) {
    if (src[i] !== "{") continue;
    const close = matchGroup(src, i);
    if (close === -1 || close > at) starts.push(i);
  }
  return starts;
}

// ---------------------------------------------------------------------------
// Element scanning
// ---------------------------------------------------------------------------

/** End index of the opening tag beginning at `start`. Braces are balanced. */
function openTagEnd(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/** The raw `mode` attribute of an opening tag: {kind, value} or null. */
export function modeAttr(tag) {
  const lit = /(^|[\s{])mode\s*=\s*["']([^"']*)["']/.exec(tag);
  if (lit !== null) return { kind: "literal", value: lit[2] };
  const ex = /(^|[\s{])mode\s*=\s*\{/.exec(tag);
  if (ex === null) return null;
  const brace = ex.index + ex[0].length - 1;
  const end = matchGroup(tag, brace);
  if (end === -1) return { kind: "expression", value: tag.slice(brace + 1) };
  return { kind: "expression", value: tag.slice(brace + 1, end) };
}

const DATETIME_LITERAL = /["']datetime["']/;

/** @returns {{resolved: number}} — the C-3 census counter. */
export function checkSource(rawSrc, relPath, failures) {
  const src = stripComments(rawSrc);
  const binding = pickerBinding(src);
  // Selected by IMPORT, not by filename. No import, nothing to check.
  if (binding === null) return { resolved: 0 };

  let resolved = 0;
  const re = new RegExp(`<${binding}(?![A-Za-z0-9_$])`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    const end = openTagEnd(src, m.index);
    if (end === -1) continue;
    const tag = src.slice(m.index, end);
    const line = lineOf(src, m.index);
    resolved += 1;

    const mode = modeAttr(tag);
    if (mode === null) continue;

    const isDatetime =
      mode.kind === "literal"
        ? mode.value === "datetime"
        : DATETIME_LITERAL.test(mode.value);
    if (!isDatetime) continue;

    const pinned = enclosingExpressionStarts(src, m.index).some((start) =>
      isIosPinned(ancestorTokens(src.slice(start + 1, m.index))),
    );
    if (pinned) continue;

    const guards = [
      ...src.slice(Math.max(0, m.index - 400), m.index).matchAll(ANY_PLATFORM_TEST),
    ].map((g) => g[0]);
    const guardNote =
      guards.length === 0
        ? "no Platform guard at all"
        : `nearest guards: ${guards.slice(-2).join(", ")}`;

    failures.push(
      `${relPath}:${line}: <${binding}> resolves mode to "datetime" ` +
        `(${mode.kind}) with no enclosing \`Platform.OS === "ios"\` pin — ` +
        `${guardNote}. Android registers only \`date\` and \`time\` pickers, so ` +
        `this element throws "Cannot read property 'dismiss' of undefined" on ` +
        `UNMOUNT (#2664). Step date -> time on Android, as CreatorStep2When does.`,
    );
  }
  return { resolved };
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.isFile() && (e.name.endsWith(".tsx") || e.name.endsWith(".ts"))) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const IMPORT = `import DateTimePicker from "${PACKAGE_ID}";`;
  const run = (src) => {
    const f = [];
    const r = checkSource(src, "fixture.tsx", f);
    return { failures: f, ...r };
  };
  /** Assert a mutant fails FOR ITS OWN REASON, not incidentally. */
  const expectFail = (name, src, mustMention) => {
    const r = run(src);
    if (r.failures.length === 0) {
      selfFailures.push(`${name}: NOT flagged`);
      return;
    }
    if (r.resolved === 0) {
      selfFailures.push(`${name}: flagged but resolved 0 elements — wrong reason`);
      return;
    }
    for (const needle of mustMention) {
      if (!r.failures.some((f) => f.includes(needle))) {
        selfFailures.push(
          `${name}: flagged, but no failure mentions ${JSON.stringify(needle)} — ` +
            `caught for the wrong reason. Got: ${r.failures[0]}`,
        );
      }
    }
  };
  const expectPass = (name, src, expectResolved) => {
    const r = run(src);
    if (r.failures.length !== 0) {
      selfFailures.push(`${name}: wrongly flagged — ${r.failures[0]}`);
    }
    if (expectResolved !== undefined && r.resolved !== expectResolved) {
      selfFailures.push(
        `${name}: resolved ${r.resolved} elements, expected ${expectResolved}`,
      );
    }
  };

  // ---- M-1  the REPORTED instance: `Platform.OS === "android"` guard --------
  expectFail(
    "M-1 android-guarded datetime (TicketTierEditSheet's shape)",
    `${IMPORT}
     const el = <View>
       {salePickerMode !== null && Platform.OS === "android" ? (
         <DateTimePicker value={v} mode="datetime" display="default" onChange={h} is24Hour />
       ) : null}
     </View>;`,
    ['Platform.OS === "android"', "literal"],
  );

  // ---- M-2  the SECOND instance: `!== "web"` reaches Android ----------------
  // The one a sweep keyed on the string `Platform.OS === "android"` would miss.
  expectFail(
    "M-2 !== web guarded datetime (BookingDeadlinePicker's shape)",
    `${IMPORT}
     const el = <View>
       {toggleOn && pickerOpen && Platform.OS !== "web" && (
         <DateTimePicker value={v} mode="datetime" display={Platform.OS === "ios" ? "spinner" : "default"} onChange={h} />
       )}
     </View>;`,
    ['Platform.OS !== "web"', "literal"],
  );

  // ---- M-3  `!== "ios"` — the substring trap -------------------------------
  // Contains `ios`. A pin matcher that searched for the substring rather than
  // the `===` operator would bless the most obviously Android-reachable shape
  // in the whole set.
  expectFail(
    "M-3 !== ios guarded datetime (substring trap)",
    `${IMPORT}
     const el = <View>
       {Platform.OS !== "ios" && (
         <DateTimePicker value={v} mode="datetime" onChange={h} />
       )}
     </View>;`,
    ['Platform.OS !== "ios"'],
  );

  // ---- M-4  no guard at all ------------------------------------------------
  expectFail(
    "M-4 unguarded datetime",
    `${IMPORT}
     const el = <DateTimePicker value={v} mode="datetime" onChange={h} />;`,
    ["no Platform guard at all"],
  );

  // ---- M-5  the ELSE branch of an ios ternary is not a pin ------------------
  expectFail(
    "M-5 datetime in the else-branch of an ios ternary",
    `${IMPORT}
     const el = <View>
       {Platform.OS === "ios" ? (
         <DateTimePicker value={v} mode="date" onChange={h} />
       ) : (
         <DateTimePicker value={v} mode="datetime" onChange={h} />
       )}
     </View>;`,
    ["datetime"],
  );

  // ---- M-6  C-2: a ternary is not an escape hatch --------------------------
  expectFail(
    "M-6 datetime reached through a mode EXPRESSION",
    `${IMPORT}
     const el = <View>
       {Platform.OS === "android" && (
         <DateTimePicker value={v} mode={step === "one" ? "datetime" : "time"} onChange={h} />
       )}
     </View>;`,
    ["expression"],
  );

  // ---- M-7  an ALIASED import is still the same component ------------------
  expectFail(
    "M-7 aliased local binding",
    `import Picker from "${PACKAGE_ID}";
     const el = <View>
       {Platform.OS === "android" && <Picker value={v} mode="datetime" onChange={h} />}
     </View>;`,
    ["<Picker>"],
  );

  // ---- M-8  SHIPPED shape: ios-pinned datetime + android two-step -> PASS ---
  expectPass(
    "M-8 the shipped #2664 shape",
    `${IMPORT}
     const el = <View>
       {Platform.OS === "ios" ? (
         <DateTimePicker value={v} mode="datetime" display="spinner" onChange={h} />
       ) : androidStep !== null ? (
         <DateTimePicker value={v} mode={androidStep === "date" ? "date" : "time"} display="default" onChange={h} />
       ) : null}
     </View>;`,
    2,
  );

  // ---- M-9  the && form of an ios pin --------------------------------------
  expectPass(
    "M-9 ios pin via && chain",
    `${IMPORT}
     const el = <View>
       {open && Platform.OS === "ios" && (
         <DateTimePicker value={v} mode="datetime" onChange={h} />
       )}
     </View>;`,
    1,
  );

  // ---- M-10 a COMMENTED-OUT violation must NOT fire ------------------------
  // The fixture carries the whole offending ELEMENT inside comments — a line
  // comment and a block comment — which is what a developer documenting this
  // bug actually writes, and what the #2664 fix's own comments come close to.
  // An unstripped matcher finds `<DateTimePicker`, walks to the `>`, reads
  // `mode="datetime"`, finds no ios pin, and reports the fix as the defect.
  // The `resolved` count is the second half of the assertion: exactly ONE real
  // element exists here, so a parser that counted the commented ones too would
  // be caught even if it somehow produced no failure.
  expectPass(
    "M-10 commented-out violation",
    `${IMPORT}
     // #2664 — this used to be {Platform.OS === "android" && <DateTimePicker mode="datetime" />}
     /* and also <DateTimePicker value={v} mode="datetime" onChange={h} /> in the other branch. */
     const el = <View>
       {Platform.OS === "android" && (
         <DateTimePicker value={v} mode={s === "date" ? "date" : "time"} onChange={h} />
       )}
     </View>;`,
    1,
  );

  // ---- M-11 VACUITY: a reassuring comment must not rescue a real violation --
  {
    const r = run(
      `${IMPORT}
       // this one is fine, it is ios only, honest
       const el = <View>
         {Platform.OS === "android" && <DateTimePicker value={v} mode="datetime" onChange={h} />}
       </View>;`,
    );
    if (r.failures.length === 0) {
      selfFailures.push("M-11 VACUITY: a comment suppressed a real violation");
    }
  }

  // ---- M-12 a file that does not import the package is not swept -----------
  expectPass(
    "M-12 no import",
    `const el = <DateTimePicker value={v} mode="datetime" onChange={h} />;`,
    0,
  );

  // ---- M-13 non-datetime modes are never flagged ---------------------------
  expectPass(
    "M-13 real android modes",
    `${IMPORT}
     const el = <View>
       {Platform.OS === "android" && <DateTimePicker value={v} mode="date" onChange={h} />}
       {Platform.OS === "android" && <DateTimePicker value={v} mode="time" onChange={h} />}
     </View>;`,
    2,
  );

  // ---- M-14 a longer component name must not match as a prefix -------------
  // The sibling-issue trap: `<DateTimePickerRow>` is a DIFFERENT component and
  // must not be scanned as if it were the picker.
  expectPass(
    "M-14 longer component name is not the picker",
    `${IMPORT}
     const el = <DateTimePickerRow value={v} mode="datetime" onChange={h} />;`,
    0,
  );

  // ---- M-15 census counts only real elements -------------------------------
  {
    const r = run(`${IMPORT}\nconst nothing = 1;`);
    if (r.resolved !== 0) {
      selfFailures.push("M-15: census counted an element that is not rendered");
    }
  }

  if (selfFailures.length > 0) {
    console.error(
      "#2664 I-PROPOSED-2664-ANDROID-NEVER-DATETIME-PICKER-MODE self-test FAIL:",
    );
    selfFailures.forEach((s) => console.error("  - " + s));
    process.exit(1);
  }
  console.log(
    "#2664 I-PROPOSED-2664-ANDROID-NEVER-DATETIME-PICKER-MODE self-test PASS " +
      "(15/15 mutants: M-1 android-guard, M-2 !==web, M-3 !==ios substring trap, " +
      "M-4 unguarded, M-5 ternary else, M-6 mode expression, M-7 aliased import, " +
      "M-8 shipped shape, M-9 && pin, M-10 commented-out violation, M-11 vacuity, M-12 no import, " +
      "M-13 real modes, M-14 name-prefix trap, M-15 census).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Plain mode
// ---------------------------------------------------------------------------

const files = [];
for (const root of SCAN_ROOTS) walk(path.join(repoRoot, root), files);
files.sort();

const failures = [];
let totalResolved = 0;
const perCensusFile = new Map(CENSUS_FILES.map((f) => [f, null]));
let swept = 0;

for (const full of files) {
  const rel = path.relative(repoRoot, full);
  const { resolved } = checkSource(fs.readFileSync(full, "utf8"), rel, failures);
  totalResolved += resolved;
  if (resolved > 0) swept += 1;
  if (perCensusFile.has(rel)) perCensusFile.set(rel, resolved);
}

// C-3 — census, checked BEFORE reporting a clean run. "Zero violations" from a
// parser that resolved zero elements is exactly the failure mode this gate
// exists to prevent, and it must not produce it itself.
for (const [rel, resolved] of perCensusFile) {
  if (resolved === null) {
    failures.push(
      `${rel}: census target not found in the sweep — the #2664 gate is scanning ` +
        `nothing here. Re-point CENSUS_FILES at the moved/renamed component.`,
    );
  } else if (resolved < 1) {
    failures.push(
      `${rel}: resolved ${resolved} picker elements, expected at least 1. The ` +
        `parser has gone blind (import renamed, element renamed, or a refactor) ` +
        `and would pass vacuously on the very defect it guards.`,
    );
  }
}
if (totalResolved < CENSUS_FLOOR) {
  failures.push(
    `census: resolved ${totalResolved} picker elements across ${SCAN_ROOTS.join(
      " + ",
    )}, expected at least ${CENSUS_FLOOR}. The sweep or the import matcher has ` +
      `broken; a near-empty universe makes this gate carry no information.`,
  );
}

if (failures.length > 0) {
  console.error("FAIL: #2664 android-no-datetime-picker-mode");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `OK: #2664 android-no-datetime-picker-mode — ${files.length} source files swept ` +
    `across ${SCAN_ROOTS.join(" + ")}; ${totalResolved} picker elements resolved in ` +
    `${swept} importing files; none reaches Android with mode="datetime".`,
);
