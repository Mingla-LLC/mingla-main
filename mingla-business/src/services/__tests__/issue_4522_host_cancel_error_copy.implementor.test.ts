/**
 * issue #4522 G-10 — a host who cancels a booking is the organizer, so an
 * error must never tell them to "contact the organizer". A traveler (their
 * cancel link carries a token) keeps the old lines.
 *
 * FAILS ON REVERT: drop the host lines or the token check in
 * cancelTripBookingService.ts.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import {
  commitBuyerCancel,
  commitOperatorCancel,
  previewOperatorCancel,
  type CancelTripBookingError,
} from "../cancelTripBookingService";
import { supabase } from "../supabase";

type AnyJestMock = { mockResolvedValueOnce: (value: unknown) => AnyJestMock };
const mockInvoke = supabase.functions.invoke as unknown as AnyJestMock;

const refuse = (code: string, status = 502): void => {
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: {
      message: "request_failed",
      context: { status, text: jest.fn(async () => JSON.stringify({ error: code })) } as unknown as Response,
    },
  });
};

const ORDER = "00000000-0000-0000-0000-000000000004";
const caught = async (run: () => Promise<unknown>): Promise<CancelTripBookingError> => {
  try {
    await run();
  } catch (e) {
    return e as CancelTripBookingError;
  }
  throw new Error("did not throw");
};

describe("#4522 G-10 cancel errors name the right person", () => {
  test.each(["stripe_refund_failed", "missing_connected_account", "no_trip_start_date"])(
    "a host's %s message never says contact the organizer",
    async (code) => {
      refuse(code);
      const err = await caught(() => commitOperatorCancel({ orderId: ORDER, reason: "Host cancelled this one", expectedRefundTotalCents: 100, idempotencyKey: "k" }));
      expect(err.code).toBe(code);
      expect(err.message.toLowerCase()).not.toContain("organizer");
      refuse(code);
      const preview = await caught(() => previewOperatorCancel(ORDER));
      expect(preview.message.toLowerCase()).not.toContain("organizer");
    },
  );

  test("a traveler keeps the original line", async () => {
    refuse("stripe_refund_failed");
    const err = await caught(() => commitBuyerCancel({ orderId: ORDER, token: "t".repeat(40), expectedRefundTotalCents: 100, idempotencyKey: "k" }));
    expect(err.message).toBe("Couldn't process the refund. Try again or contact the organizer.");
  });
});
