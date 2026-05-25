/**
 * ORCH-0961 [Public event close/back parity] — public event page close chrome.
 *
 * Repo test harness note: mingla-business currently runs Jest in a Node
 * environment without react-test-renderer or @testing-library/react-native.
 * This test therefore pins the JSX wiring and navigation callback contract
 * through source assertions. Removing the close IconChrome or changing its
 * canGoBack/brand fallback makes the assertions fail.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const publicEventPageSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/event/PublicEventPage.tsx"),
    "utf8",
  );

describe("ORCH-0961 — PublicEventPage close button", () => {
  test("renders Close and Share IconChrome controls above the event cover", () => {
    const src = publicEventPageSource();
    const sharedPageIndex = src.indexOf("<SharedPublicEventPage");
    const floatingChromeIndex = src.indexOf("styles.floatingChrome");
    const closeButtonIndex = src.indexOf('accessibilityLabel="Close"');
    const shareButtonIndex = src.indexOf('accessibilityLabel="Share"');

    expect(sharedPageIndex).toBeGreaterThan(-1);
    expect(floatingChromeIndex).toBeGreaterThan(sharedPageIndex);
    expect(closeButtonIndex).toBeGreaterThan(floatingChromeIndex);
    expect(shareButtonIndex).toBeGreaterThan(closeButtonIndex);
    expect(src).toContain('<IconChrome\n          icon="close"');
    expect(src).toContain('<IconChrome\n          icon="share"');
    expect(src).toContain("onPress={handleClose}");
    expect(src).toContain("onPress={handleShare}");
  });

  test("Close uses router.back() when possible and brand-page fallback on deep-link entry", () => {
    const src = publicEventPageSource();

    expect(src).toContain("const handleClose = useCallback((): void => {");
    expect(src).toContain("if (router.canGoBack())");
    expect(src).toContain("router.back();");
    expect(src).toContain('router.replace(`/b/${brand.slug}` as never);');
    expect(src).toContain('router.replace(`/b/${event.brandSlug}` as never);');
    expect(src).toContain('router.replace("/" as never);');
    expect(src).toContain("onClose: handleClose");
    expect(src).toContain("onShare: handleShare");
  });
});
