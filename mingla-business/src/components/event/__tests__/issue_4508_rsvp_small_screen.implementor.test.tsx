/**
 * issue #4508 fix round 6 — the shared RSVP pieces on a small phone, rendered.
 *
 *   R4  "You're on the list" with an invites card: the content scrolls inside
 *       the card (flexShrink), Done is pinned under it (outside the scroll),
 *       and the backdrop is not a parent of the card, so a screen reader sees
 *       each guest row and button, never one "Dismiss" element.
 *   R2  The guest block uses the surface's injected text input for "Search
 *       friends" (Explorer passes its bottom-sheet input), and react-native's
 *       TextInput when none is passed (Host, buyer web).
 *
 * FAILS-ON-REVERT: put Done back inside the ScrollView -> R4-1 fails; make the
 * card a child of the "Dismiss" Pressable again -> R4-2 fails; drop the
 * ScrollView's flexShrink -> R4-1 fails; drop the row label -> R4-3 fails;
 * render a fixed TextInput for search -> R2-1 fails.
 */

import React from "react";
import type { TextInputProps } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-native", () => {
  const base = jest.requireActual("../../../../__manual_mocks__/react-native.js");
  return {
    ...base,
    AccessibilityInfo: { announceForAccessibility: () => undefined },
  };
});
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }), {
  virtual: true,
});

type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  parent: TestNode | null;
  children: Array<TestNode | string>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = { root: TestNode };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

import { RsvpSuccessPopup } from "@mingla/offering-rendering/RsvpSuccessPopup";
import { RsvpGuestPartyBlock } from "@mingla/offering-rendering/RsvpGuestPartyBlock";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";

const theme = resolveTheme(null, null);
const palette = createThemePalette(theme);

const host = (tree: Renderer, testID: string): TestNode => {
  const found = tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === testID);
  if (found.length === 0) throw new Error(`no ${testID}`);
  return found[0];
};
const ancestors = (node: TestNode): TestNode[] => {
  const out: TestNode[] = [];
  for (let p = node.parent; p !== null; p = p.parent) out.push(p);
  return out;
};
const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flat))
    : style !== null && typeof style === "object"
      ? (style as Record<string, unknown>)
      : {};

const guest = (n: number, extra: Record<string, unknown> = {}) => ({
  guestId: `g${n}`,
  phoneLast4: `000${n}`,
  onMingla: false,
  displayName: n === 1 ? "Gabe Green" : null,
  claimed: false,
  inviteUrl: `https://usemingla.com/c/code${n}`,
  inviteCode: `code${n}`,
  willText: n !== 3,
  notTextedReason: n === 3 ? "unsupported_region" : null,
  ...extra,
});

const mountPopup = async (): Promise<Renderer> => {
  let tree: Renderer | null = null;
  await act(async () => {
    tree = TestRenderer.create(
      <RsvpSuccessPopup
        visible
        palette={palette}
        theme={theme}
        showCalendarNudge
        onClose={() => undefined}
        onCopyText={() => undefined}
        details={{
          eventName: "Rooftop",
          dateLine: "Sat 22 Nov · 8:00 PM",
          venueLine: "Lagos",
          guestName: "Rita",
          status: "going",
          plusGuests: [{ name: "Gabe Green" }, { name: "+1 555 000 0002" }, { name: "+233 24 000 0003" }],
          confirmationToken: null,
          credentials: [],
          anonymousRecovery: [],
          invites: [guest(1), guest(2), guest(3)],
          inviteMessage: { eventName: "Rooftop", dateLine: "Sat 22 Nov · 8:00 PM", area: "Lagos", online: false },
        }}
      />,
    );
  });
  // Let the lazily loaded invites card resolve.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return tree as unknown as Renderer;
};

test("R4-1: the content scrolls inside the card and Done is pinned outside the scroll", async () => {
  const tree = await mountPopup();
  const scroll = host(tree, "issue-4508-rsvp-success-scroll");
  const done = host(tree, "orch-1163-rsvp-success-done");
  expect(flat(scroll.props.style).flexShrink).toBe(1);
  expect(ancestors(done)).not.toContain(scroll);
  expect(ancestors(done)).toContain(host(tree, "issue-4508-rsvp-success-footer"));
  // Every "Send it yourself" row is in the scrolling content.
  expect(ancestors(host(tree, "issue-4508-rsvp-share-2"))).toContain(scroll);
});

test("R4-2: the backdrop is a hidden sibling, never the card's parent", async () => {
  const tree = await mountPopup();
  const card = host(tree, "orch-1163-rsvp-success-popup");
  const backdrop = host(tree, "issue-4508-rsvp-success-backdrop");
  expect(ancestors(card)).not.toContain(backdrop);
  expect(ancestors(card).some((n) => n.props.accessibilityLabel === "Dismiss")).toBe(false);
  expect(backdrop.props.accessible).toBe(false);
  expect(backdrop.props.accessibilityElementsHidden).toBe(true);
  expect(backdrop.props.importantForAccessibility).toBe("no-hide-descendants");
});

test("R4-3: each guest row and button is its own labelled element", async () => {
  const tree = await mountPopup();
  const row = host(tree, "issue-4508-rsvp-invite-2");
  expect(row.props.accessible).toBe(true);
  expect(row.props.accessibilityLabel).toBe(
    "Number ending 0003, We can't text this number yet. Send them your invite yourself.",
  );
  // Round 8: a guest added by number always carries the number's last four.
  expect(host(tree, "issue-4508-rsvp-share-0").props.accessibilityLabel).toBe("Share message for Gabe Green · 0001");
  expect(host(tree, "orch-1163-rsvp-success-done").props.accessibilityLabel).toBe("Done");
});

const blockProps = {
  palette,
  boldFamily: "System",
  max: 3,
  party: [],
  disabled: false,
  numberField: null,
  preview: { kind: "idle" as const },
  canAddNumber: false,
  onAddNumber: () => undefined,
  onRetryLookup: null,
  onRemove: () => undefined,
  friends: {
    query: "ko",
    onQueryChange: () => undefined,
    results: [],
    chips: [],
    loading: false,
    error: null,
    onRetry: null,
    onPick: () => undefined,
  },
};

test("R2-1: Search friends uses the surface's injected input", async () => {
  const SheetInput = (props: TextInputProps): React.ReactElement =>
    React.createElement("SheetInput", props);
  let tree: Renderer | null = null;
  await act(async () => {
    tree = TestRenderer.create(
      <RsvpGuestPartyBlock {...blockProps} friends={{ ...blockProps.friends, inputComponent: SheetInput }} />,
    );
  });
  const search = host(tree as unknown as Renderer, "issue-4508-rsvp-party-friend-search");
  expect(search.type).toBe("SheetInput");
  expect(search.props.accessibilityLabel).toBe("Search friends");
});

test("R2-2: without an injected input, react-native's TextInput (Host, buyer web)", async () => {
  let tree: Renderer | null = null;
  await act(async () => {
    tree = TestRenderer.create(<RsvpGuestPartyBlock {...blockProps} />);
  });
  const search = host(tree as unknown as Renderer, "issue-4508-rsvp-party-friend-search");
  expect(search.type).toBe("TextInput");
});
