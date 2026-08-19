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
 * THE GATE COMPARES OCCURRENCE SETS AGAINST A FROZEN ALLOWLIST — never the
 * length of an array literal declared inside itself. That anti-pattern was
 * proved inert by the #2333 tester against
 * `issue-2333-online-event-publish.mjs:163-168`, where a length check stayed
 * green with a third live copy injected. It is the #2113 family and it is
 * banned here by construction: an occurrence that is not in the allowlist is a
 * failure whether or not the total happens to match.
 *
 * REQUIRE, across `supabase/migrations` (SQL comments stripped first, so a
 * commented-out fix never counts as present):
 *
 *   A1. Every `'format', CASE ...` emission whose FIRST `WHEN` arm keys on
 *       `is_online` is either in the frozen allowlist or a violation. The
 *       allowlist holds exactly the pre-existing sites in the MERGED, FROZEN
 *       20270422001972 — a file #2353 may not edit, fix-forward only.
 *   A2. Every `is_online = CASE ...` assignment that derives from a `format`
 *       comparison must mention `hybrid`. `p_patch->>'format'='online'` sets
 *       is_online FALSE for a hybrid patch, contradicting the client's own
 *       contract. Allowlisted the same way.
 *   A3. An allowlisted site that has VANISHED is also a failure: it means the
 *       frozen migration was edited, which #2353's SPEC forbids outright.
 *   A4. The #2353 migration exists and carries all five corrected predicates —
 *       the stored-first read, the `IN ('online','hybrid')` projection, the
 *       `{business_event,format}` PERSIST, and the Ari `p_args->>'format'`
 *       reads.
 *   A5. LAST WRITER. For each of the four functions #2353 corrects, the
 *       HIGHEST-timestamped migration that does `CREATE OR REPLACE FUNCTION`
 *       on it must be the #2353 migration. PostgreSQL keeps the last
 *       definition applied, so a later migration re-creating any of them
 *       silently reinstates the defect with every test still green until a
 *       hybrid event exists. This rule is what makes A1/A2 mean anything.
 *
 *   C1. The #2353 migration GRANTs EXECUTE to `authenticated` on BOTH
 *       business_patch_event_when and business_patch_event_taxonomy. Without
 *       it, applying 20270422001972 returns `permission denied for function
 *       business_patch_event_taxonomy` to every host editing any published
 *       event until the business OTA reaches their device.
 *   C2. It grants to NEITHER `anon` NOR `PUBLIC`. business_patch_event_when
 *       carries a real stray live `anon=X` and that revoke is a genuine fix;
 *       re-opening it would undo real security work.
 *   C3. The grant is tagged `[TRANSITIONAL]` AND states an EXIT CONDITION in
 *       the same file. A temporary grant with no written exit becomes
 *       permanent by default — the grant is meant to end, and the rule is
 *       about WHEN, not whether.
 *
 *   G1. THE APPLY-ORDER GUARD IS THE FIRST EXECUTABLE STATEMENT. Production's
 *       applied head (20270423002290) is HIGHER than 20270422001972, so #1972
 *       is applied surgically while #2353 runs the normal path. If #2353 runs
 *       first, every CREATE OR REPLACE below installs a corrected function
 *       that #1972 then OVERWRITES with the buggy one, and #1972's REVOKE
 *       re-removes the grant C1 restores — a silent, total reversal with both
 *       files recorded as applied and no error anywhere. A guard placed after
 *       even one CREATE is not a guard.
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
 * defective shapes #2089 shipped. Exit 0 clean / 1 violation.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MIGRATIONS_DIR = "supabase/migrations";
const FIX = "supabase/migrations/20270429002353_issue_2353_format_truth_and_edit_grant.sql";
const FROZEN = "supabase/migrations/20270422001972_issue_1972_ari_event_lifecycle.sql";

// The four functions #2353 corrects. #2353 must be the LAST migration that
// creates each of them, or the correction is overwritten at apply time.
const CORRECTED_FUNCTIONS = [
  "business_event_draft_payload_from_graph",
  "business_update_live_event",
  "ari_execute_event_operation",
  "business_guard_event_publish_visibility",
];

