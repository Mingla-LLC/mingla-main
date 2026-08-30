#!/usr/bin/env node
// #2492 [a migration on main fails the #1931 clean replay] — the class guard.
//
// Enforces I-PROPOSED-2492-FILTERED-REPLAY-SKIP-CLOSURE:
//
//   A CI lane that replays a FILTERED subset of the migration chain is closed
//   under its own skip list. No non-skipped migration may reference an object
//   — function, view, table or column — defined only by a skipped migration,
//   in any context PostgreSQL validates at CREATE time.
//
// WHY THIS EXISTS. Four lanes replay the migration chain deliberately WITHOUT
// one of their own migrations, so they can prove that migration changes nothing
// it should not. The `#1931` lane is the largest: it rebuilds the database
// without `#1931`, captures a reader-equality probe, applies `#1931`, and
// requires the two captures to be byte-identical. That only works if every
// later migration which RE-EMITS a `#1931`-defined object is left out too.
//
// The only thing holding that together was a hand-written `case` list and a
// comment asking future authors to remember:
//
//   # Any future migration that re-emits a #1931-defined object belongs on
//   # this list too.
//
// `20270522002462_issue_2462_checkout_determinism.sql` re-emitted
// `pg_direct_event_checkout_bundle` and nobody remembered. The lane does not
// wake on `supabase/migrations/**`, so it never ran on the PR that added it;
// it landed green and went red later, on unrelated PRs that happened to touch
// the lane's trigger paths. `main` could not pass a clean replay, and the
// from-zero replay is how a disaster-recovery environment gets rebuilt.
//
// THE BUG CLASS, WHICH IS THE POINT: a correctness rule whose only enforcement
// is a comment addressed to a future human is not enforced. It fails silently,
// on someone else's change, at a distance from the edit that broke it.
//
// WHAT IT WOULD HAVE CAUGHT. Run against `origin/main` before this commit, C-1
// reports two violations on the `#1931` lane — both faults the #2492
// investigation proved by execution against a real PostgreSQL cluster:
//
//   20270522002462_… -> fn:issue_1931_event_ordinary_read_blocked   (defined only by skipped #1931)
//   20270522002462_… -> col:multi_date_pricing_mode                 (added only by skipped #2160)
//
// PostgreSQL resolves column names before function signatures, so CI only ever
// showed the column error; the guard error was masked behind it. Both are real.
// Removing the `issue_1931_event_ordinary_read_blocked` call to green the lane
// would delete the private-event deny from a public reader — a security
// control — which is exactly what the lane's own comments forbid.
//
// ── Checks ──────────────────────────────────────────────────────────────────
//   C-1    no non-skipped migration references an object only a skipped
//          migration defines, in a create-time-validated context
//   C-2    every skip glob matches >= 1 file, evaluated against THAT LANE's
//          own case subject (see R-4)
//   C-3    the #1931 lane retains its *_issue_1931_*, *_issue_2160_* and
//          *_issue_2333_discover_online_carveout* branches
//   C-4(a) a lane whose skip construct cannot be parsed
//   C-4(c) BRANCH CENSUS. An independent count of the case region's branch
//          terminators and `continue` statements must equal the number of
//          branches the parser read. C-4(b) only catches a lane that yields
//          ZERO globs; this catches a lane that yields FEWER than it should,
//          which is the form that hides a real closure break behind it.
//   C-4(b) POSITIVE CROSS-CHECK. `continue` inside a migration apply loop is
//          detected INDEPENDENTLY of the case parse. A lane whose loop
//          contains a `continue` but from which ZERO globs were extracted is
//          an ERROR — never "unfiltered". Without this limb an unparsed lane
//          is silently analysed with an empty skip set and the guard protects
//          half of what it claims.
//   P-vac  discovering zero migrations, or zero filtered lanes, is a FAILURE.
//
// ── Lane discovery is load-bearing (R-1…R-4) ────────────────────────────────
// The four real lanes are written four different ways. A parser that assumes
// one form under-protects, and under-protection here is SILENT.
//
//   lane    loop spelling                              case subject                       globs
//   #1931   for f in $(find supabase/migrations …)     case "$f" in            full path  8
//   #2117   for f in $(find supabase/migrations …)     case "$f" in            full path  3
//   #1644   for migration in supabase/migrations/*.sql case "$(basename …)" in basename   1
//   #1647   for migration in supabase/migrations/*.sql case "$(basename …)" in basename   3 (alternation)
//
//   R-1  BOTH loop spellings. (This parser accepts the general `for VAR in
//        <words mentioning supabase/migrations>` form, which also covers the
//        third spelling in the repo, `$(ls supabase/migrations/*.sql | sort)`.
//        All 25 apply loops on this base are discovered; exactly 4 are filtered.)
//   R-2  BOTH case-subject forms, INCLUDING the nested quote in
//        `case "$(basename "$migration")" in`. MEASURED TRAP: a naive
//        `case\s+"[^"]*"\s+in` probe truncates at the inner quote, sees only
//        #1931 and #2117, and silently misses #1644 and #1647 — both of which
//        carry `continue ;;`. Two independent reviewers' classifiers hit this.
//        This parser anchors on the line-terminal ` in`, so nesting is moot.
//   R-3  ALTERNATION. One branch may carry several globs as `A|B|C)`. Read
//        one-glob-per-branch and #1647 silently under-skips two files.
//   R-5  BOTH BRANCH FORMS: `<pattern>) continue ;;` on one line, and the
//        two-line form `<pattern>)` followed by `continue ;;`. MEASURED by the
//        independent tester: an identical closure break written on one line
//        fires C-1; written across two lines it produced ZERO violations while
//        the break hid behind it. C-4(b) cannot rescue that — its trigger is
//        ZERO globs, not FEWER — so the form is parsed here and cross-checked
//        by C-4(c). Other legal sh branch spellings are #2503's systematic
//        survey; this guard owns the two-line form and the census that reds if
//        any real lane acquires a form it cannot read.
//   R-4  SUBJECT-CORRECT glob matching. Evaluate each glob against whichever
//        subject that lane uses. MEASURED: `20270221001644_*` matches 1 file
//        as a basename and 0 as a full path — matching it against full paths
//        fires C-2 on a clean repo.
//
// ── SQL parsing rules — non-negotiable ──────────────────────────────────────
// The discipline is the one proven in issue-1860-public-tables-rls-enabled.mjs.
//   * `--` and block comments are never code — INCLUDING inside a function
//     body. MEASURED: #2462 and #2160 both discuss `pg_offering_visibility_gate`
//     in `--` comments inside `LANGUAGE sql` bodies; a masker that stops at the
//     body boundary false-positives the #2117 lane twice on a clean repo.
//   * String literals are never code, in all three spellings: `'…'` (doubled
//     quotes), dollar-quoted `$tag$…$tag$`, and `E'…'` HONOURING BACKSLASH
//     ESCAPES. MEASURED: unstripped, `COMMENT ON FUNCTION … IS '…'` at
//     20270420002160_…:691 false-positives the #2117 lane.
//   * Only create-time-validated contexts flag: `LANGUAGE sql` bodies, and
//     statement level (which is where a `CREATE VIEW` body lives — a view body
//     is plain SQL, not a quoted body). A plpgsql body MUST NOT flag, and
//     neither must a `DO $$…$$` block, which is plpgsql.
//   * `check_function_bodies` is honoured: a file that has executed
//     `SET check_function_bodies = false` does not have its function bodies
//     validated at CREATE time. Exactly one file does today
//     (20260505000000_baseline_squash_orch_0729.sql:74) and it is FIRST in the
//     chain, so there is no false positive now — which is precisely why it
//     would be missed. Statement level is still checked in such a file: the
//     flag governs function bodies only.
//   * A `CREATE OR REPLACE` is a DEFINITION, not a self-reference. MEASURED:
//     without this, #2462 self-reports on `issue_1930_ticket_checkout_create_session_base`,
//     which it defines itself.
//   * Anything unresolvable fails closed — a `CREATE FUNCTION` whose LANGUAGE
//     cannot be resolved is a violation, not a skipped body.
//
// ── Declared residual limits ────────────────────────────────────────────────
//   (a) SIGNATURE / OVERLOAD DRIFT. C-1 keys on object NAMES. An overload
//       added only by a skipped migration is not the same as an absent name
//       and is not detected.
//   (b) THE REMOVAL DIRECTION. Nothing here catches a re-emission that
//       REMOVES a control an earlier migration installed. #2492 is a
//       reference ADDED; the removal direction is #2499, deliberately out of
//       scope. The two must not be merged.
//   (c) Statement-level references are flagged whether or not the statement
//       carries `IF EXISTS`. This errs toward failing closed on purpose: the
//       remedy for a flag is always ADDITIVE (put the file on the lane's skip
//       list), never weakening a check.
//
// This guard may not read, write or execute a database, and modifies no file.
//
// Modes:
//   node issue-2492-replay-skip-closure.mjs                     — enforce
//   node issue-2492-replay-skip-closure.mjs --self-test         — prove it detects (M-1…M-8)
//   node issue-2492-replay-skip-closure.mjs --workflows-dir=P --migrations-dir=Q

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export const DEFAULT_WORKFLOWS_DIR = path.join(REPO_ROOT, ".github/workflows");
export const DEFAULT_MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase/migrations");

