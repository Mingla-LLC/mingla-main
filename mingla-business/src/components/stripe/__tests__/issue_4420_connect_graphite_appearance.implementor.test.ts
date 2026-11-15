/**
 * #4420 — every Stripe Connect embedded component init passes the shared
 * Graphite appearance, so the payouts / onboarding / tax pages stop drawing
 * Stripe's default white surface. Client appearance only.
 *
 * FAILS-ON-REVERT: an init that goes back to `{ variables: { colorPrimary } }`
 * fails block 2; a light background or a translucent colour fails block 1.
 */
import fs from "fs";
import path from "path";

import { color } from "../../../constants/designSystem";
import { MINGLA_CONNECT_APPEARANCE } from "../connectAppearance";

const STRIPE = path.resolve(__dirname, "..");
const read = (p: string): string => fs.readFileSync(path.join(STRIPE, p), "utf8");

describe("#4420 Connect Graphite appearance", () => {
  test("1. dark surfaces from our tokens, opaque colours only", () => {
    const v = MINGLA_CONNECT_APPEARANCE.variables;
    expect(v.colorBackground).toBe(color.canvas);
    expect(v.colorText).toBe(color.text1);
    expect(v.buttonPrimaryColorBackground).toBe(color.paper);
    expect(v.buttonPrimaryColorText).toBe(color.ink);
    for (const [key, value] of Object.entries(v)) {
      if (!/color/i.test(key)) continue;
      expect([key, /^#[0-9a-f]{6}$/i.test(String(value))]).toEqual([key, true]);
    }
  });

  test("2. every init site uses the shared appearance", () => {
    const sites = [
      "connect-pages/ConnectAccountManagementBody.web.tsx",
      "connect-pages/ConnectOnboardingBody.web.tsx",
      "connect-pages/ConnectPartnerAccountManagementBody.web.tsx",
      "connect-pages/ConnectPartnerOnboardingBody.web.tsx",
      "connect-pages/ConnectTaxRegistrationsBody.web.tsx",
      "ConnectOnboardingNative.native.tsx",
    ];
    for (const site of sites) {
      const src = read(site);
      expect([site, src.includes("loadConnectAndInitialize")]).toEqual([site, true]);
      expect([site, src.includes("MINGLA_CONNECT_APPEARANCE")]).toEqual([site, true]);
      expect([site, /colorPrimary:/.test(src)]).toEqual([site, false]);
    }
  });

  test("3. the page chrome around the iframe is Graphite, not paper", () => {
    const helpers = read("connectEmbeddedPageHelpers.ts");
    const wrapper = helpers.slice(
      helpers.indexOf("export const pageWrapperStyle"),
      helpers.indexOf("};", helpers.indexOf("export const pageWrapperStyle")),
    );
    expect(wrapper).toContain("color.canvas");
    expect(wrapper).not.toContain("color.paper");
  });
});
