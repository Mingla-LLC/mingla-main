#!/usr/bin/env node
/**
 * ISSUE-1850-QUARANTINE-INVARIANT-HANDOFF-COMPLETE  (#1850 [quarantined-checkout-pins])
 *
 * WHAT THIS IS FOR
 *
 * `mingla-business/jest.config.cjs` quarantines a set of jest files under the
 * heading "the rule is now enforced by an ADDITIVE strict-grep gate … enforcement
 * is continuous, never dropped", and each entry carries a comment of the form
 *
 *     "<test filename pattern>",   // invariant -> <gate>.mjs
 *
 * #1850 audited all eleven of those hand-offs by replaying the quarantined
 * assertions against the tree. **Zero were complete. Nine were partial. Two named
 * a gate enforcing the opposite rule for a decommissioned feature.** The worst
 * kept 6 of 41 assertions and left 11 source files described by nothing — and
 * nothing in the repo parsed the annotation, so every one of them read as a clean
 * hand-off in the very file a human opens to decide whether coverage exists.
 *
 * THE RULE
 *
 *     targets(quarantined test) ⊆ targets(named gate) ∪ declared-dropped
 *
 * Both sides already name their targets as string literals, so this is decidable
 * from source. A partial migration is still allowed — sometimes it is right — but
 * it can no longer happen SILENTLY: the author has to type each abandoned file and
 * a reason naming its successor, and a reviewer sees a list of dropped files
 * instead of a tidy arrow.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KNOWN LIMITATION — READ THIS BEFORE TRUSTING A GREEN RUN
 *
 * This gate checks coverage at FILE level. It cannot check it at ASSERTION level.
 *
 * In plain terms: if the named gate opens the right file and asserts even one weak
 * thing about it, this gate counts that file as covered and says nothing more. It
 * does not, and cannot, compare what the quarantined test asserted about that file
 * against what the gate asserts about it.
 *
 * That is not hypothetical, and it is MEASURED rather than reasoned. The method:
 * strip one entry's ledger, re-run, record what reddens; repeat for all eleven live
 * hand-offs. The eleven fall into exactly three buckets.
 *
 *   MEASURED-CATCHES: metaOrch1255R2, PaymentPlanEditor, orch_0893a_hydration_gate,
 *     orch_1165_keyboard_toolbar_mount_coverage, venueIntelligence,
 *     home.orch_0974.test, home.orch_0974.adversarial
 *   MEASURED-INVERSION-ONLY: venueAdsDrivenTile
 *   MEASURED-MISSES: liveEventStore-v4-v5-migrator, rsvp, orch_0911_trip_confirm_loading_state
 *
 * CATCHES are the seven the ⊆ rule reddens on. INVERSION-ONLY is the one where ⊆ is
 * silent — the named gate does read the file — and R4 reddens instead, so the gate
 * as a whole still sees it. MISSES are the three nothing here reddens on at all:
 * those are the blind spots, and they are the only ones.
 *
 * THE FLAGSHIP BLIND SPOT IS `rsvp/[id]/preview` — one file, fully covered, and
 * roughly 24 of its 29 assertions dark inside it. Only the negative "do not import
 * the ticket renderer" rule survived the hand-off; every positive-mount, migration,
 * guard and UX-state rule is unguarded, and this gate is silent about all of it,
 * because the named gate does read the file. If you are looking for what this
 * mechanism cannot see, look there first, then at the other two named above.
 *
 * CORRECTION OF THE RECORD (#1850 TEST, P2-4). This paragraph previously offered
 * `PaymentPlanEditor` as its one concrete example of a case the gate would NOT
 * catch. That was false, and worse, a happy-path assertion pinned the error in
 * place. The gate DOES catch it: strip its ledger and it reddens with
 * `6 of 7 file(s) covered by NOTHING`, because the RPC-contract and
 * cache-invalidation rules that hand-off dropped live in OTHER files
 * (`orderInstallmentsService.ts`, `useOrderInstallments.ts`) — which a file-level
 * rule sees perfectly well. Only the residue INSIDE `PaymentPlanEditor.tsx` is
 * invisible here. The count of five was right at that backfill; #2794 later made
 * both Home drops explicit and named their RecentRow successor, leaving the three
 * genuinely missed hand-offs listed above.
 *
 * The lesson is the one this whole issue is about: a documented limitation is an
 * assertion, and it needs evidence like any other. `T-7` of the happy-path suite
 * now RE-MEASURES both sets against the live corpus and fails if this paragraph
 * and the tree ever disagree — so this text cannot rot the way it was born.
 *
 * The residue is a judgement call: whether the rules a gate keeps INSIDE a file
 * are the load-bearing ones is not decidable from string literals, and a gate that
 * pretended otherwise would be making the same mistake it exists to catch. So the
 * division of labour is deliberate — this gate makes the file-level ledger
 * unfalsifiable, and a human still has to read what survived inside each file. The
 * backfill records that per-entry residue in the `// note:` line beside each entry.
 *
 * It is written here, in the gate's own header, because the defect #1850 is about
 * is mechanisms that overstate their coverage. A gate that overstated its own
 * would refute itself — which, for one review cycle, is exactly what this one did.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ANNOTATION SHAPE
 *
 *     "orch_1165_keyboard_toolbar_mount_coverage\\.test\\.ts$", // invariant -> i-1047-….mjs
 *     // moved: app/_layout.tsx, src/components/ui/SheetMobile.tsx,
 *     //   src/components/ui/Modal.tsx
 *     // dropped: app/checkout/[eventId]/buyer.tsx — ORCH-1252 migrated it to
 *     //   SmartScrollView; orch-0892-no-bespoke-keyboard-plumbing.mjs owns it now
 *     // note: free prose, ignored by this gate
 *
 * RULES
 *   R1  The named gate resolves to a file on disk (missing ⇒ exit 2, never a skip
 *       — #1559) AND to a MANIFEST.json gates[] row whose enforcement starts
 *       `batch:` / `job:` / `external:`. `unenforced` and `fixture` are failures:
 *       an invariant handed to a gate CI does not run has not been handed anywhere.
 *   R2  targets(test) ⊆ targets(gate) ∪ dropped. Residue is named file by file.
 *   R2b The ledger may not lie in the other direction either: a `moved:` path must
 *       actually be a target of the gate, and every declared path must be a target
 *       of the test. A ledger that names files nobody reads is decoration.
 *   R3  Every drop carries a reason of at least 20 characters containing a
 *       successor token — a `*.mjs` gate name, `#<issue>`, or `DECOMMISSIONED`.
 *       `// dropped: x` on its own fails.
 *   R4  An INVERTED hand-off must say so. If the named gate fails when a token is
 *       PRESENT and the quarantined test required that same token present, the
 *       annotation must carry `DECOMMISSIONED` or `inverted ->`. That is not a
 *       re-homing, it is a 180° reversal recorded as one. R4b adds the coarse
 *       case: a gate that shares ZERO target files with the test must declare too.
 *
 * VACUITY — every one of these is exit 2, never a quiet pass:
 *   V-MARKER     the #1047 block marker is gone, so nothing was parsed.
 *   V-ENTRIES    fewer than 8 annotated entries parsed (today: 11).
 *   V-TESTS      an entry's pattern matches NO test file on disk.
 *   V-UNREADABLE a named gate or quarantined test could not be read.
 *   V-TARGETS    a test that calls readFileSync yields ZERO extracted targets —
 *                the extractor did not observe the file it is judging, so every
 *                verdict about that entry would be vacuously true.
 *
 * `--self-test` runs the twelve fixtures below, including #1850's own defect.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const BIZ = path.join(REPO, "mingla-business");
const JEST_CONFIG = path.join(BIZ, "jest.config.cjs");
const MANIFEST = path.join(HERE, "MANIFEST.json");
const SELF_TEST = process.argv.includes("--self-test");
/**
 * Only run when invoked directly. The helpers below are imported by
 * `__tests__/issue-1850-quarantine-invariant-handoff.happy.test.mjs`, which must be
 * able to load them without the live scan firing and exiting the test process.
 */