/** The lane whose skip list C-3 pins, and the branches it must keep. */
const PINNED_LANE = "issue-1931-private-event-access.yml";
const PINNED_BRANCHES = [
  "*_issue_1931_*",
  "*_issue_2160_*",
  "*_issue_2333_discover_online_carveout*",
  // #2723: pin the known exact overload dependency. This is intentionally
  // narrower than a generalized signature parser, whose absence remains a
  // declared limit of this guard.
  "*20270601002696_issue_2696_event_scoped_session_lookup.sql",
];

// ---------------------------------------------------------------------------
// SQL lexing. Everything here exists to stop a regex reading DDL out of prose.
// ---------------------------------------------------------------------------

const DOLLAR_TAG_RE = /^\$[A-Za-z_0-9]*\$/;

function blankRange(chars, from, to) {
  for (let k = from; k < to; k++) if (chars[k] !== "\n") chars[k] = " ";
}

/**
 * Is the quote at `quoteIdx` the opening quote of an ESCAPE string, `E'…'`?
 * Only that form honours backslash escapes, so only that form can end
 * somewhere other than the next undoubled quote. The `E` must be a standalone
 * prefix, not the tail of an identifier. `U&'…'` deliberately needs no
 * handling: it doubles quotes exactly like an ordinary literal.
 */
function isEscapeString(text, quoteIdx) {
  const prev = text[quoteIdx - 1];
  if (prev !== "E" && prev !== "e") return false;
  const before = text[quoteIdx - 2];
  return before === undefined || !/[A-Za-z0-9_$]/.test(before);
}

/** End offset (exclusive) of the single-quoted literal opening at `start`. */
function endOfSingleQuoted(sql, start) {
  const honoursBackslash = isEscapeString(sql, start);
  let j = start + 1;
  while (j < sql.length) {
    if (honoursBackslash && sql[j] === "\\") { j += 2; continue; }
    if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
    if (sql[j] === "'") return j + 1;
    j++;
  }
  return sql.length;
}

