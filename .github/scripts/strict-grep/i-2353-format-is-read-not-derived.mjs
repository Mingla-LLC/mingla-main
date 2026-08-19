#!/usr/bin/env node
/**
 * issue #2353 — format is READ, not DERIVED; and a revoke ships with its caller.
 * Invariants: I-PROPOSED-2353-A-FORMAT-IS-READ-NOT-DERIVED,
 *             I-PROPOSED-2353-C-A-REVOKE-SHIPS-WITH-ITS-CALLER.
 *
 * WHAT SHIPPED, AND WHY A GATE.
 *
 * `events.is_online` is a TWO-valued projection of a THREE-valued enum: the
 * client writes `is_online = format === "online" || format === "hybrid"`
 * (serverDraftEventMapper.ts:708, duplicated at :662). Any SQL that inverts it
 * — `CASE WHEN is_online THEN 'online' ELSE 'in_person' END` — cannot tell
 * `online` from `hybrid`, and makes `'hybrid'` UNREACHABLE as an output.
 * #2089 shipped four such sites in 20270422001972 (lines 601, 882, 1374, 1453).
 * The one at 601 is the dangerous one: business_unpublish_event_to_draft:979
 * installs its output with `theme = v_payload->'theme'`, a WHOLESALE replace,
 * so a host who taps Unpublish or Duplicate on a hybrid event has the true
 * value OVERWRITTEN, not merely misreported, and the client cannot recover it.
 *
 * The failure mode is INVISIBLE to a naive suite: every `online` and every
 * `in_person` case passes against the defective code. ONLY hybrid catches it.
 * That is exactly how #2089 shipped, and it is the whole reason this file
 * exists.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE CATCHES, AND WHAT IT DOES NOT. Read this before trusting it.
 *
 * The #2353 tester proved the previous revision of this gate was evadable by
 * six trivially-equivalent rewrites of the same defect: a parenthesised CASE,
 * a CASE-free boolean, a CASE assigned to an intermediate variable, the
 * simple-CASE form, and a double-quoted JSON key. Every one was the SAME bug
 * and every one passed, because the detectors were anchored on the LABEL
 * (`'format', CASE`) instead of on the VALUE. They are now anchored on the
 * value, and all six are covered by name in `--self-test`.
 *
 * CATCHES (across `supabase/migrations/**`, SQL comments stripped first, so a
 * commented-out fix never reads as present):
 *   - any `CASE` — searched or simple, parenthesised or not, labelled
 *     `'format',` or `"format",` or assigned to a variable or returned bare —
 *     whose decision head names `is_online`, does NOT name `format`, and whose
 *     body yields both `'online'` and `'in_person'`;
 *   - any assignment or JSON emission of `is_online` (`is_online =`,
 *     `is_online :=`, `'is_online',`, `"is_online",`, `'{is_online}',`) whose
 *     value expression mentions `format` but never `hybrid`, whether or not a
 *     `CASE` is involved and however many parentheses wrap it.
 *
 * DOES NOT CATCH, stated rather than implied (#2113 is a gate that quietly
 * means less than its name):
 *   - a derivation laundered through a variable that hides the column name —
 *     `v_flag := e.is_online;` then `CASE WHEN v_flag THEN 'online' …`. The
 *     head no longer names `is_online` and this file does no dataflow;
 *   - a derivation that never writes both literals in one expression — built
 *     by concatenation, an enum cast, a lookup table, or a join;
 *   - anything inside dynamic SQL assembled at runtime (`EXECUTE format(…)`);
 *   - the same conflation in TypeScript, edge functions, or views defined
 *     outside `supabase/migrations/**` — this gate reads migrations ONLY;
 *   - semantic correctness of a three-valued expression. Rule A2 checks that
 *     `hybrid` APPEARS in the value expression, not that it is used correctly.
 *   Behaviour is proven by the two pg17 suites, not by this file. This gate is
 *   a ratchet against re-introduction, not a proof of correctness.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * REQUIRE, across `supabase/migrations`:
 *
 *   A1. Every is_online-keyed `format` CASE is either in the frozen allowlist
 *       or a violation. The allowlist holds exactly the pre-existing sites in
 *       the MERGED, FROZEN 20270422001972 — a file #2353 may not edit.
 *   A2. Every `is_online` write whose value derives from `format` must mention
 *       `hybrid`. `p_patch->>'format'='online'` sets is_online FALSE for a
 *       hybrid patch, contradicting the client's own contract.
 *   A3. An allowlisted site that has VANISHED is also a failure: it means the
 *       frozen migration was edited, which #2353's SPEC forbids outright.
 *   A4. The #2353 migration exists and carries all of its corrected predicates.
 *   A5. LAST WRITER. For each function #2353 corrects, the HIGHEST-timestamped
 *       migration that does `CREATE OR REPLACE FUNCTION` on it must be the
 *       #2353 migration. PostgreSQL keeps the last definition applied, so a
 *       later migration re-creating any of them silently reinstates the defect
 *       with every test still green until a hybrid event exists.
 *   A6. ONE CANONICAL-MEMBERSHIP TEST, AND ONE CHARACTER SET. Every
 *       `IN ('in_person','online','hybrid')` in the #2353 migration is
 *       normalised with `lower(btrim(…))`, there are at least nine of them
 *       (S2's read, S3(a), S3(b), S4(a), S4(b), both halves of S4(c), and both
 *       halves of S6's draft arm), and EVERY `btrim` in the file passes the
 *       SAME second argument. One-argument `btrim(text)` strips ASCII SPACE
 *       ONLY — measured, not assumed: `sp_stripped=true`,
 *       `tab_stripped=false`, `nl_stripped=false`, `cr_stripped=false`,
 *       `nbsp_stripped=false`. A tab-padded `hybrid` therefore fell straight
 *       through the canonical list and reproduced the entire escalation:
 *       `stored=<TAB>hybrid, broadcast=f` became `stored=online, broadcast=t`
 *       after one Unpublish/re-publish. Two sites that trim different
 *       character sets are the #2333 P2-1 normalisation gap re-created inside
 *       one file, so the gate pins the set's IDENTITY, not merely its presence.
 *       This supersedes SPEC §9's bare-`IN` instruction:
 *       §9's premise, "every writer emits a bare literal", is true of the TS
 *       client and false of the server contract — `business_create_event_draft`
 *       stores `'Hybrid'` verbatim for any `authenticated` event_manager, and
 *       under a bare `IN` that row is rewritten to `'online'` by one
 *       Unpublish/re-publish and then broadcast worldwide by #2333's carve-out.
 *   A7. S4(c) ENTERS ON THE MEMBERSHIP TEST, NOT ON KEY PRESENCE. `IF p_args ?
 *       'format' …` with a CASE that has no fail-closed arm resolved an
 *       unrecognised value to a definite `'in_person'` and rewrote live hybrid
 *       events — on a call that was a NO-OP before #2353 touched it. Entry must
 *       be the same canonical-membership test the CASE uses.
 *   A8. S3(b) CREATES THE NAMESPACE. `jsonb_set` creates only the FINAL path
 *       element, so on a live row with no `business_event` object the format
 *       write was a silent no-op while the is_online projection still fired.
 *       The write must merge a rebuilt namespace onto the theme.
 *  A10. S6 — THE DRAFT ARM HANDLES `format`, AND RECONCILES ONLY ON
 *       DISAGREEMENT. `ari_execute_event_operation`'s `update_event` has TWO
 *       arms and S4 taught only the LIVE one. On the DRAFT arm a supplied
 *       `format` was accepted, reported successful and silently DISCARDED
 *       (Constitution rule 3), and a supplied `is_online` moved the derived
 *       column while leaving the source of truth stale — so a hybrid draft
 *       became `format=hybrid, is_online=false` and the disagreement SURVIVED
 *       publish. `is_online` is an ADVERTISED tool parameter
 *       (`agentTools.ts:753`), so that path needs no out-of-schema key at all.
 *       The reconciliation must fire ONLY when the pair actually disagrees:
 *       flattening every `is_online=true` to `'online'` would satisfy a naive
 *       agreement test and destroy the very value this issue exists to protect.
 *   A9. S5 STAYS WITHDRAWN. #2353 must NOT re-create
 *       `business_guard_event_publish_visibility`. Its conjunct was measured to
 *       exempt two statement shapes the guard previously refused while fixing
 *       nothing any client can reach, and was removed at rework.
 *
 *   C1. The #2353 migration GRANTs EXECUTE to `authenticated` on BOTH
 *       business_patch_event_when and business_patch_event_taxonomy.
 *   C2. It grants to NEITHER `anon` NOR `PUBLIC`.
 *   C3. The grant is tagged `[TRANSITIONAL]` AND states an EXIT CONDITION.
 *
 *   G1. THE APPLY-ORDER GUARD IS THE FIRST EXECUTABLE STATEMENT, and probes
 *       with `to_regprocedure`.
 *
 * SCOPE NOTE on invariant C. This gate enforces C for the two functions
 * #2089's revoke actually targeted — the only two with a shipped client
 * caller. The registry stanza states C as a general rule over every
 * `REVOKE ... FROM ... authenticated` in `supabase/migrations`; there are 255
 * such statements on main today, the overwhelming majority of them deliberate
 * server-only demotions with no caller to strand, so a general sweep needs its
 * own frozen allowlist and is out of #2353's scoped allowlist. Flagged to the
 * orchestrator at the DRAFT-to-ACTIVE flip rather than silently narrowed.
 *
 * `--self-test` drives the pure core with fixtures, including the exact
 * defective shapes #2089 shipped AND the six rewrites that evaded the previous
 * revision. Exit 0 clean / 1 violation.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MIGRATIONS_DIR = "supabase/migrations";
const FIX = "supabase/migrations/20270429002353_issue_2353_format_truth_and_edit_grant.sql";
const FROZEN = "supabase/migrations/20270422001972_issue_1972_ari_event_lifecycle.sql";

// The functions #2353 corrects. #2353 must be the LAST migration that creates
// each of them, or the correction is overwritten at apply time.
// business_guard_event_publish_visibility is NOT here: S5 was withdrawn at
// rework, so #2353 no longer creates it and #1972 is correctly the last writer.
const CORRECTED_FUNCTIONS = [
  "business_event_draft_payload_from_graph",
  "business_update_live_event",
  "ari_execute_event_operation",
];

// FROZEN ALLOWLIST. Each entry is {file, shape, snippet}, where `snippet` is
// the whitespace-normalised occurrence text. These are the pre-existing sites
// in the MERGED migration #2353 may not edit. Nothing may be added here
// without a decision: a new entry means a new expression that cannot express
// `hybrid`.
const ALLOWED = [
  { file: FROZEN, shape: "format-from-is_online",
    snippet: "CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END" },
  { file: FROZEN, shape: "format-from-is_online",
    snippet: "CASE WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online' ELSE 'in_person' END" },
  { file: FROZEN, shape: "format-from-is_online",
    snippet: "CASE WHEN (p_args->>'is_online')::boolean THEN 'online' ELSE 'in_person' END" },
  { file: FROZEN, shape: "is_online-from-single-format",
    snippet: "is_online=CASE WHEN p_patch ? 'format' THEN p_patch->>'format'='online' ELSE is_online END" },
];

// ---- helpers ------------------------------------------------------------

/** Strip SQL line and block comments. A commented-out fix is NOT a fix. */
export const stripSqlComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const norm = (s) => s.replace(/\s+/g, " ").trim();

