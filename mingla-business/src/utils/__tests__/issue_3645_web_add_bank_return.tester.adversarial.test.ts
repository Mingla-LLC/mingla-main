/**
 * #3645 handoff item 5 — adversarial: web must not popup; edge must refuse
 * foreign return_url; Done must not assign cross-origin HTTPS.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

import { isAllowedAccountManagementReturnTo } from "../accountManagementOpen";

const businessRoot = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(businessRoot, relative), "utf8");
const edge = fs.readFileSync(
  path.resolve(
    businessRoot,
    "../supabase/functions/brand-stripe-account-session/index.ts",
  ),
  "utf8",
);

describe("#3645 — web Add bank return (tester adversarial)", () => {
  test("HTTPS same-tab branch assigns before any openAuthSessionAsync call", () => {
    for (const relative of [
      "src/components/brand/BrandPaymentsView.tsx",
      "src/components/brand/BrandOnboardView.tsx",
    ]) {
      const source = read(relative);
      const httpsBranch = source.indexOf("webReturnUrl !== null");
      expect(httpsBranch).toBeGreaterThan(-1);
      const assignIdx = source.indexOf(
        "window.location.assign(result.targetUrl)",
        httpsBranch,
      );
      expect(assignIdx).toBeGreaterThan(httpsBranch);
      const popupIdx = source.indexOf("openAuthSessionAsync", httpsBranch);
      // Popup path must come AFTER the same-tab return (native fallback).
      expect(popupIdx).toBeGreaterThan(assignIdx);
    }
  });

  test("edge validates return_url and defaults to the native deep link", () => {
    expect(edge).toContain("function isValidReturnUrl");
    expect(edge).toContain("return_url_invalid_scheme");
    expect(edge).toContain(
      'const NATIVE_RETURN_DEEP_LINK = "mingla-business://onboarding-complete"',
    );
    expect(edge).toContain("returnTo,");
    // Must not hardcode the deep link as the only buildTargetUrl argument.
    expect(edge).not.toMatch(
      /returnTo:\s*"mingla-business:\/\/onboarding-complete"/,
    );
  });

  test("cross-origin HTTPS return_to is refused by Done helper", () => {
    expect(
      isAllowedAccountManagementReturnTo(
        "https://phish.example/brand/x/payments",
        "https://host.usemingla.com",
      ),
    ).toBe(false);
  });
});
