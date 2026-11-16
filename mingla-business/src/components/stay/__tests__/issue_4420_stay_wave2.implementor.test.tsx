/**
 * issue #4420 wave 2 — Stay guest fixes from the payments test (behaviour).
 *
 *   S-1 every stay_* refusal has a title, a body and an action label in plain
 *       words (no "stay_", no underscores); an unknown code gets the fallback;
 *   S-2 the booking opens on the first check-in the notice rules allow (not
 *       a night already ruled out), and on venue-local tomorrow otherwise;
 *   S-3 the Payment Element follows the page: "stripe" on a light palette,
 *       "night" on a dark one, the first gradient stop as the primary;
 *   S-4 the wrong-email page shows ONLY the masked address, no booking
 *       details, and its button is labelled;
 *   S-5 the client keeps the server's masked email on the error.
 *
 * Fails-on-revert: raw codes on screen fail S-1; seeding "tomorrow" through
 * a notice window fails S-2; a fixed "night" theme fails S-3; printing the
 * full address fails S-4/S-5.
 */
import React from "react";

jest.mock("../../ui/Icon", () => ({ __esModule: true, Icon: () => null }));

import {
  STAY_GUEST_ERROR_CODES,
  STAY_GUEST_FALLBACK_COPY,
  stayGuestErrorCopy,
  stayGuestErrorKnown,
  stayGuestErrorLine,
} from "@mingla/brand-rendering/stayGuestErrorCopy";
import { stayDefaultRange } from "@mingla/brand-rendering/stayDateRules";
import {
  createThemePalette,
  paletteAccentGradient,
} from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

import { stayPaymentAppearance } from "../stayPaymentAppearance";

const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => {
    root: {
      findAll: (p: (n: { type: unknown; props: Record<string, unknown>; children?: unknown[] }) => boolean) => Array<{
        type: unknown;
        props: Record<string, unknown>;
        children?: unknown[];
      }>;
    };
    toJSON: () => unknown;
    unmount: () => void;
  };
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REQUIRED_CODES = [
  "stay_inventory_changed",
  "stay_search_changed",
  "stay_cart_changed",
  "stay_quote_expired",
  "stay_bank_not_ready",
  "stay_rail_not_enabled",
  "stay_payment_already_pending",
  "stay_payment_ambiguous",
  "stay_payment_resume_unavailable",
  "stay_date_outside_horizon",
  "stay_too_long",
  "stay_room_dates_must_match",
  "stay_dependent_place_requires_room",
  "stay_version_conflict",
  "stay_idempotency_conflict",
  "stay_offering_not_found",
  "stay_public_offering_invalid",
  "stay_payment_link_expired",
  "stay_payment_link_not_found",
  "stay_payment_link_not_actionable",
  "stay_group_other_contact",
];

