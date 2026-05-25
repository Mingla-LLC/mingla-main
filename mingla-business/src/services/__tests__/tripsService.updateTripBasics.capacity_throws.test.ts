/* eslint-disable import/first */
/**
 * ORCH-0950 adversarial scaffold — client-side guardrail for the retired
 * trip-capacity JSONB write path.
 *
 * Tester may re-author or expand these assertions, but this file pins the
 * load-bearing contract now: updateTripBasics must throw before any Supabase
 * network call if a caller attempts to send businessTrip.capacity.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

import { updateTripBasics } from "../tripsService";

beforeEach(() => {
  fromMock.mockReset();
});

describe("ORCH-0950 — updateTripBasics capacity guard", () => {
  test("throws before any Supabase call when businessTrip.capacity is present", async () => {
    await expect(
      updateTripBasics("evt-trip-1", {
        businessTrip: { capacity: 99 },
      }),
    ).rejects.toThrow(
      "ORCH-0950: trip capacity must be routed through updateTripPricing",
    );

    expect(fromMock).not.toHaveBeenCalled();
  });
});
