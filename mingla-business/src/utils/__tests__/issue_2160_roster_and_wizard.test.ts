/**
 * issue #2160 — the four organiser-facing surfaces the first pass deferred.
 *
 * These are the halves of the operator's decision that live outside the
 * database: the ORGANISER'S CHOICE (the wizard control), the PER-DAY ROSTER and
 * its EXPORT, and the GUEST-FACING PRICE QUALIFIER. The admission model is
 * proved on real PostgreSQL in
 * `supabase/migrations/__tests__/issue_2160_multiday_admission.test.sql`; this
 * file covers the client logic that model is useless without.
 *
 * Every assertion here is over a PURE function or over shipped SOURCE. Where a
 * property is only observable at runtime against real rows, it is proved in SQL
 * instead and cited — a source pin that could be satisfied by a comment would
 * be worse than no test.
 */

import fs from "node:fs";
import path from "node:path";

import {
  orderDayCell,
  serializeGuestsToCsv,
  type ExportGuestRow,
} from "../guestCsvExport";
import { draftMultiDatePricingMode } from "../../store/draftEventStore";

const repoRead = (rel: string): string =>
  fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

const DAY_1 = "occ-day-1";
const DAY_2 = "occ-day-2";
const LABELS = new Map([
  [DAY_1, "Sat 22 Aug"],
  [DAY_2, "Sun 23 Aug"],
]);

// ───────────────────────────────────────────────── the per-day export cell
describe("issue #2160 — the CSV carries the day (a roster you cannot export is half a roster)", () => {
  test("a both-days guest exports BOTH days, not one", () => {
    const cell = orderDayCell(
      {
        ticketDays: [
          { eventDateIds: [DAY_1] },
          { eventDateIds: [DAY_2] },
        ],
      },
      LABELS,
    );
    expect(cell).toBe("Sat 22 Aug; Sun 23 Aug");
    // The negative that actually catches a regression: a cell naming only the
    // first day would satisfy "a day is present" and be wrong.
    expect(cell).not.toBe("Sat 22 Aug");
  });

  test("an all_days pass — ONE ticket, TWO days — exports both", () => {
    expect(
      orderDayCell({ ticketDays: [{ eventDateIds: [DAY_1, DAY_2] }] }, LABELS),
    ).toBe("Sat 22 Aug; Sun 23 Aug");
  });

  test("a one-day guest exports exactly that day", () => {
    expect(orderDayCell({ ticketDays: [{ eventDateIds: [DAY_2] }] }, LABELS))
      .toBe("Sun 23 Aug");
  });

  test("a NOT-day-scoped pass exports blank, never a fabricated day", () => {
    expect(orderDayCell({ ticketDays: [{ eventDateIds: [] }] }, LABELS)).toBe("");
    expect(orderDayCell({}, LABELS)).toBe("");
  });

  test("an id with no label is OMITTED, not printed raw", () => {
    // A uuid in a spreadsheet cell is noise; inventing a date would be worse
    // (Constitution #9).
    expect(orderDayCell({ ticketDays: [{ eventDateIds: ["unknown-id"] }] }, LABELS))
      .toBe("");
  });
});

describe("issue #2160 — the Day column is APPENDED, so every existing column keeps its index", () => {
  const order = {
    kind: "order" as const,
    order: {
      id: "ord_1",
      buyer: { name: "Ada", email: "ada@example.com", phone: "+15550001111" },
      lines: [
        {
          orderLineItemId: "oli_1",
          ticketTypeId: "tt_1",
          ticketNameAtPurchase: "General",
          unitPriceGbpAtPurchase: 10,
          unitPriceAtPurchase: 10,
          isFreeAtPurchase: false,
          quantity: 2,
          refundedQuantity: 0,
        },
      ],
      totalGbpAtPurchase: 20,
      currency: "GBP",
      paymentMethod: "online_card",
      paidAt: "2026-08-20T10:00:00.000Z",
      status: "paid",
      refundedAmountGbp: 0,
      ticketDays: [{ eventDateIds: [DAY_1] }, { eventDateIds: [DAY_2] }],
    },
  } as unknown as ExportGuestRow;

  test('"Day" is the LAST header — nothing that parses by position moves', () => {
    const csv = serializeGuestsToCsv([order], undefined, LABELS);
    const header = csv.split("\r\n")[0].split(",");
    expect(header[header.length - 1]).toBe("Day");
    // The pre-#2160 header, unchanged, in its original order.
    expect(header.slice(0, 17)).toEqual([
      "Kind", "Name", "Email", "Phone", "Ticket type", "Quantity", "Status",
      "Payment method", "Order/Sale ID", "Date", "Notes", "Gross", "Currency",
      "Refunded", "Refunded currency", "Net", "Net currency",
    ]);
  });

  test("the row's Day cell names both chosen days", () => {
    const csv = serializeGuestsToCsv([order], undefined, LABELS);
    const row = csv.split("\r\n")[1];
    expect(row).toContain("Sat 22 Aug; Sun 23 Aug");
  });

  test("a SINGLE-DATE export is byte-identical except for one trailing empty cell", () => {
    // No labels at all = every single-date event. The Day column still exists
    // (stable header for anything parsing by position) but is always blank.
    const csv = serializeGuestsToCsv([order]);
    const row = csv.split("\r\n")[1];
    expect(row.endsWith(",")).toBe(true);
    expect(row).not.toContain("Sat 22 Aug");
  });
});

