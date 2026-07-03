// ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] — HAPPY-PATH regression.
//
// Source-level proof (node:test + fs, no DOM — mirrors the ORCH-1271/1273/1276 admin
// regression pattern) that the 16 audited offerings/venues write actions are wired
// end-to-end and preserve their hard contracts:
//   1. Each of the 16 write-RPCs is guard-first on is_admin_user(), audits via
//      admin_write_audit(before), is least-privilege (REVOKE anon/PUBLIC + GRANT
//      authenticated + a DO $$ has_function_privilege self-assert).
//   2. Every HIGH RPC RAISEs reason_required; the 2 audit-only reorders skip the reason
//      gate and pass p_require_reason => false to admin_write_audit.
//   3. Schema-correct mutations: trip_days + experience_stops (NO auto updated_at
//      trigger) set updated_at = now() explicitly; the two reorders use the loop-based
//      sentinel (min-1) collision-free renumber for the NON-deferrable UNIQUE; the two
//      hard-delete RPCs DELETE FROM (no soft-delete column).
//   4. offeringsService + venuesService map every service fn → the correct RPC name via
//      callAdminWriteRpc, and take NO direct .from/.update/.insert/.delete/.upsert.
//   5. Both detail pages route mutations through the services, render the shared modals,
//      refetch on success (load()), and take NO direct browser write.
//   6. EntityEditModal (ORCH-1276) is REUSED — NO bespoke AdminEditModal.jsx exists.
//
// FAILS-ON-REVERT: deleting a guard line fails (1); deleting the reorder sentinel line
// fails (3); removing a service RPC call fails (4); introducing a direct browser write
// fails (5). The tester writes a SECOND, adversarial suite on a different angle.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ADMIN_SRC, "../..");

const read = (p) => fs.readFileSync(p, "utf8");
const MIG = {
  offerings: read(path.join(REPO_ROOT, "supabase/migrations/20261209000000_orch_1277_offerings_edit_rpcs.sql")),
  venue: read(path.join(REPO_ROOT, "supabase/migrations/20261209000001_orch_1277_venue_edit_rpcs.sql")),
};
const ALL_MIG = Object.values(MIG).join("\n");
const OFFERINGS_SVC = read(path.join(ADMIN_SRC, "services/offeringsService.js"));
const VENUES_SVC = read(path.join(ADMIN_SRC, "services/venuesService.js"));
const OFFERING_PAGE = read(path.join(ADMIN_SRC, "pages/OfferingDetailView.jsx"));
const VENUE_PAGE = read(path.join(ADMIN_SRC, "pages/VenueDetailView.jsx"));
const EEM = read(path.join(ADMIN_SRC, "components/entity/EntityEditModal.jsx"));

const AUDIT_ONLY_RPCS = ["admin_reorder_trip_day", "admin_reorder_experience_stop"];
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
const HIGH_RPCS = RPCS.filter((n) => !AUDIT_ONLY_RPCS.includes(n));

const stripSql = (src) =>
  src
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const DIRECT_WRITE_RE = /\.(update|insert|delete|upsert)\s*\(/;

function fnSlice(src, name) {
  const start = src.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i"));
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.indexOf("$$;");
  return end < 0 ? rest : rest.slice(0, end + 3);
}

describe("ORCH-1277 — the 16 write-RPCs are guard-first + audited + least-privilege", () => {
  for (const name of RPCS) {
    it(`${name}: guard is the first statement`, () => {
      const slice = fnSlice(ALL_MIG, name);
      assert.ok(slice, `${name} is defined in a migration`);
      assert.match(
        slice,
        /BEGIN\s+IF NOT public\.is_admin_user\(\) THEN RAISE EXCEPTION 'not_authorized'/i,
        `${name} guard must be the first statement after BEGIN`,
      );
    });

    it(`${name}: mutates + audits via admin_write_audit(before)`, () => {
      const slice = fnSlice(ALL_MIG, name);
      assert.match(slice, /UPDATE\s+public\.|DELETE\s+FROM/i, `${name} must perform a mutation`);
      assert.match(slice, /admin_write_audit\s*\(/i, `${name} must call admin_write_audit`);
      assert.match(slice, /'before'/i, `${name} audit metadata must include before`);
    });

    it(`${name}: least-privilege (REVOKE anon/PUBLIC + GRANT authenticated + self-assert)`, () => {
      assert.match(ALL_MIG, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) FROM anon, PUBLIC`, "i"));
      assert.match(ALL_MIG, new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated`, "i"));
      assert.match(ALL_MIG, new RegExp(`has_function_privilege\\('anon',\\s*'public\\.${name}\\(`, "i"));
    });
  }
});

