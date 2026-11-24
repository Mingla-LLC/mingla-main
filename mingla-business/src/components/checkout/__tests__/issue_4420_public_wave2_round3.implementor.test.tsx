/**
 * issue #4420 wave 2, round 3 — behaviour proof for the parts this round adds.
 *
 *   R3-1 GlassTabs: every tab is role=tab with its selected state; the chosen
 *        tab is ink (`primaryText`) with page-coloured text; counts render;
 *        a press selects through `onSelect`.
 *   R3-2 the venue's live reserve bar (D-V3): pick → "Fri 20 Nov · 7:30 PM" /
 *        "4 guests · Date night" / Continue; details with a deposit →
 *        "$63.90 today" / Confirm & pay; no deposit → Confirm reservation;
 *        no tables → the day, "No tables this day".
 *   R3-3 CheckoutHero: "success" paints the host accent fill with the
 *        palette's on-accent glyph and the host title face; "warning" paints
 *        the status tint; on Graphite it stays Graphite.
 *   R3-4 youreInLine: "2 tickets for X, Sat 12 Dec." and singulars.
 *   R3-5 CheckoutOfferingStrip: phone shows title, eyebrow, byline in the
 *        host face; desktop (wide) draws nothing.
 *
 * Fails-on-revert: a tab without its selected state or with an accent fill,
 * a bar that loses the pick or the deposit total, a hero that stays Graphite
 * inside a host checkout, or a strip on desktop fails here.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import React from "react";
import { StyleSheet } from "react-native";
import { createThemePalette, resolveTheme } from "@mingla/offering-rendering";

import { color as graphite } from "../../../constants/designSystem";
import {
  setActiveCheckoutPalette,
  setActiveCheckoutTheme,
} from "../checkoutTheme";

jest.mock("../../ui/Icon", () => ({
  __esModule: true,
  Icon: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import("react")>("react").createElement("MockIcon", props),
}));
jest.mock("@mingla/offering-rendering/OfferingGlassContext", () => ({
  OfferingGlassBackdrop: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, unknown> };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (fn: () => void) => void;
};

const mount = (el: React.ReactElement): Tree => {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(el);
  });
  return tree;
};
const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
const textOf = (tree: Tree): string[] =>
  tree.root
    .findAll((n) => n.type === "Text")
    .map((n) =>
      [n.props.children]
        .flat()
        .filter((c) => typeof c === "string" || typeof c === "number")
        .join(""),
    );

const theme = resolveTheme({ color: "#0b6e4f", font: "Playfair Display" } as never, null);
const palette = createThemePalette(theme);

afterEach(() => {
  setActiveCheckoutPalette(null);
  setActiveCheckoutTheme(null);
});

describe("issue #4420 round 3", () => {
  test("R3-1 GlassTabs: role=tab, selected state, ink fill, counts, onSelect", () => {
    const { GlassTabs } = require("@mingla/brand-rendering/GlassTabs") as typeof import("../../../../../packages/brand-rendering/GlassTabs");
    const onSelect = jest.fn();
    const tree = mount(
      <GlassTabs
        items={[
          { key: "about", label: "About" },
          { key: "upcoming", label: "Upcoming", count: 3 },
        ]}
        activeKey="upcoming"
        onSelect={onSelect}
        palette={palette}
        theme={theme}
      />,
    );
    const tabs = tree.root.findAll(
      (n) => n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function",
    );
    const byLabel = (label: string) => tabs.find((t) => t.props.accessibilityLabel === label);
    expect(byLabel("About")?.props.accessibilityState).toEqual({ selected: false });
    expect(byLabel("Upcoming")?.props.accessibilityState).toEqual({ selected: true });
    expect(flat(byLabel("Upcoming")?.props.style).backgroundColor).toBe(palette.primaryText);
    expect(flat(byLabel("About")?.props.style).backgroundColor).toBeUndefined();
    expect(textOf(tree)).toContain(" 3");
    TestRenderer.act(() => (byLabel("About")?.props.onPress as () => void)());
    expect(onSelect).toHaveBeenCalledWith("about");
    tree.unmount();
  });

  test("R3-2 the venue reserve bar walks pick → details", () => {
    const { venueReservationBarCopy, venueBarDayLabel } = require("../../venue/venueReservationBar") as typeof import("../../venue/venueReservationBar");
    const day = venueBarDayLabel("2026-11-20");
    expect(day).toBe("Fri 20 Nov");
    const base = {
      dayLabel: day,
      timeLabel: "7:30 PM",
      partySize: 4,
      occasion: "Date night",
      noTables: false,
      totalLabel: "$63.90",
      requiresPayment: true,
      reviewing: false,
    };
    expect(venueReservationBarCopy({ ...base, step: "pick" })).toEqual({
      title: "Fri 20 Nov · 7:30 PM",
      subtitle: "4 guests · Date night",
      ctaLabel: "Continue",
    });
    expect(venueReservationBarCopy({ ...base, step: "details" })).toEqual({
      title: "$63.90 today",
      subtitle: "Deposit · Fri 20 Nov · 7:30 PM · 4 guests",
      // TEST-MOD-APPROVED #4490 (N53): the bar names the amount due.
      ctaLabel: "Confirm · $63.90",
    });
    expect(
      venueReservationBarCopy({ ...base, step: "details", requiresPayment: false, totalLabel: null })
        .ctaLabel,
    ).toBe("Confirm reservation");
    expect(venueReservationBarCopy({ ...base, step: "details", reviewing: true }).ctaLabel).toBe(
      "Confirm updated total",
    );
    expect(
      venueReservationBarCopy({ ...base, step: "pick", timeLabel: null, noTables: true }),
    ).toEqual({ title: "Fri 20 Nov", subtitle: "No tables this day", ctaLabel: "Continue" });
  });

  test("R3-3 CheckoutHero wears the host accent and face; Graphite stays Graphite", () => {
    const { CheckoutHero } = require("../CheckoutHero") as typeof import("../CheckoutHero");
    const graphiteTree = mount(<CheckoutHero tone="success" icon="check" title="You're in." testID="h" />);
    const gDisc = graphiteTree.root.findAll((n) => n.props.testID === "h-disc")[0];
    expect(flat(gDisc?.props.style).backgroundColor).toBe(graphite.accent);
    graphiteTree.unmount();

    setActiveCheckoutPalette(palette);
    setActiveCheckoutTheme(theme);
    const tree = mount(
      <CheckoutHero tone="success" icon="check" title="You're in." body="2 tickets." testID="h" />,
    );
    const disc = tree.root.findAll((n) => n.props.testID === "h-disc")[0];
    expect(flat(disc?.props.style).backgroundColor).toBe(palette.accent);
    const glyph = tree.root.findAll((n) => n.type === "MockIcon")[0];
    expect(glyph?.props.color).toBe(palette.accentText);
    const title = tree.root.findAll(
      (n) => n.type === "Text" && n.props.accessibilityRole === "header",
    )[0];
    expect(flat(title?.props.style).fontFamily).toBeDefined();
    expect(flat(title?.props.style).color).toBe(palette.primaryText);
    expect(textOf(tree)).toEqual(expect.arrayContaining(["You're in.", "2 tickets."]));
    tree.unmount();

    const warn = mount(<CheckoutHero tone="warning" icon="swap" title="Your total changed" testID="w" />);
    const wDisc = warn.root.findAll((n) => n.props.testID === "w-disc")[0];
    expect(flat(wDisc?.props.style).backgroundColor).not.toBe(palette.accent);
    warn.unmount();
  });

  test("R3-4 youreInLine counts what the guest holds", () => {
    const { youreInLine } = require("../CheckoutHero") as typeof import("../CheckoutHero");
    const noun = { one: "ticket", many: "tickets" };
    expect(
      youreInLine({ lines: [{ qty: 1 }, { qty: 1 }], dateLine: "Sat 12 Dec" }, "Rooftop", noun),
    ).toBe("2 tickets for Rooftop, Sat 12 Dec.");
    expect(youreInLine({ lines: [{ qty: 1 }], dateLine: null }, "Rooftop", noun)).toBe(
      "1 ticket for Rooftop.",
    );
    expect(youreInLine(null, "Rooftop", noun)).toBeNull();
    // issue #4522 E-8 — one room plus one add-on is one place, not two
    expect(
      youreInLine(
        { lines: [{ qty: 1 }, { qty: 1, addOn: true }], dateLine: "Fri 12 Mar 2027 – Tue 16 Mar 2027" },
        "Zanzibar",
        { one: "place", many: "places" },
      ),
    ).toBe("1 place for Zanzibar, Fri 12 Mar 2027 – Tue 16 Mar 2027.");
  });

  test("R3-5 the offering strip: phone only, host face title", () => {
    const { CheckoutOfferingStrip } = require("../CheckoutOfferingStrip") as typeof import("../CheckoutOfferingStrip");
    setActiveCheckoutPalette(palette);
    setActiveCheckoutTheme(theme);
    const props = {
      title: "Graphite Rooftop Night",
      eyebrow: "Sat 12 Dec · 8 PM",
      byline: "Graphite Journey Co",
      coverUrl: null,
    };
    const phone = mount(<CheckoutOfferingStrip {...props} wide={false} />);
    expect(textOf(phone)).toEqual(["Sat 12 Dec · 8 PM", "Graphite Rooftop Night", "Graphite Journey Co"]);
    const title = phone.root.findAll(
      (n) => n.type === "Text" && n.props.children === "Graphite Rooftop Night",
    )[0];
    expect(flat(title?.props.style).fontFamily).toBeDefined();
    phone.unmount();
    const desk = mount(<CheckoutOfferingStrip {...props} wide />);
    expect(desk.root.findAll((n) => n.props.testID === "checkout-offering-strip")).toHaveLength(0);
    desk.unmount();
  });
});
