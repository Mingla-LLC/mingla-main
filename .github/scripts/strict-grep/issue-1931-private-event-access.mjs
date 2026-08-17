#!/usr/bin/env node
// Issue #1931 — released-set gate.
//
// This gate asserts the RELEASED/FROZEN boundary of #1931. It is #1931's OWN gate:
// it never modifies, and never restates the conclusions of,
// .github/scripts/strict-grep/issue-1930-checkout-current-truth.mjs or
// .github/scripts/strict-grep/issue-2050-host-route-ownership.mjs, both of which remain
// DO-NOT-TOUCH and are separately proven to pass unchanged.
//
// Criteria carried here: SC-49(a)(b)(c)(d), SC-50, SC-51, SC-54(c), SC-55(a)(b)(c).
import fs from "node:fs";
import path from "node:path";

const MIGRATION = "supabase/migrations/20270413001931_issue_1931_private_event_access.sql";
const MIGRATION_FLOOR = "20270412001795";
const CONSUMER_NATIVE = "app-mobile/src/payments/nativeCheckoutFlow.ts";
const BUSINESS_NATIVE = "mingla-business/src/payments/nativeCheckoutFlow.native.ts";
const MARKETING_SEND = "supabase/functions/marketing-send/index.ts";
const VERCEL_JSON = "mingla-business/vercel.json";
const RETIRED_HOST = "business.usemingla.com";

const fail = (message) => {
  throw new Error(`issue-1931-private-event-access: ${message}`);
};

// ---------------------------------------------------------------------------------
// SQL normalisers. The tester defeated the first version of this gate three ways:
// a trailing `-- ADD COLUMN` comment forged the inert-column allowance, and string
// concatenation (`'UPDATE public.brand_offering_' || 'invite_tokens ...'`) hid a write
// verb from a literal substring match. Both are closed by normalising BEFORE matching,
// never by matching harder.
// ---------------------------------------------------------------------------------

/** Strip `--` line comments and block comments, preserving line structure. */
const stripSqlComments = (sql) => {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql.startsWith("--", i)) {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? n : j;                       // drop through end of line
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const j = sql.indexOf("*/", i);
      const seg = sql.slice(i, j < 0 ? n : j + 2);
      out += seg.replace(/[^\n]/g, " ");       // keep newlines so line numbers hold
      i = j < 0 ? n : j + 2;
      continue;
    }
    if (sql[i] === "'") {                       // copy string literals verbatim
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          j += 1; break;
        }
        j += 1;
      }
      out += sql.slice(i, j); i = j; continue;
    }
    out += sql[i]; i += 1;
  }
  return out;
};

/**
 * Fold SQL string concatenation so a split identifier reads as one token, then drop the
 * quotes so `'UPDATE public.brand_offering_' || 'invite_tokens'` normalises to
 * `UPDATE public.brand_offering_invite_tokens`. Applied on top of comment stripping.
 */
