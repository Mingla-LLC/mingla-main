/**
 * RSVP Step 5 host copy + logic (filmed on the iOS sim, 2026-09-15).
 *
 * Mounts the REAL RsvpStep5Setup (react-test-renderer over the stock jest
 * config's passthrough react-native mock) and drives it like a host:
 *
 *   V-1  Public shows the discovery-feed switch, and its sub-copy says what
 *        OFF really means (still on the brand page) — never "invite-link only",
 *        which is what Unlisted means.
 *   V-2  Unlisted and Private do NOT show the switch; they say why instead.
 *   V-3  Picking Unlisted or Private from Public + feed ON saves the feed OFF in
 *        ONE patch (I-PROPOSED-1355-TOGGLE-SINGLE-PATCH). The server only forces
 *        it off for Private, so Unlisted used to keep `rsvp_discoverable = true`.
 *        Picking Public never turns the feed on by itself.
 *   H-1  "Hide the spots-left count" no longer claims "Guests see who's going"
 *        while the guest list is private.
 *   C-1  A naira chip-in field reads "₦", never "NGN" (already fixed on main by
 *        #3378; pinned here at the component so it cannot drift back).
 *
 * FAILS-ON-REVERT: restore the old `opt.id === "private"` patch (V-3 Unlisted),
 * the always-rendered switch (V-2), the old sub-copy (V-1/H-1), or drop
 * `withCurrencyGlyph` from `currencySymbol` (C-1).
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
  RSVP_DISCOVERY_UNAVAILABLE,
  RsvpStep5Setup,
  rsvpDiscoverySub,
  rsvpHideCountSub,
} from "../RsvpStep5Setup";

type JsonNode = {
  type: string;
  props: Record<string, unknown>;
  children: Array<JsonNode | string> | null;
};
type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  toJSON: () => JsonNode | JsonNode[] | null;
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
    id: "d_visibility_discovery",
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

/** Parent that merges each patch into the draft and re-renders, like the wizard. */
async function mountStep(
  initial: DraftEvent,
  brandDefaultCurrency = "USD",
): Promise<{ tree: Tree; patches: Patch[]; current: () => DraftEvent }> {
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
        brandDefaultCurrency,
        chipInPayoutReady: false,
      } as unknown as React.ComponentProps<typeof RsvpStep5Setup>)}
    />
  );
  await act(() => {
    tree = TestRenderer.create(element());
  });
  return { tree: tree as Tree, patches, current: () => draft };
}

const hostByTestId = (tree: Tree, testID: string): HostNode[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );

const press = async (tree: Tree, testID: string): Promise<void> => {
  const [node] = hostByTestId(tree, testID);
  expect(node).toBeDefined();
  await act(() => {
    (node.props.onPress as () => void)();
  });
};

const allText = (tree: Tree): string => {
  const out: string[] = [];
  const walk = (node: JsonNode | string | null): void => {
    if (node === null) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  const json = tree.toJSON();
  for (const node of Array.isArray(json) ? json : [json]) walk(node);
  return out.join("\n");
};

const OLD_DISCOVERY_COPY = "invite-link only";
const OLD_PRIVATE_COPY = "A private RSVP can't be on the public feed.";

describe("V-1 Public: the feed switch says what OFF and ON really do", () => {
  test("OFF reads as brand page + link, ON adds the Mingla app feed", async () => {
    const { tree } = await mountStep(makeDraft({ visibility: "public" }));

    expect(hostByTestId(tree, "rsvp-discoverable-toggle")).toHaveLength(1);
    expect(allText(tree)).toContain(
      "Off: people find it on your brand page or with your link.",
    );
    expect(allText(tree)).not.toContain(OLD_DISCOVERY_COPY);

    await press(tree, "rsvp-discoverable-toggle");

    expect(allText(tree)).toContain(
      "On: people nearby can also find it in the Mingla app and RSVP.",
    );
    expect(rsvpDiscoverySub(false)).not.toContain(OLD_DISCOVERY_COPY);
  });
});

describe("V-2 Unlisted and Private hide the switch and say why", () => {
  test.each([["unlisted" as const], ["private" as const]])(
    "%s: no feed switch, one reason line",
    async (visibility) => {
      const { tree } = await mountStep(
        makeDraft({ visibility, rsvpDiscoverable: false }),
      );

      expect(hostByTestId(tree, "rsvp-discoverable-toggle")).toHaveLength(0);
      const reason = hostByTestId(tree, "rsvp-discoverable-unavailable");
      expect(reason).toHaveLength(1);
      expect(allText(tree)).toContain(RSVP_DISCOVERY_UNAVAILABLE[visibility]);
      expect(allText(tree)).not.toContain(OLD_DISCOVERY_COPY);
      expect(allText(tree)).not.toContain(OLD_PRIVATE_COPY);
    },
  );

  test("a legacy draft stored as Unlisted + feed ON still shows no switch", async () => {
    const { tree } = await mountStep(
      makeDraft({ visibility: "unlisted", rsvpDiscoverable: true }),
    );
    expect(hostByTestId(tree, "rsvp-discoverable-toggle")).toHaveLength(0);
  });
});

describe("V-3 leaving Public saves the feed OFF in one patch", () => {
  test.each([["unlisted" as const], ["private" as const]])(
    "Public + feed ON → %s writes { visibility, rsvpDiscoverable: false } once",
    async (visibility) => {
      const { tree, patches, current } = await mountStep(
        makeDraft({ visibility: "public", rsvpDiscoverable: true }),
      );

      await press(tree, `rsvp-visibility-${visibility}`);

      expect(patches).toEqual([{ visibility, rsvpDiscoverable: false }]);
      expect(current().visibility).toBe(visibility);
      expect(current().rsvpDiscoverable).toBe(false);
    },
  );

  test("picking Public patches only the visibility and leaves the feed OFF", async () => {
    const { tree, patches, current } = await mountStep(
      makeDraft({ visibility: "unlisted", rsvpDiscoverable: false }),
    );

    await press(tree, "rsvp-visibility-public");

    expect(patches).toEqual([{ visibility: "public" }]);
    expect(current().rsvpDiscoverable).toBe(false);
    expect(hostByTestId(tree, "rsvp-discoverable-toggle")).toHaveLength(1);
  });
});

describe("H-1 the spots-left sub-copy follows the private guest list", () => {
  test("public list: guests see who's going; private list: no such claim", async () => {
    const { tree } = await mountStep(makeDraft({ privateGuestList: false }));

    expect(allText(tree)).toContain(
      "Guests see who's going — not how many spots remain.",
    );

    await press(tree, "rsvp-private-guestlist");

    const text = allText(tree);
    expect(text).toContain("Guests won't see how many spots remain.");
    expect(text).not.toContain("Guests see who's going");
    expect(rsvpHideCountSub(true)).not.toContain("who's going");
  });
});

describe("C-1 naira chip-in fields read ₦, not NGN", () => {
  test("both money prefixes are the glyph", async () => {
    const { tree } = await mountStep(
      makeDraft({
        currency: "NGN",
        rsvpContributionEnabled: true,
        rsvpContributionSuggestedCents: 50000,
      }),
      "NGN",
    );

    const text = allText(tree);
    expect(text).not.toContain("NGN");
    expect(text.split("\n").filter((line) => line === "₦")).toHaveLength(2);
  });
});
