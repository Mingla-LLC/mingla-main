/**
 * #4271 door polish — tester adversarial (pure rules).
 *
 * Attacks the angles the implementor's happy-path suite does not:
 *   A1  drafts: an OLD draft (plain btoa, no buyerName) still parses to the same
 *       shape; a typed name in any script (emoji, CJK, Arabic, combining marks,
 *       JSON-hostile characters) survives the sheet -> tap route trip; the sheet's
 *       encoder never throws on a non-Latin-1 name (the old btoa did);
 *       "Sell another" (decodeDoorTapDraft, atob) still recovers the tickets from
 *       a UTF-8 draft and never hands the previous guest's name onward; a crafted
 *       non-string name is dropped instead of rendered.
 *   A2  the dock says exactly one thing, by priority, for every combination of facts.
 *   A3  the refund helper and send gate at every boundary (trimmed vs raw length).
 *   A4  the pay code countdown at 0, negative, unreadable and the 60s boundary,
 *       and the pill agrees with the clock text at every sampled millisecond.
 *   A5  the money tones: nothing where money may be real is ever grey or green.
 *
 * FAILS-ON-REVERT (recorded on #4271): putting `btoa(` back in
 * encodeDoorTapDraft fails A1 "never throws"; dropping the buyerName field from
 * parseTapToPayDraft fails A1 round-trips.
 */
import { describe, expect, test } from "@jest/globals";

import { decodeDoorTapDraft } from "../doorTapDraft";
import { encodeDoorTapDraft } from "../doorTapDraftHref";
import {
  encodeTapToPayDraft,
  parseTapToPayDraft,
} from "../../../services/terminal/tapToPayDraft";
import {
  doorDockMessage,
  DOOR_ACCESS_CHECK_FAILED,
  DOOR_BANK_MISSING,
  type DoorDockMessageFacts,
} from "../doorPaymentOptions";
import { refundReasonHelper, refundReasonSendGate } from "../../../utils/refundReason";
import {
  DOOR_PAY_URGENT_SECONDS,
  doorPayCountdownSeconds,
  doorPayCountdownWords,
  formatDoorPayCountdown,
} from "../doorPayCodeState";
import { tapSaleTone, type TapEndKind } from "../tap/tapSaleTone";
import { doorPayHostTone } from "../doorTone";

const LINES = [{ ticketTypeId: "11111111-2222-3333-4444-555555555555", quantity: 2 }];

describe("A1 the tap draft carries a typed name safely", () => {
  test("an old draft (plain btoa, no name) still parses to exactly the old shape", () => {
    const old = btoa(
      JSON.stringify({ lines: LINES, eventDateId: "date-1", buyerPhone: "+447700900123" }),
    );
    const parsed = parseTapToPayDraft(old);
    expect(parsed).toEqual({
      lines: LINES,
      eventDateId: "date-1",
      buyerPhone: "+447700900123",
      phoneCountryIso: null,
    });
    expect(parsed).not.toHaveProperty("buyerName");
    // The same old draft, still percent-encoded the way Expo Router can hand it over.
    expect(parseTapToPayDraft(encodeURIComponent(old))?.lines).toEqual(LINES);
  });

  const names = [
    "Zoë Ångström",
    "Adébáyọ̀ Ọlọ́rúnṣọlá",
    "李小龙",
    "محمد علي",
    "Ana 🎉 Obi",
    "👩🏽‍🦱",
    'O"Brien \\ </script> \n tab\t',
  ];

  test.each(names)("the sheet's encoder never throws on %p", (name) => {
    expect(() => encodeDoorTapDraft({ lines: LINES, eventDateId: null, buyerName: name })).not.toThrow();
  });

  test.each(names)("%p survives sheet -> tap route, trimmed, byte for byte", (name) => {
    const raw = encodeDoorTapDraft({ lines: LINES, eventDateId: null, buyerName: name });
    // The sheet puts it in the URL with encodeURIComponent; the route may get either form.
    for (const handed of [raw, encodeURIComponent(raw)]) {
      const parsed = parseTapToPayDraft(handed);
      expect(parsed?.lines).toEqual(LINES);
      expect(parsed?.buyerName).toBe(name.trim());
    }
  });

  test.each(names)("%p survives the setup round trip (parse -> encode -> parse)", (name) => {
    const first = parseTapToPayDraft(encodeDoorTapDraft({ lines: LINES, eventDateId: "d", buyerName: name }));
    expect(first).not.toBeNull();
    const again = parseTapToPayDraft(encodeTapToPayDraft(first!));
    expect(again).toEqual(first);
  });

  test.each(names)("Sell another still gets the tickets back from a draft naming %p, and no name", (name) => {
    // The tap screen's Sell another is built with encodeTapToPayDraft; the door
    // page reads it with decodeDoorTapDraft (atob). A UTF-8 payload must not break it.
    const viaTap = encodeTapToPayDraft({
      lines: LINES,
      eventDateId: null,
      buyerPhone: "+447700900123",
      phoneCountryIso: "GB",
      buyerName: name,
    });
    const viaSheet = encodeDoorTapDraft({ lines: LINES, eventDateId: null, buyerName: name });
    for (const raw of [viaTap, viaSheet]) {
      const decoded = decodeDoorTapDraft(raw);
      expect(decoded?.lines).toEqual(LINES);
      // The next guest's sale never inherits the previous guest's name.
      expect(decoded).not.toHaveProperty("buyerName");
    }
  });

  test("an ASCII draft encodes exactly as btoa did (older readers keep working)", () => {
    const draft = { lines: LINES, eventDateId: "d", buyerPhone: "+447700900123", buyerName: "Ada Obi" };
    const expected = btoa(
      JSON.stringify({ lines: LINES, eventDateId: "d", buyerPhone: "+447700900123", buyerName: "Ada Obi" }),
    );
    expect(encodeDoorTapDraft(draft)).toBe(expected);
  });

  test.each([
    ["blank", "   "],
    ["a number", 42],
    ["an object", { first: "Ada" }],
    ["null", null],
  ])("a crafted draft whose name is %s shows no Guest row", (_label, value) => {
    const raw = btoa(JSON.stringify({ lines: LINES, eventDateId: null, buyerName: value }));
    const parsed = parseTapToPayDraft(raw);
    expect(parsed?.lines).toEqual(LINES);
    expect(parsed).not.toHaveProperty("buyerName");
  });

  test("a crafted over-long name is capped, the tickets are untouched", () => {
    const raw = btoa(JSON.stringify({ lines: LINES, eventDateId: null, buyerName: "x".repeat(5000) }));
    const parsed = parseTapToPayDraft(raw);
    expect(parsed?.buyerName).toHaveLength(120);
    expect(parsed?.lines).toEqual(LINES);
  });

  test("the name never changes what is charged: same lines, same date, same phone", () => {
    const withName = parseTapToPayDraft(
      encodeDoorTapDraft({ lines: LINES, eventDateId: "d", buyerPhone: "+447700900123", buyerName: "Ada" }),
    );
    const without = parseTapToPayDraft(
      encodeDoorTapDraft({ lines: LINES, eventDateId: "d", buyerPhone: "+447700900123" }),
    );
    const { buyerName: _ignored, ...rest } = withName!;
    expect(rest).toEqual(without);
  });
});

