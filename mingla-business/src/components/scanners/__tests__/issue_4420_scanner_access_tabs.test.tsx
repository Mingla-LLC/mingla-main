/**
 * #4420 round-3 item 5 — scanner access is a two-tab switcher, "This event" |
 * "Brand events", and the consequence line under it keeps both facts.
 *
 * [TEST-MOD-APPROVED #4420] — was a source-text pin (I-PROPOSED-1047-NO-SOLE-
 * SOURCE-PIN); now mounts the REAL InviteScannerSheet with the REAL Segmented
 * and drives the tabs. Only boundaries are mocked (the Sheet host, the invite
 * mutation, the scroll wrapper, Button, Toast).
 *
 * FAILS ON REVERT: the radio rows coming back (no tablist), a label drifting,
 * the brand-only open showing the event tab, a consequence line dropped, or a
 * tab press changing scope mid-submit.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockPending = false;

jest.mock("react-native-reanimated", () => {
  const { View: V } = jest.requireActual("react-native") as { View: unknown };
  return {
    __esModule: true,
    default: { View: V },
    Easing: { out: () => 0, cubic: 0 },
    cancelAnimation: () => undefined,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) => (visible ? children : null),
}));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../ui/Button", () => ({ Button: () => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native") as { View: unknown };
  return { ScrollView: View };
});
jest.mock("../../../hooks/useScannerInvitations", () => ({
  useInviteScanner: () => ({ mutateAsync: jest.fn(), isPending: mockPending }),
}));

type Node = { type: unknown; props: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tree = { root: { find: (p: (n: Node) => boolean) => Node; findAll: (p: (n: Node) => boolean) => Node[] } };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void) => void;
};
const { act } = TestRenderer;
const { InviteScannerSheet } = require("../InviteScannerSheet") as typeof import("../InviteScannerSheet");

const EVENT = { id: "ev-1", name: "Rooftop Night" } as unknown as import("../../../store/liveEventStore").LiveEvent;

function mount(props: { event: typeof EVENT | null; brandOnly?: boolean }): Tree {
  let tree: Tree | undefined;
  act(() => {
    tree = TestRenderer.create(
      <InviteScannerSheet
        visible
        event={props.event}
        brandId="brand-1"
        paymentProvider="stripe"
        operatorAccountId="acct-1"
        brandOnly={props.brandOnly}
        onClose={() => undefined}
        onSuccess={() => undefined}
      />,
    );
  });
  return tree as Tree;
}

function texts(tree: Tree): string[] {
  return tree.root
    .findAll((n) => typeof n.type === "string" && n.type === "Text")
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children ?? "")));
}

const byTestID = (tree: Tree, id: string) => tree.root.find((n) => typeof n.type === "string" && n.props.testID === id);

beforeEach(() => {
  mockPending = false;
});

describe("#4420 scanner access tabs", () => {
  test("an event open shows the two short tabs as a tablist, with This event selected", () => {
    const tree = mount({ event: EVENT });
    expect(byTestID(tree, "scanner-scope").props.accessibilityRole).toBe("tablist");
    const eventTab = byTestID(tree, "scanner-scope-event");
    const brandTab = byTestID(tree, "scanner-scope-brand");
    expect([eventTab.props.accessibilityLabel, brandTab.props.accessibilityLabel]).toEqual(["This event", "Brand events"]);
    expect(eventTab.props.accessibilityState.selected).toBe(true);
    expect(tree.root.findAll((n) => n.props.accessibilityRole === "radio")).toHaveLength(0);
    expect(texts(tree)).toContain("They can scan Rooftop Night.");
  });

  test("pressing Brand events swaps the consequence line", () => {
    const tree = mount({ event: EVENT });
    act(() => {
      byTestID(tree, "scanner-scope-brand").props.onPress();
    });
    expect(byTestID(tree, "scanner-scope-brand").props.accessibilityState.selected).toBe(true);
    expect(texts(tree)).toContain("They can scan tickets at any of your events — now and later.");
  });

  test("a brand-only open has no event tab and keeps the brand line", () => {
    for (const props of [{ event: EVENT, brandOnly: true }, { event: null }]) {
      const tree = mount(props);
      expect(tree.root.findAll((n) => n.props.testID === "scanner-scope")).toHaveLength(0);
      expect(texts(tree)).toContain("They can scan tickets at any of your events — now and later.");
    }
  });

  test("scope never changes mid-submit", () => {
    mockPending = true;
    const tree = mount({ event: EVENT });
    act(() => {
      byTestID(tree, "scanner-scope-brand").props.onPress();
    });
    expect(byTestID(tree, "scanner-scope-event").props.accessibilityState.selected).toBe(true);
    expect(texts(tree)).toContain("They can scan Rooftop Night.");
  });
});
