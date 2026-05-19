/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — TESTER-AUTHORED ADVERSARIAL
 * regression test (2 of 2) per ORCH-0840 [Regression-test enforcement +
 * append-only CI] Step 0.5 (b) gate.
 *
 * ANGLE: I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB. When a planner
 * edits an intake schema on a PUBLISHED trip (status="scheduled" or "live"),
 * `upsertTripIntakeSchema` MUST route through the `biz_update_live_trip`
 * RPC, NOT through the direct `.from("trip_intake_schemas").upsert(...)`
 * code path. The RPC fires the audit log + the Phase 2 re-answer trigger;
 * direct upsert bypasses both → silent buyer-notification skip.
 *
 * Attacks a DIFFERENT angle than implementor's happy-path:
 *   - Implementor `intakeSchemaService_happy_path.test.ts` covers
 *     `validateIntakeSchemaClient` (PURE schema validation — never reaches
 *     the upsert code path).
 *   - Implementor `intakeSchemaService_answer_validation.test.ts` covers
 *     `validateAnswerAgainstSchema` (PURE answer validation — never reaches
 *     the upsert code path).
 *   - Tester adversarial 1 `intakeSchemaService_upload_size_cap_adversarial`
 *     covers `uploadIntakeFile` (different function).
 *   - This test covers `upsertTripIntakeSchema` (different function again)
 *     — specifically the published-trip RPC routing branch which is the
 *     load-bearing invariant for re-answer notification dispatch.
 *
 * fails-on-revert proof anchor: the `if (isPublished)` branching in
 * upsertTripIntakeSchema. Replace with always-direct-upsert and re-run →
 * tests B/C/D FAIL because RPC was never called and direct upsert was
 * called instead. Captured at HEAD `fcd97a66f662028e81b26867ab8203bd3420fa5c`
 * (Phase 4 implementor return).
 *
 * Adversarial angle classification:
 *   - DIFFERENT FUNCTION than implementor + adversarial-1 tests
 *   - INVARIANT VIOLATION (I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB)
 *   - SILENT FAILURE (direct upsert succeeds but skips audit + notification)
 *   - CONTRACT VIOLATION (RPC vs direct write must match status)
 *   - REASON-VALIDATION (10-200 char gate must fire BEFORE RPC invoke)
 */

/* eslint-disable import/first */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";

let mockStatusReturn: { status: string } | null = {
  status: "draft",
};
const mockRpcSpy = jest.fn();
const mockUpsertSpy = jest.fn();
const mockDeleteSpy = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: mockStatusReturn, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "trip_intake_schemas") {
        return {
          upsert: (...args: unknown[]) => {
            mockUpsertSpy(...args);
            return {
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { id: "row-1" }, error: null }),
              }),
            };
          },
          delete: () => {
            mockDeleteSpy();
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: null, error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }
      return {};
    },
    rpc: (name: string, params: unknown) => {
      mockRpcSpy(name, params);
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  },
}));

import {
  createBlankQuestion,
  createEmptyIntakeSchema,
  upsertTripIntakeSchema,
} from "../intakeSchemaService";

function makeValidSchema(): ReturnType<typeof createEmptyIntakeSchema> {
  const schema = createEmptyIntakeSchema();
  const q = createBlankQuestion("short_text", 0);
  q.label = "Passport number";
  q.required = true;
  schema.questions = [q];
  return schema;
}

beforeEach(() => {
  mockRpcSpy.mockClear();
  mockUpsertSpy.mockClear();
  mockDeleteSpy.mockClear();
  mockStatusReturn = { status: "draft" };
});

describe("ORCH-0880 ADVERSARIAL — I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB", () => {
  test("A. draft trip + valid schema → DIRECT upsert (no RPC)", async () => {
    mockStatusReturn = { status: "draft" };
    await upsertTripIntakeSchema({
      eventId: "event-1",
      ticketTypeId: "tier-1",
      schema: makeValidSchema(),
    });
    expect(mockUpsertSpy).toHaveBeenCalledTimes(1);
    expect(mockRpcSpy).not.toHaveBeenCalled();
  });

  test("B. published trip (status=scheduled) → RPC ONLY; no direct upsert", async () => {
    // This is the load-bearing invariant. Reverting the if(isPublished)
    // branch breaks this assertion because direct upsert fires instead.
    mockStatusReturn = { status: "scheduled" };
    await upsertTripIntakeSchema({
      eventId: "event-1",
      ticketTypeId: "tier-1",
      schema: makeValidSchema(),
      reason: "Adding passport scan requirement for new visa policy.",
    });
    expect(mockRpcSpy).toHaveBeenCalledTimes(1);
    expect(mockRpcSpy).toHaveBeenCalledWith(
      "biz_update_live_trip",
      expect.objectContaining({
        p_event_id: "event-1",
        p_patch: expect.objectContaining({
          intake_schemas: expect.arrayContaining([
            expect.objectContaining({ ticket_type_id: "tier-1" }),
          ]),
        }),
        p_reason: "Adding passport scan requirement for new visa policy.",
      }),
    );
    // Critical: direct upsert MUST NOT fire on published trips (would skip
    // audit log + re-answer notification trigger).
    expect(mockUpsertSpy).not.toHaveBeenCalled();
    expect(mockDeleteSpy).not.toHaveBeenCalled();
  });

  test("C. published trip (status=live) → RPC ONLY; no direct upsert", async () => {
    // status='live' is the post-event-start state. Same invariant applies.
    mockStatusReturn = { status: "live" };
    await upsertTripIntakeSchema({
      eventId: "event-1",
      ticketTypeId: "tier-1",
      schema: makeValidSchema(),
      reason: "Mid-trip schema correction per operator support ticket.",
    });
    expect(mockRpcSpy).toHaveBeenCalledTimes(1);
    expect(mockUpsertSpy).not.toHaveBeenCalled();
  });

  test("D. published trip + CLEAR schema (null) → RPC ONLY; no direct delete", async () => {
    mockStatusReturn = { status: "scheduled" };
    await upsertTripIntakeSchema({
      eventId: "event-1",
      ticketTypeId: "tier-1",
      schema: null,
      reason: "Removing intake requirement after VIP renegotiation.",
    });
    expect(mockRpcSpy).toHaveBeenCalledTimes(1);
    expect(mockRpcSpy).toHaveBeenCalledWith(
      "biz_update_live_trip",
      expect.objectContaining({
        p_patch: expect.objectContaining({
          intake_schemas: expect.arrayContaining([
            expect.objectContaining({
              ticket_type_id: "tier-1",
              schema: null,
            }),
          ]),
        }),
      }),
    );
    // Critical: direct delete MUST NOT fire on published trips.
    expect(mockDeleteSpy).not.toHaveBeenCalled();
  });
});

