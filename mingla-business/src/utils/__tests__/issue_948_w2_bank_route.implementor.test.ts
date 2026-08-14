import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildBankConnectWebReturnUrl,
  isSameOriginConnectOnboardingUrl,
  startStripeWebBankConnect,
} from "../bankConnectFunnel";
import { resolveBankConnectRail } from "../bankConnectRail";

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abc";
const USER_ID = "79f45786-2222-4b33-8444-123456789abc";
const ORIGIN = "https://host.usemingla.com";
const ONBOARDING_URL =
  `${ORIGIN}/connect-onboarding?session=acct_session_secret&brand_id=${BRAND_ID}`;

describe("#948 W2 implementor — bank-first web happy path", () => {
  test("records Mingla terms before minting and then performs one same-tab assignment", async () => {
    const calls: string[] = [];
    const acceptTerms = jest.fn(async () => {
      calls.push("terms");
      return { accepted: true };
    });
    const mintOnboarding = jest.fn(async () => {
      calls.push("mint");
      return { onboarding_url: ONBOARDING_URL };
    });
    const assign = jest.fn((_url: string) => {
      calls.push("assign");
    });

    await expect(
      startStripeWebBankConnect({
        brandId: BRAND_ID,
        userId: USER_ID,
        country: "US",
        origin: ORIGIN,
        tosVersion: "v3-pre-launch-placeholder",
        acceptTerms,
        mintOnboarding,
        assign,
      }),
    ).resolves.toBe(ONBOARDING_URL);

    expect(calls).toEqual(["terms", "mint", "assign"]);
    expect(acceptTerms).toHaveBeenCalledWith({
      brandId: BRAND_ID,
      userId: USER_ID,
      version: "v3-pre-launch-placeholder",
    });
    expect(mintOnboarding).toHaveBeenCalledWith({
      brandId: BRAND_ID,
      country: "US",
      returnUrl: `${ORIGIN}/brand/${BRAND_ID}/payments`,
    });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      expect.stringContaining("/connect-onboarding?session="),
    );
  });

  test("rejects a non-Connect or cross-origin mint result before navigation", async () => {
    const assign = jest.fn();
    await expect(
      startStripeWebBankConnect({
        brandId: BRAND_ID,
        userId: USER_ID,
        country: "GB",
        origin: ORIGIN,
        tosVersion: "v3-pre-launch-placeholder",
        acceptTerms: async () => ({ accepted: true }),
        mintOnboarding: async () => ({
          onboarding_url:
            "https://example.com/connect-onboarding?session=stolen",
        }),
        assign,
      }),
    ).rejects.toThrow("unexpected bank setup link");
    expect(assign).not.toHaveBeenCalled();
  });

  test("builds the same-origin HTTPS payments return and rejects insecure origins", () => {
    expect(buildBankConnectWebReturnUrl(ORIGIN, BRAND_ID)).toBe(
      `${ORIGIN}/brand/${BRAND_ID}/payments`,
    );
    expect(() =>
      buildBankConnectWebReturnUrl("http://host.usemingla.com", BRAND_ID)
    ).toThrow("secure HTTPS");
  });

  test("accepts only the existing same-origin session-bearing Connect form", () => {
    expect(isSameOriginConnectOnboardingUrl(ONBOARDING_URL, ORIGIN)).toBe(true);
    expect(
      isSameOriginConnectOnboardingUrl(
        `${ORIGIN}/connect-onboarding`,
        ORIGIN,
      ),
    ).toBe(false);
    expect(
      isSameOriginConnectOnboardingUrl(
        `${ORIGIN}/connect-onboarding-evil?session=x`,
        ORIGIN,
      ),
    ).toBe(false);
  });
});

describe("#948 W2 implementor — rail pre-resolution", () => {
  test("NG country or Paystack provider enters the Nigeria form directly", () => {
    expect(resolveBankConnectRail({ countryCode: " ng " })).toEqual({
      provider: "paystack",
      countryCode: "NG",
      displayName: "Nigeria",
      currency: "NGN",
    });
    expect(
      resolveBankConnectRail({
        countryCode: "US",
        paymentProvider: "PAYSTACK",
      }),
    ).toEqual({
      provider: "paystack",
      countryCode: "NG",
      displayName: "Nigeria",
      currency: "NGN",
    });
  });

  test("supported Stripe brand country drives the confirm country and currency", () => {
    expect(
      resolveBankConnectRail({
        countryCode: "us",
        paymentProvider: "stripe",
      }),
    ).toEqual({
      provider: "stripe",
      countryCode: "US",
      displayName: "United States",
      currency: "USD",
    });
  });

  test.each([null, undefined, "", "ZZ", "Australia"])(
    "absent or unsupported country %p fails safely to GB",
    (countryCode) => {
      expect(resolveBankConnectRail({ countryCode })).toEqual({
        provider: "stripe",
        countryCode: "GB",
        displayName: "United Kingdom",
        currency: "GBP",
      });
    },
  );
});