const IS_MAIN =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/** The block this gate reads. Shared with orch-1047-quarantine-list-is-source-pins-only.mjs. */
const BLOCK_MARKER = "#1047 [business-jest-suite-audit] — Part 1 quarantine";
/** Today the block carries 11 annotated entries. Well below that, the parse broke. */
const MIN_ENTRIES = 8;
/** A drop reason shorter than this is not a reason. */
const MIN_REASON = 20;
/** A successor: a gate file, an issue, or an explicit decommission. */
const SUCCESSOR = /[\w.-]+\.mjs\b|#\d+|DECOMMISSIONED/;
/** Enforcement states that mean CI actually runs the gate. */
const LIVE_ENFORCEMENT = /^(?:batch:|job:|external:)/;

const toPosix = (p) => p.split(path.sep).join("/");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ═══════════════════════════ target extraction ═══════════════════════════
//
// Both sides name their targets as string literals, but neither side always
// writes a whole path in one literal. A literal-only extractor returns ZERO for
// six of the eleven live pairs (measured), because they compose the path from
// segments: `join(__dirname, "..", "liveEventStore.ts")`, or bind a root const
// and join onto it. Zero targets would make ⊆ vacuously true, so the composition
// has to be followed. V-TARGETS is the backstop if it ever stops working.

