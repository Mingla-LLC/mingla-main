#!/usr/bin/env node
// #2305 [buyers whose name differs from an existing record are dropped from the
// contact book] — the class guard.
//
// Enforces I-PROPOSED-2305-CONFLICT-QUEUE-HAS-A-RESOLVER:
//
//   A table that models a RESOLUTION LIFECYCLE — a status-shaped text column
//   whose CHECK admits two or more values, paired with a NULLABLE
//   `resolved_at` / `reversed_at` / `completed_at`-shaped timestamp — must have,
//   somewhere in `supabase/migrations/**`:
//
//     (A) a READER: a `SELECT ... FROM <table>` outside the table's own DDL, and
//     (B) an ADVANCER: an `UPDATE <table> SET ... status = '<non-initial>'`, and
//     (C) a REACHABLE advancer: the function CONTAINING that UPDATE must itself
//         be invoked from production code — a migration, an edge function, or
//         the apps. An advancing statement that only a test can reach is a
//         resolution path that does not exist in production.
//
//   Unless the table is on the frozen WRITE_ONLY_BY_DESIGN allowlist below,
//   with a reason and an issue number.
//
// WHY THIS EXISTS. `brand_person_identity_conflicts` shipped in 20270305001770
// with TEN INSERT sites across four ingest paths, a three-state CHECK
// (`open` / `resolved_merge` / `resolved_separate`), a `resolved_by` FK, and
// `CONSTRAINT brand_person_conflict_resolution_shape CHECK ((status='open' AND
// resolved_at IS NULL) OR (status<>'open' AND resolved_at IS NOT NULL))`.
//
// The string `resolved_at` appeared NOWHERE ELSE in the entire repo — only
// inside that constraint. The schema is a blueprint for a resolution path that
// was never built, and the constraint is the proof it was intended. `open` was
// not a starting state; it was the ONLY state, and the table was an append-only
// landfill. Measured cost: 11 open conflicts on production resolving to 3
// distinct buyers, 3 of 13 confirmed paid orders (23%) orphaned with no source
// link, the oldest filed 2026-06-27 and dropped 2026-08-13 with the brand never
// told. Every test was green the whole time.
//
// SAME CLASS AS #2168, #2222 AND #2290, ONE LAYER UP. #2290 was a worker with no
// cron caller — a switch nothing flips. This is a write with no reader — a form
// nobody collects. Both survive the same way: the write path is fully tested,
// the constraint is correct, the types line up, `deno check` is clean, CI is
// green, and the feature is dead in production. The #2290 gate structurally
// cannot catch this one: its unit of analysis is an edge function and its
// evidence is a row in `cron.job`; this defect's unit is a TABLE and its
// evidence is the ABSENCE of a `SELECT`.
//
// ---------------------------------------------------------------------------
// SCOPE, AND WHY IT IS NOT WIDER — read this before "generalising" the gate.
// ---------------------------------------------------------------------------
// The #2305 orchestrator REVIEW asked whether this gate could catch the whole
// write-with-no-reader shape, INCLUDING `biz_reverse_brand_person_merge`: a
// fully implemented reversal with a manifest that NOTHING calls, the third
// instance of the class found in one session.
//
// It can, and condition (C) is how — but only because (C) is scoped to the
// advancing functions of lifecycle TABLES. The obvious wider rule, "any SQL
// function with no caller", was measured against this repo before being
// rejected: 785 functions are defined under `supabase/migrations/`, and **27
// SECURITY DEFINER functions are never invoked from production code today**
// (`biz_list_brand_people`, `biz_guest_roster_summary`, `pg_cancel_guest_
// reservation`, six `issue_1930_*` helpers, and 18 more). Shipping that rule
// would red `main` on day one and force a 27-entry allowlist — precisely the
// "frozen list nobody re-checks" failure mode the #2290 gate warns about, and a
// gate everyone bypasses is a gate that carries no information (#2113).
//
// So the honest narrow scope is: the gate's unit is the LIFECYCLE TABLE. It
// discovers 28 of them in this repo and demands, for each, a reader, an
// advancer, and a REACHABLE advancer. #1772 made the brand-person merge reversal
// lifecycle reachable through its authorization-enforcing manual wrapper and
// Business RPC caller, so 26 now satisfy the rule; the remaining two are
// allowlisted below by NAME and REASON, which is the point — the gate SEES them.
//
// Modes:
//   node issue-2305-status-table-has-a-resolver.mjs              — enforce
//   node issue-2305-status-table-has-a-resolver.mjs --self-test  — prove it detects

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const MIGRATIONS_DIR = "supabase/migrations";
/** Directories swept for production callers of an advancing function. */
const CALLER_DIRS = [
  "supabase/functions",
  "mingla-business/src",
  "mingla-business/app",
  "mingla-admin/src",
  "app-mobile/src",
  "packages",
];