/**
 * Replace `--` line comments and C-style block comments with spaces,
 * preserving byte offsets. Literals and dollar-quoted bodies are stepped OVER,
 * not removed — `segment()` decides what to do with a dollar-quoted body, and
 * a `--` inside a literal is not a comment.
 */
export function maskComments(sql) {
  const out = Array.from(sql);
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      blankRange(out, i, end);
      i = end;
    } else if (two === "/*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql.slice(j, j + 2) === "/*") { depth++; j += 2; }
        else if (sql.slice(j, j + 2) === "*/") { depth--; j += 2; }
        else j++;
      }
      blankRange(out, i, j);
      i = j;
    } else if (sql[i] === "'") {
      i = endOfSingleQuoted(sql, i);
    } else if (sql[i] === "$") {
      const m = DOLLAR_TAG_RE.exec(sql.slice(i));
      if (!m) { i++; continue; }
      const end = sql.indexOf(m[0], i + m[0].length);
      i = end === -1 ? sql.length : end + m[0].length;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** `text` with every string literal and dollar-quoted body blanked out. */
export function maskStringLiterals(text) {
  const chars = Array.from(text);
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      const end = endOfSingleQuoted(text, i);
      blankRange(chars, i, end);
      i = end;
      continue;
    }
    if (text[i] === "$") {
      const m = DOLLAR_TAG_RE.exec(text.slice(i));
      if (m) {
        const close = text.indexOf(m[0], i + m[0].length);
        const end = close === -1 ? text.length : close + m[0].length;
        blankRange(chars, i, end);
        i = end;
        continue;
      }
    }
    i++;
  }
  return chars.join("");
}

/**
 * Split comment-masked SQL into the statement-level text (every literal and
 * dollar-quoted body blanked, offsets preserved) and the dollar-quoted regions
 * with their content. A `CREATE VIEW` body is NOT a quoted body — it is plain
 * SQL and therefore already inside `top`, which is exactly right: it is
 * validated at CREATE time.
 */
export function segment(sql) {
  const top = Array.from(sql);
  const regions = [];
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const end = endOfSingleQuoted(sql, i);
      blankRange(top, i, end);
      i = end;
      continue;
    }
    if (sql[i] === "$") {
      const m = DOLLAR_TAG_RE.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? sql.length : close + tag.length;
        regions.push({ start: i, end, inner: sql.slice(i + tag.length, close === -1 ? sql.length : close) });
        blankRange(top, i, end);
        i = end;
        continue;
      }
    }
    i++;
  }
  return { top: top.join(""), regions };
}

// ---------------------------------------------------------------------------
// Migration parsing — definitions, and the identifiers a file actually
// references in a create-time-validated context.
// ---------------------------------------------------------------------------

const IDENT = '(?:"[^"]+"|[A-Za-z_][A-Za-z_0-9$]*)';
const QUALIFIED = `(?:${IDENT}\\.)?${IDENT}`;

