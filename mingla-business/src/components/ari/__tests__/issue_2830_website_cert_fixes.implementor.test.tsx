/**
 * #2830 P4 — fixes from the live browser certification of Website setup on
 * the Ari flow engine (local Sites stack, 2026-11-01).
 *
 * D4: the newest Ari reply rendered greyed out, as if disabled. The reveal
 *     fade starts every chunk at 0.22 opacity and only an animation frame
 *     moves it; a page the browser isn't painting (background tab, hidden
 *     pane) runs none, so the reply stayed at 0.22. The text now settles to
 *     plain, full-opacity text on a timer, and immediately when hidden.
 * D8: opening Website setup sent a long scripted instruction as the owner's
 *     own message. It is now a structured request with a short bubble.
 */
import * as fs from "fs";
import * as path from "path";
import React from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let mockOS = "web";
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  const easingFn = (t: number): number => t;
  const timing = () => ({ start: () => undefined, stop: () => undefined });
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return mockOS;
      },
      select: (spec: Record<string, unknown>) => spec[mockOS] ?? spec.default,
    },
    Easing: actual.Easing ?? {
      out: () => easingFn,
      quad: easingFn,
    },
    Animated: {
      ...(actual.Animated ?? {}),
      // The fade never advances: the state of a page with no animation frames.
      Value: class {
        constructor(public value: number) {}
        setValue(v: number) {
          this.value = v;
        }
      },
      timing,
      parallel: () => ({ start: () => undefined, stop: () => undefined }),
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
    useReducedMotion: () => false,
    withTiming: (value: unknown) => value,
    withDelay: (_delay: unknown, value: unknown) => value,
    Easing: { out: (f: unknown) => f, quad: (t: number) => t },
  };
});

jest.mock("../../../services/ariPolishAnalytics", () => ({
  captureAriRevealOutcome: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SemanticRevealText, SEMANTIC_REVEAL_SETTLE_GRACE_MS, semanticRevealDuration } =
  require("../SemanticRevealText") as typeof import("../SemanticRevealText");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => void) => void;
  create: (el: React.ReactElement) => {
    root: { findAll: (p: (n: { props: Record<string, unknown> }) => boolean) => unknown[] };
    unmount: () => void;
  };
};

const TEXT = "I checked; your brand logo is there now.\n\nWhich look should your Mingla page use?";

function settledCount(renderer: ReturnType<typeof create>): number {
  return renderer.root.findAll((n) => n.props?.testID === "ari-reveal-settled").length;
}

describe("cert D4 — an Ari reply never stays greyed out", () => {
  const doc = globalThis as unknown as { document?: { hidden?: boolean } };
  const original = doc.document;
  afterEach(() => {
    doc.document = original;
    jest.useRealTimers();
  });

  it("on a page that isn't being painted, the reply shows settled at full opacity at once", () => {
    mockOS = "web";
    doc.document = { hidden: true };
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<SemanticRevealText text={TEXT} textStyle={{}} />);
    });
    expect(settledCount(renderer)).toBeGreaterThan(0);
    act(() => renderer.unmount());
  });

  it("when the fade can't run, a timer settles the text right after the reveal's own duration", () => {
    jest.useFakeTimers();
    mockOS = "web";
    doc.document = { hidden: false };
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<SemanticRevealText text={TEXT} textStyle={{}} />);
    });
    expect(settledCount(renderer)).toBe(0); // the reveal is playing
    act(() => {
      jest.advanceTimersByTime(semanticRevealDuration(2) + SEMANTIC_REVEAL_SETTLE_GRACE_MS + 1);
    });
    expect(settledCount(renderer)).toBeGreaterThan(0);
    act(() => renderer.unmount());
  });
});

describe("cert D8 — opening Website setup is a structured request", () => {
  const root = path.resolve(__dirname, "../../../..");
  const screen = fs.readFileSync(path.join(root, "src/screens/ari/AriChatScreen.tsx"), "utf8");
  const hook = fs.readFileSync(path.join(root, "src/hooks/useAgentChat.ts"), "utf8");

  it("the screen never sends the scripted instruction as the owner's words", () => {
    expect(screen).not.toMatch(/Start Website setup\./);
    expect(screen).toMatch(/\.startWebsiteSetup\(setupPart \?\? null\)/);
  });

  it("the request carries the kickoff and shows only a short neutral bubble", () => {
    expect(hook).toMatch(/WEBSITE_SETUP_KICKOFF_DISPLAY = "Set up my Website"/);
    expect(hook).toMatch(/website_setup_kickoff: part \? \{ part \} : \{\}/);
  });

  it("cert D10: a card's route button navigates without a message", () => {
    expect(screen).toMatch(/onFlowRoute=\{handleFlowRoute\}/);
    const handler = screen.slice(screen.indexOf("const handleFlowRoute"));
    expect(handler.slice(0, handler.indexOf("};"))).not.toMatch(/send(Message|FlowAnswer)/);
  });
});