describe("issue #4420 wave 2 — Stay guest", () => {
  test("S-1 every stay code reads as plain copy with one action", () => {
    for (const code of REQUIRED_CODES) {
      expect(stayGuestErrorKnown(code)).toBe(true);
      const copy = stayGuestErrorCopy(code, {
        stayName: "Glass House",
        brandName: "Capture Co",
        roomName: "Deluxe King",
        horizonDate: "Sat 12 Dec 2026",
      });
      for (const text of [copy.title, copy.body, copy.actionLabel]) {
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/stay_|_/);
      }
    }
    expect(STAY_GUEST_ERROR_CODES.length).toBeGreaterThanOrEqual(REQUIRED_CODES.length);
    expect(stayGuestErrorKnown("stay_brand_new_refusal")).toBe(false);
    expect(stayGuestErrorCopy("stay_brand_new_refusal")).toEqual(STAY_GUEST_FALLBACK_COPY);
    expect(stayGuestErrorLine("stay_inventory_changed", { roomName: "Deluxe King" })).toBe(
      "Someone just booked Deluxe King. Your other rooms are still held and nothing was charged. Pick another room or change your dates.",
    );
  });

  test("S-2 the booking opens on the first check-in the rules allow", () => {
    // 2026-11-16 10:00 in New York; check-in is 15:00 venue time.
    const now = new Date("2026-11-16T15:00:00Z");
    const base = {
      timezone: "America/New_York",
      checkInTime: "15:00:00",
      bookingHorizonDays: 365,
      now,
    };
    expect(
      stayDefaultRange({ ...base, offerings: [{ minNoticeMinutes: 0, maxAdvanceDays: null }] }),
    ).toEqual({ checkIn: "2026-11-17", checkOut: "2026-11-18" });
    // Three days' notice (until Thu 19 Nov 10:00) rules out the 17th and
    // 18th; the 19th's 15:00 check-in clears it.
    expect(
      stayDefaultRange({
        ...base,
        offerings: [
          { minNoticeMinutes: 0, maxAdvanceDays: null },
          { minNoticeMinutes: 3 * 24 * 60, maxAdvanceDays: null },
        ],
      }),
    ).toEqual({ checkIn: "2026-11-19", checkOut: "2026-11-20" });
    // Nothing bookable inside the horizon: no dates, never a dead range.
    expect(
      stayDefaultRange({
        ...base,
        bookingHorizonDays: 1,
        offerings: [{ minNoticeMinutes: 5 * 24 * 60, maxAdvanceDays: null }],
      }),
    ).toEqual({ checkIn: "", checkOut: "" });
  });

  test("S-3 the Payment Element follows the page and the first colour", () => {
    const base = resolveTheme(null, null);
    // A dark host colour (navy) cannot clear 3:1 on black, so its page is light.
    const light = createThemePalette({ ...base, color: "#1e3a8a", foregroundColor: "#ffffff" });
    const dark = createThemePalette(base);
    const gradient = createThemePalette({
      ...base,
      color: "#7c3aed",
      color2: "#f43f5e",
      foregroundColor: "#ffffff",
    });
    expect(light.primaryText).not.toBe("#ffffff");
    expect(stayPaymentAppearance(light).theme).toBe("stripe");
    expect(stayPaymentAppearance(dark).theme).toBe("night");
    const stops = paletteAccentGradient(gradient);
    const primary = stayPaymentAppearance(gradient).variables.colorPrimary;
    expect(primary).toBe(gradient.accent);
    if (stops !== null) expect(primary).toBe(stops[0]);
    expect(stayPaymentAppearance(dark).variables.borderRadius).toBe("12px");
  });

  test("S-4 the wrong-email page shows the mask only, with a labelled action", async () => {
    const { StayOtherContactNotice } = require("../StayOtherContactNotice");
    const palette = createThemePalette(resolveTheme(null, null));
    const onSignIn = jest.fn();
    let tree!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <StayOtherContactNotice
          palette={palette}
          maskedEmail="g•••@example.com"
          currentEmail="me@mingla.test"
          onSignInOther={onSignIn}
        />,
      );
    });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("g•••@example.com");
    expect(text).toContain("me@mingla.test");
    expect(text).not.toMatch(/\$|£|€|₦|night|Deluxe|guest@/);
    const button = tree.root.findAll(
      (n) =>
        n.props.accessibilityLabel === "Sign in as g•••@example.com" &&
        typeof n.props.onPress === "function",
    )[0];
    expect(button).toBeDefined();
    await TestRenderer.act(async () => {
      (button?.props.onPress as () => void)();
    });
    expect(onSignIn).toHaveBeenCalledTimes(1);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("S-5 the client keeps only the server's masked email", () => {
    const { StayGuestError } = require("../../../services/stayGuestService");
    const error = new StayGuestError(
      "stay_group_other_contact",
      "This booking is under another email.",
      "g•••@example.com",
    );
    expect(error.code).toBe("stay_group_other_contact");
    expect(error.maskedEmail).toBe("g•••@example.com");
    expect(new StayGuestError("stay_quote_expired").maskedEmail).toBeNull();
  });
});
