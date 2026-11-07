/**
 * #4271 door polish — implementor regression suite for the pure rules behind
 * the door sale polish (design items 1 to 11).
 *
 *   P1  four tones, each with its own ring and icon; red has a named token
 *   P2  every Tap to Pay end state maps to its tone (design "State map")
 *   P3  pay code end states: expired/cancelled grey, failed red, checking and
 *       payment landing amber, paid green; the guest page uses the same rule
 *   P4  the dock says at most one thing, highest priority first
 *   P5  the payment list has no dead row and no NEW badge; shorter pay code lines
 *   P6  buyer details, notes placeholder and counter copy
 *   P7  the pay code pill: countdown text, words for a screen reader, urgency
 *   P8  a typed buyer name rides the tap draft (any script), absent stays absent
 *   P9  "Sell another" keeps tickets and date, drops the guest's name and phone
 *
 * FAILS-ON-REVERT: restoring the two-tone TapStatusView, the card reader row,
 * the stacked dock lines, the "Code expires in" footnote or btoa draft encoding
 * fails P1 to P8.
 */
import { describe, expect, test } from "@jest/globals";

jest.mock("../../../constants/publicUrls", () => ({
  BUSINESS_PUBLIC_ORIGIN: "https://host.usemingla.com",
}));

import { glass, semantic, text as textTokens } from "../../../constants/designSystem";
import { encodeTapToPayDraft, parseTapToPayDraft, sellAnotherDraft } from "../../../services/terminal/tapToPayDraft";
import {
  DOOR_PAY_URGENT_SECONDS,
  doorPayCountdownSeconds,
  doorPayCountdownWords,
  doorPayWaitingPillText,
} from "../doorPayCodeState";
import {
  DOOR_ACCESS_CHECK_FAILED,
  DOOR_BANK_MISSING,
  DOOR_BUYER_DETAILS_ROW,
  DOOR_NOTES_PLACEHOLDER,
  DOOR_PAY_CODE_BUYER_NOTE,
  buildDoorPaymentOptions,
  doorDockMessage,
  doorNotesCounter,
  doorTicketCountLabel,
  type DoorDockMessageFacts,
} from "../doorPaymentOptions";
import { doorTapNewSaleHref } from "../doorTapDraftHref";
import { DOOR_TONE_STYLES, doorPayHostTone, doorToneStyle, type DoorTone } from "../doorTone";
import { DOOR_PAY_GUEST_TONE_STYLES, doorPayGuestTone } from "../doorPayGuestTone";
import { TAP_SAVE_FAILED_PAID_LINE, tapSaleTone } from "../tap/tapSaleTone";

const TONES: DoorTone[] = ["ok", "neutral", "caution", "bad"];

describe("P1 four door tones", () => {
  test("each tone has its own ring colour and its own icon", () => {
    expect(new Set(TONES.map((t) => doorToneStyle(t).defaultIcon)).size).toBe(4);
    expect(new Set(TONES.map((t) => doorToneStyle(t).ringFill)).size).toBe(4);
    expect(doorToneStyle("ok")).toMatchObject({ ringFill: semantic.successTint, iconColor: semantic.success, defaultIcon: "check" });
    expect(doorToneStyle("neutral")).toMatchObject({
      ringFill: glass.tint.profileElevated,
      ringBorder: glass.border.profileElevated,
      iconColor: textTokens.secondary,
    });
    expect(doorToneStyle("caution")).toMatchObject({ ringFill: semantic.warningTint, iconColor: semantic.warning });
    expect(doorToneStyle("bad")).toMatchObject({ ringFill: semantic.errorRing, iconColor: semantic.errorText, defaultIcon: "close" });
  });

  test("red has a named token; caution and bad interrupt a screen reader", () => {
    expect(semantic.errorRing).toBe("rgba(239, 68, 68, 0.16)");
    expect(DOOR_TONE_STYLES.caution.liveRegion).toBe("assertive");
    expect(DOOR_TONE_STYLES.bad.liveRegion).toBe("assertive");
    expect(DOOR_TONE_STYLES.ok.liveRegion).toBe("polite");
    expect(DOOR_TONE_STYLES.neutral.liveRegion).toBe("polite");
  });
});