const foldSqlConcat = (sql) =>
  sql
    .replace(/'\s*\|\|\s*'/g, "")   // join adjacent literals across ||
    .replace(/'\s*\|\|\s*/g, "'")   // literal || expr
    .replace(/\s*\|\|\s*'/g, "'");  // expr || literal

/** Comment-free, concatenation-folded, quote-free view used for every write-verb check. */
const normalizeSql = (sql) => foldSqlConcat(stripSqlComments(sql)).replace(/'/g, "");

// Every file #1931 authored or is permitted to touch, for the "no hostname literal"
// and "no released reader/writer" sweeps.
const authoredRoots = [
  "supabase/functions/private-event-access",
  "supabase/functions/private-event-read",
  "supabase/functions/private-event-media",
];
const authoredFiles = ["supabase/functions/_shared/privateEventAccess.ts"];

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const check = (s) => {
  // ---- SC-51 — sole #1931 migration, above the ordering floor, no historical edit ----
  const migName = path.basename(MIGRATION);
  const stamp = migName.slice(0, 14);
  if (!(stamp > MIGRATION_FLOOR)) fail(`migration timestamp ${stamp} is not above the floor ${MIGRATION_FLOOR}`);
  if (s.migrationList.filter((f) => /issue_1931/i.test(f)).length !== 1) {
    fail("there must be exactly ONE #1931 migration (SC-51)");
  }
  // P3-4 — a SECOND migration sharing this exact timestamp prefix would apply in an
  // undefined order relative to ours. Name-uniqueness alone does not catch it.
  const sameStamp = s.migrationList.filter((f) => f.startsWith(stamp));
  if (sameStamp.length !== 1) {
    fail(`migration timestamp ${stamp} collides with ${sameStamp.length - 1} other migration(s): ${sameStamp.join(", ")} (SC-51)`);
  }

  // ---- SC-55(c) grep half — no write verb against either #1770 invitation table -----
  // Read-only references, including a foreign key, are explicitly NOT prohibited.
  // Checked over the NORMALISED migration so comments and string concatenation cannot
  // hide the verb. `migrationNorm` is comment-free, concat-folded and quote-free.
  //
  // P3-B — READ THIS BEFORE TOUCHING THE PROBE THIS COMMENT NAMES.
  //
  // This grep is DEFENCE IN DEPTH, not the load-bearing detector. The independent tester
  // executed three evasions that still slip past it, all of them GREEN here:
  //     1. format('%I', 'brand_offering_invite_tokens')
  //     2. chr()-built identifiers concatenated at runtime
  //     3. a table name held in a variable
  // A source-text scan cannot close those in general — the identifier does not exist
  // until execution.
  //
  // ALL THREE DIE on the behavioural detector instead: the non-transactional sequence
  // probe in
  //     supabase/migrations/__tests__/issue_1931_private_event_access.test.sql  (SC-55(c))
  // which counts write ATTEMPTS via nextval() — surviving subtransaction rollback, so it
  // catches write-then-raise — together with the durable pre-migration seed in
  //     supabase/migrations/__tests__/issue_1931_migration_time_probe.{seed,verify}.sql
  // which catches writes performed BY the migration itself, when both tables would
  // otherwise be empty and every row assertion vacuous.
  //
  // So: do NOT delete or weaken those probes on the belief that this grep covers the
  // #1770 rail. It does not. The probes are the guarantee; this grep only makes the
  // obvious spelling fail fast and early, in CI, without a database.
  for (const table of ["brand_offering_invite_tokens", "brand_offering_invites"]) {
    const writeVerb = new RegExp(
      `(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE)\\s+(public\\.)?${table}\\b`, "i");
    if (writeVerb.test(s.migrationNorm)) fail(`released #1931 SQL writes public.${table} (SC-55(c))`);
  }
  // Review Finding B — close the INDIRECT write: a released path that CALLS the landed
  // validator would stamp consumed_at while naming neither table and using no write verb.
  if (/biz_validate_offering_invite_token\s*\(/.test(s.migrationNorm)) {
    fail("released #1931 SQL references biz_validate_offering_invite_token( — indirect #1770 token consumption (SC-55(c), review Finding B)");
  }
  // SC-55(d) — #1931 must not re-emit the validator at all.
  if (/(CREATE|ALTER|DROP)\s+FUNCTION\s+(public\.)?biz_validate_offering_invite_token/i.test(s.migrationNorm)) {
    fail("released #1931 SQL re-emits biz_validate_offering_invite_token (SC-55(d))");
  }

  // ---- SC-55(a)/(b) — no #1931 interceptor on the live `?oi=` rail --------------------
  if (/"oi"/.test(s.vercel) || /\boi\b\s*:/.test(s.vercel)) {
    fail("mingla-business/vercel.json matches on query key `oi` — the legacy ingress is FROZEN (SC-55(a))");
  }
  if (/private-event-legacy-ingress/.test(s.vercel)) {
    fail("mingla-business/vercel.json routes to the frozen legacy ingress (SC-55(a))");
  }
  // P3-3 — the previous version matched the literal path `private-event-legacy-ingress`,
  // so a RENAMED ingress or one placed in a root `api/` directory survived. This now
  // asserts the SHAPE: no serverless handler added under any api/ directory may read or
  // match the legacy invitation query key, whatever it is called or wherever it lives.
  for (const [file, text] of Object.entries(s.apiHandlers)) {
    if (/\bprivate-event-legacy-ingress\b/.test(file)) {
      fail(`frozen legacy ingress file present: ${file} (SC-55(b))`);
    }
    if (/searchParams\.get\(\s*["'`]oi["'`]|req\.query\s*\.\s*oi\b|query\[\s*["'`]oi["'`]\s*\]|["'`]oi["'`]\s*in\s+/.test(text)) {
      fail(`api handler ${file} reads the legacy invitation query key — frozen item 5, whatever the file is named (SC-55(b))`);
    }
  }
  for (const [file, text] of Object.entries(s.authored)) {
    if (/["'`]oi["'`]/.test(text) || /searchParams\.get\(\s*["'`]oi["'`]/.test(text)) {
      fail(`released #1931 file ${file} reads or matches query key \`oi\` — frozen item 5 (SC-55(b))`);
    }
  }

  // ---- SC-49(a)/(b) — no retired host, no hostname literal in authored composition ----
  const authoredEntries = [[MIGRATION, s.migration], ...Object.entries(s.authored)];
  for (const [file, text] of authoredEntries) {
    if (text.includes(RETIRED_HOST)) fail(`${file} contains the retired host ${RETIRED_HOST} (SC-49(a))`);
    const hostLiteral = /https?:\/\/[a-z0-9.-]*(usemingla\.com|mingla\.app)/i;
    if (hostLiteral.test(text)) fail(`${file} embeds a hostname literal in a #1931-authored composition (SC-49(b))`);
  }

  // ---- SC-49(c)/(d) — marketing-send is FROZEN and byte-unchanged --------------------
  // Its landed query-form writers must both still be present, and #1931 must not appear.
  if (!s.marketing.includes('url.searchParams.set("oi", winner.opaqueToken)')) {
    fail("marketing-send/index.ts no longer emits the landed `?oi=` query form — the composer is FROZEN (SC-49(c))");
  }
  if (!s.marketing.includes("getPublicAppOrigin")) fail("getPublicAppOrigin() removed from marketing-send (SC-49(d))");
  if (/issue_1931|issue-1931|private-event-access/.test(s.marketing)) {
    fail("marketing-send/index.ts carries a #1931 edit — the file is FROZEN and DO-NOT-TOUCH (SC-49(c))");
  }
  for (const [file, text] of authoredEntries) {
    if (/getPublicAppOrigin\s*\(/.test(text)) fail(`${file} calls getPublicAppOrigin() (SC-49(d))`);
  }

  // ---- SC-50 — both native flows byte-unchanged and correctly ordered ----------------
  // #1931 does NOT modify issue-1930-checkout-current-truth.mjs; this gate carries the
  // assertions that gate's `indexOf` predicate is structurally unable to make.
  for (const [name, text] of [["consumer", s.consumerNative], ["business", s.businessNative]]) {
    const preflights = (text.match(/preflightPaymentSheet\(/g) ?? []).length;
    if (preflights !== 2) fail(`${name} native flow has ${preflights} \`preflightPaymentSheet(\` occurrences, expected exactly 2 (SC-50(a))`);
    const presents = (text.match(/presentPaymentSheet\(\)/g) ?? []).length;
    if (presents !== 1) fail(`${name} native flow has ${presents} \`presentPaymentSheet()\` occurrences, expected exactly 1 (SC-50(b))`);
    if (!(text.lastIndexOf("preflightPaymentSheet(") < text.indexOf("presentPaymentSheet()"))) {
      fail(`${name} native flow calls preflight AFTER present (SC-50(c))`);
    }
    if (!text.includes("preflight: true")) fail(`${name} native flow lost \`preflight: true\` (SC-50(d))`);
    if (/issue_1931|issue-1931|private-event-access|privateAccess/.test(text)) {
      fail(`${name} native flow carries a #1931 edit — DO-NOT-TOUCH this release (SC-50(e))`);
    }
  }

  // ---- SC-54(c) — no released path reads or writes the inert columns -----------------
  const inertColumns = [
    "issue_1931_grant_id", "issue_1931_token_epoch_id",
    "issue_1931_access_epoch", "issue_1931_principal_kind",
  ];
  for (const col of inertColumns) {
    for (const [file, text] of Object.entries(s.authored)) {
      if (text.includes(col)) fail(`released file ${file} names inert column ${col} (SC-54(c))`);
    }
    // Inside the migration the column may appear ONLY in an `ALTER TABLE ... ADD COLUMN`
    // statement, the publication-pinning exclusion predicate, or a COMMENT ON COLUMN.
    //
    // Checked on the COMMENT-STRIPPED text: the previous version tested the raw line and
    // was forgeable by appending `-- ADD COLUMN IF NOT EXISTS` to a real write, which the
    // tester demonstrated. A comment can no longer create an allowance, because comments
    // no longer exist by the time this runs.
    const lines = s.migrationNoComments.split("\n");
    for (const [i, line] of lines.entries()) {
      if (!line.includes(col)) continue;
      const ok = /^\s*ADD COLUMN IF NOT EXISTS\s+issue_1931_/.test(line)
        || /attname NOT LIKE/.test(line)
        || /^\s*COMMENT ON COLUMN\s+public\./.test(line);
      if (!ok) fail(`migration line ${i + 1} reads/writes inert column ${col} outside its ALTER statement (SC-54(c)): ${line.trim().slice(0, 90)}`);
    }
  }

  // ---- Released posture: readiness must be false and the operator RPC must refuse ----
  // Scoped to the OPERATOR RPC's own body. The reason class is deliberately shared with
  // the transition RPCs' unreachable tail, so a migration-wide match would be satisfied
  // by any of them and would not see the operator refusal being removed.
  const operatorBody = stripSqlComments(s.migration).match(
    /CREATE OR REPLACE FUNCTION public\.issue_1931_enable_private_event_access\b[\s\S]*?\$function\$;/,
  )?.[0] ?? "";
  if (operatorBody === "") fail("the operator arming RPC is missing (SC-45)");
  if (!/RAISE EXCEPTION 'private_access_release_frozen'/.test(operatorBody)) {
    fail("the operator RPC does not raise private_access_release_frozen (SC-45)");
  }
  if (/\bRETURN\s+true\b/i.test(operatorBody)) {
    fail("the operator RPC has a path that returns true (SC-45)");
  }
  // P3-A — EVERY presence assertion below runs on `migrationNoComments`, never on the raw
  // text. A presence assertion over raw SQL is satisfiable by a COMMENT: the tester
  // executed exactly that against the publish-block check and the gate went GREEN. The
  // operator-RPC check above already stripped comments, so this was an inconsistency
  // inside this file rather than a design question. Both are consistent now.
  if (!/CREATE OR REPLACE FUNCTION public\.issue_1931_event_ordinary_read_blocked/.test(s.migrationNoComments)) {
    fail("the single ordinary-read helper is missing (Amendment 4 §B.3.1)");
  }
  // P1-1 — the AUTHORITATIVE legacy-Private-draft publish block. The client hook is a
  // convenience; this is the half that actually prevents a Private publish, and the
  // tester proved a client-only helper nothing invokes is worthless.
  if (!/IF v_visibility = 'private' AND NOT public\.issue_1931_private_event_access_ready\(\) THEN/.test(s.migrationNoComments)) {
    fail("business_publish_event_draft is missing the Private publish block (Amendment 1 §3)");
  }
  // The predicate is exposed through EXACTLY ONE helper: the jobs table may be named in
  // the migration only by its own DDL and by that helper.
  if (/CREATE POLICY[\s\S]{0,400}event_private_media_transition_jobs/.test(s.migrationNoComments)) {
    fail("an RLS policy names event_private_media_transition_jobs directly (SC-53(a))");
  }
};

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

const authored = {};
for (const root of authoredRoots) {
  for (const f of walk(root)) authored[f] = fs.readFileSync(f, "utf8");
}
for (const f of authoredFiles) if (fs.existsSync(f)) authored[f] = fs.readFileSync(f, "utf8");

const migrationRaw = readIf(MIGRATION);
const sources = {
  migration: migrationRaw,
  migrationNoComments: stripSqlComments(migrationRaw),
  migrationNorm: normalizeSql(migrationRaw),
  migrationList: fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")),
  consumerNative: readIf(CONSUMER_NATIVE),
  businessNative: readIf(BUSINESS_NATIVE),
  marketing: readIf(MARKETING_SEND),
  vercel: readIf(VERCEL_JSON),
  authored,
  apiHandlers: Object.fromEntries(
    [...walk("mingla-business/api"), ...walk("api")]
      .filter((f) => /\.(js|mjs|ts)$/.test(f))
      .map((f) => [f, fs.readFileSync(f, "utf8")]),
  ),
};

if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    // SC-55 reverts N1-N4
    { label: "N1 vercel.json gains an `oi` rewrite",
      apply: (s) => ({ ...s, vercel: s.vercel.replace('"rewrites": [', '"rewrites": [ { "source": "/e/:b/:e", "has": [{"type":"query","key":"oi"}], "destination": "/api/private-event-legacy-ingress" },') }) },
    { label: "N2 the frozen legacy ingress file lands",
      apply: (s) => ({ ...s, apiHandlers: { ...s.apiHandlers, "mingla-business/api/private-event-legacy-ingress.js": "export default () => {};" } }) },
    { label: "N3 released SQL consumes a #1770 token",
      apply: (s) => ({ ...s, migration: s.migration + "\nUPDATE public.brand_offering_invite_tokens SET consumed_at=now();\n" }) },
    { label: "N3b released SQL calls the landed validator (indirect write, Finding B)",
      apply: (s) => ({ ...s, migration: s.migration + "\nSELECT public.biz_validate_offering_invite_token('t',NULL,NULL,NULL,NULL,NULL);\n" }) },
    { label: "N4 released SQL re-emits the validator",
      apply: (s) => ({ ...s, migration: s.migration + "\nCREATE OR REPLACE FUNCTION public.biz_validate_offering_invite_token() RETURNS void AS $$ $$ LANGUAGE sql;\n" }) },
    // SC-49
    { label: "SC-49 M3 retired host hardcoded",
      apply: (s) => ({ ...s, migration: s.migration + "\n-- https://business.usemingla.com/e/x\n" }) },
    { label: "SC-49(c) marketing-send switched to the fragment form",
      apply: (s) => ({ ...s, marketing: s.marketing.replace('url.searchParams.set("oi", winner.opaqueToken)', 'url.hash = `oi=${winner.opaqueToken}`') }) },
    // SC-50 M1/M2/M3/M4
    { label: "SC-50 M1 duplicate preflight call after present",
      apply: (s) => ({ ...s, consumerNative: s.consumerNative + "\nawait preflightPaymentSheet();\n" }) },
    { label: "SC-50 M3 preflight:true deleted",
      apply: (s) => ({ ...s, businessNative: s.businessNative.replace("preflight: true", "preflight: false") }) },
    { label: "SC-50 M4 a #1931 edit lands in a native flow",
      apply: (s) => ({ ...s, businessNative: s.businessNative + "\n// issue_1931 private access\n" }) },
    // SC-54(c)
    { label: "SC-54(c) a released path reads an inert column",
      apply: (s) => ({ ...s, migration: s.migration + "\nSELECT issue_1931_grant_id FROM public.ticket_checkout_sessions;\n" }) },
    // SC-45
    { label: "SC-45 M1 the unconditional frozen-release refusal is removed",
      apply: (s) => ({ ...s, migration: s.migration.replace(
        /(CREATE OR REPLACE FUNCTION public\.issue_1931_enable_private_event_access\b[\s\S]*?)RAISE EXCEPTION 'private_access_release_frozen';/,
        "$1RETURN true;") }) },
    // SC-51
    // ---- The exact evasions the independent tester demonstrated against v1 ----------
    { label: "TESTER E1 — inert-column write forged by a trailing `-- ADD COLUMN` comment",
      apply: (s) => ({ ...s, migration: s.migration + "\nUPDATE public.ticket_checkout_sessions SET issue_1931_grant_id = gen_random_uuid(); -- ADD COLUMN IF NOT EXISTS issue_1931_grant_id\n" }) },
    { label: "TESTER E2 — #1770 write hidden by string concatenation",
      apply: (s) => ({ ...s, migration: s.migration + "\nEXECUTE 'UPDATE public.brand_offering_' || 'invite_tokens SET consumed_at = now()';\n" }) },
    { label: "TESTER E3 — #1770 write concatenated across the schema qualifier",
      apply: (s) => ({ ...s, migration: s.migration + "\nEXECUTE 'DELETE FROM public.' || 'brand_offering_invites';\n" }) },
    { label: "TESTER E4 — legacy ingress RENAMED to evade the literal path match",
      apply: (s) => ({ ...s, apiHandlers: { ...s.apiHandlers, "mingla-business/api/legacy-invite-entry.js": "export default (req)=>{ const t = req.query.oi; return t; }" } }) },
    { label: "TESTER E5 — legacy ingress placed in a ROOT api/ directory",
      apply: (s) => ({ ...s, apiHandlers: { ...s.apiHandlers, "api/invite-ingress.js": "const u=new URL(req.url); const t=u.searchParams.get('oi');" } }) },
    { label: "TESTER E6 — a second migration sharing the same timestamp prefix",
      apply: (s) => ({ ...s, migrationList: [...s.migrationList, "20270413001931_issue_2222_other.sql"] }) },
    // ---- P3-A: a COMMENT must never satisfy a presence assertion --------------------
    { label: "P3-A — publish block DELETED but a comment quotes it verbatim",
      apply: (s) => ({ ...s, migration: s.migration.replace(
        "  IF v_visibility = 'private' AND NOT public.issue_1931_private_event_access_ready() THEN\n    RAISE EXCEPTION 'private_access_not_ready';\n  END IF;\n",
        "  -- IF v_visibility = 'private' AND NOT public.issue_1931_private_event_access_ready() THEN\n  --   RAISE EXCEPTION 'private_access_not_ready';\n  -- END IF;\n") }) },
    { label: "P3-A — ordinary-read helper DELETED but a comment quotes its CREATE",
      apply: (s) => ({ ...s, migration: s.migration.replace(
        "CREATE OR REPLACE FUNCTION public.issue_1931_event_ordinary_read_blocked(p_event_id uuid)",
        "-- CREATE OR REPLACE FUNCTION public.issue_1931_event_ordinary_read_blocked(p_event_id uuid)\nCREATE OR REPLACE FUNCTION public.issue_1931_helper_renamed_away(p_event_id uuid)") }) },
    { label: "P1-1 — the authoritative publish block is deleted from the migration",
      apply: (s) => ({ ...s, migration: s.migration.replace("  IF v_visibility = 'private' AND NOT public.issue_1931_private_event_access_ready() THEN\n    RAISE EXCEPTION 'private_access_not_ready';\n  END IF;\n", "") }) },
    { label: "SC-51 a second #1931 migration appears",
      apply: (s) => ({ ...s, migrationList: [...s.migrationList, "20270415001931_issue_1931_extra.sql"] }) },
  ];
  for (const mutation of mutations) {
    let mutated = mutation.apply(sources);
    // Derived views MUST be recomputed from the mutated raw source, or a mutation would
    // be tested against a stale normalisation and could appear to be caught when it is not.
    mutated = {
      ...mutated,
      migrationNoComments: stripSqlComments(mutated.migration),
      migrationNorm: normalizeSql(mutated.migration),
    };
    let rejected = false;
    try { check(mutated); } catch { rejected = true; }
    if (!rejected) fail(`self-test mutation survived: ${mutation.label}`);
  }
  console.log(`issue-1931 private event access self-test: PASS — GOOD + ${mutations.length} BAD fixtures`);
} else {
  check(sources);
  console.log("issue-1931 private event access: PASS");
}
