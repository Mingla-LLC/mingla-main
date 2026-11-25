// [TEST-MOD-APPROVED #2331] #2769 hid the venue reserve bar under 1280px while
// the consent card was unresolved. #2331 retires that fork: the privacy bar
// is one full-width row the app root ends above (I-PRIVACY-BAR-NEVER-OCCLUDES),
// so the reserve bar always shows and nothing reads consent to lay out.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

import { usePrivacyState } from "../usePrivacyState";

const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

const business = path.resolve(__dirname, "../../..");
const repository = path.resolve(business, "..");
const read = (file: string): string =>
  readFileSync(path.join(repository, file), "utf8");

describe("#2331 privacy bar / reserve composition", () => {
  test("the public venue route no longer threads a consent snapshot into the renderer", () => {
    const route = read("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx");
    expect(route).not.toContain("useWebConsentState");
    expect(route).not.toContain("webConsentState");
    expect(existsSync(path.join(business, "src/analytics/useWebConsentState.ts"))).toBe(false);
    expect(existsSync(path.join(business, "src/analytics/useWebConsentState.web.ts"))).toBe(false);
  });

  test("the shared renderer always shows the persistent reserve action", () => {
    const screen = read("packages/brand-rendering/PublicVenueScreen.tsx");
    // [TEST-MOD-APPROVED #4420 D-V2] — still no consent gate: the one added
    // condition is the ordering basket owning the bottom edge on the Menu tab.
    // [TEST-MOD-APPROVED #4490] fix 2 (N87): the bar also speaks for another booking tab only,
    // never behind a consent gate; the composition is still just these conditions.
    expect(screen).toContain(
      "const showPersistentReserveCta =\n    showReserveCta &&\n    !activeIsOtherBookingTab &&\n    !(orderingOwnsBar && normalizedReservationUiState.activeTab === \"menu\");",
    );
    expect(screen).not.toContain("consentActionMayCollide");
    expect(screen).not.toContain("PUBLIC_VENUE_CONSENT_SAFE_DESKTOP_MIN_WIDTH");
    expect(screen).not.toContain("webConsentState");
  });

  test("native resolves the privacy hook to a saved, inert state", () => {
    function Probe(): React.ReactElement {
      const privacy = usePrivacyState();
      return React.createElement(
        "span",
        { "data-saved": String(privacy.saved), "data-analytics": String(privacy.analytics) },
        "probe",
      );
    }
    const markup = renderToStaticMarkup(React.createElement(Probe));
    expect(markup).toContain('data-saved="true"');
    expect(markup).toContain('data-analytics="false"');
  });

  // [TEST-MOD-APPROVED #2331] The strip's band is a CSS constant; nothing measures it.
  test("the bar reads the one privacy owner, owns a constant band, and has no floating pill", () => {
    const banner = read("mingla-business/src/analytics/ConsentBanner.web.tsx");
    expect(banner).toContain("const privacy = usePrivacyState();");
    expect(banner).toContain(":root{--mingla-privacy-strip:calc(28px + env(safe-area-inset-bottom,0px))}");
    // The app root is the fixed box that ends at the strip's top edge (the
    // reserve action rises with it) and scrolls a screen that no longer fits;
    // no rule styles the root's children.
    expect(banner).toContain("html:has(style#expo-reset) #root{position:fixed;top:0;left:0;right:0;bottom:var(--mingla-privacy-strip);");
    // The only rule on the root's child lets a too-tall screen scroll in it.
    expect(banner.match(/#root>/g)).toHaveLength(1);
    // A document the app owns does not pad the body (the box already ends at the strip).
    expect(banner).toContain("html:has(style#expo-reset) body{padding-bottom:0}");
    expect(banner).not.toContain("ResizeObserver");
    expect(banner).not.toContain("choiceLinkHost");
    expect(banner).not.toContain("Ad privacy choices");
    expect(banner).not.toContain("readStoredConsent");
  });
});
