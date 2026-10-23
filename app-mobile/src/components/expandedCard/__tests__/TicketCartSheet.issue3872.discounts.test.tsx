import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "..", "TicketCartSheet.tsx"), "utf8");

describe("#3872 Explorer cart discount contract", () => {
  test("renders totals and line money only from the server quote", () => {
    for (const needle of [
      "quote.lines.map",
      "line.lineListCents",
      "line.lineNetCents",
      "quote.discounts.map",
      "discount.amountMinor",
      "quote.buyerTotalCents",
      "quoteDigest: acceptedQuote.quoteDigest",
      "quoteListDigest: acceptedQuote.quoteListDigest",
    ]) {
      expect(source).toContain(needle);
    }
    expect(source).not.toMatch(/price(?:AllIn)?Gbp\s*\*/);
  });

  test("keeps code feedback, retry, and both sale-limited choices", () => {
    for (const needle of [
      'codeOutcome?.status === "applied"',
      'codeOutcome?.status === "rejected"',
      'quoteQuery.error.message === "rate_limited"',
      "saleLimitedCopy(name, notice.remaining)",
      'choice: "reduce"',
      'choice: "keep"',
      'terminalOutcome?.outcome === "review"',
    ]) {
      expect(source).toContain(needle);
    }
  });
});
