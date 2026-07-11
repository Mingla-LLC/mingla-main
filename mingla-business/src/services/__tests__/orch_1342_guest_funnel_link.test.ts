/**
 * ORCH-1342 [web-see-whos-going-funnel] — guest-funnel URL builder + platform
 * trio + client-open regression (SPEC §7 T-4 / T-5 / T-7 + adversarial T-A7 /
 * T-A8; META-ORCH-1337 Leg 5). Runs under the default node/ts-jest config —
 * guestFunnelLink.ts is a PURE module.
 *
 * FAILS-ON-REVERT: deleting the dark-mode store split, the §4.2 param
 * composition, the rsvp→event mapping, the encodeURIComponent slug encoding,
 * the ctaUrl===qrUrl single-source rule, or the window.location.assign
 * popup-block fallback makes a named assertion FAIL.
 */

import { describe, expect, jest, test } from "@jest/globals";

import {
  detectClientPlatform,
  isIosDevice,
  openExternal,
  resolveGuestFunnelTarget,
  resolvePlatform,
  type GuestFunnelEntity,
} from "../guestFunnelLink";
import {
  APP_STORE_URL,
  DOWNLOAD_PAGE_URL,
  PLAY_STORE_URL,
} from "../../constants/storeLinks";

const ENTITY: GuestFunnelEntity = {
  entityType: "rsvp",
  brandSlug: "sunset collective",
  entitySlug: "rooftop/night",
};

// ── T-7: the ORCH-1319 trio, pinned VERBATIM against the marketing cases ─────

const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_IPAD_CLASSIC =
  "Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const UA_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const UA_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

describe("ORCH-1342 T-7 — device-platform trio (ORCH-1319 verbatim parity)", () => {
  test("iPad-as-Mac (MacIntel + maxTouchPoints>1) resolves to ios", () => {
    expect(isIosDevice(UA_MAC, "MacIntel", 5)).toBe(true);
    expect(resolvePlatform(UA_MAC, "MacIntel", 5)).toBe("ios");
  });
  test("a real Mac (MacIntel + no touch) is NOT iOS → other", () => {
    expect(isIosDevice(UA_MAC, "MacIntel", 0)).toBe(false);
    expect(resolvePlatform(UA_MAC, "MacIntel", 0)).toBe("other");
  });
  test("classic iPhone / iPad UA resolves to ios", () => {
    expect(resolvePlatform(UA_IPHONE, "iPhone", 5)).toBe("ios");
    expect(resolvePlatform(UA_IPAD_CLASSIC, "iPad", 5)).toBe("ios");
  });
  test("Android UA resolves to android", () => {
    expect(resolvePlatform(UA_ANDROID, "", 5)).toBe("android");
  });
  test("Windows / desktop resolves to other", () => {
    expect(resolvePlatform(UA_WINDOWS, "Win32", 0)).toBe("other");
  });
  test("SSR-safe: no navigator → 'other' (never throws at module load)", () => {
    expect(detectClientPlatform()).toBe("other");
  });
});

// ── T-4: dark mode (GUEST_FUNNEL_ONELINK_URL === null on this branch) ────────

describe("ORCH-1342 T-4 — dark mode (store_direct)", () => {
  test("iOS → App Store CTA; QR = the smart-download page", () => {
    const t = resolveGuestFunnelTarget(ENTITY, "ios");
    expect(t).toEqual({
      mode: "store_direct",
      ctaUrl: APP_STORE_URL,
      qrUrl: DOWNLOAD_PAGE_URL,
      store: "app_store",
    });
  });
  test("Android → Play CTA; QR = the smart-download page", () => {
    const t = resolveGuestFunnelTarget(ENTITY, "android");
    expect(t).toEqual({
      mode: "store_direct",
      ctaUrl: PLAY_STORE_URL,
      qrUrl: DOWNLOAD_PAGE_URL,
      store: "play",
    });
  });
  test("other/desktop → smart-download page for BOTH CTA and QR", () => {
    const t = resolveGuestFunnelTarget(ENTITY, "other");
    expect(t).toEqual({
      mode: "store_direct",
      ctaUrl: DOWNLOAD_PAGE_URL,
      qrUrl: DOWNLOAD_PAGE_URL,
      store: "download_page",
    });
  });
});

