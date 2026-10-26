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
    expect(screen).toContain("const showPersistentReserveCta = showReserveCta;");
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

  test("the bar reads the one privacy owner, writes the inset, and has no floating pill", () => {
    const banner = read("mingla-business/src/analytics/ConsentBanner.web.tsx");
    expect(banner).toContain("const privacy = usePrivacyState();");
    expect(banner).toContain("--mingla-privacy-inset");
    // The app root ends at the bar's top edge and, while the bar shows, scrolls
    // a screen that no longer fits; the floor never applies to the bar or toast.
    expect(banner).toContain("#root{box-sizing:border-box;height:calc(100% - var(${PRIVACY_INSET_PROPERTY},0px))}");
    expect(banner).toContain('html[data-mingla-privacy-bar="shown"] #root{overflow-y:auto;overscroll-behavior:contain}');
    expect(banner).toContain(
      'html[data-mingla-privacy-bar="shown"] #root>:not(.mpb):not(.mpb-toast){flex-shrink:0;min-height:calc(100vh - 53px - env(safe-area-inset-bottom,0px));min-height:calc(100dvh - 53px - env(safe-area-inset-bottom,0px))}',
    );
    expect(banner).not.toContain("padding-bottom:var(${PRIVACY_INSET_PROPERTY},0px)");
    expect(banner).toContain("new ResizeObserver(measure)");
    expect(banner).not.toContain("choiceLinkHost");
    expect(banner).not.toContain("Ad privacy choices");
    expect(banner).not.toContain("readStoredConsent");
  });
});
