/**
 * issue #3524 / #3525 — A DESKTOP IS NEVER HANDED A MOBILE STORE LISTING.
 *
 * WHAT WAS BROKEN, exactly. `resolveConfirmationAppTarget` carried a comment
 * promising it "NEVER returns a store URL for `platform === 'other'`", and that
 * promise held only because the guest-funnel OneLink was dark. The OneLink arm
 * returned BEFORE the platform branch was reached, so the instant
 * `GUEST_FUNNEL_ONELINK_URL` was flipped, a desktop buyer would have been handed
 * the OneLink — whose own desktop 301 lands on an iOS App Store listing
 * (measured on three desktop user-agents, 2026-09-21 and again 2026-09-22).
 *
 * The comment would have become false without a single line changing. THAT is
 * what this file exists to stop: it asserts the desktop answer on BOTH ARMS, so
 * the guarantee no longer depends on the value of a flag.
 *
 * `resolveClaimPageTarget` — the email landing page's resolver, new in #3524 —
 * carries the same rule and is asserted the same way.
 *
 * FAILS-ON-REVERT. Delete `&& platform !== "other"` from
 * `resolveConfirmationAppTarget`, or move `resolveClaimPageTarget`'s desktop
 * branch below its OneLink branch, and a NAMED assertion below goes red.
 */

import { describe, expect, test } from "@jest/globals";

const ENTITY = {
  entityType: "event" as const,
  brandSlug: "issue-3524-brand",
  entitySlug: "issue-3524-event",
};

const LIVE_ONELINK = "https://go.usemingla.com/w36m";

/**
 * Load the resolvers with the flip constant forced to a value, so BOTH arms are
 * exercised from one file. The repo's own value is `null` (dark) and a test that
 * only read that would be blind to the exact regression this file names.
 */
function withOneLink(value: string | null): {
  resolveConfirmationAppTarget: typeof import("../guestFunnelLink").resolveConfirmationAppTarget;
  resolveClaimPageTarget: typeof import("../guestFunnelLink").resolveClaimPageTarget;
  DOWNLOAD_PAGE_URL: string;
  APP_STORE_URL: string;
  PLAY_STORE_URL: string;
} {
  let mod!: typeof import("../guestFunnelLink");
  let links!: typeof import("../../constants/storeLinks");
  jest.isolateModules(() => {
    const actual = jest.requireActual<typeof import("../../constants/storeLinks")>(
      "../../constants/storeLinks",
    );
    jest.doMock("../../constants/storeLinks", () => ({
      ...actual,
      GUEST_FUNNEL_ONELINK_URL: value,
    }));
    links = require("../../constants/storeLinks");
    mod = require("../guestFunnelLink");
  });
  return {
    resolveConfirmationAppTarget: mod.resolveConfirmationAppTarget,
    resolveClaimPageTarget: mod.resolveClaimPageTarget,
    DOWNLOAD_PAGE_URL: links.DOWNLOAD_PAGE_URL,
    APP_STORE_URL: links.APP_STORE_URL,
    PLAY_STORE_URL: links.PLAY_STORE_URL,
  };
}

