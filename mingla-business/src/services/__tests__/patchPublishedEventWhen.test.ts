/**
 * ORCH-0877 happy-path regression test #3 — patchPublishedEventWhen service.
 *
 * Exercises:
 *   - Successful RPC invocation returns the typed response.
 *   - RPC error code surfaces as a thrown Error whose message matches the
 *     RPC's raised code (so the UI's mapWhenPatchErrorToCopy can branch).
 *   - Empty response throws `patch_event_when_empty_response`.
 *
 * fails-on-revert verified at HEAD aa79f79c39be1bda08396f30dfdb79725d959e19
 *   - Pre-ORCH-0877 there is NO `patchPublishedEventWhen` export from
 *     businessEvents.ts; the import fails to resolve. Revert and the entire
 *     test file fails to load.
 *   - The `business_patch_event_when` RPC name is also new — revert removes
 *     the migration and the mock would assert against a different RPC name.
 */

// Mock the entire businessEvents transitive dependency chain to avoid pulling
// React Native via appsFlyerService. We only test the patchPublishedEventWhen
// function itself, which uses the mocked supabase.rpc.
jest.mock("../supabase", () => ({
  supabase: { rpc: jest.fn() },
}));
jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { patchPublishedEventWhen } from "../businessEvents";
import { supabase } from "../supabase";

const rpcMock = (supabase.rpc as unknown) as jest.Mock;

describe("ORCH-0877 — patchPublishedEventWhen service", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  test("calls business_patch_event_when RPC with the correct argument shape", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        event: { id: "evt_1" },
        when_mode: "single",
        sold_count: 0,
        updated_at: "2026-05-18T22:00:00.000Z",
      },
      error: null,
    });

    const result = await patchPublishedEventWhen({
      eventId: "evt_1",
      whenPayload: {
        whenMode: "single",
        timezone: "Europe/London",
        when: { date: "2026-05-18", doorsOpen: "22:00", endsAt: "02:00" },
        multiDates: null,
        recurrenceRule: null,
      },
      reason: "Correcting cross-midnight end time",
      clientRevision: null,
    });

    expect(result.when_mode).toBe("single");
    expect(result.sold_count).toBe(0);
    expect(rpcMock).toHaveBeenCalledWith(
      "business_patch_event_when",
      expect.objectContaining({
        p_event_id: "evt_1",
        p_reason: "Correcting cross-midnight end time",
        p_client_revision: null,
      }),
    );
  });

  test("throws an Error whose message is the RPC's raised code", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "when_mode_drops_active_date" },
    });

    await expect(
      patchPublishedEventWhen({
        eventId: "evt_2",
        whenPayload: {
          whenMode: "multi_date",
          timezone: "UTC",
          when: null,
          multiDates: [],
          recurrenceRule: null,
        },
        reason: "Switching to multi-date",
        clientRevision: null,
      }),
    ).rejects.toThrow("when_mode_drops_active_date");
  });

  test("throws `patch_event_when_empty_response` when RPC returns null data", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      patchPublishedEventWhen({
        eventId: "evt_3",
        whenPayload: {
          whenMode: "single",
          timezone: "UTC",
          when: { date: "2026-05-18", doorsOpen: "22:00", endsAt: "23:00" },
          multiDates: null,
          recurrenceRule: null,
        },
        reason: "Time only edit",
        clientRevision: null,
      }),
    ).rejects.toThrow("patch_event_when_empty_response");
  });
});
