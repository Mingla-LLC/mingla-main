import { readFileSync } from "node:fs";
import path from "node:path";

const business = path.resolve(__dirname, "../../..");
const repository = path.resolve(business, "..");
const read = (file: string): string =>
  readFileSync(path.join(repository, file), "utf8");

describe("issue #2769 consent/reserve production bridge", () => {
  test("the public route consumes one canonical hook and passes only its snapshot", () => {
    const route = read("mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx");
    expect(route).toContain('import { useWebConsentState } from "../../../../src/analytics/useWebConsentState";');
    expect(route).toContain("const webConsentState = useWebConsentState();");
    expect(route).toContain("webConsentState={webConsentState}");
    expect(route).not.toContain("localStorage");
  });

  test("the shared renderer semantically omits the persistent action below 1280", () => {
    const screen = read("packages/brand-rendering/PublicVenueScreen.tsx");
    expect(screen).toContain("PUBLIC_VENUE_CONSENT_SAFE_DESKTOP_MIN_WIDTH = 1280");
    expect(screen).toContain("const showPersistentReserveCta = showReserveCta && !consentActionMayCollide;");
    expect(screen).toContain("showPersistentReserveCta && !isDesktop");
    expect(screen).toContain("{showPersistentReserveCta ? reserveCta : null}");
  });

  test("native resolves to a no-op state without importing the browser owner", () => {
    const nativeHook = read("mingla-business/src/analytics/useWebConsentState.ts");
    expect(nativeHook).toContain('return "not_applicable";');
    expect(nativeHook).not.toContain("webAnalytics.web");
    expect(nativeHook).not.toContain("window");
    expect(nativeHook).not.toContain("localStorage");
  });

  test("the invitation reads the canonical external store and has no local visibility fork", () => {
    const banner = read("mingla-business/src/analytics/ConsentBanner.web.tsx");
    expect(banner).toContain("const consentState = useWebConsentState();");
    expect(banner).toContain('consentState !== "unresolved"');
    expect(banner).not.toContain("setVisible");
    expect(banner).not.toContain("readStoredConsent");
  });
});
