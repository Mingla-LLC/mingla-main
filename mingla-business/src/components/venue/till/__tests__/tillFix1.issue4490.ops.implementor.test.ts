/**
 * #4490 spec 08 O1 fix round 1 — the Till's corrections: a part payment does
 * not freeze the check (unpaid lines stay voidable), money beyond the new
 * total is shown to refund, a paid entry line is refundable by money rights,
 * a check moves only to a free table and is handed to someone else, a check
 * the old pad closed reads as paid there, realtime keeps only this check's
 * rows, and every refusal the payment path reaches has words.
 */

import {
  basketRows,
  handoverChoices,
  moveTargets,
  overpaidToRefund,
  rowCanVoid,
  rowRefundable,
  serverName,
  tillSaleChangeMatches,
} from "../tillModel";
import { tillErrorCopy } from "../tillCopy";
import { mapTillSale } from "../../../../services/venueTillService";

const round = (state: string, sent: boolean) => ({
  id: `l-${state}-${String(sent)}`,
  kind: "menu_round",
  state,
  amountMinor: 275000,
  orderId: "o1",
  sent,
  fulfillmentStatus: sent ? "placed" : "held",
  items: [{ id: `i-${state}-${String(sent)}`, menuItemId: "m1", name: "Chapman", quantity: 1, lineTotalMinor: 250000, voided: false }],
});

const partPaid = mapTillSale({
  id: "s1",
  venueId: "v1",
  state: "open",
  currency: "NGN",
  totalDueMinor: 550000,
  paidMinor: 100000,
  remainingMinor: 450000,
  version: 7,
  lines: [round("held", true), round("held", false)],
});

describe("#4490 O1 fix 1 — corrections on a part-paid check (O1-N3)", () => {
  it("keeps every unpaid line voidable after a part payment (the server checks who may void a sent one)", () => {
    const rows = basketRows(partPaid);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => rowCanVoid(partPaid, r))).toBe(true);
  });

  it("stops voids once the check is paid, while a payment is pending, and on voided rows", () => {
    const paid = mapTillSale({ ...partPaid, state: "paid", lines: [round("committed", true)] });
    expect(rowCanVoid(paid, basketRows(paid)[0])).toBe(false);
    const pending = mapTillSale({ ...partPaid, pendingPayment: true, lines: [round("held", false)] });
    expect(rowCanVoid(pending, basketRows(pending)[0])).toBe(false);
    const voided = mapTillSale({ ...partPaid, lines: [round("voided", false)] });
    expect(rowCanVoid(voided, basketRows(voided)[0])).toBe(false);
  });

  // TEST-MOD-APPROVED #4490 (08-O1 fix 2, O1-B2): the banner is now capped by
  // what is still refundable on the check's payments, so the fixture carries
  // the payment the extra money came from.
  it("shows money beyond the new total only once the check has closed", () => {
    const paidPayment = { id: "p1", method: "cash", state: "paid", amountMinor: 225000, tipMinor: 0, refundedMinor: 0 };
    expect(overpaidToRefund(mapTillSale({ ...partPaid, state: "paid", overpaidMinor: 125000, payments: [paidPayment] }))).toBe(125000);
    expect(overpaidToRefund(mapTillSale({ ...partPaid, overpaidMinor: 0 }))).toBe(0);
    expect(overpaidToRefund(null)).toBe(0);
  });
});

describe("#4490 O1 fix 1 — refunding an entry line (O1-N4)", () => {
  const entry = (state: string) =>
    mapTillSale({
      id: "s2",
      venueId: "v1",
      state: state === "committed" ? "paid" : "open",
      currency: "NGN",
      lines: [{ id: "e1", kind: "entry", state, amountMinor: 1000000, label: "Door entry", groupId: "g1" }],
    });

  it("offers a line refund on a paid entry, to money rights only", () => {
    const [row] = basketRows(entry("committed"));
    expect(rowRefundable(row, true)).toBe(true);
    expect(rowRefundable(row, false)).toBe(false);
  });

  it("never on an unpaid or already refunded entry", () => {
    expect(rowRefundable(basketRows(entry("held"))[0], true)).toBe(false);
    expect(rowRefundable(basketRows(entry("refunded"))[0], true)).toBe(false);
  });
});

describe("#4490 O1 fix 1 — moving and handing over a check (T9, open item b)", () => {
  const onT1 = mapTillSale({ id: "s3", venueId: "v1", state: "open", currency: "NGN", spotId: "t1" });

  it("moves only to a free table; the current one is marked, busy ones can't be picked", () => {
    const targets = moveTargets(
      [
        { id: "t1", label: "T1", hasCheck: true },
        { id: "t2", label: "T2", hasCheck: true },
        { id: "t3", label: "T3", hasCheck: false },
      ],
      onT1,
    );
    expect(targets).toEqual([
      { id: "t1", label: "T1", busy: false, current: true },
      { id: "t2", label: "T2", busy: true, current: false },
      { id: "t3", label: "T3", busy: false, current: false },
    ]);
  });

  it("hands over to anyone else who may sell here, and names people as the Till shows them", () => {
    const servers = [
      { userId: "u1", name: "Ada", openChecks: 2 },
      { userId: "u2", name: null, openChecks: 0 },
    ];
    expect(handoverChoices(servers, "u1").map((s) => s.userId)).toEqual(["u2"]);
    expect(serverName(servers, "u1", "Team member")).toBe("Ada");
    expect(serverName(servers, "u2", "Team member")).toBe("Team member");
    expect(serverName(servers, "zz", "Team member")).toBe("Team member");
  });
});

describe("#4490 O1 fix 1 — a check the old pad closed; realtime; refusals in words", () => {
  it("reads the pad's settlement from the server", () => {
    expect(mapTillSale({ id: "s4", state: "paid", settledOutside: "venue_collected" }).settledOutside).toBe("venue_collected");
    expect(mapTillSale({ id: "s4", state: "open", settledOutside: "something" }).settledOutside).toBeNull();
  });

  it("realtime keeps only this check's rows (the channel binds by venue, O1-N7)", () => {
    expect(tillSaleChangeMatches({ new: { id: "s1", venue_id: "v1" } }, "s1")).toBe(true);
    expect(tillSaleChangeMatches({ new: { id: "s9", venue_id: "v1" } }, "s1")).toBe(false);
    expect(tillSaleChangeMatches({ old: { id: "s1" } }, "s1")).toBe(true);
    expect(tillSaleChangeMatches(null, "s1")).toBe(false);
  });

  it("gives every refusal the tester's payment run reached its own words (never the generic retry)", () => {
    const generic = tillErrorCopy("till_failed");
    for (const code of [
      "guest_list_entry_on_check",
      "guest_list_arrived_invalid",
      "offer_option_unavailable",
      "offer_guests_out_of_range",
      "till_hold_lapsed",
      "till_tab_settled_on_pad",
      "till_round_settled_elsewhere",
    ]) {
      expect(tillErrorCopy(code)).not.toBe(generic);
    }
    expect(tillErrorCopy("guest_list_entry_on_check")).toBe("This guest is already on another check.");
    expect(tillErrorCopy("till_tab_settled_on_pad")).toBe("That tab is already closed.");
  });
});
