/**
 * issue #4522 W-10 — after a payment window fails to open, the order is held
 * for the session's 15 minutes; the next Pay is refused as "in progress". The
 * guest was told to "wait about a minute", which did not work. The copy now
 * says up to 15 minutes, matching the hold the create sets.
 * FAILS ON REVERT: the copy says "about a minute".
 */
import fs from "node:fs";
import path from "node:path";

jest.mock("../supabase", () => ({ supabase: {} }));

// eslint-disable-next-line import/first
import { PAID_CHECKOUT_IN_PROGRESS_MESSAGE } from "../ticketCheckoutService";

test("the in-progress message names the real hold", () => {
  expect(PAID_CHECKOUT_IN_PROGRESS_MESSAGE).toContain("up to 15 minutes");
  expect(PAID_CHECKOUT_IN_PROGRESS_MESSAGE).not.toContain("about a minute");
  const edge = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "supabase", "functions", "ticket-checkout-create", "index.ts"),
    "utf8",
  );
  expect(edge).toContain("new Date(Date.now() + 15 * 60 * 1000).toISOString()");
});
