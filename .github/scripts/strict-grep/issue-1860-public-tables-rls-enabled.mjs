#!/usr/bin/env node
/**
 * Issue #1860 — NO TABLE IN `public` MAY HAVE ROW-LEVEL SECURITY DISABLED.
 *
 * Row-level security is the only effective constraint on this schema. The
 * baseline squash carries the platform-standard `ALTER DEFAULT PRIVILEGES … IN
 * SCHEMA public GRANT ALL ON TABLES` for the standard roles (#1827), so a
 * table's own GRANT lines cannot narrow what it already holds. A table with RLS
 * off carries no constraint at all — which is why this is a gate and not a
 * convention. Convention already failed here: tables accumulated in that state
 * over months and nothing said a word.
 *
 * ── WHAT THIS GATE GUARANTEES, AND WHAT IT DOES NOT ────────────────────────
 * It guarantees RLS is **PRESENT**. It does NOT guarantee RLS **CONSTRAINS**.
 * A table with RLS enabled and a permissive `USING (true)` policy reads exactly
 * like an open table to `anon`, while `pg_class.relrowsecurity` still reports
 * true — proved at runtime by the #1860 tester. Nothing here models policy
 * contents, and it deliberately should not: plenty of tables legitimately carry
 * public-read policies, and deciding which are legitimate is a different piece
 * of work. **A green run here is not a proof of access control.** The twelve
 * tables this issue fixed are additionally asserted to carry ZERO policies, but
 * that assertion lives in the live half and covers only those twelve.
 *
 * ── THE EARLY HALF, NOT THE AUTHORITATIVE ONE. READ THIS BEFORE TRUSTING IT ─
 * This file is the EARLY half: static, no database, runs on every PR, and
 * therefore tells you within seconds that a migration forgot an ENABLE. It
 * works by PARSING TEXT, so its accuracy is bounded by how well it models
 * PostgreSQL's literal and dynamic-DDL grammar — and that grammar is larger
 * than any regex sweep of it. It has known blind spots (listed under KNOWN
 * LIMITS below) and it will acquire more, because every one found so far has
 * been a new corner of the same grammar.
 *
 * The AUTHORITATIVE half is
 * `supabase/migrations/__tests__/issue_1860_public_rls_coverage.test.sql`, run
 * by the containerised Postgres job in
 * `.github/workflows/supabase-migrations-and-stripe-deno.yml`. It reads
 * `pg_class.relrowsecurity` on the schema the chain actually produced, so it is
 * immune to EVERY parsing limitation on this page BY CONSTRUCTION — it does not
 * parse anything. Whatever a `DO` block, an `EXECUTE`, an `E'…'` or a string
 * concatenation did, the catalog records the result.
 *
 * **A green run of THIS file is the weaker statement of the two.** It means "no
 * missing ENABLE that static analysis can see". It is not a substitute for the
 * catalog test, and anyone reading it as one has the guarantee backwards. C5
 * asserts the authoritative half is still WIRED; deleting it fails this gate,
 * precisely because this half alone is not enough.
 *
 * A third file is load-bearing and is guarded the same way: the tester-owned
 * `scripts/issue-1860/issue-1860-public-tables-rls.tester.adversarial.test.mjs`,
 * which is the only suite anchoring this gate to the REAL chain. It sits outside
 * the strict-grep directory, so MANIFEST.json does not sweep it and
 * run-batch.mjs does not run it — C8 asserts it exists and is invoked by
 * executable (comment-stripped) yaml in
 * `ci-batch:issue-1860-rls-coverage-tests` in `.github/ci-batch/MANIFEST.json`.
 *
 * There is deliberately NO second, weaker audit of this ground.
 * `scripts/audit/rls-coverage.mjs` was retired and deleted at #1860 — it matched
 * only the double-quoted dump style, so every table created since the baseline
 * was invisible to it, and it was green because it barely looked. C6 fails if it
 * comes back. Two audits of unequal strength claiming the same ground is the
 * condition that produced this issue.
 *
 * ── THE EXEMPTION IS EXACTLY ONE TABLE ─────────────────────────────────────
 * `public.spatial_ref_sys` is owned by the PostGIS extension, not by us, and
 * holds published coordinate-system reference data. It is the only exemption
 * and it lives in exactly one reviewed place (`scripts/audit/rls-allowlist.json`),
 * which C2 pins to that one name. The allowlist is compared for EQUALITY only —
 * it is never consulted when deciding whether a table is in violation, so
 * writing a name into it cannot excuse anything. That list previously held nine
 * names and every one of them was a real hole.
 *
 * ── PARSING: WHERE DDL MAY BE READ FROM, AND WHERE IT MAY NOT ──────────────
 * Every trap below is a real defect this file has already had, found either in
 * the predecessor audit or by the #1860 tester against an earlier revision of
 * this gate. They are listed as rules because a rule survives a refactor.
 *
 *  R1  COMMENTS ARE NEVER DDL. A `DROP TABLE public.x;` sentence inside a
 *      `COMMENT ON TABLE … IS '…'` body is prose. The predecessor audit matched
 *      one and silently classified a live table as dropped, removing it from
 *      scrutiny entirely — half the reason an archive table sat unprotected.
 *
 *  R2  STRING LITERALS ARE NEVER DDL — INCLUDING INSIDE `DO` BODIES. An earlier
 *      revision of this file masked literals at statement level only and handed
 *      `DO` bodies to the DDL regexes raw. That failed BOTH ways: a bare
 *      `RAISE NOTICE 'ALTER TABLE public.x ENABLE ROW LEVEL SECURITY'` laundered
 *      an unprotected table green, and a drop sentence inside a `DO`-body string
 *      hid a live table — R1's bug relocated rather than closed. Literals are
 *      now masked inside `DO` bodies too, in BOTH forms: `'…'` and dollar-quoted
 *      `$tag$…$tag$` (the chain really does use `EXECUTE $convert$ … $convert$`).
 *
 *  R3  DYNAMIC DDL IS READ ONLY FROM THE EXECUTED STATEMENT — WHICH IS THE FIRST
 *      ADJACENT-LITERAL RUN AFTER `EXECUTE`, AND NOTHING AFTER IT. A string is
 *      DDL when Postgres is told to run it, and at no other time. Roughly a
 *      third of this schema enables RLS through
 *      `FOREACH v IN ARRAY ARRAY[…] LOOP EXECUTE format('ALTER TABLE public.%I
 *      ENABLE ROW LEVEL SECURITY', v)`. A gate that only reads literal
 *      `ALTER TABLE` statements reports ~45 false positives, gets muted, and is
 *      then worth nothing — so these are resolved, from the `EXECUTE` position
 *      only, against the enclosing loop's array.
 *      The second half of the rule is what G-1 cost: `format()` arguments and
 *      `USING` parameters are DATA. Reading them as DDL let a `%L` argument
 *      spelling an enable report an unprotected table as protected, and one
 *      spelling a drop remove a live table from scrutiny. Data is never DDL, no
 *      matter what it spells.
 *
 *  R7  THE LITERAL GRAMMAR IS BIGGER THAN ONE QUOTE CHARACTER. Three forms carry
 *      text and each ends differently: `'…'` (doubled quotes), dollar-quoted
 *      `$tag$…$tag$`, and `E'…'`, which additionally honours BACKSLASH escapes.
 *      G-2 was the third: `E'don\\'t …'` mis-ended, and the tail was read as
 *      statement-level DDL — so a `COMMENT ON TABLE … IS E'…'` could hide a live
 *      table with no `DO` block involved at all. `U&'…'` deliberately gets no
 *      special handling: it doubles quotes like an ordinary literal and uses
 *      backslash only for Unicode code points. Do not "fix" it.
 *
 *  R4  ONLY `DO` BLOCKS ARE EXECUTED. The same `format()` text inside a
 *      `CREATE FUNCTION` body is stored, not run, and must not count.
 *
 *  R5  UNRESOLVABLE DYNAMIC DDL FAILS CLOSED — except drops. C7 reds on a
 *      dynamic `CREATE` / `ENABLE` / `DISABLE` whose table cannot be resolved,
 *      and on an `EXECUTE` whose argument holds no literal at all (a built-up
 *      variable). The asymmetry is deliberate and is the whole of R5: an
 *      unresolved DROP leaves a table in scope, which merely risks a false RED;
 *      an unresolved CREATE makes a table INVISIBLE, which is a false GREEN on a
 *      genuinely unprotected schema. Ignoring the unsafe direction quietly is
 *      exactly the silence that let this bug class live, so it is refused
 *      loudly instead. Today's chain contains zero of either.
 *
 *  R6  RLS CAN BE TURNED BACK OFF. `DISABLE ROW LEVEL SECURITY` and a
 *      drop-then-recreate both clear the enabled state; the replay is ordered by
 *      event, not a set union, so a later disable wins over an earlier enable.
 *
 * ── KNOWN LIMITS OF THE STATIC HALF (deliberately not fixed) ───────────────
 * Written down rather than chased, because "prose read as DDL" has now been
 * found three times — in the predecessor audit, then F-1, then G-1/G-2 — and
 * each fix was correct while the next corner of the grammar was still there. A
 * documented limit is worth more than an undocumented one, and the catalog test
 * catches every case below regardless.
 *
 *  L1  A DDL STATEMENT ASSEMBLED BY CONCATENATION IS INVISIBLE, AND C7 IS SILENT
 *      ABOUT IT. `EXECUTE 'CREATE TABLE public.' || quote_ident(v) || ' (…)'`
 *      produces no complete DDL match in any single fragment, so there is no
 *      event AND nothing for R5 to call unresolvable. R5's fail-closed covers
 *      the `%I` placeholder form and the fully-opaque `EXECUTE v_sql` form; it
 *      does not cover this middle case. Today's chain has three concatenated
 *      `EXECUTE`s and all three build `CREATE TRIGGER` / `CREATE POLICY`, so no
 *      table is currently hidden by it — a fact, not a defence.
 *
 *  L2  MORE OF THE SAME CLASS SHOULD BE ASSUMED TO EXIST. PostgreSQL's literal
 *      and dynamic-DDL grammar is larger than this file models. If you find one,
 *      the correct response is to add it HERE and rely on the catalog test,
 *      not to assume the static half was ever the guarantee.
 *
 * Supports `--self-test`: GOOD plus one BAD fixture per rule, AND — since the
 * #1860 tester proved a fixture-only suite stays green when the real fix is
 * deleted — two cases anchored to the REAL migration chain, so this suite fails
 * on revert on its own.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const MIGRATIONS_DIR = "supabase/migrations";
const ALLOWLIST_PATH = "scripts/audit/rls-allowlist.json";
const RETIRED_AUDIT_PATH = "scripts/audit/rls-coverage.mjs";
const LIVE_TEST_PATH = "supabase/migrations/__tests__/issue_1860_public_rls_coverage.test.sql";
const LIVE_TEST_WORKFLOW = ".github/workflows/supabase-migrations-and-stripe-deno.yml";
const ADVERSARIAL_SUITE_PATH = "scripts/issue-1860/issue-1860-public-tables-rls.tester.adversarial.test.mjs";
const ADVERSARIAL_WORKFLOW = ".github/ci-batch/MANIFEST.json";
const FIX_MIGRATION_MARKER = "_issue_1860_enable_rls_on_unprotected_public_tables.sql";

/**
 * The ONE reviewed exemption. Changing this constant is the only way to change
 * the exemption set, and it is a visible diff in a reviewed file — which is the
 * entire point. See the header for why `spatial_ref_sys` qualifies.
 */
