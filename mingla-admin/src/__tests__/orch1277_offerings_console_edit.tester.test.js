// ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] — TESTER ADVERSARIAL suite.
//
// Different angle than the implementor's happy-path (orch1277_offerings_console_edit.test.js).
// The implementor asserts each contract PATTERN is *present*; this suite attacks the
// INVARIANTS an attacker or a careless refactor would break, and PINS the P1 the tester
// proved by live-fire against prod (gqnoajqerqhnvulmnyvv, all writes rolled back):
//
//   A. LEAST-PRIVILEGE cannot be silently re-opened — no `GRANT ... TO anon | PUBLIC`
//      anywhere for any of the 16 write-RPCs (the happy-path only checks the REVOKE +
//      GRANT-authenticated EXIST; it never checks anon is NOT re-granted later).
//   B. GUARD is the LITERAL first executable statement after BEGIN (nothing — not a
//      SELECT, not a validation — may run before is_admin_user()); stricter than the
//      loose `BEGIN\s+IF NOT ...` regex.
//   C. AUDIT binds the target to the entity param (target_id derived from a p_* arg,
//      metadata carries 'before') for every RPC — not a null/constant target.
//   D. REORDER SENTINEL must be CONSTRAINT-SAFE. trip_days enforces
//      CHECK (ordinal > 0); a sentinel of `v_min - 1` = 0 (1-based days, the enforced
//      normal case) VIOLATES it, so admin_reorder_trip_day fails every real move with a
//      raw `trip_days_ordinal_check` error. Proven live 2026-07-03 (TEST report §D). This
//      assertion is RED at HEAD 038f75441 (pins the P1) and goes GREEN once the sentinel
//      parks OUTSIDE the ordinal>0 floor (e.g. v_max + 1). experience_stops has no such
//      floor, so its `v_min - 1` sentinel is left alone.
//
// FAILS-ON-REVERT (green core A/B/C): adding a `GRANT ... TO anon` fails A; moving any
// statement before the guard fails B; nulling an audit target fails C.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8");

const MIG_OFFERINGS = read("supabase/migrations/20261209000000_orch_1277_offerings_edit_rpcs.sql");
const MIG_VENUE = read("supabase/migrations/20261209000001_orch_1277_venue_edit_rpcs.sql");
const ALL_MIG = `${MIG_OFFERINGS}\n${MIG_VENUE}`;

const AUDIT_ONLY = ["admin_reorder_trip_day", "admin_reorder_experience_stop"];
const RPCS = [
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

// Slice a function's CREATE ... $$; body (comments stripped so `-- GRANT` etc. can't lie).
function fnBody(name) {
  const start = ALL_MIG.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i"));
  assert.ok(start >= 0, `${name} must be defined in a 1277 migration`);
  const rest = ALL_MIG.slice(start);
  const end = rest.indexOf("$$;");
  return rest.slice(0, end < 0 ? undefined : end + 3);
}
const stripComments = (sql) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

describe("ORCH-1277 tester(A) — least-privilege can never be re-opened to anon/PUBLIC", () => {
  for (const name of RPCS) {
    it(`${name}: no GRANT EXECUTE ... TO anon | PUBLIC anywhere`, () => {
      const sql = stripComments(ALL_MIG);
      const grantAnon = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)\\s+TO\\s+[^;]*\\b(anon|PUBLIC)\\b`, "i");
      assert.ok(!grantAnon.test(sql), `${name} must NOT grant EXECUTE to anon/PUBLIC`);
      // and the REVOKE from anon,PUBLIC must be present (defence-in-depth, not just default-deny).
      assert.match(sql, new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)\\s+FROM\\s+anon,\\s*PUBLIC`, "i"));
    });
  }
});

describe("ORCH-1277 tester(B) — is_admin_user() guard is the LITERAL first executable statement", () => {
  for (const name of RPCS) {
    it(`${name}: nothing executes before the guard`, () => {
      const body = stripComments(fnBody(name));
      // Everything from the first BEGIN (after the DECLARE section) onward.
      const beginIdx = body.search(/\bBEGIN\b/);
      assert.ok(beginIdx >= 0, `${name} must have a BEGIN`);
      const afterBegin = body.slice(beginIdx + "BEGIN".length);
      // The first non-empty token after BEGIN must be the guard IF.
      const firstStmt = afterBegin.replace(/^\s+/, "");
      assert.match(
        firstStmt,
        /^IF\s+NOT\s+public\.is_admin_user\(\)\s+THEN\s+RAISE\s+EXCEPTION\s+'not_authorized'/i,
        `${name}: the guard must be the first statement after BEGIN (found: ${firstStmt.slice(0, 60)}…)`,
      );
    });
  }
});

describe("ORCH-1277 tester(C) — audit binds the target to the entity param + carries before", () => {
  for (const name of RPCS) {
    it(`${name}: admin_write_audit target_id derives from a p_* param + 'before' captured`, () => {
      const body = fnBody(name);
      // admin_write_audit(<action>, <entity_type>, <target_id>, <reason>, jsonb_build_object('before', ...))
      const call = body.match(/admin_write_audit\s*\(([\s\S]*?)\)\s*;/i);
      assert.ok(call, `${name} must call admin_write_audit`);
      const args = call[1];
      assert.match(args, /p_[a-z_]+::text/i, `${name} audit target_id must be a p_* entity id cast to text (not null/constant)`);
      assert.match(args, /'before'/, `${name} audit metadata must capture 'before'`);
    });
  }
});

describe("ORCH-1277 tester(D) — reorder sentinel must be CONSTRAINT-SAFE (pins P1)", () => {
  it("admin_reorder_trip_day must NOT park the sentinel below the ordinal>0 floor (v_min-1)", () => {
    // trip_days CHECK (ordinal > 0): a v_min-1 sentinel = 0 for 1-based days violates it,
    // so every real trip-day reorder raises trip_days_ordinal_check. Proven live 2026-07-03.
    const body = stripComments(fnBody("admin_reorder_trip_day"));
    assert.ok(
      !/v_sentinel\s*:=\s*v_min\s*-\s*1/i.test(body),
      "admin_reorder_trip_day sentinel `v_min - 1` = 0 violates trip_days_ordinal_check (ordinal > 0); " +
        "park the sentinel ABOVE the live range (e.g. v_max + 1) or make the UNIQUE deferrable — see TEST_ORCH-1277 §D (P1).",
    );
  });

  it("admin_reorder_experience_stop sentinel is safe (experience_stops has no ordinal>0 floor)", () => {
    // This RPC is CORRECT — proven live (forward + reverse both a clean permutation, no
    // unique violation). Locked in so a future 'consistency' refactor doesn't break it.
    const body = stripComments(fnBody("admin_reorder_experience_stop"));
    assert.match(body, /v_sentinel\s*:=\s*v_min\s*-\s*1/i);
    assert.match(body, /UNIQUE|stop_order/i);
  });
});