/** Last component of a possibly-qualified, possibly-quoted name, lowercased. */
function bareName(raw) {
  const parts = raw.replace(/"/g, "").split(".");
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Parse one migration. Returns the definitions it makes and the set of
 * identifiers it references in create-time-validated contexts.
 *
 * `unresolved` is non-empty when a `CREATE FUNCTION`'s LANGUAGE cannot be
 * resolved — that fails closed rather than silently skipping the body.
 */
export function parseMigration(name, rawSql) {
  const masked = maskComments(rawSql);
  const { top, regions } = segment(masked);
  const unresolved = [];

  // `SET check_function_bodies = false` disables CREATE-time validation of
  // function bodies for the rest of the session. Statement level is unaffected.
  const bodiesUnchecked = /\bSET\s+check_function_bodies\s*(?:=|\bTO\b)\s*(?:false|off|'off'|0)\b/i.test(top);

  const sqlBodies = [];
  for (const region of regions) {
    // Widen to the enclosing statement: the text between the previous and the
    // next top-level `;`. LANGUAGE may sit before or after the body.
    const openIdx = top.lastIndexOf(";", region.start);
    const start = openIdx === -1 ? 0 : openIdx + 1;
    const closeIdx = top.indexOf(";", region.end);
    const end = closeIdx === -1 ? top.length : closeIdx;
    const statement = `${top.slice(start, region.start)} ${top.slice(region.end, end)}`;

    if (!/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(statement)) {
      // Not a routine body: a `DO $$…$$` block (plpgsql, not CREATE-time
      // validated) or a dollar-quoted string literal. Neither flags.
      continue;
    }
    const lang = /\bLANGUAGE\s+"?([A-Za-z_][A-Za-z_0-9]*)"?/i.exec(statement);
    if (!lang) {
      unresolved.push(
        `${name}: CREATE FUNCTION/PROCEDURE near offset ${region.start} has no resolvable LANGUAGE clause. ` +
          `Unresolvable input fails closed — this guard will not guess whether the body is CREATE-time validated.`,
      );
      continue;
    }
    if (lang[1].toLowerCase() === "sql") {
      // Comments and literals inside the body are not code either.
      sqlBodies.push(maskStringLiterals(maskComments(region.inner)));
    }
  }

  const definitions = new Set();
  let m;
  const fnRe = new RegExp(`\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})`, "gi");
  while ((m = fnRe.exec(top))) definitions.add(`fn:${bareName(m[1])}`);
  const viewRe = new RegExp(`\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})`, "gi");
  while ((m = viewRe.exec(top))) definitions.add(`view:${bareName(m[1])}`);
  const tableRe = new RegExp(`\\bCREATE\\s+(?:UNLOGGED\\s+|TEMP\\s+|TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})`, "gi");
  while ((m = tableRe.exec(top))) definitions.add(`table:${bareName(m[1])}`);
  const colRe = new RegExp(
    `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${QUALIFIED}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`,
    "gi",
  );
  while ((m = colRe.exec(top))) definitions.add(`col:${bareName(m[1])}`);

  // Every identifier this file mentions where PostgreSQL resolves names at
  // CREATE time. Lowercased: unquoted SQL identifiers are case-insensitive.
  const referenced = new Set();
  const scanned = bodiesUnchecked ? [top] : [top, ...sqlBodies];
  for (const region of scanned) {
    const idRe = /[A-Za-z_][A-Za-z_0-9$]*/g;
    let hit;
    while ((hit = idRe.exec(region))) referenced.add(hit[0].toLowerCase());
  }

  return { name, definitions, referenced, bodiesUnchecked, unresolved };
}

// ---------------------------------------------------------------------------
// Lane discovery. R-1…R-4 and C-4(a)/(b) live here.
// ---------------------------------------------------------------------------

/** Blank out whole-line `#` comments (YAML comments AND shell comments). */
function stripHashComments(text) {
  return text.split("\n").map((line) => (/^\s*#/.test(line) ? "" : line)).join("\n");
}

/** Shell glob -> anchored RegExp. `*` spans anything, `?` one character. */
export function globToRegExp(glob) {
  const body = Array.from(glob)
    .map((c) => (c === "*" ? ".*" : c === "?" ? "." : /[.^$+(){}[\]\\|]/.test(c) ? `\\${c}` : c))
    .join("");
  return new RegExp(`^${body}$`);
}

/**
 * C-4(c) — the branch census. Counts a `case` region's branch terminators and
 * its `continue` statements WITHOUT consulting the branch parser, so the parser
 * can be checked against them.
 *
 * C-4(b) only catches a lane that yields ZERO globs. A lane with four readable
 * branches and one the parser cannot read still yields globs, so C-4(b) stays
 * quiet while the guard's model of the skip list is short an entry — and the
 * unseen skip's definitions are then credited to the filtered chain, so a real
 * closure break behind it is never flagged. Measured by the independent tester:
 * the identical break written on one line fires C-1; written across two lines
 * it produced ZERO violations. Under-counting must be detectable, not just
 * zero-counting.
 */
function branchCensus(regionLines) {
  return {
    terminators: regionLines.join("\n").split(/;;&?/).length - 1,
    continues: regionLines.filter((l) => /(?:^|[\s;&|(])continue(?:[\s;&|)]|$)/.test(l)).length,
  };
}

/**
 * Find every migration apply loop in a workflow, and for each one extract the
 * skip globs plus the two fail-closed signals C-4(a) and C-4(b).
 */
export function discoverLanes(workflowName, rawYaml) {
  const lines = stripHashComments(rawYaml).split("\n");
  const lanes = [];

  for (let i = 0; i < lines.length; i++) {
    const header = /^(\s*)for\s+([A-Za-z_][A-Za-z_0-9]*)\s+in\s+(.*)$/.exec(lines[i]);
    if (!header) continue;
    const [, indent, loopVar, words] = header;
    // R-1 — accept every loop spelling by keying on the directory, not the
    // command that produces the list.
    if (!/supabase\/migrations/.test(words)) continue;
    // A loop over the SQL contract tests is not a migration apply loop.
    if (/supabase\/migrations\/__tests__/.test(words)) continue;

    const lane = {
      workflow: workflowName,
      line: i + 1,
      loopVar,
      subjectKind: null,
      globs: [],
      branchCount: 0,
      hasContinue: false,
      census: null,
      parseErrors: [],
    };

    let end = lines.findIndex((l, idx) => idx > i && new RegExp(`^${indent}done\\b`).test(l));
    if (end === -1) end = lines.findIndex((l, idx) => idx > i && /^\s*done\b/.test(l));
    if (end === -1) {
      lane.parseErrors.push(
        `${workflowName}:${i + 1}: migration apply loop is never terminated by \`done\` — its body cannot be bounded.`,
      );
      lanes.push(lane);
      continue;
    }

    const body = lines.slice(i, end + 1);
    // C-4(b) — detected INDEPENDENTLY of the case parse, on purpose.
    lane.hasContinue = body.some((l) => /(?:^|[\s;&|(])continue(?:[\s;&|)]|$)/.test(l));

    const caseIdx = body.findIndex((l) => /^\s*case\s+.+\s+in\s*$/.test(l));
    if (caseIdx !== -1) {
      // R-2 — anchoring on the line-terminal ` in` reads BOTH subject forms,
      // including the nested quote in `case "$(basename "$migration")" in`.
      const subject = /^\s*case\s+(.+)\s+in\s*$/.exec(body[caseIdx])[1];
      if (/\bbasename\b/.test(subject)) lane.subjectKind = "basename";
      else if (new RegExp(`\\$\\{?${loopVar}\\b`).test(subject)) lane.subjectKind = "path";
      else {
        lane.parseErrors.push(
          `${workflowName}:${i + 1 + caseIdx}: cannot resolve the case subject \`${subject.trim()}\` to a full path ` +
            `or a basename, so glob matching would be guesswork (R-4). Unresolvable input fails closed.`,
        );
      }

      const esacIdx = body.findIndex((l, idx) => idx > caseIdx && /^\s*esac\s*$/.test(l));
      if (esacIdx === -1) {
        lane.parseErrors.push(
          `${workflowName}:${i + 1 + caseIdx}: \`case\` is never closed by \`esac\` inside the apply loop — ` +
            `the skip construct cannot be parsed.`,
        );
      } else {
        const region = body.slice(caseIdx + 1, esacIdx);
        // C-4(c) — counted from the raw region, INDEPENDENTLY of the branch
        // parse below, exactly as C-4(b) counts `continue` independently of the
        // case parse. This is what makes UNDER-counting detectable.
        lane.census = branchCensus(region);
        if (lane.subjectKind) {
          for (let b = 0; b < region.length; b++) {
            let patterns = null;
            const inline = /^\s*\(?\s*([^)]*?)\s*\)\s*continue\s*;;/.exec(region[b]);
            if (inline) {
              patterns = inline[1];
            } else {
              // R-5 — the two-line branch form. `<pattern>)` alone on its line,
              // `continue ;;` on the next. Legal sh, skipped by the real lane,
              // and invisible to a one-line branch regex. A lane carrying one
              // of these alongside readable branches still yields globs, so
              // C-4(b) cannot catch it — which is why it is parsed here AND
              // cross-checked by C-4(c).
              const header = /^\s*\(?\s*([^)]*?)\s*\)\s*$/.exec(region[b]);
              if (header) {
                let next = b + 1;
                while (next < region.length && region[next].trim() === "") next++;
                if (next < region.length && /^\s*continue\s*;;&?\s*$/.test(region[next])) {
                  patterns = header[1];
                  b = next;
                }
              }
            }
            if (patterns === null) continue;
            lane.branchCount += 1;
            // R-3 — one branch may carry several globs.
            for (const glob of patterns.split("|").map((g) => g.trim()).filter(Boolean)) {
              lane.globs.push(glob);
            }
          }
        }
      }
    }

    if (lane.hasContinue || lane.globs.length > 0 || lane.parseErrors.length > 0) lanes.push(lane);
  }

  return lanes;
}

// ---------------------------------------------------------------------------
// The analysis.
// ---------------------------------------------------------------------------

/**
 * Pure core. `workflows` and `migrations` are plain { filename: text } maps, so
 * --self-test and both test suites can drive full-copy fixtures without the
 * guard ever touching disk.
 */
export function analyseTrees({ workflows, migrations }) {
  const violations = [];
  const migrationNames = Object.keys(migrations).filter((n) => n.endsWith(".sql")).sort();

  // P-vacuous — matching nothing is a failure, never a pass.
  if (migrationNames.length === 0) {
    violations.push({ check: "P-vacuous", lane: null, message: "No .sql migrations were discovered. A guard that inspects nothing cannot pass." });
    return { lanes: [], violations };
  }

  const parsed = new Map();
  for (const name of migrationNames) {
    const info = parseMigration(name, migrations[name]);
    for (const problem of info.unresolved) {
      violations.push({ check: "C-1", lane: null, message: problem });
    }
    parsed.set(name, info);
  }

  const lanes = [];
  for (const workflowName of Object.keys(workflows).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    for (const lane of discoverLanes(workflowName, workflows[workflowName])) lanes.push(lane);
  }

  if (lanes.length === 0) {
    violations.push({ check: "P-vacuous", lane: null, message: "No filtered migration-replay lane was discovered. This repository has four; finding none means the parser is blind." });
  }

  for (const lane of lanes) {
    const label = `${lane.workflow}:${lane.line}`;

    // C-4(a) — an unparseable skip construct.
    for (const problem of lane.parseErrors) {
      violations.push({ check: "C-4a", lane: label, message: problem });
    }

    // C-4(b) — the positive cross-check. Silence is a failure, not "unfiltered".
    if (lane.hasContinue && lane.globs.length === 0) {
      violations.push({
        check: "C-4b",
        lane: label,
        message:
          `${label}: this migration apply loop contains a \`continue\`, so it filters the chain, but ZERO skip globs ` +
          `were extracted from it. A lane the parser cannot read is NOT an unfiltered lane — analysing it with an ` +
          `empty skip set would silently protect nothing. Fix the parser or the lane; do not leave it unread.`,
      });
    }

    // C-4(c) — the branch census. An independent count of the case region's
    // terminators and `continue` statements must agree with the number of
    // branches the parser actually read. Disagreement means a skip entry exists
    // that the guard cannot see, which silently credits that entry's
    // definitions to the filtered chain and hides any closure break behind it.
    if (lane.census && (lane.census.terminators !== lane.branchCount || lane.census.continues !== lane.branchCount)) {
      violations.push({
        check: "C-4c",
        lane: label,
        message:
          `${label}: branch census disagrees with the parser — the case region holds ` +
          `${lane.census.terminators} branch terminator(s) and ${lane.census.continues} \`continue\` statement(s), ` +
          `but ${lane.branchCount} branch(es) were read. A branch the parser cannot read is a skip entry it does not ` +
          `know about, and C-4(b) cannot catch it while the other branches still yield globs. Write the branch as ` +
          `\`<pattern>) continue ;;\` on one line, or as \`<pattern>)\` followed by \`continue ;;\`, or teach the ` +
          `parser the form.`,
      });
    }

    // Resolve the skip set against THIS lane's own subject (R-4).
    const subjectOf = (file) => (lane.subjectKind === "basename" ? file : `supabase/migrations/${file}`);
    const skipped = new Set();
    for (const glob of lane.globs) {
      const re = globToRegExp(glob);
      const hits = migrationNames.filter((f) => re.test(subjectOf(f)));
      // C-2 — a glob that matches nothing is a skip entry that has stopped working.
      if (hits.length === 0) {
        violations.push({
          check: "C-2",
          lane: label,
          message:
            `${label}: skip glob \`${glob}\` matches ZERO migrations when evaluated against this lane's own case ` +
            `subject (${lane.subjectKind === "basename" ? "basename" : "full path"}). Either the migration was ` +
            `renamed and the skip is now dead, or the glob is written for the wrong subject form (R-4).`,
        });
      }
      for (const hit of hits) skipped.add(hit);
    }
    lane.skipped = [...skipped].sort();

    // C-1 — replay the chain twice and diff what the filtered chain is missing.
    const trueChain = new Set();
    const filteredChain = new Set();
    for (const name of migrationNames) {
      const info = parsed.get(name);
      if (!skipped.has(name)) {
        for (const object of trueChain) {
          if (filteredChain.has(object)) continue;
          // A CREATE OR REPLACE in this very file is a definition, not a reference.
          if (info.definitions.has(object)) continue;
          const identifier = object.slice(object.indexOf(":") + 1);
          if (!info.referenced.has(identifier)) continue;
          violations.push({
            check: "C-1",
            lane: label,
            message:
              `${label}: \`${name}\` references \`${identifier}\` (${object.slice(0, object.indexOf(":"))}), which on this ` +
              `lane is defined ONLY by a migration the lane skips [${lane.globs.join(" ")}]. PostgreSQL validates that ` +
              `reference at CREATE time, so the replay aborts here. Add \`${name}\` to this lane's skip list by EXACT ` +
              `filename — never by an issue-number infix, and never by removing the reference, which would delete a ` +
              `control to green CI.`,
          });
        }
        for (const object of info.definitions) filteredChain.add(object);
      }
      for (const object of info.definitions) trueChain.add(object);
    }
  }

  // C-3 — the pinned lane keeps the branches it already has.
  const pinned = lanes.filter((l) => l.workflow === PINNED_LANE);
  if (pinned.length === 0) {
    violations.push({
      check: "C-3",
      lane: PINNED_LANE,
      message: `${PINNED_LANE}: no filtered migration apply loop found. The #1931 clean-replay lane and its skip list must both survive.`,
    });
  } else {
    const present = new Set(pinned.flatMap((l) => l.globs));
    for (const required of PINNED_BRANCHES) {
      if (!present.has(required)) {
        violations.push({
          check: "C-3",
          lane: PINNED_LANE,
          message:
            `${PINNED_LANE}: skip branch \`${required}\` is gone. A skip entry is never removed to green a lane — ` +
            `each exists because this filtered chain omits a prerequisite needed for that migration to apply coherently.`,
        });
      }
    }
  }

  return { lanes, violations };
}

function readDirText(dir, pattern) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    out[entry.name] = fs.readFileSync(path.join(dir, entry.name), "utf8");
  }
  return out;
}

