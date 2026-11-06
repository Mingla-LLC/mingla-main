/**
 * #4273 — buyers are opted in to the brand's updates; checkout tells them so
 * and no longer offers (or writes) an optional marketing box.
 *
 * Run: npx jest src/payments/__tests__/issue_4273_checkout_optin_notice.implementor.test.ts --maxWorkers=2
 *
 * fails-on-revert: restoring the "Send me occasional updates" box, its
 * `scopes: ["marketing"]` write, or a buyer-controlled marketingOptIn payload
 * fails these assertions.
 */

// MINGLA-INVARIANT: I-4273-CHECKOUT-SHOWS-OPTIN-NOTICE-NOT-A-BOX | issue #4273 | Every buyer-web checkout shows the plain opt-in notice, offers no marketing checkbox, writes only the transactional consent record, and sends marketingOptIn true.

import fs from "node:fs";
import path from "node:path";

import { CHECKOUT_MARKETING_NOTICE } from "../../constants/consentDisclosure";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const surfaces = [
  ["checkout/[eventId]"],
  ["checkout-trip/[tripEventId]"],
  ["checkout-experience/[experienceEventId]"],
].map(([route]) => ({
  route,
  buyer: read(`mingla-business/app/${route}/buyer.tsx`),
  payment: read(`mingla-business/app/${route}/payment.tsx`),
}));

describe("#4273 checkout opt-in notice", () => {
  test("the notice says the buyer gets this brand's updates by email and text and can unsubscribe", () => {
    expect(CHECKOUT_MARKETING_NOTICE).toBe(
      "By buying, you'll get updates from this brand by email and text. You can unsubscribe at any time.",
    );
  });

  test.each(surfaces)("$route shows the notice and no marketing box", ({ buyer }) => {
    expect(buyer).toContain("{CHECKOUT_MARKETING_NOTICE}");
    expect(buyer).toContain('testID="checkout-marketing-notice"');
    expect(buyer).not.toMatch(/toggleMarketing|CHECKOUT_MARKETING_LABEL|aria-checked=\{buyer\.marketingOptIn\}/);
  });

  test.each(surfaces)("$route writes the transactional record only", ({ buyer }) => {
    expect(buyer).toContain('scopes: ["transactional"]');
    expect(buyer).not.toContain('scopes: ["marketing"]');
    expect(buyer).not.toContain("CHECKOUT_MARKETING_DISCLOSURE_TEXT");
  });

  test.each(surfaces)("$route sends marketingOptIn true on the paid order", ({ payment }) => {
    expect(payment).toMatch(/marketingOptIn: true,/);
    expect(payment).not.toContain("marketingOptIn: buyer.marketingOptIn");
  });

  test("the cart sends marketingOptIn true on free orders and defaults it on", () => {
    const cart = read("mingla-business/src/components/checkout/CartContext.tsx");
    expect(cart).not.toContain("marketingOptIn: state.buyer.marketingOptIn");
    expect(cart).toMatch(/marketingOptIn: true, \/\/ #4273/);
  });
});
