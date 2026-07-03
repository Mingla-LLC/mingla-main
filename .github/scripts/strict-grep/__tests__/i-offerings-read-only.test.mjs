// ORCH-1273 [Admin Offerings console — READ-ONLY] — i-offerings-read-only
// strict-grep fixture. Proves the gate PASSES with all 14 is_admin_user() SELECT
// policies + the 5 STABLE mutation-free read RPCs + clean read-only files present,
// and FAILS-on-revert when a policy or RPC is removed / a write is added.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../i-offerings-read-only.mjs", import.meta.url));

const READ_TABLES = [
  "events", "event_dates", "ticket_types", "trip_days", "trip_pricing_tiers",
  "trip_inclusions", "trip_intake_schemas", "experience_stops", "experience_feedback",
  "venue_reservation_settings", "venue_capacity_rules", "venue_tables",
  "venue_blackouts", "venue_waitlist",
];
const READ_RPCS = [
  "admin_list_offerings", "admin_get_offering", "admin_list_event_orders",
  "admin_list_event_rsvps", "admin_list_venue_reservations",
];
const READ_ONLY_FILES = [
  "mingla-admin/src/services/offeringsService.js",
  "mingla-admin/src/services/venuesService.js",
  "mingla-admin/src/pages/OfferingsConsolePage.jsx",
  "mingla-admin/src/pages/OfferingDetailView.jsx",
  "mingla-admin/src/pages/VenuesConsolePage.jsx",
  "mingla-admin/src/pages/VenueDetailView.jsx",
];

function policiesSql(tables) {
  return tables
    .map((t) => `CREATE POLICY "${t} admin can read" ON public.${t} FOR SELECT USING (public.is_admin_user());`)
    .join("\n");
}
function rpcsSql(names) {
  return names
    .map(
      (n) =>
        `CREATE OR REPLACE FUNCTION public.${n}() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$ BEGIN IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF; RETURN '{}'::jsonb; END; $$;`,
    )
    .join("\n");
}
function goodSql(tables = READ_TABLES, rpcs = READ_RPCS) {
  return `${policiesSql(tables)}\n${rpcsSql(rpcs)}\n`;
}

function withTree(sql, files, callback) {
  const root = mkdtempSync(join(tmpdir(), "i-1273-"));
  try {
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(root, "supabase", "migrations", "20261206000000_fixture.sql"), sql);
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const cleanFiles = () => {
  const map = {};
  for (const rel of READ_ONLY_FILES) {
    map[rel] = rel.includes("service")
      ? 'import { supabase } from "../lib/supabase";\nexport const x = () => supabase.rpc("admin_list_offerings", {});\n'
      : "export function P() { return null; }\n";
  }
  return map;
};

function runGate(cwd) {
  return spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd });
}

test("self-test: GOOD + 6 BAD fixtures all classified correctly", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
});

test("PASS: all 14 policies + 5 STABLE read RPCs + clean files", () => {
  withTree(goodSql(), cleanFiles(), (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS/);
  });
});

test("FAIL-on-revert: a removed RLS policy is caught", () => {
  withTree(goodSql(READ_TABLES.slice(0, 13)), cleanFiles(), (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /venue_waitlist/);
  });
});

test("FAIL-on-revert: a removed read RPC is caught", () => {
  withTree(goodSql(READ_TABLES, READ_RPCS.slice(0, 4)), cleanFiles(), (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /admin_list_venue_reservations/);
  });
});

test("FAIL: a write call in a read-only service is caught", () => {
  const files = cleanFiles();
  files["mingla-admin/src/services/offeringsService.js"] += 'supabase.from("events").update({ status: "x" });\n';
  withTree(goodSql(), files, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /read-only/i);
  });
});
