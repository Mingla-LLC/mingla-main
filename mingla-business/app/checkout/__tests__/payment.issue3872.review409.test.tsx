import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..");

describe("#3872 checkout review on server 409", () => {
  test.each([
    ["event", "app/checkout/[eventId]/payment.tsx"],
    ["experience", "app/checkout-experience/[experienceEventId]/payment.tsx"],
    ["trip", "app/checkout-trip/[tripEventId]/payment.tsx"],
  ])("%s checkout renders and accepts only the revised server quote", (_kind, relative) => {
    const source = readFileSync(join(root, relative), "utf8");
    expect(source).toContain("ticketCheckoutReviewFromError");
    expect(source).toContain("setCheckoutReview(review)");
    expect(source).toContain("review={checkoutReview}");
    expect(source).toContain("const revisedQuote = checkoutReview.quote");
    expect(source).toContain("activeQuote.quoteDigest");
    expect(source).toContain("activeQuote.quoteListDigest");
    expect(source).toContain("activeQuote.buyerTotalCents");
  });
});