describe("P2 Tap to Pay state map", () => {
  test("money taken is green, declined is red, nothing charged is grey, unsettled is amber", () => {
    expect(tapSaleTone("approved")).toBe("ok");
    expect(tapSaleTone("declined")).toBe("bad");
    for (const kind of ["needs_pin", "timed_out", "cancelled", "failed", "not_on_this_phone", "ios_update_required"] as const) {
      expect(tapSaleTone(kind)).toBe("neutral");
    }
    expect(tapSaleTone("unknown_result")).toBe("caution");
    expect(tapSaleTone("save_failed")).toBe("caution");
  });

  test("reader problems: retryable is grey, Apple's hard blocks stay red", () => {
    expect(tapSaleTone("reader_problem", "icloud_required")).toBe("neutral");
    expect(tapSaleTone("reader_problem", "prepare_failed")).toBe("neutral");
    expect(tapSaleTone("reader_problem", "terms_cancelled")).toBe("neutral");
    expect(tapSaleTone("reader_problem", "device_banned")).toBe("bad");
    expect(tapSaleTone("reader_problem", "merchant_blocked")).toBe("bad");
  });

  test("Paid, still saving says the guest has paid", () => {
    expect(TAP_SAVE_FAILED_PAID_LINE).toBe("The guest has paid. Don't take this payment again.");
  });
});

describe("P3 pay code tones", () => {
  test("host and guest share the rule", () => {
    expect(doorPayHostTone("paid")).toBe("ok");
    expect(doorPayHostTone("expired")).toBe("neutral");
    expect(doorPayHostTone("cancelled")).toBe("neutral");
    expect(doorPayHostTone("failed")).toBe("bad");
    expect(doorPayHostTone("checking")).toBe("caution");
    expect(doorPayHostTone("payment_landing")).toBe("caution");
    for (const status of ["paid", "expired", "cancelled", "failed"] as const) {
      expect(doorPayGuestTone(status)).toBe(doorPayHostTone(status));
    }
  });

  test("the guest page's own ring styles match the host's door tones exactly", () => {
    for (const tone of ["ok", "neutral", "bad"] as const) {
      const host = DOOR_TONE_STYLES[tone];
      expect(DOOR_PAY_GUEST_TONE_STYLES[tone]).toEqual({
        ringFill: host.ringFill,
        ringBorder: host.ringBorder,
        iconColor: host.iconColor,
        iconSize: host.iconSize,
        defaultIcon: host.defaultIcon,
      });
    }
  });
});

describe("P4 one dock message, highest priority wins", () => {
  const TAX = "Card payments at the door aren't available for this event yet because tax is added at checkout. Take cash, or send guests to the event page.";
  const none: DoorDockMessageFacts = {
    taxRefused: false,
    accessCheckFailed: false,
    error: null,
    bankMissing: false,
    cardQuotePending: null,
  };
  const all: DoorDockMessageFacts = {
    taxRefused: true,
    accessCheckFailed: true,
    error: "Pick at least one ticket first.",
    bankMissing: true,
    cardQuotePending: "tap_to_pay",
  };

  test("nothing to say: no line", () => {
    expect(doorDockMessage(none, TAX)).toBeNull();
  });

  test("each fact in turn, with every higher one switched off", () => {
    expect(doorDockMessage(all, TAX)).toEqual({ text: TAX, tone: "error" });
    expect(doorDockMessage({ ...all, taxRefused: false }, TAX)).toEqual({ text: DOOR_ACCESS_CHECK_FAILED, tone: "error" });
    expect(doorDockMessage({ ...all, taxRefused: false, accessCheckFailed: false }, TAX)).toEqual({
      text: "Pick at least one ticket first.",
      tone: "error",
    });
    expect(
      doorDockMessage({ ...all, taxRefused: false, accessCheckFailed: false, error: null }, TAX),
    ).toEqual({ text: DOOR_BANK_MISSING, tone: "hint" });
    expect(doorDockMessage({ ...none, cardQuotePending: "tap_to_pay" }, TAX)).toEqual({
      text: "The tap screen shows the final total, with any fees.",
      tone: "hint",
    });
    expect(doorDockMessage({ ...none, cardQuotePending: "pay_code" }, TAX)).toEqual({
      text: "The pay code shows the final total, with any fees.",
      tone: "hint",
    });
  });

  test("the strings are the ones the dock always used", () => {
    expect(DOOR_ACCESS_CHECK_FAILED).toBe("Couldn't check your door access. Check your connection and try again.");
    expect(DOOR_BANK_MISSING).toBe("Add your bank to record paid sales.");
    expect(doorTicketCountLabel(1)).toBe("1 ticket");
    expect(doorTicketCountLabel(3)).toBe("3 tickets");
  });
});

