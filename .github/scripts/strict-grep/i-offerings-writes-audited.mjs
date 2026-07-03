#!/usr/bin/env node
/**
 * ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] —
 * I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC + I-PROPOSED-1277-HIGH-RISK-REASON-REQUIRED.
 *
 * RULE: every ORCH-1277 offerings/venues write RPC (the 16 below) is a SECURITY
 * DEFINER function that (a) guards on is_admin_user() as its FIRST executable
 * statement, (b) performs a mutation (UPDATE public. / DELETE FROM) AND audits via
 * admin_write_audit( with a 'before' metadata object, and (c) ships the
 * least-privilege `REVOKE EXECUTE ... FROM ... anon` line. Each HIGH RPC additionally
 * (d) RAISEs `reason_required` on an empty reason (server gate, modal-independent);
 * the 2 audit-only reorders are exempt from (d). AND the console performs offering/
 * venue mutations ONLY via these RPCs — the two write services + both detail pages
 * carry NO direct browser .update(/.insert(/.delete(/.upsert( and reference
 * admin_write_audit NOWHERE (audit is server-side only).
 *
 * Enforcement (over supabase/migrations/** + the offerings/venues write surface):
 *   (1) each of the 16 CREATE OR REPLACE FUNCTION public.admin_<...>( bodies present;
 *       first statement is an is_admin_user() guard; mutates + references
 *       admin_write_audit( with 'before'.
 *   (2) each RPC carries a matching `REVOKE EXECUTE ON FUNCTION public.<fn>(...) FROM
 *       ... anon` line in a migration.
 *   (3) each HIGH RPC body contains a `reason_required` gate (audit-only reorders skip).
 *   (4) offeringsService.js + venuesService.js + OfferingDetailView.jsx +
 *       VenueDetailView.jsx contain zero `.update(`/`.insert(`/`.delete(`/`.upsert(`
 *       and reference NO `admin_write_audit`.
 *
 * Deleting a guard / admin_write_audit call / REVOKE-anon line / a HIGH reason gate,
 * or adding a direct browser write, FAILS this gate (fails-on-revert). `--self-test`
 * proves it with GOOD/BAD fixtures.
 *
 * DRAFT until CLOSE (orchestrator flips the two I-PROPOSED-1277-* invariants ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const FRONTEND_FILES = [
  "mingla-admin/src/services/offeringsService.js",
  "mingla-admin/src/services/venuesService.js",
  "mingla-admin/src/pages/OfferingDetailView.jsx",
  "mingla-admin/src/pages/VenueDetailView.jsx",
];

// The 2 AUDIT-ONLY reorder RPCs (no reason gate — admin_write_audit(..., false)).
const AUDIT_ONLY_RPCS = ["admin_reorder_trip_day", "admin_reorder_experience_stop"];

// The 16 ORCH-1277 audited offerings/venues write RPCs (#1–16).
const WRITE_RPCS = [
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
];

const DIRECT_WRITE_RE = /\.(update|insert|delete|upsert)\s*\(/;
const MUTATION_RE = /UPDATE\s+public\.|DELETE\s+FROM/i;

// Slice a plpgsql function body (first `$$` pair after its def).
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
  after = after
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  const semi = after.indexOf(";");
  return (semi < 0 ? after : after.slice(0, semi)).trim();
}

const GUARD_RE = /^IF\b[\s\S]*?\bNOT\b[\s\S]*?is_admin_user\s*\(\s*\)[\s\S]*?\bTHEN\b[\s\S]*?\bRAISE\b/i;

function revokeAnonRe(name) {
  return new RegExp(
    `revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\banon\\b`,
    "i",
  );
}

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "")) // line comments
    .join("\n");
}

function check(migSrc, frontend, failures) {
  for (const name of WRITE_RPCS) {
    const body = fnBody(migSrc, name);
    if (!body) {
      failures.push(`offerings write RPC ${name} is missing from migrations.`);
      continue;
    }
    const first = firstStatement(body);
    if (!first || !GUARD_RE.test(first)) {
      failures.push(`offerings write RPC ${name}: first executable statement is NOT an is_admin_user() guard.`);
    }
    if (!MUTATION_RE.test(body)) {
      failures.push(`offerings write RPC ${name}: performs no mutation (UPDATE public. / DELETE FROM).`);
    }
    if (!/admin_write_audit\s*\(/i.test(body) || !/'before'/i.test(body)) {
      failures.push(`offerings write RPC ${name}: does not call admin_write_audit( with a before metadata object.`);
    }
    if (!revokeAnonRe(name).test(migSrc)) {
      failures.push(`offerings write RPC ${name}: missing least-privilege REVOKE EXECUTE ... FROM anon.`);
    }
    // (d) HIGH RPCs must carry a server-side reason gate; audit-only reorders skip it.
    if (!AUDIT_ONLY_RPCS.includes(name) && !/reason_required/i.test(body)) {
      failures.push(`HIGH offerings write RPC ${name}: missing the reason_required gate.`);
    }
  }
  // No direct browser writes / no client-side audit reference.
  for (const [label, src] of Object.entries(frontend)) {
    if (src == null) continue;
    const stripped = stripJsComments(src);
    if (DIRECT_WRITE_RE.test(stripped)) {
      failures.push(
        `${label} contains a direct .update(/.insert(/.delete(/.upsert( — offerings mutations must route ` +
          `through callAdminWriteRpc (offeringsService/venuesService).`,
      );
    }
    if (/admin_write_audit/.test(stripped)) {
      failures.push(`${label} references admin_write_audit — audit is server-side only.`);
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const goodFn = (name) => {
    const auditOnly = AUDIT_ONLY_RPCS.includes(name);
    return (
      `CREATE OR REPLACE FUNCTION public.${name}(p_id uuid, p_reason text)\n` +
      "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v_before jsonb; v_after jsonb; BEGIN\n" +
      "  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
      (auditOnly ? "" : "  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;\n") +
      "  SELECT to_jsonb(t) INTO v_before FROM public.t t WHERE t.id = p_id;\n" +
      "  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;\n" +
      "  UPDATE public.t SET x = 1 WHERE id = p_id RETURNING to_jsonb(t) INTO v_after;\n" +
      `  PERFORM public.admin_write_audit('t.x','t',p_id::text,p_reason,jsonb_build_object('before',v_before,'after',v_after)${auditOnly ? ", false" : ""});\n` +
      "  RETURN v_after; END; $$;\n" +
      `REVOKE EXECUTE ON FUNCTION public.${name}(uuid,text) FROM anon, PUBLIC;\n` +
      `GRANT EXECUTE ON FUNCTION public.${name}(uuid,text) TO authenticated;\n`
    );
  };
  const goodMig = WRITE_RPCS.map(goodFn).join("\n");
  const cleanFront = {
    svc: "export function setTicketPrice(id, cents, reason){ return callAdminWriteRpc('admin_set_ticket_price', {p_ticket_type_id:id}); }\n",
  };

  // GOOD.
  let f = [];
  check(goodMig, cleanFront, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD1: guard removed from one RPC.
  f = [];
  check(goodMig.replace("IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;", ""), cleanFront, f);
  if (f.length === 0) self.push("removed guard not flagged");

  // BAD2: admin_write_audit call removed from one RPC.
  f = [];
  check(
    goodMig.replace(
      "PERFORM public.admin_write_audit('t.x','t',p_id::text,p_reason,jsonb_build_object('before',v_before,'after',v_after));",
      "",
    ),
    cleanFront,
    f,
  );
  if (f.length === 0) self.push("removed audit call not flagged");

  // BAD3: REVOKE ... FROM anon removed from one RPC.
  f = [];
  check(goodMig.replace(/REVOKE EXECUTE ON FUNCTION public\.admin_cancel_offering\(uuid,text\) FROM anon, PUBLIC;/, ""), cleanFront, f);
  if (f.length === 0) self.push("removed REVOKE-anon not flagged");

  // BAD4: the reason_required gate removed from a HIGH RPC (admin_cancel_offering).
  f = [];
  const highGate = "  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;\n";
  // Remove ONLY the first occurrence (admin_set_offering_visibility, a HIGH RPC).
  const idx = goodMig.indexOf(highGate);
  f = [];
  check(goodMig.slice(0, idx) + goodMig.slice(idx + highGate.length), cleanFront, f);
  if (f.length === 0) self.push("removed HIGH reason_required gate not flagged");

  // BAD5: revert migration → all RPCs absent.
  f = [];
  check("select 1;", cleanFront, f);
  if (f.length < WRITE_RPCS.length) self.push("missing RPCs not flagged");

  // BAD6: a direct browser write in a console file.
  f = [];
  check(goodMig, { page: 'supabase.from("events").update({ visibility });\n' }, f);
  if (f.length === 0) self.push("direct browser .update( not flagged");

  // BAD7: a client-side admin_write_audit reference.
  f = [];
  check(goodMig, { svc: 'supabase.rpc("admin_write_audit", {});\n' }, f);
  if (f.length === 0) self.push("client admin_write_audit reference not flagged");

  if (self.length) {
    console.error("I-OFFERINGS-WRITES-AUDITED self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-OFFERINGS-WRITES-AUDITED self-test PASS (8/8 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-OFFERINGS-WRITES-AUDITED FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const migSrc = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((n) => fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8"))
  .join("\n");
const frontend = {};
for (const rel of FRONTEND_FILES) {
  const abs = path.join(process.cwd(), rel);
  frontend[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

const failures = [];
check(migSrc, frontend, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC PASS — all 16 offerings/venues write RPCs guard-first + " +
    "mutate + audit(before) + REVOKE anon (HIGH RPCs carry the reason_required gate); the two write services + " +
    "both detail pages take no direct browser write and reference no admin_write_audit.",
);
