/**
 * #4273 — Explorer checkout tells the buyer they are opted in, in the same
 * words as buyer web, and every checkout payload says so.
 *
 * Run: npx jest src/components/expandedCard/__tests__/issue_4273_checkout_optin_notice.test.ts --maxWorkers=2
 *
 * fails-on-revert: removing the notice from TicketCartSheet, drifting its
 * words from mingla-business, or restoring a buyer-controlled marketingOptIn
 * in nativeCheckoutFlow fails these assertions.
 */

// MINGLA-INVARIANT: I-4273-EXPLORER-CHECKOUT-OPTIN-NOTICE-PARITY | issue #4273 | Explorer checkout shows the same opt-in notice as buyer web and always sends marketingOptIn true.

import { readFileSync } from "fs";
import path from "path";

import { CHECKOUT_MARKETING_NOTICE } from "../../../constants/consentDisclosure";

const appRoot = path.resolve(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(path.join(appRoot, rel), "utf8");

describe("#4273 Explorer checkout opt-in notice", () => {
  it("uses Seth's exact words", () => {
    expect(CHECKOUT_MARKETING_NOTICE).toBe(
      "By buying, you'll get updates from this brand and Mingla by email and text. You can unsubscribe at any time.",
    );
  });

  it("matches the buyer-web notice word for word", () => {
    const business = read("../mingla-business/src/constants/consentDisclosure.ts");
    expect(business).toContain(JSON.stringify(CHECKOUT_MARKETING_NOTICE));
  });

  it("renders the notice in the cart sheet, with no marketing box", () => {
    const cart = read("src/components/expandedCard/TicketCartSheet.tsx");
    expect(cart).toContain("{CHECKOUT_MARKETING_NOTICE}");
    expect(cart).toContain('testID="checkout-marketing-notice"');
    expect(cart).not.toMatch(/setMarketingOptIn|toggleMarketing/);
  });

  it("every native checkout payload sends marketingOptIn true", () => {
    const flow = read("src/payments/nativeCheckoutFlow.ts");
    expect(flow).not.toContain("marketingOptIn: input.buyer.marketingOptIn");
    expect((flow.match(/marketingOptIn: true,/g) ?? []).length).toBe(2);
  });
});
