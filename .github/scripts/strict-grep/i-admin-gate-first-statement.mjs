#!/usr/bin/env node
/**
 * ORCH-1271 [Admin authorization & audit FOUNDATION] — I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT.
 *
 * RULE: in every admin SECURITY DEFINER RPC, the is_admin_user() guard is the
 * FIRST executable statement (after DECLARE / comments, before ANY query). A
 * query BEFORE the guard opens a fail-open exposure window.
 *
 * For each registered function: slice the plpgsql body, find the first BEGIN,
 * strip comment lines, take the first statement (up to the first ';'), and assert
 * it is an `IF ... is_admin_user() ... THEN ... RAISE` guard. Both accepted forms:
 *   * IF NOT public.is_admin_user() THEN RAISE ...            (probe / template)
 *   * IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE ...  (helper)
 * A query (SELECT/INSERT/UPDATE/DELETE/PERFORM) as the first statement → FAIL.
 *
 * Reverting the ORCH-1271 primitive migration removes these functions → FAIL.
 * `--self-test` proves FAIL-on-revert with GOOD/BAD fixtures.
 *
 * ── APPEND-ONLY REGISTRY ──────────────────────────────────────────────────────
 * 1272/1273/1274 APPEND their admin_* SECURITY DEFINER fn names here.
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

const GUARDED_DEFINER_FNS = [
  "admin_write_audit",
  "admin_audit_probe",
  // ORCH-1272 [Admin Identity console — READ-ONLY]: the unified Person read-RPC.
  // READ-ONLY (no admin_write_audit / write-RPC registry) but its is_admin_user()
  // guard MUST still be the first statement.
  "admin_get_person",
  // ORCH-1273 [Admin Offerings console — READ-ONLY]: the 5 offerings/venue read-
  // RPCs + the offering-stats aggregate. All READ-ONLY (no admin_write_audit /
  // write-RPC registry) but each is_admin_user() guard MUST be the first statement.
  "admin_list_offerings",
  "admin_get_offering",
  "admin_list_event_orders",
  "admin_list_event_rsvps",
  "admin_list_venue_reservations",
  "admin_offering_stats",
  // ORCH-1274 [Admin Money console — READ-ONLY]: the 10 money read-RPCs. READ-ONLY
  // (no admin_write_audit / write-RPC registry) but each is_admin_user() guard MUST
  // be the first statement. Reverting 20261207000000_orch_1274_money_read_rpcs.sql
  // removes these fns → this gate FAILS.
  "admin_list_brand_stripe_status",
  "admin_get_brand_stripe_status",
  "admin_list_orders",
  "admin_get_order",
  "admin_list_refunds",
  "admin_list_disputes",
  "admin_get_dispute",
  "admin_list_payouts",
  "admin_list_revenue_log",
  "admin_get_subscription_detail",
  // ORCH-1276 [Admin Identity console — WAVE-2 EDIT]: the 11 audited identity write
  // RPCs (A1–A5, B1–B2, C1–C3, D1–D2). Each is_admin_user() guard MUST be the first
  // statement. Reverting 20261208000001-4 removes these fns → this gate FAILS.
  "admin_update_brand",
  "admin_reassign_brand_owner",
  "admin_set_brand_claim_status",
  "admin_set_brand_deleted",
  "admin_update_account",
  "admin_set_account_deleted",
  "admin_set_team_member_role",
  "admin_remove_team_member",
  "admin_revoke_brand_invitation",
  "admin_set_user_active",
  "admin_set_user_beta",
  // ORCH-1278 [Admin Money console — WAVE-2 ACT]: the 5 audited money-act RPCs. The
  // two refund twins use the service_role-safe guard form (auth.uid() IS NOT NULL AND
  // NOT is_admin_user()); the 3 DB-only acts use the plain is_admin_user() form. Both
  // are accepted by GUARD_RE and MUST be the first statement. Reverting 20261210000000
  // removes these fns → this gate FAILS.
  "admin_refund_order",
  "admin_refund_order_commit",
  "admin_annotate_dispute",
  "admin_grant_override_audited",
  "admin_revoke_override_audited",
  // ORCH-1277 [Admin Offerings console — WAVE-2 EDIT]: the 16 audited offerings/venues
  // write RPCs (#1–16). Each is_admin_user() guard MUST be the first statement.
  // Reverting 20261209000000-1 removes these fns → this gate FAILS.
  "admin_set_offering_visibility",
  "admin_cancel_offering",
  "admin_set_offering_bookings_closed",
  "admin_set_offering_deleted",
  "admin_set_ticket_price",
  "admin_update_trip_day",
  "admin_reorder_trip_day",
  "admin_update_experience_stop",
  "admin_delete_experience_stop",
  "admin_reorder_experience_stop",
  "admin_set_rsvp_approval",
  "admin_remove_rsvp_guest",
  "admin_set_rsvp_capacity",
  "admin_update_venue_reservation_settings",
  "admin_update_venue_capacity_rule",
  "admin_set_reservation_status",
  // ISSUE-1354 [Admin Tool Leads console — READ-ONLY]: the 2 tool_leads read-RPCs
  // (list + detail) behind the admin "Tool Leads" page. READ-ONLY but each
  // is_admin_user() guard MUST be the first statement. Reverting
  // 20270119001354_issue_1354_tool_leads_admin_rpc.sql removes these fns → FAIL.
  "admin_tool_leads_list",
  "admin_tool_lead_get",
];

function fnBody(src, name) {
  const defRe = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\b`, "i");
  const m = defRe.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const open = rest.indexOf("$$");
  if (open < 0) return null;
  const close = rest.indexOf("$$", open + 2);
  if (close < 0) return null;
  return rest.slice(open + 2, close);
}

function firstStatement(body) {
  const bi = body.search(/\bBEGIN\b/i);
  if (bi < 0) return null;
  let after = body.slice(bi + "BEGIN".length);
  // Strip full-line SQL comments so the first *executable* statement is measured.
  after = after
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  const semi = after.indexOf(";");
  return (semi < 0 ? after : after.slice(0, semi)).trim();
}

const GUARD_RE = /^IF\b[\s\S]*?\bNOT\b[\s\S]*?is_admin_user\s*\(\s*\)[\s\S]*?\bTHEN\b[\s\S]*?\bRAISE\b/i;

function check(src, failures) {
  for (const name of GUARDED_DEFINER_FNS) {
    const body = fnBody(src, name);
    if (!body) {
      failures.push(`admin definer fn ${name} is missing from migrations.`);
      continue;
    }
    const first = firstStatement(body);
    if (!first) {
      failures.push(`admin definer fn ${name}: could not locate the first statement.`);
      continue;
    }
    if (!GUARD_RE.test(first)) {
      failures.push(
        `admin definer fn ${name}: first executable statement is NOT an is_admin_user() ` +
          `guard (found: "${first.slice(0, 80).replace(/\s+/g, " ")}...").`,
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const helper =
    "create or replace function public.admin_write_audit(p_action text) returns uuid " +
    "language plpgsql security definer as $$ declare v_id uuid; begin " +
    "-- guard first\n if auth.uid() is not null and not public.is_admin_user() then " +
    "raise exception 'not_authorized'; end if; insert into public.admin_audit_log(action) " +
    "values (p_action) returning id into v_id; return v_id; end; $$;\n";
  const probe =
    "create or replace function public.admin_audit_probe(p_reason text) returns uuid " +
    "language plpgsql security definer as $$ begin if not public.is_admin_user() then " +
    "raise exception 'not_authorized'; end if; return public.admin_write_audit('x'); end; $$;\n";
  // ORCH-1272: the READ-ONLY admin_get_person read-RPC — registered here (guard MUST
  // be first). Included in the good/other-subject fixtures so the self-test isolates
  // the intended violation instead of tripping on a missing registry fn.
  const getPerson =
    "create or replace function public.admin_get_person(p_user_id uuid) returns jsonb " +
    "language plpgsql security definer as $$ declare v_out jsonb; begin if not public.is_admin_user() then " +
    "raise exception 'not_authorized'; end if; return '{}'::jsonb; end; $$;\n";
  // ORCH-1273: the 6 READ-ONLY offerings/venue read-RPCs — registered here (guard
  // MUST be first). Included in the good/other-subject fixtures (as 1272 did for
  // admin_get_person) so the self-test isolates the intended violation instead of
  // tripping on a missing registry fn.
  const offerings1273 = [
    "admin_list_offerings", "admin_get_offering", "admin_list_event_orders",
    "admin_list_event_rsvps", "admin_list_venue_reservations", "admin_offering_stats",
  ]
    .map(
      (n) =>
        `create or replace function public.${n}() returns jsonb language plpgsql stable security definer as $$ declare v jsonb; begin if not public.is_admin_user() then raise exception 'not_authorized'; end if; return '{}'::jsonb; end; $$;\n`,
    )
    .join("");
  // ORCH-1274: the 10 READ-ONLY money read-RPCs — registered here (guard MUST be
  // first). Included in the good/other-subject fixtures so the self-test isolates
  // the intended violation instead of tripping on missing registry fns.
  const moneyFns = [
    "admin_list_brand_stripe_status", "admin_get_brand_stripe_status", "admin_list_orders",
    "admin_get_order", "admin_list_refunds", "admin_list_disputes", "admin_get_dispute",
    "admin_list_payouts", "admin_list_revenue_log", "admin_get_subscription_detail",
  ]
    .map(
      (n) =>
        `create or replace function public.${n}() returns jsonb language plpgsql security definer as $$ ` +
        "begin if not public.is_admin_user() then raise exception 'not_authorized'; end if; return '{}'::jsonb; end; $$;\n",
    )
    .join("");
  // ORCH-1276: the 11 audited identity write RPCs — registered above (guard MUST be
  // first). Included in the good/other-subject fixtures (as 1272/1273/1274 do) so the
  // self-test isolates the intended violation instead of tripping on missing fns.
  const identity1276 = [
    "admin_update_brand", "admin_reassign_brand_owner", "admin_set_brand_claim_status",
    "admin_set_brand_deleted", "admin_update_account", "admin_set_account_deleted",
    "admin_set_team_member_role", "admin_remove_team_member", "admin_revoke_brand_invitation",
    "admin_set_user_active", "admin_set_user_beta",
  ]
    .map(
      (n) =>
        `create or replace function public.${n}(p_id uuid) returns jsonb language plpgsql security definer as $$ ` +
        "begin if not public.is_admin_user() then raise exception 'not_authorized'; end if; return '{}'::jsonb; end; $$;\n",
    )
    .join("");
  // ORCH-1278: the 5 audited money-act RPCs — registered above (guard MUST be first).
  // The two refund twins use the service_role-safe guard form; include all 5 in the
  // good/other-subject fixtures so the self-test isolates the intended violation.
  const money1278 =
    ["admin_refund_order", "admin_refund_order_commit"]
      .map(
        (n) =>
          `create or replace function public.${n}(p_id uuid) returns jsonb language plpgsql security definer as $$ ` +
          "begin if auth.uid() is not null and not public.is_admin_user() then raise exception 'not_authorized'; end if; " +
          "return '{}'::jsonb; end; $$;\n",
      )
      .join("") +
    ["admin_annotate_dispute", "admin_grant_override_audited", "admin_revoke_override_audited"]
      .map(
        (n) =>
          `create or replace function public.${n}(p_id uuid) returns jsonb language plpgsql security definer as $$ ` +
          "begin if not public.is_admin_user() then raise exception 'not_authorized'; end if; return '{}'::jsonb; end; $$;\n",
      )
      .join("");
  // ORCH-1277: the 16 audited offerings/venues write RPCs — registered above (guard MUST
  // be first). Included in the good/other-subject fixtures so the self-test isolates the
  // intended violation instead of tripping on missing fns.
  const offerings1277 = [
    "admin_set_offering_visibility", "admin_cancel_offering", "admin_set_offering_bookings_closed",
    "admin_set_offering_deleted", "admin_set_ticket_price", "admin_update_trip_day",
    "admin_reorder_trip_day", "admin_update_experience_stop", "admin_delete_experience_stop",
    "admin_reorder_experience_stop", "admin_set_rsvp_approval", "admin_remove_rsvp_guest",
    "admin_set_rsvp_capacity", "admin_update_venue_reservation_settings",
    "admin_update_venue_capacity_rule", "admin_set_reservation_status",
  ]
    .map(
      (n) =>
        `create or replace function public.${n}(p_id uuid) returns jsonb language plpgsql security definer as $$ ` +
        "begin if not public.is_admin_user() then raise exception 'not_authorized'; end if; return '{}'::jsonb; end; $$;\n",
    )
    .join("");
  // ISSUE-1354: the 2 READ-ONLY tool_leads read-RPCs — registered above (guard MUST
  // be first). Included in the good/other-subject fixtures so the self-test isolates
  // the intended violation instead of tripping on missing registry fns.
  const toolLeads1354 = ["admin_tool_leads_list", "admin_tool_lead_get"]
    .map(
      (n) =>
        `create or replace function public.${n}() returns jsonb language plpgsql stable security definer as $$ declare v jsonb; begin if not public.is_admin_user() then raise exception 'not_authorized'; end if; return '{}'::jsonb; end; $$;\n`,
    )
    .join("");
  const reads = getPerson + offerings1273 + moneyFns + identity1276 + money1278 + offerings1277 +
    toolLeads1354;

  // GOOD: all guard-first.
  let f = [];
  check(helper + probe + reads, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD: a SELECT before the guard in the probe.
  const probeQueryFirst =
    "create or replace function public.admin_audit_probe(p_reason text) returns uuid " +
    "language plpgsql security definer as $$ declare v int; begin select 1 into v; " +
    "if not public.is_admin_user() then raise exception 'not_authorized'; end if; return null; end; $$;\n";
  f = [];
  check(helper + probeQueryFirst + reads, f);
  if (f.length === 0) self.push("query-before-guard probe not flagged");

  // BAD2: guard missing entirely.
  const probeNoGuard =
    "create or replace function public.admin_audit_probe(p_reason text) returns uuid " +
    "language plpgsql security definer as $$ begin return public.admin_write_audit('x'); end; $$;\n";
  f = [];
  check(helper + probeNoGuard + reads, f);
  if (f.length === 0) self.push("guard-less probe not flagged");

  // BAD3: revert primitive → fns absent.
  f = [];
  check("select 1;", f);
  if (f.length < 2) self.push("missing definer fns not flagged");

  if (self.length) {
    console.error("I-ADMIN-GATE-FIRST-STATEMENT self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-ADMIN-GATE-FIRST-STATEMENT self-test PASS (4/4 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-ADMIN-GATE-FIRST-STATEMENT FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const src = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((n) => fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8"))
  .join("\n");

const failures = [];
check(src, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT PASS — " +
    `${GUARDED_DEFINER_FNS.join(", ")} all guard on is_admin_user() as the first statement.`,
);