/** A path literal written whole. */
const PATH_SHAPE =
  /^(?:app|src|packages|scripts|supabase)\/[^\s"'`]*\.(?:tsx|ts|jsx|js|mjs|cjs|json)$/;
/** A composed path is only a target if it ends in a source file. */
const SOURCE_EXT = /\.(?:tsx|ts|jsx|js|mjs|cjs|json)$/;

/** Every string literal in already-comment-stripped code. */
function stringLiterals(code) {
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`$\\]*)`/g;
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Body of the parenthesised group that starts at `open` (index of the `(`). */
function balanced(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return { body: code.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Split a call's argument list on top-level commas. */
function splitArgs(body) {
  const out = [];
  let depth = 0;
  let cur = "";
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === "\\") {
        cur += body[i + 1] ?? "";
        i += 1;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    if (c === ")" || c === "]" || c === "}") depth -= 1;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out.map((s) => s.trim());
}

/** Every `join(...)` / `resolve(...)` call: which one, its args body, its span. */
function pathCalls(code) {
  const out = [];
  const re = /\b(?:path\s*\.\s*)?(join|resolve)\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const b = balanced(code, m.index + m[0].length - 1);
    if (b) out.push({ kind: m[1], start: m.index, body: b.body, end: b.end });
  }
  return out;
}

const LITERAL_ONLY = /^(["'`])((?:[^\\]|\\.)*)\1$/;

/**
 * Resolve one join/resolve call, or null if any segment is an expression this
 * deliberately-simple resolver does not model. `join` and `resolve` are kept
 * distinct because they disagree exactly where it matters: `resolve` lets a
 * later ABSOLUTE segment discard everything before it, which silently rebases a
 * nested `join("mingla-business", rel)` onto the process cwd.
 */
function resolveCall(kind, body, env) {
  const parts = [];
  for (const arg of splitArgs(body)) {
    const lit = LITERAL_ONLY.exec(arg);
    if (lit) {
      parts.push(lit[2]);
      continue;
    }
    if (env.has(arg)) {
      parts.push(env.get(arg));
      continue;
    }
    const nested = pathCalls(arg);
    if (nested.length === 1 && nested[0].start === 0) {
      const inner = resolveCall(nested[0].kind, nested[0].body, env);
      if (inner !== null) {
        parts.push(inner);
        continue;
      }
    }
    return null;
  }
  if (parts.length === 0) return null;
  return kind === "resolve" ? path.resolve(...parts) : path.join(...parts);
}

/**
 * Targets named by one source file, as paths relative to `bizRoot` (or to
 * `repoRoot` when they sit outside mingla-business).
 *
 * `selfDir` is the directory of the file whose source this is — `__dirname` for a
 * CJS test, and the same thing for an ESM gate once the two `import.meta.url`
 * spellings are folded onto that name.
 */
export function extractTargets(source, selfDir, roots) {
  const { repo, biz } = roots;
  const code = stripComments(source)
    .replace(/\bpath\s*\.\s*dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)/g, "__dirname")
    .replace(/\bdirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)/g, "__dirname");

  // 1. Bind every `const NAME = join(...)` to a fixpoint, so a root const
  //    declared once can be joined onto anywhere below it.
  const env = new Map([["__dirname", selfDir]]);
  const binder = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?=(?:path\s*\.\s*)?(?:join|resolve)\s*\()/g;
  for (let pass = 0, changed = true; changed && pass < 6; pass += 1) {
    changed = false;
    binder.lastIndex = 0;
    let m;
    while ((m = binder.exec(code)) !== null) {
      const name = m[1];
      if (env.has(name)) continue;
      const call = pathCalls(code.slice(m.index)).find((c) => c.start < m[0].length + 4);
      if (!call) continue;
      const value = resolveCall(call.kind, call.body, env);
      if (value !== null && path.isAbsolute(value)) {
        env.set(name, value);
        changed = true;
      }
    }
  }

  // 1b. Bind every one-argument READER HELPER — `const read = (rel) => …join(ROOT, rel)…`
  //     or its `function` spelling. Six of the eleven live pairs route every path
  //     through one of these, so without this step the extractor sees a helper it
  //     cannot follow and reports zero targets for the file it is judging.
  //     The parameter is bound to a sentinel and the resolved path is split on it,
  //     which gets nesting (`join(REPO, join("mingla-business", rel))`) for free.
  // Written as ESCAPES, never as raw bytes: a literal NUL in the source makes the
  // whole file read as BINARY to grep and friends, and a grep-based gate that
  // silently skips a binary file is the "green because it checked nothing" mode
  // this very gate exists to prevent. The runtime value is unchanged, and NUL is
  // still the right sentinel: it cannot occur in a real path segment.
  const SENTINEL = "\u0000ARG\u0000";
  const readers = new Map();
  const declarations = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(\s*([A-Za-z_$][\w$]*)\s*(?::[^,)]*)?\)\s*(?::[^=]*?)?=>/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::[^,)]*)?\)/g,
  ];
  for (const re of declarations) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      const [name, param] = [m[1], m[2]];
      if (readers.has(name) || env.has(name)) continue;
      const body = code.slice(m.index + m[0].length, m.index + m[0].length + 400);
      const call = pathCalls(body)[0];
      if (!call) continue;
      const withArg = new Map(env);
      withArg.set(param, SENTINEL);
      const resolved = resolveCall(call.kind, call.body, withArg);
      if (resolved === null || !resolved.includes(SENTINEL)) continue;
      const prefix = resolved.slice(0, resolved.indexOf(SENTINEL));
      if (path.isAbsolute(prefix)) readers.set(name, prefix);
    }
  }

  const targets = new Set();
  const add = (abs) => {
    if (!path.isAbsolute(abs) || !SOURCE_EXT.test(abs)) return;
    const rel = toPosix(path.relative(abs.startsWith(biz + path.sep) ? biz : repo, abs));
    if (rel.startsWith("..")) return;
    targets.add(rel);
  };

  // 2. Every composed path that lands on a source file.
  for (const call of pathCalls(code)) {
    const abs = resolveCall(call.kind, call.body, env);
    if (abs !== null) add(abs);
  }

  // 2b. Every literal handed to a reader helper.
  for (const [name, prefix] of readers) {
    const re = new RegExp(`\\b${name}\\s*\\(`, "g");
    let m;
    while ((m = re.exec(code)) !== null) {
      const b = balanced(code, m.index + m[0].length - 1);
      if (!b) continue;
      const first = splitArgs(b.body)[0];
      const lit = first ? LITERAL_ONLY.exec(first) : null;
      if (lit) add(path.join(prefix, lit[2]));
    }
  }

  // 3. Every path written whole in one literal, wherever it appears in code.
  //    (Comments were stripped: a path in prose is not coverage — #1486.)
  for (const lit of stringLiterals(code)) {
    const norm = lit.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^mingla-business\//, "");
    if (PATH_SHAPE.test(norm)) targets.add(norm);
  }

  return targets;
}

// ═════════════════════════ inversion detection (R4) ═══════════════════════
//
// A hand-off is inverted when the gate fails on exactly what the test demanded.
// Both halves are read conservatively: only unambiguous presence assertions on
// the test side, and only plain-text tokens inside a failing condition on the
// gate side. A short token is ignored — the conjunction has to be specific to
// mean anything.

const MIN_TOKEN = 8;

