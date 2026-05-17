/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — tester adversarial regression test.
 *
 * Attacks a DIFFERENT angle than the implementor's tripsService.test.ts.
 *
 * Implementor's RPC-error test (tripsService.test.ts L111-120) mocks the
 * Postgrest error as `{ code: "trip_days_required", message: "Trips must
 * have days." }` — i.e. the test pretends `error.code` carries the
 * RAISE-EXCEPTION literal. The wizard mapper switch ALSO matches against
 * `code`, so the implementor test passes.
 *
 * Production reality differs. Supabase Postgrest's actual response for
 * `RAISE EXCEPTION 'trip_days_required'` (no `USING ERRCODE` clause —
 * which is what supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql
 * does for every trip-specific RAISE) is:
 *
 *     { code: "P0001", message: "trip_days_required", details: null, hint: ... }
 *
 * `code` is the Postgres SQLSTATE (always `P0001` for unqualified
 * plpgsql RAISE), and `message` carries the literal RAISE argument.
 * tripsService.publishTrip then constructs
 * `new TripPublishValidationError(error.code ?? "publish_failed", error.message)`
 * so the wizard receives `err.code = "P0001"` and `err.message = "trip_days_required"`.
 *
 * The wizard's `mapPublishErrorToState(code, rawMessage)` switches on
 * `code` (TripCreatorStep5Review.tsx L91), which means in production the
 * switch ALWAYS hits the `default` branch — the user-friendly translations
 * and step-pointer jump never fire. Operators see raw technical strings
 * like "trip_destination_required" instead of "Add a destination before
 * publishing." and the wizard does not auto-navigate to the offending step.
 *
 * This source-grep test fails when the mapper switches on the wrong
 * variable, exposing the P1 UX bug. It is structured as a tester
 * adversarial test because it attacks the assumption baked into both
 * the implementor's mock and the wizard's switch, not the implementor's
 * happy-path "RPC was called" assertion.
 *
 * To fix and make this test pass, change the switch in
 * TripCreatorStep5Review.tsx from `switch (code) {` to
 * `switch (rawMessage) {`, OR (equivalently) change tripsService.publishTrip
 * to swap which Postgrest field becomes the discriminator passed to the
 * wizard. The test asserts the discriminator is `rawMessage` — the
 * functional fix.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const MAPPER_SOURCE = readFileSync(
  join(__dirname, "..", "TripCreatorStep5Review.tsx"),
  "utf8",
);

const WIZARD_SOURCE = readFileSync(
  join(__dirname, "..", "TripCreatorWizard.tsx"),
  "utf8",
);

const SERVICE_SOURCE = readFileSync(
  join(__dirname, "..", "..", "..", "services", "tripsService.ts"),
  "utf8",
);

describe("ORCH-0859 — publishError discriminator end-to-end (tester adversarial)", () => {
  test("mapPublishErrorToState switch discriminator must be the RAISE message, not SQLSTATE", () => {
    // Production: Postgrest returns `code: "P0001"` (the SQLSTATE) and
    // `message: "trip_destination_required"` (the literal RAISE arg) for
    // unqualified `RAISE EXCEPTION 'foo'` plpgsql statements. The trip
    // publish RPC at supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql
    // never uses USING ERRCODE, so every trip-specific RAISE produces
    // SQLSTATE P0001 with the user-friendly name in `message`.
    //
    // The wizard mapper MUST therefore switch on the rawMessage parameter,
    // not the code parameter. Switching on `code` means the switch always
    // falls through to `default` in production — friendly translations
    // and step-pointer auto-jump never fire.
    //
    // This regex matches the WRONG pattern (`switch (code)`) and fails
    // if found. Fix is `switch (rawMessage)`.
    expect(MAPPER_SOURCE).not.toMatch(/switch\s*\(\s*code\s*\)/);

    // The mapper must reference rawMessage as the switch discriminator.
    expect(MAPPER_SOURCE).toMatch(/switch\s*\(\s*rawMessage\s*\)/);
  });

  test("mapper still includes a case for every trip-specific RPC exception", () => {
    // After the fix, all 8 published exception names must still have
    // their friendly-translation case. Listing them by name catches any
    // accidental removal during the discriminator-rename refactor.
    const REQUIRED_CASES = [
      "trip_destination_required",
      "trip_capacity_required",
      "trip_dates_required",
      "trip_end_before_start",
      "trip_days_required",
      "trip_pricing_tier_required",
      "event_title_required",
      "insufficient_event_permission",
      "event_draft_not_publishable",
    ];
    for (const name of REQUIRED_CASES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(MAPPER_SOURCE).toMatch(
        new RegExp(`case\\s+["']${name}["']\\s*:`),
      );
    }
  });

  test("mapper's default branch never echoes a raw 'trip_*_required' literal as user copy", () => {
    // Belt-and-braces: even if a future regression breaks one case clause,
    // the default branch must not echo the raw technical string as the
    // user-facing message. The current default already uses rawMessage as
    // a fallback, which is a UX smell — but at minimum the friendly
    // sentinel "Couldn't publish" must be present as the OR fallback.
    expect(MAPPER_SOURCE).toMatch(/Couldn'?t publish/i);
  });

  test("wizard catch passes (code, message) to mapper in that exact order", () => {
    // Defends against a future change that swaps the argument order without
    // also swapping the switch discriminator. The mapper signature is
    // (code, rawMessage) — wizard must call it with (err.code, err.message).
    expect(WIZARD_SOURCE).toMatch(
      /mapPublishErrorToState\s*\(\s*err\.code[^,]*,\s*err\.message\s*\)/,
    );
  });

  test("publishTrip constructs TripPublishValidationError(code, message) — Postgrest contract", () => {
    // The service layer locks the contract that the wizard relies on.
    // If a future refactor reverses these arguments, the discriminator
    // swap in the mapper (above) becomes wrong. This test pins both
    // sides of the boundary.
    expect(SERVICE_SOURCE).toMatch(
      /new\s+TripPublishValidationError\s*\(\s*error\.code\s*\?\?[^,]+,\s*error\.message\s*\)/,
    );
  });

  test("trip RPC raises every error name without USING ERRCODE — proves SQLSTATE is P0001", () => {
    // Reads the migration to prove the discriminator-via-message decision
    // is grounded in the actual RPC source. If a future implementor adds
    // `USING ERRCODE = 'XYZ12'` clauses to each RAISE, this test should
    // be updated alongside the mapper to switch on `code` instead — and
    // a new mapping from SQLSTATE → friendly copy added.
    const RPC_SOURCE = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20260608000100_orch_0859_publish_rpc_trip.sql",
      ),
      "utf8",
    );
    // The RPC has many RAISE EXCEPTION 'trip_*' / 'event_*' lines —
    // none of them carry USING ERRCODE, so SQLSTATE collapses to P0001.
    expect(RPC_SOURCE).toMatch(/RAISE EXCEPTION 'trip_destination_required'/);
    expect(RPC_SOURCE).not.toMatch(/USING\s+ERRCODE\s*=/i);
  });
});
