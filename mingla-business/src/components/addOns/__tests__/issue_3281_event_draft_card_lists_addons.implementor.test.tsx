/**
 * issue #3281 S-22 — the EVENT Add-ons card, collapsed, on a draft names the
 * add-ons its tickets already carry (trips and saved events already did).
 *
 * Fails on revert: the draft branch goes back to the generic promo line.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../../config/featureFlags", () => ({
  isFeatureEnabled: (key: string) => key === "extras",
  featureFlags: {},
}));
jest.mock("../../ui/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../../hooks/useOfferingAddOns", () => ({
  useOfferingAddOns: () => ({ data: undefined }),
}));
jest.mock("../AddOnsEditorSheet", () => ({
  __esModule: true,
  default: () => null,
  AddOnsEditorSheet: () => null,
}));

// eslint-disable-next-line import/first
import { AddOnsEntry } from "../AddOnsEntry";

type Tree = { toJSON: () => unknown };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};

const ticket = (extras: unknown[]) => ({
  id: "tk1",
  name: "General",
  isFree: false,
  priceGbp: 20,
  extras,
});
const extra = (id: string, name: string) => ({
  id,
  name,
  description: null,
  priceGbp: 5,
  isUnlimited: true,
  capacity: null,
  maxPerTicket: 1,
  validDayIds: null,
});
const render = (tickets: unknown[]): string => {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <AddOnsEntry
        eventId={null}
        offering="event"
        currency="USD"
        draft={{
          event: {
            id: "draft_1",
            tickets,
            currency: "USD",
            whenMode: "single",
            multiDates: [],
            timezone: "UTC",
          } as never,
          onChange: () => undefined,
        }}
      />,
    );
  });
  return JSON.stringify(tree.toJSON());
};

describe("the event draft's Add-ons card", () => {
  test("names the add-ons the draft's tickets carry", () => {
    const json = render([ticket([extra("a1", "Coat check"), extra("a2", "Drink token")])]);
    expect(json).toContain("Coat check · Drink token");
    expect(json).not.toContain("Sell things like");
  });
  test("with none, keeps the promo line", () => {
    expect(render([ticket([])])).toContain("Sell things like");
  });
});
