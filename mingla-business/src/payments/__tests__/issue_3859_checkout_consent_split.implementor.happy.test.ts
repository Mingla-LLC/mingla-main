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

  test("pins the approved purchase words; #4273 replaces the marketing box with a notice", () => {
    expect(disclosure).toContain(
      '"I agree to Mingla’s Terms of Service and Privacy Policy."',
    );
    expect(disclosure).toContain('"2026-10-14-purchase-v1"');
    expect(disclosure).not.toContain("Send me occasional updates");
    expect(disclosure).toContain("CHECKOUT_MARKETING_NOTICE");
  });

  test("terms stay their own affirmative act; buying opts in to marketing", () => {
    expect(cartContext).toMatch(/termsAccepted:\s*false/);
    expect(cartContext).toMatch(/marketingOptIn:\s*true/);
    for (const { source } of buyerRoutes) {
      expect(source).toContain("setBuyer({ termsAccepted: next })");
      expect(source).not.toContain("marketingOptIn");
    }
  });

  test("records only the purchase grant at checkout", () => {
    for (const { source } of buyerRoutes) {
      expect(source).toContain("PURCHASE_TERMS_DISCLOSURE_TEXT");
      expect(source).toContain('scopes: ["transactional"]');
      expect(source).not.toContain('scopes: ["marketing"]');
      expect(source).not.toContain("CONSENT_VISIBLE_FOLLOW_BEFORE");
    }
  });

  test("emits one accessible terms control and the plain opt-in notice", () => {
    for (const { source } of buyerRoutes) {
      expect(source).toContain(
        "accessibilityState={{ checked: termsAccepted, disabled: !authReady }}",
      );
      expect(source).toContain("aria-checked={termsAccepted}");
      expect(source).toContain('testID="checkout-marketing-notice"');
      expect(source).toContain("PURCHASE_TERMS_URL");
      expect(source).toContain("PURCHASE_PRIVACY_URL");
      expect(source.match(/event\.stopPropagation\(\)/g)).toHaveLength(2);
    }
  });
});