/**
 * THE SEAM. Every test drives fixtures through this. Fixtures must be FULL
 * COPIES of the real directories with one mutation applied — a partial
 * directory makes the real lanes' globs match zero files and fires C-2/C-3 on
 * a test that expects a clean result.
 */
export function analyseLanes({ workflowsDir = DEFAULT_WORKFLOWS_DIR, migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  return analyseTrees({
    workflows: readDirText(workflowsDir, /\.ya?ml$/),
    migrations: readDirText(migrationsDir, /\.sql$/),
  });
}

// ---------------------------------------------------------------------------
// Self-test. A guard clause that cannot be shown to red does not count.
// ---------------------------------------------------------------------------

function readRealTrees() {
  return {
    workflows: readDirText(DEFAULT_WORKFLOWS_DIR, /\.ya?ml$/),
    migrations: readDirText(DEFAULT_MIGRATIONS_DIR, /\.sql$/),
  };
}

/** Deep-enough copy of a { name: text } map. */
const copy = (tree) => ({ workflows: { ...tree.workflows }, migrations: { ...tree.migrations } });

function selfTest() {
  const failures = [];
  const real = readRealTrees();

  const record = (id, note) => failures.push(`${id}: ${note}`);
  /** Every mutant must actually change the tree, or the mutant proves nothing. */
  const mutate = (id, tree, file, from, to, where = "workflows") => {
    const before = tree[where][file];
    if (before === undefined) { record(id, `fixture file ${file} is missing`); return false; }
    const after = typeof from === "string" ? before.split(from).join(to) : before.replace(from, to);
    if (after === before) { record(id, `mutation was a NO-OP — the mutant proves nothing`); return false; }
    tree[where][file] = after;
    return true;
  };
  const fired = (result, check) => result.violations.some((v) => v.check === check);

  // GOOD — the repository as shipped.
  const good = analyseTrees(real);
  if (good.violations.length) {
    record("GOOD", `repo as shipped wrongly flagged:\n      ${good.violations.map((v) => `[${v.check}] ${v.message}`).join("\n      ")}`);
  }
  const inventory = Object.fromEntries(good.lanes.map((l) => [l.workflow, l.globs.length]));
  // [TEST-MOD-APPROVED #2489] The pinned lane inventory below moved: the
  // private-event lane went from FOUR skips to SIX, and the visibility lane from
  // ONE to TWO. Two legitimate skips were added, neither a workaround:
  //   * 20270523002489_issue_2489_address_privacy_server_gate.sql — added on THIS
  //     GATE'S OWN remediation instruction, which names the exact-filename form
  //     and explicitly forbids removing the reference instead;
  //   * 20270525002562_issue_2562_past_event_guard.sql — approved by the owner of
  //     #2564, whose migration it is: on that lane the 12-argument re-emission
  //     does not replace the 11-argument original, so an unfiltered probe reads
  //     the guardless overload.
  // ONLY counts move. No mutation scenario was removed, no parser case relaxed
  // and no assertion's logic changed — each mutant below still blinds the parser
  // and still requires the blinding to be caught.
  //
  // [TEST-MOD-APPROVED #2489] SECOND MOVE, phase 2: the private-event lane goes
  // from SIX skips to SEVEN. The added entry is
  // 20270528002489_issue_2489_phase2_base_relation_grant.sql, and it is a
  // consequence of the sixth rather than a new judgement: phase 2 gives
  // events_public_view owner rights so it survives the base-relation grant change,
  // but on THAT lane the gated owner-rights definition of that view comes only
  // from the already-skipped …002489_…server_gate.sql, so the lane's own
  // "Apply #1931 and re-capture" step re-emits the view at caller rights and the
  // SC-47 equality capture then fails on a permission error instead of on a
  // behavioural difference. Reproduced before the entry was added and confirmed
  // clean after; the #2117 lane was simulated with phase 2 PRESENT and needs no
  // entry, which is why only one count moves here.
  //
  // Nothing was removed from the migration to green the lane, and the exact
  // filename form is used, per this gate's own remediation instruction.
  // Downstream constants track the base count and move with it, not against it:
  // [TEST-MOD-APPROVED #2723] THIRD MOVE: the private-event lane goes from
  // SEVEN skips to EIGHT. The old count became false because #2723 adds the
  // valid exact #2696 skip required when #2160 is absent; the assertion remains
  // binding and the generalized signature/overload limit remains unchanged.
  // #2728 adds the third exact #2117 skip: its fix-forward definition is kept
  // out of the pre-#2117 baseline and applied only after corrected phase 2.
  // M-6 replaces one branch's single glob with an alternation of three (9 -> 11),
  // M-10 adds one two-line branch (9 -> 10), M-9 leaves one branch unread (9).
  const expectedInventory = {
    "issue-1644-storage-guardrail-collage-fill-tests.yml": 1,
    "issue-1647-admin-mv-and-db-reclaim-tests.yml": 3,
    "issue-1931-private-event-access.yml": 10,
    "issue-2117-offering-visibility-gate-tests.yml": 5,
  };
  if (JSON.stringify(inventory) !== JSON.stringify(expectedInventory)) {
    record("GOOD", `lane inventory is ${JSON.stringify(inventory)}, expected ${JSON.stringify(expectedInventory)}`);
  }

  // M-1 (C-1) — the exact regression: drop the #2462 skip branch.
  {
    const tree = copy(real);
    if (mutate("M-1", tree, PINNED_LANE, /^.*20270522002462_issue_2462_checkout_determinism\.sql\) continue ;;\n/m, "")) {
      const out = analyseTrees(tree);
      if (!fired(out, "C-1")) record("M-1", "C-1 did NOT fire when the #2462 skip branch was removed");
      else if (!out.violations.some((v) => v.check === "C-1" && v.message.includes("issue_1931_event_ordinary_read_blocked"))) {
        record("M-1", "C-1 fired but never named the missing #1931 guard function");
      }
    }
  }

  // M-2 (C-2) — a skip glob that matches nothing.
  {
    const tree = copy(real);
    if (mutate("M-2", tree, PINNED_LANE, "*_issue_1931_*) continue ;;", "*_issue_1931_*) continue ;;\n              *_issue_0000_never_existed_*) continue ;;")) {
      if (!fired(analyseTrees(tree), "C-2")) record("M-2", "C-2 did NOT fire on a skip glob matching zero files");
    }
  }

  // M-3 (C-3) — a pinned skip branch deleted.
  {
    const tree = copy(real);
    if (mutate("M-3", tree, PINNED_LANE, /^.*\*_issue_2160_\*\) continue ;;\n/m, "")) {
      if (!fired(analyseTrees(tree), "C-3")) record("M-3", "C-3 did NOT fire when the *_issue_2160_* branch was deleted");
    }
  }

  // M-4 (C-4a) — the case construct is present but unparseable.
  {
    const tree = copy(real);
    if (mutate("M-4", tree, PINNED_LANE, /^(\s*)esac\n/m, "")) {
      if (!fired(analyseTrees(tree), "C-4a")) record("M-4", "C-4a did NOT fire on a case that is never closed by esac");
    }
  }

  // M-5 (R-2) — a lane rewritten to the basename nested-quote form is still found.
  {
    const tree = copy(real);
    const ok =
      mutate("M-5", tree, PINNED_LANE, 'case "$f" in', 'case "$(basename "$f")" in') &&
      mutate("M-5", tree, PINNED_LANE, "*20270522002462_issue_2462_checkout_determinism.sql)", "20270522002462_issue_2462_checkout_determinism.sql)");
    if (ok) {
      const out = analyseTrees(tree);
      const lane = out.lanes.find((l) => l.workflow === PINNED_LANE);
      if (!lane) record("M-5", "the #1931 lane VANISHED when rewritten to the basename nested-quote form (R-2)");
      else if (lane.subjectKind !== "basename") record("M-5", `subject read as "${lane.subjectKind}", expected "basename"`);
      else if (lane.globs.length !== 10) record("M-5", `${lane.globs.length} globs extracted, expected 10`);
      else if (out.lanes.length !== 4) record("M-5", `inventory collapsed to ${out.lanes.length} lanes, expected 4`);
      else if (out.violations.length) record("M-5", `clean tree flagged after a semantics-preserving rewrite: ${out.violations.map((v) => v.check).join(",")}`);
    }
  }

  // M-6 (R-3) — alternation: three globs on one branch.
  {
    const tree = copy(real);
    const ok = mutate(
      "M-6",
      tree,
      PINNED_LANE,
      "*_issue_2160_*) continue ;;",
      "*_issue_2160_*|*_issue_2333_discover_online_carveout*|*20270522002462_issue_2462_checkout_determinism.sql) continue ;;",
    );
    if (ok) {
      const lane = analyseTrees(tree).lanes.find((l) => l.workflow === PINNED_LANE);
      if (!lane) record("M-6", "lane vanished");
      else if (lane.globs.length !== 12) record("M-6", `alternation under-read: ${lane.globs.length} globs from ${lane.branchCount} branches, expected 12`);
    }
  }

  // M-7 (R-4) — a glob evaluated against the wrong subject.
  {
    const tree = copy(real);
    if (mutate("M-7", tree, "issue-1644-storage-guardrail-collage-fill-tests.yml", 'case "$(basename "$migration")" in', 'case "$migration" in')) {
      const out = analyseTrees(tree);
      if (!fired(out, "C-2")) {
        record("M-7", "C-2 did NOT fire when a basename glob was evaluated against a full path — subject-correct matching is not load-bearing");
      }
    }
  }

  // M-8 (C-4b) — `continue` with no parseable case construct at all.
  {
    const tree = copy(real);
    const src = tree.workflows[PINNED_LANE];
    const caseStart = src.indexOf('case "$f" in');
    const esacEnd = src.indexOf("esac", caseStart);
    if (caseStart === -1 || esacEnd === -1) record("M-8", "could not locate the case block to replace");
    else {
      tree.workflows[PINNED_LANE] =
        `${src.slice(0, caseStart)}[ -n "\${SKIP_ME:-}" ] && continue${src.slice(esacEnd + "esac".length)}`;
      const out = analyseTrees(tree);
      if (!fired(out, "C-4b")) {
        record("M-8", "C-4b did NOT fire on a lane whose loop continues but yields zero globs — an unread lane was silently treated as unfiltered");
      }
    }
  }

  // M-9 (C-4c) — a branch the parser CANNOT read, alongside branches it can.
  // Three physical lines, so R-5's two-line matcher does not cover it. The
  // readable branches still yield globs, so C-4(b) stays quiet by construction;
  // only the census catches it. This is the mutant that makes C-4(c) real.
  {
    const tree = copy(real);
    if (mutate("M-9", tree, PINNED_LANE, "            esac", "              *_issue_0001_unreadable_*)\n                continue\n                ;;\n            esac")) {
      const out = analyseTrees(tree);
      const lane = out.lanes.find((l) => l.workflow === PINNED_LANE);
      if (lane.branchCount !== 10) record("M-9", `expected the 3-line branch to stay unread (branchCount 10), got ${lane.branchCount}`);
      else if (!fired(out, "C-4c")) {
        record("M-9", "C-4c did NOT fire on a lane whose case region holds a branch the parser cannot read — under-counting is invisible");
      } else if (fired(out, "C-4b")) {
        record("M-9", "C-4b fired, which would mean this mutant is not exercising the gap C-4c exists for");
      }
    }
  }

  // M-10 (R-5) — the two-line branch form IS read, and does not red anything.
  // The glob names a real migration so C-2 cannot fire for an unrelated reason.
  {
    const tree = copy(real);
    if (mutate("M-10", tree, PINNED_LANE, "            esac", "              *20270522002463_issue_2462_phone_backfill.sql)\n                continue ;;\n            esac")) {
      const out = analyseTrees(tree);
      const lane = out.lanes.find((l) => l.workflow === PINNED_LANE);
      if (lane.branchCount !== 11) record("M-10", `two-line branch form not read: branchCount ${lane.branchCount}, expected 11 (R-5)`);
      else if (lane.globs.length !== 11) record("M-10", `${lane.globs.length} globs, expected 11`);
      else if (out.violations.length) record("M-10", `a readable two-line branch flagged: ${out.violations.map((v) => v.check).join(",")}`);
    }
  }

  if (failures.length) {
    console.error(`#2492 SELF-TEST FAILED:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("#2492 self-test PASS (1 good tree with the 10/1/3/5 lane inventory, 10 mutants M-1…M-10 all behaving).");
}

// ---------------------------------------------------------------------------

function liveRun(argv) {
  const arg = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? path.resolve(hit.slice(name.length + 3)) : fallback;
  };
  const workflowsDir = arg("workflows-dir", DEFAULT_WORKFLOWS_DIR);
  const migrationsDir = arg("migrations-dir", DEFAULT_MIGRATIONS_DIR);

  const { lanes, violations } = analyseLanes({ workflowsDir, migrationsDir });
  if (violations.length) {
    console.error(
      `#2492 I-PROPOSED-2492-FILTERED-REPLAY-SKIP-CLOSURE FAILED — ${violations.length} violation(s):\n  - ` +
        violations.map((v) => `[${v.check}] ${v.message}`).join("\n  - "),
    );
    process.exit(1);
  }
  const inventory = lanes.map((l) => `${l.workflow} (${l.globs.length} glob${l.globs.length === 1 ? "" : "s"}, ${l.skipped.length} file${l.skipped.length === 1 ? "" : "s"} skipped)`);
  console.log(
    `#2492 OK — ${lanes.length} filtered migration-replay lane(s), each closed under its own skip list:\n  - ` +
      inventory.join("\n  - "),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else liveRun(process.argv.slice(2));
}
