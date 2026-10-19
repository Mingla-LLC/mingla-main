/**
 * issue #3281 — successful-return reload labels from the confirm order payload,
 * not only cart/resume state (resume is cleared after paid).
 *
 * FAILS-ON-REVERT: drop `order.bookedStartAt` hydration on the confirm screen
 * or the FreeCompleted field and this goes red.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../../..");

describe("issue #3281 — confirm reload surfaces booked start from order", () => {
  test("confirm screen hydrates bookedStartAt from order.bookedStartAt", () => {
    const src = readFileSync(
      join(
        ROOT,
        "app/checkout-experience/[experienceEventId]/confirm.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("order.bookedStartAt");
    expect(src).toContain("setBookedStartAt(orderBooked)");
  });

  test("TicketCheckoutFreeCompleted declares bookedStartAt", () => {
    const src = readFileSync(
      join(ROOT, "src/services/ticketCheckoutService.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /export interface TicketCheckoutFreeCompleted[\s\S]*bookedStartAt\??:\s*string\s*\|\s*null/,
    );
  });
});