// ── T-4 live mode: the §4.2 URL grammar, unit-proven NOW (SC-10's composition
//    half) by flipping the constant via an isolated module registry ──────────

describe("ORCH-1342 T-4 — live mode (§4.2 OneLink grammar; flip simulated)", () => {
  const LIVE = "https://go.usemingla.com/w36m";

  const loadLive = (): typeof import("../guestFunnelLink") => {
    let mod: typeof import("../guestFunnelLink") | null = null;
    jest.isolateModules(() => {
      jest.doMock("../../constants/storeLinks", () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const actual = jest.requireActual("../../constants/storeLinks") as object;
        return { ...actual, GUEST_FUNNEL_ONELINK_URL: LIVE };
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("../guestFunnelLink") as typeof import("../guestFunnelLink");
    });
    if (mod === null) throw new Error("isolateModules failed to load");
    return mod;
  };

  test("exact §4.2 URL: params in order, slugs encoded, rsvp→event mapping", () => {
    const live = loadLive();
    expect(live.buildGuestFunnelOneLinkUrl(ENTITY)).toBe(
      `${LIVE}?deep_link_value=event` +
        "&deep_link_sub1=sunset%20collective" +
        "&deep_link_sub2=rooftop%2Fnight" +
        "&deep_link_sub3=guest-list" +
        "&pid=buyer_web&c=see_whos_going",
    );
  });

  test("event/trip/experience pass through verbatim as deep_link_value", () => {
    const live = loadLive();
    for (const entityType of ["event", "trip", "experience"] as const) {
      const url = live.buildGuestFunnelOneLinkUrl({
        entityType,
        brandSlug: "b",
        entitySlug: "s",
      });
      expect(url).toContain(`deep_link_value=${entityType}`);
    }
  });

  test("T-A7: live mode — the QR encodes EXACTLY the URL the CTA opens", () => {
    const live = loadLive();
    for (const platform of ["ios", "android", "other"] as const) {
      const t = live.resolveGuestFunnelTarget(ENTITY, platform);
      expect(t.mode).toBe("onelink");
      expect(t.store).toBe("onelink");
      expect(t.qrUrl).toBe(t.ctaUrl);
      expect(t.ctaUrl).toBe(live.buildGuestFunnelOneLinkUrl(ENTITY));
    }
  });

  test("dark on THIS branch: the committed constant is null → builder null", () => {
    // The go-live flip is Seth's one-line [deploy] PR (SPEC §10-2) — until
    // then the committed module must stay dark.
    const { buildGuestFunnelOneLinkUrl } = jest.requireActual(
      "../guestFunnelLink",
    ) as typeof import("../guestFunnelLink");
    expect(buildGuestFunnelOneLinkUrl(ENTITY)).toBeNull();
  });
});

// ── T-5 / T-A8: the ORCH-1328 client-side open pattern ───────────────────────

describe("ORCH-1342 T-5 — openExternal (ORCH-1328 byte-pattern)", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  test("opens a new context on the tap; page stays (no location.assign)", () => {
    const open = jest.fn(() => ({}) as Window);
    const assign = jest.fn();
    (globalThis as Record<string, unknown>).window = {
      open,
      location: { assign },
    };
    openExternal("https://example.com/x");
    expect(open).toHaveBeenCalledWith(
      "https://example.com/x",
      "_blank",
      "noopener,noreferrer",
    );
    expect(assign).not.toHaveBeenCalled();
  });

  test("T-A8: popup blocked (window.open → null) → same-tab location.assign fallback", () => {
    const open = jest.fn(() => null);
    const assign = jest.fn();
    (globalThis as Record<string, unknown>).window = {
      open,
      location: { assign },
    };
    openExternal("https://example.com/x");
    expect(assign).toHaveBeenCalledWith("https://example.com/x");
  });

  test("no window (native/SSR) → silent no-op, never throws", () => {
    expect(() => openExternal("https://example.com/x")).not.toThrow();
  });
});
