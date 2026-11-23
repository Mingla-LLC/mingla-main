/**
 * #4490 spec 08 O2 fix round 3 — O2-B1: a live card payment is never a dead end.
 *
 * Staff who leave the scan sheet with a code still live ("Back to the Till", a
 * reload, reopening the check, the Till switch off and on) land on the SAME
 * waiting panel when they open Pay again: the code, the QR, the countdown,
 * Text them the link, Cancel payment. A live tap with no reader to resume shows
 * waiting with a working cancel. No live payment: the method list, as before.
 *
 * fails-on-revert: resumeLivePayment and the sheet's use of it are pinned here.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

import type { TillPayment, TillSale } from "../../../../services/venueTillService";
import { resumeLivePayment } from "../tillPayModel";
import { tillTapResumedCopy } from "../tillTapPanelModel";
import { TILL_COPY } from "../tillCopy";

const SHEET = fs.readFileSync(path.join(__dirname, "../PaymentSheet.tsx"), "utf8");
const TAP = fs.readFileSync(path.join(__dirname, "../TillTapPanel.tsx"), "utf8");

const NOW = Date.parse("2026-11-22T12:00:00Z");
const inFuture = new Date(NOW + 10 * 60_000).toISOString();
const inPast = new Date(NOW - 60_000).toISOString();

const pay = (over: Partial<TillPayment>): TillPayment => ({
  id: "p1",
  method: "scan",
  state: "pending",
  amountMinor: 440000,
  serviceChargeMinor: 0,
  tipMinor: 0,
  cashGivenMinor: null,
  changeMinor: null,
  paidLate: false,
  paidAt: null,
  reference: "R1",
  refundedMinor: 0,
  receiptSends: 0,
  chargedMinor: 440000,
  providerChannel: null,
  cardBrand: null,
  cardLast4: null,
  lateKept: false,
  payCode: null,
  ...over,
});
const code = (over: Record<string, unknown> = {}): TillPayment["payCode"] =>
  ({ code: "TH6GXPVJ", status: "open", expiresAt: inFuture, payStarted: false, textLinksLeft: 3, ...over }) as TillPayment["payCode"];
const sale = (payments: TillPayment[], state: TillSale["state"] = "paying"): TillSale =>
  ({ id: "s1", state, payments }) as unknown as TillSale;

describe("O2-B1 — what the pay sheet opens on", () => {
  test("a live scan code opens the scan waiting panel for that code", () => {
    const r = resumeLivePayment(sale([pay({ payCode: code() })]), NOW);
    expect(r.kind).toBe("scan");
    expect(r.kind === "scan" && r.code).toBe("TH6GXPVJ");
  });

  test("a code the guest has started paying on still opens (the 'guest is paying' state)", () => {
    expect(resumeLivePayment(sale([pay({ payCode: code({ status: "opened", payStarted: true }) })]), NOW).kind).toBe("scan");
  });

  test("a live tap payment opens the tap waiting panel (with cancel)", () => {
    const r = resumeLivePayment(sale([pay({ method: "tap", payCode: null })]), NOW);
    expect(r.kind).toBe("tap");
  });

  test("no live payment: the method list", () => {
    expect(resumeLivePayment(sale([], "open"), NOW).kind).toBe("none");
    expect(resumeLivePayment(null, NOW).kind).toBe("none");
    expect(resumeLivePayment(sale([pay({ method: "cash", payCode: null })], "open"), NOW).kind).toBe("none");
  });

  test("paid, cancelled, expired and past-time codes keep their own states (method list)", () => {
    expect(resumeLivePayment(sale([pay({ state: "paid", payCode: code({ status: "paid" }) })]), NOW).kind).toBe("none");
    expect(resumeLivePayment(sale([pay({ state: "cancelled", payCode: code({ status: "cancelled" }) })]), NOW).kind).toBe("none");
    expect(resumeLivePayment(sale([pay({ payCode: code({ status: "expired" }) })]), NOW).kind).toBe("none");
    expect(resumeLivePayment(sale([pay({ payCode: code({ expiresAt: inPast }) })]), NOW).kind).toBe("none");
    expect(resumeLivePayment(sale([pay({ state: "failed", method: "tap" })]), NOW).kind).toBe("none");
  });

  test("a check that is paid or voided never resumes", () => {
    expect(resumeLivePayment(sale([pay({ payCode: code() })], "paid"), NOW).kind).toBe("none");
    expect(resumeLivePayment(sale([pay({ payCode: code() })], "voided"), NOW).kind).toBe("none");
  });

  test("a malformed code in the projection is never drawn", () => {
    expect(resumeLivePayment(sale([pay({ payCode: code({ code: "nope" }) })]), NOW).kind).toBe("none");
  });
});

describe("O2-B1 — the sheet uses it, with the existing panels", () => {
  test("the sheet resumes through resumeLivePayment and reads the code back for its link", () => {
    expect(SHEET).toMatch(/resumeLivePayment\(sale, Date\.now\(\)\)/);
    expect(SHEET).toMatch(/scanApi\s*\n?\s*\.fetchStatus\(live\.code\)/);
    expect(SHEET).toMatch(/setStep\("scan"\)/);
  });

  test("a live tap goes to the existing tap panel in resumed mode", () => {
    expect(SHEET).toMatch(/setTapResumed\(true\)/);
    expect(SHEET).toMatch(/resumed=\{tapResumed\}/);
  });

  test("one scan panel only (no second component was built)", () => {
    expect(SHEET.match(/<TillScanPanel/g)?.length).toBe(1);
  });

  test("a resumed tap starts no reader and cancels through pay_card_cancel", () => {
    expect(TAP).toMatch(/if \(resumed\) return undefined;/);
    expect(TAP).toMatch(/await cancelTillCardPayment\(\{ venueId, paymentId \}\);\s*\n\s*onScanInstead\(\);/);
    expect(TAP).toMatch(/testID="till-tap-cancel-resumed"/);
  });
});

describe("O2-B1 — the resumed tap panel's words (existing copy only)", () => {
  test("waiting title, no error, not busy (the sheet can be left)", () => {
    const c = tillTapResumedCopy();
    expect(c.title).toBe(TILL_COPY.waitingForPayment);
    expect(c.danger).toBeNull();
    expect(c.busy).toBe(false);
  });
});
