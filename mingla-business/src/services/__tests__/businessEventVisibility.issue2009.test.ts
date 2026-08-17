/**
 * issue #2009 [published-event visibility] — IMPLEMENTOR happy-path regression
 * test for the Business client half of the visibility mutation.
 *
 * Contract: BINDING SPEC AMENDMENT 3 (#issuecomment-5317187049, CONTROLLING)
 * over AMENDMENT 1 (#issuecomment-5283729259) and the original BINDING SPEC
 * (#issuecomment-5283447438).
 *
 * Per #2113 every test below EXECUTES `setPublishedEventVisibility` /
 * `issue2009VisibilityErrorCopy` against a real (mocked-transport) call. No
 * assertion here reads source text; deleting the fix makes these CALLS behave
 * differently, which is what makes the fails-on-revert proof meaningful.
 *
 * The authoritative half — the RPC, the guard trigger, the effect ledger, the
 * Private fail-closed refusal — is executed against REAL Postgres rows in
 * supabase/migrations/__tests__/issue_2009_business_event_visibility.pg17.test.sql.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  ISSUE_2009_PRIVATE_UNAVAILABLE_COPY,
  ISSUE_2009_VISIBILITY_ERROR_CODES,
  issue2009VisibilityErrorCopy,
  issue2009VisibilitySuccessCopy,
  setPublishedEventVisibility,
} from "../businessEvents";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

type RpcResult = { data: unknown; error: { message: string } | null };

const rpc = supabase.rpc as unknown as jest.Mock<
  (name: string, args: Record<string, unknown>) => Promise<RpcResult>
>;
const from = supabase.from as unknown as jest.Mock;

const EVENT_ID = "a4bd2a23-c178-4057-937a-2650b1c8e7fa";
const LOADED_AT = "2026-08-17T09:15:00.000Z";
const REASON = "Switching to unlisted for the private preview week";

const okEcho = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventId: EVENT_ID,
  requestedVisibility: "unlisted",
  storedVisibility: "hidden",
  previousStoredVisibility: "public",
  updatedAt: "2026-08-17T10:00:00.000Z",
  changed: true,
  revokedShareCount: 0,
  ...over,
});

describe("issue #2009 — setPublishedEventVisibility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("calls the narrow #2009 RPC with the exact four parameters", async () => {
    rpc.mockResolvedValue({ data: okEcho(), error: null });

    await setPublishedEventVisibility({
      eventId: EVENT_ID,
      requestedVisibility: "unlisted",
      reason: REASON,
      expectedUpdatedAt: LOADED_AT,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("business_set_event_visibility", {
      p_event_id: EVENT_ID,
      p_requested_visibility: "unlisted",
      p_reason: REASON,
      p_expected_updated_at: LOADED_AT,
    });
  });

  test("never writes events.visibility through a direct table update", async () => {
    rpc.mockResolvedValue({ data: okEcho(), error: null });

    await setPublishedEventVisibility({
      eventId: EVENT_ID,
      requestedVisibility: "unlisted",
      reason: REASON,
      expectedUpdatedAt: LOADED_AT,
    });

    // The database refuses a direct authenticated UPDATE (SC-8); the client
    // must not even attempt one.
    expect(from).not.toHaveBeenCalled();
  });

  test("Business `unlisted` is echoed back as stored `hidden`", async () => {
    rpc.mockResolvedValue({ data: okEcho(), error: null });

    const result = await setPublishedEventVisibility({
      eventId: EVENT_ID,
      requestedVisibility: "unlisted",
      reason: REASON,
      expectedUpdatedAt: LOADED_AT,
    });

    expect(result.storedVisibility).toBe("hidden");
    expect(result.requestedVisibility).toBe("unlisted");
    expect(result.changed).toBe(true);
  });

  test("Public round-trips as stored `public`", async () => {
    rpc.mockResolvedValue({
      data: okEcho({
        requestedVisibility: "public",
        storedVisibility: "public",
        previousStoredVisibility: "hidden",
      }),
      error: null,
    });

    const result = await setPublishedEventVisibility({
      eventId: EVENT_ID,
      requestedVisibility: "public",
      reason: "Returning the event to public discovery now",
      expectedUpdatedAt: LOADED_AT,
    });

    expect(result.storedVisibility).toBe("public");
  });

  test("a same-value no-op echo is surfaced as changed:false, never forged as success", async () => {
    rpc.mockResolvedValue({
      data: okEcho({
        previousStoredVisibility: "hidden",
        changed: false,
        revokedShareCount: 0,
      }),
      error: null,
    });

    const result = await setPublishedEventVisibility({
      eventId: EVENT_ID,
      requestedVisibility: "unlisted",
      reason: REASON,
      expectedUpdatedAt: LOADED_AT,
    });

    expect(result.changed).toBe(false);
  });

  test("a mismatched requested/stored echo is rejected instead of believed", async () => {
    // The server claims it stored `public` for an `unlisted` request. That is
    // the mapping breaking; the client must NOT report success.
    rpc.mockResolvedValue({
      data: okEcho({ storedVisibility: "public" }),
      error: null,
    });

    await expect(
      setPublishedEventVisibility({
        eventId: EVENT_ID,
        requestedVisibility: "unlisted",
        reason: REASON,
        expectedUpdatedAt: LOADED_AT,
      }),
    ).rejects.toThrow("set_event_visibility_echo_mismatch");
  });

  test("an echo for a DIFFERENT event is rejected", async () => {
    rpc.mockResolvedValue({
      data: okEcho({ eventId: "00000000-0000-4000-8000-000000000999" }),
      error: null,
    });

    await expect(
      setPublishedEventVisibility({
        eventId: EVENT_ID,
        requestedVisibility: "unlisted",
        reason: REASON,
        expectedUpdatedAt: LOADED_AT,
      }),
    ).rejects.toThrow("set_event_visibility_echo_mismatch");
  });

  test("an empty response is a failure, not a silent success", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await expect(
      setPublishedEventVisibility({
        eventId: EVENT_ID,
        requestedVisibility: "unlisted",
        reason: REASON,
        expectedUpdatedAt: LOADED_AT,
      }),
    ).rejects.toThrow("set_event_visibility_empty_response");
  });

  test.each([
    ISSUE_2009_VISIBILITY_ERROR_CODES.privateUnavailable,
    ISSUE_2009_VISIBILITY_ERROR_CODES.stale,
    ISSUE_2009_VISIBILITY_ERROR_CODES.notFound,
    ISSUE_2009_VISIBILITY_ERROR_CODES.notEditable,
    ISSUE_2009_VISIBILITY_ERROR_CODES.invalidReason,
    ISSUE_2009_VISIBILITY_ERROR_CODES.directUpdateBlocked,
  ])("surfaces the stable server code `%s` verbatim to the caller", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } });

    await expect(
      setPublishedEventVisibility({
        eventId: EVENT_ID,
        requestedVisibility: "unlisted",
        reason: REASON,
        expectedUpdatedAt: LOADED_AT,
      }),
    ).rejects.toThrow(code);
  });

  test("a Private request still reaches the server, which is the authority", async () => {
    // SC-12: the client refuses Private too, but if its capability state were
    // stale the SERVER decides. The service must pass the request through and
    // relay the refusal rather than translating it locally.
    rpc.mockResolvedValue({
      data: null,
      error: { message: "private_visibility_unavailable" },
    });

    await expect(
      setPublishedEventVisibility({
        eventId: EVENT_ID,
        requestedVisibility: "private",
        reason: "Locking this down to invited guests only now",
        expectedUpdatedAt: LOADED_AT,
      }),
    ).rejects.toThrow("private_visibility_unavailable");
    expect(rpc).toHaveBeenCalledWith("business_set_event_visibility", {
      p_event_id: EVENT_ID,
      p_requested_visibility: "private",
      p_reason: "Locking this down to invited guests only now",
      p_expected_updated_at: LOADED_AT,
    });
  });
});

describe("issue #2009 — organiser-facing copy", () => {
  test("the Private prerequisite copy is the approved sentence, verbatim", () => {
    expect(issue2009VisibilityErrorCopy("private_visibility_unavailable")).toBe(
      "Private events are not ready to accept invited guests yet. Choose Public or Unlisted for now.",
    );
    expect(ISSUE_2009_PRIVATE_UNAVAILABLE_COPY).toBe(
      "Private events are not ready to accept invited guests yet. Choose Public or Unlisted for now.",
    );
  });

  test("stale, permission, status and reason failures each get their own honest copy", () => {
    expect(issue2009VisibilityErrorCopy("stale_event_visibility")).toBe(
      "This event changed elsewhere. Review the latest visibility and try again.",
    );
    expect(issue2009VisibilityErrorCopy("event_not_found")).toBe(
      "You no longer have permission to edit this event.",
    );
    expect(issue2009VisibilityErrorCopy("not_authenticated")).toBe(
      "You no longer have permission to edit this event.",
    );
    expect(issue2009VisibilityErrorCopy("event_not_editable")).toBe(
      "This event can't be edited — it may be ended or cancelled.",
    );
    expect(issue2009VisibilityErrorCopy("invalid_edit_reason")).toBe(
      "Add a brief reason (10–200 characters) for this change.",
    );
  });

  test("an unknown / offline failure falls back to a retryable message, never blame", () => {
    const copy = issue2009VisibilityErrorCopy("TypeError: Network request failed");
    expect(copy).toBe(
      "Couldn't save visibility. Check your connection and try again.",
    );
    expect(copy.toLowerCase()).not.toContain("you did");
  });

  test("every distinct server code maps to a DISTINCT message (no silent collapse)", () => {
    const codes = [
      "private_visibility_unavailable",
      "stale_event_visibility",
      "event_not_found",
      "event_not_editable",
      "invalid_edit_reason",
      "some_unmapped_code",
    ];
    const messages = codes.map(issue2009VisibilityErrorCopy);
    expect(new Set(messages).size).toBe(codes.length);
  });

  test("the success toast names the persisted Business label", () => {
    expect(issue2009VisibilitySuccessCopy("public")).toBe("Visibility updated to Public.");
    expect(issue2009VisibilitySuccessCopy("unlisted")).toBe("Visibility updated to Unlisted.");
    expect(issue2009VisibilitySuccessCopy("private")).toBe("Visibility updated to Private.");
  });
});
