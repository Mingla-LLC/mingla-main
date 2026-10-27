/* eslint-disable import/first */
/**
 * Issue #3801 / #4134 — a trip editor sends the revision it loaded and adopts
 * the revision each save returns.
 *
 * Before: every command read `events.updated_at` fresh right before its RPC
 * (`resolveRevision` / `readTripRevision`), so the server's compare-and-swap
 * only ever compared the server with itself. An editor holding an older copy
 * silently overwrote newer data, and two saves in flight read the same value.
 *
 * Pinned here at the service seam the wizard calls:
 *   - a held revision is SENT (no fresh read of `events`);
 *   - the revision the graph command returns is ADOPTED for the next save
 *     (draft graph commands and the intake draft path);
 *   - publish pre-saves and publishes with the held, then adopted, revision;
 *   - the intake path names a PT409 conflict instead of "[object Object]".
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u-1" } } }) },
  },
}));

import {
  publishTrip,
  upsertTripDays,
  upsertTripInclusions,
  type TripRevisionCursor,
} from "../tripsService";
import { upsertTripIntakeSchema } from "../intakeSchemaService";
import { isTripRevisionConflict } from "../../utils/tripSaveQueue";

const EVENT_ID = "38010000-0000-4000-8000-0000000000c1";
const LOADED = "2027-03-01T10:00:00.000001+00:00";

const graphCalls: Record<string, unknown>[] = [];
let nextRevision = 0;
const revisionReads: string[] = [];

beforeEach(() => {
  graphCalls.length = 0;
  revisionReads.length = 0;
  nextRevision = 0;
  fromMock.mockReset();
  rpcMock.mockReset();
  // Any read of `events` counts as a fresh revision read.
  fromMock.mockImplementation((table: string) => {
    revisionReads.push(table);
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      maybeSingle: () =>
        Promise.resolve({ data: { updated_at: "fresh-read", status: "draft" }, error: null }),
    };
    return chain;
  });
  rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
    if (fn === "biz_apply_trip_draft_graph") {
      graphCalls.push(args);
      nextRevision += 1;
      return Promise.resolve({
        data: {
          event: { id: EVENT_ID },
          days: [],
          inclusions: [],
          tiers: [],
          revision: `rev-after-save-${nextRevision}`,
        },
        error: null,
      });
    }
    if (fn === "biz_publish_trip_command") {
      graphCalls.push({ publish: true, ...args });
      return Promise.resolve({ data: { ok: false, reason: "stop_here" }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

describe("#3801 — the held revision is sent and the returned one adopted", () => {
  test("draft graph commands send the held revision and adopt the server's", async () => {
    const cursor: TripRevisionCursor = { current: LOADED };

    await upsertTripDays(EVENT_ID, [], { revision: cursor });
    expect(graphCalls[0].p_expected_updated_at).toBe(LOADED);
    expect(cursor.current).toBe("rev-after-save-1");

    await upsertTripInclusions(EVENT_ID, [], { revision: cursor });
    expect(graphCalls[1].p_expected_updated_at).toBe("rev-after-save-1");
    expect(cursor.current).toBe("rev-after-save-2");

    // Never a fresh read: the server compares against what the editor loaded.
    expect(revisionReads).toEqual([]);
  });

  test("a failed command leaves the held revision unchanged (no silent heal)", async () => {
    const cursor: TripRevisionCursor = { current: LOADED };
    rpcMock.mockImplementationOnce(() =>
      Promise.resolve({
        data: null,
        error: { code: "PT409", message: "trip_revision_conflict", details: null, hint: null },
      }),
    );
    await expect(upsertTripDays(EVENT_ID, [], { revision: cursor })).rejects.toMatchObject({
      code: "PT409",
    });
    expect(cursor.current).toBe(LOADED);
  });

  test("without a held revision the old behaviour stays: read it now", async () => {
    await upsertTripDays(EVENT_ID, []);
    expect(graphCalls[0].p_expected_updated_at).toBe("fresh-read");
    expect(revisionReads).toEqual(["events"]);
  });

  test("intake draft save sends the held revision and adopts the returned one", async () => {
    const cursor: TripRevisionCursor = { current: LOADED };
    await upsertTripIntakeSchema({
      eventId: EVENT_ID,
      ticketTypeId: "tt-a",
      schema: null,
      skipStatusProbe: true,
      revision: cursor,
    });
    expect(graphCalls[0].p_expected_updated_at).toBe(LOADED);
    expect(cursor.current).toBe("rev-after-save-1");

    await upsertTripIntakeSchema({
      eventId: EVENT_ID,
      ticketTypeId: "tt-b",
      schema: null,
      skipStatusProbe: true,
      revision: cursor,
    });
    expect(graphCalls[1].p_expected_updated_at).toBe("rev-after-save-1");
    expect(revisionReads).toEqual([]);
  });

  test("publish pre-saves with the held revision and publishes with the adopted one", async () => {
    const cursor: TripRevisionCursor = { current: LOADED };
    await expect(
      publishTrip(EVENT_ID, { title: "Lisbon" }, { revision: cursor }),
    ).rejects.toBeTruthy();
    expect(graphCalls[0].p_expected_updated_at).toBe(LOADED);
    expect(graphCalls[1]).toMatchObject({
      publish: true,
      p_expected_updated_at: "rev-after-save-1",
    });
    expect(revisionReads).toEqual([]);
  });
});

describe("#3801 — the intake path names a revision conflict", () => {
  test("PT409 surfaces as trip_revision_conflict, not [object Object]", async () => {
    rpcMock.mockImplementationOnce(() =>
      Promise.resolve({
        data: null,
        error: { code: "PT409", message: "trip_revision_conflict", details: null, hint: null },
      }),
    );
    const cursor: TripRevisionCursor = { current: LOADED };
    let caught: unknown = null;
    try {
      await upsertTripIntakeSchema({
        eventId: EVENT_ID,
        ticketTypeId: "tt-a",
        schema: null,
        skipStatusProbe: true,
        revision: cursor,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "trip_revision_conflict" });
    expect(isTripRevisionConflict(caught)).toBe(true);
    expect(String((caught as { detail?: unknown }).detail)).not.toContain("[object");
    expect(cursor.current).toBe(LOADED);
  });
});
