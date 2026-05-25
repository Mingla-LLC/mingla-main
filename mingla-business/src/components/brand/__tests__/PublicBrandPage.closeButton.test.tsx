/**
 * ORCH-0961 [Public brand close/back parity] — public brand page close chrome.
 *
 * Repo test harness note: mingla-business currently runs Jest in a Node
 * environment without react-test-renderer or @testing-library/react-native.
 * This test therefore pins the JSX wiring and navigation callback contract
 * through source assertions. Removing the close IconChrome or changing its
 * canGoBack fallback makes the assertions fail.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const publicBrandPageSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/brand/PublicBrandPage.tsx"),
    "utf8",
  );

describe("ORCH-0961 — PublicBrandPage close button", () => {
  test("renders an always-visible Close IconChrome in the floating chrome row", () => {
    const src = publicBrandPageSource();
    const floatingChromeIndex = src.indexOf("styles.floatingChrome");
    const closeButtonIndex = src.indexOf('accessibilityLabel="Close"');
    const shareButtonIndex = src.indexOf('accessibilityLabel="Share"');

    expect(floatingChromeIndex).toBeGreaterThan(-1);
    expect(closeButtonIndex).toBeGreaterThan(floatingChromeIndex);
    expect(shareButtonIndex).toBeGreaterThan(closeButtonIndex);
    expect(src).toContain('<IconChrome\n          icon="close"');
    expect(src).toContain("onPress={handleClose}");
  });

  test("Close uses router.back() when possible and root fallback on deep-link entry", () => {
    const src = publicBrandPageSource();

    expect(src).toContain("const handleClose = useCallback((): void => {");
    expect(src).toContain("if (router.canGoBack())");
    expect(src).toContain("router.back();");
    expect(src).toContain('router.replace("/" as never);');
    expect(src).toContain("}, [router]);");
  });
});
