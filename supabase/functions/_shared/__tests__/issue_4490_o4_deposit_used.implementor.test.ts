// #4490 spec 08 §11 T12 — a booking whose paid table deposit is on a Till
// check refuses a refund of it: the database raises reservation_deposit_used
// (BEFORE INSERT on source_refunds, migration 20281203644490) and the host
// cancel answers 409 with that code (the Host shows "This deposit was used on
// the bill at the venue."). Nothing is leased or run.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleVenueStaffCancel,
  VENUE_STAFF_CANCEL_ERROR_STATUS,
  venueStaffCancelErrorCode,
} from "../venueStaffCancelRefund.ts";

Deno.test("O4-D1 reservation_deposit_used maps to 409 and is recognised in a database message", () => {
  assertEquals(VENUE_STAFF_CANCEL_ERROR_STATUS.reservation_deposit_used, 409);
  assertEquals(
    venueStaffCancelErrorCode("ERROR: reservation_deposit_used"),
    "reservation_deposit_used",
  );
});

Deno.test("O4-D2 the host cancel of a booking whose deposit is on a bill answers 409 and runs nothing", async () => {
  let serviceCalls = 0;
  let ran = 0;
  const service = new Proxy({}, {
    get: () => () => {
      serviceCalls++;
      throw new Error("the service client must not be used");
    },
  });
  const result = await handleVenueStaffCancel(
    {
      reservationId: "00000000-4490-4000-8000-0000000007a1",
      reason: "Guest left",
    },
    {
      userRpc: () =>
        Promise.resolve({
          data: null,
          error: { message: "reservation_deposit_used" },
        }),
      // deno-lint-ignore no-explicit-any
      service: service as any,
      postsEnabled: () => true,
      runOperation: () => {
        ran++;
        return Promise.resolve();
      },
    },
  );
  assertEquals(result, {
    status: 409,
    body: { error: "reservation_deposit_used" },
  });
  assertEquals([serviceCalls, ran], [0, 0]);
});
