// MINGLA-INVARIANT: I-ADDON-EXPLORER-RSVP-PASS-ADD-ONS | issue #3281 | Explorer reads and shows the add-ons on a guest's own RSVP pass only while FEATURE_FLAG_ADD_ONS is on, and sends RSVP add-on picks to public-submit-rsvp only when there are some.
/**
 * issue #3281 S6 (checkpoint 16) — Explorer's RSVP add-ons.
 *
 *   PASS-*    RsvpPassAddOns (on RsvpPassSheet) lists "Tee × 2 · Seat × 1"
 *             from issue_3281_my_rsvp_add_ons while the flag is on; off, it
 *             reads nothing and draws nothing; a failed read says so with a
 *             labelled retry; none draws nothing.
 *   SEND-*    submitDeckRsvp sends `rsvpAddOns` only with picks (an RSVP
 *             without add-ons sends exactly the old body).
 *   READ-*    the RSVP page's list comes from the RSVP reader's `rsvpAddOns`.
 *
 * FAILS-ON-REVERT: drop the FEATURE_FLAG_ADD_ONS check in RsvpPassAddOns
 * (PASS-OFF red), drop the rsvpAddOns spread in submitDeckRsvp (SEND-1 red),
 * or always send it (SEND-2 red).
 */
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<TestNode | string>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = { root: TestNode; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;
const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const mockFlag = { on: true };
jest.mock("../../../config/featureFlags", () => ({
  get FEATURE_FLAG_ADD_ONS() {
    return mockFlag.on;
  },
}));
const mockQuery: { data: unknown; isError: boolean; refetch: jest.Mock; seen: Array<{ key: unknown; enabled: boolean }> } = {
  data: undefined,
  isError: false,
  refetch: jest.fn(),
  seen: [],
};
jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: unknown; enabled?: boolean }) => {
    mockQuery.seen.push({ key: options.queryKey, enabled: options.enabled !== false });
    return {
      data: options.enabled === false ? undefined : mockQuery.data,
      isError: options.enabled !== false && mockQuery.isError,
      refetch: mockQuery.refetch,
    };
  },
}));
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) }, rpc: (...a: unknown[]) => mockRpc(...a) },
  supabaseUrl: "https://example.supabase.co",
  getSupabaseFunctionHeaders: () => ({}),
}));

import { RsvpPassAddOns } from "../RsvpPassAddOns";
import {
  fetchMyRsvpAddOns,
  fetchRsvpAddOnsBySlug,
  submitDeckRsvp,
} from "../../../services/rsvpDeckService";

const render = async (el: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(el);
  });
  return tree;
};
const texts = (tree: Renderer): string =>
  tree.root.findAll((n) => n.type === "Text" || n.type === "span" || n.type === "div").map(textOf).join(" | ");

beforeEach(() => {
  mockFlag.on = true;
  mockQuery.data = undefined;
  mockQuery.isError = false;
  mockQuery.refetch.mockReset();
  mockQuery.seen.length = 0;
  mockInvoke.mockReset();
  mockRpc.mockReset();
});

