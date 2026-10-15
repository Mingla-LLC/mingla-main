/**
 * #3645 handoff item 5 — Host web card-rail Add bank must not use a popup.
 *
 * Web opens `/connect-account-management` same-tab with an HTTPS return_to;
 * Done honours that return. Native keeps openAuthSession + deep link.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  ACCOUNT_MANAGEMENT_NATIVE_RETURN,
  buildAccountManagementWebReturnUrl,
  isAllowedAccountManagementReturnTo,
  isSafeAccountManagementTargetUrl,
} from "../accountManagementOpen";

const businessRoot = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(businessRoot, relative), "utf8");

const BRAND = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("#3645 — accountManagementOpen helpers", () => {
  test("builds HTTPS Payments return on the page origin only", () => {
    expect(
      buildAccountManagementWebReturnUrl("https://host.usemingla.com", BRAND),
    ).toBe(`https://host.usemingla.com/brand/${BRAND}/payments`);
    expect(
      buildAccountManagementWebReturnUrl("http://host.usemingla.com", BRAND),
    ).toBeNull();
    expect(
      buildAccountManagementWebReturnUrl("https://host.usemingla.com", ""),
    ).toBeNull();
  });

  test("accepts only same-origin hosted account-management targets with a session", () => {
    const origin = "https://host.usemingla.com";
    expect(
      isSafeAccountManagementTargetUrl(
        `${origin}/connect-account-management?session=acs_test&brand_id=${BRAND}&return_to=x`,
        origin,
      ),
    ).toBe(true);
    expect(
      isSafeAccountManagementTargetUrl(
        `${origin}/connect-onboarding?session=acs_test`,
        origin,
      ),
    ).toBe(false);
    expect(
      isSafeAccountManagementTargetUrl(
        `https://evil.example/connect-account-management?session=acs_test`,
        origin,
      ),
    ).toBe(false);
    expect(
      isSafeAccountManagementTargetUrl(
        `${origin}/connect-account-management?brand_id=${BRAND}`,
        origin,
      ),
    ).toBe(false);
  });

  test("Done may follow deep links and same-origin HTTPS only", () => {
    const origin = "https://host.usemingla.com";
    expect(
      isAllowedAccountManagementReturnTo(ACCOUNT_MANAGEMENT_NATIVE_RETURN, origin),
    ).toBe(true);
    expect(
      isAllowedAccountManagementReturnTo(
        `${origin}/brand/${BRAND}/payments`,
        origin,
      ),
    ).toBe(true);
    expect(
      isAllowedAccountManagementReturnTo(
        "https://evil.example/brand/x/payments",
        origin,
      ),
    ).toBe(false);
    expect(isAllowedAccountManagementReturnTo("/brand/x/payments", origin)).toBe(
      false,
    );
  });
});

describe("#3645 — Host web Add bank open path (source)", () => {
  test("Payments and onboard Add bank same-tab assign when HTTPS return builds", () => {
    const payments = read("src/components/brand/BrandPaymentsView.tsx");
    const onboard = read("src/components/brand/BrandOnboardView.tsx");
    for (const source of [payments, onboard]) {
      expect(source).toContain("buildAccountManagementWebReturnUrl");
      expect(source).toContain("isSafeAccountManagementTargetUrl");
      expect(source).toContain("window.location.assign(result.targetUrl)");
      expect(source).toContain("webReturnUrl !== null");
      expect(source).toContain("returnUrl: webReturnUrl");
    }
  });

  test("hosted account-management Done honours HTTPS return_to via assign", () => {
    const body = read(
      "src/components/stripe/connect-pages/ConnectAccountManagementBody.web.tsx",
    );
    expect(body).toContain("isAllowedAccountManagementReturnTo");
    expect(body).toContain("window.location.assign(returnTo)");
    expect(body).not.toMatch(
      /returnTo\.startsWith\("mingla-business:\/\/"\)\s*\)\s*\{\s*window\.location\.href/,
    );
  });

  test("service forwards return_url when provided", () => {
    const service = read("src/services/brandStripeAccountSessionService.ts");
    expect(service).toContain("return_url: returnUrl");
  });
});
