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
//   #2117   for f in $(find supabase/migrations …)     case "$f" in            full path  18
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
export const DEFAULT_MIGRATIONS_DIR = path.join(
  REPO_ROOT,
  "supabase/migrations",
);


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
    if (honoursBackslash && sql[j] === "\\") {
      j += 2;
      continue;
    }
    if (sql[j] === "'" && sql[j + 1] === "'") {
      j += 2;
      continue;
    }
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
        if (sql.slice(j, j + 2) === "/*") {
          depth++;
          j += 2;
        } else if (sql.slice(j, j + 2) === "*/") {
          depth--;
          j += 2;
        } else j++;
      }
      blankRange(out, i, j);
      i = j;
    } else if (sql[i] === "'") {
      i = endOfSingleQuoted(sql, i);
    } else if (sql[i] === "$") {
      const m = DOLLAR_TAG_RE.exec(sql.slice(i));
      if (!m) {
        i++;
        continue;
      }
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
        regions.push({
          start: i,
          end,
          inner: sql.slice(i + tag.length, close === -1 ? sql.length : close),
        });
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
  const bodiesUnchecked =
    /\bSET\s+check_function_bodies\s*(?:=|\bTO\b)\s*(?:false|off|'off'|0)\b/i.test(
      top,
    );

  const sqlBodies = [];
  for (const region of regions) {
    // Widen to the enclosing statement: the text between the previous and the
    // next top-level `;`. LANGUAGE may sit before or after the body.
    const openIdx = top.lastIndexOf(";", region.start);
    const start = openIdx === -1 ? 0 : openIdx + 1;
    const closeIdx = top.indexOf(";", region.end);
    const end = closeIdx === -1 ? top.length : closeIdx;
    const statement = `${top.slice(start, region.start)} ${top.slice(region.end, end)}`;

    if (
      !/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(
        statement,
      )
    ) {
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
  const fnRe = new RegExp(
    `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})`,
    "gi",
  );
  while ((m = fnRe.exec(top))) definitions.add(`fn:${bareName(m[1])}`);
  const viewRe = new RegExp(
    `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})`,
    "gi",
  );
  while ((m = viewRe.exec(top))) definitions.add(`view:${bareName(m[1])}`);
  const tableRe = new RegExp(
    `\\bCREATE\\s+(?:UNLOGGED\\s+|TEMP\\s+|TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED})`,
    "gi",
  );
  while ((m = tableRe.exec(top))) definitions.add(`table:${bareName(m[1])}`);
  // #4130: read EVERY `ADD COLUMN` clause of an ALTER TABLE statement, not only
  // the first. `ALTER TABLE public.orders ADD COLUMN a …, ADD COLUMN
  // refunded_amount_cents …;` (orch_0787) defines both columns; reading only
  // the first left the model believing `orders.refunded_amount_cents` existed
  // solely via a later skipped migration, so a real, replay-clean reference
  // was reported as a closure break. Only real definitions are credited: the
  // clause must sit inside an ALTER TABLE statement (up to its `;`) and must
  // spell `ADD COLUMN`, exactly as the single-clause form already required
  // (a bare `ADD x` is never read, so `ADD CONSTRAINT` cannot pose as a column).
  const alterRe = new RegExp(
    `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${QUALIFIED}\\s[^;]*`,
    "gi",
  );
  const colRe = new RegExp(
    `\\bADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`,
    "gi",
  );
  while ((m = alterRe.exec(top))) {
    let c;
    colRe.lastIndex = 0;
    while ((c = colRe.exec(m[0]))) definitions.add(`col:${bareName(c[1])}`);
  }

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
  return text
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

/** Shell glob -> anchored RegExp. `*` spans anything, `?` one character. */
export function globToRegExp(glob) {
  const body = Array.from(glob)
    .map((c) =>
      c === "*"
        ? ".*"
        : c === "?"
          ? "."
          : /[.^$+(){}[\]\\|]/.test(c)
            ? `\\${c}`
            : c,
    )
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
    continues: regionLines.filter((l) =>
      /(?:^|[\s;&|(])continue(?:[\s;&|)]|$)/.test(l),
    ).length,
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
    const header = /^(\s*)for\s+([A-Za-z_][A-Za-z_0-9]*)\s+in\s+(.*)$/.exec(
      lines[i],
    );
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

    let end = lines.findIndex(
      (l, idx) => idx > i && new RegExp(`^${indent}done\\b`).test(l),
    );
    if (end === -1)
      end = lines.findIndex((l, idx) => idx > i && /^\s*done\b/.test(l));
    if (end === -1) {
      lane.parseErrors.push(
        `${workflowName}:${i + 1}: migration apply loop is never terminated by \`done\` — its body cannot be bounded.`,
      );
      lanes.push(lane);
      continue;
    }

    const body = lines.slice(i, end + 1);
    // C-4(b) — detected INDEPENDENTLY of the case parse, on purpose.
    lane.hasContinue = body.some((l) =>
      /(?:^|[\s;&|(])continue(?:[\s;&|)]|$)/.test(l),
    );

    const caseIdx = body.findIndex((l) => /^\s*case\s+.+\s+in\s*$/.test(l));
    if (caseIdx !== -1) {
      // R-2 — anchoring on the line-terminal ` in` reads BOTH subject forms,
      // including the nested quote in `case "$(basename "$migration")" in`.
      const subject = /^\s*case\s+(.+)\s+in\s*$/.exec(body[caseIdx])[1];
      if (/\bbasename\b/.test(subject)) lane.subjectKind = "basename";
      else if (new RegExp(`\\$\\{?${loopVar}\\b`).test(subject))
        lane.subjectKind = "path";
      else {
        lane.parseErrors.push(
          `${workflowName}:${i + 1 + caseIdx}: cannot resolve the case subject \`${subject.trim()}\` to a full path ` +
            `or a basename, so glob matching would be guesswork (R-4). Unresolvable input fails closed.`,
        );
      }

      const esacIdx = body.findIndex(
        (l, idx) => idx > caseIdx && /^\s*esac\s*$/.test(l),
      );
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
            const inline = /^\s*\(?\s*([^)]*?)\s*\)\s*continue\s*;;/.exec(
              region[b],
            );
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
                while (next < region.length && region[next].trim() === "")
                  next++;
                if (
                  next < region.length &&
                  /^\s*continue\s*;;&?\s*$/.test(region[next])
                ) {
                  patterns = header[1];
                  b = next;
                }
              }
            }
            if (patterns === null) continue;
            lane.branchCount += 1;
            // R-3 — one branch may carry several globs.
            for (const glob of patterns
              .split("|")
              .map((g) => g.trim())
              .filter(Boolean)) {
              lane.globs.push(glob);
            }
          }
        }
      }
    }

    if (
      lane.hasContinue ||
      lane.globs.length > 0 ||
      lane.parseErrors.length > 0
    )
      lanes.push(lane);
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
  const migrationNames = Object.keys(migrations)
    .filter((n) => n.endsWith(".sql"))
    .sort();

  // P-vacuous — matching nothing is a failure, never a pass.
  if (migrationNames.length === 0) {
    violations.push({
      check: "P-vacuous",
      lane: null,
      message:
        "No .sql migrations were discovered. A guard that inspects nothing cannot pass.",
    });
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
  for (const workflowName of Object.keys(workflows)
    .sort()) {
    for (const lane of discoverLanes(workflowName, workflows[workflowName]))
      lanes.push(lane);
  }

  if (lanes.length === 0) {
    violations.push({
      check: "P-vacuous",
      lane: null,
      message:
        "No filtered migration-replay lane was discovered. Finding none means the parser is blind.",
    });
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
    if (
      lane.census &&
      (lane.census.terminators !== lane.branchCount ||
        lane.census.continues !== lane.branchCount)
    ) {
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
    const subjectOf = (file) =>
      lane.subjectKind === "basename" ? file : `supabase/migrations/${file}`;
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
export function analyseLanes({
  workflowsDir = DEFAULT_WORKFLOWS_DIR,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
} = {}) {
  const workflows = readDirText(workflowsDir, /\.ya?ml$/);
  if (workflowsDir === DEFAULT_WORKFLOWS_DIR) {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
    for (const suite of manifest.suites) {
      const commands = [suite.templateReplay?.run, ...suite.steps.map(step => step.run)].filter(Boolean).join("\n");
      if (commands.includes("supabase/migrations")) workflows[suite.id] = commands;
    }
  }
  return analyseTrees({ workflows, migrations: readDirText(migrationsDir, /\.sql$/) });
}

// ---------------------------------------------------------------------------
// Self-test. A guard clause that cannot be shown to red does not count.
// ---------------------------------------------------------------------------

function selfTest() {
  const workflows = { fixture: 'for f in supabase/migrations/*.sql; do\n  case "$f" in\n    *002_skip.sql) continue ;;\n  esac\n  psql -v ON_ERROR_STOP=1 -f "$f"\ndone' };
  const migrations = {
    "001_base.sql": "CREATE TABLE public.base(id int);",
    "002_skip.sql": "CREATE TABLE public.hidden(id int);",
    "003_reader.sql": "CREATE VIEW public.reader AS SELECT id FROM public.base;",
  };
  if (analyseTrees({ workflows, migrations }).violations.length) throw new Error("clean replay rejected");
  const broken = { ...migrations, "004_bad.sql": "CREATE VIEW public.bad AS SELECT id FROM public.hidden;" };
  if (!analyseTrees({ workflows, migrations: broken }).violations.some(v => v.check === "C-1")) throw new Error("missing prerequisite accepted");
  if (!analyseTrees({ workflows, migrations: {} }).violations.length) throw new Error("empty migration tree accepted");
  console.log("#2492 self-test PASS");
}

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
  const inventory = lanes.map(
    (l) =>
      `${l.workflow} (${l.globs.length} glob${l.globs.length === 1 ? "" : "s"}, ${l.skipped.length} file${l.skipped.length === 1 ? "" : "s"} skipped)`,
  );
  console.log(
    `#2492 OK — ${lanes.length} filtered migration-replay lane(s), each closed under its own skip list:\n  - ` +
      inventory.join("\n  - "),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes("--self-test")) selfTest();
  else liveRun(process.argv.slice(2));
}
