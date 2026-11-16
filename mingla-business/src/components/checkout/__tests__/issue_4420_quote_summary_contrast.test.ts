/**
 * #4420 journey — the checkout order summary showed "$35.00 →" and nothing
 * else: the discounted amount, the fees line and the whole total row were
 * invisible on the dark checkout card.
 *
 * Root cause: the token migration mapped the old dark-ink hexes for amounts
 * and the total to SURFACE tokens (`color.card`, `color.card3`). Every caller
 * mounts TicketQuoteSummary inside the dark Graphite checkout card, so the
 * text matched its own background.
 *
 * FAILS ON REVERT: an amount, the total label or the total value goes back to
 * a surface token.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const src = readFileSync(join(__dirname, "../TicketQuoteSummary.tsx"), "utf8");

const styleBlock = (name: string): string => {
  const start = src.indexOf(`  ${name}: {`);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf("}", start) + 1);
};

describe("#4420 journey — quote summary text is readable on the checkout card", () => {
  test.each(["value", "totalLabel", "totalValue"])("%s uses a text token", (name) => {
    const block = styleBlock(name);
    expect(block).toMatch(/color: color\.text1\b/);
    expect(block).not.toMatch(/color: color\.card\d?\b/);
  });

  test("no text style in the summary paints with a surface token", () => {
    for (const name of ["label", "value", "struckMoney", "discountLabel", "discountValue", "totalLabel", "totalValue"]) {
      expect(styleBlock(name)).not.toMatch(/\bcolor: color\.(card|card2|card3|canvas)\b/);
    }
  });
});