describe("P5 payment list: no dead rows", () => {
  test("at most four rows, Tap to Pay first, no disabled state, no badge", () => {
    const options = buildDoorPaymentOptions({
      eventCurrency: "GBP",
      tapToPay: { available: true, needsSetup: false },
      platform: "ios",
    });
    expect(options.map((o) => o.id)).toEqual(["tap_to_pay", "pay_code", "cash", "manual"]);
    for (const option of options) {
      expect(Object.keys(option).sort()).toEqual(["id", "label", "sub"]);
    }
    expect(options[1].sub).toBe("They scan a code and pay by card, Apple Pay or Google Pay.");
  });

  test("Paystack keeps card, bank transfer or USSD, and has no Tap to Pay row", () => {
    const options = buildDoorPaymentOptions({
      eventCurrency: "NGN",
      tapToPay: { available: false, needsSetup: false },
      platform: "ios",
    });
    expect(options.map((o) => o.id)).toEqual(["pay_code", "cash", "manual"]);
    expect(options[0].sub).toBe("They scan a code and pay by card, bank transfer or USSD.");
  });
});

describe("P6 buyer details and notes", () => {
  test("one collapsed row, one pay code line, a currency-free example", () => {
    expect(DOOR_BUYER_DETAILS_ROW).toEqual({
      title: "Add buyer details",
      sub: "Optional. Name, mobile for a receipt, email, notes.",
    });
    expect(DOOR_PAY_CODE_BUYER_NOTE).toBe("They type their own details on their phone.");
    expect(DOOR_NOTES_PLACEHOLDER).toBe("e.g. Paid by bank transfer to the venue");
    expect(DOOR_NOTES_PLACEHOLDER).not.toMatch(/[£$€₦]/);
  });

  test("the notes counter shows only from 400 of 500", () => {
    expect(doorNotesCounter(0, 500)).toBeNull();
    expect(doorNotesCounter(399, 500)).toBeNull();
    expect(doorNotesCounter(400, 500)).toBe("400 / 500");
    expect(doorNotesCounter(500, 500)).toBe("500 / 500");
  });
});

describe("P7 pay code pill", () => {
  const now = Date.parse("2026-11-07T20:00:00.000Z");
  const at = (seconds: number): string => new Date(now + seconds * 1000).toISOString();

  test("the countdown sits in the pill, in words for a screen reader", () => {
    expect(doorPayWaitingPillText("9:42")).toBe("Point your camera here · 9:42");
    expect(doorPayCountdownSeconds(at(582), now)).toBe(582);
    expect(doorPayCountdownWords(582)).toBe("Code expires in 9 minutes 42 seconds");
    expect(doorPayCountdownWords(60)).toBe("Code expires in 1 minute");
    expect(doorPayCountdownWords(1)).toBe("Code expires in 1 second");
    expect(doorPayCountdownWords(0)).toBe("Code expires in 0 seconds");
  });

  test("past or unreadable times read zero; under a minute is urgent", () => {
    expect(doorPayCountdownSeconds(at(-30), now)).toBe(0);
    expect(doorPayCountdownSeconds("not a time", now)).toBe(0);
    expect(DOOR_PAY_URGENT_SECONDS).toBe(60);
    expect(59 < DOOR_PAY_URGENT_SECONDS).toBe(true);
  });
});

describe("P8 the typed name rides the tap draft", () => {
  const draftOf = (href: string): string =>
    decodeURIComponent(href.slice(href.indexOf("draft=") + "draft=".length));

  test("any script survives the trip; no name means no field", () => {
    const named = parseTapToPayDraft(
      draftOf(doorTapNewSaleHref("event-1", { lines: [{ ticketTypeId: "t1", quantity: 2 }], eventDateId: null, buyerName: "Adaeze Ọkafọ́ 李" })),
    );
    expect(named?.buyerName).toBe("Adaeze Ọkafọ́ 李");
    expect(named?.lines).toEqual([{ ticketTypeId: "t1", quantity: 2 }]);

    const plain = parseTapToPayDraft(
      draftOf(doorTapNewSaleHref("event-1", { lines: [{ ticketTypeId: "t1", quantity: 1 }], eventDateId: null })),
    );
    expect(plain).not.toBeNull();
    expect(plain).not.toHaveProperty("buyerName");
  });
});

describe("P9 Sell another starts clean for the next guest", () => {
  test("tickets and date stay; name, phone and phone country go", () => {
    const next = sellAnotherDraft({
      lines: [{ ticketTypeId: "t1", quantity: 3 }],
      eventDateId: "date-1",
      buyerPhone: "+447700900123",
      phoneCountryIso: "GB",
      buyerName: "Ada Obi",
    });
    expect(next).toEqual({
      lines: [{ ticketTypeId: "t1", quantity: 3 }],
      eventDateId: "date-1",
      buyerPhone: null,
      phoneCountryIso: null,
    });
    const roundTrip = parseTapToPayDraft(encodeTapToPayDraft(next));
    expect(roundTrip).not.toHaveProperty("buyerName");
    expect(roundTrip?.buyerPhone).toBeNull();
  });
});