describe("A2 the dock says one thing, highest priority wins", () => {
  const TAX = "tax refusal";
  const all: DoorDockMessageFacts = {
    taxRefused: true,
    accessCheckFailed: true,
    error: "Pick at least one ticket first.",
    bankMissing: true,
    cardQuotePending: "tap_to_pay",
  };

  // Every combination of the five facts: the answer is the highest one set.
  const combos: DoorDockMessageFacts[] = [];
  for (let mask = 0; mask < 32; mask += 1) {
    for (const quote of ["tap_to_pay", "pay_code"] as const) {
      combos.push({
        taxRefused: (mask & 1) !== 0,
        accessCheckFailed: (mask & 2) !== 0,
        error: (mask & 4) !== 0 ? "Pick a date first." : null,
        bankMissing: (mask & 8) !== 0,
        cardQuotePending: (mask & 16) !== 0 ? quote : null,
      });
    }
  }

  test.each(combos.map((c) => [JSON.stringify(c), c] as const))("%s", (_name, facts) => {
    const message = doorDockMessage(facts, TAX);
    if (facts.taxRefused) expect(message).toEqual({ text: TAX, tone: "error" });
    else if (facts.accessCheckFailed) expect(message).toEqual({ text: DOOR_ACCESS_CHECK_FAILED, tone: "error" });
    else if (facts.error !== null) expect(message).toEqual({ text: facts.error, tone: "error" });
    else if (facts.bankMissing) expect(message).toEqual({ text: DOOR_BANK_MISSING, tone: "hint" });
    else if (facts.cardQuotePending === "tap_to_pay")
      expect(message?.text).toBe("The tap screen shows the final total, with any fees.");
    else if (facts.cardQuotePending === "pay_code")
      expect(message?.text).toBe("The pay code shows the final total, with any fees.");
    else expect(message).toBeNull();
  });

  test("errors are errors, hints are hints", () => {
    expect(doorDockMessage(all, TAX)?.tone).toBe("error");
    expect(doorDockMessage({ ...all, taxRefused: false, accessCheckFailed: false, error: null }, TAX)?.tone).toBe("hint");
  });
});

