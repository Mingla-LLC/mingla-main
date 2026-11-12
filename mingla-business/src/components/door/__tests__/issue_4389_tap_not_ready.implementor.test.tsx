/**
 * #4389 (iPhone 15 recording) — a US brand still in setup saw "Tap to Pay on
 * iPhone isn't available here — This brand can't take taps. Use a pay code
 * instead." That copy belongs to brands that can never use Tap to Pay.
 *
 *   - no payment account yet (reason no_card_payments): "Finish setting up
 *     payments first" / "… works once your bank details are added.",
 *     primary "Finish setup" (→ /brand/{id}/setup?step=pay), secondary
 *     "Use a pay code";
 *   - truly unavailable (country / Nigerian rail / not switched on / server):
 *     "… isn't available here" with the reason, never "can't take taps".
 * Both Tap to Pay screens route their unavailable states through TapNotReady.
 *
 * FAILS ON REVERT: the old literal back on either screen → T3; no finish-setup
 * branch → T1.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

jest.mock("../../ui/Button", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return {
    Button: (p: { label: string; onPress: () => void; testID?: string }) =>
      R.createElement(RN.Pressable, { accessibilityLabel: p.label, onPress: p.onPress, testID: p.testID }),
  };
});
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../hooks/useMotionPreferences", () => ({ useReduceMotion: () => true }));

import { TapNotReady, tapNotReadyCopy } from "../tap/TapStatusView";

interface Node { type: unknown; props: Record<string, unknown>; children: Array<Node | string>; findAll(p: (n: Node) => boolean): Node[] }
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: { root: Node; unmount(): void } | null = null;
afterEach(() => {
  if (tree !== null) TestRenderer.act(() => tree?.unmount());
  tree = null;
});
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(" "));

describe("#4389 — Tap to Pay says what is actually missing", () => {
  test("T1: no payment account yet → Finish setting up payments first; Finish setup and Use a pay code", () => {
    const finish = jest.fn();
    const payCode = jest.fn();
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <TapNotReady reason="no_card_payments" os="ios" onFinishSetup={finish} onUsePayCode={payCode} testID="x" />,
      );
    });
    const root = (tree as unknown as { root: Node }).root;
    const text = textOf(root);
    expect(text).toContain("Finish setting up payments first");
    expect(text).toContain("Tap to Pay on iPhone works once your bank details are added.");
    expect(text).not.toMatch(/isn.t available here|can.t take taps/);
    const btn = (label: string): Node => root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === label)[0] as Node;
    TestRenderer.act(() => (btn("Finish setup").props.onPress as () => void)());
    TestRenderer.act(() => (btn("Use a pay code").props.onPress as () => void)());
    expect(finish).toHaveBeenCalledTimes(1);
    expect(payCode).toHaveBeenCalledTimes(1);
  });

  test("T2: truly unavailable says why, never 'can't take taps'", () => {
    const country = tapNotReadyCopy("unsupported_country", "ios");
    expect(country.title).toBe("Tap to Pay on iPhone isn't available here");
    expect(country.body).toBe("Tap to Pay on iPhone works for brands that collect funds in the US or UK.");
    expect(tapNotReadyCopy("paystack", "ios").body).toBe(country.body);
    expect(tapNotReadyCopy("not_released", "android").title).toBe("Tap to Pay isn't available here");
    for (const r of ["unsupported_country", "paystack", "not_released", "no_brand", "server_not_available"] as const) {
      const c = tapNotReadyCopy(r, "ios");
      expect(c.kind).toBe("unavailable");
      expect(`${c.title} ${c.body}`).not.toMatch(/can.t take taps/);
    }
  });

  test("T3: both Tap to Pay screens use TapNotReady and route Finish setup to Get paid", () => {
    for (const rel of ["../tap/TapToPaySetupScreen.tsx", "../tap/TapToPaySaleScreen.tsx"]) {
      const src = fs.readFileSync(path.join(__dirname, rel), "utf8");
      expect({ rel, old: src.includes("This brand can't take taps") }).toEqual({ rel, old: false });
      expect({ rel, uses: src.includes("<TapNotReady") }).toEqual({ rel, uses: true });
      expect({ rel, route: /setup\?step=pay/.test(src) }).toEqual({ rel, route: true });
    }
  });
});
