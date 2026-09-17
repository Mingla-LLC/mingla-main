/**
 * #3402 [typeable guest limit] — RsvpStep5Setup wires the shared NumberStepper.
 *
 * Mounts the REAL RsvpStep5Setup (react-test-renderer over the stock jest
 * config's passthrough react-native mock) and drives it the way a host does:
 *   G-1  switching "Limit the guest list" on starts at 50, not 1 — and still in
 *        ONE combined patch (I-PROPOSED-1355-TOGGLE-SINGLE-PATCH).
 *   G-2  the Max guests count is a number-pad field: typing 300 writes 300.
 *   G-3  a typed 0 is clamped to the minimum of 1 on blur; a huge number is
 *        clamped to RSVP_GUEST_LIMIT_MAX.
 *   G-4  − / + still move one step and keep the rsvp-capacity-* testIDs.
 *   G-5  Max extra guests per person uses the same control, bounded 1..99.
 *
 * FAILS-ON-REVERT: restore the private one-tap stepper or the `?? 1` default
 * in RsvpStep5Setup.tsx and G-1..G-3/G-5 go red.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import type { DraftEvent } from "../../../store/draftEventStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../intel/TurnoutForecastCard", () => ({
  TurnoutForecastCard: (): null => null,
}));
jest.mock("../../intel/useTurnoutFocusTarget", () => ({
  useTurnoutFocusTarget: (): boolean => false,
}));

import {
  RSVP_DEFAULT_GUEST_LIMIT,
  RSVP_GUEST_LIMIT_MAX,
  RSVP_PLUS_ONES_MAX,
  RsvpStep5Setup,
} from "../RsvpStep5Setup";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

type Patch = Partial<DraftEvent>;

const makeDraft = (overrides: Patch = {}): DraftEvent =>
  ({
    id: "d_guest_limit",
    rsvpCapacity: null,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpContributionEnabled: false,
    rsvpContributionSuggestedCents: null,
    rsvpContributionMinCents: null,
    currency: "USD",
    privateGuestList: false,
    hideRemainingCount: false,
    visibility: "public",
    rsvpDiscoverable: false,
    ...overrides,
  }) as unknown as DraftEvent;

/**
 * Mount with a parent that merges patches into the draft and re-renders, like
 * the wizard's handleUpdate over the draft store.
 */
async function mountStep(initial: DraftEvent): Promise<{
  tree: Tree;
  patches: Patch[];
}> {
  const patches: Patch[] = [];
  let draft = initial;
  let tree: Tree | undefined;
  const element = (): React.ReactElement => (
    <RsvpStep5Setup
      {...({
        draft,
        updateDraft: (patch: Patch) => {
          patches.push(patch);
          draft = { ...draft, ...patch } as DraftEvent;
          tree?.update(element());
        },
        brandDefaultCurrency: "USD",
        chipInPayoutReady: false,
      } as unknown as React.ComponentProps<typeof RsvpStep5Setup>)}
    />
  );
  await act(() => {
    tree = TestRenderer.create(element());
  });
  return { tree: tree as Tree, patches };
}

const hostById = (tree: Tree, testID: string): HostNode[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );

const host = (tree: Tree, testID: string): HostNode => {
  const found = hostById(tree, testID);
  if (found.length !== 1) {
    throw new Error(`expected one host node "${testID}", found ${found.length}`);
  }
  return found[0];
};

const call = async (
  tree: Tree,
  testID: string,
  handler: string,
  ...args: unknown[]
): Promise<void> => {
  await act(() => {
    (host(tree, testID).props[handler] as (...a: unknown[]) => void)(...args);
  });
};