describe("issue #3524 a desktop never gets a mobile store listing", () => {
  test.each([
    ["DARK — the flip has not happened", null],
    ["LIVE — the flip has happened", LIVE_ONELINK],
  ])(
    "%s: the confirmation screen sends a desktop to the download page",
    (_label, flag) => {
      const { resolveConfirmationAppTarget, DOWNLOAD_PAGE_URL, APP_STORE_URL, PLAY_STORE_URL } =
        withOneLink(flag as string | null);
      const target = resolveConfirmationAppTarget(ENTITY, "other");

      expect(target.ctaUrl).toBe(DOWNLOAD_PAGE_URL);
      expect(target.qrUrl).toBe(DOWNLOAD_PAGE_URL);
      expect(target.store).toBe("download_page");
      // The point of the whole file, said plainly:
      expect(target.ctaUrl).not.toBe(APP_STORE_URL);
      expect(target.ctaUrl).not.toBe(PLAY_STORE_URL);
      expect(target.ctaUrl).not.toContain("apps.apple.com");
      expect(target.ctaUrl).not.toContain("play.google.com");
      expect(target.ctaUrl).not.toContain("go.usemingla.com");
    },
  );

  test.each([
    ["DARK — the flip has not happened", null],
    ["LIVE — the flip has happened", LIVE_ONELINK],
  ])(
    "%s: the email landing page sends a desktop to the download page",
    (_label, flag) => {
      const { resolveClaimPageTarget, DOWNLOAD_PAGE_URL } =
        withOneLink(flag as string | null);
      const target = resolveClaimPageTarget(ENTITY, "other");

      expect(target.ctaUrl).toBe(DOWNLOAD_PAGE_URL);
      expect(target.qrUrl).toBe(DOWNLOAD_PAGE_URL);
      expect(target.store).toBe("download_page");
      expect(target.ctaUrl).not.toContain("apps.apple.com");
      expect(target.ctaUrl).not.toContain("play.google.com");
      expect(target.ctaUrl).not.toContain("go.usemingla.com");
    },
  );

  test("a PHONE still gets the platform's store while the flip is dark", () => {
    const { resolveClaimPageTarget, APP_STORE_URL, PLAY_STORE_URL, DOWNLOAD_PAGE_URL } =
      withOneLink(null);

    const ios = resolveClaimPageTarget(ENTITY, "ios");
    expect(ios.ctaUrl).toBe(APP_STORE_URL);
    expect(ios.store).toBe("app_store");
    expect(ios.qrUrl).toBe(DOWNLOAD_PAGE_URL);

    const android = resolveClaimPageTarget(ENTITY, "android");
    expect(android.ctaUrl).toBe(PLAY_STORE_URL);
    expect(android.store).toBe("play");
  });

  test("a PHONE gets the attribution link once the flip is live, on its own channel", () => {
    const { resolveClaimPageTarget } = withOneLink(LIVE_ONELINK);

    for (const platform of ["ios", "android"] as const) {
      const target = resolveClaimPageTarget(ENTITY, platform);
      expect(target.mode).toBe("onelink");
      expect(target.store).toBe("onelink");
      expect(target.ctaUrl.startsWith(LIVE_ONELINK)).toBe(true);
      // The claim page mints its own channel at the call site rather than
      // inventing a third URL grammar.
      expect(target.ctaUrl).toContain("c=attendance_claim");
      expect(target.ctaUrl).not.toContain("c=ticket_confirmation");
      // The grammar itself is the confirmation builder's, byte for byte.
      expect(target.ctaUrl).toContain("deep_link_value=event");
      expect(target.ctaUrl).toContain("deep_link_sub3=guest-list");
      expect(target.qrUrl).toBe(target.ctaUrl);
    }
  });

  test("the confirmation screen still uses the attribution link for a PHONE when live", () => {
    const { resolveConfirmationAppTarget } = withOneLink(LIVE_ONELINK);
    for (const platform of ["ios", "android"] as const) {
      const target = resolveConfirmationAppTarget(ENTITY, platform);
      expect(target.mode).toBe("onelink");
      expect(target.ctaUrl.startsWith(LIVE_ONELINK)).toBe(true);
      expect(target.ctaUrl).toContain("c=ticket_confirmation");
    }
  });

  test("the flip constant is still DARK in the repository, and #3525 says why", () => {
    // Not a style check: the desktop arm of the live AppsFlyer template lands on
    // an iOS App Store listing, so flipping this today would do to every desktop
    // recipient of a ticket confirmation exactly what this file forbids. The fix
    // is an AppsFlyer account change, not code.
    const links = jest.requireActual<typeof import("../../constants/storeLinks")>(
      "../../constants/storeLinks",
    );
    expect(links.GUEST_FUNNEL_ONELINK_URL).toBeNull();
  });
});