describe("A3 refund reason: one line, the 10 to 200 rule unchanged", () => {
  const helper = (text: string, pressedShort = false) =>
    refundReasonHelper({
      trimmedLength: text.trim().length,
      length: text.length,
      minLength: 10,
      maxLength: 200,
      pressedShort,
    });

  test("spaces never count toward the minimum", () => {
    expect(helper("          ").text).toBe("At least 10 characters.");
    expect(helper("   Ill    ").text).toBe("7 more characters needed.");
    expect(helper("   Ill    ", true)).toEqual({
      text: "7 more characters needed. Reasons need at least 10.",
      tone: "error",
      counter: null,
    });
    expect(helper("  123456789  ").text).toBe("1 more character needed.");
    expect(helper("  1234567890  ")).toEqual({ text: "", tone: "hint", counter: null });
  });

  test("the counter follows what the box holds, from 180, and stays with the error", () => {
    expect(helper("a".repeat(179)).counter).toBeNull();
    expect(helper("a".repeat(180)).counter).toBe("180 / 200");
    expect(helper("a".repeat(200)).counter).toBe("200 / 200");
    // 185 spaces and 3 letters: short, red after a press, and the counter still shows.
    const padded = `${" ".repeat(185)}abc`;
    expect(helper(padded, true)).toEqual({
      text: "7 more characters needed. Reasons need at least 10.",
      tone: "error",
      counter: "188 / 200",
    });
  });

  test("the send gate matrix is unchanged", () => {
    const gate = (trimmedLength: number, otherwiseReady = true) =>
      refundReasonSendGate({ trimmedLength, minLength: 10, maxLength: 200, otherwiseReady });
    expect(gate(0)).toEqual({ enabled: true, onPress: "show_reason_error" });
    expect(gate(9)).toEqual({ enabled: true, onPress: "show_reason_error" });
    expect(gate(10)).toEqual({ enabled: true, onPress: "submit" });
    expect(gate(200)).toEqual({ enabled: true, onPress: "submit" });
    expect(gate(201)).toEqual({ enabled: false, onPress: "none" });
    expect(gate(5, false)).toEqual({ enabled: false, onPress: "none" });
    expect(gate(50, false)).toEqual({ enabled: false, onPress: "none" });
  });
});

describe("A4 the pay code countdown", () => {
  const NOW = Date.parse("2026-11-07T20:00:00.000Z");
  const at = (msFromNow: number): string => new Date(NOW + msFromNow).toISOString();

  test("0, negative and unreadable read zero, never below", () => {
    expect(doorPayCountdownSeconds(at(0), NOW)).toBe(0);
    expect(doorPayCountdownSeconds(at(-1), NOW)).toBe(0);
    expect(doorPayCountdownSeconds(at(-3_600_000), NOW)).toBe(0);
    expect(doorPayCountdownSeconds("not a date", NOW)).toBe(0);
    expect(doorPayCountdownSeconds("", NOW)).toBe(0);
    expect(doorPayCountdownWords(doorPayCountdownSeconds(at(-5000), NOW))).toBe("Code expires in 0 seconds");
  });

  test("the 60 second boundary: 60 is not urgent, 59.999 is", () => {
    expect(doorPayCountdownSeconds(at(60_000), NOW)).toBe(60);
    expect(doorPayCountdownSeconds(at(60_000), NOW) < DOOR_PAY_URGENT_SECONDS).toBe(false);
    expect(doorPayCountdownSeconds(at(59_999), NOW)).toBe(59);
    expect(doorPayCountdownSeconds(at(59_999), NOW) < DOOR_PAY_URGENT_SECONDS).toBe(true);
    expect(doorPayCountdownWords(60)).toBe("Code expires in 1 minute");
    expect(doorPayCountdownWords(61)).toBe("Code expires in 1 minute 1 second");
    expect(doorPayCountdownWords(59)).toBe("Code expires in 59 seconds");
    expect(doorPayCountdownWords(582)).toBe("Code expires in 9 minutes 42 seconds");
    expect(doorPayCountdownWords(1)).toBe("Code expires in 1 second");
  });

  test("the pill's seconds, its words and the clock text never disagree", () => {
    for (let ms = -2000; ms <= 130_000; ms += 137) {
      const seconds = doorPayCountdownSeconds(at(ms), NOW);
      const clock = formatDoorPayCountdown(at(ms), NOW);
      const [m, s] = clock.split(":").map(Number);
      expect(m * 60 + s).toBe(seconds);
      expect(doorPayCountdownWords(seconds)).not.toMatch(/-|NaN/);
    }
  });
});

describe("A5 colour tells the truth about money", () => {
  const kinds: TapEndKind[] = [
    "approved",
    "declined",
    "needs_pin",
    "timed_out",
    "cancelled",
    "failed",
    "unknown_result",
    "save_failed",
    "reader_problem",
    "not_on_this_phone",
    "ios_update_required",
  ];

  test("money that may be real is amber, never grey and never green", () => {
    expect(tapSaleTone("unknown_result")).toBe("caution");
    expect(tapSaleTone("save_failed")).toBe("caution");
    expect(doorPayHostTone("checking")).toBe("caution");
    expect(doorPayHostTone("payment_landing")).toBe("caution");
  });

  test("only an approved sale is green", () => {
    for (const kind of kinds) {
      expect(tapSaleTone(kind) === "ok").toBe(kind === "approved");
    }
    expect(doorPayHostTone("paid")).toBe("ok");
  });

  test("a reader problem with no named problem is grey, not red", () => {
    expect(tapSaleTone("reader_problem", null)).toBe("neutral");
  });
});