// FROZEN ALLOWLIST. Each entry is {file, shape, snippet}, where `snippet` is
// the whitespace-normalised occurrence text. These are the pre-existing sites
// in the MERGED migration #2353 may not edit. Nothing may be added here
// without a decision: a new entry means a new function that cannot express
// `hybrid`.
const ALLOWED = [
  { file: FROZEN, shape: "format-from-is_online",
    snippet: "'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END," },
  { file: FROZEN, shape: "format-from-is_online",
    snippet: "'format',CASE WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online' ELSE 'in_person' END," },
  { file: FROZEN, shape: "format-from-is_online",
    snippet: "jsonb_build_object('format',CASE WHEN (p_args->>'is_online')::boolean THEN 'online' ELSE 'in_person' END)" },
  { file: FROZEN, shape: "is_online-from-single-format",
    snippet: "is_online=CASE WHEN p_patch ? 'format' THEN p_patch->>'format'='online' ELSE is_online END," },
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
    if (t.index > start + 4000) return -1;
    if (/case/i.test(t[0])) depth++;
    else if (--depth === 0) return t.index + t[0].length;
  }
  return -1;
}

/**
 * Find every `'format'` emission whose CASE leads with an `is_online` test.
 * Structural, not literal: a NEW site written differently is still caught.
 */
export function findFormatFromIsOnline(sql) {
  const out = [];
  const re = /'format'\s*,\s*CASE/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const from = m.index;
    const caseAt = from + m[0].length - "CASE".length;
    const end = caseEnd(sql, caseAt);
    if (end === -1) continue;
    const body = sql.slice(from, end);
    const firstWhen = /WHEN\b([\s\S]*?)\bTHEN\b/i.exec(body);
    if (!firstWhen) continue;
    // The defect: the FIRST decision is made on is_online, with no stored or
    // supplied `format` consulted ahead of it.
    if (!/is_online/i.test(firstWhen[1]) || /format/i.test(firstWhen[1])) continue;
    const tail = sql.slice(end, end + 2);
    const extra = tail.startsWith(",") ? "," : tail.startsWith(")") ? ")" : "";
    // A `jsonb_build_object(` immediately before is part of the site's identity.
    const pre = sql.slice(Math.max(0, from - 24), from);
    const prefix = /jsonb_build_object\(\s*$/i.test(pre) ? "jsonb_build_object(" : "";
    out.push({ shape: "format-from-is_online", snippet: norm(prefix + body + extra) });
  }
  return out;
}

/**
 * Find every `is_online = CASE ...` assignment that decides on a `format` value
 * but never mentions `hybrid`. That is the two-valued projection bug.
 */
