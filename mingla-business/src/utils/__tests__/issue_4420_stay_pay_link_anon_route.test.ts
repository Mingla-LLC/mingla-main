/**
 * issue #4420 — /stay/pay/{token} is a token-authorized guest payment page.
 * A logged-out guest on web must reach it (no sign-in wall), the Stay
 * reservation page itself stays signed-in, and the link never boots buyer ad
 * pixels. Behaviour only: every assertion calls the real route gates.
 */
import {
  isAdPixelRoute,
  isPublicBuyerRoute,
  shouldRedirectToSignInFromRoute,
} from "../coldLoadAuthGates";

const loggedOutWeb = {
  isWeb: true,
  loading: false,
  hasUser: false,
  hasStoredWebSession: false,
};

describe("#4420 Stay pay link is an anonymous route", () => {
  test.each([
    "/stay/pay/abc123",
    "/stay/pay/abc123/",
    "/stay/pay/abc123?payment=returned".split("?")[0],
  ])("a logged-out guest on %s is not sent to sign-in", (pathname) => {
    expect(isPublicBuyerRoute(pathname)).toBe(true);
    expect(shouldRedirectToSignInFromRoute({ ...loggedOutWeb, pathname })).toBe(false);
  });

  test("the Stay reservation page and look-alike paths still need sign-in", () => {
    for (const pathname of ["/stay/1b0c6f1e-0000-4000-8000-000000000001", "/stay/payments", "/stay"]) {
      expect(isPublicBuyerRoute(pathname)).toBe(false);
      expect(shouldRedirectToSignInFromRoute({ ...loggedOutWeb, pathname })).toBe(true);
    }
  });

  test("the pay link is not a buyer ad-pixel route", () => {
    expect(isAdPixelRoute("/stay/pay/abc123")).toBe(false);
  });
});
