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

  // ---- SC-55(c) grep half — no write verb against either #1770 invitation table -----
  // Read-only references, including a foreign key, are explicitly NOT prohibited.
  for (const table of ["brand_offering_invite_tokens", "brand_offering_invites"]) {
    const writeVerb = new RegExp(
      `(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE)\\s+(public\\.)?${table}\\b`, "i");
    if (writeVerb.test(s.migration)) fail(`released #1931 SQL writes public.${table} (SC-55(c))`);
  }
  // Review Finding B — close the INDIRECT write: a released path that CALLS the landed
  // validator would stamp consumed_at while naming neither table and using no write verb.
  if (/biz_validate_offering_invite_token\s*\(/.test(s.migration)) {
    fail("released #1931 SQL references biz_validate_offering_invite_token( — indirect #1770 token consumption (SC-55(c), review Finding B)");
  }
  // SC-55(d) — #1931 must not re-emit the validator at all.
  if (/(CREATE|ALTER|DROP)\s+FUNCTION\s+(public\.)?biz_validate_offering_invite_token/i.test(s.migration)) {
    fail("released #1931 SQL re-emits biz_validate_offering_invite_token (SC-55(d))");
  }

  // ---- SC-55(a)/(b) — no #1931 interceptor on the live `?oi=` rail --------------------
  if (/"oi"/.test(s.vercel) || /\boi\b\s*:/.test(s.vercel)) {
    fail("mingla-business/vercel.json matches on query key `oi` — the legacy ingress is FROZEN (SC-55(a))");
  }
  if (/private-event-legacy-ingress/.test(s.vercel)) {
    fail("mingla-business/vercel.json routes to the frozen legacy ingress (SC-55(a))");
  }
  if (s.legacyIngressFiles.length > 0) {
    fail(`frozen legacy ingress file(s) present: ${s.legacyIngressFiles.join(", ")} (SC-55(b))`);
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
    // Inside the migration the column may appear ONLY in the ALTER TABLE / ALTER
    // PUBLICATION statements and in COMMENT ON. Any other occurrence is a reader/writer.
    const lines = s.migration.split("\n");
    for (const [i, line] of lines.entries()) {
      if (!line.includes(col)) continue;
      const ok = /ADD COLUMN IF NOT EXISTS|attname NOT LIKE|COMMENT ON COLUMN|^\s*--/.test(line);
      if (!ok) fail(`migration line ${i + 1} reads/writes inert column ${col} outside its ALTER statement (SC-54(c))`);
    }
  }

  // ---- Released posture: readiness must be false and the operator RPC must refuse ----
  if (!/RAISE EXCEPTION 'private_access_release_frozen'/.test(s.migration)) {
    fail("the operator RPC does not raise private_access_release_frozen (SC-45)");
  }
  if (!/CREATE OR REPLACE FUNCTION public\.issue_1931_event_ordinary_read_blocked/.test(s.migration)) {
    fail("the single ordinary-read helper is missing (Amendment 4 §B.3.1)");
  }
  // The predicate is exposed through EXACTLY ONE helper: the jobs table may be named in
  // the migration only by its own DDL and by that helper.
  if (/CREATE POLICY[\s\S]{0,400}event_private_media_transition_jobs/.test(s.migration)) {
    fail("an RLS policy names event_private_media_transition_jobs directly (SC-53(a))");
  }
};

const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

const authored = {};
for (const root of authoredRoots) {
  for (const f of walk(root)) authored[f] = fs.readFileSync(f, "utf8");
}
for (const f of authoredFiles) if (fs.existsSync(f)) authored[f] = fs.readFileSync(f, "utf8");

const sources = {
  migration: readIf(MIGRATION),
  migrationList: fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")),
  consumerNative: readIf(CONSUMER_NATIVE),
  businessNative: readIf(BUSINESS_NATIVE),
  marketing: readIf(MARKETING_SEND),
  vercel: readIf(VERCEL_JSON),
  authored,
  legacyIngressFiles: walk("mingla-business/api").filter((f) => /private-event-legacy-ingress/.test(f)),
};

if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    // SC-55 reverts N1-N4
    { label: "N1 vercel.json gains an `oi` rewrite",
      apply: (s) => ({ ...s, vercel: s.vercel.replace('"rewrites": [', '"rewrites": [ { "source": "/e/:b/:e", "has": [{"type":"query","key":"oi"}], "destination": "/api/private-event-legacy-ingress" },') }) },
    { label: "N2 the frozen legacy ingress file lands",
      apply: (s) => ({ ...s, legacyIngressFiles: ["mingla-business/api/private-event-legacy-ingress.js"] }) },
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
      apply: (s) => ({ ...s, migration: s.migration.replace("RAISE EXCEPTION 'private_access_release_frozen';", "RETURN true;") }) },
    // SC-51
    { label: "SC-51 a second #1931 migration appears",
      apply: (s) => ({ ...s, migrationList: [...s.migrationList, "20270415001931_issue_1931_extra.sql"] }) },
  ];
  for (const mutation of mutations) {
    let rejected = false;
    try { check(mutation.apply(sources)); } catch { rejected = true; }
    if (!rejected) fail(`self-test mutation survived: ${mutation.label}`);
  }
  console.log(`issue-1931 private event access self-test: PASS — GOOD + ${mutations.length} BAD fixtures`);
} else {
  check(sources);
  console.log("issue-1931 private event access: PASS");
}