/** Walk from the CASE token at `start` to its own matching END. */
function caseEnd(sql, start) {
  let depth = 0;
  const tok = /\b(CASE|END)\b/gi;
  tok.lastIndex = start;
  let t;
  while ((t = tok.exec(sql)) !== null) {
    if (t.index > start + 6000) return -1;
    if (/case/i.test(t[0])) depth++;
    else if (--depth === 0) return t.index + t[0].length;
  }
  return -1;
}

/**
 * Find every CASE — searched or simple, however it is labelled or wrapped —
 * that decides on `is_online` and yields the two-valued format pair.
 *
 * Anchored on the VALUE, not on the label. The previous revision anchored on
 * `'format'\s*,\s*CASE` and was evaded by a leading `(`, by `"format",`, and
 * by assigning the CASE to a variable first.
 */
export function findFormatFromIsOnline(sql) {
  const out = [];
  const re = /\bCASE\b/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const from = m.index;
    const end = caseEnd(sql, from);
    if (end === -1) continue;
    const body = sql.slice(from, end);
    // The decision head: everything between CASE and the first THEN. For a
    // searched CASE that is `WHEN <cond>`; for a simple CASE it is
    // `<operand> WHEN <value>`. Both forms are covered by one slice.
    const head = /\bCASE\b([\s\S]*?)\bTHEN\b/i.exec(body);
    if (!head) continue;
    // The defect: the FIRST decision is made on is_online, with no stored or
    // supplied `format` consulted ahead of it.
    if (!/is_online/i.test(head[1]) || /format/i.test(head[1])) continue;
    // ...and the values it decides between are the two-valued format pair.
    if (!/'online'/i.test(body) || !/'in_person'/i.test(body)) continue;
    out.push({ shape: "format-from-is_online", snippet: norm(body) });
  }
  return out;
}

/**
 * Slice the value expression that begins at `i`, stopping at the first comma,
 * semicolon, closing paren or clause keyword that is OUTSIDE every paren and
 * every CASE. This is what lets rule A2 see a CASE-free boolean and a
 * parenthesised CASE as the same thing.
 */
export function valueExpression(sql, i) {
  let depth = 0;
  let caseDepth = 0;
  let last = i;
  const tok = /\b(CASE|END)\b|[(),;]|\b(WHERE|FROM|RETURNING|INTO)\b/gi;
  tok.lastIndex = i;
  let m;
  while ((m = tok.exec(sql)) !== null) {
    if (m.index - i > 4000) break;
    const t = m[0].toUpperCase();
    if (t === "(") depth++;
    else if (t === ")") {
      if (depth === 0) { last = m.index; break; }
      depth--;
    } else if (t === "CASE") caseDepth++;
    else if (t === "END") { if (caseDepth > 0) caseDepth--; }
    else if (t === ",") { if (depth === 0 && caseDepth === 0) { last = m.index; break; } }
    else if (t === ";") { last = m.index; break; }
    else if (depth === 0 && caseDepth === 0) { last = m.index; break; }
    last = tok.lastIndex;
  }
  return sql.slice(i, last);
}

/**
 * Find every write of `is_online` whose value derives from a `format` value
 * but never mentions `hybrid`. That is the two-valued projection bug, in ALL
 * of its formulations: `is_online = CASE …`, `is_online = (CASE …)`,
 * `is_online = (… 'format' … = 'online')` with no CASE at all, `:=`, and the
 * JSON-key forms `'is_online',` / `"is_online",` / `'{is_online}',`.
 */
export function findIsOnlineFromSingleFormat(sql) {
  const out = [];
  const re = /\bis_online\b\s*:?=|'is_online'\s*,|"is_online"\s*,|'\{is_online\}'\s*,/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const start = m.index + m[0].length;
    const expr = valueExpression(sql, start);
    if (!/format/i.test(expr)) continue;   // not a format-driven write
    if (/hybrid/i.test(expr)) continue;    // three-valued: correct
    out.push({
      shape: "is_online-from-single-format",
      snippet: norm(sql.slice(m.index, start + expr.length)),
    });
  }
  return out;
}