/** Tokens the quarantined test asserts are PRESENT in its target's source. */
export function presenceTokens(testSource) {
  const code = stripComments(testSource);
  const out = new Set();
  const patterns = [
    /expect\s*\(\s*[A-Za-z_$][\w$.]*\s*\.includes\s*\(\s*(["'])((?:[^\\]|\\.)*?)\1\s*\)\s*\)\s*\.toBe\s*\(\s*true\s*\)/g,
    /\.toContain\s*\(\s*(["'])((?:[^\\]|\\.)*?)\1\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) {
      const tok = m[2];
      if (tok.length >= MIN_TOKEN && !PATH_SHAPE.test(tok)) out.add(tok);
    }
  }
  return out;
}

/** Split a regex source on top-level `|`. */
function alternatives(src) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === "\\") {
      cur += c + (src[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (c === "(" || c === "[") depth += 1;
    if (c === ")" || c === "]") depth -= 1;
    if (c === "|" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Only alternatives that are plain text — anything with metacharacters is dropped. */
function plainAlternatives(regexSource) {
  return alternatives(regexSource)
    .map((a) => a.replace(/^\^|\$$/g, "").replace(/\\([.\-/])/g, "$1"))
    .filter((a) => a.length >= MIN_TOKEN && !/[\\[\](){}*+?^$|]/.test(a));
}

/**
 * Tokens the gate fails on FINDING — i.e. tokens it requires to be ABSENT.
 * A condition is only read this way when it is not negated and its block pushes
 * a failure.
 */
export function forbiddenTokens(gateSource) {
  const code = stripComments(gateSource);
  const out = new Set();
  const re = /\bif\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const b = balanced(code, m.index + m[0].length - 1);
    if (!b) continue;
    const after = code.slice(b.end, b.end + 500);
    if (!/\b(?:push|fail)\s*\(/.test(after)) continue;

    // Negation is read PER SUB-TERM, not per condition. The common house shape is
    //   if (block === null || !block.includes("X") || !block.includes("Y"))
    // whose leading character is not `!` even though every token in it is a
    // must-be-PRESENT rule. Reading the whole condition as positive there turns
    // ordinary style checks into fake "inversions" (measured on orch-0974).
    for (const term of booleanTerms(b.body)) {
      if (/^\s*!/.test(term)) continue;
      for (const lit of stringLiterals(term)) {
        if (lit.length >= MIN_TOKEN && !PATH_SHAPE.test(lit)) out.add(lit);
      }
      const reLit = /\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/[gimsuy]*/g;
      let r;
      while ((r = reLit.exec(term)) !== null) {
        for (const alt of plainAlternatives(r[1])) out.add(alt);
      }
    }
  }
  return out;
}

/** Split a condition on top-level `||` / `&&`, outside strings and brackets. */
function booleanTerms(cond) {
  const out = [];
  let depth = 0;
  let cur = "";
  let quote = null;
  for (let i = 0; i < cond.length; i += 1) {
    const c = cond[i];
    if (quote) {
      cur += c;
      if (c === "\\") {
        cur += cond[i + 1] ?? "";
        i += 1;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    if (c === ")" || c === "]" || c === "}") depth -= 1;
    if (depth === 0 && (c === "|" || c === "&") && cond[i + 1] === c) {
      out.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

// ═════════════════════════════ ledger parsing ═════════════════════════════

/**
 * Parse the #1047 block into annotated entries. Returns `{ error }` on a shape
 * this cannot read, rather than guessing.
 */
export function parseLedger(configText) {
  const startIdx = configText.indexOf(BLOCK_MARKER);
  if (startIdx === -1) {
    return {
      error:
        `V-MARKER: the "${BLOCK_MARKER}" marker is not in mingla-business/jest.config.cjs. ` +
        "This gate reads that block; keep the marker or update the gate in the same PR.",
    };
  }
  const after = configText.slice(startIdx);
  const closeRel = after.search(/\n\s*\],/);
  if (closeRel === -1) {
    return { error: "V-MARKER: could not find the end of testPathIgnorePatterns after the #1047 marker." };
  }
  const lines = after.slice(0, closeRel).split("\n");

  const entries = [];
  let current = null; // the entry whose ledger lines we are still collecting
  let lastKey = null;

  const ENTRY = /^\s*("(?:[^"\\]|\\.)*")\s*,\s*\/\/\s*invariant\s*->\s*(?:.*?\s)?([\w.-]+\.mjs)\s*$/;
  // The separator is REQUIRED. With it optional, any prose line that merely BEGINS
  // with one of these words — "dropped and needs no drop line: …" inside a note —
  // parsed as a ledger line and invented a bogus dropped path. Caught by this gate
  // failing on its own backfill while #1850 TEST P2-8 was being written; a keyword
  // is only a keyword when it is followed by `:` (or `->`, for an inversion).
  const LEDGER = /^\s*\/\/\s*(moved|dropped|note)\s*:\s*(.*)$/;
  const INVERTED = /^\s*\/\/\s*inverted\s*(?:->|:)\s*(.*)$/;
  const CONT = /^\s*\/\/\s{2,}(\S.*)$/;

  for (const line of lines) {
    const e = ENTRY.exec(line);
    if (e) {
      let pattern;
      try {
        pattern = JSON.parse(e[1]);
      } catch {
        return { error: `V-MARKER: could not decode quarantine pattern token ${e[1]}.` };
      }
      current = { pattern, gateName: e[2], moved: [], dropped: [], raw: line };
      entries.push(current);
      lastKey = null;
      continue;
    }
    if (current === null) continue;

    const cont = CONT.exec(line);
    if (cont && lastKey !== null) {
      const list = lastKey === "moved" ? current.moved : current.dropped;
      if (list.length > 0 && lastKey === "dropped") {
        list[list.length - 1].reason += ` ${cont[1].trim()}`;
        current.raw += `\n${line}`;
        continue;
      }
      if (lastKey === "moved") {
        for (const p of cont[1].split(",").map((s) => s.trim()).filter(Boolean)) current.moved.push(p);
        current.raw += `\n${line}`;
        continue;
      }
    }

    const inv = INVERTED.exec(line);
    if (inv) {
      current.raw += `\n${line}`;
      lastKey = null;
      continue;
    }

    const l = LEDGER.exec(line);
    if (!l) {
      // A code line (or a blank/prose line) ends this entry's ledger.
      if (/^\s*"/.test(line)) current = null;
      lastKey = null;
      continue;
    }
    current.raw += `\n${line}`;
    const [, key, rest] = l;
    if (key === "moved") {
      for (const p of rest.split(",").map((s) => s.trim()).filter(Boolean)) current.moved.push(p);
      lastKey = "moved";
    } else if (key === "dropped") {
      const split = rest.split(/\s+—\s+|\s+--\s+/);
      current.dropped.push({ path: (split[0] ?? "").trim(), reason: split.slice(1).join(" — ").trim() });
      lastKey = "dropped";
    } else {
      // `note:` — free prose for a human. Deliberately contributes NOTHING to any
      // rule, and its continuation lines are not collected, so nothing written here
      // can widen or narrow coverage.
      lastKey = null;
    }
  }

  for (const entry of entries) {
    entry.declaresInversion = /\bDECOMMISSIONED\b|\binverted\s*->/.test(entry.raw);
    entry.moved = entry.moved.map((p) => p.replace(/,$/, ""));
  }
  return { entries };
}

// ═════════════════════════════════ the check ══════════════════════════════

/**
 * `model`:
 *   configText  — mingla-business/jest.config.cjs source
 *   roots       — { repo, biz } absolute roots used to relativise targets
 *   testsFor    — Map<patternSource, Array<{ rel, dir, source }>> (source may be null)
 *   gates       — Map<gateName, { onDisk, source, dir, enforcement }>
 *
 * Returns { code, failures }: 0 clean, 1 rule violation, 2 vacuous/unreadable.
 */
export function run({ configText, roots, testsFor, gates }) {
  const parsed = parseLedger(configText);
  if (parsed.error) return { code: 2, failures: [parsed.error] };
  const { entries } = parsed;

  if (entries.length < MIN_ENTRIES) {
    return {
      code: 2,
      failures: [
        `V-ENTRIES: parsed ${entries.length} annotated hand-off entr${entries.length === 1 ? "y" : "ies"} ` +
          `from the #1047 block, floor is ${MIN_ENTRIES}. A scan that found (almost) nothing passes ` +
          "no matter what the hand-offs look like. Either the block shape changed or the parser broke — " +
          "an empty scan is red, never green.",
      ],
    };
  }

  const failures = [];
  const hard = [];

  for (const entry of entries) {
    const label = `${entry.pattern} -> ${entry.gateName}`;
    const gate = gates.get(entry.gateName);

    // ---- R1: the named gate is real and live -----------------------------
    if (!gate || !gate.onDisk) {
      hard.push(
        `${label}: the named gate does NOT EXIST on disk. The quarantine excludes those tests on ` +
          "the promise that this gate enforces their invariant; the gate is gone, so nothing does. " +
          "A missing target is exit 2, never a skip (#1559).",
      );
      continue;
    }
    if (typeof gate.source !== "string") {
      hard.push(`V-UNREADABLE: ${entry.gateName} could not be read, so no verdict about ${label} is trustworthy.`);
      continue;
    }
    if (!gate.enforcement) {
      failures.push(
        `${label}: ${entry.gateName} has no MANIFEST.json gates[] row. An unregistered gate is ` +
          "outside the parity ratchet and outside every batch — the invariant was handed to nothing.",
      );
    } else if (!LIVE_ENFORCEMENT.test(gate.enforcement)) {
      failures.push(
        `${label}: ${entry.gateName} is enforcement:"${gate.enforcement}" — CI does not run it. ` +
          "An invariant handed to a gate that never executes has not been handed anywhere; " +
          "wire it (batch:/job:/external:) or stop claiming the hand-off.",
      );
    }

    // ---- resolve the quarantined test(s) ---------------------------------
    const tests = testsFor.get(entry.pattern) ?? [];
    if (tests.length === 0) {
      hard.push(
        `V-TESTS: the quarantine pattern ${entry.pattern} matches NO test file on disk. The ` +
          "annotation describes a hand-off for a file that is not there; every rule below it " +
          "would pass vacuously.",
      );
      continue;
    }
    const unreadable = tests.filter((t) => typeof t.source !== "string");
    if (unreadable.length > 0) {
      hard.push(`V-UNREADABLE: ${unreadable.map((t) => t.rel).join(", ")} could not be read (pattern ${entry.pattern}).`);
      continue;
    }

    const testTargets = new Set();
    for (const t of tests) for (const x of extractTargets(t.source, t.dir, roots)) testTargets.add(x);

    if (testTargets.size === 0 && tests.some((t) => /readFile(?:Sync)?\s*\(/.test(t.source))) {
      hard.push(
        `V-TARGETS: ${tests.map((t) => t.rel).join(", ")} reads source files but the extractor found ` +
          "ZERO targets in it. The extractor did not observe the file it is judging, so ⊆ would be " +
          "vacuously true. Teach the extractor the path shape it missed — do not leave this green.",
      );
      continue;
    }

    const gateTargets = extractTargets(gate.source, gate.dir, roots);
    const droppedPaths = new Set(entry.dropped.map((d) => d.path));

    // ---- R2: the ledger reconciles ---------------------------------------
    const residue = [...testTargets].filter((t) => !gateTargets.has(t) && !droppedPaths.has(t));
    if (residue.length > 0) {
      failures.push(
        `${label}: ${residue.length} of ${testTargets.size} file(s) the quarantined test described are ` +
          `covered by NOTHING and declared nowhere:\n      ${residue.join("\n      ")}\n    ` +
          "Either the gate must read them, or the annotation must carry `// dropped: <path> — <reason " +
          "naming the successor>`. Silence is what #1850 was.",
      );
    }

    // ---- R2b: the ledger may not overstate either -------------------------
    for (const p of entry.moved) {
      if (!gateTargets.has(p)) {
        failures.push(
          `${label}: the ledger says \`moved: ${p}\` but ${entry.gateName} never reads that file. ` +
            "A move that did not happen is exactly the claim this gate exists to test.",
        );
      }
    }
    for (const p of [...entry.moved, ...droppedPaths]) {
      if (!testTargets.has(p)) {
        failures.push(
          `${label}: the ledger names ${p}, which the quarantined test never targeted. A ledger ` +
            "entry for a file nobody read is decoration, and padding the dropped list is how ⊆ gets faked.",
        );
      }
    }

    // ---- R3: every drop names a successor ---------------------------------
    for (const d of entry.dropped) {
      if (d.reason.length < MIN_REASON || !SUCCESSOR.test(d.reason)) {
        failures.push(
          `${label}: \`dropped: ${d.path}\` has no usable reason ("${d.reason}"). A drop must say why, ` +
            `in at least ${MIN_REASON} characters, and name its successor — a *.mjs gate, a #issue, or ` +
            "DECOMMISSIONED. A bare drop is a coverage loss with a comment on it.",
        );
      }
    }

    // ---- R4: an inverted hand-off must declare itself ---------------------
    if (!entry.declaresInversion) {
      const forbidden = forbiddenTokens(gate.source);
      const present = new Set();
      for (const t of tests) for (const tok of presenceTokens(t.source)) present.add(tok);
      const inverted = [...present].filter((tok) => forbidden.has(tok));
      if (inverted.length > 0) {
        failures.push(
          `${label}: INVERTED hand-off. ${entry.gateName} FAILS when these are present, and the ` +
            `quarantined test required them present: ${inverted.map((t) => JSON.stringify(t)).join(", ")}. ` +
            "That is a 180° reversal recorded as a re-homing. If the feature was decommissioned say so " +
            "(`DECOMMISSIONED`), and account separately for any rule of the test that still holds.",
        );
      } else if (gateTargets.size > 0 && [...testTargets].every((t) => !gateTargets.has(t))) {
        failures.push(
          `${label}: ${entry.gateName} shares ZERO target files with the quarantined test. It is not ` +
            "the invariant's new home — it is a different feature's gate. Name the real successor, or " +
            "declare DECOMMISSIONED.",
        );
      }
    }
  }

  if (hard.length > 0) return { code: 2, failures: hard };
  return { code: failures.length > 0 ? 1 : 0, failures };
}

// ═══════════════════════════════ self-test ════════════════════════════════
if (IS_MAIN && SELF_TEST) {
  const ROOTS = { repo: "/virt", biz: "/virt/mingla-business" };
  const TDIR = "/virt/mingla-business/src/wrappers/__tests__";
  const GDIR = "/virt/.github/scripts/strict-grep";

  // A miniature of the real #1850 pair: a test naming 17 files, a gate naming 6.
  const MOVED = [
    "app/_layout.tsx",
    "src/components/ui/SheetMobile.tsx",
    "src/components/ui/Modal.tsx",
    "src/components/auth/BusinessWelcomeScreen.tsx",
    "src/components/waitlist/JoinWaitlistSheet.tsx",
    "src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
  ];
  const DARK = [
    "src/components/groupChat/GroupChatPanel.tsx",
    "src/components/support/SupportThread.native.tsx",
    "src/screens/ari/AriChatScreen.tsx",
    "app/checkout/[eventId]/buyer.tsx",
    "app/checkout/[eventId]/payment.tsx",
    "app/checkout-trip/[tripEventId]/buyer.tsx",
    "app/checkout-trip/[tripEventId]/intake.tsx",
    "app/checkout-trip/[tripEventId]/payment.tsx",
    "app/checkout-experience/[experienceEventId]/buyer.tsx",
    "app/checkout-experience/[experienceEventId]/payment.tsx",
    "src/components/brand/BrandPaystackOnboardView.tsx",
  ];
  const testSrc = [
    'import { readFileSync } from "node:fs";',
    'const read = (rel) => readFileSync(join(BIZ, rel), "utf8");',
    ...[...MOVED, ...DARK].map((p) => `read(${JSON.stringify(p)});`),
  ].join("\n");
  const gateSrc = ['import fs from "node:fs";', ...MOVED.map((p) => `read(${JSON.stringify(p)});`)].join("\n");

  const PAT = "orch_1165_keyboard_toolbar_mount_coverage\\\\.test\\\\.ts$";
  const patJson = JSON.stringify("orch_1165_keyboard_toolbar_mount_coverage\\.test\\.ts$");

  /** Build a config whose #1047 block holds `n` filler entries plus the given ones. */
  const mkConfig = (entryLines, n = MIN_ENTRIES + 2) => {
    const filler = [];
    for (let i = 0; i < n; i += 1) filler.push(`    "filler${i}\\\\.test\\\\.ts$", // invariant -> filler.mjs`);
    return [
      "module.exports = {",
      "  testPathIgnorePatterns: [",
      `    // ${BLOCK_MARKER}`,
      ...filler,
      ...entryLines,
      "  ],",
      "};",
    ].join("\n");
  };

  const fillerTest = 'import { readFileSync } from "node:fs";\nread("src/filler.ts");';
  const fillerGate = 'read("src/filler.ts");';

  const mkModel = (entryLines, fillerCount = MIN_ENTRIES + 2) => {
    const testsFor = new Map([[JSON.parse(patJson), [{ rel: "…/orch_1165….test.ts", dir: TDIR, source: testSrc }]]]);
    const gates = new Map([
      ["i-1047-biz-keyboard-toolbar-keyed-offset.mjs", { onDisk: true, source: gateSrc, dir: GDIR, enforcement: "batch:A" }],
      ["filler.mjs", { onDisk: true, source: fillerGate, dir: GDIR, enforcement: "batch:A" }],
    ]);
    for (let i = 0; i < fillerCount; i += 1) {
      testsFor.set(`filler${i}\\.test\\.ts$`, [{ rel: `filler${i}.test.ts`, dir: TDIR, source: fillerTest }]);
    }
    return { configText: mkConfig(entryLines, fillerCount), roots: ROOTS, testsFor, gates };
  };

  const CLEAN_LEDGER = [
    `    ${patJson}, // invariant -> i-1047-biz-keyboard-toolbar-keyed-offset.mjs`,
    `    // moved: ${MOVED.join(", ")}`,
    ...DARK.map((p) => `    // dropped: ${p} — re-homed by orch-0892-no-bespoke-keyboard-plumbing.mjs, see #1850`),
  ];

  const problems = [];
  const check = (label, model, wantCode, wantText) => {
    const r = run(model);
    if (r.code !== wantCode) {
      problems.push(`${label}: expected exit ${wantCode}, got ${r.code} — ${r.failures.join(" | ")}`);
      return;
    }
    if (wantText && !r.failures.some((f) => f.includes(wantText))) {
      problems.push(`${label}: failure did not mention "${wantText}" — ${r.failures.join(" | ")}`);
    }
  };

  // 1 — a complete ledger passes.
  check("1 clean ledger", mkModel(CLEAN_LEDGER), 0);

  // 2 — THE #1850 DEFECT ITSELF: gate covers 6 of 17 targets and there is no
  //     ledger at all. Must be RED and must name every dark file.
  {
    const r = run(mkModel([`    ${patJson}, // invariant -> i-1047-biz-keyboard-toolbar-keyed-offset.mjs`]));
    if (r.code !== 1) problems.push(`2 the #1850 defect: expected exit 1, got ${r.code}`);
    const text = r.failures.join("\n");
    const unnamed = DARK.filter((p) => !text.includes(p));
    if (unnamed.length > 0) problems.push(`2 the #1850 defect: failure did not name ${unnamed.join(", ")}`);
    if (!text.includes(`11 of 17`)) problems.push(`2 the #1850 defect: did not report 11 of 17 — ${text}`);
  }

  // 3 — one file neither moved nor dropped.
  check(
    "3 one file unaccounted for",
    mkModel(CLEAN_LEDGER.filter((l) => !l.includes("AriChatScreen"))),
    1,
    "src/screens/ari/AriChatScreen.tsx",
  );

  // 4 — a drop with no reason.
  check(
    "4 bare drop",
    mkModel(CLEAN_LEDGER.map((l) => (l.includes("GroupChatPanel") ? "    // dropped: src/components/groupChat/GroupChatPanel.tsx" : l))),
    1,
    "no usable reason",
  );

  // 5 — the named gate is absent from disk ⇒ exit 2, never a skip.
  {
    const m = mkModel(CLEAN_LEDGER);
    m.gates.set("i-1047-biz-keyboard-toolbar-keyed-offset.mjs", { onDisk: false, source: null, dir: GDIR, enforcement: null });
    check("5 gate missing from disk", m, 2, "does NOT EXIST on disk");
  }

  // 6 — the gate exists but CI does not run it.
  {
    const m = mkModel(CLEAN_LEDGER);
    m.gates.get("i-1047-biz-keyboard-toolbar-keyed-offset.mjs").enforcement = "unenforced";
    check("6 gate unenforced", m, 1, 'enforcement:"unenforced"');
  }

  // 7 — R4: the gate forbids what the test required, with no declaration.
  {
    const invertedTest =
      'import { readFileSync } from "node:fs";\n' +
      'const source = readFileSync(join(__dirname, "..", "VenueIntelligenceModule.tsx"), "utf8");\n' +
      'expect(source.includes("Customers your ads drove")).toBe(true);';
    const invertedGate =
      'read("src/components/venue/VenueIntelligenceModule.tsx");\n' +
      "if (/Customers your ads drove|useBrandConversionRollup/.test(venue)) {\n" +
      '  failures.push("obsolete brand ad tile remains");\n}';
    const m = mkModel([`    ${patJson}, // invariant -> i-1047-biz-keyboard-toolbar-keyed-offset.mjs`]);
    m.testsFor.set(JSON.parse(patJson), [
      { rel: "src/components/venue/__tests__/venueAdsDrivenTile.test.ts", dir: "/virt/mingla-business/src/components/venue/__tests__", source: invertedTest },
    ]);
    m.gates.get("i-1047-biz-keyboard-toolbar-keyed-offset.mjs").source = invertedGate;
    check("7 inverted hand-off undeclared", m, 1, "INVERTED hand-off");

    // …and declaring it clears R4 (the drop still has to be declared).
    const m2 = mkModel([
      `    ${patJson}, // invariant -> i-1047-biz-keyboard-toolbar-keyed-offset.mjs`,
      "    // moved: src/components/venue/VenueIntelligenceModule.tsx",
      "    // note: DECOMMISSIONED — the tile was removed by #1403; the gate enforces its absence",
    ]);
    m2.testsFor.set(JSON.parse(patJson), [
      { rel: "src/components/venue/__tests__/venueAdsDrivenTile.test.ts", dir: "/virt/mingla-business/src/components/venue/__tests__", source: invertedTest },
    ]);
    m2.gates.get("i-1047-biz-keyboard-toolbar-keyed-offset.mjs").source = invertedGate;
    check("7b declared inversion passes", m2, 0);
  }

  // 8 — zero entries parsed ⇒ exit 2 VACUOUS. An empty scan is never green.
  check("8 empty scan is VACUOUS", mkModel([], 0), 2, "V-ENTRIES");

  // 9 — the test reads files but the extractor sees nothing ⇒ exit 2.
  {
    const m = mkModel(CLEAN_LEDGER);
    m.testsFor.set(JSON.parse(patJson), [
      { rel: "opaque.test.ts", dir: TDIR, source: 'const p = resolveSomehow();\nreadFileSync(p, "utf8");' },
    ]);
    check("9 extractor blind to its own subject", m, 2, "V-TARGETS");
  }

  // 10 — a path mentioned only in a COMMENT in the gate is not coverage.
  {
    const m = mkModel(CLEAN_LEDGER.filter((l) => !l.includes("AriChatScreen")));
    m.gates.get("i-1047-biz-keyboard-toolbar-keyed-offset.mjs").source =
      `${gateSrc}\n// we also care about src/screens/ari/AriChatScreen.tsx, honest`;
    check("10 comment is not coverage", m, 1, "src/screens/ari/AriChatScreen.tsx");
  }

  // 11 — the block marker is gone ⇒ exit 2.
  check("11 marker missing", { ...mkModel(CLEAN_LEDGER), configText: "module.exports = { testPathIgnorePatterns: [\n] };" }, 2, "V-MARKER");

  // 12 — PROSE IS NOT A LEDGER LINE. A `note:` whose continuation happens to begin
  //      with the word "dropped" must not invent a drop. This fired for real on the
  //      #1850 backfill while the P2-8 correction was being written: the separator
  //      was optional, so "dropped and needs no drop line: …" parsed as a drop and
  //      the gate reported a bogus path. A keyword is only a keyword before `:`.
  {
    const m = mkModel([
      ...CLEAN_LEDGER,
      "    // note: the second gap is invisible here by construction, and the file is not",
      "    //   dropped and needs no drop line: the named gate reads it for other rules",
      "    //   moved somewhere else entirely, which this prose must not be read as claiming",
    ]);
    check("12 prose beginning with a keyword is not a ledger line", m, 0);
  }

  // 13 — …but a real `dropped:` line inside the same entry is still parsed.
  {
    const m = mkModel([
      ...CLEAN_LEDGER.filter((l) => !l.includes("GroupChatPanel")),
      "    // note: prose that mentions dropped files without declaring one",
      "    // dropped: src/components/groupChat/GroupChatPanel.tsx — really dropped, see #1850",
    ]);
    check("13 a real dropped: line still parses after prose", m, 0);
  }

  if (problems.length > 0) {
    console.error("\nSELF-TEST FAIL [ISSUE-1850-QUARANTINE-INVARIANT-HANDOFF-COMPLETE]:");
    for (const p of problems) console.error(`  x ${p}`);
    console.error("");
    process.exit(1);
  }
  console.log("OK [ISSUE-1850-QUARANTINE-INVARIANT-HANDOFF-COMPLETE --self-test]: 12 scenarios behaved as specified.");
  process.exit(0);
}

// ═══════════════════════════════ live run ═════════════════════════════════

function main() {
  const readOrNull = (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };

  const configText = readOrNull(JEST_CONFIG);
  if (configText === null) {
    console.error("\nFAIL [ISSUE-1850-QUARANTINE-INVARIANT-HANDOFF-COMPLETE]:");
    console.error("  x V-UNREADABLE: mingla-business/jest.config.cjs could not be read.\n");
    process.exit(2);
  }

  /** MANIFEST enforcement by gate basename. */
  const enforcementByName = new Map();
  {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    for (const g of manifest.gates ?? []) {
      if (typeof g.script === "string") enforcementByName.set(path.posix.basename(g.script), g.enforcement ?? null);
    }
  }

  /** Every jest-visible test file under mingla-business. */
  const testFiles = [];
  (function walk(dir) {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/(^|\/)__tests__\/.*\.test\.tsx?$/.test(toPosix(path.relative(BIZ, full)))) testFiles.push(full);
    }
  })(BIZ);

  const parsedForResolve = parseLedger(configText);
  const testsFor = new Map();
  const gates = new Map();
  if (!parsedForResolve.error) {
    for (const entry of parsedForResolve.entries) {
      let re;
      try {
        re = new RegExp(entry.pattern);
      } catch {
        re = null;
      }
      const matches = re
        ? testFiles
            .filter((f) => re.test(toPosix(path.relative(BIZ, f))) || re.test(toPosix(f)))
            .map((f) => ({ rel: toPosix(path.relative(BIZ, f)), dir: path.dirname(f), source: readOrNull(f) }))
        : [];
      testsFor.set(entry.pattern, matches);

      if (!gates.has(entry.gateName)) {
        const abs = path.join(HERE, entry.gateName);
        gates.set(entry.gateName, {
          onDisk: fs.existsSync(abs),
          source: readOrNull(abs),
          dir: HERE,
          enforcement: enforcementByName.get(entry.gateName) ?? null,
        });
      }
    }
  }

  const result = run({ configText, roots: { repo: REPO, biz: BIZ }, testsFor, gates });

  if (result.code !== 0) {
    console.error("\nFAIL [ISSUE-1850-QUARANTINE-INVARIANT-HANDOFF-COMPLETE]:");
    for (const f of result.failures) console.error(`  x ${f}`);
    console.error(
      "\n  Note the documented limit of this gate: it reconciles coverage at FILE level only. " +
        "A gate that reads a file and asserts one weak thing about it counts as covered here; " +
        "whether the rules kept inside a file are the load-bearing ones is still a human read.\n",
    );
    process.exit(result.code);
  }
  console.log(
    `OK [ISSUE-1850-QUARANTINE-INVARIANT-HANDOFF-COMPLETE]: ${parsedForResolve.entries?.length ?? 0} invariant ` +
      "hand-offs reconcile (targets(test) ⊆ targets(gate) ∪ declared-dropped), every named gate is live, " +
      "and every drop names a successor. FILE-level only — see this gate's header for what that cannot see.",
  );
}

if (IS_MAIN) main();