describe("ORCH-0880 ADVERSARIAL — published-trip reason-text gate (10-200 char)", () => {
  test("E. published trip + 9-char reason → throws edit_reason_invalid_length BEFORE RPC", async () => {
    mockStatusReturn = { status: "scheduled" };
    let caught: unknown;
    try {
      await upsertTripIntakeSchema({
        eventId: "event-1",
        ticketTypeId: "tier-1",
        schema: makeValidSchema(),
        reason: "Too short",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe(
      "edit_reason_invalid_length",
    );
    // Critical: RPC MUST NOT have been invoked (early rejection).
    expect(mockRpcSpy).not.toHaveBeenCalled();
    expect(mockUpsertSpy).not.toHaveBeenCalled();
  });

  test("F. published trip + 201-char reason → throws edit_reason_invalid_length BEFORE RPC", async () => {
    mockStatusReturn = { status: "scheduled" };
    let caught: unknown;
    try {
      await upsertTripIntakeSchema({
        eventId: "event-1",
        ticketTypeId: "tier-1",
        schema: makeValidSchema(),
        reason: "x".repeat(201),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe(
      "edit_reason_invalid_length",
    );
    expect(mockRpcSpy).not.toHaveBeenCalled();
  });

  test("G. published trip + missing reason → throws edit_reason_invalid_length BEFORE RPC", async () => {
    mockStatusReturn = { status: "scheduled" };
    let caught: unknown;
    try {
      await upsertTripIntakeSchema({
        eventId: "event-1",
        ticketTypeId: "tier-1",
        schema: makeValidSchema(),
        // reason omitted
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe(
      "edit_reason_invalid_length",
    );
    expect(mockRpcSpy).not.toHaveBeenCalled();
  });
});

describe("ORCH-0880 ADVERSARIAL — I-PROPOSED-TR2-EVENTS-TYPE-FILTER", () => {
  test("H. status probe filters .eq('event_type', 'trip') — non-trip event returns null → not_found", async () => {
    // When the .eq('event_type', 'trip') filter is preserved, a non-trip
    // event (or missing trip row) returns null → must throw not_found.
    // This guards I-PROPOSED-TR2-EVENTS-TYPE-FILTER (intake schemas only on
    // trips). If someone reverts the filter, a non-trip event row could
    // sneak through and the upsert would target a non-trip event_id.
    mockStatusReturn = null;
    let caught: unknown;
    try {
      await upsertTripIntakeSchema({
        eventId: "event-1",
        ticketTypeId: "tier-1",
        schema: makeValidSchema(),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("not_found");
    // Critical: neither RPC nor direct upsert should have been called.
    expect(mockRpcSpy).not.toHaveBeenCalled();
    expect(mockUpsertSpy).not.toHaveBeenCalled();
  });
});

describe("ORCH-0880 ADVERSARIAL — skipStatusProbe optimization safety", () => {
  test("I. skipStatusProbe=true forces direct upsert (assumed-draft path)", async () => {
    // The wizard's autosaveStep6 uses skipStatusProbe=true since the wizard
    // always operates on drafts. This must bypass the status query AND
    // force the direct-upsert path. Reverting this would either (a) hit
    // the DB with an extra round-trip, or (b) accidentally route the
    // wizard's writes through the RPC which expects reason text.
    mockStatusReturn = { status: "scheduled" }; // even if status is published,
    // skipStatusProbe should skip the probe and assume draft.
    await upsertTripIntakeSchema({
      eventId: "event-1",
      ticketTypeId: "tier-1",
      schema: makeValidSchema(),
      skipStatusProbe: true,
    });
    expect(mockUpsertSpy).toHaveBeenCalledTimes(1);
    expect(mockRpcSpy).not.toHaveBeenCalled();
  });
});
