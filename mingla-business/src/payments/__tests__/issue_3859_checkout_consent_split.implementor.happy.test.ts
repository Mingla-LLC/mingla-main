import fs from "node:fs";
import path from "node:path";

const invoke = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invoke(...args),
    },
  },
}));

import { recordConsent } from "../../services/consentService";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const disclosure = read("mingla-business/src/constants/consentDisclosure.ts");
const cartContext = read("mingla-business/src/components/checkout/CartContext.tsx");
const buyerRoutes = [
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
  "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
].map((file) => ({ file, source: read(file) }));

describe("#3859 buyer-web checkout consent split", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { ok: true, inserted: 1, deduped: 0 },
      error: null,
    });
  });

  test("executes the real consent client with a transactional-only purchase grant", async () => {
    const result = await recordConsent({
      source: "checkout",
      disclosureText: "Purchase disclosure",
      disclosureVersion: "2026-10-14-purchase-v1",
      scopes: ["transactional"],
      email: "buyer@example.test",
      phone: "+15555550123",
    });

    expect(result).toEqual({ ok: true, inserted: 1, deduped: 0 });
    expect(invoke).toHaveBeenCalledWith("record-consent", {
      body: expect.objectContaining({
        source: "checkout",
        scopes: ["transactional"],
      }),
    });
  });

  test("pins the approved purchase and optional-marketing words independently", () => {
    expect(disclosure).toContain(
      '"I agree to Mingla’s Terms of Service and Privacy Policy."',
    );
    expect(disclosure).toContain('"2026-10-14-purchase-v1"');
    expect(disclosure).toContain(
      '"Send me occasional updates and offers from Mingla and this host."',
    );
    expect(disclosure).toContain(
      '"Optional. You can unsubscribe at any time."',
    );
    expect(disclosure).toContain('"2026-10-14-marketing-v1"');
  });

  test("keeps anonymous marketing off until its own affirmative act", () => {
    expect(cartContext).toMatch(/marketingOptIn:\s*false/);
    expect(cartContext).toMatch(/termsAccepted:\s*false/);
    for (const { source } of buyerRoutes) {
      expect(source).toContain("setBuyer({ termsAccepted: next })");
      expect(source).toContain(
        "setBuyer({ marketingOptIn: !buyer.marketingOptIn })",
      );
      expect(source).not.toMatch(
        /setBuyer\(\{\s*termsAccepted:[^}]*marketingOptIn:/,
      );
    }
  });

  test("records purchase and optional marketing under separate scopes", () => {
    for (const { source } of buyerRoutes) {
      expect(source).toContain("PURCHASE_TERMS_DISCLOSURE_TEXT");
      expect(source).toContain('scopes: ["transactional"]');
      expect(source).toContain("CHECKOUT_MARKETING_DISCLOSURE_TEXT");
      expect(source).toContain('scopes: ["marketing"]');
      expect(source).toMatch(/if \(buyer\.marketingOptIn\) \{/);
      expect(source).not.toContain("CONSENT_VISIBLE_FOLLOW_BEFORE");
    }
  });

  test("emits two accessible, independently checked controls", () => {
    for (const { source } of buyerRoutes) {
      expect(source).toContain(
        "accessibilityState={{ checked: termsAccepted, disabled: !authReady }}",
      );
      expect(source).toContain("aria-checked={termsAccepted}");
      expect(source).toContain("checked: buyer.marketingOptIn");
      expect(source).toContain("aria-checked={buyer.marketingOptIn}");
      expect(source).toContain("PURCHASE_TERMS_URL");
      expect(source).toContain("PURCHASE_PRIVACY_URL");
      expect(source.match(/event\.stopPropagation\(\)/g)).toHaveLength(2);
    }
  });
});
