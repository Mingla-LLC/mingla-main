import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "..", "CartContext.tsx"), "utf8");

describe("#3872 CartContext server quote authority", () => {
  test("stores the code, quote, quote status, and review without owning discount math", () => {
    expect(source).toContain('type: "SET_DISCOUNT_CODE"');
    expect(source).toContain('type: "SET_QUOTE_STATE"');
    expect(source).toContain('type: "SET_CHECKOUT_REVIEW"');
    expect(source).toContain("quote: action.quote");
    expect(source).toContain("checkoutReview: action.review");
    expect(source).not.toMatch(/useCartTotals/);
    expect(source).not.toMatch(/discount(?:Cents|Minor)\s*[+\-*\/]/);
  });

  test("reset removes every quote-derived value from the in-memory cart", () => {
    expect(source).toContain("discountCode: null");
    expect(source).toContain("quote: null");
    expect(source).toContain('quoteStatus: "idle"');
    expect(source).toContain("quoteErrorCode: null");
    expect(source).toContain("checkoutReview: null");
  });
});
