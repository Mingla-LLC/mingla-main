/**
 * #3872 Promote polish — kit cards keep their inner padding on web.
 *
 * SYMPTOM: on Business web every Creator / Referral list (and Blast ›
 * Overview) drew its icon tiles, chevrons and "Send" flush against the
 * card's left and right edges, and the stat strip's numbers touched the
 * card's top and bottom borders.
 *
 * CAUSE: GlassCard rendered its content node with
 * `style={[{ padding }, contentStyle]}`. On react-native-web a
 * `StyleSheet.create` style compiles to a CSS class while the plain
 * `{ padding }` object becomes an INLINE style, and inline wins, so every
 * padding longhand a caller set (`paddingHorizontal: 16` on ListGroup,
 * `paddingVertical: 16` on StatStrip) resolved to 0 on web. Native resolved
 * the array left to right and was fine.
 *
 * WHAT RUNS HERE: the REAL GlassCard, ListGroup and StatStrip through
 * react-native-web's own style resolver.
 *
 * FAILS ON REVERT: put `style={[{ padding }, contentStyle]}` back in
 * GlassCard.tsx and the ListGroup and StatStrip cases go red (0px).
 *
 * Run (from mingla-business/):
 *   npx jest --config jest.issue3872promote.web.render.cjs --ci --maxWorkers=2
 */
import React from "react";
import { StyleSheet, Text } from "react-native";

// No @types/react-test-renderer in this app: type the slice these proofs use
// (same pattern as the #3827 web render suites).
type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  parent: TestNode | null;
  children: Array<TestNode | string>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = { root: TestNode };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => void | Promise<void>) => Promise<void> | void;
};
const { act } = TestRenderer;

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { GlassCard } from "../../ui/GlassCard";
import { ListGroup, ListRow, StatStrip } from "../ProgramKit";

type Style = Record<string, string | undefined>;

function mount(element: React.ReactElement): Renderer {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  if (!renderer) throw new Error("did not mount");
  return renderer;
}

/** Nearest host (DOM) ancestor of `node` whose inline style sets `key`. */
function hostAncestorWith(node: TestNode, key: string): Style {
  let current: TestNode | null = node.parent;
  while (current) {
    if (typeof current.type === "string") {
      const style = current.props.style as Style | undefined;
      if (style && style[key] !== undefined) return style;
    }
    current = current.parent;
  }
  throw new Error(`no host ancestor sets ${key}`);
}

function byTestId(renderer: Renderer, id: string): TestNode {
  const found = renderer.root.findAll(
    (n) => typeof n.type === "string" && n.props["data-testid"] === id,
  );
  if (found.length === 0) throw new Error(`no ${id}`);
  return found[0];
}

describe("GlassCard content padding on web (#3872)", () => {
  it("ListGroup keeps its 16px side inset", () => {
    const r = mount(
      <ListGroup>
        <ListRow title="Campaigns" subtitle="3 sent" testID="row" />
      </ListGroup>,
    );
    const style = hostAncestorWith(byTestId(r, "row"), "paddingLeft");
    expect(style.paddingLeft).toBe("16px");
    expect(style.paddingRight).toBe("16px");
    // The card's own `padding={0}` still zeroes the sides the caller did not set.
    expect(style.paddingTop).toBe("0px");
  });

  it("StatStrip keeps its 16px top and bottom padding", () => {
    const r = mount(
      <StatStrip
        items={[
          { value: "$0", label: "Sold via promotion" },
          { value: "12", label: "Link clicks" },
        ]}
      />,
    );
    const cell = r.root.findAll(
      (n) =>
        typeof n.type === "string" &&
        n.props["aria-label"] === "Link clicks: 12",
    )[0];
    const style = hostAncestorWith(cell, "paddingTop");
    expect(style.paddingTop).toBe("16px");
    expect(style.paddingBottom).toBe("16px");
  });

  it("the wide (desktop) strip keeps its 20px top and bottom padding", () => {
    const r = mount(<StatStrip layout="wide" items={[{ value: "1", label: "Clicks" }]} />);
    const cell = r.root.findAll(
      (n) => typeof n.type === "string" && n.props["aria-label"] === "Clicks: 1",
    )[0];
    expect(hostAncestorWith(cell, "paddingTop").paddingTop).toBe("20px");
  });

  it("a card with no content style still gets its default 16px on every side", () => {
    const r = mount(
      <GlassCard testID="card">
        <Text>body</Text>
      </GlassCard>,
    );
    const style = byTestId(r, "card-content").props.style as Style;
    expect(style).toMatchObject({
      paddingTop: "16px",
      paddingRight: "16px",
      paddingBottom: "16px",
      paddingLeft: "16px",
    });
  });

  it("a caller's longhand beats the card's shorthand, on every platform", () => {
    const sheet = StyleSheet.create({ content: { paddingVertical: 4 } });
    const r = mount(
      <GlassCard testID="card" padding={20} contentStyle={sheet.content}>
        <Text>body</Text>
      </GlassCard>,
    );
    const style = byTestId(r, "card-content").props.style as Style;
    expect(style.paddingTop).toBe("4px");
    expect(style.paddingBottom).toBe("4px");
    expect(style.paddingLeft).toBe("20px");
  });
});
