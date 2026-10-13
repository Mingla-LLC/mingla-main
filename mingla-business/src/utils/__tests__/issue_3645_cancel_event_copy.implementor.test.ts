/**
 * issue #3645 — the cancel-event dialog and toast stop showing internal
 * wording when there is nothing to refund, and say nothing new when there may
 * be.
 *
 * Live test, 2026-10-13: the dialog read "…refunded automatically when those
 * wire up (B-cycle)" on an event with no sales.
 *
 * "Nothing sold" has to be KNOWN. A loading, failed or stale orders read, or
 * an event that takes payments at the door, is "may have sold", and that
 * branch keeps the caller's existing copy untouched (approved on #3645: sold
 * wording waits until refund behaviour is confirmed).
 *
 * That both cancel surfaces (the event manage screen and the events hub) feed
 * the rule from their own orders read, and that their sold-branch strings are
 * unchanged, is enforced by the strict-grep gate
 * .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs, group E-j.
 */

import { describe, expect, test } from "@jest/globals";

import {
  CANCEL_EVENT_NOTHING_SOLD_DESCRIPTION,
  CANCEL_EVENT_NOTHING_SOLD_TOAST,
  cancelEventDialogDescription,
  cancelEventDoneToast,
  countSoldTickets,
  nothingSoldIsKnown,
} from "../cancelEventCopy";

const EXISTING_DIALOG =
  "This is serious. Buyers will be notified by email and refunded automatically when those wire up (B-cycle). You can't undo this.";
const EXISTING_TOAST =
  "Event cancelled. Buyers will be refunded when emails wire up (B-cycle).";

describe("#3645 countSoldTickets", () => {
  test("counts tickets still held on paid and partly refunded orders", () => {
    expect(
      countSoldTickets([
        { status: "paid", lines: [{ quantity: 2, refundedQuantity: 0 }] },
        { status: "refunded_partial", lines: [{ quantity: 3, refundedQuantity: 1 }] },
      ]),
    ).toBe(4);
  });

  test("pending, failed, cancelled and fully refunded orders hold no tickets", () => {
    expect(
      countSoldTickets([
        { status: "pending", lines: [{ quantity: 2, refundedQuantity: 0 }] },
        { status: "failed", lines: [{ quantity: 1, refundedQuantity: 0 }] },
        { status: "cancelled", lines: [{ quantity: 1, refundedQuantity: 0 }] },
        { status: "refunded_full", lines: [{ quantity: 2, refundedQuantity: 2 }] },
        { status: "refunded_partial", lines: [{ quantity: 2, refundedQuantity: 2 }] },
      ]),
    ).toBe(0);
    expect(countSoldTickets([])).toBe(0);
  });

  test("a refunded quantity above the bought quantity never goes negative", () => {
    expect(
      countSoldTickets([{ status: "paid", lines: [{ quantity: 1, refundedQuantity: 5 }] }]),
    ).toBe(0);
  });
});

describe("#3645 nothingSoldIsKnown", () => {
  const known = {
    ordersStatus: "ready",
    onlineSoldCount: 0,
    doorSoldCount: 0,
    doorSalesEnabled: false,
  };

  test("orders read complete, no online sale, no door sale, door sales off", () => {
    expect(nothingSoldIsKnown(known)).toBe(true);
  });

  test.each([
    ["orders still loading", { ...known, ordersStatus: "loading" }],
    ["orders failed to load", { ...known, ordersStatus: "error" }],
    ["orders shown from a stale copy", { ...known, ordersStatus: "stale-error" }],
    ["orders not read at all", { ...known, ordersStatus: "disabled" }],
    ["orders status unknown", { ...known, ordersStatus: undefined }],
    ["one ticket sold online", { ...known, onlineSoldCount: 1 }],
    ["one ticket sold at the door on this device", { ...known, doorSoldCount: 1 }],
    ["door sales on (another device may have sold)", { ...known, doorSalesEnabled: true }],
  ])("%s → not known", (_label, input) => {
    expect(nothingSoldIsKnown(input)).toBe(false);
  });
});

describe("#3645 — the copy", () => {
  test("nothing sold: the approved sentence and the plain toast", () => {
    expect(cancelEventDialogDescription(true, EXISTING_DIALOG)).toBe(
      "No one has bought a ticket, so there is nothing to refund. You can't undo this.",
    );
    expect(cancelEventDoneToast(true, EXISTING_TOAST)).toBe("Event cancelled.");
    expect(CANCEL_EVENT_NOTHING_SOLD_DESCRIPTION).not.toMatch(/b-cycle|wire up/i);
    expect(CANCEL_EVENT_NOTHING_SOLD_TOAST).not.toMatch(/b-cycle|wire up|refund/i);
  });

  test("may have sold: exactly the caller's existing strings, unchanged", () => {
    expect(cancelEventDialogDescription(false, EXISTING_DIALOG)).toBe(EXISTING_DIALOG);
    expect(cancelEventDoneToast(false, EXISTING_TOAST)).toBe(EXISTING_TOAST);
  });

  test("the new copy promises nothing about refunds that happen", () => {
    expect(CANCEL_EVENT_NOTHING_SOLD_DESCRIPTION).not.toMatch(/will be refunded|automatically/i);
  });
});
