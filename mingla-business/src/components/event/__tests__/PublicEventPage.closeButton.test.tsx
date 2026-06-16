/**
 * ORCH-0961 [Public event close/back parity] — public event page close chrome.
 *
 * [TEST-MOD-APPROVED ORCH-1138] — ORCH-1138 Leg 2 re-architected the public event
 * adapter onto the Direction-A foundation: the close/share/mute chrome MOVED from
 * the adapter's own `IconChrome` row + `FloatingOfferingBar` into the shared
 * PublicEventPage's FOUNDATION mode (ParallaxCoverShell's OfferingChrome), driven
 * by the SAME `callbacks.onClose`/`onShare`. The ORCH-0961 BEHAVIORAL contract is
 * UNCHANGED (close uses router.back() with brand/root fallback; share present;
 * founder public route keeps the public fallback) and is still asserted below; the
 * obsolete source-shape assertions (`<IconChrome icon="close"` / `styles.
 * floatingChrome`) were removed because that wiring no longer exists in the
 * adapter. The adversarial sibling re-points its callback drive to the FOUNDATION
 * chrome handlers.
 *
 * Repo test harness note: mingla-business runs Jest in a Node environment without
 * react-test-renderer; this test pins the navigation callback contract through
 * source assertions. Changing handleClose's canGoBack/brand fallback fails them.
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
  test("close + share chrome route through the shared page's FOUNDATION callbacks", () => {
    const src = publicEventPageSource();
    // The adapter mounts the shared page in FOUNDATION mode (palette + chrome
    // handlers present) — the shell owns the X·Share·Mute chrome and fires the
    // adapter's handlers. The close/share handlers must still be wired.
    expect(src).toContain("<SharedPublicEventPage");
    expect(src).toContain("onClose: handleClose");
    expect(src).toContain("onShare: handleShare");
    // FOUNDATION mode is entered by passing palette + onToggleMute (ORCH-1138).
    expect(src).toContain("palette={palette}");
    expect(src).toContain("onToggleMute={handleToggleMute}");
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