const EXEMPT = ["spatial_ref_sys"];

/**
 * Anti-vacuity floor. This schema has ~350 tables. If a parser regression makes
 * the chain look tiny, the gate would pass by asking about almost nothing — the
 * "green because it checked nothing" mode. Raise this when the schema grows;
 * never lower it to make a red go away.
 */
const MIN_LIVE_TABLES = 300;

// ---------------------------------------------------------------------------
// SQL lexing. Everything here exists to stop a regex reading DDL out of prose.
// ---------------------------------------------------------------------------

const DOLLAR_TAG_RE = /^\$[A-Za-z_0-9]*\$/;

function blankRange(chars, from, to) {
  for (let k = from; k < to; k++) if (chars[k] !== "\n") chars[k] = " ";
}

/**
 * R7 / G-2. Is the quote at `quoteIdx` the opening quote of an ESCAPE string,
 * `E'…'`? Only that form honours backslash escapes, so only that form can end
 * somewhere other than the next undoubled quote.
 *
 * The `E` must be a standalone prefix, not the tail of an identifier —
 * `value_e'x'` is not an escape string, `E'x'` and `(e'x'` are.
 *
 * `U&'…'` deliberately needs NO handling and must not be given any: it doubles
 * quotes exactly like an ordinary literal and uses backslash only to introduce a
 * Unicode code point (`\0041`), never to escape a quote. Adding backslash
 * handling for it would MIS-END an ordinary `U&` string. Left alone on purpose.
 */
function isEscapeString(text, quoteIdx) {
  const prev = text[quoteIdx - 1];
  if (prev !== "E" && prev !== "e") return false;
  const before = text[quoteIdx - 2];
  return before === undefined || !/[A-Za-z0-9_$]/.test(before);
}

/**
 * End offset (exclusive) of the literal whose opening quote is at `start`.
 *
 * G-2: an `E'don\'t'` mis-ended here before, and everything downstream then read
 * the tail as statement-level DDL. That broke masking at TOP level, not only
 * inside `DO` bodies — a `COMMENT ON TABLE … IS E'…'` carrying a drop sentence
 * hid a live table with no `DO` block involved. 15 migrations already use `E'`.
 */
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
 * R1. Replace `--` line comments and C-style block comments with spaces,
 * preserving byte offsets so later match positions stay meaningful. Literals and
 * dollar-quoted bodies are stepped OVER, not removed — a `DO` body is executable
 * DDL and `segment()` decides what to do with it.
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

