/**
 * #4490 spec 08 O4 — the split sheet's display model, the share-scoped resume,
 * the deposit and session rows, and the service mapping. Every amount the Till
 * sends or records is the server's; these previews must equal what the server
 * answers (the pg17 suite issue_4490_ops_split pins the same numbers: S-2 and
 * S-3), and a by-item payload carries units only.
 *
 * Fails on revert: evenPreview back to one floor of the total (S-2's
 * 366.74 / 366.73 / 366.73 is lost when base and service charge remainders
 * differ); resumeLivePayment without the share scope resumes another share's
 * card payment on opening.
 */

import {
  assignmentComplete,
  byItemPayload,
  byItemPreview,
  evenPreview,
  floorSplit,
  isSplit,
  resizeAssignment,
  setUnits,
  splitUnits,
  unassigned,
  unitsElsewhere,
} from "../splitModel";
import { resumeLivePayment } from "../tillPayModel";
import { basketRows, extendMinutes, sessionClocks, sessionLengths } from "../tillModel";
import { mapTillSale, type TillSale } from "../../../../services/venueTillService";
import { TILL_COPY, TILL_ERROR_COPY } from "../tillCopy";

const item = (id: string, quantity: number, lineTotalMinor: number) => ({
  id,
  menuItemId: "m",
  name: `Item ${id}`,
  quantity,
  unitMinor: lineTotalMinor / quantity,
  lineTotalMinor,
  notes: null,
  modifiers: [],
  voided: false,
  prepState: "pending",
});

function sale(over: Partial<TillSale> = {}): TillSale {
  return mapTillSale({
    id: "s1",
    venueId: "v1",
    state: "open",
    currency: "NGN",
    subtotalMinor: 416667,
    serviceChargeMinor: 41667,
    totalDueMinor: 458334,
    paidMinor: 0,
    remainingMinor: 458334,
    version: 5,
    lines: [
      {
        id: "round1",
        kind: "menu_round",
        state: "held",
        amountMinor: 458334,
        items: [item("a", 3, 300000), item("b", 1, 50001), item("c", 2, 66666)],
      },
    ],
    payments: [],
    shares: [],
    split: { evenOnly: false, unitsPaid: {}, serviceChargeLeftMinor: 41667 },
    ...over,
  });
}

describe("evenly (spec 08 §3 O4): floor split, remainder minor units to the first shares", () => {
  it("adds up to what is left for n = 2..20 on odd totals, with and without service charge", () => {
    for (const [left, sc] of [[100018, 0], [110020, 10002], [112523, 12505], [7, 0]] as const) {
      for (let n = 2; n <= 20; n += 1) {
        if (left < n) continue;
        const shares = evenPreview(left, sc, n);
        expect(shares).toHaveLength(n);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(left);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(2);
      }
    }
  });
  it("matches the server's 1,100.20 in 3 (base and service charge each split)", () => {
    expect(evenPreview(110020, 10002, 3)).toEqual([36674, 36673, 36673]);
    expect(floorSplit(10, 3)).toEqual([4, 3, 3]);
  });
});

describe("by item: every unit once; service charge pro rata, remainder on share 1", () => {
  const s = sale();
  const units = splitUnits(s);
  it("lists every unpaid unit of every line", () => {
    expect(units.map((u) => [u.key, u.unitsLeft])).toEqual([["i:a", 3], ["i:b", 1], ["i:c", 2]]);
  });
  it("matches the server's split for 3 (pg17 S-3: 1,100.01 / 1,650.01 / 1,833.32)", () => {
    let a = resizeAssignment([], 3);
    a = setUnits(a, 0, "i:a", 1);
    a = setUnits(a, 1, "i:a", 1);
    a = setUnits(a, 1, "i:b", 1);
    a = setUnits(a, 2, "i:a", 1);
    a = setUnits(a, 2, "i:c", 2);
    expect(assignmentComplete(units, a)).toBe(true);
    expect(byItemPreview(units, a, 41667)).toEqual([110001, 165001, 183332]);
    expect(unassigned(units, a)).toEqual({ units: 0, valueMinor: 0 });
    // The server gets units, never an amount.
    expect(byItemPayload(units, a)).toEqual([
      { items: [{ orderItemId: "a", units: 1 }] },
      { items: [{ orderItemId: "a", units: 1 }, { orderItemId: "b", units: 1 }] },
      { items: [{ orderItemId: "a", units: 1 }, { orderItemId: "c", units: 2 }] },
    ]);
  });
  it("is not complete until every unit has a share and no share is empty", () => {
    let a = resizeAssignment([], 2);
    a = setUnits(a, 0, "i:a", 3);
    expect(assignmentComplete(units, a)).toBe(false);
    expect(unassigned(units, a).units).toBe(3);
    expect(unitsElsewhere(a, "i:a", 1)).toBe(3);
    a = setUnits(a, 0, "i:b", 1);
    a = setUnits(a, 0, "i:c", 2);
    expect(assignmentComplete(units, a)).toBe(false); // share 2 has nothing
  });
  it("after a share is paid, only the units it did not take are left", () => {
    const paid = sale({
      shares: [{ id: "sh1", shareNo: 1, mode: "by_item", state: "paid", amountMinor: 110001, serviceChargeMinor: 10001,
        setVersion: 4, paymentId: "p1", items: [{ orderItemId: "a", lineId: null, units: 1, amountMinor: 100000 }] }],
      split: { evenOnly: false, unitsPaid: { a: 1 }, serviceChargeLeftMinor: 31666 },
    });
    const left = splitUnits(paid);
    expect(left.find((u) => u.key === "i:a")).toMatchObject({ unitsLeft: 2, valueLeft: 200000 });
    expect(isSplit(paid)).toBe(false);
  });
});

