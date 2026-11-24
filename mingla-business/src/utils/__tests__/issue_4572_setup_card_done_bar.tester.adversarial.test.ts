/**
 * #4572 item 16 — tester adversarial (retest 1). Angles the implementor suites do not take:
 *
 * - the setup-card layout at hostile pane widths (0 before the first onLayout, NaN,
 *   one pixel under the threshold, a huge width) and on a phone that reports a wide pane;
 * - the Done-bar flag when the Ari screen unmounts while the composer is still focused
 *   (navigating away with the keyboard up must not leave every other field without a bar);
 * - a subscriber that unsubscribes while being notified does not starve the others.
 *
 * fails-on-revert: the "unmount" case fails when the unmount cleanup
 * `setDoneBarSuppressed(false)` is deleted from AriChatScreen; the layout cases fail when
 * noBrandSetupCardLayout goes back to `isWideDesktop ? "wide"`.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { WIDE_SETUP_CARD_MIN_PANE_PX, noBrandSetupCardLayout } from "../firstRunState";
import {
  doneBarShown,
  getDoneBarSuppressed,
  setDoneBarSuppressed,
  subscribeDoneBarSuppressed,
} from "../../wrappers/doneBarSuppression";

const ari = readFileSync(join(__dirname, "../../screens/ari/AriChatScreen.tsx"), "utf8");

describe("#4572 tester: setup card layout at hostile pane widths", () => {
  const wide = (paneWidth: number | null) =>
    noBrandSetupCardLayout({ isWideDesktop: true, isWeb: true, paneWidth });

  it("never picks two columns before the pane is measured, or for a broken width", () => {
    expect(wide(null)).toBe("web");
    expect(wide(0)).toBe("web");
    expect(wide(Number.NaN)).toBe("web");
    expect(wide(-1)).toBe("web");
  });

  it("switches exactly at the threshold, not a pixel early", () => {
    expect(wide(WIDE_SETUP_CARD_MIN_PANE_PX - 0.5)).toBe("web");
    expect(wide(WIDE_SETUP_CARD_MIN_PANE_PX)).toBe("wide");
    expect(wide(10_000)).toBe("wide");
  });

  it("a phone (not wide desktop) never gets the two-column card, whatever the pane says", () => {
    expect(noBrandSetupCardLayout({ isWideDesktop: false, isWeb: false, paneWidth: 2000 })).toBe("phone");
    expect(noBrandSetupCardLayout({ isWideDesktop: false, isWeb: true, paneWidth: 2000 })).toBe("web");
  });
});

describe("#4572 tester: Done bar flag survives screen exits", () => {
  afterEach(() => setDoneBarSuppressed(false));

  it("the Ari screen lowers the flag when it unmounts while the composer is focused", () => {
    // The cleanup must be an unmount effect (empty deps) that lowers the flag.
    expect(ari).toMatch(
      /React\.useEffect\(\(\)\s*=>\s*\(\):\s*void\s*=>\s*setDoneBarSuppressed\(false\),\s*\[\]\)/,
    );
    // Runtime: focus raises it, the unmount cleanup lowers it, other fields get the bar back.
    setDoneBarSuppressed(true);
    expect(doneBarShown(true, getDoneBarSuppressed())).toBe(false);
    setDoneBarSuppressed(false);
    expect(doneBarShown(true, getDoneBarSuppressed())).toBe(true);
  });

  it("the keyboard hiding alone never decides the flag (nothing but focus/blur/unmount writes it)", () => {
    const writers = ari.match(/setDoneBarSuppressed\((true|false)\)/g) ?? [];
    expect(writers.sort()).toEqual([
      "setDoneBarSuppressed(false)",
      "setDoneBarSuppressed(false)",
      "setDoneBarSuppressed(true)",
    ]);
    expect(doneBarShown(false, false)).toBe(false);
  });

  it("a subscriber that unsubscribes during a notification does not starve the others", () => {
    const seen: string[] = [];
    let unsubA: () => void = () => undefined;
    unsubA = subscribeDoneBarSuppressed(() => {
      seen.push("a");
      unsubA();
    });
    const unsubB = subscribeDoneBarSuppressed(() => seen.push("b"));
    setDoneBarSuppressed(true);
    setDoneBarSuppressed(false);
    unsubB();
    expect(seen).toEqual(["a", "b", "b"]);
  });
});