describe("#948 W2 implementor — production route wiring", () => {
  const routeShellSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "app",
      "brand",
      "[id]",
      "connect.web.tsx",
    ),
    "utf8",
  );
  const routeBodySource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "brand",
      "BrandBankConnectBody.web.tsx",
    ),
    "utf8",
  );
  const routeSource = `${routeShellSource}\n${routeBodySource}`;
  const nativeRouteSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "app",
      "brand",
      "[id]",
      "connect.tsx",
    ),
    "utf8",
  );
  const existingOnboardSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "brand",
      "BrandOnboardView.tsx",
    ),
    "utf8",
  );
  const countryPickerSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "brand",
      "BrandStripeCountryPicker.tsx",
    ),
    "utf8",
  );

  test("new route renders Paystack directly and the payout confirm-row Change affordance", () => {
    expect(routeSource).toContain(
      'selectedProvider === "paystack"',
    );
    expect(routeSource).toContain("<BrandPaystackOnboardView");
    expect(routeSource).toContain('presentation="payout-confirm"');
    expect(countryPickerSource).toContain('"PAYOUTS IN"');
    expect(countryPickerSource).toContain('"Change"');
  });

  test("new route uses clickwrap orchestration without the blocking terms gate", () => {
    expect(routeSource).toContain("startStripeWebBankConnect({");
    expect(routeSource).toContain("CURRENT_MINGLA_TOS_VERSION");
    expect(routeSource).toContain("By connecting your bank you agree");
    expect(routeSource).not.toContain("MinglaToSAcceptanceGate");
  });

  test("route shell lazily loads the full body while native redirects to the legacy owner", () => {
    expect(routeShellSource).toContain("React.lazy(");
    expect(routeShellSource).toContain(
      'import("../../../src/components/brand/BrandBankConnectBody.web")',
    );
    expect(routeShellSource).toContain("<Suspense");
    expect(routeShellSource).toContain("<ConnectLoadingFallback />");
    expect(routeShellSource).not.toContain("useStartBrandStripeOnboarding");
    expect(routeShellSource).not.toContain("BrandPaystackOnboardView");
    expect(routeBodySource).not.toContain(
      'from "../../hooks/useStartBrandStripeOnboarding"',
    );
    expect(routeBodySource).toContain(
      "startBrandStripeOnboarding(brandId, returnUrl, country)",
    );
    expect(routeBodySource).toContain(
      "brandStripeStatusKeys.detail(brandId)",
    );
    expect(routeBodySource).toContain("brandKeys.detail(brandId)");
    expect(routeBodySource).toContain("brandKeys.lists()");

    expect(nativeRouteSource).toContain("<Redirect");
    expect(nativeRouteSource).toContain(
      "/brand/${encodeURIComponent(brandId)}/payments/onboard",
    );
    expect(nativeRouteSource).toContain('href="/(tabs)/account"');
    expect(nativeRouteSource).not.toContain(
      'export { default } from "./payments/onboard"',
    );
  });

  test("existing BrandOnboardView splits web same-tab handoff from unchanged native auth-session handoff", () => {
    expect(existingOnboardSource).toContain('Platform.OS === "web"');
    expect(existingOnboardSource).toContain(
      "buildLegacyWebReturnUrl(window.location.origin, brand.id)",
    );
    expect(existingOnboardSource).toContain(
      "window.location.assign(result.onboarding_url)",
    );
    expect(existingOnboardSource).toMatch(
      /WebBrowser\.openAuthSessionAsync\(\s*result\.onboarding_url,\s*RETURN_DEEP_LINK,\s*\)/,
    );
    expect(existingOnboardSource).toContain(
      'parsed.pathname === "/connect-onboarding"',
    );
    expect(existingOnboardSource).toContain(
      'parsed.origin === origin.origin',
    );
    expect(existingOnboardSource).not.toContain(
      'from "../../utils/bankConnectFunnel"',
    );
  });
});
