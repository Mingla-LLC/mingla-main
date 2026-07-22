/**
 * ORCH-0961 [Public brand close/back parity] — public brand page close chrome.
 *
 * Repo test harness note: mingla-business currently runs Jest in a Node
 * environment without react-test-renderer or @testing-library/react-native.
 * This test therefore pins the JSX wiring and navigation callback contract
 * through source assertions. Removing the close affordance or changing its
 * canGoBack fallback makes the assertions fail.
 *
 * #1062 brand re-pointing (ORCH-1169 dissolution + ORCH-1155/ORCH-1159
 * chrome redesign): the business PublicBrandPage rendering was dissolved into
 * @mingla/brand-rendering, and the Close/Share chrome row was redesigned and
 * moved into @mingla/offering-rendering's OfferingChrome (driven through
 * ParallaxCoverShell). The floating IconChrome close became a Close
 * ChromeButton (CloseGlyph) that still renders BEFORE Share and is still wired
 * to the page's close callback. The invariant is unchanged; only WHERE the
 * logic lives moved, so the source assertions now follow the wiring chain:
 * business wrapper (onClose: handleClose) → shared PublicBrandPage
 * (onClose={callbacks.onClose}) → OfferingChrome (Close ChromeButton before
 * Share, onPress={onClose}). handleClose's router.back()/root fallback still
 * lives in the business wrapper (Test 2, unchanged).
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

// process.cwd() === mingla-business under jest; repo root is one level up.
const REPO_ROOT = path.join(process.cwd(), "..");
const readRepoFile = (rel: string): string =>
  readFileSync(path.join(REPO_ROOT, rel), "utf8");

const publicBrandPageSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/brand/PublicBrandPage.tsx"),
    "utf8",
  );
const sharedBrandPageSource = (): string =>
  readRepoFile("packages/brand-rendering/PublicBrandPage.tsx");
const offeringChromeSource = (): string =>
  readRepoFile("packages/offering-rendering/OfferingChrome.tsx");

describe("ORCH-0961 — PublicBrandPage close button", () => {
  test("renders an always-visible Close affordance BEFORE Share in the floating chrome row, wired through the shared packages", () => {
    // Layer 1 — business wrapper hands its close/share callbacks to the shared
    // page (this is the seam that used to render the IconChrome inline).
    const wrapper = publicBrandPageSource();
    expect(wrapper).toContain("onClose: handleClose,");
    expect(wrapper).toContain("<SharedPublicBrandPage");

    // Layer 2 — the shared brand page wires those callbacks into the parallax
    // shell's chrome.
    const shared = sharedBrandPageSource();
    expect(shared).toContain("onClose={callbacks.onClose}");
    expect(shared).toContain("onShare={callbacks.onShare}");

    // Layer 3 — OfferingChrome renders the Close ChromeButton BEFORE the Share
    // ChromeButton, each wired to its callback. Close is always visible on
    // native; hideCloseOnWeb only affects web (ORCH-1159), so the affordance
    // is never removed outright.
    const chrome = offeringChromeSource();
    const closeIndex = chrome.indexOf("onPress={onClose}");
    const shareIndex = chrome.indexOf("onPress={onShare}");
    expect(closeIndex).toBeGreaterThan(-1);
    expect(shareIndex).toBeGreaterThan(closeIndex);
    // Close carries the "Close" accessibility label (default), Share carries "Share".
    expect(chrome).toContain('closeAccessibilityLabel = "Close"');
    expect(chrome).toContain("accessibilityLabel={closeAccessibilityLabel}");
    expect(chrome).toContain('accessibilityLabel="Share"');
    expect(chrome).toContain("<CloseGlyph />");
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
