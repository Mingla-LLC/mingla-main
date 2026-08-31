import React from "react";
import { Linking, Platform, StyleSheet } from "react-native";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

interface RenderNode {
  props: Record<string, unknown> & {
    testID?: string;
    children?: unknown;
    onPress?: () => void;
    style?: unknown;
  };
  findAll: (
    predicate: (node: RenderNode) => boolean,
    options?: { deep: boolean },
  ) => RenderNode[];
}
interface RenderTree {
  root: RenderNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void | Promise<void>) => void;
};
const act = TestRenderer.act as (callback: () => void) => void;

jest.mock("../../ui/Icon", () => ({
  __esModule: true,
  Icon: (props: Record<string, unknown>) =>
    require("react").createElement("MockIcon", props),
}));

import {
  DownloadMinglaCta,
  type DownloadMinglaClaimPhase,
} from "../DownloadMinglaCta";

const phases: DownloadMinglaClaimPhase[] = [
  "idle",
  "loading",
  "ready",
  "error",
  "unavailable",
  "terminal",
  "rate",
];

const originalPlatform = Platform.OS;
const originalWindow = (globalThis as unknown as { window?: unknown }).window;
let opens: string[] = [];
let assignments: string[] = [];

const installSurface = (
  os: "web" | "ios" | "android",
  reducedMotion = false,
): void => {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  opens = [];
  assignments = [];
  if (os !== "web") {
    (globalThis as unknown as { window?: unknown }).window = undefined;
    return;
  }
  (globalThis as unknown as { window?: unknown }).window = {
    matchMedia: () => ({
      matches: reducedMotion,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    open: (url: string) => {
      opens.push(url);
      return { opener: {} };
    },
    location: {
      assign: (url: string) => assignments.push(url),
      set href(url: string) {
        assignments.push(url);
      },
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Mingla desktop test", platform: "", maxTouchPoints: 0 },
  });
};

const mount = (
  phase: DownloadMinglaClaimPhase,
  onRetryClaim: () => void = () => undefined,
): { renderer: RenderTree; primary: RenderNode; text: string } => {
  let renderer: RenderTree | null = null;
  act(() => {
    renderer = TestRenderer.create(
      <DownloadMinglaCta
        eventName="Mingla Test Event"
        eventType="event"
        brandSlug="mingla"
        entitySlug="test-event"
        claimPhase={phase}
        claimAppUrl={null}
        onRetryClaim={onRetryClaim}
      />,
    );
  });
  const tree = renderer as unknown as RenderTree;
  const primary = tree.root.findAll((node) =>
    node.props.testID === "confirm-app-cta-primary"
  )[0] as RenderNode;
  const text = tree.root.findAll(() => true, { deep: true })
    .map((node) =>
      typeof node.props.children === "string" ? node.props.children : ""
    )
    .join(" ");
  return { renderer: tree, primary, text };
};

const unmount = (renderer: RenderTree): void => {
  act(() => {
    renderer.unmount();
  });
};

beforeEach(() => {
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(Platform, "OS", {
    value: originalPlatform,
    configurable: true,
  });
  (globalThis as unknown as { window?: unknown }).window = originalWindow;
});

describe("#2241 primary action stays present on every Host surface and phase", () => {
  for (const os of ["web", "ios", "android"] as const) {
    test(`${os}: all seven phases keep a working primary action`, () => {
      installSurface(os);
      for (const phase of phases) {
        const mounted = mount(phase);
        expect(mounted.primary).toBeDefined();
        expect(mounted.primary.props.accessibilityRole).toBe("link");
        expect(typeof mounted.primary.props.onPress).toBe("function");
        const navigationsBefore = os === "web"
          ? opens.length + assignments.length
          : jest.mocked(Linking.openURL).mock.calls.length;
        act(() => mounted.primary.props.onPress?.());
        const navigationsAfter = os === "web"
          ? opens.length + assignments.length
          : jest.mocked(Linking.openURL).mock.calls.length;
        expect(navigationsAfter).toBe(navigationsBefore + 1);
        unmount(mounted.renderer);
      }
    });
  }
});

describe("#2241 retry split and unavailable semantics", () => {
  test("only a transient error renders the retry control", () => {
    installSurface("web");
    let retries = 0;
    const error = mount("error", () => {
      retries += 1;
    });
    const retry = error.renderer.root.findAll((node) =>
      node.props.testID === "confirm-app-cta-retry"
    );
    expect(retry.length).toBeGreaterThan(0);
    retry[0]?.props.onPress?.();
    expect(retries).toBe(1);
    unmount(error.renderer);

    for (const phase of ["unavailable", "terminal", "rate"] as const) {
      const terminal = mount(phase);
      expect(terminal.renderer.root.findAll((node) =>
        node.props.testID === "confirm-app-cta-retry"
      )).toHaveLength(0);
      unmount(terminal.renderer);
    }
  });

  test("configuration outage is a polite semantic status with exact approved copy", () => {
    installSurface("web");
    const mounted = mount("unavailable");
    const status = mounted.renderer.root.findAll((node) =>
      node.props.role === "status"
    );
    expect(status.length).toBeGreaterThan(0);
    expect(status[0]?.props.accessibilityLiveRegion).toBe("polite");
    expect(mounted.text).toContain(
      "Your tickets are confirmed. You can open the app and sign in with your checkout email or phone.",
    );
    unmount(mounted.renderer);
  });
});

describe("#2241 approved CTA visual interaction contract", () => {
  test("full-width warm CTA uses external-link glyph and resolved interaction styles", () => {
    installSurface("web", false);
    const mounted = mount("idle");
    const style = mounted.primary.props.style as (
      state: { pressed: boolean; hovered?: boolean; focused?: boolean },
    ) => unknown;
    const base = StyleSheet.flatten(style({ pressed: false })) as Record<string, unknown>;
    const hovered = StyleSheet.flatten(
      style({ pressed: false, hovered: true }),
    ) as Record<string, unknown>;
    const pressed = StyleSheet.flatten(
      style({ pressed: true, hovered: true }),
    ) as Record<string, unknown>;
    const focused = StyleSheet.flatten(
      style({ pressed: false, focused: true }),
    ) as Record<string, unknown>;
    expect(base.width).toBe("100%");
    expect(base.minHeight).toBe(48);
    expect(base.transitionDuration).toBe("150ms");
    expect(hovered.opacity).toBe(0.94);
    expect(pressed.opacity).toBe(0.88);
    expect(focused.outlineWidth).toBe(2);
    const external = mounted.renderer.root.findAll((node) =>
      node.props.name === "externalLink" && node.props.size === 18
    );
    expect(external.length).toBeGreaterThan(0);
    unmount(mounted.renderer);
  });

  test("reduced motion resolves the transition duration to zero", () => {
    installSurface("web", true);
    const mounted = mount("idle");
    const style = mounted.primary.props.style as (
      state: { pressed: boolean },
    ) => unknown;
    expect(
      (StyleSheet.flatten(style({ pressed: false })) as Record<string, unknown>)
        .transitionDuration,
    ).toBe("0ms");
    unmount(mounted.renderer);
  });
});
