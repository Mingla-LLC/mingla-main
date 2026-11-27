// MINGLA-INVARIANT: I-4624-21 | issue #4624 | ticket-checkout-create normalises basket lines before pricing or holding: one line per ticket type, merged only when the copies differ in quantities alone, otherwise refused as checkout_lines_duplicate.
// #4624 — normalise basket lines. Unit tests for basketLines.ts and a
// structural pin on index.ts.
// FAILS ON REVERT: drop the normaliseBasketLines call (or the merge) and the
// structural and merge tests go red.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normaliseBasketLines } from "../basketLines.ts";

const SRC = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
const GA = "11111111-1111-4111-8111-111111111111";
const VIP = "22222222-2222-4222-8222-222222222222";

Deno.test("#4624 the same ticket type twice is merged into one line", () => {
  const result = normaliseBasketLines([
    { ticketTypeId: GA, quantity: 3 },
    { ticketTypeId: VIP, quantity: 1 },
    { ticketTypeId: GA, quantity: 3 },
  ]);
  assertEquals(result, {
    ok: true,
    lines: [{ ticketTypeId: GA, quantity: 6 }, { ticketTypeId: VIP, quantity: 1 }],
  });
});

Deno.test("#4624 dated copies merge per date", () => {
  const result = normaliseBasketLines([
    { ticketTypeId: GA, quantity: 2, byDate: { d1: 1, d2: 1 } },
    { ticketTypeId: GA, quantity: 3, byDate: { d2: 2, d3: 1 } },
  ]);
  assertEquals(result, {
    ok: true,
    lines: [{ ticketTypeId: GA, quantity: 5, byDate: { d1: 1, d2: 3, d3: 1 } }],
  });
});

Deno.test("#4624 copies that disagree on anything but quantity are refused", () => {
  const refused = { ok: false, error: "checkout_lines_duplicate" } as const;
  assertEquals(
    normaliseBasketLines([
      { ticketTypeId: GA, quantity: 1, paymentPlanChoice: "full" },
      { ticketTypeId: GA, quantity: 1, paymentPlanChoice: "installments" },
    ]),
    refused,
  );
  assertEquals(
    normaliseBasketLines([
      { ticketTypeId: GA, quantity: 1, byDate: { d1: 1 } },
      { ticketTypeId: GA, quantity: 1 },
    ]),
    refused,
  );
  const addOns = [{ addOnId: "a1", quantity: 1 }];
  assertEquals(
    normaliseBasketLines([
      { ticketTypeId: GA, quantity: 1, addOns },
      { ticketTypeId: GA, quantity: 1, addOns },
    ]),
    refused,
  );
});

Deno.test("#4624 a basket with no repeats is unchanged", () => {
  const lines = [
    { ticketTypeId: GA, quantity: 2, paymentPlanChoice: "full" },
    { ticketTypeId: VIP, quantity: 1, paymentPlanChoice: "full" },
  ];
  assertEquals(normaliseBasketLines(lines), { ok: true, lines });
});

Deno.test("#4624 index.ts normalises every non-v2 basket before the quote and the session", () => {
  const normaliseAt = SRC.indexOf("const basket = normaliseBasketLines(");
  assert(normaliseAt > 0, "normaliseBasketLines call missing");
  assert(SRC.includes("const lines = checkoutV2Lines ?? basket.lines;"));
  assert(SRC.includes('return jsonResponse({ error: basket.error }, 400);'));
  for (const later of [
    '"biz_ticket_checkout_create_session"',
    '"issue_4271_door_checkout_create_session"',
    '"biz_ticket_link_checkout_create_session"',
    'p_lines: rpcLines,',
  ]) {
    const at = SRC.indexOf(later);
    assert(at > normaliseAt, `${later} runs before the basket is normalised`);
  }
  assert(SRC.includes('sessionError?.message?.includes("checkout_lines_duplicate")'));
});