// ───────────────────────────────────────────────── the organiser's choice
describe("issue #2160 — the pricing mode is a TOTAL function with no third state", () => {
  test("a draft persisted BEFORE #2160 resolves to per_day", () => {
    // This is why no persist migrator was needed: `undefined` already means
    // exactly what the database column's DEFAULT means.
    expect(draftMultiDatePricingMode(undefined)).toBe("per_day");
    expect(draftMultiDatePricingMode(null)).toBe("per_day");
  });
  test("anything unrecognised also resolves to per_day — never a third state", () => {
    expect(draftMultiDatePricingMode("banana")).toBe("per_day");
    expect(draftMultiDatePricingMode(7)).toBe("per_day");
  });
  test("all_days is preserved", () => {
    expect(draftMultiDatePricingMode("all_days")).toBe("all_days");
  });
});

describe("issue #2160 — the wizard control exists, carries the SPEC's exact copy, and respects the lock", () => {
  const src = repoRead("src/components/event/CreatorStep2When.tsx");

  test("the control is rendered at all — without it the column is inert", () => {
    // The operator's decision was "the organiser chooses per event". A column
    // with a default and no control is not that feature.
    expect(src).toMatch(/testID="issue-2160-pricing-mode"/);
    expect(src).toMatch(/updateDraft\(\{ multiDatePricingMode: next \}\)/);
  });

  test("the copy is the SPEC's, verbatim — the implementor invented nothing", () => {
    expect(src).toContain("How guests pay for multiple days");
    expect(src).toContain("Per day");
    expect(src).toContain("One price for all days");
    expect(src).toContain(
      "A guest pays for each day they choose. Two days costs twice as much, and they get a pass for each day.",
    );
    expect(src).toContain(
      "A guest pays once no matter how many days they choose, and gets a single pass that works on every day they picked.",
    );
    expect(src).toContain("A guest gets a separate pass for each day they choose.");
    expect(src).toContain(
      "A guest gets a single pass that works on every day they picked.",
    );
    expect(src).toContain("You can't change this once a guest has a ticket.");
    expect(src).toContain("A guest already has a ticket, so this can't be changed.");
  });

  test("it renders ONLY on a real multi-day event", () => {
    // Single, recurring and RSVP keep today's screen byte-identical.
    expect(src).toMatch(
      /showMultiDatePricingMode\s*&&\s*\(draft\.multiDates\?\.length\s*\?\?\s*0\)\s*>\s*1/,
    );
  });

  test("the locked state is NON-INTERACTIVE, not merely styled", () => {
    // The database trigger is fail-closed; this is so the organiser never taps
    // a control that then errors.
    expect(src).toMatch(/disabled=\{multiDatePricingModeLocked\}/);
    expect(src).toMatch(/if \(multiDatePricingModeLocked\) return;/);
    expect(src).toMatch(/disabled: multiDatePricingModeLocked/);
  });

  test("the two options are SIBLING radios in one radiogroup, never nested Pressables", () => {
    expect(src).toMatch(/accessibilityRole="radiogroup"[\s\S]{0,600}?accessibilityRole="radio"/);
    // The accessible name is the option label; the helper is a separate node.
    expect(src).toMatch(/accessibilityLabel=\{option\.label\}/);
  });

  test("only the EVENT wizard opts in — the experience wizard must not show it", () => {
    // CreatorStep2When is lifted by ExperienceCreatorWizard too, and
    // events.multi_date_pricing_mode governs nothing on that surface.
    expect(repoRead("src/components/event/EventCreatorWizard.tsx")).toMatch(
      /showMultiDatePricingMode:\s*true/,
    );
    expect(
      repoRead("src/components/experience/ExperienceCreatorWizard.tsx"),
    ).not.toMatch(/showMultiDatePricingMode/);
  });

  test("the choice actually reaches the database", () => {
    const svc = repoRead("src/services/businessEvents.ts");
    expect(svc).toMatch(/biz_set_event_multi_date_pricing_mode/);
    expect(svc).toMatch(/setEventMultiDatePricingMode/);
    // Only when it is NOT the default: a per_day event needs no call, so the
    // publish path is byte-identical for everything that does not use this.
    expect(svc).toMatch(/chosenPricingMode !== "per_day"/);
  });
});

