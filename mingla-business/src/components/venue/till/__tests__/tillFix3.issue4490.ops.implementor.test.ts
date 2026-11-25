/**
 * #4490 spec 08 O2 fix round 3 — O2-B1: a live card payment is never a dead end.
 *
 * Staff who leave the scan sheet with a code still live ("Back to the Till", a
 * reload, reopening the check, the Till switch off and on) land on the SAME
 * waiting panel when they open Pay again: the code, the QR, the countdown,
 * Text them the link, Cancel payment. A live tap with no reader to resume shows
 * waiting with a working cancel. No live payment: the method list, as before.
 *
 * fails-on-revert: resumeLivePayment is pinned here; the sheet's and the tap
 * panel's use of it are pins `till-pay-sheet-resume` / `till-tap-panel-resumed`
 * in the host-wiring gate.
 *
 * TEST-MOD-APPROVED #4490 (08-O3 fix 1, O3-T7): the source-text reads of this suite moved, word for word, into
 * .github/scripts/strict-grep/issue-4490-host-wiring.mjs (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN: "for a genuine
 * structural rule, an additive strict-grep gate", as #4490 W3 fix 1 did); every behavioural test stays here.
 */
import { describe, expect, test } from "@jest/globals";

import type { TillPayment, TillSale } from "../../../../services/venueTillService";
import { resumeLivePayment } from "../tillPayModel";
import { tillTapResumedCopy } from "../tillTapPanelModel";
import { TILL_COPY } from "../tillCopy";


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

describe("O2-B1 — the resumed tap panel's words (existing copy only)", () => {
  test("waiting title, no error, not busy (the sheet can be left)", () => {
    const c = tillTapResumedCopy();
    expect(c.title).toBe(TILL_COPY.waitingForPayment);
    expect(c.danger).toBeNull();
    expect(c.busy).toBe(false);
  });
});
