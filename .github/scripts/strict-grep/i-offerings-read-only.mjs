#!/usr/bin/env node
/**
 * ORCH-1273 [Admin Offerings console — READ-ONLY] — I-PROPOSED-1273-OFFERINGS-READ-ONLY
 * + I-PROPOSED-1273-OFFERINGS-ADMIN-READ-CROSSBRAND.
 *
 * RULE (visibility-first): the offerings/venues admin surface is READ-ONLY.
 *   (a) the 14 offerings/venue-config tables each carry an is_admin_user() SELECT
 *       RLS policy in a migration (so the console surfaces DRAFT/PRIVATE/cross-
 *       brand rows) — reverting a policy drops the read → FAIL;
 *   (b) the 5 read RPCs are defined, STABLE, and mutation-free (no INSERT/UPDATE/
 *       DELETE in their bodies) — a write snuck into an "admin read" RPC → FAIL;
 *   (c) the offerings/venues SERVICE + PAGE files contain ZERO write path: no
 *       .update( / .insert( / .delete( / .upsert( / admin_write_audit, and every
 *       supabase.rpc("...") names a READ RPC only — a wave-2 write wired early → FAIL.
 *
 * Reverting the RLS/RPC migration removes the (a)/(b) tokens → this gate FAILS.
 * Adding any write call to a 1273 service/page → (c) FAILS.
 * `--self-test` proves FAIL-on-revert with GOOD/BAD fixtures.
 *
 * DRAFT until CLOSE (orchestrator flips the two invariants ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

// (a) 14 offerings/venue-config tables that get a new is_admin_user() SELECT policy.
const READ_TABLES = [
  "events",
  "event_dates",
  "ticket_types",
  "trip_days",
  "trip_pricing_tiers",
  "trip_inclusions",
  "trip_intake_schemas",
  "experience_stops",
  "experience_feedback",
  "venue_reservation_settings",
  "venue_capacity_rules",
  "venue_tables",
  "venue_blackouts",
  "venue_waitlist",
];

// (b) the read RPCs that MUST be defined, STABLE, and mutation-free.
const READ_RPCS = [
  "admin_list_offerings",
  "admin_get_offering",
  "admin_list_event_orders",
  "admin_list_event_rsvps",
  "admin_list_venue_reservations",
];

// (c) the READ-ONLY service + page files (paths relative to repo root).
const READ_ONLY_FILES = [
  "mingla-admin/src/services/offeringsService.js",
  "mingla-admin/src/services/venuesService.js",
  "mingla-admin/src/pages/OfferingsConsolePage.jsx",
  "mingla-admin/src/pages/OfferingDetailView.jsx",
  "mingla-admin/src/pages/VenuesConsolePage.jsx",
  "mingla-admin/src/pages/VenueDetailView.jsx",
];

// ORCH-1277 [WAVE-2 EDIT]: the 16 audited offerings/venues WRITE RPCs. The service/
// page layer of I-PROPOSED-1273-OFFERINGS-READ-ONLY (part c) is SUPERSEDED by
// I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC — the console MAY now call these
// audited write RPCs. The read-table (a) + read-RPC (b) halves stay read-only forever;
// and the raw `.update/.insert/.delete/.upsert` ban + the "no direct admin_write_audit"
// ban in part (c) REMAIN (admin writes must never be raw table writes).
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

// These RPC names may be called from the offerings/venues files: the read RPCs +
// offering-stats + (ORCH-1277) the 16 audited write RPCs.
const ALLOWED_RPCS = new Set([...READ_RPCS, "admin_offering_stats", ...WRITE_RPCS]);

const WRITE_METHOD_RE = /\.(update|insert|delete|upsert)\s*\(/;
const RPC_NAME_RE = /\.rpc\(\s*["']([a-zA-Z0-9_]+)["']/g;

function policyRe(table) {
  return new RegExp(
    `create\\s+policy\\s+"${table} admin can read"\\s+on\\s+public\\.${table}\\s+for\\s+select\\s+using\\s*\\(\\s*public\\.is_admin_user\\(\\)\\s*\\)`,
    "i",
  );
}

// Extract a plpgsql fn header (before the first $$) + body (between the first pair
// of $$). Handles the CREATE OR REPLACE FUNCTION public.<name>(...) ... $$ ... $$ shape.
function fnParts(src, name) {
  const defRe = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\b`, "i");
  const m = defRe.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const open = rest.indexOf("$$");
  if (open < 0) return null;
  const close = rest.indexOf("$$", open + 2);
  if (close < 0) return null;
  return { header: rest.slice(0, open), body: rest.slice(open + 2, close) };
}

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

// migSrc: concatenated migrations. fileMap: { relPath: source } for the read-only files.
function check(migSrc, fileMap, failures) {
  // (a) 14 SELECT admin-read policies present.
  for (const t of READ_TABLES) {
    if (!policyRe(t).test(migSrc)) {
      failures.push(`missing is_admin_user() SELECT policy "${t} admin can read" on public.${t}.`);
    }
  }
  // (b) each read RPC defined, STABLE, mutation-free.
  for (const name of READ_RPCS) {
    const parts = fnParts(migSrc, name);
    if (!parts) {
      failures.push(`read RPC ${name} is missing from migrations.`);
      continue;
    }
    if (!/\bSTABLE\b/i.test(parts.header)) {
      failures.push(`read RPC ${name} is not declared STABLE.`);
    }
    if (/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i.test(parts.body)) {
      failures.push(`read RPC ${name} body performs a mutation (INSERT/UPDATE/DELETE) — must be read-only.`);
    }
    if (/admin_write_audit/i.test(parts.body)) {
      failures.push(`read RPC ${name} calls admin_write_audit — reads are not audited.`);
    }
  }
  // (c) service + page files carry no write path.
  for (const [rel, raw] of Object.entries(fileMap)) {
    if (raw == null) {
      failures.push(`read-only file missing: ${rel}.`);
      continue;
    }
    const src = stripJsComments(raw);
    if (WRITE_METHOD_RE.test(src)) {
      failures.push(`${rel} contains a write call (.update/.insert/.delete/.upsert) — 1273 is read-only.`);
    }
    if (/admin_write_audit/.test(src)) {
      failures.push(`${rel} references admin_write_audit — 1273 writes nothing.`);
    }
    let match;
    RPC_NAME_RE.lastIndex = 0;
    while ((match = RPC_NAME_RE.exec(src)) !== null) {
      if (!ALLOWED_RPCS.has(match[1])) {
        failures.push(`${rel} calls a non-read RPC rpc("${match[1]}") — only offerings read RPCs are allowed.`);
      }
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const goodMig =
    READ_TABLES.map(
      (t) => `CREATE POLICY "${t} admin can read" ON public.${t} FOR SELECT USING (public.is_admin_user());`,
    ).join("\n") +
    "\n" +
    READ_RPCS.map(
      (n) =>
        `CREATE OR REPLACE FUNCTION public.${n}() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$ BEGIN IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF; RETURN '{}'::jsonb; END; $$;`,
    ).join("\n");
  const goodFiles = {
    "svc.js": 'supabase.rpc("admin_list_offerings", {}); supabase.from("events").select("*");\n',
    "page.jsx": "export function P() { return null; }\n",
  };

  // GOOD: all policies + STABLE mutation-free RPCs + clean files.
  let f = [];
  check(goodMig, goodFiles, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD1: a policy removed (revert) → MUST fire.
  const missingPolicy = goodMig.replace(
    'CREATE POLICY "venue_waitlist admin can read" ON public.venue_waitlist FOR SELECT USING (public.is_admin_user());',
    "",
  );
  f = [];
  check(missingPolicy, goodFiles, f);
  if (f.length === 0) self.push("reverted RLS policy not flagged");

  // BAD2: an RPC gains a mutation → MUST fire.
  const mutatingRpc = goodMig.replace(
    "RETURN '{}'::jsonb; END; $$;",
    "UPDATE public.events SET status = 'x'; RETURN '{}'::jsonb; END; $$;",
  );
  f = [];
  check(mutatingRpc, goodFiles, f);
  if (f.length === 0) self.push("mutating read-RPC not flagged");

  // BAD3: a read-RPC loses STABLE → MUST fire.
  const notStable = goodMig.replace(/STABLE SECURITY DEFINER/, "SECURITY DEFINER");
  f = [];
  check(notStable, goodFiles, f);
  if (f.length === 0) self.push("non-STABLE read-RPC not flagged");

  // BAD4: a service adds a write call → MUST fire.
  f = [];
  check(goodMig, { ...goodFiles, "svc.js": goodFiles["svc.js"] + 'supabase.from("events").update({});\n' }, f);
  if (f.length === 0) self.push("write call in read-only file not flagged");

  // GOOD2 (ORCH-1277): a service calling a WHITELISTED audited write RPC is now allowed
  // (part (c) service/page layer superseded by I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC).
  f = [];
  check(goodMig, { ...goodFiles, "svc.js": goodFiles["svc.js"] + 'supabase.rpc("admin_cancel_offering", {});\n' }, f);
  if (f.length) self.push("whitelisted write RPC call wrongly flagged: " + f.join("; "));

  // BAD5: a service calls an UN-whitelisted RPC → MUST fire (only read + the 16 write RPCs allowed).
  f = [];
  check(goodMig, { ...goodFiles, "svc.js": goodFiles["svc.js"] + 'supabase.rpc("admin_frobnicate", {});\n' }, f);
  if (f.length === 0) self.push("un-whitelisted RPC call in offerings file not flagged");

  if (self.length) {
    console.error("I-OFFERINGS-READ-ONLY self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-OFFERINGS-READ-ONLY self-test PASS (7/7 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-OFFERINGS-READ-ONLY FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const migSrc = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((n) => fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8"))
  .join("\n");

const fileMap = {};
for (const rel of READ_ONLY_FILES) {
  const full = path.join(process.cwd(), rel);
  fileMap[rel] = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

const failures = [];
check(migSrc, fileMap, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1273-OFFERINGS-READ-ONLY FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1273-OFFERINGS-READ-ONLY PASS — 14 offerings/venue tables carry is_admin_user() " +
    "SELECT policies, the 5 read RPCs are STABLE + mutation-free, and the offerings/venues " +
    "service + page files hold no write path.",
);