/**
 * Lifecycle tables that legitimately have no reachable resolution path, each
 * with a reason and an issue number. This list may only SHRINK; a new entry is
 * a new dead lifecycle. `EXPECTED_EXEMPT` below is asserted exactly so one
 * cannot be laundered in alongside an unrelated change, and a STALE entry — one
 * that no longer matches a discovered table — FAILS this gate, so the allowlist
 * can never quietly widen into a list of names nobody re-checks.
 */
const WRITE_ONLY_BY_DESIGN = new Map([
  [
    "ad_app_acquisition_canaries",
    "#2015 — a SEVEN-state lifecycle ('not_started' -> approval_required -> " +
      "paused_ready -> running -> passed/failed/expired) with a `completed_at` " +
      "and THREE CHECK constraints coupling the status to founder-approval, " +
      "spend-ceiling and evidence columns. The only UPDATEs in the repo " +
      "(20270402002015 and 20270402002041) both RESET status to 'not_started'; " +
      "nothing anywhere advances it. Same signature as #2305's own table: the " +
      "constraints are the proof a lifecycle was intended and never built. " +
      "PRE-EXISTING and outside #2305's allowlist — filed for the orchestrator, " +
      "not fixed here.",
  ],
  [
    "event_private_media_transition_jobs",
    "#1931 — an EIGHT-state media transition machine ('preparing' -> " +
      "ready_to_finalize -> finalizing -> completed | failed_retryable | " +
      "failed_manual_review | cleanup_pending | cancelled_pre_revoke) with " +
      "revocation start/complete timestamps and an attempt counter. There is " +
      "not a single `UPDATE public.event_private_media_transition_jobs` " +
      "anywhere in the repo — rows are only ever INSERTed (and only by a test). " +
      "PRE-EXISTING and outside #2305's allowlist — filed for the orchestrator, " +
      "not fixed here.",
  ],
]);
const EXPECTED_EXEMPT = WRITE_ONLY_BY_DESIGN.size;

/** A column name that reads as a lifecycle status. */
const STATUS_RE = /^(?:[a-z0-9_]*_)?(?:status|state|outcome)$/;
/** A nullable timestamp that reads as "the lifecycle ended here". */
const TERMINAL_TS_RE =
  /^[a-z0-9_]*(?:resolved|reversed|closed|completed|settled|cancelled|finished|archived|executed)_at$/;

/** `$tag$` / `$$` opening at `i`, or null. */
function dollarTagAt(sql, i) {
  if (sql[i] !== "$") return null;
  const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 64));
  return m ? m[0] : null;
}

/**
 * Remove `--` line comments and block comments WITHOUT touching the inside of a
 * dollar-quoted body or a single-quoted literal. A commented-out reader must
 * not satisfy this gate — #2113 catalogued 60 checks in this repo that could
 * not fail, and one satisfied by a comment would be the 61st.
 */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) return out + sql.slice(i);
      out += sql.slice(i, end + tag.length);
      i = end + tag.length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) return out;
      out += "\n";
      i = nl + 1;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return out;
      out += " ";
      i = end + 2;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/**
 * Blank out single-quoted SQL literals, preserving dollar-quoted bodies (which
 * hold real code). Used ONLY for the reachability scan.
 *
 * Without this the gate credits a function as "called" when its signature merely
 * appears inside a quoted string — and this repo does exactly that: migration
 * 20270305001770 lists `'public.biz_reverse_brand_person_merge(uuid,uuid)'` in a
 * security-assertion ARRAY, which looks like a call to any regex that reads call
 * position. That single false positive would have laundered the third instance
 * of the write-with-no-reader class green, which is the whole reason condition
 * (C) exists.
 */