const key = (o) => `${o.file} ${o.shape} ${o.snippet}`;

/** Timestamp prefix of a migration path, or null. */
export const prefixOf = (rel) => {
  const m = /(\d{14})_/.exec(path.basename(rel));
  return m ? m[1] : null;
};

// ---- pure core ----------------------------------------------------------

export function checkFormatTruth(files, failures) {
  const migrations = Object.entries(files)
    .filter(([rel]) => rel.startsWith(MIGRATIONS_DIR + "/") && rel.endsWith(".sql"))
    .sort(([a], [b]) => a.localeCompare(b));

  if (migrations.length === 0) {
    failures.push(
      `${MIGRATIONS_DIR}: no migrations were read. A gate that discovers nothing must FAIL, ` +
      `never pass by vacuity (#2113, #2353).`,
    );
    return;
  }

  // ---- A1 / A2 / A3 — occurrence SET against the frozen allowlist.
  const found = [];
  for (const [rel, raw] of migrations) {
    const sql = stripSqlComments(raw);
    for (const o of findFormatFromIsOnline(sql)) found.push({ file: rel, ...o });
    for (const o of findIsOnlineFromSingleFormat(sql)) found.push({ file: rel, ...o });
  }
  const foundKeys = new Set(found.map(key));
  const allowedKeys = new Set(ALLOWED.map(key));

  for (const o of found) {
    if (allowedKeys.has(key(o))) continue;
    failures.push(
      `${o.file}: a NEW format-from-is_online site (${o.shape}) — \`${o.snippet.slice(0, 120)}\`. ` +
      `is_online is a TWO-valued projection of a THREE-valued enum, so this cannot distinguish ` +
      `online from hybrid and makes 'hybrid' unreachable as an output. Read the stored enum ` +
      `(theme.business_event/business_draft.format) or the supplied \`format\` argument FIRST, ` +
      `and fall back to is_online only when nothing valid is present (#2353).`,
    );
  }
  for (const a of ALLOWED) {
    if (foundKeys.has(key(a))) continue;
    failures.push(
      `${a.file}: an allowlisted ${a.shape} site has VANISHED — \`${a.snippet.slice(0, 90)}\`. ` +
      `That migration is MERGED and frozen: #2353 fixes forward in a new file and may not edit ` +
      `it. If it was legitimately superseded, the allowlist in this gate must be updated in the ` +
      `same change so the SET stays honest (#2353).`,
    );
  }

  // ---- A4 — the fix migration exists and carries its predicates.
  const rawFix = files[FIX];
  if (rawFix === undefined) {
    failures.push(
      `${FIX}: MISSING. Every rule below depends on it; without it the four #2089 sites are the ` +
      `last word, and a hybrid event is silently relabelled Online on Duplicate/Unpublish (#2353).`,
    );
    return;
  }
  const fix = stripSqlComments(rawFix);
  const REQUIRED = [
    { id: "S2 stored-first read (business_event namespace)",
      re: /theme#>>'\{business_event,format\}'/,
      why: "the published row's stored enum. Without it the read falls back to is_online and hybrid is destroyed on Duplicate/Unpublish" },
    { id: "S2 stored-first read (business_draft namespace)",
      re: /theme#>>'\{business_draft,format\}'/,
      why: "the draft row's stored enum. The two namespaces are mutually exclusive, so both arms of the COALESCE are load-bearing" },
    { id: "S3(a) three-valued is_online projection",
      re: /lower\(btrim\(p_patch->>'format',\s*E'[^']*'\|\|chr\(160\)\)\)\s+IN\s*\(\s*'online'\s*,\s*'hybrid'\s*\)/i,
      why: "is_online = format IN ('online','hybrid'). The pre-fix `= 'online'` set is_online FALSE for a hybrid patch, against the client's own contract" },
    { id: "S4 Ari reads the supplied format",
      re: /lower\(btrim\(COALESCE\(p_args->>'format',''\),\s*E'[^']*'\|\|chr\(160\)\)\)\s+IN\s*\(\s*'in_person'\s*,\s*'online'\s*,\s*'hybrid'\s*\)/i,
      why: "the create_event and update_event arms must accept a `format` argument rather than inverting is_online" },
  ];
  for (const { id, re, why } of REQUIRED) {
    if (!re.test(fix)) failures.push(`${FIX}: ${id} is GONE. It is ${why} (#2353).`);
  }
  // S4 must read the supplied format at ALL THREE arms plus BOTH halves of the
  // update_event guard — four reads on the create/update payloads and the
  // guard's own entry test. Fixing one site and not its sibling leaves the
  // pair able to disagree.
  const ariReads = (fix.match(/lower\(btrim\(COALESCE\(p_args->>'format',''\),\s*E'[^']*'\|\|chr\(160\)\)\)/g) || []).length;
  if (ariReads < 5) {
    failures.push(
      `${FIX}: only ${ariReads} of the 5 Ari \`format\` reads survive (create_event's format, ` +
      `create_event's is_online projection, BOTH the entry test and the CASE of update_event's ` +
      `LIVE branch, and the DRAFT branch's entry test). Fixing one site and not its sibling ` +
      `leaves the pair able to disagree (#2353).`,
    );
  }

  // ---- A6 — ONE canonical-membership test, normalised, used everywhere.
  const memberships = [...fix.matchAll(/IN\s*\(\s*'in_person'\s*,\s*'online'\s*,\s*'hybrid'\s*\)/gi)];
  if (memberships.length < 9) {
    failures.push(
      `${FIX}: only ${memberships.length} canonical-membership tests remain (expected at least 9: ` +
      `S2's read, S3(a), S3(b), S4(a), S4(b), BOTH halves of S4(c), and BOTH halves of S6's draft ` +
      `arm). A site that stops asking whether a format value is canonical either accepts junk or ` +
      `silently drops a real value (#2353).`,
    );
  }

  // A6b — ONE character set, pinned by identity. Walk every `btrim(` to its own
  // matching paren and read the second argument. One-argument btrim strips
  // ASCII space only, and two sites trimming different sets is the #2333 P2-1
  // normalisation gap re-created inside a single file.
  const trimSets = new Set();
  for (const m of fix.matchAll(/\blower\s*\(\s*btrim\s*\(/gi)) {
    let k = m.index + m[0].length;
    let depth = 1;
    let comma = -1;
    while (depth > 0 && k < fix.length) {
      const c = fix[k];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 1 && comma === -1) comma = k;
      k++;
    }
    trimSets.add(comma === -1 ? "<one-argument btrim>" : norm(fix.slice(comma + 1, k - 1)));
  }
  if (trimSets.has("<one-argument btrim>")) {
    failures.push(
      `${FIX}: a one-argument \`btrim(text)\` survives. It strips ASCII SPACE ONLY — measured on ` +
      `the harness: sp_stripped=true, tab_stripped=false, nl_stripped=false, cr_stripped=false, ` +
      `nbsp_stripped=false. A tab-, newline-, CR- or U+00A0-padded \`hybrid\` then falls through ` +
      `the canonical list, is rewritten to 'online' by one Unpublish/re-publish (the theme write ` +
      `is a WHOLESALE replace), and #2333's carve-out broadcasts a venue-backed event into every ` +
      `market. Pass the explicit set (#2353).`,
    );
  }
  if (trimSets.size > 1) {
    failures.push(
      `${FIX}: ${trimSets.size} DIFFERENT btrim character sets in one file — ` +
      `${[...trimSets].map((t) => `\`${t}\``).join(", ")}. Two sites that trim differently is the ` +
      `#2333 P2-1 normalisation gap re-created inside a single migration: the read site and the ` +
      `write site would disagree about the same stored string. One set, everywhere (#2353).`,
    );
  }
  for (const mm of memberships) {
    const before = fix.slice(Math.max(0, mm.index - 400), mm.index);
    if (!/lower\(\s*btrim\(/i.test(before)) {
      failures.push(
        `${FIX}: a canonical-membership test is NOT normalised — \`` +
        `${norm(before.slice(-70) + mm[0]).slice(-120)}\`. Every format read in this migration ` +
        `must go through \`lower(btrim(…))\`. SPEC §9 asked for a bare \`IN (…)\` on the premise ` +
        `that "every writer emits a bare literal"; that is true of the TypeScript client and ` +
        `FALSE of the server contract — business_create_event_draft stores 'Hybrid' verbatim for ` +
        `any authenticated event_manager. Un-normalised, that row misses the list, falls to the ` +
        `is_online derivation, and one Unpublish/re-publish rewrites it to 'online', at which ` +
        `point #2333's carve-out broadcasts a venue-backed event into every market (#2353).`,
      );
    }
  }

  // ---- A7 — S4(c) enters on the membership test, not on key presence.
  if (/IF\s+p_args\s*\?\s*'format'/i.test(fix)) {
    failures.push(
      `${FIX}: S4(c) enters on \`IF p_args ? 'format'\` — key PRESENCE — instead of on the ` +
      `canonical-membership test. With an unrecognised format present and \`is_online\` absent, ` +
      `the CASE's is_online fallback reads a key that is not there and the ELSE resolves to a ` +
      `definite 'in_person', which S3 then faithfully persists: a live hybrid event silently ` +
      `relabelled In person, on a call that was a NO-OP before this migration existed. Enter only ` +
      `on a value the CASE can honour (#2353).`,
    );
  }
  if (!/IF\s+lower\(btrim\(COALESCE\(p_args->>'format',''\),\s*E'[^']*'\|\|chr\(160\)\)\)\s+IN\s*\([^)]*\)\s*(?:\r?\n\s*)?OR\s+p_args\s*\?\s*'is_online'\s+THEN/i.test(fix)) {
    failures.push(
      `${FIX}: S4(c)'s fail-closed entry test is GONE. The live \`update_event\` arm must enter ` +
      `only when the supplied format is canonical after normalisation, OR when the caller sent ` +
      `\`is_online\` — which is the pre-#2353 condition, reproduced exactly (#2353).`,
    );
  }

  // ---- A10 — S6, the draft arm.
  if (!/v_business\s*:=\s*jsonb_set\(v_business,'\{format\}',to_jsonb\(v_draft_format\),true\)/i.test(fix)) {
    failures.push(
      `${FIX}: S6 is GONE — the DRAFT arm of ari_execute_event_operation no longer writes ` +
      `\`format\`. \`update_event\` has TWO arms and S4 taught only the LIVE one, so a \`format\` ` +
      `supplied on a draft was accepted, reported SUCCESSFUL and silently DISCARDED: the host is ` +
      `told the edit landed and it did not (Constitution rule 3). The asymmetry is created by ` +
      `this migration — before S4 neither arm accepted \`format\`, so the two agreed by both ` +
      `refusing (#2353).`,
    );
  }
  if (!/ELSIF\s+p_args\s*\?\s*'is_online'\s+THEN/i.test(fix)) {
    failures.push(
      `${FIX}: S6's \`is_online\` reconciliation is GONE. The draft arm wrote the DERIVED column ` +
      `from \`p_args\` and never touched its SOURCE OF TRUTH, so a hybrid draft edited with ` +
      `\`is_online:false\` became \`format=hybrid, is_online=false\` and the disagreement SURVIVED ` +
      `publish into a live row. \`is_online\` is an ADVERTISED tool parameter ` +
      `(agentTools.ts:753), so this needs no out-of-schema key at all (#2353).`,
    );
  }
  if (!/IS\s+DISTINCT\s+FROM\s+v_draft_online/i.test(fix)) {
    failures.push(
      `${FIX}: S6 reconciles \`format\` UNCONDITIONALLY instead of only when the pair disagrees. ` +
      `\`is_online=true\` on a stored \`hybrid\` ALREADY agrees; rewriting it to \`'online'\` ` +
      `anyway would satisfy a naive "the pair agrees" assertion while destroying the exact value ` +
      `this whole issue exists to protect. Move \`format\` only on a real disagreement (#2353).`,
    );
  }

  // ---- A8 — S3(b) creates the business_event namespace.
  if (!/COALESCE\(theme,'\{\}'::jsonb\)\s*\|\|\s*jsonb_build_object\(\s*'business_event'/i.test(fix)) {
    failures.push(
      `${FIX}: S3(b) no longer CREATES the \`business_event\` namespace. \`jsonb_set\` creates ` +
      `only the FINAL element of a path, so on a live row whose theme carries no business_event ` +
      `object the format write is a silent no-op while the is_online projection still fires — ` +
      `the host sets Hybrid, is_online flips true, nothing is stored, and the very next read ` +
      `reports 'online'. Merge a rebuilt namespace onto the theme instead (#2353).`,
    );
  }
  if (!/jsonb_build_object\('format',lower\(btrim\(p_patch->>'format',\s*E'[^']*'\|\|chr\(160\)\)\)\)/i.test(fix)) {
    failures.push(
      `${FIX}: S3(b) no longer PERSISTS the supplied format. business_update_live_event wrote the ` +
      `DERIVED column and never its SOURCE OF TRUTH; without this, S2's stored-first read ` +
      `faithfully returns a STALE value — a wrong-derivation bug converted into a stale-data bug. ` +
      `S3(a) and S3(b) are ONE change (#2353).`,
    );
  }

  // ---- A9 — S5 stays withdrawn.
  if (/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.business_guard_event_publish_visibility/i.test(fix)) {
    failures.push(
      `${FIX}: S5 is BACK — this migration re-creates business_guard_event_publish_visibility. ` +
      `It was withdrawn at rework because it was measured to exempt two statement shapes the ` +
      `guard previously refused (a private intent stored only in business_draft, and one dropped ` +
      `from NEW.theme by the same statement) while fixing nothing any client can reach: every ` +
      `product path runs business_assert_event_visibility BEFORE the trigger. Leave ` +
      `20270422001972:428-458 alone (#2353).`,
    );
  }

  // ---- A5 — LAST WRITER.
  const fixPrefix = prefixOf(FIX);
  for (const fn of CORRECTED_FUNCTIONS) {
    const creatorRe = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "i");
    const creators = migrations
      .filter(([, raw]) => creatorRe.test(stripSqlComments(raw)))
      .map(([rel]) => rel)
      .filter((rel) => prefixOf(rel) !== null)
      .sort((a, b) => prefixOf(a).localeCompare(prefixOf(b)));
    if (creators.length === 0) {
      failures.push(`${MIGRATIONS_DIR}: no migration creates public.${fn} (#2353).`);
      continue;
    }
    const last = creators[creators.length - 1];
    if (last !== FIX) {
      failures.push(
        `${last}: is the LAST migration to CREATE OR REPLACE public.${fn} (prefix ` +
        `${prefixOf(last)} > ${fixPrefix}). PostgreSQL keeps the last definition applied, so ` +
        `#2353's correction is overwritten at apply time and every test stays green until a ` +
        `hybrid event exists. Carry #2353's hunks into that migration, or move it earlier (#2353).`,
      );
    }
  }

  // ---- C1 / C2 / C3 — the transitional grant.
  const grantRe = /GRANT\s+EXECUTE\s+ON\s+FUNCTION([\s\S]*?)TO\s+([A-Za-z_,\s]*?);/gi;
  let grantedWhen = false, grantedTax = false;
  let g;
  while ((g = grantRe.exec(fix)) !== null) {
    const body = g[1], to = g[2];
    if (!/\bauthenticated\b/i.test(to)) continue;
    if (/business_patch_event_when/i.test(body)) grantedWhen = true;
    if (/business_patch_event_taxonomy/i.test(body)) grantedTax = true;
  }
  let grantedWide = null;
  const anyGrant = /GRANT\s+[\s\S]*?\sTO\s+([A-Za-z_,\s]*?);/gi;
  let ag;
  while ((ag = anyGrant.exec(fix)) !== null) {
    if (/\b(anon|PUBLIC)\b/i.test(ag[1])) grantedWide = norm(ag[0]).slice(0, 140);
  }
  if (!grantedWhen) {
    failures.push(
      `${FIX}: business_patch_event_when is no longer GRANTed to authenticated. #2089's revoke ` +
      `and its client half ship on different clocks — the migration applies instantly, the app ` +
      `half arrives by OTA — so removing this grant returns \`permission denied\` to every host ` +
      `editing any published event until every device has updated (#2353).`,
    );
  }
  if (!grantedTax) {
    failures.push(
      `${FIX}: business_patch_event_taxonomy is no longer GRANTed to authenticated. Same ` +
      `release-coupling window as business_patch_event_when, same platform-wide outage (#2353).`,
    );
  }
  if (grantedWide !== null) {
    failures.push(
      `${FIX}: a GRANT reaches anon or PUBLIC — \`${grantedWide}\`. business_patch_event_when ` +
      `carries a real stray live anon=X grant and #2089's revoke of it is a GENUINE fix. #2353 ` +
      `restores REACH for authenticated only; anon stays closed (#2353).`,
    );
  }
  // C3 reads the RAW file: the tag and the exit condition live in comments.
  if (!/\[TRANSITIONAL\]/.test(rawFix)) {
    failures.push(
      `${FIX}: the restored grant is not tagged [TRANSITIONAL]. The revoke is correct ` +
      `architecture and is meant to end up applied; this grant governs WHEN, not whether. An ` +
      `untagged temporary grant becomes permanent by default (#2353, Constitution #7).`,
    );
  }
  if (!/EXIT\s+CONDITION/i.test(rawFix)) {
    failures.push(
      `${FIX}: the [TRANSITIONAL] grant states no EXIT CONDITION. Constitution #7 requires ` +
      `{what is temporary} — {exit condition}: the follow-on contract migration that removes it, ` +
      `and the business-OTA adoption that must be confirmed first (#2353).`,
    );
  }

  // ---- G1 — the apply-order guard is the FIRST executable statement.
  const GUARD_ERR = "issue_2353_requires_20270422001972_applied_first";
  if (!fix.includes(GUARD_ERR)) {
    failures.push(
      `${FIX}: the apply-order guard is GONE. Production's applied head is HIGHER than ` +
      `20270422001972, so #1972 is applied surgically while this file runs the normal path; the ` +
      `wrong order lets #1972 overwrite every corrected function AND re-remove the grant, ` +
      `silently, with both migrations recorded as applied (#2353).`,
    );
  } else {
    const afterBegin = fix.replace(/^[\s\S]*?\bBEGIN\s*;/i, "");
    const idxGuard = afterBegin.indexOf(GUARD_ERR);
    const firstDdl = /\b(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE)\b/i.exec(afterBegin);
    if (firstDdl !== null && firstDdl.index < idxGuard) {
      failures.push(
        `${FIX}: the apply-order guard does NOT come first — \`${firstDdl[1].toUpperCase()}\` ` +
        `precedes it. Placement IS the contract: a guard that runs after even one ` +
        `CREATE OR REPLACE has already installed schema in a database it was supposed to ` +
        `refuse (#2353).`,
      );
    }
    if (!/to_regprocedure/.test(fix)) {
      failures.push(
        `${FIX}: the apply-order guard no longer probes with to_regprocedure. ` +
        `\`to_regprocedure\` returns NULL for an absent function; a \`::regprocedure\` cast ` +
        `RAISES instead, which replaces the guard's own named error with an opaque one and hides ` +
        `the real cause from the operator (#2353).`,
      );
    }
  }
}

// ---- file walk ----------------------------------------------------------
function walk(dirAbs, out) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
}

// ---- self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (files) => { const f = []; checkFormatTruth(files, f); return f; };

  // The one whitespace set every normaliser in the migration must pass.
  const WS_ARG = ", E' \\t\\n\\r\\f\\v'||chr(160)";

  const FROZEN_GOOD = [
    "CREATE OR REPLACE FUNCTION public.business_event_draft_payload_from_graph(p_event_id uuid)",
    "AS $fn$ BEGIN",
    "  v_business := jsonb_build_object(",
    "      'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END,",
    "      'city', v_event.city);",
    "END; $fn$;",
    "CREATE OR REPLACE FUNCTION public.business_update_live_event(p_event_id uuid, p_patch jsonb, p_reason text, p_client_revision integer)",
    "AS $fn$ BEGIN",
    "  UPDATE public.events SET",
    "    is_online=CASE WHEN p_patch ? 'format' THEN p_patch->>'format'='online' ELSE is_online END,",
    "    updated_at=now() WHERE id=p_event_id;",
    "END; $fn$;",
    "CREATE OR REPLACE FUNCTION public.ari_execute_event_operation(a uuid, b text, p_args jsonb)",
    "AS $fn$ BEGIN",
    "  v_business:=jsonb_build_object(",
    "        'format',CASE WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online' ELSE 'in_person' END,",
    "        'city',p_args->'city');",
    "  IF p_args ? 'is_online' THEN v_business:=v_business||jsonb_build_object('format',CASE WHEN (p_args->>'is_online')::boolean THEN 'online' ELSE 'in_person' END);END IF;",
    "END; $fn$;",
    "CREATE OR REPLACE FUNCTION public.business_guard_event_publish_visibility()",
    "AS $fn$ BEGIN RETURN NEW; END; $fn$;",
    "",
  ].join("\n");

  const GUARD_BLOCK = [
    "DO $$",
    "BEGIN",
    "  IF to_regprocedure('public.business_update_live_event_atomic(uuid,jsonb,text,integer)') IS NULL",
    "     OR to_regprocedure('public.business_event_draft_payload_from_graph(uuid)') IS NULL THEN",
    "    RAISE EXCEPTION 'issue_2353_requires_20270422001972_applied_first';",
    "  END IF;",
    "END $$;",
  ].join("\n");

  const GRANT_BLOCK = [
    "-- [TRANSITIONAL] issue #2353 — removed by the follow-on contract migration.",
    "-- EXIT CONDITION: the business OTA carrying 0d9476573 is confirmed on devices.",
    "GRANT EXECUTE ON FUNCTION",
    "  public.business_patch_event_when(uuid,jsonb,text,integer),",
    "  public.business_patch_event_taxonomy(",
    "    uuid,text,text[],text[],text[],numeric,numeric,text,text",
    "  ) TO authenticated;",
  ].join("\n");

  const S2_GOOD = [
    "CREATE OR REPLACE FUNCTION public.business_event_draft_payload_from_graph(p_event_id uuid)",
    "AS $fn$ BEGIN",
    "  v_business := jsonb_build_object(",
    "      'format', CASE",
    "        WHEN lower(btrim(COALESCE(v_event.theme#>>'{business_event,format}',",
    "                                  v_event.theme#>>'{business_draft,format}',''), E' \\t\\n\\r\\f\\v'||chr(160)))",
    "             IN ('in_person','online','hybrid')",
    "        THEN lower(btrim(COALESCE(v_event.theme#>>'{business_event,format}',",
    "                                  v_event.theme#>>'{business_draft,format}'), E' \\t\\n\\r\\f\\v'||chr(160)))",
    "        WHEN v_event.is_online THEN 'online'",
    "        ELSE 'in_person'",
    "      END,",
    "      'city', v_event.city);",
    "END; $fn$;",
  ].join("\n");

  const S3A_GOOD = [
    "    is_online=CASE",
    "      WHEN lower(btrim(COALESCE(p_patch->>'format',''), E' \\t\\n\\r\\f\\v'||chr(160))) IN ('in_person','online','hybrid')",
    "      THEN lower(btrim(p_patch->>'format', E' \\t\\n\\r\\f\\v'||chr(160))) IN ('online','hybrid')",
    "      ELSE is_online END,",
  ].join("\n");

  const S3B_GOOD = [
    "        jsonb_set(",
    "          CASE WHEN lower(btrim(COALESCE(p_patch->>'format',''), E' \\t\\n\\r\\f\\v'||chr(160))) IN ('in_person','online','hybrid')",
    "            THEN COALESCE(theme,'{}'::jsonb) || jsonb_build_object(",
    "                   'business_event',",
    "                   CASE WHEN jsonb_typeof(theme->'business_event')='object'",
    "                     THEN theme->'business_event' ELSE '{}'::jsonb END",
    "                   || jsonb_build_object('format',lower(btrim(p_patch->>'format', E' \\t\\n\\r\\f\\v'||chr(160)))))",
    "            ELSE COALESCE(theme,'{}'::jsonb) END,",
    "          '{business_event,settings}',v_settings,true),",
  ].join("\n");

  const S4B_GOOD = [
    "        'is_online',to_jsonb(CASE",
    "          WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \\t\\n\\r\\f\\v'||chr(160))) IN ('in_person','online','hybrid')",
    "            THEN lower(btrim(p_args->>'format', E' \\t\\n\\r\\f\\v'||chr(160))) IN ('online','hybrid')",
    "          ELSE COALESCE((p_args->>'is_online')::boolean,false) END),",
  ].join("\n");

  const S4C_GOOD = [
    "  IF lower(btrim(COALESCE(p_args->>'format',''), E' \\t\\n\\r\\f\\v'||chr(160))) IN ('in_person','online','hybrid')",
    "     OR p_args ? 'is_online' THEN",
    "    v_business:=v_business||jsonb_build_object('format',CASE",
    "      WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \\t\\n\\r\\f\\v'||chr(160))) IN ('in_person','online','hybrid')",
    "        THEN lower(btrim(p_args->>'format', E' \\t\\n\\r\\f\\v'||chr(160)))",
    "      WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online'",
    "      ELSE 'in_person' END);",
    "  END IF;",
  ].join("\n");

  const S6_GOOD = [
    "  IF lower(btrim(COALESCE(p_args->>'format','')" + WS_ARG + ")) IN ('in_person','online','hybrid') THEN",
    "    v_draft_format:=lower(btrim(p_args->>'format'" + WS_ARG + "));",
    "    v_business:=jsonb_set(v_business,'{format}',to_jsonb(v_draft_format),true);",
    "    v_payload:=jsonb_set(v_payload,'{is_online}',to_jsonb(v_draft_format IN ('online','hybrid')),true);",
    "  ELSIF p_args ? 'is_online' THEN",
    "    v_draft_online:=COALESCE((v_payload->>'is_online')::boolean,false);",
    "    v_draft_format:=lower(btrim(COALESCE(v_business->>'format','')" + WS_ARG + "));",
    "    IF v_draft_format NOT IN ('in_person','online','hybrid')",
    "       OR (v_draft_format IN ('online','hybrid')) IS DISTINCT FROM v_draft_online THEN",
    "      v_business:=jsonb_set(v_business,'{format}',to_jsonb(CASE WHEN v_draft_online THEN 'online' ELSE 'in_person' END),true);",
    "    END IF;",
    "  END IF;",
  ].join("\n");

  const FIX_GOOD = [
    "BEGIN;",
    GUARD_BLOCK,
    GRANT_BLOCK,
    S2_GOOD,
    "CREATE OR REPLACE FUNCTION public.business_update_live_event(p_event_id uuid, p_patch jsonb, p_reason text, p_client_revision integer)",
    "AS $fn$ BEGIN",
    "  UPDATE public.events SET",
    S3A_GOOD,
    "    theme=jsonb_set(",
    "      jsonb_set(",
    S3B_GOOD,
    "        '{business_event,clientRevision}',to_jsonb(p_client_revision),true),",
    "      '{coverHue}','25'::jsonb,true),",
    "    updated_at=now() WHERE id=p_event_id;",
    "END; $fn$;",
    "CREATE OR REPLACE FUNCTION public.ari_execute_event_operation(a uuid, b text, p_args jsonb)",
    "AS $fn$ BEGIN",
    "  v_business:=jsonb_build_object(",
    "        'format',CASE",
    "          WHEN lower(btrim(COALESCE(p_args->>'format',''), E' \\t\\n\\r\\f\\v'||chr(160))) IN ('in_person','online','hybrid')",
    "            THEN lower(btrim(p_args->>'format', E' \\t\\n\\r\\f\\v'||chr(160)))",
    "          WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online'",
    "          ELSE 'in_person' END,",
    S4B_GOOD,
    "        'city',p_args->'city');",
    S4C_GOOD,
    S6_GOOD,
    "END; $fn$;",
    "COMMIT;",
    "",
  ].join("\n");

  const good = { [FROZEN]: FROZEN_GOOD, [FIX]: FIX_GOOD };
  const baseline = run(good);
  if (baseline.length !== 0) {
    selfFailures.push("compliant fixture wrongly flagged: " + JSON.stringify(baseline));
  }

  const expect = (label, files, matcher) => {
    const f = run(files);
    if (f.length === 0) {
      selfFailures.push(`${label} was NOT flagged — this gate is decorative`);
      return;
    }
    if (matcher && !f.some((x) => matcher.test(x))) {
      selfFailures.push(`${label} was flagged, but not by its own rule: ` + JSON.stringify(f));
    }
  };

  const swap = (from, to) => {
    if (!FIX_GOOD.includes(from)) throw new Error("self-test fixture drift: " + from.slice(0, 60));
    return { ...good, [FIX]: FIX_GOOD.replace(from, to) };
  };
  const inject = (sql) => ({ ...good, "supabase/migrations/20270501000000_later.sql": sql });

  // 1 — the S2 read reverted to the is_online derivation (a NEW live copy).
  expect("the reverted S2 read",
    swap(S2_GOOD, [
      "CREATE OR REPLACE FUNCTION public.business_event_draft_payload_from_graph(p_event_id uuid)",
      "AS $fn$ BEGIN",
      "  v_business := jsonb_build_object(",
      "      'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END,",
      "      'city', v_event.city);",
      "END; $fn$;",
    ].join("\n")),
    /NEW format-from-is_online site/);

  // 2 — S3(a) reverted to `= 'online'` (two-valued), S3(b) intact.
  expect("the reverted S3(a) projection",
    swap(S3A_GOOD,
      "    is_online=CASE WHEN p_patch ? 'format' THEN p_patch->>'format'='online' ELSE is_online END,"),
    /is_online-from-single-format|three-valued/);

  // 3 — S3(b) deleted while S3(a) survives. THE ASYMMETRY IS THE POINT: this
  // must be caught by its OWN rule, not by S3(a)'s.
  expect("S3(b) deleted with S3(a) intact",
    swap(S3B_GOOD,
      "        jsonb_set(COALESCE(theme,'{}'::jsonb),'{business_event,settings}',v_settings,true),"),
    /CREATES the .business_event. namespace|PERSISTS the supplied format/);

  // 3b — S3(b) present but back on jsonb_set, which cannot create the namespace.
  expect("S3(b) reverted to a namespace-blind jsonb_set",
    swap([
      "            THEN COALESCE(theme,'{}'::jsonb) || jsonb_build_object(",
      "                   'business_event',",
      "                   CASE WHEN jsonb_typeof(theme->'business_event')='object'",
      "                     THEN theme->'business_event' ELSE '{}'::jsonb END",
      "                   || jsonb_build_object('format',lower(btrim(p_patch->>'format', E' \\t\\n\\r\\f\\v'||chr(160)))))",
    ].join("\n"),
    "            THEN jsonb_set(COALESCE(theme,'{}'::jsonb),'{business_event,format}',to_jsonb(lower(btrim(p_patch->>'format', E' \\t\\n\\r\\f\\v'||chr(160)))),true)"),
    /CREATES the .business_event. namespace/);

  // 4 — one of the Ari format reads dropped.
  expect("one of the four Ari format reads dropped",
    swap(S4B_GOOD, "        'is_online',COALESCE(p_args->'is_online','false'::jsonb),"),
    /Ari `format` reads survive|canonical-membership tests remain/);

  // 4b — S4(c) back on key PRESENCE. This is the P1 the tester proved: an
  // unrecognised format with no is_online was laundered into 'in_person'.
  expect("S4(c) entering on key presence instead of the membership test",
    swap("  IF lower(btrim(COALESCE(p_args->>'format',''), E' \\t\\n\\r\\f\\v'||chr(160))) IN ('in_person','online','hybrid')\n     OR p_args ? 'is_online' THEN",
         "  IF p_args ? 'format' OR p_args ? 'is_online' THEN"),
    /enters on .IF p_args \? 'format'./);

  // 4c — normalisation stripped at one site only. SPEC §9's bare IN is banned.
  expect("lower(btrim(..., E' \\t\\n\\r\\f\\v'||chr(160))) stripped from the S2 read",
    swap("        WHEN lower(btrim(COALESCE(v_event.theme#>>'{business_event,format}',\n                                  v_event.theme#>>'{business_draft,format}',''), E' \\t\\n\\r\\f\\v'||chr(160)))\n             IN ('in_person','online','hybrid')",
         "        WHEN COALESCE(v_event.theme#>>'{business_event,format}',\n                      v_event.theme#>>'{business_draft,format}')\n             IN ('in_person','online','hybrid')"),
    /is NOT normalised/);

  // 4c2 — one normaliser reverted to the ONE-ARGUMENT btrim, which strips ASCII
  // space only. Tab/NL/CR/NBSP-padded `hybrid` then falls through and is
  // destroyed by the next round trip.
  expect("a one-argument btrim survives at one site",
    swap("      WHEN lower(btrim(COALESCE(p_patch->>'format','')" + WS_ARG + ")) IN ('in_person','online','hybrid')",
         "      WHEN lower(btrim(COALESCE(p_patch->>'format',''))) IN ('in_person','online','hybrid')"),
    /one-argument .btrim\(text\)/);

  // 4c3 — two DIFFERENT character sets in one file. This is #2333's P2-1
  // normalisation gap re-created inside a single migration.
  expect("two different btrim character sets in one file",
    swap("            THEN lower(btrim(p_args->>'format'" + WS_ARG + "))",
         "            THEN lower(btrim(p_args->>'format', E' \\t'))"),
    /DIFFERENT btrim character sets/);

  // 4e — S6 deleted, one clause at a time. The draft arm is a separate arm from
  // S4(c) and reverting either alone must be caught by its OWN rule.
  expect("S6's format write deleted from the draft arm",
    swap("    v_business:=jsonb_set(v_business,'{format}',to_jsonb(v_draft_format),true);\n", ""),
    /S6 is GONE/);
  expect("S6's is_online reconciliation deleted",
    swap("  ELSIF p_args ? 'is_online' THEN", "  ELSIF false THEN"),
    /reconciliation is GONE/);
  expect("S6 reconciling format UNCONDITIONALLY instead of only on disagreement",
    swap("    IF v_draft_format NOT IN ('in_person','online','hybrid')\n       OR (v_draft_format IN ('online','hybrid')) IS DISTINCT FROM v_draft_online THEN",
         "    IF true THEN"),
    /reconciles .format. UNCONDITIONALLY/);

  // 4d — S5 re-added. It was withdrawn deliberately and must stay withdrawn.
  expect("S5 re-added to the fix migration",
    { ...good, [FIX]: FIX_GOOD.replace("COMMIT;",
      "CREATE OR REPLACE FUNCTION public.business_guard_event_publish_visibility()\nAS $fn$ BEGIN RETURN NEW; END; $fn$;\nCOMMIT;") },
    /S5 is BACK/);

  // 5 — THE #2113 INJECTION TEST. A brand-new migration adds a FIFTH live copy
  // of the defective shape. A count-based gate stays green here; a set-based
  // one cannot.
  expect("a fifth live copy injected in a NEW migration", inject([
    "CREATE OR REPLACE FUNCTION public.some_new_reader(p uuid) AS $fn$ BEGIN",
    "  RETURN jsonb_build_object('format', CASE WHEN e.is_online THEN 'online' ELSE 'in_person' END);",
    "END; $fn$;",
  ].join("\n")), /NEW format-from-is_online site/);

  // 5b — ...and a copy that is BYTE-IDENTICAL to an allowlisted snippet, in a
  // DIFFERENT file. The allowlist is keyed by file, so this must fail too.
  expect("an allowlisted snippet copied into a different file", {
    ...good,
    "supabase/migrations/20270501000001_copy.sql": [
      "CREATE OR REPLACE FUNCTION public.x() AS $fn$ BEGIN v := jsonb_build_object(",
      "      'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END,",
      "      'city', 1); END; $fn$;",
    ].join("\n"),
  }, /NEW format-from-is_online site/);

  // ── G3..G8. The six trivially-equivalent rewrites that EVADED the previous
  // revision of this gate, each proved missed by the #2353 tester against
  // 40a6975a4. They are the reason the detectors are anchored on the VALUE.
  expect("G3 — a parenthesised CASE behind a 'format' key", inject(
    "CREATE OR REPLACE FUNCTION public.g3() AS $fn$ BEGIN RETURN jsonb_build_object(\n" +
    "  'format', (CASE WHEN e.is_online THEN 'online' ELSE 'in_person' END)); END; $fn$;"),
    /NEW format-from-is_online site/);

  expect("G4 — a parenthesised CASE assigned to is_online", inject(
    "CREATE OR REPLACE FUNCTION public.g4() AS $fn$ BEGIN UPDATE public.events SET\n" +
    "  is_online = (CASE WHEN p_patch->>'format' = 'online' THEN true ELSE false END),\n" +
    "  updated_at=now() WHERE id=x; END; $fn$;"),
    /NEW format-from-is_online site|is_online-from-single-format/);

  expect("G5 — the original defect with no CASE at all", inject(
    "CREATE OR REPLACE FUNCTION public.g5() AS $fn$ BEGIN UPDATE public.events SET\n" +
    "  is_online = (p_patch->>'format' = 'online'),\n" +
    "  updated_at=now() WHERE id=x; END; $fn$;"),
    /is_online-from-single-format/);

  expect("G6 — the CASE laundered through an intermediate variable", inject(
    "CREATE OR REPLACE FUNCTION public.g6() AS $fn$ DECLARE v_fmt text; BEGIN\n" +
    "  v_fmt := CASE WHEN e.is_online THEN 'online' ELSE 'in_person' END;\n" +
    "  RETURN jsonb_build_object('format', v_fmt); END; $fn$;"),
    /NEW format-from-is_online site/);

  expect("G7 — the simple-CASE form", inject(
    "CREATE OR REPLACE FUNCTION public.g7() AS $fn$ BEGIN RETURN jsonb_build_object(\n" +
    "  'format', CASE e.is_online WHEN true THEN 'online' ELSE 'in_person' END); END; $fn$;"),
    /NEW format-from-is_online site/);

  expect("G8 — a double-quoted JSON key", inject(
    "CREATE OR REPLACE FUNCTION public.g8() AS $fn$ BEGIN RETURN json_build_object(\n" +
    "  \"format\", CASE WHEN e.is_online THEN 'online' ELSE 'in_person' END); END; $fn$;"),
    /NEW format-from-is_online site/);

  // 6 — A LATER migration re-creates a corrected function. Last writer wins, so
  // the fix is silently overwritten at apply time.
  expect("a later migration re-creating business_update_live_event", {
    ...good,
    "supabase/migrations/20270502000000_later.sql":
      "CREATE OR REPLACE FUNCTION public.business_update_live_event(a uuid,b jsonb,c text,d integer) AS $fn$ BEGIN NULL; END; $fn$;",
  }, /LAST migration to CREATE OR REPLACE/);

  // 7 — the grant removed, one leaf at a time.
  expect("business_patch_event_when's grant removed",
    swap("  public.business_patch_event_when(uuid,jsonb,text,integer),\n", ""),
    /business_patch_event_when is no longer GRANTed/);
  expect("business_patch_event_taxonomy's grant removed",
    swap([
      "  public.business_patch_event_taxonomy(",
      "    uuid,text,text[],text[],text[],numeric,numeric,text,text",
      "  ) TO authenticated;",
    ].join("\n"), "  public.business_list_events_for_ari(uuid[],integer) TO authenticated;"),
    /business_patch_event_taxonomy is no longer GRANTed/);

  // 8 — anon re-granted. This is the security regression the revoke really fixed.
  expect("anon re-granted", swap("  ) TO authenticated;", "  ) TO authenticated,anon;"),
    /reaches anon or PUBLIC/);

  // 9 — the [TRANSITIONAL] tag and the exit condition, each removed alone.
  expect("the [TRANSITIONAL] tag removed", swap("[TRANSITIONAL] ", ""), /\[TRANSITIONAL\]/);
  expect("the EXIT CONDITION removed",
    swap("-- EXIT CONDITION: the business OTA carrying 0d9476573 is confirmed on devices.\n", ""),
    /EXIT CONDITION/);

  // 10 — the apply-order guard: deleted, moved, and downgraded.
  expect("the apply-order guard deleted", swap(GUARD_BLOCK + "\n", ""),
    /apply-order guard is GONE/);
  expect("the apply-order guard moved below the GRANT",
    { ...good, [FIX]: FIX_GOOD.replace(GUARD_BLOCK + "\n", "").replace("COMMIT;", GUARD_BLOCK + "\nCOMMIT;") },
    /does NOT come first/);
  expect("to_regprocedure swapped for a raising cast",
    { ...good, [FIX]: FIX_GOOD.split("to_regprocedure").join("regprocedure_cast") },
    /to_regprocedure/);

  // 11 — the whole fix migration deleted.
  expect("the #2353 migration deleted", { [FROZEN]: FROZEN_GOOD }, /MISSING/);

  // 12 — a COMMENTED-OUT fix must not read as present. This is exactly how a
  // fails-on-revert proof can lie.
  expect("a fully commented-out fix migration", {
    ...good,
    [FIX]: FIX_GOOD.split("\n").map((l) => "-- " + l).join("\n"),
  }, /is GONE|MISSING|guard is GONE|no longer GRANTed|membership tests remain/);

  // 13 — ...and a migration may DISCUSS the defective shape in prose.
  const prose = {
    ...good,
    [FIX]: FIX_GOOD +
      "\n-- Never write 'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END, again.\n",
  };
  if (run(prose).length !== 0) {
    selfFailures.push("prose describing the banned shape was wrongly flagged: " +
      JSON.stringify(run(prose)));
  }

  // 14 — the frozen migration EDITED (an allowlisted site vanishes).
  expect("the frozen 20270422001972 edited", {
    ...good,
    [FROZEN]: FROZEN_GOOD.replace(
      "      'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END,\n", ""),
  }, /has VANISHED/);

  // 15 — P-vacuous: an empty file map discovers nothing and must FAIL.
  if (run({}).length === 0) {
    selfFailures.push("an EMPTY file map passed — matched-nothing-therefore-green (#2113)");
  }

  if (selfFailures.length) {
    console.error("#2353 format-is-read-not-derived self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#2353 format-is-read-not-derived self-test PASS (37 cases: the compliant fixture; the S2\n" +
      "  read, the S3(a) projection, the S3(b) persist, the S3(b) namespace creation and one of\n" +
      "  the four Ari reads each reverted INDEPENDENTLY and each caught by its OWN rule; S4(c)\n" +
      "  put back on key presence (the P1 the tester proved); the normaliser stripped from one\n" +
      "  read site, reverted to a ONE-ARGUMENT btrim at another, and given a SECOND character\n" +
      "  set at a third; S6's draft-arm format write, its is_online reconciliation and its\n" +
      "  only-on-disagreement condition each deleted alone; S5 re-added; a fifth live copy\n" +
      "  injected in a new migration and an allowlisted\n" +
      "  snippet copied into another file (the #2113 set-versus-count test, both directions);\n" +
      "  G3-G8, the six trivially-equivalent rewrites that evaded the previous revision — a\n" +
      "  parenthesised CASE behind 'format', a parenthesised CASE assigned to is_online, the\n" +
      "  defect with no CASE at all, a CASE laundered through a variable, the simple-CASE form,\n" +
      "  and a double-quoted key; a later migration re-creating a corrected function\n" +
      "  (last-writer-wins); each grant removed on its own; anon re-granted; the [TRANSITIONAL]\n" +
      "  tag and the EXIT CONDITION each removed alone; the apply-order guard deleted, moved\n" +
      "  below the GRANT, and downgraded off to_regprocedure; the migration deleted; a fully\n" +
      "  commented-out migration; prose about the banned shape; the frozen migration edited; and\n" +
      "  the empty-map vacuity check).",
  );
  process.exit(0);
}

// ---- live mode ----------------------------------------------------------
const files = {};
const migAbs = [];
walk(path.join(root, MIGRATIONS_DIR), migAbs);
for (const abs of migAbs) {
  if (!abs.endsWith(".sql")) continue;
  files[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
}

const failures = [];
checkFormatTruth(files, failures);

if (failures.length > 0) {
  console.error(
    "#2353 (I-PROPOSED-2353-A-FORMAT-IS-READ-NOT-DERIVED,\n" +
      " I-PROPOSED-2353-C-A-REVOKE-SHIPS-WITH-ITS-CALLER) FAIL — an event's format must be READ\n" +
      "from where it is stored, never inferred from the two-valued is_online flag; and the\n" +
      "transitional grant that decouples 20270422001972 from the business OTA must stay, tagged,\n" +
      "with anon closed.\n\nFailures:\n  " + failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "#2353 PASS — no new is_online-keyed format derivation in any formulation the detectors cover;\n" +
    "the four #2089 sites are the frozen allowlist and are still where they were; #2353 is the\n" +
    "LAST writer of all three corrected functions and does NOT re-create the publish-visibility\n" +
    "guard; the stored-first read, the three-valued projection, the namespace-creating PERSIST\n" +
    "and all four Ari reads are present; every canonical-membership test is normalised with\n" +
    "lower(btrim(..., E' \\t\\n\\r\\f\\v'||chr(160))) and S4(c) enters on it rather than on key presence; the [TRANSITIONAL]\n" +
    "authenticated grant is intact with a written exit condition and anon closed; and the\n" +
    "apply-order guard is still the first statement.",
);