/**
 * Every string-literal span in `text`, in both spellings Postgres accepts:
 * `'…'` and dollar-quoted `$tag$…$tag$`. Returned as
 * `{ start, end, inner }` where `inner` is the literal's CONTENT.
 * R2 depends on this being complete — a form it misses is a form that can carry
 * DDL past the masker.
 */
export function stringLiterals(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      const end = endOfSingleQuoted(text, i);
      out.push({ start: i, end, inner: text.slice(i + 1, end - 1).replace(/''/g, "'") });
      i = end;
      continue;
    }
    if (text[i] === "$") {
      const m = DOLLAR_TAG_RE.exec(text.slice(i));
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, i + tag.length);
        const end = close === -1 ? text.length : close + tag.length;
        out.push({ start: i, end, inner: text.slice(i + tag.length, close === -1 ? text.length : close) });
        i = end;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** `text` with every string-literal span blanked, offsets preserved. */
export function maskStringLiterals(text) {
  const chars = Array.from(text);
  for (const lit of stringLiterals(text)) blankRange(chars, lit.start, lit.end);
  return chars.join("");
}

/**
 * Split comment-masked SQL into:
 *   - `top`: the same string with every string literal and every dollar-quoted
 *     body blanked out (offsets preserved). Statement-level DDL only. (R1, R2)
 *   - `doBodies`: the bodies of `DO $tag$ … $tag$` blocks, which Postgres
 *     EXECUTES at migration time. Function bodies are NOT included — a
 *     `CREATE FUNCTION` body is stored, not run. (R4)
 */
export function segment(sql) {
  const top = Array.from(sql);
  const doBodies = [];
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const end = endOfSingleQuoted(sql, i);
      blankRange(top, i, end);
      i = end;
      continue;
    }
    const m = DOLLAR_TAG_RE.exec(sql.slice(i));
    if (m) {
      const tag = m[0];
      const close = sql.indexOf(tag, i + tag.length);
      const bodyStart = i + tag.length;
      const bodyEnd = close === -1 ? sql.length : close;
      // Is the statement opening this dollar-quote a bare `DO`? Look back over
      // the already-emitted top text to the previous statement boundary.
      const before = top.slice(0, i).join("");
      const boundary = Math.max(before.lastIndexOf(";"), before.lastIndexOf("$"));
      if (/(^|[\s)])DO\s*$/i.test(before.slice(boundary + 1))) {
        doBodies.push({ start: bodyStart, text: sql.slice(bodyStart, bodyEnd) });
      }
      blankRange(top, i, close === -1 ? sql.length : close + tag.length);
      i = close === -1 ? sql.length : close + tag.length;
      continue;
    }
    i++;
  }
  return { top: top.join(""), doBodies };
}

// ---------------------------------------------------------------------------
// DDL extraction.
// ---------------------------------------------------------------------------

// A schema-qualified table name, OR a `format()` placeholder standing in for one
// (`%I`, `%s`, `%L`, `%1$I`). The placeholder branch is what R3/R5 act on.
const QUALIFIED = `"?public"?\\s*\\.\\s*(%(?:\\d+\\$)?[IsL]|"?[A-Za-z0-9_]+"?)`;

