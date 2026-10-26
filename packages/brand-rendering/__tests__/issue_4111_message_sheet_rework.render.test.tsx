/**
 * #4111 tester rework — the message sheet's P2 fixes, on the REAL shared
 * `BrandMessageSheet` and `BrandPageFoot`.
 *
 *   S-1  P2-1 "Already booked? … Open app" shows only when the brand offers
 *        something bookable; a brand with nothing listed shows only "Something
 *        else" and no app row.
 *   S-2  P2-2 every honeypot is out of the Tab order (tabIndex -1, not
 *        focusable) and hidden from screen readers (aria-hidden,
 *        accessibilityElementsHidden, no-hide-descendants).
 *
 * Mock boundary (declared): as the foot suite — lucide icons and the
 * offering-rendering barrel are stubbed; react-native-web's TextInput and Modal
 * (which need a DOM `document`) are host elements that keep their props.
 *
 * FAILS-ON-REVERT: dropping the brandHasOfferings guard fails S-1; dropping
 * tabIndex/aria-hidden from a honeypot fails S-2.
 */
let mockIsDesktop = false;
const mockFocus = jest.fn();

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const React = require("react");
  const TextInput = React.forwardRef(
    (props: Record<string, unknown>, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ focus: mockFocus }));
      return React.createElement("mock-text-input", props);
    },
  );
  const Modal = ({ visible, children }: { visible: boolean; children: unknown }) =>
    visible ? React.createElement("mock-modal", null, children) : null;
  return { ...actual, TextInput, Modal };
});

jest.mock("lucide-react-native", () => {
  const React = require("react");
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("mock-icon", { ...props, name });
  return new Proxy(
    {},
    {
      get: (_target, key: string) => (key === "__esModule" ? true : icon(key)),
    },
  );
});
jest.mock("@mingla/offering-rendering", () => {
  const React = require("react");
  const { View } = require("react-native");
  const lifecycle = jest.requireActual(
    "../../offering-rendering/eventAcquisitionLifecycle",
  );
  const theme = {
    color: "#f60",
    foregroundColor: "#fff",
    font: "inter",
    fontFamilyValue: "Inter",
    animation: "none",
  };
  const palette = {
    page: "#fff",
    card: "#fff",
    panel: "#fff",
    panelStrong: "#fff",
    panelBorder: "#ddd",
    accent: "#f60",
    accentWash: "#fee",
    accentText: "#fff",
    primaryText: "#111",
    secondaryText: "#333",
    tertiaryText: "#666",
  };
  return {
    ...lifecycle,
    MINGLA_DEFAULT_THEME: theme,
    resolveTheme: () => theme,
    createThemePalette: () => palette,
    offeringSurfaceStyles: () => ({
      card: {},
      cardStrong: {},
      primaryText: {},
      secondaryText: {},
    }),
    useResponsiveLayout: () => ({ isDesktop: mockIsDesktop }),
    EventCoverMedia: () => React.createElement(View),
    FollowerCountLine: () => null,
    ParallaxCoverShell: ({
      children,
      stickyPanel,
    }: {
      children: React.ReactNode;
      stickyPanel?: React.ReactNode;
    }) => React.createElement(View, null, children, stickyPanel ?? null),
  };
});

import React from "react";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { BrandMessageSheet } from "../enquiry/BrandMessageSheet";
import { BrandPageFoot } from "../enquiry/BrandPageFoot";
import { buildEnquiryTopicGroups } from "../enquiry/enquiryTopics";

type Node = { type: unknown; props: Record<string, unknown>; children?: Array<Node | string> };
type Renderer = { root: { findAll: (fn: (node: Node) => boolean) => Node[] }; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(120000);

const THEME = { color: "#f60", foregroundColor: "#fff", font: "inter", fontFamilyValue: "Inter", animation: "none" } as ResolvedTheme;
const PALETTE = {
  page: "#fff", card: "#fff", panel: "#fff", panelStrong: "#fff", panelBorder: "#ddd", cutoutBorder: "#ddd",
  glass: "#fff", glassTint: "light", accent: "#f60", accentWash: "#fee", accentText: "#fff",
  primaryText: "#111", secondaryText: "#333", tertiaryText: "#666",
} as ThemePalette;

const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
};
const byTestID = (tree: Renderer, id: string): Node[] => tree.root.findAll((n) => n.props.testID === id);

const sheet = (offerings: boolean): React.ReactElement => (
  <BrandMessageSheet
    visible
    onClose={() => undefined}
    brandName="Soft Life Travel Club"
    theme={THEME}
    groups={buildEnquiryTopicGroups({
      brandName: "Soft Life Travel Club",
      signedIn: false,
      offerings: offerings
        ? [{ id: "t1", title: "Lagos Weekend", kind: "trip", startsAt: null, when: "upcoming" }]
        : [],
    })}
    viewer={{ kind: "signed_out_web" }}
    entry="brand_page"
    onSend={async () => ({ ok: true, email: "a@b.co", threadUrl: null, conversationId: null })}
    onOpenApp={() => undefined}
  />
);

const expectHiddenHoneypot = (node: Node | undefined): void => {
  expect(node).toBeDefined();
  expect(node?.props.tabIndex).toBe(-1);
  expect(node?.props.focusable).toBe(false);
  expect(node?.props["aria-hidden"]).toBe(true);
  expect(node?.props.accessibilityElementsHidden).toBe(true);
  expect(node?.props.importantForAccessibility).toBe("no-hide-descendants");
};

describe("#4111 rework — message sheet P2-1 / P2-2", () => {
  test("S-1 no offerings → no 'Already booked?' row; offerings → the row", async () => {
    const empty = await mount(sheet(false));
    expect(byTestID(empty, "brand-message-sheet-open-app-row")).toHaveLength(0);
    expect(byTestID(empty, "brand-message-sheet-group-something_else").length).toBeGreaterThan(0);
    empty.unmount();
    const listed = await mount(sheet(true));
    expect(byTestID(listed, "brand-message-sheet-open-app-row").length).toBeGreaterThan(0);
    listed.unmount();
  });

  test("S-2 the sheet's and the foot's honeypots are out of Tab order and hidden from screen readers", async () => {
    const s = await mount(sheet(false));
    const general = byTestID(s, "brand-message-sheet-pick-topic:general_question").find(
      (n) => typeof n.props.onPress === "function",
    );
    await TestRenderer.act(async () => {
      (general?.props.onPress as () => void)();
    });
    expectHiddenHoneypot(byTestID(s, "brand-message-sheet-hp").find((n) => typeof n.props.onChangeText === "function"));
    s.unmount();

    const foot = await mount(
      <BrandPageFoot
        brandName="Lantern Room"
        palette={PALETTE}
        theme={THEME}
        loop={{ state: "idle", sentTo: null, sentSms: false, errorMessage: null, onSubmit: () => undefined, onReset: () => undefined }}
      />,
    );
    expectHiddenHoneypot(byTestID(foot, "brand-page-foot-loop-hp").find((n) => typeof n.props.onChangeText === "function"));
    foot.unmount();
  });
});
