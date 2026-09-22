/**
 * #3429 P0 — the revealing Ari bubble must RENDER and carry a spoken label.
 *
 * THE DEFECT THIS EXISTS FOR. `390f435a0` repointed SemanticRevealText's
 * segmenter import from `./ChatBubble` to the leaf `./ariBubbleSegments` and
 * dropped `toAccessibleText` from the binding list. Line 190 still called it,
 * so every fresh answer threw `ReferenceError: toAccessibleText is not defined`
 * and took the Ari screen to its error boundary on iOS, Android and web alike.
 *
 * WHY IT SHIPPED. The N-2 assertions that were supposed to protect this label
 * matched the SOURCE STRING `accessibilityLabel={`Ari said: ${toAccessibleText(text)}`}`.
 * A substring match is satisfied by the text of a call expression whether or
 * not the identifier is bound, so they stayed green over a screen that could
 * not render at all — the #2113 unfalsifiable class. Four rework rounds and a
 * twelve-cell device matrix passed with the crash in the tree.
 *
 * SO THIS FILE RENDERS THE REAL COMPONENT. No source is read. The label is
 * taken off the rendered element, which is the only form of this assertion that
 * can fail when the binding is missing — deleting `toAccessibleText` from the
 * import on line 16 makes every test here throw.
 *
 * Reanimated is mocked because the node/ts-jest config cannot load its native
 * side. That is a transport substitution, not a substitution for the component:
 * SemanticRevealText itself is the real module under test.
 */

import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// The node/ts-jest config's `react-native` has no core `Easing`/`Animated`
// timing implementation, which SemanticRevealText uses for its per-chunk fade.
// Fill only those two in; everything else stays the real module so the mock
// cannot drift as react-native's surface changes (#3429 / the partial-mock trap).
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const easingFn = (t: number): number => t;
  const easing = {
    out: () => easingFn,
    in: () => easingFn,
    inOut: () => easingFn,
    quad: easingFn,
    linear: easingFn,
    ease: easingFn,
    bezier: () => easingFn,
  };
  const timing = () => ({ start: (cb?: () => void) => cb?.() });
  return {
    ...actual,
    Easing: actual.Easing ?? easing,
    Animated: {
      ...(actual.Animated ?? {}),
      Value: class { constructor(public value: number) {} setValue(v: number) { this.value = v; } },
      timing: actual.Animated?.timing ?? timing,
      View: actual.View,
      Text: actual.Text,
    },
  };
});

jest.mock("react-native-reanimated", () => {
  const { View: V } = jest.requireActual("react-native");
  const passthrough = (component: unknown): unknown => component;
  return {
    __esModule: true,
    default: { View: V, Text: V, createAnimatedComponent: passthrough },
    View: V,
    Text: V,
    createAnimatedComponent: passthrough,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    withTiming: (value: unknown) => value,
    withDelay: (_delay: unknown, value: unknown) => value,
    Easing: { bezier: () => (t: number) => t, out: (f: unknown) => f, inOut: (f: unknown) => f, ease: (t: number) => t },
  };
});

jest.mock("../../../services/ariPolishAnalytics", () => ({
  captureAriRevealOutcome: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SemanticRevealText } = require("../SemanticRevealText") as {
  SemanticRevealText: React.FC<Record<string, unknown>>;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void) => void;
  create: (el: React.ReactElement) => { toJSON: () => JsonNode; unmount: () => void };
};

interface JsonNode {
  type: string;
  props: Record<string, unknown>;
  children: JsonNode[] | null;
}

/** The exact answer shape the RETEST-2 Android accessibility dump captured. */
const ANSWER =
  "Here is what I found for your week.\n- Friday rooftop launch\n- Saturday supper club\n- Sunday brunch pop-up";

function walk(node: JsonNode | null, visit: (n: JsonNode) => void): void {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

/** Renders the REAL component and returns every accessibility label in the tree. */
function renderLabels(text: string): string[] {
  let tree: { toJSON: () => JsonNode; unmount: () => void } | null = null;
  act(() => {
    tree = create(<SemanticRevealText text={text} />) as unknown as typeof tree;
  });
  const root = tree as unknown as { toJSON: () => JsonNode; unmount: () => void };
  const labels: string[] = [];
  walk(root.toJSON(), (node) => {
    const label = node.props?.accessibilityLabel;
    if (typeof label === "string") labels.push(label);
  });
  act(() => root.unmount());
  return labels;
}

describe("#3429 P0 — SemanticRevealText renders and speaks its answer", () => {
  it("R-1 renders at all (the crash was a ReferenceError at first paint)", () => {
    expect(() => renderLabels(ANSWER)).not.toThrow();
  });

  it("R-2 the rendered element carries the spoken label", () => {
    const labels = renderLabels(ANSWER);
    const spoken = labels.find((label) => label.startsWith("Ari said: "));
    expect(spoken).toBeDefined();
    expect(spoken).toContain("Here is what I found for your week.");
    expect(spoken).toContain("Friday rooftop launch");
    expect(spoken).toContain("Sunday brunch pop-up");
  });

  it("R-3 the spoken label reads no markdown list markers", () => {
    const spoken = renderLabels(ANSWER).find((label) => label.startsWith("Ari said: "));
    expect(spoken).not.toContain("- ");
    expect(spoken).not.toContain("*");
  });

  it("R-4 plain prose is carried through unchanged", () => {
    const prose = "Your Friday event sold 42 tickets.";
    const spoken = renderLabels(prose).find((label) => label.startsWith("Ari said: "));
    expect(spoken).toBe(`Ari said: ${prose}`);
  });

  it("R-5 an empty answer still renders without throwing", () => {
    expect(() => renderLabels("")).not.toThrow();
  });
});
