/**
 * #4453 — the "save first" toast a held brand switch raises logged
 * "In HTML, <button> cannot be a descendant of <button>": on web the toast
 * card was a <button> holding its close (and action) <button>.
 *
 * This renders the REAL ToastItem through react-native-web (the DOM the web
 * build emits) and reads the markup.
 *
 * FAILS-ON-REVERT: give the card `accessibilityRole="button"` on web again and
 * "no button sits inside another" fails with the nested markup.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4453_toast_no_nested_button.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

let mockWeb = true;
jest.mock("react-native", () => {
  const web = jest.requireActual("react-native-web") as Record<string, unknown> & { Platform: object };
  return new Proxy(web, {
    get: (target, key) =>
      key === "Platform" ? { ...target.Platform, OS: mockWeb ? "web" : "ios" } : target[key as string],
  });
});
jest.mock("react-native-gesture-handler", () => {
  const chain: Record<string, unknown> = {};
  for (const key of ["onUpdate", "onEnd", "activeOffsetY", "failOffsetX"]) chain[key] = () => chain;
  return { __esModule: true, Gesture: { Pan: () => chain } };
});
jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual("react-native-web") as { View: unknown };
  return {
    __esModule: true,
    default: { View },
    Easing: { out: () => 0, in: () => 0, cubic: 0 },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
jest.mock("../WebSafeGestureDetector", () => ({
  WebSafeGestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../Icon", () => ({ Icon: () => null }));
jest.mock("../Material", () => {
  const { View } = jest.requireActual("react-native-web") as { View: React.ComponentType<{ children?: React.ReactNode }> };
  return { Material: ({ children }: { children?: React.ReactNode }) => <View>{children}</View> };
});

import { ToastItem } from "../Toast";
import type { ToastEntry } from "../toastStore";

const entry = (over: Partial<ToastEntry> = {}): ToastEntry => ({
  id: 1,
  kind: "warn",
  message: "You have changes that aren't saved. Save or discard them, then switch brand.",
  onDismiss: () => undefined,
  testID: "workspace-brand-toast",
  ...over,
});

const ReactDOMServer = require("react-dom/server") as {
  renderToStaticMarkup: (el: React.ReactElement) => string;
};

const html = (e: ToastEntry): string =>
  ReactDOMServer.renderToStaticMarkup(<ToastItem entry={e} placement="top" />);

/** Depth of <button> nesting anywhere in the markup (1 = none nested). */
const deepestButton = (markup: string): number => {
  let depth = 0;
  let deepest = 0;
  for (const tag of markup.matchAll(/<(\/?)button\b/g)) {
    depth += tag[1] === "/" ? -1 : 1;
    deepest = Math.max(deepest, depth);
  }
  return deepest;
};

describe("#4453 the toast card on web", () => {
  beforeEach(() => {
    mockWeb = true;
  });

  test("no button sits inside another, with or without an action", () => {
    const plain = html(entry());
    expect(plain).toContain("aren&#x27;t saved");
    expect(deepestButton(plain)).toBe(1);
    const withAction = html(entry({ action: { label: "Retry", onPress: () => undefined } }));
    expect(deepestButton(withAction)).toBe(1);
    expect(withAction.match(/<button\b/g)).toHaveLength(2);
  });

  test("the close button is the named, focusable way to dismiss; the card is not a second tab stop", () => {
    const markup = html(entry());
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('aria-label="Dismiss notification"');
    expect(buttons[0]).not.toContain('tabindex="-1"');
    // The card: still there, still labelled, out of the tab order.
    const card = /<div\b[^>]*aria-label="Dismiss notification"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(card).toContain('tabindex="-1"');
    expect(card).not.toContain("role=");
  });

  test("it is still announced: a polite live region, or an alert when asked", () => {
    expect(html(entry())).toContain('aria-live="polite"');
    const alert = html(entry({ announce: true }));
    expect(alert).toContain('role="alert"');
    expect(alert).toContain('aria-live="assertive"');
  });
});

describe("#4453 the toast card on a phone keeps its button role", () => {
  test("off web the card is still a focusable button named \"Dismiss notification\"", () => {
    mockWeb = false;
    // Same renderer, native branch: the card's role and tab stop are untouched there.
    const card = /<button\b[^>]*aria-label="Dismiss notification"[^>]*>/.exec(html(entry()))?.[0] ?? "";
    expect(card).not.toBe("");
    expect(card).toContain('tabindex="0"');
  });
});
