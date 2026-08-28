import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");

test("#2771 malformed and denied values cannot look like a grant in either root", () => {
  const business = readFileSync(join(ROOT, "src/analytics/webAnalytics.web.ts"), "utf8");
  const marketing = readFileSync(join(ROOT, "../mingla-marketing/components/marketing/posthog-provider.tsx"), "utf8");
  expect(business).toContain('parsed.choice === "granted" || parsed.choice === "denied"');
  expect(business).toContain('readStoredConsent() !== "granted"');
  expect(marketing).toContain("parsed.value === 'granted' || parsed.value === 'denied'");
  expect(marketing).toContain("readMarketingConsent() !== 'granted'");
});

test("#2771 pregrant event intents are discarded rather than buffered", () => {
  const business = readFileSync(join(ROOT, "src/analytics/webAnalytics.web.ts"), "utf8");
  const marketing = readFileSync(join(ROOT, "../mingla-marketing/components/marketing/posthog-provider.tsx"), "utf8");
  expect(business).not.toMatch(/pendingEvents|eventQueue|replayPending/);
  expect(marketing).not.toMatch(/pendingEvents|eventQueue|replayPending/);
  expect(business).toMatch(/captureWeb[\s\S]*readStoredConsent\(\) !== "granted"/);
  expect(marketing).toMatch(/captureMarketing[\s\S]*readMarketingConsent\(\) !== 'granted'/);
});

test("#2771 Marketing keeps Google and PostHog behind the same conditional child boundary", () => {
  const layout = readFileSync(join(ROOT, "../mingla-marketing/app/layout.tsx"), "utf8");
  const provider = readFileSync(join(ROOT, "../mingla-marketing/components/marketing/posthog-provider.tsx"), "utf8");
  const banner = readFileSync(join(ROOT, "../mingla-marketing/components/marketing/consent-banner.tsx"), "utf8");
  expect(layout).toMatch(/<PostHogProvider>\s*<GoogleAnalytics[\s\S]*<\/PostHogProvider>/);
  expect(layout).not.toContain("next/script");
  expect(provider).toContain("await import('posthog-js')");
  expect(provider).toContain("return enabled ? children : null");
  expect(banner).not.toContain("consent_denied");
  expect(banner).not.toContain("posthogOptOut");
});

test("#2771 /links stays suppressed without being treated as consent", () => {
  const visibility = readFileSync(join(ROOT, "../mingla-marketing/lib/consent-banner-visibility.ts"), "utf8");
  const provider = readFileSync(join(ROOT, "../mingla-marketing/components/marketing/posthog-provider.tsx"), "utf8");
  expect(visibility).toContain("SUPPRESSED_CONSENT_ROUTES = ['/links']");
  expect(provider).not.toContain("/links");
  expect(provider).toContain("readMarketingConsent() !== 'granted'");
});
