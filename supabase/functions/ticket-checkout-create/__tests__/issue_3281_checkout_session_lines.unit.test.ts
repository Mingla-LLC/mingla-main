/**
 * issue #3281 — a uniform multi-date web cart must match its session, or
 * contract v2 sends the buyer back to review forever.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { expectedSessionLineQuantity } from "../checkoutSessionLines.ts";

const perDay = (dayCount: number) => ({ dayCount, pricingMode: "per_day" });

Deno.test("a uniform per-day line holds one unit per chosen date", () => {
  assertEquals(expectedSessionLineQuantity({ quantity: 1 }, perDay(3)), 3);
  assertEquals(expectedSessionLineQuantity({ quantity: 2 }, perDay(3)), 6);
});

Deno.test("a missing pricing snapshot follows the database's per-day default", () => {
  assertEquals(
    expectedSessionLineQuantity({ quantity: 2 }, {
      dayCount: 2,
      pricingMode: null,
    }),
    4,
  );
});

Deno.test("single-date and dateless lines keep the requested quantity", () => {
  assertEquals(expectedSessionLineQuantity({ quantity: 2 }, perDay(1)), 2);
  assertEquals(expectedSessionLineQuantity({ quantity: 2 }, perDay(0)), 2);
});

Deno.test("an all-days pass is one unit whatever the dates", () => {
  assertEquals(
    expectedSessionLineQuantity({ quantity: 2 }, {
      dayCount: 3,
      pricingMode: "all_days",
    }),
    2,
  );
});

Deno.test("a by-date line already states its total", () => {
  assertEquals(
    expectedSessionLineQuantity(
      { quantity: 3, byDate: { a: 2, b: 1 } },
      perDay(3),
    ),
    3,
  );
});

Deno.test("the edge compares and binds session units, not the raw request", () => {
  const source = Deno.readTextFileSync(
    new URL("../index.ts", import.meta.url),
  );
  assertEquals(
    source.includes("expectedSessionLineQuantity(requested, sessionDayScope)"),
    true,
  );
  assertEquals(source.includes("p_lines: checkoutV2Lines"), false);
});
