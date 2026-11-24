/**
 * issue #3281 S6 (checkpoint 16) — submitPublicRsvp carries the free add-on
 * picks as `rsvpAddOns` only when the page passes some, so an RSVP without
 * add-ons sends exactly the body it sent before (no key; the database wrapper
 * is not called). The page never passes an empty list (its own test).
 *
 * FAILS-ON-REVERT: drop the `rsvpAddOns:` line from submitPublicRsvp's body
 * (picks not sent), or default it to [] (a key reaches the edge) -> red.
 */
import { beforeEach, expect, jest, test } from "@jest/globals";

const invoke = jest.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>();

jest.mock("../supabase", () => ({ supabase: { functions: { invoke } } }));
jest.mock("../../analytics/webAnalytics", () => ({
  getStoredClickAttribution: () => ({ clickId: null }),
  getStoredAdMatchData: () => ({}),
}));

import { submitPublicRsvp } from "../rsvpEvents";

const bodyOf = (call: number): Record<string, unknown> =>
  JSON.parse(JSON.stringify((invoke.mock.calls[call][1] as { body: unknown }).body)) as Record<string, unknown>;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({
    data: { status: "going", approvalStatus: "approved", rsvpId: "rsvp-1" },
    error: null,
  });
});

const base = { eventId: "3281c160-0000-4000-8000-0000000000e1", rsvpStatus: "going" as const };

test("picks go to public-submit-rsvp as rsvpAddOns", async () => {
  await submitPublicRsvp({ ...base, rsvpAddOns: [{ addOnId: "a-1", quantity: 2 }] });
  expect(invoke.mock.calls[0][0]).toBe("public-submit-rsvp");
  expect(bodyOf(0).rsvpAddOns).toEqual([{ addOnId: "a-1", quantity: 2 }]);
});

test("no picks sends no rsvpAddOns key at all", async () => {
  await submitPublicRsvp(base);
  expect("rsvpAddOns" in bodyOf(0)).toBe(false);
});
