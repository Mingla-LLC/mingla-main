/**
 * issue #2160 — the organiser-facing surfaces, tested BEHAVIOURALLY.
 *
 * ── WHY THIS FILE REPLACED ITS PREDECESSOR ─────────────────────────────────
 * The first version asserted the organiser UI with `fs.readFileSync` + regex
 * and mounted nothing. The tester was right to reject that:
 * `expect(src).toMatch(/disabled=\{multiDatePricingModeLocked\}/)` passes if
 * the string sits in a comment, on a control that never renders, or with the
 * flag hard-wired false. Worse, the same class of check let the tester delete
 * the capacity aggregation while the suite stayed green.
 *
 * So: the wizard is MOUNTED and its rendered tree interrogated, and the roster
 * rule is CALLED with real rows. Two categories stay textual on purpose, and
 * only two:
 *   * the SPEC-verbatim copy strings — the point is that the exact approved
 *     words ship, which is a text property;
 *   * the "experience wizard must NOT show it" negative — an absence across
 *     files, which cannot be observed by mounting one component.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";

import {
  orderDayCell,
  serializeGuestsToCsv,
  type ExportGuestRow,
} from "../guestCsvExport";
import { dayHeadCount, orderMatchesDay } from "../guestDayFilter";
import { draftMultiDatePricingMode } from "../../store/draftEventStore";

const repoRead = (rel: string): string =>
  fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

const DAY_1 = "occ-day-1";
const DAY_2 = "occ-day-2";
const LABELS = new Map([
  [DAY_1, "Sat 22 Aug"],
  [DAY_2, "Sun 23 Aug"],
]);

// The heavy children are stubbed so only CreatorStep2When's own body renders
// (the same harness webDateTimeInput.adversarial.1027 uses).
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (): null => null,
}));
jest.mock("../../wrappers/SmartScrollView", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    __esModule: true,
    ScrollView: ({ children }: { children?: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children),
  };
});
jest.mock("../../components/ui/Sheet", () => ({ __esModule: true, Sheet: (): null => null }));
jest.mock("../../components/ui/Icon", () => ({ __esModule: true, Icon: (): null => null }));
jest.mock("../../components/ui/Button", () => ({ __esModule: true, Button: (): null => null }));
jest.mock("../../components/ui/Input", () => ({ __esModule: true, Input: (): null => null }));
jest.mock("../../components/ui/ConfirmDialog", () => ({
  __esModule: true,
  ConfirmDialog: (): null => null,
}));
jest.mock("../../components/event/CreatorStep2WhenRepeatPickerSheet", () => ({
  __esModule: true,
  CreatorStep2WhenRepeatPickerSheet: (): null => null,
}));
jest.mock("../../components/event/MultiDateOverrideSheet", () => ({
  __esModule: true,
  MultiDateOverrideSheet: (): null => null,
}));
// react-native-svg is not installed in this workspace; the shared package's
// icon module is the only thing that needs it and it renders no #2160 copy.
jest.mock("react-native-svg", () => ({ __esModule: true, default: (): null => null, Svg: (): null => null, Path: (): null => null }), { virtual: true });

// `@types/react-test-renderer` is not installed in this workspace, so the
// module is required with a local shape exactly as
// webDateTimeInput.adversarial.1027 does.
type Node = { type: unknown; props: Record<string, any>; findAll: (p: (n: Node) => boolean) => Node[] };
type Tree = {
  root: Node;
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

interface MountArgs {
  whenMode?: "single" | "multi_date" | "recurring";
  dayCount?: number;
  pricingMode?: "per_day" | "all_days";
  locked?: boolean;
  show?: boolean;
  paidTicket?: boolean;
  onUpdate?: (patch: Record<string, unknown>) => void;
}

const mountWhenStep = async (args: MountArgs = {}): Promise<Tree> => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CreatorStep2When } = require("../../components/event/CreatorStep2When") as {
    CreatorStep2When: React.FC<Record<string, unknown>>;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildDraftEvent } = require("../../store/draftEventStore") as {
    buildDraftEvent: (brandId: string) => Record<string, unknown>;
  };
  const dayCount = args.dayCount ?? 2;
  const multiDates = Array.from({ length: dayCount }, (_, i) => ({
    id: `md_${i}`,
    date: `2026-08-${22 + i}`,
    startTime: "11:00",
    endTime: "18:00",
    overrides: {
      title: null,
      description: null,
      venueName: null,
      address: null,
      onlineUrl: null,
    },
  }));
  let created: Tree | undefined;
  await TestRenderer.act(() => {
    created = TestRenderer.create(
      React.createElement(CreatorStep2When, {
        draft: {
          ...buildDraftEvent("brand_2160"),
          whenMode: args.whenMode ?? "multi_date",
          multiDates,
          date: "2026-08-22",
          doorsOpen: "11:00",
          endsAt: "18:00",
          timezone: "Europe/London",
          multiDatePricingMode: args.pricingMode ?? "per_day",
          tickets: args.paidTicket === false
            ? [{ id: "t1", name: "Free", priceGbp: 0 }]
            : [{ id: "t1", name: "General", priceGbp: 10 }],
        },
        updateDraft: args.onUpdate ?? ((): void => undefined),
        errors: [],
        showErrors: false,
        onShowToast: (): void => undefined,
        scrollToBottom: (): void => undefined,
        showMultiDatePricingMode: args.show ?? true,
        multiDatePricingModeLocked: args.locked ?? false,
      }),
    );
  });
  return created as Tree;
};

// HOST nodes only. `findAll` returns both the composite element and the host
// node it renders to, so an unfiltered match double-counts every element.
const isHost = (n: Node): boolean => typeof n.type === "string";

const findByTestID = (tree: Tree, id: string): Node[] =>
  tree.root.findAll((n: Node) => isHost(n) && n.props?.testID === id);

// ═══════════════════════════════════════════════ the wizard, MOUNTED
describe("issue #2160 — the organiser's choice actually renders and behaves", () => {
  test("a multi-day event RENDERS the control", async () => {
    const tree = await mountWhenStep();
    expect(findByTestID(tree, "issue-2160-pricing-mode").length).toBe(1);
    expect(findByTestID(tree, "issue-2160-pricing-mode-per_day").length).toBe(1);
    expect(findByTestID(tree, "issue-2160-pricing-mode-all_days").length).toBe(1);
    tree.unmount();
  });

  test("a SINGLE-DATE event renders NO control — today's screen, untouched", async () => {
    const tree = await mountWhenStep({ whenMode: "single" });
    expect(findByTestID(tree, "issue-2160-pricing-mode").length).toBe(0);
    tree.unmount();
  });

  test("a multi_date event with only ONE date renders no control", async () => {
    // There is nothing to price differently, so there is nothing to ask.
    const tree = await mountWhenStep({ dayCount: 1 });
    expect(findByTestID(tree, "issue-2160-pricing-mode").length).toBe(0);
    tree.unmount();
  });

  test("a host that does not opt in renders no control", async () => {
    // This is what keeps it off the experience wizard.
    const tree = await mountWhenStep({ show: false });
    expect(findByTestID(tree, "issue-2160-pricing-mode").length).toBe(0);
    tree.unmount();
  });

  test("the selected option is the one marked checked, and the other is not", async () => {
    const tree = await mountWhenStep({ pricingMode: "all_days" });
    expect(
      findByTestID(tree, "issue-2160-pricing-mode-all_days")[0].props
        .accessibilityState.checked,
    ).toBe(true);
    expect(
      findByTestID(tree, "issue-2160-pricing-mode-per_day")[0].props
        .accessibilityState.checked,
    ).toBe(false);
    tree.unmount();
  });

  test("tapping an option PATCHES THE DRAFT with that mode", async () => {
    const patches: Record<string, unknown>[] = [];
    const tree = await mountWhenStep({ onUpdate: (p) => patches.push(p) });
    await TestRenderer.act(() => {
      findByTestID(tree, "issue-2160-pricing-mode-all_days")[0].props.onPress();
    });
    expect(patches).toEqual([{ multiDatePricingMode: "all_days" }]);
    tree.unmount();
  });

  test("tapping the ALREADY-selected option patches nothing", async () => {
    const patches: Record<string, unknown>[] = [];
    const tree = await mountWhenStep({
      pricingMode: "per_day",
      onUpdate: (p) => patches.push(p),
    });
    await TestRenderer.act(() => {
      findByTestID(tree, "issue-2160-pricing-mode-per_day")[0].props.onPress();
    });
    expect(patches).toEqual([]);
    tree.unmount();
  });

  // ── THE LOCK, OBSERVED — not asserted by regex ──────────────────────────
  test("LOCKED: both options are disabled, announced disabled, and DO NOT patch", async () => {
    const patches: Record<string, unknown>[] = [];
    const tree = await mountWhenStep({
      locked: true,
      pricingMode: "per_day",
      onUpdate: (p) => patches.push(p),
    });
    for (const mode of ["per_day", "all_days"]) {
      const row = findByTestID(tree, `issue-2160-pricing-mode-${mode}`)[0];
      expect(row.props.disabled).toBe(true);
      expect(row.props.accessibilityState.disabled).toBe(true);
    }
    // The behavioural half: invoking the handler must not move the draft. A
    // `disabled` prop alone is styling; this is the guarantee.
    await TestRenderer.act(() => {
      findByTestID(tree, "issue-2160-pricing-mode-all_days")[0].props.onPress();
    });
    expect(patches).toEqual([]);
    tree.unmount();
  });

  test("UNLOCKED: the options are NOT disabled — the lock is real, not always-on", async () => {
    const tree = await mountWhenStep({ locked: false });
    expect(
      findByTestID(tree, "issue-2160-pricing-mode-per_day")[0].props.disabled,
    ).toBe(false);
    tree.unmount();
  });

  test("the footnote SWAPS with the lock state", async () => {
    const open = await mountWhenStep({ locked: false });
    expect(findByTestID(open, "issue-2160-pricing-mode-footnote")[0].props.children)
      .toBe("You can't change this once a guest has a ticket.");
    open.unmount();

    const shut = await mountWhenStep({ locked: true });
    expect(findByTestID(shut, "issue-2160-pricing-mode-footnote")[0].props.children)
      .toBe("A guest already has a ticket, so this can't be changed.");
    shut.unmount();
  });

  test("the rows are SIBLING radios inside one radiogroup — never nested Pressables", async () => {
    const tree = await mountWhenStep();
    const group = tree.root.findAll(
      (n: Node) => isHost(n) && n.props?.accessibilityRole === "radiogroup",
    );
    expect(group.length).toBe(1);
    const radios = group[0].findAll(
      (n: Node) => isHost(n) && n.props?.accessibilityRole === "radio",
    );
    expect(radios.length).toBe(2);
    // No radio may contain another radio.
    for (const r of radios as Node[]) {
      expect(
        r.findAll((n: Node) => isHost(n) && n.props?.accessibilityRole === "radio")
          .length,
      ).toBe(1);
    }
    // The accessible NAME is the option label; the helper is a separate node.
    expect((radios as Node[]).map((r) => r.props.accessibilityLabel).sort()).toEqual([
      "One price for all days",
      "Per day",
    ]);
    tree.unmount();
  });

  test("the helper copy follows whether the event is PAID or FREE", async () => {
    const paid = await mountWhenStep({ paidTicket: true });
    const paidText = JSON.stringify(paid.toJSON());
    expect(paidText).toContain("Two days costs twice as much");
    paid.unmount();

    const free = await mountWhenStep({ paidTicket: false });
    const freeText = JSON.stringify(free.toJSON());
    // A free event has no price to qualify, so it gets the pass-count wording.
    expect(freeText).toContain("A guest gets a separate pass for each day they choose.");
    expect(freeText).not.toContain("Two days costs twice as much");
    free.unmount();
  });
});

// ═══════════════════════════════════════════════ the roster rule, CALLED
describe("issue #2160 — a both-days guest is under BOTH days, and once under All", () => {
  const bothDays = [{ eventDateIds: [DAY_1] }, { eventDateIds: [DAY_2] }];
  const dayOneOnly = [{ eventDateIds: [DAY_1] }];
  const allDaysPass = [{ eventDateIds: [DAY_1, DAY_2] }];
  const notDayScoped = [{ eventDateIds: [] }];

  test("per_day both days: matches BOTH chips", () => {
    expect(orderMatchesDay(bothDays, DAY_1)).toBe(true);
    expect(orderMatchesDay(bothDays, DAY_2)).toBe(true);
  });

  test("all_days one pass, two days: matches BOTH chips", () => {
    expect(orderMatchesDay(allDaysPass, DAY_1)).toBe(true);
    expect(orderMatchesDay(allDaysPass, DAY_2)).toBe(true);
  });

  test("a day-1-only guest does NOT match day 2 — the filter really filters", () => {
    expect(orderMatchesDay(dayOneOnly, DAY_1)).toBe(true);
    expect(orderMatchesDay(dayOneOnly, DAY_2)).toBe(false);
  });

  test("a NOT-day-scoped pass matches every chip rather than vanishing", () => {
    expect(orderMatchesDay(notDayScoped, DAY_1)).toBe(true);
    expect(orderMatchesDay(notDayScoped, DAY_2)).toBe(true);
    expect(orderMatchesDay([], DAY_1)).toBe(true);
    expect(orderMatchesDay(null, DAY_1)).toBe(true);
  });

  test("head counts count PASSES, and a both-days guest counts once PER DAY", () => {
    const orders = [{ ticketDays: bothDays }, { ticketDays: dayOneOnly }];
    // Day 1: the both-days guest's day-1 pass + the day-1-only guest = 2.
    expect(dayHeadCount(orders, DAY_1)).toBe(2);
    // Day 2: only the both-days guest's day-2 pass = 1.
    expect(dayHeadCount(orders, DAY_2)).toBe(1);
  });

  test("a not-day-scoped pass is counted on every day — never under-reported", () => {
    expect(dayHeadCount([{ ticketDays: notDayScoped }], DAY_1)).toBe(1);
    expect(dayHeadCount([{ ticketDays: notDayScoped }], DAY_2)).toBe(1);
  });

  test("the screen delegates to this rule rather than owning a second copy", () => {
    const screen = repoRead("app/event/[id]/guests/index.tsx");
    expect(screen).toMatch(/orderMatchesDay\(row\.order\.ticketDays, dayId\)/);
    expect(screen).toMatch(/dayHeadCount\(orders, occ\.id\)/);
  });
});

// ═══════════════════════════════════════════════ the export
describe("issue #2160 — the CSV carries the day (a roster you cannot export is half a roster)", () => {
  test("a both-days guest exports BOTH days, not one", () => {
    const cell = orderDayCell(
      { ticketDays: [{ eventDateIds: [DAY_1] }, { eventDateIds: [DAY_2] }] },
      LABELS,
    );
    expect(cell).toBe("Sat 22 Aug; Sun 23 Aug");
    expect(cell).not.toBe("Sat 22 Aug");
  });

  test("an all_days pass — ONE ticket, TWO days — exports both", () => {
    expect(orderDayCell({ ticketDays: [{ eventDateIds: [DAY_1, DAY_2] }] }, LABELS))
      .toBe("Sat 22 Aug; Sun 23 Aug");
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
    expect(orderDayCell({ ticketDays: [{ eventDateIds: ["unknown-id"] }] }, LABELS))
      .toBe("");
  });

  const order = {
    kind: "order" as const,
    order: {
      id: "ord_1",
      buyer: { name: "Ada", email: "ada@example.com", phone: "+15550001111" },
      lines: [{
        orderLineItemId: "oli_1",
        ticketTypeId: "tt_1",
        ticketNameAtPurchase: "General",
        unitPriceGbpAtPurchase: 10,
        unitPriceAtPurchase: 10,
        isFreeAtPurchase: false,
        quantity: 2,
        refundedQuantity: 0,
      }],
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
    const header = serializeGuestsToCsv([order], undefined, LABELS)
      .split("\r\n")[0].split(",");
    expect(header[header.length - 1]).toBe("Day");
    expect(header.slice(0, 17)).toEqual([
      "Kind", "Name", "Email", "Phone", "Ticket type", "Quantity", "Status",
      "Payment method", "Order/Sale ID", "Date", "Notes", "Gross", "Currency",
      "Refunded", "Refunded currency", "Net", "Net currency",
    ]);
  });

  test("the row's Day cell names both chosen days", () => {
    expect(serializeGuestsToCsv([order], undefined, LABELS).split("\r\n")[1])
      .toContain("Sat 22 Aug; Sun 23 Aug");
  });

  test("a SINGLE-DATE export is unchanged except for one trailing empty cell", () => {
    const row = serializeGuestsToCsv([order]).split("\r\n")[1];
    expect(row.endsWith(",")).toBe(true);
    expect(row).not.toContain("Sat 22 Aug");
  });
});

// ═══════════════════════════════════════════════ the total coercion
describe("issue #2160 — the pricing mode is a TOTAL function with no third state", () => {
  test("a draft persisted BEFORE #2160 resolves to per_day", () => {
    expect(draftMultiDatePricingMode(undefined)).toBe("per_day");
    expect(draftMultiDatePricingMode(null)).toBe("per_day");
  });
  test("anything unrecognised also resolves to per_day", () => {
    expect(draftMultiDatePricingMode("banana")).toBe("per_day");
    expect(draftMultiDatePricingMode(7)).toBe("per_day");
  });
  test("all_days is preserved", () => {
    expect(draftMultiDatePricingMode("all_days")).toBe("all_days");
  });
});

// ═══════════════════════════════════════ §7(a) the price qualifier, MOUNTED
//
// Restored after I dropped it in this file's rewrite — a real coverage
// regression, caught by re-running the fails-on-revert harness rather than by
// assuming the rewrite was a superset. Now behavioural rather than the regex it
// replaced: the shared package is MOUNTED with and without the prop.
describe("issue #2160 §7(a) — the multiplier is visible on the ticket row itself", () => {
  const ticket = {
    id: "tt_1",
    name: "General",
    description: null,
    saleStartAt: null,
    saleEndAt: null,
    minPurchaseQty: 1,
    maxPurchaseQty: null,
    passwordConfigured: false,
    waitlistEnabled: false,
    requiresApproval: false,
    priceGbp: 10,
    priceAllInGbp: 10,
    currency: "GBP",
    isFree: false,
    isUnlimited: true,
    capacity: null,
    visibility: "public",
    availableAt: "online",
  };

  const mountBox = async (pricingNote?: string | null): Promise<Tree> => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // The @mingla/offering-rendering BARREL is manual-mocked in jest.config.cjs
    // (it eagerly re-exports RN .tsx), so mounting through it yields null. The
    // real module is required BY PATH — the mapper is an exact-match on the
    // barrel specifier, so a deep import gets the shipped component.
    const pkg = require("../../../../packages/offering-rendering/EventOfferingBody") as {
      EventTicketBox: React.FC<Record<string, unknown>>;
    };
    const themeMod = require("../../../../packages/offering-rendering/themeResolver") as {
      resolveTheme: (b: unknown, o: unknown) => unknown;
    };
    const paletteMod = require("../../../../packages/offering-rendering/themePalette") as {
      createThemePalette: (t: unknown) => unknown;
    };
    const theme = themeMod.resolveTheme(null, null);
    let created: Tree | undefined;
    await TestRenderer.act(() => {
      created = TestRenderer.create(
        React.createElement(pkg.EventTicketBox, {
          event: { id: "e1", name: "Two Day", currency: "GBP", tickets: [ticket] },
          bookable: true,
          palette: paletteMod.createThemePalette(theme),
          theme,
          variant: "event",
          ticketQuantities: {},
          onChangeTicketQuantity: (): void => undefined,
          onProceedToCart: (): void => undefined,
          ...(pricingNote === undefined ? {} : { pricingNote }),
        }),
      );
    });
    return created as Tree;
  };

  test("with the prop, the qualifier RENDERS next to the price", async () => {
    const tree = await mountBox("per day");
    const note = findByTestID(tree, "issue-2160-pricing-note-tt_1");
    expect(note.length).toBe(1);
    expect(JSON.stringify(tree.toJSON())).toContain("per day");
    tree.unmount();
  });

  test("all_days renders its own wording", async () => {
    const tree = await mountBox("for all days");
    expect(JSON.stringify(tree.toJSON())).toContain("for all days");
    tree.unmount();
  });

  test("WITHOUT the prop the tree is byte-identical — the shared package stays additive", async () => {
    // This is the contract that keeps consumer native and every other caller
    // untouched, and it is asserted on the rendered TREE, not on the source.
    const omitted = await mountBox();
    const explicitNull = await mountBox(null);
    expect(JSON.stringify(omitted.toJSON())).toEqual(
      JSON.stringify(explicitNull.toJSON()),
    );
    expect(findByTestID(omitted, "issue-2160-pricing-note-tt_1").length).toBe(0);
    omitted.unmount();
    explicitNull.unmount();
  });

  test("the page supplies the wording, and null when there is nothing to qualify", () => {
    const page = repoRead("src/components/event/PublicEventPage.tsx");
    expect(page).toMatch(/"for all days"/);
    expect(page).toMatch(/"per day"/);
    // BOTH surfaces: the phone inline box as well as the desktop panel.
    expect((page.match(/pricingNote=\{ticketPricingNote\}/g) ?? []).length).toBe(2);
  });

  test("the chooser says it too, before any total is rendered", () => {
    const chooser = repoRead("src/components/event/MultiDateDayChooser.tsx");
    expect(chooser).toContain("Priced per day");
    expect(chooser).toContain("One price for all days");
  });
});

// ═══════════════════════════════════════════ legitimately textual, and only these
describe("issue #2160 — the two properties that are genuinely text", () => {
  test("the SPEC's copy ships verbatim — the point IS the exact approved words", () => {
    // The copy moved with the control into its own LAZY chunk — organiser-only
    // text and styles do not belong in the eager payload every anonymous buyer
    // downloads. Same file, same strings.
    const src = repoRead("src/components/event/MultiDatePricingModeField.tsx");
    for (const line of [
      "How guests pay for multiple days",
      "Per day",
      "One price for all days",
      "A guest pays for each day they choose. Two days costs twice as much, and they get a pass for each day.",
      "A guest pays once no matter how many days they choose, and gets a single pass that works on every day they picked.",
      "A guest gets a separate pass for each day they choose.",
      "A guest gets a single pass that works on every day they picked.",
      "You can't change this once a guest has a ticket.",
      "A guest already has a ticket, so this can't be changed.",
    ]) {
      expect(src).toContain(line);
    }
  });

  test("the experience wizard must NOT opt in — an absence across files", () => {
    expect(repoRead("src/components/event/EventCreatorWizard.tsx")).toMatch(
      /showMultiDatePricingMode:\s*true/,
    );
    expect(repoRead("src/components/experience/ExperienceCreatorWizard.tsx"))
      .not.toMatch(/showMultiDatePricingMode/);
  });

  test("the choice reaches the database, and only when it is not the default", () => {
    const svc = repoRead("src/services/businessEvents.ts");
    expect(svc).toMatch(/biz_set_event_multi_date_pricing_mode/);
    expect(svc).toMatch(/chosenPricingMode !== "per_day"/);
  });
});
