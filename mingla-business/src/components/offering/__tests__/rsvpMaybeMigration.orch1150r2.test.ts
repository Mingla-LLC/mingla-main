/**
 * ORCH-1150 R2 D-10 — RSVP 'maybe' migration source-contract regression.
 *
 * Owner: mingla-implementor (the tester adds the live DB SQL-probe angle once the
 * orchestrator applies the migration — see supabase/migrations/__tests__).
 *
 * Enforces the migration-source half of I-PROPOSED-1150-MAYBE-NOT-IN-CAP +
 * the CHECK/RLS/RPC widen, as TEXT assertions runnable without a live DB:
 *   - the new migration widens the CHECK + RLS + submit_event_rsvp to allow 'maybe';
 *   - 'maybe' is AUTO-APPROVED + CAP-NEUTRAL (mirrors not_going, never a seat);
 *   - the base capacity headcount predicate STILL reads `going AND approved` only
 *     (the maybe migration must not have added 'maybe' to a cap predicate).
 * Each assertion FAILS on deletion of the corresponding migration line.
 */

import { readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
const MAYBE_SQL = readFileSync(
  join(MIGRATIONS, "20261012000000_orch_1150_rsvp_maybe.sql"),
  "utf8",
);

describe("ORCH-1150 R2 D-10 — maybe migration widens CHECK / RLS / RPC", () => {
  it("widens the rsvp_status CHECK to include 'maybe' (DROP-before-ADD)", () => {
    expect(MAYBE_SQL).toMatch(/DROP CONSTRAINT IF EXISTS event_rsvps_rsvp_status_check/);
    expect(MAYBE_SQL).toMatch(
      /CHECK \(rsvp_status IN \('going',\s*'not_going',\s*'waitlisted',\s*'maybe'\)\)/,
    );
  });

  it("widens the guest-update RLS WITH CHECK to allow setting 'maybe'", () => {
    expect(MAYBE_SQL).toMatch(/event_rsvps_guest_update_own/);
    expect(MAYBE_SQL).toMatch(/rsvp_status IN \('going',\s*'not_going',\s*'maybe'\)/);
  });

  it("accepts 'maybe' in submit_event_rsvp validation (else rsvp_status_invalid)", () => {
    expect(MAYBE_SQL).toMatch(
      /p_rsvp_status NOT IN \('going',\s*'not_going',\s*'maybe'\)/,
    );
  });

  it("resolves 'maybe' as auto-approved + cap-neutral (its own branch before the capacity math)", () => {
    expect(MAYBE_SQL).toMatch(
      /ELSIF p_rsvp_status = 'maybe' THEN[\s\S]*?v_status := 'maybe';[\s\S]*?v_approval := 'approved';/,
    );
  });

  it("orders a 'maybe' bucket into host_list_rsvp_guests", () => {
    expect(MAYBE_SQL).toMatch(/WHEN r\.rsvp_status = 'maybe' THEN 3/);
  });
});

describe("ORCH-1150 R2 — I-PROPOSED-1150-MAYBE-NOT-IN-CAP (cap predicates untouched)", () => {
  const BASE_SQL = readFileSync(
    join(MIGRATIONS, "20261004000000_orch_1150_rsvp_events.sql"),
    "utf8",
  );

  it("the confirmed-headcount predicate still counts ONLY going AND approved", () => {
    // The capacity SUM in submit_event_rsvp must remain going+approved (never +maybe).
    expect(BASE_SQL).toMatch(
      /r\.rsvp_status = 'going' AND r\.approval_status = 'approved'/,
    );
  });

  it("the maybe migration's capacity SUM predicate still reads ONLY going AND approved", () => {
    // The re-created submit_event_rsvp keeps the confirmed-headcount SUM gated on
    // going+approved — adding 'maybe' to THIS predicate would make a maybe occupy
    // a seat (I-PROPOSED-1150-MAYBE-NOT-IN-CAP violation). Isolate the SUM's WHERE.
    const sumBlock = MAYBE_SQL.match(
      /SELECT COALESCE\(SUM\(1 \+ r\.plus_count\)[\s\S]*?WHERE([\s\S]*?);/,
    );
    expect(sumBlock).not.toBeNull();
    const where = sumBlock ? sumBlock[1] : "";
    expect(where).toMatch(/r\.rsvp_status = 'going' AND r\.approval_status = 'approved'/);
    expect(where).not.toMatch(/'maybe'/);
  });
});
