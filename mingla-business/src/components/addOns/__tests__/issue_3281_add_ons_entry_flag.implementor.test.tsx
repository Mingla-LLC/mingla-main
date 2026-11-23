// MINGLA-INVARIANT: I-ADDON-EDITOR-FLAG-DARK | issue #3281 | With EXPO_PUBLIC_FF_EXTRAS_ENABLED off (its default), no offering editor renders the Add-ons card or loads the editor; with it on, only a saved offering shows the card, and the editor loads on the first tap.
/**
 * issue #3281 S3 — the Add-ons card on every offering editor.
 *
 * Fails on revert: drop the flag check, show the card for a local draft id,
 * or import the editor eagerly -> red.
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flags = { extras: false };
jest.mock("../../../config/featureFlags", () => ({
  isFeatureEnabled: (key: string) => key === "extras" && flags.extras,
  featureFlags: {},
}));
// The house error boundary's Button loads reanimated; the boundary itself is
// not under test here.
jest.mock("../../ui/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
// #3281 S-22 — the card reads the offering's saved add-ons (the editor's key).
const savedAddOns: { data: { addOns: Array<{ name: string }> } | undefined } = { data: undefined };
jest.mock("../../../hooks/useOfferingAddOns", () => ({
  useOfferingAddOns: () => savedAddOns,
}));
const loads: string[] = [];
jest.mock("../AddOnsEditorSheet", () => {
  loads.push("editor");
  const MockEditorSheet = (props: Record<string, unknown>) => React.createElement("MockEditorSheet", props);
  return { __esModule: true, default: MockEditorSheet, AddOnsEditorSheet: MockEditorSheet };
});

// eslint-disable-next-line import/first
import { AddOnsEntry } from "../AddOnsEntry";
// eslint-disable-next-line import/first
import { featureFlags } from "../../../config/featureFlags";

type Node = { type: unknown; props: Record<string, unknown> };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; toJSON: () => unknown };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};

const SAVED = "32813000-0000-4000-8300-000000000006";
const render = (eventId: string | null): Tree => {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<AddOnsEntry eventId={eventId} offering="trip" currency="USD" />);
  });
  return tree;
};

describe("the Add-ons card", () => {
  test("the flag is off by default (featureFlags.ts is unchanged)", () => {
    const actual = jest.requireActual<{ featureFlags: Record<string, boolean> }>("../../../config/featureFlags");
    expect(featureFlags).toBeDefined();
    expect(actual.featureFlags.extras).toBe(false);
  });

  test("flag off: renders nothing, even for a saved offering", () => {
    flags.extras = false;
    expect(render(SAVED).toJSON()).toBeNull();
  });

  test("flag on: a local draft id or no id still renders nothing", () => {
    flags.extras = true;
    expect(render(null).toJSON()).toBeNull();
    expect(render("draft_123").toJSON()).toBeNull();
  });

  test("flag on, saved offering: the card shows and the editor loads and opens on tap", async () => {
    flags.extras = true;
    const tree = render(SAVED);
    const card = tree.root.findAll((n) => n.props.testID === "add-ons-entry" && typeof n.props.onPress === "function")[0];
    expect(card.props.accessibilityLabel).toBe("Manage add-ons");
    expect(loads).toEqual([]);
    await TestRenderer.act(async () => {
      (card.props.onPress as () => void)();
      await new Promise((resolve) => setImmediate(resolve));
    });
    await TestRenderer.act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
    expect(loads).toEqual(["editor"]);
    const sheet = tree.root.findAll((n) => n.type === "MockEditorSheet")[0];
    expect(sheet.props).toMatchObject({ eventId: SAVED, offering: "trip", currency: "USD", visible: true });
  });

  // #3281 first screen test S-22 — FAILS ON REVERT: the collapsed card shows
  // only the generic line although the trip already has add-ons.
  test("flag on, saved offering with add-ons: the collapsed card names them", () => {
    flags.extras = true;
    savedAddOns.data = { addOns: [{ name: "Airport transfer" }, { name: "Welcome dinner" }] };
    const json = JSON.stringify(render(SAVED).toJSON());
    expect(json).toContain("Airport transfer · Welcome dinner");
    expect(json).not.toContain("Sell things like");
    savedAddOns.data = { addOns: [] };
    expect(JSON.stringify(render(SAVED).toJSON())).toContain("Sell things like");
    savedAddOns.data = undefined;
  });

  test("the editor is never imported eagerly by the card", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "AddOnsEntry.tsx"), "utf8");
    expect(source).not.toMatch(/^import\s+\{[^}]*AddOnsEditorSheet[^}]*\}\s+from/m);
    expect(source).toContain('() => import("./AddOnsEditorSheet")');
    // The Sheet primitive (reanimated at module scope) never rides the card.
    expect(source).not.toMatch(/from "\.\.\/ui\/(Sheet|OnIntentLazySheet)"/);
  });
});