describe("ORCH-1277 — reason gate: HIGH RAISEs reason_required, audit-only reorders skip", () => {
  for (const name of HIGH_RPCS) {
    it(`${name}: carries the reason_required gate`, () => {
      assert.match(fnSlice(ALL_MIG, name), /reason_required/, `${name} must RAISE reason_required`);
    });
  }
  for (const name of AUDIT_ONLY_RPCS) {
    it(`${name}: audit-only — no reason gate + admin_write_audit(..., false)`, () => {
      const slice = fnSlice(ALL_MIG, name);
      assert.ok(!/reason_required/.test(slice), `${name} must NOT gate on a reason`);
      assert.match(slice, /jsonb_build_object\('before'[\s\S]*?\),\s*false\)/i, `${name} must pass p_require_reason => false`);
    });
  }
});

describe("ORCH-1277 — schema-correct mutations", () => {
  it("trip_day + experience_stop edits set updated_at explicitly (no auto trigger)", () => {
    assert.match(fnSlice(MIG.offerings, "admin_update_trip_day"), /updated_at\s*=\s*now\(\)/i);
    assert.match(fnSlice(MIG.offerings, "admin_update_experience_stop"), /updated_at\s*=\s*now\(\)/i);
  });

  it("both reorders use a loop-based, constraint-safe collision-free renumber", () => {
    for (const name of AUDIT_ONLY_RPCS) {
      const slice = fnSlice(MIG.offerings, name);
      assert.match(slice, /FOR\s+r\s+IN\s+SELECT/i, `${name} must shift the block one row at a time`);
      assert.match(slice, /ORDER BY[\s\S]*?LOOP/i, `${name} must order the shift to vacate-before-fill`);
    }
    // trip_days enforces CHECK (ordinal > 0) → the sentinel MUST park ABOVE the range
    // (v_max + 1), never at v_min - 1 (= 0, which raises trip_days_ordinal_check) — ORCH-1277 P1.
    const tripBody = fnSlice(MIG.offerings, "admin_reorder_trip_day");
    assert.match(tripBody, /v_sentinel\s*:=\s*v_max\s*\+\s*1/i, "admin_reorder_trip_day must park the sentinel at v_max + 1");
    assert.ok(!/v_sentinel\s*:=\s*v_min\s*-\s*1/i.test(tripBody), "admin_reorder_trip_day must NOT use the ordinal>0-unsafe v_min - 1 sentinel");
    // experience_stops has NO ordinal>0 floor → v_min - 1 is correct there.
    assert.match(fnSlice(MIG.offerings, "admin_reorder_experience_stop"), /v_sentinel\s*:=\s*v_min\s*-\s*1/i);
  });

  it("the 000003 redeploy migration re-creates admin_reorder_trip_day with the v_max+1 fix", () => {
    const fix = read(path.join(REPO_ROOT, "supabase/migrations/20261209000003_orch_1277_fix_reorder_trip_day.sql"));
    assert.match(fix, /CREATE OR REPLACE FUNCTION public\.admin_reorder_trip_day/i);
    assert.match(fix, /v_sentinel\s*:=\s*v_max\s*\+\s*1/i);
    assert.match(fix, /REVOKE EXECUTE ON FUNCTION public\.admin_reorder_trip_day\([^)]*\) FROM anon, PUBLIC/i);
    assert.match(fix, /has_function_privilege\('anon',\s*'public\.admin_reorder_trip_day\(/i);
  });

  it("hard-delete RPCs DELETE FROM (no soft-delete column)", () => {
    assert.match(fnSlice(MIG.offerings, "admin_delete_experience_stop"), /DELETE FROM public\.experience_stops/i);
    assert.match(fnSlice(MIG.offerings, "admin_remove_rsvp_guest"), /DELETE FROM public\.event_rsvps/i);
  });

  it("venue reservation settings keys on venue_id (PK), validates no_show policy", () => {
    const slice = fnSlice(MIG.venue, "admin_update_venue_reservation_settings");
    assert.match(slice, /WHERE\s+venue_id\s*=\s*p_venue_id/i);
    assert.match(slice, /invalid_no_show_policy/);
  });

  it("cancel is refund-free (money = ORCH-1274) — no refund/stripe token in the body", () => {
    const slice = stripSql(fnSlice(MIG.offerings, "admin_cancel_offering"));
    assert.ok(!/refund|stripe|payout/i.test(slice), "admin_cancel_offering must not touch money");
    assert.match(slice, /status\s*=\s*'cancelled'/);
  });
});

describe("ORCH-1277 — services route every write through the audited RPC", () => {
  it("offeringsService maps its 13 write fns to RPC names via callAdminWriteRpc", () => {
    for (const name of RPCS.slice(0, 13)) {
      assert.ok(OFFERINGS_SVC.includes(`"${name}"`), `offeringsService must call callAdminWriteRpc("${name}")`);
    }
    assert.match(OFFERINGS_SVC, /from "\.\/adminWriteService"/);
  });

  it("venuesService maps its 3 write fns to RPC names via callAdminWriteRpc", () => {
    for (const name of RPCS.slice(13)) {
      assert.ok(VENUES_SVC.includes(`"${name}"`), `venuesService must call callAdminWriteRpc("${name}")`);
    }
    assert.match(VENUES_SVC, /from "\.\/adminWriteService"/);
  });

  it("both services take NO direct .update/.insert/.delete/.upsert", () => {
    // Read-side .from(...).select is fine; only write chains are banned.
    assert.ok(!DIRECT_WRITE_RE.test(stripJs(OFFERINGS_SVC)), "offeringsService must not write directly");
    assert.ok(!DIRECT_WRITE_RE.test(stripJs(VENUES_SVC)), "venuesService must not write directly");
  });

  it("error mappers translate the audited RPC error codes", () => {
    for (const code of ["not_authorized", "reason_required", "not_found", "invalid_price", "ai_description_empty"]) {
      assert.ok(OFFERINGS_SVC.includes(code), `mapOfferingWriteError must handle ${code}`);
    }
    for (const code of ["invalid_no_show_policy", "invalid_zone", "invalid_status"]) {
      assert.ok(VENUES_SVC.includes(code), `mapVenueWriteError must handle ${code}`);
    }
  });
});

describe("ORCH-1277 — console pages route through the services, no direct writes", () => {
  const pages = { offering: OFFERING_PAGE, venue: VENUE_PAGE };
  for (const [label, src] of Object.entries(pages)) {
    it(`${label}: no direct .update/.insert/.delete/.upsert`, () => {
      assert.ok(!DIRECT_WRITE_RE.test(stripJs(src)), `${label} must route mutations through the write service`);
    });
    it(`${label}: no direct admin_write_audit reference (server-side only)`, () => {
      assert.ok(!stripJs(src).includes("admin_write_audit"), `${label} must not reference admin_write_audit`);
    });
    it(`${label}: never reads the decommissioned brand kind column (META-ORCH-0972)`, () => {
      // venue_capacity_rules.kind is a DIFFERENT, legitimate column; the banned shape is
      // a brand kind read via .from("brands")...kind — assert no such select shape.
      assert.ok(!/\.from\(\s*['"`]brands['"`][\s\S]{0,80}\bkind\b/.test(stripJs(src)), `${label} must not read the brand kind column`);
    });
  }

  it("OfferingDetailView imports the write service + both modals and refetches on success", () => {
    assert.match(OFFERING_PAGE, /from "\.\.\/services\/offeringsService"/);
    assert.match(OFFERING_PAGE, /EntityEditModal/);
    assert.match(OFFERING_PAGE, /HighRiskActionModal/);
    assert.match(OFFERING_PAGE, /await load\(\)/);
    // offering-level footer actions + per-row + capacity all present.
    assert.match(OFFERING_PAGE, /cancelOffering/);
    assert.match(OFFERING_PAGE, /setOfferingDeleted/);
    assert.match(OFFERING_PAGE, /setRsvpCapacity/);
    // CANCEL/DELETE are footer-action object props (confirmPhrase: "…"); REMOVE is a
    // JSX attribute (confirmPhrase="…") on the HighRiskActionModal — match both forms.
    assert.match(OFFERING_PAGE, /confirmPhrase[:=]\s*"CANCEL"/);
    assert.match(OFFERING_PAGE, /confirmPhrase[:=]\s*"DELETE"/);
    assert.match(OFFERING_PAGE, /confirmPhrase[:=]\s*"REMOVE"/);
  });

  it("VenueDetailView imports the write service + EntityEditModal and refetches on success", () => {
    assert.match(VENUE_PAGE, /from "\.\.\/services\/venuesService"/);
    assert.match(VENUE_PAGE, /EntityEditModal/);
    assert.match(VENUE_PAGE, /await load\(\)/);
    assert.match(VENUE_PAGE, /updateVenueReservationSettings/);
    assert.match(VENUE_PAGE, /setReservationStatus/);
    // reservation-override modal warns the guest is notified.
    assert.match(VENUE_PAGE, /guest is notified/i);
  });
});

describe("ORCH-1277 — EntityEditModal (ORCH-1276) is REUSED, not re-created", () => {
  it("no bespoke AdminEditModal.jsx exists (dispatch: reuse EntityEditModal)", () => {
    const admin = path.join(ADMIN_SRC, "components/entity/AdminEditModal.jsx");
    assert.ok(!fs.existsSync(admin), "must NOT create a new AdminEditModal — reuse the shared EntityEditModal");
  });

  it("EntityEditModal is the shared generic modal (carries the value + reason + confirm gate)", () => {
    assert.match(EEM, /const canSubmit = requiredOk && jsonOk && reasonOk && phraseOk && !submitting/);
    assert.match(EEM, /phrase === confirmPhrase/);
    // both pages import it from the shared entity component.
    assert.match(OFFERING_PAGE, /from "\.\.\/components\/entity\/EntityEditModal"/);
    assert.match(VENUE_PAGE, /from "\.\.\/components\/entity\/EntityEditModal"/);
  });
});
