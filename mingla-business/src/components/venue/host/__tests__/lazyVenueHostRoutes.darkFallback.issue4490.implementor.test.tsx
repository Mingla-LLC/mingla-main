/**
 * #4490 final recheck P3 — while a full-screen Host venue route (the Till,
 * Close the day, Selling in person, Kitchen and bar, the offer editor) loads
 * its screen, the "Loading ..." fallback sits on the app's dark canvas, so web
 * never flashes the light page behind it before the dark screen paints.
 *
 * FAILS-ON-REVERT: drop `style: styles.routeSurface` from any route in
 * LazyVenueHostRoutes.tsx and that route's case goes red (no dark, full-height
 * surface wraps its loading label).
 */
import React from "react";
import { StyleSheet } from "react-native";
import { describe, expect, it, jest } from "@jest/globals";

import { color } from "../../../../constants/designSystem";

jest.mock("../../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => React.createElement("MockButton", props),
}));
jest.mock("../../../ui/Icon", () => ({
  Icon: () => React.createElement("MockIcon"),
}));
jest.mock("../venueHostOwner", () => ({
  // Never resolves: the route stays on its Suspense fallback.
  loadVenueHostScreens: () => new Promise(() => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routes = require("../LazyVenueHostRoutes") as typeof import("../LazyVenueHostRoutes");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  parent: Node | null;
  children: Array<Node | string>;
}
interface Renderer {
  root: { findAll: (pred: (n: Node) => boolean) => Node[] };
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => Renderer;
};

function textOf(node: Node): string {
  return node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}

const CASES: Array<[keyof typeof routes, string]> = [
  ["LazyVenueTillRoute", "Loading the Till"],
  ["LazyVenueDayCloseRoute", "Loading Close the day"],
  ["LazyVenueTillSettingsRoute", "Loading Selling in person"],
  ["LazyVenueStationRoute", "Loading Kitchen and bar"],
  ["LazyVenueOfferEditorRoute", "Loading the offer"],
];

describe("Host venue routes load on the dark canvas", () => {
  it.each(CASES)("%s shows its loading label on a full-height dark surface", (name, label) => {
    const Route = routes[name] as React.ComponentType<{ params: Record<string, string> }>;
    let renderer: Renderer | null = null;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(<Route params={{ venueId: "v1" }} />);
    });
    const r = renderer as unknown as Renderer;
    const labels = r.root.findAll((n) => typeof n.type === "string" && textOf(n) === label);
    expect(labels.length).toBeGreaterThan(0);

    let node: Node | null = labels[0] ?? null;
    let surface: Record<string, unknown> | null = null;
    while (node !== null) {
      const flat = StyleSheet.flatten(node.props.style as never) as Record<string, unknown> | undefined;
      if (flat !== undefined && flat !== null && flat.backgroundColor !== undefined) {
        surface = flat;
        break;
      }
      node = node.parent;
    }
    expect(surface).not.toBeNull();
    expect(surface?.backgroundColor).toBe(color.canvas);
    expect(surface?.flex).toBe(1);
    TestRenderer.act(() => r.unmount());
  });
});
