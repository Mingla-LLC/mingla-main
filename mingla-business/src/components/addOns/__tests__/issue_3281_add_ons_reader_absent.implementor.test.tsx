/**
 * issue #3281 G-9 — a server with no add-on reader yet (the web deploys before
 * its migrations): the read answers PGRST202 ("function not found"). The
 * Add-ons card must not appear, and the sheet must never sit on "Loading
 * add-ons…". Real shape: PostgREST's own 404 body for a missing function.
 *
 * FAILS ON REVERT: drop the READER_ABSENT_CODES mapping in
 * offeringAddOnsService.ts, or the add_ons_unavailable check in AddOnsEntry.tsx.
 */
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = jest.fn<(fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("../../../services/supabase", () => ({ supabase: { rpc: (...a: [string, unknown]) => rpc(...a) } }));
jest.mock("../../../config/featureFlags", () => ({
  isFeatureEnabled: (key: string) => key === "extras",
  featureFlags: {},
}));
jest.mock("../../ui/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
let mockReader: { data?: unknown; error?: { code: string } | null } = {};
jest.mock("../../../hooks/useOfferingAddOns", () => ({
  useOfferingAddOns: () => mockReader,
}));
jest.mock("../AddOnsEditorSheet", () => ({
  __esModule: true,
  default: () => null,
  AddOnsEditorSheet: () => null,
}));

// eslint-disable-next-line import/first
import { AddOnsEntry } from "../AddOnsEntry";
// eslint-disable-next-line import/first
import { fetchOfferingAddOns } from "../../../services/offeringAddOnsService";

type Node = { type: unknown; props: Record<string, unknown> };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => void) => void;
};
const SAVED = "32813000-0000-4000-8300-000000000007";
const render = (): Tree => {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<AddOnsEntry eventId={SAVED} offering="trip" currency="USD" />);
  });
  return tree;
};
const card = (tree: Tree): Node[] =>
  tree.root.findAll((n) => n.props.testID === "add-ons-entry");

beforeEach(() => {
  rpc.mockReset();
  mockReader = {};
});

describe("#3281 G-9 add-ons on a server with no reader", () => {
  test("the read maps PostgREST's function-not-found to add_ons_unavailable (never 'unknown', never retried)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.biz_offering_add_ons(p_event_id) in the schema cache",
      },
    });
    await expect(fetchOfferingAddOns(SAVED)).rejects.toMatchObject({ code: "add_ons_unavailable" });
  });

  test("any other failure is still 'unknown' (a real outage is not hidden)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    await expect(fetchOfferingAddOns(SAVED)).rejects.toMatchObject({ code: "unknown" });
  });

  test("the Add-ons card is hidden when the reader is absent", () => {
    mockReader = { error: { code: "add_ons_unavailable" } };
    const tree = render();
    expect(card(tree)).toHaveLength(0);
    TestRenderer.act(() => tree.unmount());
  });

  test("the card still shows while the read loads and on a real failure", () => {
    for (const reader of [{}, { error: { code: "unknown" } }]) {
      mockReader = reader;
      const tree = render();
      expect(card(tree).length).toBeGreaterThan(0);
      TestRenderer.act(() => tree.unmount());
    }
  });
});
