/**
 * issue #3281 — confirm/status order payloads carry orders.booked_start_at so
 * a successful provider-return reload can label the booking after the resume
 * payload is cleared.
 */
import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const confirmSrc = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
const statusSrc = await Deno.readTextFile(
  new URL("../../ticket-checkout-status/index.ts", import.meta.url),
);

Deno.test("#3281 confirm selects orders.booked_start_at for the paid payload", () => {
  assert(
    /select\(["']tax_amount_cents,\s*booked_start_at["']\)/.test(confirmSrc),
    "ticket-checkout-confirm must select booked_start_at with tax",
  );
  assert(
    confirmSrc.includes("bookedStartAt"),
    "ticket-checkout-confirm must return bookedStartAt on the order payload",
  );
});

Deno.test("#3281 status selects orders.booked_start_at for the paid payload", () => {
  assert(
    /select\(["']tax_amount_cents,\s*booked_start_at["']\)/.test(statusSrc),
    "ticket-checkout-status must select booked_start_at with tax",
  );
  assert(
    statusSrc.includes("bookedStartAt"),
    "ticket-checkout-status must return bookedStartAt on the order payload",
  );
});