export function stripSqlLiterals(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) return out + sql.slice(i);
      // RECURSE into the body. A dollar-quoted block is real code, but the
      // single-quoted strings INSIDE it are still strings — and this repo puts
      // its security-assertion arrays inside `DO $assert$ ... $assert$`, so a
      // pass-through would leave `'public.biz_reverse_brand_person_merge(...)'`
      // looking exactly like a call.
      out += tag + stripSqlLiterals(sql.slice(i + tag.length, end)) + tag;
      i = end + tag.length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      out += " ";
      i = j + 1;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** Text between the `(` at `open` and its matching `)`, or null. */
export function balancedArgs(sql, open) {
  let depth = 0;
  let i = open;
  while (i < sql.length) {
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) return null;
      i = end + tag.length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
    i += 1;
  }
  return null;
}

/**
 * Split a CREATE TABLE body into top-level, comma-separated column/constraint
 * clauses. Naive `split(",")` shreds `CHECK (x IN ('a','b'))`.
 */
function topLevelClauses(body) {
  const out = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < body.length) {
    if (body[i] === "'") {
      let j = i + 1;
      while (j < body.length) {
        if (body[j] === "'") {
          if (body[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (body[i] === "(") depth += 1;
    else if (body[i] === ")") depth -= 1;
    else if (body[i] === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  out.push(body.slice(start));
  return out.map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * Every lifecycle table declared across the migration chain: a status-shaped
 * column with a >=2-value CHECK, plus a nullable terminal timestamp.
 */
export function findLifecycleTables(migrations) {
  const found = new Map();
  for (const { file, sql } of migrations) {
    const clean = stripSqlComments(sql);
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z0-9_]+)\s*\(/gi;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const table = m[1];
      if (found.has(table)) continue;
      const body = balancedArgs(clean, m.index + m[0].length - 1);
      if (body === null) continue;
      const clauses = topLevelClauses(body);

      let statusColumn = null;
      let statusValues = 0;
      let initialValue = null;
      for (const clause of clauses) {
        const col = /^([a-z0-9_]+)\s+text\b/i.exec(clause);
        if (col === null || !STATUS_RE.test(col[1])) continue;
        const inList = new RegExp(
          `CHECK\\s*\\(\\s*${col[1]}\\s+IN\\s*\\(([^)]*)\\)`, "i",
        ).exec(clause);
        if (inList === null) continue;
        const values = inList[1]
          .split(",")
          .map((v) => v.trim().replace(/^'|'$/g, ""))
          .filter((v) => v.length > 0);
        if (values.length < 2) continue;
        const def = /DEFAULT\s+'([^']+)'/i.exec(clause);
        statusColumn = col[1];
        statusValues = values.length;
        initialValue = def !== null ? def[1] : values[0];
        break;
      }
      if (statusColumn === null) continue;

      let terminalTs = null;
      for (const clause of clauses) {
        const col = /^([a-z0-9_]+)\s+timestamptz\b/i.exec(clause);
        if (col === null || !TERMINAL_TS_RE.test(col[1])) continue;
        if (/\bNOT\s+NULL\b/i.test(clause)) continue;
        terminalTs = col[1];
        break;
      }
      if (terminalTs === null) continue;

      found.set(table, {
        table, file, statusColumn, statusValues, initialValue, terminalTs,
      });
    }
  }
  return found;
}

/**
 * The function body enclosing `index`, as `{ name, body }`, or null when the
 * statement sits at migration top level (which is always reachable — a
 * migration runs).
 */
function enclosingFunction(clean, index) {
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi;
  let m;
  let best = null;
  while ((m = re.exec(clean)) !== null) {
    if (m.index > index) break;
    const tagMatch = /AS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/i.exec(
      clean.slice(m.index, m.index + 4000),
    );
    if (tagMatch === null) continue;
    const bodyStart = m.index + tagMatch.index + tagMatch[0].length;
    const bodyEnd = clean.indexOf(tagMatch[1], bodyStart);
    if (bodyEnd === -1) continue;
    if (index >= bodyStart && index < bodyEnd) best = { name: m[1], bodyEnd };
  }
  return best;
}

/** Analyse readers, advancers and advancer reachability for every lifecycle table. */
export function analyze(migrations, callerSources) {
  const tables = findLifecycleTables(migrations);
  const cleanByFile = migrations.map((m) => ({
    file: m.file, clean: stripSqlComments(m.sql),
  }));
  const allClean = cleanByFile.map((c) => c.clean).join("\n");
  const allCallers = callerSources.join("\n");

  const results = [];
  for (const info of tables.values()) {
    const t = info.table;

    // (A) a reader outside the table's own DDL.
    const readerRe = new RegExp(
      `FROM\\s+(?:public\\.)?${t}\\b|JOIN\\s+(?:public\\.)?${t}\\b`, "i",
    );
    const hasReader = readerRe.test(allClean) || readerRe.test(allCallers)
      || new RegExp(`\\brpc\\(\\s*["'\`][a-z0-9_]*${t}`, "i").test(allCallers);

    // (B) an UPDATE that advances the status to a NON-initial value, plus the
    //     function that contains it.
    const advancers = [];
    const updRe = new RegExp(`UPDATE\\s+(?:public\\.)?${t}\\b`, "gi");
    for (const { clean } of cleanByFile) {
      let um;
      while ((um = updRe.exec(clean)) !== null) {
        const stmt = clean.slice(um.index, um.index + 1200);
        const setPart = /\bSET\b([\s\S]*?)(?:;|\bWHERE\b|\bRETURNING\b)/i.exec(stmt);
        if (setPart === null) continue;
        if (!new RegExp(`\\b${info.statusColumn}\\s*=`, "i").test(setPart[1])) continue;
        // The assigned value must not be the initial state. A literal equal to
        // the initial value is not an advance; a variable or CASE is.
        const lit = new RegExp(
          `\\b${info.statusColumn}\\s*=\\s*'([^']*)'`, "i",
        ).exec(setPart[1]);
        if (lit !== null && lit[1] === info.initialValue) continue;
        const fn = enclosingFunction(clean, um.index);
        advancers.push({ fn: fn === null ? null : fn.name });
      }
      updRe.lastIndex = 0;
    }

    // (C) at least one advancer must be REACHABLE: either it sits at migration
    //     top level (a migration runs), or the function containing it is
    //     invoked from production code.
    let reachableAdvancer = false;
    const unreachableFns = [];
    for (const a of advancers) {
      if (a.fn === null) { reachableAdvancer = true; continue; }
      const callRe = new RegExp(`(?:public\\.)?\\b${a.fn}\\s*\\(`, "g");
      const rpcRe = new RegExp(`\\brpc\\(\\s*["'\`]${a.fn}["'\`]`, "g");
      // Calls inside the function's OWN definition line do not count.
      let migCalls = 0;
      for (const { clean } of cleanByFile) {
        const stripped = stripSqlLiterals(clean).replace(
          new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${a.fn}\\s*\\(`, "gi"),
          " DEFN( ",
        ).replace(new RegExp(`(?:DROP\\s+FUNCTION|GRANT|REVOKE|COMMENT\\s+ON\\s+FUNCTION|ALTER\\s+FUNCTION)[^;]*;`, "gi"), " ");
        migCalls += (stripped.match(callRe) || []).length;
        callRe.lastIndex = 0;
      }
      const appCalls = (allCallers.match(callRe) || []).length
        + (allCallers.match(rpcRe) || []).length;
      if (migCalls > 0 || appCalls > 0) reachableAdvancer = true;
      else unreachableFns.push(a.fn);
    }

    results.push({
      ...info,
      hasReader,
      advancerCount: advancers.length,
      reachableAdvancer,
      unreachableFns,
      exempt: WRITE_ONLY_BY_DESIGN.has(t),
    });
  }

  const violations = results.filter(
    (r) => !r.exempt && (!r.hasReader || r.advancerCount === 0 || !r.reachableAdvancer),
  );
  const staleExemptions = [...WRITE_ONLY_BY_DESIGN.keys()].filter(
    (t) => !results.some((r) => r.table === t),
  );
  // An exemption that is no longer NEEDED is also stale: the table now has a
  // reachable resolver, so the entry should be dropped.
  const unneededExemptions = results
    .filter((r) => r.exempt && r.hasReader && r.advancerCount > 0 && r.reachableAdvancer)
    .map((r) => r.table);

  return { results, violations, staleExemptions, unneededExemptions };
}

/* ------------------------------------------------------------------- io --- */

function loadMigrations() {
  const root = path.join(REPO_ROOT, MIGRATIONS_DIR);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: fs.readFileSync(path.join(root, f), "utf8") }));
}

function readSources(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      readSources(full, acc);
    } else if (
      /\.(ts|tsx|js|jsx|mjs|cjs|sql)$/.test(entry.name)
      && !/\.test\.[a-z]+$/.test(entry.name)
    ) {
      try { acc.push(fs.readFileSync(full, "utf8")); } catch { /* unreadable */ }
    }
  }
  return acc;
}

/**
 * Production callers only. `__tests__/` and `*.test.*` are excluded on purpose:
 * a resolution path only a test can reach is a resolution path that does not
 * exist in production, which is the entire point of condition (C).
 */
function loadCallerSources() {
  const out = [];
  for (const dir of CALLER_DIRS) readSources(path.join(REPO_ROOT, dir), out);
  return out;
}

/* ------------------------------------------------------------ self-test --- */

function selfTest() {
  const LANDFILL = {
    file: "20270101000000_a.sql",
    sql:
      "CREATE TABLE public.widget_reviews (\n" +
      "  id uuid PRIMARY KEY,\n" +
      "  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved_merge','resolved_separate')),\n" +
      "  resolved_at timestamptz NULL,\n" +
      "  CONSTRAINT widget_shape CHECK ((status='open' AND resolved_at IS NULL) OR (status<>'open' AND resolved_at IS NOT NULL))\n" +
      ");\n" +
      "INSERT INTO public.widget_reviews(id,status) VALUES(gen_random_uuid(),'open');",
  };
  const RESOLVER = {
    file: "20270202000000_b.sql",
    sql:
      "CREATE OR REPLACE FUNCTION public.biz_resolve_widget(p_id uuid) RETURNS void\n" +
      "LANGUAGE plpgsql AS $function$\nBEGIN\n" +
      "  PERFORM 1 FROM public.widget_reviews WHERE id=p_id;\n" +
      "  UPDATE public.widget_reviews SET status='resolved_merge', resolved_at=now() WHERE id=p_id;\n" +
      "END;\n$function$;",
  };

  // 1. THE #2305 DEFECT ITSELF: writers, no reader, no advancer.
  let r = analyze([LANDFILL], []);
  if (r.violations.length !== 1 || r.violations[0].table !== "widget_reviews") {
    console.error(
      "#2305 self-test: a lifecycle table with zero readers and zero advancers " +
        "was NOT detected. This gate proves nothing.",
    );
    process.exit(1);
  }

  // 2. The same table with a reachable resolver — must be green, or the rule is
  //    just "always red".
  r = analyze([LANDFILL, RESOLVER], ['supabase.rpc("biz_resolve_widget", { p_id: id });']);
  if (r.violations.length !== 0) {
    console.error(
      "#2305 self-test: a table with a reader, an advancer and a live caller was flagged: " +
        JSON.stringify(r.violations.map((v) => v.table)),
    );
    process.exit(1);
  }

  // 3. CONDITION (C): the advancer exists but NOTHING calls the function that
  //    holds it. This is the `biz_reverse_brand_person_merge` shape — the third
  //    instance of the class. A gate that stopped at (A)+(B) would pass it.
  r = analyze([LANDFILL, RESOLVER], []);
  if (r.violations.length !== 1 || !r.violations[0].unreachableFns.includes("biz_resolve_widget")) {
    console.error(
      "#2305 self-test: an advancing UPDATE inside a function NOTHING calls was " +
        "treated as a resolution path. Condition (C) is not working, so the " +
        "Split-with-no-caller shape would ship again.",
    );
    process.exit(1);
  }

  // 4. A COMMENTED-OUT resolver is not a resolver (#2113 — a check satisfied by
  //    a comment is a check that cannot fail).
  r = analyze([
    LANDFILL,
    {
      file: "20270202000000_b.sql",
      sql:
        "-- UPDATE public.widget_reviews SET status='resolved_merge' WHERE id=p_id;\n" +
        "-- SELECT 1 FROM public.widget_reviews;",
    },
  ], []);
  if (r.violations.length !== 1) {
    console.error("#2305 self-test: a commented-out resolver satisfied the gate.");
    process.exit(1);
  }

  // 5. An UPDATE that writes the status back to its INITIAL value is not an
  //    advance. A queue that can only be re-opened is still a landfill.
  r = analyze([
    LANDFILL,
    {
      file: "20270202000000_b.sql",
      sql:
        "CREATE OR REPLACE FUNCTION public.biz_touch_widget() RETURNS void LANGUAGE plpgsql AS $f$\n" +
        "BEGIN\n  PERFORM 1 FROM public.widget_reviews;\n" +
        "  UPDATE public.widget_reviews SET status='open';\nEND;\n$f$;",
    },
  ], ['supabase.rpc("biz_touch_widget");']);
  if (r.violations.length !== 1) {
    console.error("#2305 self-test: re-writing the INITIAL status counted as an advance.");
    process.exit(1);
  }

  // 6. A table with a status but NO terminal timestamp is not a lifecycle table.
  //    The pairing is what proves a resolution was intended.
  r = analyze([
    {
      file: "20270101000000_a.sql",
      sql:
        "CREATE TABLE public.widget_flags (\n" +
        "  id uuid PRIMARY KEY,\n" +
        "  status text NOT NULL DEFAULT 'on' CHECK (status IN ('on','off'))\n);",
    },
  ], []);
  if (r.results.length !== 0) {
    console.error("#2305 self-test: a plain status enum was mistaken for a lifecycle table.");
    process.exit(1);
  }

  // 7. A test-only caller does NOT make an advancer reachable. `loadCallerSources`
  //    excludes __tests__ for exactly this reason; assert the analyzer agrees
  //    when handed only production sources.
  r = analyze([LANDFILL, RESOLVER], ["-- production file with no call"]);
  if (r.violations.length !== 1) {
    console.error(
      "#2305 self-test: a resolver reachable only from a test was counted as live.",
    );
    process.exit(1);
  }

  // 8. A STALE exemption must fail: an allowlist entry matching no discovered
  //    table is a gate quietly narrowing itself.
  r = analyze([LANDFILL, RESOLVER], ['supabase.rpc("biz_resolve_widget");']);
  if (!r.staleExemptions.includes("ad_app_acquisition_canaries")) {
    console.error("#2305 self-test: a stale exemption was not reported.");
    process.exit(1);
  }

  console.log(
    "#2305 self-test passed (write-only lifecycle table caught; resolved table green; " +
      "advancer-with-no-caller caught (condition C, the Split shape); commented-out " +
      "resolver rejected; initial-value rewrite is not an advance; plain status enum " +
      "ignored; test-only caller does not count; stale exemption reported).",
  );
}

/* ----------------------------------------------------------------- main --- */

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const migrations = loadMigrations();
  const callers = loadCallerSources();
  const { results, violations, staleExemptions, unneededExemptions } = analyze(
    migrations, callers,
  );

  // P-vacuous. A gate that inspected nothing must FAIL, never pass green — the
  // exact failure mode #2113 catalogued 60 times in this repo.
  if (migrations.length === 0) {
    console.error("#2305: discovered 0 migrations. A gate that reads nothing must fail.");
    process.exit(1);
  }
  if (callers.length === 0) {
    console.error(
      "#2305: discovered 0 production caller sources across " + CALLER_DIRS.join(", ") +
        ". Reachability could not be measured, so every advancer would look dark.",
    );
    process.exit(1);
  }
  if (results.length === 0) {
    console.error(
      "#2305: parsed ZERO lifecycle tables out of " + migrations.length +
        " migrations. The CREATE TABLE scanner is broken, so a write-only sink " +
        "could not be seen. This gate is not measuring anything.",
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error(
      "#2305: a table models a RESOLUTION LIFECYCLE that no code can execute.\n" +
        "A status column whose CHECK admits a terminal state, paired with a nullable\n" +
        "resolved_at-shaped timestamp, is a promise that something can be resolved. If\n" +
        "nothing reads the table, nothing advances the status, or the only thing that\n" +
        "advances it is a function NOTHING calls, then the initial state is not a\n" +
        "starting state — it is the ONLY state, and the table is an append-only\n" +
        "landfill. Every test stays green while the feature is dead in production.\n\n" +
        "That is what left 23% of confirmed paid orders orphaned from their brand's\n" +
        "contact book (#2305), and it is the same class as #2168, #2222 and #2290.\n\n" +
        "Build the resolution path, or add the table to WRITE_ONLY_BY_DESIGN in this\n" +
        "file with a reason and an issue number.\n",
    );
    for (const v of violations) {
      const missing = [];
      if (!v.hasReader) missing.push("no SELECT reads it");
      if (v.advancerCount === 0) {
        missing.push(`nothing UPDATEs ${v.statusColumn} off '${v.initialValue}'`);
      } else if (!v.reachableAdvancer) {
        missing.push(
          `the only advancer(s) live in ${v.unreachableFns.join(", ")}, which nothing calls`,
        );
      }
      console.error(`  NEW  ${v.table} (${v.file}) — ${missing.join("; ")}`);
    }
    process.exit(1);
  }

  if (staleExemptions.length > 0) {
    console.error(
      "#2305: WRITE_ONLY_BY_DESIGN lists table(s) the detector no longer sees: " +
        staleExemptions.join(", ") +
        ".\nEither the table was renamed/removed (drop the entry) or the detector " +
        "stopped recognising it (fix the detector). A frozen exemption that matches " +
        "nothing is a gate quietly narrowing itself.",
    );
    process.exit(1);
  }
  if (unneededExemptions.length > 0) {
    console.error(
      "#2305: WRITE_ONLY_BY_DESIGN still exempts table(s) that now HAVE a reachable " +
        "resolver: " + unneededExemptions.join(", ") +
        ".\nDrop the entry — the exemption is no longer telling the truth.",
    );
    process.exit(1);
  }
  if (WRITE_ONLY_BY_DESIGN.size !== EXPECTED_EXEMPT) {
    console.error(
      `#2305: WRITE_ONLY_BY_DESIGN size ${WRITE_ONLY_BY_DESIGN.size} != frozen ${EXPECTED_EXEMPT}.`,
    );
    process.exit(1);
  }

  const resolved = results.filter((r) => !r.exempt).map((r) => r.table);
  console.log(
    `#2305 OK — ${results.length} lifecycle table(s) inspected across ` +
      `${migrations.length} migrations and ${callers.length} production source files.\n` +
      `  with a reachable resolver (${resolved.length}): ${resolved.join(", ")}\n` +
      `  write-only by design, frozen (${WRITE_ONLY_BY_DESIGN.size}): ` +
      `${[...WRITE_ONLY_BY_DESIGN.keys()].join(", ")}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  WRITE_ONLY_BY_DESIGN, EXPECTED_EXEMPT, MIGRATIONS_DIR, CALLER_DIRS,
  loadMigrations, loadCallerSources,
};