describe("#3281 S6 Explorer RSVP pass add-ons", () => {
  test("PASS-ON: the owner's pass lists their add-ons", async () => {
    mockQuery.data = [
      { id: "t", name: "Tee", quantity: 2 },
      { id: "s", name: "Seat", quantity: 1 },
    ];
    const tree = await render(<RsvpPassAddOns rsvpId="rsvp-1" enabled />);
    expect(mockQuery.seen[0]).toEqual({ key: ["rsvp-add-ons", "mine", "rsvp-1"], enabled: true });
    const card = tree.root.findAll((n) => n.props.testID === "issue-3281-rsvp-pass-add-ons");
    expect(card.length).toBeGreaterThan(0);
    expect(card[0].props.accessibilityLabel).toBe("Add-ons: Tee × 2 · Seat × 1");
  });

  test("PASS-OFF: flag off reads nothing and draws nothing", async () => {
    mockFlag.on = false;
    mockQuery.data = [{ id: "t", name: "Tee", quantity: 2 }];
    const tree = await render(<RsvpPassAddOns rsvpId="rsvp-1" enabled />);
    expect(mockQuery.seen.every((q) => q.enabled === false)).toBe(true);
    expect(tree.root.findAll((n) => typeof n.props.testID === "string" && String(n.props.testID).startsWith("issue-3281"))).toHaveLength(0);
  });

  test("PASS-GUEST: a plus-one's pass (or a closed sheet) reads nothing", async () => {
    mockQuery.data = [{ id: "t", name: "Tee", quantity: 2 }];
    const tree = await render(<RsvpPassAddOns rsvpId="rsvp-1" enabled={false} />);
    expect(mockQuery.seen.every((q) => q.enabled === false)).toBe(true);
    expect(texts(tree)).not.toContain("Tee");
  });

  test("PASS-NONE: no add-ons draws nothing", async () => {
    mockQuery.data = [];
    const tree = await render(<RsvpPassAddOns rsvpId="rsvp-1" enabled />);
    expect(tree.root.findAll((n) => n.props.testID === "issue-3281-rsvp-pass-add-ons")).toHaveLength(0);
  });

  test("PASS-ERROR: a failed read says so and retries on a labelled tap", async () => {
    mockQuery.isError = true;
    const tree = await render(<RsvpPassAddOns rsvpId="rsvp-1" enabled />);
    expect(texts(tree)).toContain("Your add-ons didn't load.");
    const retry = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Try loading your add-ons again" && typeof n.props.onPress === "function",
    )[0];
    await act(async () => {
      (retry.props.onPress as () => void)();
    });
    expect(mockQuery.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("#3281 S6 Explorer RSVP add-on reads and sends", () => {
  const accepted = { data: { status: "going", approvalStatus: "approved", rsvpId: "r-1" }, error: null };

  test("SEND-1: picks go to public-submit-rsvp as rsvpAddOns", async () => {
    mockInvoke.mockResolvedValue(accepted);
    await submitDeckRsvp("e-1", "going", [], undefined, undefined, [{ addOnId: "a-1", quantity: 2 }]);
    expect(mockInvoke.mock.calls[0][0]).toBe("public-submit-rsvp");
    expect((mockInvoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.rsvpAddOns).toEqual([
      { addOnId: "a-1", quantity: 2 },
    ]);
  });

  test("SEND-2: no picks, or none, sends no rsvpAddOns key", async () => {
    mockInvoke.mockResolvedValue(accepted);
    await submitDeckRsvp("e-1", "going", []);
    await submitDeckRsvp("e-1", "going", [], undefined, undefined, []);
    for (const call of mockInvoke.mock.calls) {
      expect("rsvpAddOns" in (call[1] as { body: Record<string, unknown> }).body).toBe(false);
    }
  });

  test("READ-1: the page list is the RSVP reader's rsvpAddOns, null when absent", async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: "e-1", rsvpAddOns: [{ id: "a" }] }, error: null });
    await expect(fetchRsvpAddOnsBySlug("b", "e")).resolves.toEqual([{ id: "a" }]);
    expect(mockRpc).toHaveBeenCalledWith("pg_public_rsvp_by_slug", { p_brand_slug: "b", p_event_slug: "e" });
    mockRpc.mockResolvedValueOnce({ data: { id: "e-1" }, error: null });
    await expect(fetchRsvpAddOnsBySlug("b", "e")).resolves.toBeNull();
  });

  test("READ-2: the pass read keeps only well-formed rows and throws on error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ id: "t", name: "Tee", quantity: 2 }, { id: "x", name: " ", quantity: 1 }, { id: "y", name: "Y", quantity: 0 }],
      error: null,
    });
    await expect(fetchMyRsvpAddOns("rsvp-1")).resolves.toEqual([{ id: "t", name: "Tee", quantity: 2 }]);
    expect(mockRpc).toHaveBeenCalledWith("issue_3281_my_rsvp_add_ons", { p_rsvp_id: "rsvp-1" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(fetchMyRsvpAddOns("rsvp-1")).rejects.toThrow("permission denied");
  });
});
