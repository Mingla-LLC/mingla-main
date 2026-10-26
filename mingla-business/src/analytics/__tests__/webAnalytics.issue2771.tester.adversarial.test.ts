// [TEST-MOD-APPROVED #2331] Source guards for I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF
// (replacing the #2771 grant-before-load guards): both roots read one saved
// choice, every facade fails closed after a turn-off, and no region read or
// "nothing until you accept" copy survives.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

test("#2331 malformed or partial records cannot read as a saved choice in either root", () => {
  const business = read("src/analytics/webAnalytics.web.ts");
  const marketing = read("../mingla-marketing/components/marketing/posthog-provider.tsx");
  expect(business).toContain('typeof record.analytics === "boolean" && typeof record.ads === "boolean"');
  expect(marketing).toContain("typeof record.analytics === 'boolean' && typeof record.ads === 'boolean'");
  expect(business).toContain('PRIVACY_STORAGE_KEY = "mingla_privacy_v2"');
  expect(marketing).toContain("MARKETING_PRIVACY_STORAGE_KEY = 'mingla_privacy_v2'");
});

test("#2331 event intents after a turn-off are discarded rather than buffered", () => {
  const business = read("src/analytics/webAnalytics.web.ts");
  const marketing = read("../mingla-marketing/components/marketing/posthog-provider.tsx");
  expect(business).not.toMatch(/pendingEvents|eventQueue|replayPending/);
  expect(marketing).not.toMatch(/pendingEvents|eventQueue|replayPending/);
  expect(business).toMatch(/export function captureWeb[\s\S]{0,120}if \(!isAnalyticsOn\(\) \|\| posthogClient === null\) return;/);
  expect(marketing).toMatch(/export function captureMarketing[\s\S]{0,120}if \(!isMarketingAnalyticsOn\(\)\) return/);
});

test("#2331 neither root reads a per-country mode or says nothing is tracked until you accept", () => {
  for (const rel of [
    "src/analytics/webAnalytics.web.ts",
    "src/analytics/ConsentBanner.web.tsx",
    "server/publicAdRuntime.js",
    "server/publicSearchDocument.js",
    "scripts/build-invite-critical-entry.mjs",
    "../mingla-marketing/components/marketing/consent-banner.tsx",
    "../mingla-marketing/components/marketing/posthog-provider.tsx",
  ]) {
    const source = read(rel);
    expect(source).not.toContain("/api/ad-pixel-config");
    expect(source).not.toContain("ad_pixel_public_config");
    expect(source).not.toContain("__minglaAdPixelConsentMode");
    // The invite shell's builder still names the legacy copy it REPLACES; its
    // built output is checked in issue922BusinessWebActionable.happy.test.ts.
    if (!rel.endsWith("build-invite-critical-entry.mjs")) {
      expect(source.replace(/\s+/g, " ")).not.toMatch(/Nothing is (?:tracked|set) until you/);
    }
  }
});

test("#2331 Marketing keeps Google behind the analytics boundary and /links is no longer suppressed", () => {
  const layout = read("../mingla-marketing/app/layout.tsx");
  const provider = read("../mingla-marketing/components/marketing/posthog-provider.tsx");
  const banner = read("../mingla-marketing/components/marketing/consent-banner.tsx");
  expect(layout).toMatch(/<PostHogProvider>\s*<GoogleAnalytics[\s\S]*<\/PostHogProvider>/);
  expect(provider).toContain("await import('posthog-js')");
  expect(provider).toContain("return enabled ? children : null");
  expect(existsSync(join(ROOT, "../mingla-marketing/lib/consent-banner-visibility.ts"))).toBe(false);
  expect(banner).not.toContain("shouldRenderConsentBanner");
  expect(banner).not.toContain("SUPPRESSED_CONSENT_ROUTES");
});
