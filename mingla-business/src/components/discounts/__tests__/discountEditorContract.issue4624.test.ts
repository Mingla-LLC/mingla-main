// #4624 — the discount editor contract for "Specific offerings": scope labels,
// the orphan Save block on every scope, the Save-disabled reason (D4), sale
// price scope availability (D5) and the offering row copy (D6).
import { describe, expect, test } from "@jest/globals";

import type {
  DiscountDraft,
  DiscountOfferingRow,
} from "../../../services/discountService";
import {
  deletedOfferingTargets,
  DISCOUNT_SCOPE_LABELS,
  discountSaveBlockedReason,
  formatOfferingDate,
  groupDiscountOfferings,
  isDiscountDraftValid,
  isDiscountScopeAvailable,
  offeringCountLabel,
  offeringMeta,
} from "../discountEditorContract";

const draft = (patch: Partial<DiscountDraft> = {}): DiscountDraft => ({
  brandId: "brand-1",
  kind: "code",
  code: "ROOF10",
  name: "Rooftop ten",
  valueType: "percent",
  valueBps: 1000,
  valueMinor: null,
  scopeKind: "listings",
  combinesWith: "automatic_only",
  startsAt: "2027-01-01T00:00:00.000Z",
  endsAt: null,
  targets: [{ targetKind: "event", targetId: "e1", listingKind: null }],
  ...patch,
});

const row = (patch: Partial<DiscountOfferingRow> = {}): DiscountOfferingRow => ({
  id: "e1",
  offeringKind: "event",
  title: "Rooftop Night",
  status: "scheduled",
  discountsAllowed: true,
  paidTicketCount: 3,
  nextStartAt: "2026-12-12T19:00:00.000Z",
  lastEndAt: "2026-12-12T23:00:00.000Z",
  ...patch,
});