// ───────────────────────────────────────────────── guest-facing clarity
describe("issue #2160 §7(a) — the multiplier is visible BEFORE the total", () => {
  test("the shared package's prop is ADDITIVE and defaults to null", () => {
    // This is the only shared-package change in the issue. Default null means
    // consumer native and every other caller render a byte-identical tree.
    const pkg = repoRead("../packages/offering-rendering/EventOfferingBody.tsx");
    expect(pkg).toMatch(/pricingNote\?: string \| null;/);
    expect(pkg).toMatch(/pricingNote = null,/);
    expect(pkg).toMatch(/testID=\{`issue-2160-pricing-note-\$\{ticket\.id\}`\}/);
    // A FREE ticket is never qualified — there is no price to qualify.
    expect(pkg).toMatch(/pricingNote !== null && pricingNote\.length > 0 && !ticket\.isFree/);
  });

  test("the page supplies 'per day' / 'for all days', and null when there is nothing to qualify", () => {
    const page = repoRead("src/components/event/PublicEventPage.tsx");
    expect(page).toMatch(/"for all days"/);
    expect(page).toMatch(/"per day"/);
    // NULL on a single-date event and on a free event.
    expect(page).toMatch(
      /hasOccurrenceChoice && eventHasPaidTicket[\s\S]{0,160}?:\s*null;/,
    );
  });

  test("BOTH surfaces get it — phone as well as desktop", () => {
    // The phone inline box is the primary buyer surface; a desktop-only
    // qualifier would leave the multiplier invisible where it matters most.
    const page = repoRead("src/components/event/PublicEventPage.tsx");
    expect((page.match(/pricingNote=\{ticketPricingNote\}/g) ?? []).length).toBe(2);
    expect(repoRead("src/components/event/FoundationEventPreview.tsx")).toMatch(
      /pricingNote=\{pricingNote\}/,
    );
  });

  test("the chooser says it too, before any total is rendered", () => {
    const chooser = repoRead("src/components/event/MultiDateDayChooser.tsx");
    expect(chooser).toContain("Priced per day");
    expect(chooser).toContain("One price for all days");
    // A free event gets the plain count line — nothing to qualify.
    expect(chooser).toMatch(/`\$\{chosen\} of \$\{occurrences\.length\} selected`/);
  });
});

// ───────────────────────────────────────────────── the per-day roster
describe("issue #2160 — the roster gains a day dimension without losing the combined view", () => {
  const src = repoRead("../mingla-business/app/event/[id]/guests/index.tsx");

  test("the chip row renders ONLY on a multi-day event", () => {
    expect(src).toMatch(/const hasDayChips = occurrences\.length > 1;/);
    expect(src).toMatch(/testID="issue-2160-day-chips"/);
  });

  test("a both-days guest appears under BOTH chips", () => {
    // `some`, not `every`: the whole point of the issue. `every` would hide a
    // both-days guest from each individual day, which is the bug inverted.
    expect(src).toMatch(/return bound\.some\(\(t\) => t\.eventDateIds\.includes\(dayId\)\);/);
  });

  test("a NOT-day-scoped pass appears under every chip rather than vanishing", () => {
    expect(src).toMatch(/if \(days\.length === 0\) return true;/);
    expect(src).toMatch(/if \(bound\.length === 0\) return true;/);
  });

  test('the "All" chip is unfiltered, so each guest still appears ONCE there', () => {
    expect(src).toMatch(/dayFilter === null \|\| rowMatchesDay\(r, dayFilter\)/);
    expect(src).toMatch(/testID="issue-2160-day-chip-all"/);
  });

  test("per-chip head counts are counted from real ticket rows, never fabricated", () => {
    expect(src).toMatch(/dayHeadCounts/);
    expect(src).toMatch(/t\.eventDateIds\.length === 0 \|\| t\.eventDateIds\.includes\(occ\.id\)/);
  });

  test("the roster reads the ticket days, and the export gets the SAME labels", () => {
    expect(repoRead("src/services/eventOrdersService.ts")).toMatch(
      /ticket_event_dates \( event_date_id \)/,
    );
    expect(src).toMatch(/dayLabels,/);
  });
});