describe("#3402 RsvpStep5Setup — typeable guest limit", () => {
  test("G-1 switching the limit on starts at 50 in one combined patch", async () => {
    expect(RSVP_DEFAULT_GUEST_LIMIT).toBe(50);
    const { tree, patches } = await mountStep(makeDraft());
    expect(hostById(tree, "rsvp-capacity-value")).toHaveLength(0);

    await call(tree, "rsvp-capacity-toggle", "onPress");
    expect(patches).toEqual([{ rsvpCapacity: 50 }]);
    expect(host(tree, "rsvp-capacity-value").props.value).toBe("50");

    // OFF is still the single combined write.
    await call(tree, "rsvp-capacity-toggle", "onPress");
    expect(patches[1]).toEqual({ rsvpCapacity: null, rsvpWaitlistEnabled: false });
    await act(() => tree.unmount());
  });

  test("G-2 typing 300 into Max guests writes 300", async () => {
    const { tree, patches } = await mountStep(makeDraft({ rsvpCapacity: 50 }));
    const field = host(tree, "rsvp-capacity-value");
    expect(field.type).toBe("TextInput");
    expect(field.props.keyboardType).toBe("number-pad");

    await call(tree, "rsvp-capacity-value", "onFocus");
    await call(tree, "rsvp-capacity-value", "onChangeText", "300");
    await call(tree, "rsvp-capacity-value", "onBlur");
    expect(patches[patches.length - 1]).toEqual({ rsvpCapacity: 300 });
    expect(host(tree, "rsvp-capacity-value").props.value).toBe("300");
    await act(() => tree.unmount());
  });

  test("G-3 a typed 0 clamps to 1; a huge number clamps to the max", async () => {
    const { tree, patches } = await mountStep(makeDraft({ rsvpCapacity: 50 }));
    await call(tree, "rsvp-capacity-value", "onFocus");
    await call(tree, "rsvp-capacity-value", "onChangeText", "0");
    await call(tree, "rsvp-capacity-value", "onBlur");
    expect(patches[patches.length - 1]).toEqual({ rsvpCapacity: 1 });

    expect(host(tree, "rsvp-capacity-value").props.maxLength).toBe(
      String(RSVP_GUEST_LIMIT_MAX).length,
    );
    await call(tree, "rsvp-capacity-value", "onFocus");
    await call(tree, "rsvp-capacity-value", "onChangeText", "999999");
    await call(tree, "rsvp-capacity-value", "onSubmitEditing");
    expect(patches[patches.length - 1]).toEqual({
      rsvpCapacity: RSVP_GUEST_LIMIT_MAX,
    });
    await act(() => tree.unmount());
  });

  test("G-4 − / + still step by one under the rsvp-capacity testIDs", async () => {
    const { tree, patches } = await mountStep(makeDraft({ rsvpCapacity: 80 }));
    await call(tree, "rsvp-capacity-inc", "onPress");
    expect(patches[patches.length - 1]).toEqual({ rsvpCapacity: 81 });
    await call(tree, "rsvp-capacity-dec", "onPress");
    await call(tree, "rsvp-capacity-dec", "onPress");
    expect(patches[patches.length - 1]).toEqual({ rsvpCapacity: 79 });
    expect(host(tree, "rsvp-capacity-inc").props.accessibilityLabel).toBe(
      "Increase Max guests",
    );
    await act(() => tree.unmount());
  });

  test("G-5 Max extra guests per person is typeable and bounded 1..99", async () => {
    expect(RSVP_PLUS_ONES_MAX).toBe(99);
    const { tree, patches } = await mountStep(
      makeDraft({ rsvpAllowPlusOnes: true, rsvpPlusOnesMax: 2 }),
    );
    const field = host(tree, "rsvp-plusones-max-value");
    expect(field.type).toBe("TextInput");
    expect(field.props.maxLength).toBe(2);

    await call(tree, "rsvp-plusones-max-value", "onFocus");
    await call(tree, "rsvp-plusones-max-value", "onChangeText", "6");
    await call(tree, "rsvp-plusones-max-value", "onBlur");
    expect(patches[patches.length - 1]).toEqual({ rsvpPlusOnesMax: 6 });

    await call(tree, "rsvp-plusones-max-value", "onFocus");
    await call(tree, "rsvp-plusones-max-value", "onChangeText", "0");
    await call(tree, "rsvp-plusones-max-value", "onBlur");
    expect(patches[patches.length - 1]).toEqual({ rsvpPlusOnesMax: 1 });
    await act(() => tree.unmount());
  });
});