const DDL_PATTERNS = [
  { kind: "create", re: new RegExp(`CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED}`, "gi") },
  { kind: "drop", re: new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${QUALIFIED}`, "gi") },
  { kind: "enable", re: new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${QUALIFIED}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "gi") },
  { kind: "disable", re: new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${QUALIFIED}\\s+DISABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "gi") },
];

const FOREACH_RE = /FOREACH\s+(\w+)\s+IN\s+ARRAY\s+ARRAY\s*\[/gi;

/**
 * Strip `#` comments from YAML so a WIRED check cannot be satisfied by a
 * workflow that merely TALKS about the file it is supposed to run. Both C5 and
 * C8 name a path that also appears in this repo's workflow prose, and
 * "commented-out step still reads as wired" is a failure mode issue #1607 had
 * to close in this same directory. Quoted `#` is preserved.
 */
export function stripYamlComments(text) {
  return text
    .split("\n")
    .map((line) => {
      let quote = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

const isPlaceholder = (name) => name.startsWith("%");

function matches(re, text) {
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m);
  return out;
}

/** Table-level DDL found in `text`, each as `{ kind, name, at }`. */
function ddlIn(text, offset = 0) {
  const out = [];
  for (const { kind, re } of DDL_PATTERNS) {
    for (const m of matches(re, text)) {
      out.push({ kind, name: m[1].replace(/"/g, ""), at: offset + m.index });
    }
  }
  return out;
}

/**
 * `FOREACH v IN ARRAY ARRAY[…] LOOP … END LOOP` bindings inside one `DO` body.
 * Structure is located on the MASKED text so a `LOOP` inside a string cannot
 * move the boundary; the array's NAMES are then read from the raw text, because
 * the array literal is the loop's variable binding, not DDL.
 */
export function foreachBindings(body, masked) {
  const out = [];
  for (const m of matches(FOREACH_RE, masked)) {
    const openBracket = masked.indexOf("[", m.index);
    if (openBracket === -1) continue;
    const closeBracket = masked.indexOf("]", openBracket);
    if (closeBracket === -1) continue;
    const loopKeyword = masked.slice(closeBracket).search(/\bLOOP\b/i);
    if (loopKeyword === -1) continue;
    const bodyStart = closeBracket + loopKeyword + 4;
    const endLoop = masked.slice(bodyStart).search(/\bEND\s+LOOP\b/i);
    const bodyEnd = endLoop === -1 ? masked.length : bodyStart + endLoop;
    const names = (body.slice(openBracket, closeBracket).match(/'([^']*)'/g) ?? []).map((s) => s.slice(1, -1));
    out.push({ variable: m[1], names, start: bodyStart, end: bodyEnd });
  }
  return out;
}

/**
 * R3 + R5. Analyse ONE executed `DO` body.
 * Returns `{ events, unresolved }`. Literal DDL comes from the masked text;
 * dynamic DDL comes ONLY from `EXECUTE` argument positions.
 */
export function analyzeDoBody(body, offset = 0) {
  const masked = maskStringLiterals(body);
  const literals = stringLiterals(body);
  const events = ddlIn(masked, offset);
  const unresolved = [];
  const loops = foreachBindings(body, masked);

  const resolve = (at) => loops.filter((l) => at >= l.start && at < l.end);

  for (const m of matches(/\bEXECUTE\b/gi, masked)) {
    const semi = masked.indexOf(";", m.index);
    const stmtEnd = semi === -1 ? masked.length : semi;
    const inRange = literals.filter((l) => l.start >= m.index && l.end <= stmtEnd + 1);

    if (inRange.length === 0) {
      // R5. `EXECUTE v_sql` where the statement was built up in a variable. The
      // DDL is genuinely unreadable from here; refuse rather than assume it is
      // harmless, because the harmless assumption is the one that hides a table.
      unresolved.push({
        kind: "opaque",
        at: offset + m.index,
        excerpt: body.slice(m.index, Math.min(stmtEnd + 1, m.index + 90)).replace(/\s+/g, " "),
      });
      continue;
    }

    // Maximal runs of ADJACENT literals (separated only by whitespace) are how
    // plpgsql spells a long format template across several lines. An argument
    // like `v_table || '_team_read'` is a separate, non-adjacent run and cannot
    // graft itself onto the template.
    const runs = [];
    for (const lit of inRange) {
      const prev = runs[runs.length - 1];
      if (prev && /^\s*$/.test(body.slice(prev.end, lit.start))) {
        prev.text += lit.inner;
        prev.end = lit.end;
      } else {
        runs.push({ text: lit.inner, start: lit.start, end: lit.end });
      }
    }

    // R3 / G-1. ONLY THE FIRST RUN IS THE STATEMENT BEING EXECUTED.
    //
    // `EXECUTE format(<template>, <args…>)` and `EXECUTE <stmt> USING <params…>`
    // both put the executed text first; everything after it is DATA. Reading the
    // later runs as DDL was F-1's bug one layer in — a `%L` data argument
    // spelling an enable reported an unprotected table as protected, and one
    // spelling a drop removed a live table from scrutiny. Data is never DDL, no
    // matter what it spells.
    const executed = runs[0];
    if (executed) {
      for (const found of ddlIn(executed.text)) {
        if (!isPlaceholder(found.name)) {
          events.push({ kind: found.kind, name: found.name, at: offset + executed.start });
          continue;
        }
        const bound = resolve(m.index);
        const names = bound.flatMap((l) => l.names);
        if (names.length > 0) {
          for (const name of names) events.push({ kind: found.kind, name, at: offset + executed.start });
          continue;
        }
        if (found.kind === "drop") continue; // R5: safe direction, left in scope.
        unresolved.push({
          kind: found.kind,
          at: offset + executed.start,
          excerpt: executed.text.replace(/\s+/g, " ").slice(0, 120),
        });
      }
    }
  }

  return { events, unresolved };
}

/** Ordered create/drop/enable/disable events for ONE migration file. */
export function eventsForFile(rawSql) {
  const clean = maskComments(rawSql);
  const { top, doBodies } = segment(clean);
  const events = ddlIn(top);
  const unresolved = [];

  for (const body of doBodies) {
    const analysed = analyzeDoBody(body.text, body.start);
    events.push(...analysed.events);
    unresolved.push(...analysed.unresolved);
  }

  events.sort((a, b) => a.at - b.at);
  return { events, unresolved };
}

/**
 * Replay the whole chain in filename order.
 * R6: a re-CREATE resets the table's RLS state (a fresh table starts with RLS
 * off) and a DISABLE clears it, so a later event always wins over an earlier one.
 */
export function replayChain(files) {
  const live = new Set();
  const rlsOn = new Set();
  const unresolved = [];
  let createCount = 0;
  let enableCount = 0;
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const parsed = eventsForFile(file.sql);
    for (const u of parsed.unresolved) unresolved.push({ ...u, file: file.name });
    for (const ev of parsed.events) {
      if (ev.kind === "create") {
        live.add(ev.name);
        rlsOn.delete(ev.name);
        createCount++;
      } else if (ev.kind === "drop") {
        live.delete(ev.name);
        rlsOn.delete(ev.name);
      } else if (ev.kind === "enable") {
        rlsOn.add(ev.name);
        enableCount++;
      } else {
        rlsOn.delete(ev.name);
      }
    }
  }
  return { live, rlsOn, unresolved, createCount, enableCount };
}

// ---------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------

/**
 * Pure checker; all I/O injected so `--self-test` drives every failure mode
 * from fixtures instead of mutating the repo.
 *
 * @param {{name:string, sql:string}[]} a.files          migration files
 * @param {unknown}                     a.allowlistJson  parsed rls-allowlist.json
 * @param {string|null}                 a.workflowText   the live-half workflow, or null
 * @param {string|null}                 a.retiredAuditSource  source of the RETIRED
 *        predecessor audit if it has reappeared on disk, else null (C6)
 * @param {string|null}    [a.adversarialWorkflowText] the workflow that runs the
 *        tester-owned adversarial suite, or null if it is missing (C8)
 * @param {boolean}        [a.adversarialSuiteExists]  whether that suite is on disk (C8)
 * @param {boolean}                     [a.enforceFloor] apply MIN_LIVE_TABLES
 * @returns {string[]} failures
 */
export function runChecks({
  files,
  allowlistJson,
  workflowText,
  retiredAuditSource = null,
  adversarialWorkflowText = undefined,
  adversarialSuiteExists = undefined,
  enforceFloor = true,
}) {
  const failures = [];

  // C4 — anti-vacuity. Discovering nothing is a FAILURE, never a pass.
  if (!files.length) {
    failures.push(
      `C4 [vacuity]: discovered ZERO .sql files under ${MIGRATIONS_DIR}. A gate that ` +
        `matches nothing must fail, not pass.`,
    );
    return failures;
  }

  const { live, rlsOn, unresolved, createCount, enableCount } = replayChain(files);

  if (createCount === 0) {
    failures.push(
      `C4 [vacuity]: parsed ${files.length} migration file(s) and found ZERO ` +
        `CREATE TABLE … public.<name> statements. The parser is broken, not the schema.`,
    );
    return failures;
  }
  if (enableCount === 0) {
    failures.push(
      `C4 [vacuity]: found ZERO ENABLE ROW LEVEL SECURITY statements across ` +
        `${files.length} migration file(s). Every table would report as a violation ` +
        `for the wrong reason.`,
    );
    return failures;
  }
  if (enforceFloor && live.size < MIN_LIVE_TABLES) {
    failures.push(
      `C4 [vacuity]: the chain replayed to only ${live.size} live public tables, below ` +
        `the floor of ${MIN_LIVE_TABLES}. Either the parser regressed or the schema ` +
        `shrank by a third; both need a human, neither is a pass.`,
    );
    return failures;
  }

  // C7 — R5. Fail closed on dynamic DDL this parser cannot resolve. Reported
  // BEFORE C1 because an unresolved create means the C1 answer is incomplete.
  for (const u of unresolved) {
    failures.push(
      u.kind === "opaque"
        ? `C7: ${u.file} runs EXECUTE on a statement with no literal argument, so its DDL ` +
          `cannot be read: "${u.excerpt}". A statement built up in a variable could create a ` +
          `table this gate would never see. Inline the DDL, or drive it from a FOREACH-bound ` +
          `format() template. Refusing is deliberate — ignoring it is how a table goes missing.`
        : `C7: ${u.file} runs a dynamic ${u.kind.toUpperCase()} whose table cannot be resolved: ` +
          `"${u.excerpt}". It is not inside a FOREACH … ARRAY[…] loop this gate can read, so the ` +
          `table names are unknown. A dynamic CREATE that cannot be resolved makes a table ` +
          `INVISIBLE here — a false green on a genuinely unprotected schema.`,
    );
  }

  // C2 — the exemption list is EXACTLY the reviewed one. Equality only: this
  // file is never consulted when deciding violations, so it can fail but never excuse.
  const declared = Array.isArray(allowlistJson?.tables) ? allowlistJson.tables : null;
  if (declared === null) {
    failures.push(`C2: ${ALLOWLIST_PATH} has no "tables" array. It is the only exemption list; it must exist.`);
  } else {
    const got = [...declared].sort();
    const want = [...EXEMPT].sort();
    if (got.length !== want.length || got.some((t, i) => t !== want[i])) {
      failures.push(
        `C2: ${ALLOWLIST_PATH} lists [${got.join(", ")}] but the reviewed exemption set is ` +
          `[${want.join(", ")}]. Every extra name is a table nobody is constraining. ` +
          `Widening this list means editing EXEMPT in issue-1860-public-tables-rls-enabled.mjs ` +
          `too — deliberately, in a reviewed diff, with a reason.`,
      );
    }
  }

  // C3 — the exemption cannot be repurposed for a table we own. `spatial_ref_sys`
  // is exempt precisely because the PostGIS extension creates it, not us.
  for (const t of EXEMPT) {
    if (live.has(t)) {
      failures.push(
        `C3: "${t}" is exempt because it is extension-owned, but a migration in this ` +
          `repo CREATEs it. An exemption for a table we create is an exemption for ` +
          `nothing — enable RLS on it or remove it from EXEMPT.`,
      );
    }
  }

  // C1 — the rule itself.
  const exempt = new Set(EXEMPT);
  const violations = [...live].filter((t) => !exempt.has(t) && !rlsOn.has(t)).sort();
  for (const t of violations) {
    failures.push(
      `C1: public.${t} is created by the migration chain and never gets ENABLE ROW ` +
        `LEVEL SECURITY. RLS is the only constraint on this schema — without it the ` +
        `table has none. Add the ALTER in a forward-only migration.`,
    );
  }

  // C5 — the live half must stay wired, or this static half is all that is left.
  if (workflowText === null) {
    failures.push(`C5: ${LIVE_TEST_WORKFLOW} is missing. The live catalog half of #1860 runs there.`);
  } else if (!stripYamlComments(workflowText).includes(LIVE_TEST_PATH)) {
    failures.push(
      `C5: ${LIVE_TEST_WORKFLOW} no longer invokes ${LIVE_TEST_PATH}. Source parsing ` +
        `cannot see pg_class; that file is the only thing asserting the REAL applied ` +
        `schema. Un-wiring it makes this gate the whole of #1860, which it is not.`,
    );
  }

  // C6 — the retired predecessor audit must stay retired.
  //
  // It was deleted at #1860 TEST, on the tester's recommendation and the
  // orchestrator's approval, for reasons that cannot be patched: its CREATE and
  // DROP patterns matched only the double-quoted dump style, so every table
  // created since the baseline was invisible to it — it was green because it
  // barely looked — while presenting as a second independent audit of this
  // ground. Two audits of unequal strength claiming the same ground is the
  // condition that produced this issue.
  //
  // This rule replaces an earlier one that banned a single `.startsWith(`
  // spelling of its prefix-skip laundering channel; a regex spelling walked
  // straight past that. Policing spellings of a hazard inside a file is a losing
  // game — the file is gone, and this keeps it gone.
  if (retiredAuditSource !== null) {
    failures.push(
      `C6: ${RETIRED_AUDIT_PATH} is back on disk. It was retired at #1860 because it was ` +
        `near-vacuous (dump-style patterns only) while reading as a second audit of the same ` +
        `ground. Restoring it re-creates the "two audits of unequal strength" condition this ` +
        `issue came from. If a second audit is genuinely wanted, it needs its own review, not ` +
        `a resurrection.`,
    );
  }

  // C8 — the tester-owned adversarial suite must stay on disk AND stay wired.
  //
  // It lives outside `.github/scripts/strict-grep/`, so MANIFEST.json does not
  // sweep it and run-batch.mjs does not run it — it has no ORCH-1383 protection
  // of its own. It is also the only suite that anchors this gate to the REAL
  // chain (replay without the #1860 migration and require the answer to change),
  // so losing it would leave a fixture-only proof of a repo-wide claim. Checked
  // on COMMENT-STRIPPED yaml: a commented-out step reads as wired to a plain
  // substring match, which is a mistake this directory has already made once.
  //
  // Skipped when the caller does not supply the inputs, so fixture-driven
  // callers (the self-test, the adversarial suite itself) are not forced to
  // model CI wiring that is not what they are testing.
  if (adversarialSuiteExists !== undefined || adversarialWorkflowText !== undefined) {
    if (adversarialSuiteExists === false) {
      failures.push(
        `C8: ${ADVERSARIAL_SUITE_PATH} does not exist. It is the only suite anchoring this ` +
          `gate to the real migration chain; without it, "zero violations" is equally ` +
          `consistent with a parser that has stopped seeing tables.`,
      );
    }
    if (adversarialWorkflowText == null) {
      failures.push(
        `C8: ${ADVERSARIAL_WORKFLOW} is missing. Nothing in MANIFEST.json sweeps ` +
          `${ADVERSARIAL_SUITE_PATH}, so that workflow is the only thing running it.`,
      );
    } else if (!stripYamlComments(adversarialWorkflowText).includes(ADVERSARIAL_SUITE_PATH)) {
      failures.push(
        `C8: ${ADVERSARIAL_WORKFLOW} no longer invokes ${ADVERSARIAL_SUITE_PATH} in executable ` +
          `(non-comment) yaml. A gate on disk that no job runs is the dark-gate shape this repo ` +
          `has produced six times.`,
      );
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Real-chain loading, shared by the repo scan and by the anchored self-tests.
// ---------------------------------------------------------------------------

export function loadChain({ includeFix = true } = {}) {
  const abs = join(root, MIGRATIONS_DIR);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (includeFix ? true : !f.endsWith(FIX_MIGRATION_MARKER)))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(abs, f), "utf8") }));
}

const readOrNull = (rel) => {
  const abs = join(root, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
};

// ---------------------------------------------------------------------------
// Self-test.
// ---------------------------------------------------------------------------

function selfTest() {
  const results = [];
  const check = (label, failures, shouldFail, needle) => {
    const failed = failures.length > 0;
    const ok = failed === shouldFail && (!shouldFail || failures.some((f) => f.includes(needle)));
    results.push({ label, ok, failures });
  };

  const base = (over = {}) => ({
    files: [
      {
        name: "001_base.sql",
        sql: `
CREATE TABLE "public"."ok_literal" (id uuid primary key);
ALTER TABLE "public"."ok_literal" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.ok_unquoted (id uuid primary key);
ALTER TABLE public.ok_unquoted ENABLE ROW LEVEL SECURITY;
`,
      },
    ],
    allowlistJson: { tables: ["spatial_ref_sys"] },
    workflowText: `        run: |\n          psql -f ${LIVE_TEST_PATH}\n`,
    retiredAuditSource: null,
    enforceFloor: false,
    ...over,
  });

  const one = (sql) => base({ files: [{ name: "001.sql", sql: `CREATE TABLE "public"."anchor" (id uuid);\nALTER TABLE "public"."anchor" ENABLE ROW LEVEL SECURITY;\n${sql}` }] });

  // ---- the rule ----------------------------------------------------------
  check("T-1 clean chain passes", runChecks(base()), false);

  // THE CORE. A table created without RLS must FAIL. A gate that passes on a
  // broken schema is worse than no gate, and this repo has shipped that before.
  check("T-2 a table with RLS off FAILS", runChecks(one(`CREATE TABLE "public"."naked" (id uuid);`)), true, "C1: public.naked");

  // ---- R1: comments are never DDL ---------------------------------------
  check(
    "T-3 a DROP inside a COMMENT string does not hide a table",
    runChecks(
      one(`CREATE TABLE "public"."ghost" (id uuid);
COMMENT ON TABLE "public"."ghost" IS 'after this date the operator runs: DROP TABLE public.ghost;';`),
    ),
    true,
    "C1: public.ghost",
  );
  check(
    "T-4 an ENABLE written as prose does not launder a table green",
    runChecks(
      one(`CREATE TABLE "public"."prose" (id uuid);
-- ALTER TABLE public.prose ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE "public"."prose" IS 'ALTER TABLE public.prose ENABLE ROW LEVEL SECURITY';`),
    ),
    true,
    "C1: public.prose",
  );

  // ---- R2: literals inside DO bodies are never DDL (the F-1 regression) --
  check(
    "T-5 [F-1] a RAISE NOTICE inside a DO block cannot fake an ENABLE",
    runChecks(
      one(`CREATE TABLE public.notice_laundered (id uuid);
DO $b$ BEGIN
  RAISE NOTICE 'ALTER TABLE public.notice_laundered ENABLE ROW LEVEL SECURITY';
END $b$;`),
    ),
    true,
    "C1: public.notice_laundered",
  );
  check(
    "T-6 [F-1] a variable assignment inside a DO block cannot fake an ENABLE",
    runChecks(
      one(`CREATE TABLE public.assigned (id uuid);
DO $b$ DECLARE v text; BEGIN
  v := 'ALTER TABLE public.assigned ENABLE ROW LEVEL SECURITY';
END $b$;`),
    ),
    true,
    "C1: public.assigned",
  );
  check(
    "T-7 [F-1] a RAISE EXCEPTION inside a DO block cannot fake an ENABLE",
    runChecks(
      one(`CREATE TABLE public.raised (id uuid);
DO $b$ BEGIN
  IF false THEN RAISE EXCEPTION 'ALTER TABLE public.raised ENABLE ROW LEVEL SECURITY'; END IF;
END $b$;`),
    ),
    true,
    "C1: public.raised",
  );
  check(
    "T-8 [F-1] a DROP inside a DO-body string does NOT hide a live table",
    runChecks(
      one(`CREATE TABLE public.hidden_by_do (id uuid);
DO $b$ BEGIN
  RAISE NOTICE 'housekeeping: DROP TABLE public.hidden_by_do;';
END $b$;`),
    ),
    true,
    "C1: public.hidden_by_do",
  );
  check(
    "T-9 [F-1] a dollar-quoted literal inside a DO block cannot fake an ENABLE",
    runChecks(
      one(`CREATE TABLE public.dollar_laundered (id uuid);
DO $b$ DECLARE v text; BEGIN
  v := $q$ALTER TABLE public.dollar_laundered ENABLE ROW LEVEL SECURITY$q$;
END $b$;`),
    ),
    true,
    "C1: public.dollar_laundered",
  );

  // ---- R3: genuine DDL still counts, in every shape the chain uses -------
  check(
    "T-10 literal DDL inside a DO block counts",
    runChecks(
      one(`CREATE TABLE public.in_do (id uuid);
DO $b$ BEGIN
  ALTER TABLE public.in_do ENABLE ROW LEVEL SECURITY;
END $b$;`),
    ),
    false,
  );
  check(
    "T-11 a DO-block FOREACH loop enables RLS",
    runChecks(
      one(`CREATE TABLE public.loop_a (id uuid);
CREATE TABLE public.loop_b (id uuid);
DO $block$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'loop_a',
    'loop_b'
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      v_table
    );
  END LOOP;
END;
$block$;`),
    ),
    false,
  );
  check(
    "T-12 an EXECUTE of a literal DDL string counts",
    runChecks(
      one(`CREATE TABLE public.exec_literal (id uuid);
DO $b$ BEGIN
  EXECUTE 'ALTER TABLE public.exec_literal ENABLE ROW LEVEL SECURITY';
END $b$;`),
    ),
    false,
  );
  check(
    "T-13 [R4] the same loop inside a CREATE FUNCTION body does NOT count",
    runChecks(
      one(`CREATE TABLE public.dormant (id uuid);
CREATE OR REPLACE FUNCTION public.someday() RETURNS void LANGUAGE plpgsql AS $function$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['dormant'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END;
$function$;`),
    ),
    true,
    "C1: public.dormant",
  );

  // ---- F-2 + R5: dynamic creates ----------------------------------------
  check(
    "T-14 [F-2] a table CREATEd by a FOREACH format() loop is visible and its missing RLS FAILS",
    runChecks(
      one(`DO $block$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['dynamic_naked'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid)', v_table);
  END LOOP;
END;
$block$;`),
    ),
    true,
    "C1: public.dynamic_naked",
  );
  check(
    "T-15 [F-2] a FOREACH-created table WITH an enable in the same loop passes",
    runChecks(
      one(`DO $block$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['dynamic_ok'] LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid)', v_table);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END;
$block$;`),
    ),
    false,
  );
  check(
    "T-16 [F-2/R5] an UNRESOLVABLE dynamic CREATE fails CLOSED",
    runChecks(
      one(`DO $b$ DECLARE v text; BEGIN
  v := 'orphan';
  EXECUTE format('CREATE TABLE public.%I (id uuid)', v);
END $b$;`),
    ),
    true,
    "C7:",
  );
  check(
    "T-17 [R5] an EXECUTE with no literal argument fails CLOSED",
    runChecks(
      one(`DO $b$ DECLARE v_sql text; BEGIN
  v_sql := 'something';
  EXECUTE v_sql;
END $b$;`),
    ),
    true,
    "C7:",
  );
  check(
    "T-18 [R5] an unresolvable dynamic DROP is the SAFE direction and is NOT a failure",
    runChecks(
      one(`DO $b$ DECLARE v text; BEGIN
  v := 'anchor';
  EXECUTE format('DROP TABLE public.%I', v);
END $b$;`),
    ),
    false,
  );

  // ---- F-3 + R6: RLS can be turned back off -----------------------------
  check(
    "T-19 [F-3] a later DISABLE clears an earlier ENABLE",
    runChecks(
      one(`CREATE TABLE public.reopened (id uuid);
ALTER TABLE public.reopened ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reopened DISABLE ROW LEVEL SECURITY;`),
    ),
    true,
    "C1: public.reopened",
  );
  check(
    "T-20 [F-3] a DISABLE in a LATER migration file also counts",
    runChecks(
      base({
        files: [
          { name: "001.sql", sql: `CREATE TABLE public.later (id uuid);\nALTER TABLE public.later ENABLE ROW LEVEL SECURITY;` },
          { name: "002.sql", sql: `ALTER TABLE public.later DISABLE ROW LEVEL SECURITY;` },
        ],
      }),
      ),
    true,
    "C1: public.later",
  );
  check(
    "T-21 [F-3] a DISABLE inside a DO-body STRING is prose and does not re-open a table",
    runChecks(
      one(`CREATE TABLE public.safe (id uuid);
ALTER TABLE public.safe ENABLE ROW LEVEL SECURITY;
DO $b$ BEGIN RAISE NOTICE 'never do: ALTER TABLE public.safe DISABLE ROW LEVEL SECURITY'; END $b$;`),
    ),
    false,
  );
  check(
    "T-22 [R6] a re-CREATE after a DROP resets RLS state",
    runChecks(
      base({
        files: [
          { name: "001.sql", sql: `CREATE TABLE "public"."recycled" (id uuid);\nALTER TABLE "public"."recycled" ENABLE ROW LEVEL SECURITY;` },
          { name: "002.sql", sql: `DROP TABLE "public"."recycled";\nCREATE TABLE "public"."recycled" (id uuid, extra text);` },
        ],
      }),
    ),
    true,
    "C1: public.recycled",
  );
  check("T-23 a real DROP removes the table from scope", runChecks(one(`CREATE TABLE "public"."temp_thing" (id uuid);\nDROP TABLE "public"."temp_thing";`)), false);

  // ---- G-1: an EXECUTE ARGUMENT is data, never DDL -----------------------
  check(
    "T-34 [G-1] a %L data argument spelling an ENABLE does not protect a table",
    runChecks(
      one(`CREATE TABLE public.data_faked (id uuid);
DO $b$ BEGIN
  EXECUTE format('INSERT INTO public.audit_log(msg) VALUES (%L)',
                 'ALTER TABLE public.data_faked ENABLE ROW LEVEL SECURITY');
END $b$;`),
    ),
    true,
    "C1: public.data_faked",
  );
  check(
    "T-35 [G-1] a %L data argument spelling a DROP does not hide a live table",
    runChecks(
      one(`CREATE TABLE public.data_hidden (id uuid);
DO $b$ BEGIN
  EXECUTE format('INSERT INTO public.audit_log(msg) VALUES (%L)',
                 'DROP TABLE public.data_hidden;');
END $b$;`),
    ),
    true,
    "C1: public.data_hidden",
  );
  check(
    "T-36 [G-1] a USING parameter spelling an ENABLE does not protect a table",
    runChecks(
      one(`CREATE TABLE public.using_faked (id uuid);
DO $b$ BEGIN
  EXECUTE 'INSERT INTO public.audit_log(msg) VALUES (x)'
    USING 'ALTER TABLE public.using_faked ENABLE ROW LEVEL SECURITY';
END $b$;`),
    ),
    true,
    "C1: public.using_faked",
  );
  check(
    "T-37 [G-1] the necessary other half: a real template still resolves when data arguments follow it",
    runChecks(
      one(`CREATE TABLE public.tmpl_ok (id uuid);
DO $b$ DECLARE v text; BEGIN
  FOREACH v IN ARRAY ARRAY['tmpl_ok'] LOOP
    EXECUTE format('ALTER TABLE public.%I '
                   'ENABLE ROW LEVEL SECURITY', v || '_ignored_data');
  END LOOP;
END $b$;`),
    ),
    false,
  );

  // ---- G-2: E'…' escape strings ------------------------------------------
  check(
    "T-38 [G-2] an E-string COMMENT body at TOP level does not hide a live table",
    runChecks(
      one(`CREATE TABLE public.e_hidden (id uuid);
COMMENT ON TABLE public.e_hidden IS E'don\\'t forget: DROP TABLE public.e_hidden;';`),
    ),
    true,
    "C1: public.e_hidden",
  );
  check(
    "T-39 [G-2] an E-string inside a DO body cannot fake an ENABLE",
    runChecks(
      one(`CREATE TABLE public.e_faked (id uuid);
DO $b$ BEGIN
  RAISE NOTICE E'can\\'t: ALTER TABLE public.e_faked ENABLE ROW LEVEL SECURITY';
END $b$;`),
    ),
    true,
    "C1: public.e_faked",
  );
  check(
    "T-40 [G-2] a U&'…' literal is still masked — the E fix must not be over-applied",
    runChecks(
      one(`CREATE TABLE public.u_hidden (id uuid);
COMMENT ON TABLE public.u_hidden IS U&'later: DROP TABLE public.u_hidden;';`),
    ),
    true,
    "C1: public.u_hidden",
  );
  check(
    "T-41 [G-2] an ordinary (non-E) literal still ends at the first undoubled quote",
    runChecks(one(`CREATE TABLE public.plain_ok (id uuid);\nALTER TABLE public.plain_ok ENABLE ROW LEVEL SECURITY;\nCOMMENT ON TABLE public.plain_ok IS 'a backslash \\ is literal here';`)),
    false,
  );

  // ---- exemption + wiring ------------------------------------------------
  check("T-24 a second exemption FAILS", runChecks(base({ allowlistJson: { tables: ["spatial_ref_sys", "seed_map_presence"] } })), true, "C2:");
  check("T-25 an empty exemption list FAILS", runChecks(base({ allowlistJson: { tables: [] } })), true, "C2:");
  check(
    "T-26 exempting a table this repo creates FAILS",
    runChecks(one(`CREATE TABLE "public"."spatial_ref_sys" (srid integer);\nALTER TABLE "public"."spatial_ref_sys" ENABLE ROW LEVEL SECURITY;`)),
    true,
    "C3:",
  );
  check("T-27 un-wiring the live SQL test FAILS", runChecks(base({ workflowText: "jobs:\n  migrations:\n    steps: []\n" })), true, "C5:");
  check(
    "T-27b [C5] a COMMENTED-OUT live-test line does not count as wired",
    runChecks(base({ workflowText: `jobs:\n  migrations:\n    steps:\n      # - run: psql -f ${LIVE_TEST_PATH}\n` })),
    true,
    "C5:",
  );
  check(
    "T-28 [F-4] resurrecting the retired predecessor audit FAILS, whatever it contains",
    runChecks(base({ retiredAuditSource: `if (/^_archive_/.test(table)) continue;` })),
    true,
    "C6:",
  );

  // ---- C8: the tester-owned adversarial suite cannot go dark -------------
  const wiredAdversarial = `      - run: node --test ${ADVERSARIAL_SUITE_PATH}\n`;
  check(
    "T-28b [C8] a properly wired adversarial suite passes",
    runChecks(base({ adversarialSuiteExists: true, adversarialWorkflowText: wiredAdversarial })),
    false,
  );
  check(
    "T-28c [C8] deleting the adversarial suite FAILS",
    runChecks(base({ adversarialSuiteExists: false, adversarialWorkflowText: wiredAdversarial })),
    true,
    "C8:",
  );
  check(
    "T-28d [C8] a workflow that only MENTIONS the suite in a comment FAILS",
    runChecks(
      base({
        adversarialSuiteExists: true,
        adversarialWorkflowText: `      # runs ${ADVERSARIAL_SUITE_PATH} one day\n      - run: echo skip\n`,
      }),
    ),
    true,
    "C8:",
  );
  check(
    "T-28e [C8] deleting the adversarial workflow FAILS",
    runChecks(base({ adversarialSuiteExists: true, adversarialWorkflowText: null })),
    true,
    "C8:",
  );

  // ---- vacuity -----------------------------------------------------------
  check("T-29 zero migration files FAILS", runChecks(base({ files: [] })), true, "C4 [vacuity]");
  check("T-30 a chain with no CREATE TABLE FAILS", runChecks(base({ files: [{ name: "001.sql", sql: "SELECT 1;" }] })), true, "C4 [vacuity]");
  check("T-31 the live-table floor FAILS a tiny chain", runChecks(base({ enforceFloor: true })), true, "C4 [vacuity]");

  // ---- ANCHORED TO THE REAL CHAIN ---------------------------------------
  // The #1860 tester proved the previous fixture-only suite stayed 15/15 green
  // when the real migration was deleted line by line. A suite that can only ever
  // be asked questions it ships the answers to cannot tell a working gate from a
  // deleted fix. These two read the chain on disk.
  const realChain = loadChain();
  const realInputs = {
    allowlistJson: { tables: [...EXEMPT] },
    workflowText: `psql -f ${LIVE_TEST_PATH}`,
    retiredAuditSource: null,
    enforceFloor: true,
  };
  {
    const failures = runChecks({ ...realInputs, files: realChain });
    results.push({
      label: "T-32 [ANCHOR] the REAL migration chain leaves no public table without RLS",
      ok: realChain.length > 400 && failures.length === 0,
      failures: realChain.length > 400 ? failures : [`read only ${realChain.length} migrations — not the real chain`],
    });
  }
  {
    // T-34..T-41 guard two code paths. If the real chain never took either, they
    // would be fixtures defending dead code — true, and worth nothing. This
    // anchors both to the schema as it actually is.
    const eFiles = realChain.filter((f) => /(^|[^A-Za-z0-9_$])[Ee]'/.test(f.sql)).length;
    let multiRun = 0;
    for (const f of realChain) {
      for (const body of segment(maskComments(f.sql)).doBodies) {
        const lits = stringLiterals(body.text);
        const masked = maskStringLiterals(body.text);
        for (const m of matches(/\bEXECUTE\b/gi, masked)) {
          const semi = masked.indexOf(";", m.index);
          const end = semi === -1 ? masked.length : semi;
          const inRange = lits.filter((l) => l.start >= m.index && l.end <= end + 1);
          let runs = 0;
          let prevEnd = -1;
          for (const lit of inRange) {
            if (prevEnd === -1 || !/^\s*$/.test(body.text.slice(prevEnd, lit.start))) runs++;
            prevEnd = lit.end;
          }
          if (runs > 1) multiRun++;
        }
      }
    }
    results.push({
      label: "T-42 [ANCHOR] the REAL chain exercises both G-1 and G-2 paths (they are not dead code)",
      ok: eFiles >= 10 && multiRun >= 5,
      failures:
        eFiles >= 10 && multiRun >= 5
          ? []
          : [`chain has ${eFiles} files using E'-strings and ${multiRun} multi-run EXECUTEs; the G-1/G-2 fixtures would be guarding paths the chain never takes`],
    });
  }
  {
    const withoutFix = loadChain({ includeFix: false });
    const failures = runChecks({ ...realInputs, files: withoutFix });
    const c1 = failures.filter((f) => f.startsWith("C1:"));
    results.push({
      label: "T-33 [ANCHOR] removing the #1860 migration makes the REAL chain FAIL",
      ok: realChain.length - withoutFix.length === 1 && c1.length >= 10,
      failures:
        realChain.length - withoutFix.length === 1
          ? c1.length >= 10
            ? []
            : [`only ${c1.length} C1 violations with the fix removed; the fix is not load-bearing, so T-32 proves nothing`]
          : [`expected exactly one migration matching ${FIX_MIGRATION_MARKER}`],
    });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.label}`);
    if (!r.ok) for (const f of r.failures) console.log(`        ${f}`);
  }
  if (failed.length) {
    console.error(`issue-1860 self-test FAILED: ${failed.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`issue-1860 self-test passed (${results.length}/${results.length}).`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Repo scan.
// ---------------------------------------------------------------------------

function main() {
  const files = loadChain();

  let allowlistJson = null;
  const allowlistRaw = readOrNull(ALLOWLIST_PATH);
  if (allowlistRaw !== null) {
    try {
      allowlistJson = JSON.parse(allowlistRaw);
    } catch (err) {
      console.error(`issue-1860 gate failed: ${ALLOWLIST_PATH} is not valid JSON — ${err.message}`);
      process.exit(1);
    }
  }

  if (!existsSync(join(root, LIVE_TEST_PATH))) {
    console.error(
      `issue-1860 gate failed:\n- C5: ${LIVE_TEST_PATH} does not exist. The live catalog half of ` +
        `#1860 is the only assertion against the REAL applied schema.`,
    );
    process.exit(1);
  }

  const failures = runChecks({
    files,
    allowlistJson,
    workflowText: readOrNull(LIVE_TEST_WORKFLOW),
    retiredAuditSource: readOrNull(RETIRED_AUDIT_PATH),
    adversarialWorkflowText: readOrNull(ADVERSARIAL_WORKFLOW),
    adversarialSuiteExists: existsSync(join(root, ADVERSARIAL_SUITE_PATH)),
    enforceFloor: true,
  });

  if (failures.length > 0) {
    console.error("issue-1860 public-tables-RLS gate failed:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }

  const { live } = replayChain(files);
  console.log(
    `issue-1860 public-tables-RLS gate passed (${files.length} migrations, ${live.size} live public ` +
      `tables, ${EXEMPT.length} reviewed exemption: ${EXEMPT.join(", ")}). ` +
      `Scope: RLS is PRESENT on all of them — not that it constrains. ` +
      `This is the EARLY half and it parses text; ` +
      `${LIVE_TEST_PATH} reads pg_class and is the authoritative one.`,
  );
}

// Entry-point guard, and it MUST use pathToFileURL. A naive
// `file://${process.argv[1]}` comparison silently fails whenever the checkout
// path contains characters the URL spec percent-encodes — e.g. the `[` `]` in
// the per-issue worktree `1860-[rls-disabled-tables]` this gate was written in.
// ORCH-1383's runner was bitten by exactly that and exited 0 having run nothing.
// The guard also keeps `runChecks` importable by an adversarial suite without
// the import triggering a full repo scan and a process.exit.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry !== null && import.meta.url === entry) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