describe("a share's live payment is resumed only for that share", () => {
  const pending = (id: string, shareId: string | null) => ({
    id, method: "tap", state: "pending", amountMinor: 1000, tipMinor: 0, shareId, payCode: null,
  });
  it("opening the sheet never resumes another share's card payment", () => {
    const s = sale({ state: "paying", payments: [pending("p-share", "sh2")] as never });
    expect(resumeLivePayment(s, Date.now()).kind).toBe("none");
    expect(resumeLivePayment(s, Date.now(), "sh2").kind).toBe("tap");
    expect(resumeLivePayment(s, Date.now(), "sh3").kind).toBe("none");
  });
  it("a whole-check payment still resumes as before", () => {
    const s = sale({ state: "paying", payments: [pending("p-whole", null)] as never });
    expect(resumeLivePayment(s, Date.now()).kind).toBe("tap");
  });
});

describe("deposit and session rows (T12, A10, T13)", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const s = sale({
    lines: [
      { id: "dep", kind: "deposit_credit", state: "held", amountMinor: 500000, label: "Deposit paid online" },
      { id: "hour1", kind: "by_the_hour", state: "held", amountMinor: 1200000, label: "Boardroom" },
      { id: "hour2", kind: "by_the_hour", state: "held", amountMinor: 600000, label: "Boardroom · +30 min" },
    ] as never,
    hourSessions: [
      { lineId: "hour1", rootLineId: "hour1", startsAt: "2026-11-23T11:00:00Z", endsAt: "2026-11-23T12:00:00Z", unitName: "Boardroom", stepMinutes: 30 },
      { lineId: "hour2", rootLineId: "hour1", startsAt: "2026-11-23T12:00:00Z", endsAt: "2026-11-23T12:30:00Z", unitName: "Boardroom", stepMinutes: 30 },
    ],
  });
  it("shows the deposit as money off and a session as its own row", () => {
    const rows = basketRows(s, now);
    expect(rows.find((r) => r.lineId === "dep")).toMatchObject({ kind: "deposit", amountMinor: -500000 });
    expect(rows.find((r) => r.lineId === "hour1")?.kind).toBe("session");
  });
  it("one clock per session, ending where its last block ends", () => {
    expect(sessionClocks(s, now)).toEqual([expect.objectContaining({ rootLineId: "hour1", minutesLeft: 30, overBy: null })]);
    expect(sessionClocks(s, Date.parse("2026-11-23T12:41:00Z"))[0]).toMatchObject({ minutesLeft: null, overBy: 11 });
  });
  it("Add 30 min is at least 30 minutes on the offer's step; start lengths follow the step", () => {
    expect([extendMinutes(15), extendMinutes(30), extendMinutes(60)]).toEqual([30, 30, 60]);
    expect(sessionLengths(60, 120, 30)).toEqual([60, 90, 120]);
    expect(TILL_COPY.addMinutes(30)).toBe("Add 30 min");
    expect(TILL_COPY.nextBookingAt("Pool table 1", "20:00")).toBe("The next booking for Pool table 1 is at 20:00.");
  });
});

describe("the service maps what the server sends", () => {
  it("shares, the split, the deposit, the minimum spend and the sessions", () => {
    const s = mapTillSale({
      id: "s",
      payments: [{ id: "p", shareId: "sh1" }],
      shares: [{ id: "sh1", shareNo: 2, mode: "even", state: "paying", amountMinor: 5, serviceChargeMinor: 1, setVersion: 3, items: [] }],
      split: { evenOnly: true, unitsPaid: { x: 2 }, serviceChargeLeftMinor: 9 },
      creditMinor: 500000,
      creditUsedMinor: 330000,
      minimumSpend: { minimumMinor: 5000000, spentMinor: 2000000, shortMinor: 3000000 },
      hourSessions: [{ lineId: "l", rootLineId: "l", endsAt: "2026-11-23T12:00:00Z", stepMinutes: 30 }],
    });
    expect(s.payments[0]?.shareId).toBe("sh1");
    expect(s.shares?.[0]).toMatchObject({ shareNo: 2, mode: "even", state: "paying" });
    expect(s.split).toEqual({ evenOnly: true, unitsPaid: { x: 2 }, serviceChargeLeftMinor: 9 });
    expect([s.creditMinor, s.creditUsedMinor, s.minimumSpend?.shortMinor]).toEqual([500000, 330000, 3000000]);
    expect(s.hourSessions?.[0]?.stepMinutes).toBe(30);
    // An older server: nothing new, nothing broken.
    const old = mapTillSale({ id: "s" });
    expect([old.shares, old.split?.evenOnly, old.minimumSpend, old.hourSessions]).toEqual([[], false, null, []]);
  });
  it("every O4 refusal has its own words", () => {
    expect(TILL_ERROR_COPY.till_split_after_part_payment).toBe("Part of this bill is already paid. Split the rest evenly.");
    expect(TILL_ERROR_COPY.deposit_already_used).toBe("This booking's deposit is already on another check.");
    expect(TILL_ERROR_COPY.till_room_not_ready.startsWith("Charge to room comes with stays")).toBe(true);
  });
});
