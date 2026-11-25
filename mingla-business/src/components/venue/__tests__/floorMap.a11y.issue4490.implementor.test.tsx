/**
 * #4490 P5 (spec 02 §6) — floorMap.a11y: every table on the Host floor and on
 * the guest seat map is a labelled button whose label carries its state word,
 * taken tables can't be picked, and new guest/host floor files hold no hex
 * colour (tokens and the venue palette only).
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";

import { FloorMap, type FloorMapTable } from "../features/floor/FloorMap";
import { VenueFloorPick } from "../offers/VenueFloorPick";
import type { GuestTableOption } from "../../../services/venueTableGuestService";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Node {
  props: Record<string, unknown>;
}
interface Renderer {
  root: {
    findByProps: (p: Record<string, unknown>) => Node;
    findAll: (pred: (n: Node) => boolean) => Node[];
  };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => Renderer;
};
const act = TestRenderer.act;

const tables: FloorMapTable[] = [
  { id: "a", name: "B1", shape: "round", box: { x: 100, y: 100, w: 100, h: 100, rotation: 0 }, seats: 4, word: "Seated · 4", tone: "seated", accessibilityLabel: "B1, 4 seats, Seated · Kunle · 4" },
  { id: "b", name: "B2", shape: "booth", box: { x: 300, y: 100, w: 150, h: 80, rotation: 90 }, seats: 6, word: "Free", tone: "free", accessibilityLabel: "B2, 6 seats, Free" },
];

describe("Host floor map", () => {
  it("draws each table as a labelled button with its state word", () => {
    const onSelect = jest.fn();
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(<FloorMap room={{ shape: "rect", landmarks: [] }} tables={tables} selectedId={null} onSelect={onSelect} width={600} />);
    });
    const b1 = tree.root.findByProps({ testID: "floor-table-a" });
    expect(b1.props.accessibilityRole).toBe("button");
    expect(String(b1.props.accessibilityLabel)).toContain("Seated");
    act(() => (b1.props.onPress as () => void)());
    expect(onSelect).toHaveBeenCalledWith("a");
  });
  it("tells a keyboard or screen-reader user how to move a table while editing", () => {
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(<FloorMap room={{ shape: "wide", landmarks: [{ id: "l", kind: "bar", x: 0, y: 0, w: 300, h: 60, rotation: 0 }] }} tables={tables} selectedId="b" onSelect={() => undefined} editing width={600} />);
    });
    expect(String(tree.root.findByProps({ testID: "floor-table-b" }).props.accessibilityLabel)).toMatch(/arrow buttons/);
    expect(String(tree.root.findByProps({ testID: "floor-landmark-l" }).props.accessibilityLabel)).toMatch(/^Bar/);
  });
});

describe("Guest seat map", () => {
  const base: GuestTableOption = {
    kind: "table",
    tableIds: ["t1"],
    names: ["B3"],
    spaceId: "s1",
    spaceName: "Dining room",
    capacity: 4,
    shape: "round",
    planX: 300,
    planY: 200,
    planW: 100,
    planH: 100,
    rotation: 0,
    status: "free",
    minSpendMinor: 0,
    holdPerGuestMinor: 500000,
    holdMinor: 2000000,
  };
  const palette = {
    accent: "accent",
    accentText: "accentText",
    accentWash: "wash",
    panelBorder: "border",
    card: "card",
    page: "page",
    primaryText: "p",
    secondaryText: "s",
    tertiaryText: "t",
  } as unknown as Parameters<typeof VenueFloorPick>[0]["palette"];
  it("labels free and taken tables in words; a taken one can't be picked", () => {
    const onSelect = jest.fn();
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(
        <VenueFloorPick
          palette={palette}
          options={[base, { ...base, tableIds: ["t2"], names: ["B4"], status: "taken" }]}
          spacePlans={{}}
          selectedKey={null}
          onSelect={onSelect}
          money={(m) => `N${m / 100}`}
        />,
      );
    });
    const free = tree.root.findByProps({ testID: "venue-floor-pick-row-t1" });
    const taken = tree.root.findByProps({ testID: "venue-floor-pick-row-t2" });
    expect(String(free.props.accessibilityLabel)).toBe("B3, seats 4, free, N5000 a guest to hold it");
    expect(String(taken.props.accessibilityLabel)).toContain("taken at this time");
    expect(taken.props.disabled).toBe(true);
    act(() => (free.props.onPress as () => void)());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("tokens only", () => {
  const root = path.resolve(__dirname, "..");
  const files = [
    "features/floor/FloorMap.tsx",
    "features/floor/FloorEditor.tsx",
    "features/floor/VenueFloorLive.tsx",
    "features/floor/TableForm.tsx",
    "features/floor/VenueTablesInSpaces.tsx",
    "features/offers/HourEditor.tsx",
    "offers/VenueFloorPick.tsx",
    "offers/GuestWaitlistForm.tsx",
    "offers/VisitWaitlist.tsx",
    "offers/VenueHourPane.tsx",
    "offers/HourCheckout.tsx",
  ];
  it.each(files)("%s has no hex, rgb or hsl colour", (file) => {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    expect(src).not.toMatch(/["'`]#[0-9a-fA-F]{3,8}["'`]|rgba?\(|hsla?\(/);
  });
});
