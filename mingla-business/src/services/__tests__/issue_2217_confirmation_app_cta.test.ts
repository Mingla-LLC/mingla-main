/**
 * issue #2217 — the confirmation screen's ONE device-aware app button.
 *
 * WHAT WAS BROKEN, exactly. `DownloadMinglaCta` chose its destination with
 * `Platform.OS === 'ios' | 'android'`. Buyer-web renders this screen through
 * react-native-web, where `Platform.OS` is `'web'` for an iPhone and for an
 * Android alike — so BOTH device arms were unreachable on the only surface that
 * shows the card, the primary button fell through to a universal link, and a
 * second hardcoded badge offered an iPhone the Google Play Store. Two buttons,
 * one of them wrong on every iOS device.
 *
 * FAILS-ON-REVERT. Deleting the `detectClientPlatform` resolution, restoring
 * the second store badge, restoring the "See who's going in Mingla" card on any
 * of the three confirmation routes, or dropping `fallbackUrl` from the deep-link
 * opener each makes a NAMED assertion below fail.
 *
 * Pure/node: `guestFunnelLink` has no react-native import, and the component
 * assertions are made against its SOURCE rather than a render, because the
 * `Platform.OS` bug this file exists to prevent is invisible to a native-mode
 * render harness — which is precisely how it survived review the first time.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  buildConfirmationFunnelOneLinkUrl,
  resolveConfirmationAppTarget,
  type GuestFunnelEntity,
} from "../guestFunnelLink";
import {
  APP_STORE_URL,
  DOWNLOAD_PAGE_URL,
  GUEST_FUNNEL_ONELINK_URL,
  PLAY_STORE_URL,
} from "../../constants/storeLinks";
import { openAttendanceClaimWithFallback } from "../../utils/attendanceClaimDeepLink";

const ROOT = join(__dirname, "..", "..", "..");
const read = (relative: string): string =>
  readFileSync(join(ROOT, relative), "utf8");

const CTA = read("src/components/checkout/DownloadMinglaCta.tsx");
const CONFIRM_ROUTES = [
  "app/checkout/[eventId]/confirm.tsx",
  "app/checkout-trip/[tripEventId]/confirm.tsx",
  "app/checkout-experience/[experienceEventId]/confirm.tsx",
] as const;

const ENTITY: GuestFunnelEntity = {
  entityType: "event",
  brandSlug: "sunset collective",
  entitySlug: "rooftop/night",
};

describe("#2217 — one device-aware destination", () => {
  test("an iPhone gets the App Store, never Google Play", () => {
    const target = resolveConfirmationAppTarget(ENTITY, "ios");
    expect(target.ctaUrl).toBe(APP_STORE_URL);
    expect(target.store).toBe("app_store");
    expect(target.ctaUrl).not.toContain("play.google.com");
  });

  test("an Android gets Google Play, never the App Store", () => {
    const target = resolveConfirmationAppTarget(ENTITY, "android");
    expect(target.ctaUrl).toBe(PLAY_STORE_URL);
    expect(target.store).toBe("play");
    expect(target.ctaUrl).not.toContain("apps.apple.com");
  });

  test("a desktop is never dropped into a mobile store listing", () => {
    const target = resolveConfirmationAppTarget(ENTITY, "other");
    expect(target.ctaUrl).toBe(DOWNLOAD_PAGE_URL);
    expect(target.store).toBe("download_page");
  });

  test("the three platforms never share a destination while the funnel is dark", () => {
    const urls = (["ios", "android", "other"] as const).map(
      (platform) => resolveConfirmationAppTarget(ENTITY, platform).ctaUrl,
    );
    expect(new Set(urls).size).toBe(3);
  });

  test("the OneLink builder stays dark until Seth flips the SSOT constant", () => {
    // Mirrors the ORCH-1342 flip contract: null while dark, and when live the
    // CTA and QR are the SAME url so a QR can never encode a different target.
    if (GUEST_FUNNEL_ONELINK_URL === null) {
      expect(buildConfirmationFunnelOneLinkUrl(ENTITY)).toBeNull();
      expect(resolveConfirmationAppTarget(ENTITY, "ios").mode).toBe("store_direct");
    } else {
      const target = resolveConfirmationAppTarget(ENTITY, "ios");
      expect(target.mode).toBe("onelink");
      expect(target.ctaUrl).toBe(target.qrUrl);
      expect(resolveConfirmationAppTarget(ENTITY, "android").ctaUrl).toBe(target.ctaUrl);
    }
  });
});

describe("#2217 — the card carries ONE button", () => {
  test("exactly one Pressable, and no second store badge", () => {
    expect(CTA.match(/<Pressable/g)?.length ?? 0).toBe(2); // primary + the error-only retry
    const badgeRow = CTA.slice(CTA.indexOf("styles.badgeRow"));
    expect(badgeRow.slice(0, badgeRow.indexOf("</View>")).match(/<Pressable/g)?.length ?? 0).toBe(1);
  });

  test("the second store badge is gone (its exact former shape cannot return)", () => {
    // The deleted badge, verbatim from the pre-#2217 file. "Google Play" still
    // appears once — inside the accessibility label of the SINGLE button, where
    // it names the destination an Android buyer is actually sent to.
    expect(CTA).not.toContain('accessibilityLabel="Google Play"');
    expect(CTA).not.toContain("secondaryBadgeText}>Google Play");
    // Once in the docblock naming the deleted badge, once in the single
    // button's accessibility label. Never as rendered button text.
    expect(CTA.match(/Google Play/g)?.length ?? 0).toBe(2);
    expect(CTA).not.toMatch(/<Text[^>]*>\s*Google Play/);
  });

  test("the destination comes from the BROWSER, not from Platform.OS", () => {
    expect(CTA).toContain("detectClientPlatform");
    expect(CTA).toContain("resolveConfirmationAppTarget");
    // The exact dead branch that shipped the bug must not come back.
    expect(CTA).not.toContain('Platform.OS === "ios" ? APP_STORE_URL');
    expect(CTA).not.toContain("PLAY_STORE_URL");
  });

  test("the button names its real destination for a screen reader", () => {
    expect(CTA).toContain("Open in Mingla, or get it on the App Store");
    expect(CTA).toContain("Open in Mingla, or get it on Google Play");
  });

  test("the ticket-connect promise is stated on the card", () => {
    expect(CTA).toContain("Sign in");
    expect(CTA).toContain("email or phone you used here");
  });
});

describe("#2217 — the guest-list card is deleted from every confirmation route", () => {
  test.each(CONFIRM_ROUTES)("%s no longer renders it", (route) => {
    const source = read(route);
    expect(source).not.toContain("See who’s going in Mingla");
    expect(source).not.toContain("Connect this ticket to your Mingla account");
    expect(source).not.toContain("MINGLA_APP_ICON");
  });

  test.each(CONFIRM_ROUTES)("%s renders the merged card with the claim authority", (route) => {
    const source = read(route);
    expect(source).toContain("<DownloadMinglaCta");
    expect(source).toContain("claimPhase={attendanceClaim.phase}");
    expect(source).toContain("link.appClaimUrl");
    expect(source).toContain("onRetryClaim={retryAttendanceClaim}");
  });
});

describe("#2217 — the fallback lands on the store, not on a two-store interstitial", () => {
  test("fallbackUrl overrides webClaimUrl without changing when it fires", async () => {
    const opened: string[] = [];
    let scheduled: (() => void) | null = null;
    const doc = {
      visibilityState: "visible",
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    };
    await openAttendanceClaimWithFallback(
      {
        appClaimUrl: "com.mingla.app.v2://attendance-claim#v=1",
        webClaimUrl: "https://host.usemingla.com/attendance/claim",
        fallbackUrl: APP_STORE_URL,
      },
      (url) => {
        opened.push(url);
        return Promise.resolve();
      },
      doc,
      (callback) => {
        scheduled = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
    );
    expect(opened).toEqual(["com.mingla.app.v2://attendance-claim#v=1"]);
    (scheduled as unknown as (() => void) | null)?.();
    expect(opened[1]).toBe(APP_STORE_URL);
    expect(opened).not.toContain("https://host.usemingla.com/attendance/claim");
  });

  test("omitting fallbackUrl keeps the emailed link's interstitial verbatim", async () => {
    const opened: string[] = [];
    let scheduled: (() => void) | null = null;
    await openAttendanceClaimWithFallback(
      {
        appClaimUrl: "com.mingla.app.v2://attendance-claim#v=1",
        webClaimUrl: "https://host.usemingla.com/attendance/claim",
      },
      (url) => {
        opened.push(url);
        return Promise.resolve();
      },
      {
        visibilityState: "visible",
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
      },
      (callback) => {
        scheduled = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
    );
    (scheduled as unknown as (() => void) | null)?.();
    expect(opened[1]).toBe("https://host.usemingla.com/attendance/claim");
  });
});