describe("#4624 discount editor contract", () => {
  test("every scope has a plain-words label for list rows", () => {
    expect(DISCOUNT_SCOPE_LABELS).toEqual({
      brand: "Entire brand",
      listing_kinds: "Offering types",
      listings: "Specific offerings",
      items: "Specific items",
    });
  });

  test("an orphaned target blocks Save on every scope", () => {
    const orphan = {
      targetKind: "event" as const,
      targetId: "gone",
      listingKind: null,
      orphanedAt: "2026-11-20T00:00:00.000Z",
    };
    expect(isDiscountDraftValid(draft(), 20)).toBe(true);
    expect(isDiscountDraftValid(draft({ targets: [orphan] }), 20)).toBe(false);
    expect(
      isDiscountDraftValid(
        draft({
          scopeKind: "items",
          targets: [{ ...orphan, targetKind: "ticket_type" }],
        }),
        20,
      ),
    ).toBe(false);
    expect(discountSaveBlockedReason(draft({ targets: [orphan] }), 20)).toBe(
      "Remove the deleted offering to save.",
    );
  });

  test("Save always says why it is disabled, and says nothing when valid (D4)", () => {
    expect(discountSaveBlockedReason(draft(), 20)).toBeNull();
    expect(discountSaveBlockedReason(draft({ targets: [] }), 20)).toBe(
      "Pick at least one offering to save.",
    );
    expect(
      discountSaveBlockedReason(draft({ scopeKind: "items", targets: [] }), 20),
    ).toBe("Pick at least one item to save.");
    expect(
      discountSaveBlockedReason(
        draft({ scopeKind: "listing_kinds", targets: [] }),
        20,
      ),
    ).toBe("Pick at least one offering type to save.");
    expect(
      discountSaveBlockedReason(draft({ scopeKind: "brand", targets: [] }), 20),
    ).toBeNull();
    expect(discountSaveBlockedReason(draft({ name: " " }), 20)).toBe(
      "Add a name to save.",
    );
    expect(discountSaveBlockedReason(draft({ kind: "automatic", code: null }), 20)).toBe(
      "Your role can create codes only. Choose Code to save.",
    );
    // Every invalid draft has a reason; every valid one has none.
    const drafts = [
      draft(),
      draft({ targets: [] }),
      draft({ code: "AB" }),
      draft({ valueBps: 0 }),
      draft({ valueType: "amount", valueBps: null, valueMinor: 0 }),
      draft({ endsAt: "2026-12-31T00:00:00.000Z" }),
    ];
    for (const value of drafts) {
      expect(discountSaveBlockedReason(value, 30) === null).toBe(
        isDiscountDraftValid(value, 30),
      );
    }
  });

  test("a sale price only works on specific items (D5)", () => {
    expect(isDiscountScopeAvailable("sale_price", "items")).toBe(true);
    for (const scope of ["brand", "listing_kinds", "listings"] as const) {
      expect(isDiscountScopeAvailable("sale_price", scope)).toBe(false);
      expect(isDiscountScopeAvailable("code", scope)).toBe(true);
      expect(isDiscountScopeAvailable("automatic", scope)).toBe(true);
    }
  });

  test("offering rows read date, status and paid tickets (D6)", () => {
    expect(offeringMeta(row())).toBe("Sat 12 Dec · 3 paid tickets");
    expect(offeringMeta(row({ paidTicketCount: 1 }))).toBe(
      "Sat 12 Dec · 1 paid ticket",
    );
    expect(offeringMeta(row({ status: "draft", paidTicketCount: 0 }))).toBe(
      "Draft · Sat 12 Dec · No paid tickets yet",
    );
    expect(offeringMeta(row({ nextStartAt: null, lastEndAt: null }))).toBe(
      "3 paid tickets",
    );
    expect(offeringMeta(row({ status: "ended", nextStartAt: null }))).toBe(
      "Ended · Sat 12 Dec",
    );
    expect(offeringMeta(row({ status: "cancelled" }))).toBe(
      "Cancelled · Sat 12 Dec",
    );
    expect(offeringMeta(row({ discountsAllowed: false }))).toBe(
      "Discounts are off for this offering",
    );
    expect(
      formatOfferingDate(
        row({
          offeringKind: "trip",
          nextStartAt: "2027-01-09T12:00:00.000Z",
          lastEndAt: "2027-01-11T12:00:00.000Z",
        }),
      ),
    ).toBe("9–11 Jan");
    expect(offeringCountLabel(0)).toBe("None selected");
    expect(offeringCountLabel(3)).toBe("3 selected");
  });

  test("groups follow Events, Experiences, Trips; ended rows show only when picked", () => {
    const rows = [
      row({ id: "t1", offeringKind: "trip", title: "Trip" }),
      row({ id: "e2", title: "Old", status: "ended" }),
      row({ id: "e1" }),
    ];
    expect(
      groupDiscountOfferings(rows, new Set()).map((g) => [
        g.label,
        g.rows.map((r) => r.id),
      ]),
    ).toEqual([
      ["Events", ["e1"]],
      ["Trips", ["t1"]],
    ]);
    expect(
      groupDiscountOfferings(rows, new Set(["e2"]))[0]?.rows.map((r) => r.id),
    ).toEqual(["e2", "e1"]);
  });

  test("a target that is orphaned, or no longer listed, is a deleted offering", () => {
    const targets = [
      { targetKind: "event" as const, targetId: "e1", listingKind: null },
      { targetKind: "event" as const, targetId: "gone", listingKind: null },
      {
        targetKind: "event" as const,
        targetId: "e9",
        listingKind: null,
        orphanedAt: "2026-11-20T00:00:00.000Z",
      },
    ];
    expect(
      deletedOfferingTargets(targets, [row()]).map((t) => t.targetId),
    ).toEqual(["gone", "e9"]);
    // While offerings are still loading only the server's orphan flag counts.
    expect(deletedOfferingTargets(targets, null).map((t) => t.targetId)).toEqual([
      "e9",
    ]);
  });
});