export function findIsOnlineFromSingleFormat(sql) {
  const out = [];
  const re = /is_online\s*=\s*CASE/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const from = m.index;
    const end = caseEnd(sql, from + m[0].length - "CASE".length);
    if (end === -1) continue;
    const body = sql.slice(from, end);
    if (!/format/i.test(body)) continue;          // not a format-driven write
    if (/hybrid/i.test(body)) continue;           // three-valued: correct
    const tail = sql.slice(end, end + 1);
    out.push({
      shape: "is_online-from-single-format",
      snippet: norm(body + (tail === "," ? "," : "")),
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

  // ---- A4 — the fix migration exists and carries all five predicates.
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
      re: /p_patch->>'format'\s+IN\s*\(\s*'online'\s*,\s*'hybrid'\s*\)/i,
      why: "is_online = format IN ('online','hybrid'). The pre-fix `= 'online'` set is_online FALSE for a hybrid patch, against the client's own contract" },
    { id: "S3(b) the format PERSIST",
      re: /jsonb_set\(\s*COALESCE\(theme,'\{\}'::jsonb\)\s*,\s*'\{business_event,format\}'/,
      why: "business_update_live_event wrote the DERIVED column and never its SOURCE OF TRUTH. Without this, S2's stored-first read faithfully returns a STALE value — a wrong-derivation bug converted into a stale-data bug. S3(a) and S3(b) are ONE change" },
    { id: "S4 Ari reads the supplied format",
      re: /COALESCE\(p_args->>'format',''\)\s+IN\s*\(\s*'in_person'\s*,\s*'online'\s*,\s*'hybrid'\s*\)/i,
      why: "the create_event and update_event arms must accept a `format` argument rather than inverting is_online" },
  ];
  for (const { id, re, why } of REQUIRED) {
    if (!re.test(fix)) failures.push(`${FIX}: ${id} is GONE. It is ${why} (#2353).`);
  }
  // S4 must read the supplied format at ALL THREE sites, not one.
  const ariReads = (fix.match(/COALESCE\(p_args->>'format',''\)/g) || []).length;
  if (ariReads < 3) {
    failures.push(
      `${FIX}: only ${ariReads} of the 3 Ari \`format\` reads survive (create_event's format, ` +
      `create_event's is_online projection, and update_event's live branch). Fixing one site and ` +
      `not its sibling leaves the pair able to disagree (#2353).`,
    );
  }

  // ---- A6 — S5's publish-visibility conjunct, and the `#>` that makes it work.
  //      `#>` yields SQL NULL only when the path is ABSENT. `#>>` ALSO yields
  //      SQL NULL for a stored JSON `null`, which would exempt a row that has a
  //      stored-and-invalid choice — the one case the guard exists to refuse.
  //      Absent is exempt; present-and-invalid is not. One character apart.
  if (!/NEW\.theme#>'\{business_event,requestedVisibility\}'\s+IS\s+NOT\s+NULL/i.test(fix)) {
    if (/NEW\.theme#>>'\{business_event,requestedVisibility\}'\s+IS\s+NOT\s+NULL/i.test(fix)) {
      failures.push(
        `${FIX}: S5's conjunct uses \`#>>\` where it must use \`#>\`. \`#>>\` returns SQL NULL ` +
        `for a stored JSON \`null\` as well as for an ABSENT path, so it would exempt a draft ` +
        `that HAS a stored-and-invalid visibility choice — precisely the row the guard exists to ` +
        `refuse. Absent is exempt; present-and-invalid is not (#2353).`,
      );
    } else {
      failures.push(
        `${FIX}: S5's \`NEW.theme#>'{business_event,requestedVisibility}' IS NOT NULL\` conjunct ` +
        `is GONE. Without it a draft that carries a business namespace but no stored visibility ` +
        `choice enters enforcement and is refused with an opaque \`event_visibility_invalid\`, ` +
        `permanently, with no host-facing explanation and no migration path (#2353).`,
      );
    }
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
    "        WHEN COALESCE(v_event.theme#>>'{business_event,format}',",
    "                      v_event.theme#>>'{business_draft,format}')",
    "             IN ('in_person','online','hybrid')",
    "        THEN COALESCE(v_event.theme#>>'{business_event,format}',",
    "                      v_event.theme#>>'{business_draft,format}')",
    "        WHEN v_event.is_online THEN 'online'",
    "        ELSE 'in_person'",
    "      END,",
    "      'city', v_event.city);",
    "END; $fn$;",
  ].join("\n");

  const S3A_GOOD = [
    "    is_online=CASE",
    "      WHEN COALESCE(p_patch->>'format','') IN ('in_person','online','hybrid')",
    "      THEN p_patch->>'format' IN ('online','hybrid')",
    "      ELSE is_online END,",
  ].join("\n");

  const S3B_GOOD = [
    "        jsonb_set(",
    "          CASE WHEN COALESCE(p_patch->>'format','') IN ('in_person','online','hybrid')",
    "            THEN jsonb_set(COALESCE(theme,'{}'::jsonb),'{business_event,format}',",
    "                           to_jsonb(p_patch->>'format'),true)",
    "            ELSE COALESCE(theme,'{}'::jsonb) END,",
    "          '{business_event,settings}',v_settings,true),",
  ].join("\n");

  const S4B_GOOD = [
    "        'is_online',to_jsonb(CASE",
    "          WHEN COALESCE(p_args->>'format','') IN ('in_person','online','hybrid')",
    "            THEN p_args->>'format' IN ('online','hybrid')",
    "          ELSE COALESCE((p_args->>'is_online')::boolean,false) END),",
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
    "          WHEN COALESCE(p_args->>'format','') IN ('in_person','online','hybrid')",
    "            THEN p_args->>'format'",
    "          WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online'",
    "          ELSE 'in_person' END,",
    S4B_GOOD,
    "        'city',p_args->'city');",
    "  IF p_args ? 'format' OR p_args ? 'is_online' THEN",
    "    v_business:=v_business||jsonb_build_object('format',CASE",
    "      WHEN COALESCE(p_args->>'format','') IN ('in_person','online','hybrid')",
    "        THEN p_args->>'format'",
    "      WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online'",
    "      ELSE 'in_person' END);",
    "  END IF;",
    "END; $fn$;",
    "CREATE OR REPLACE FUNCTION public.business_guard_event_publish_visibility()",
    "AS $fn$ BEGIN",
    "  IF OLD.event_type='event'",
    "     AND NEW.theme#>'{business_event,requestedVisibility}' IS NOT NULL THEN",
    "    NULL;",
    "  END IF;",
    "  RETURN NEW;",
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
    /format PERSIST/);

  // 4 — the Ari reads dropped from three sites to two.
  expect("one of the three Ari format reads dropped",
    swap(S4B_GOOD, "        'is_online',COALESCE(p_args->'is_online','false'::jsonb),"),
    /Ari `format` reads survive/);

  // 4b — S5's conjunct deleted, and downgraded from `#>` to `#>>`. One
  // character apart, and the difference is whether a stored JSON null is
  // still refused.
  expect("S5's requestedVisibility conjunct deleted",
    swap("     AND NEW.theme#>'{business_event,requestedVisibility}' IS NOT NULL THEN", "     THEN"),
    /conjunct\s+is GONE/);
  expect("S5's conjunct downgraded from #> to #>>",
    swap("AND NEW.theme#>'{business_event,requestedVisibility}' IS NOT NULL",
         "AND NEW.theme#>>'{business_event,requestedVisibility}' IS NOT NULL"),
    /uses .#>>. where it must use/);

  // 5 — THE #2113 INJECTION TEST. A brand-new migration adds a FIFTH live copy
  // of the defective shape. A count-based gate stays green here; a set-based
  // one cannot.
  expect("a fifth live copy injected in a NEW migration", {
    ...good,
    "supabase/migrations/20270501000000_later.sql": [
      "CREATE OR REPLACE FUNCTION public.some_new_reader(p uuid) AS $fn$ BEGIN",
      "  RETURN jsonb_build_object('format', CASE WHEN e.is_online THEN 'online' ELSE 'in_person' END);",
      "END; $fn$;",
    ].join("\n"),
  }, /NEW format-from-is_online site/);

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
  }, /is GONE|MISSING|guard is GONE|no longer GRANTed/);

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
    "#2353 format-is-read-not-derived self-test PASS (21 cases: the compliant fixture; the S2\n" +
      "  read, the S3(a) projection, the S3(b) persist and one of the three Ari reads each\n" +
      "  reverted INDEPENDENTLY and each caught by its OWN rule; S5's conjunct deleted and\n  downgraded from #> to #>>; a fifth live copy injected in a\n" +
      "  new migration and an allowlisted snippet copied into another file (the #2113\n" +
      "  set-versus-count test, both directions); a later migration re-creating a corrected\n" +
      "  function (last-writer-wins); each grant removed on its own; anon re-granted; the\n" +
      "  [TRANSITIONAL] tag and the EXIT CONDITION each removed alone; the apply-order guard\n" +
      "  deleted, moved below the GRANT, and downgraded off to_regprocedure; the migration\n" +
      "  deleted; a fully commented-out migration; prose about the banned shape; the frozen\n" +
      "  migration edited; and the empty-map vacuity check).",
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
  "#2353 PASS — no new is_online-keyed format derivation; the four #2089 sites are the frozen\n" +
    "allowlist and are still where they were; #2353 is the LAST writer of all four corrected\n" +
    "functions; the stored-first read, the three-valued projection, the format PERSIST and all\n" +
    "three Ari reads are present; the [TRANSITIONAL] authenticated grant is intact with a written\n" +
    "exit condition and anon closed; and the apply-order guard is still the first statement.",
);
