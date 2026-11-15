/**
 * #4420 — the shared PhoneInput gained optional `metrics` and
 * `theme.fieldBackground` so the Host field can match ui/Input. Explorer
 * (app-mobile) passes neither, so its field must render exactly as before.
 *
 * Mounts the REAL packages/phone-input PhoneInput with the props Explorer's
 * fields pass (idle, focused, error, Explorer's own theme) and compares the
 * rendered tree with `issue_4420_phone_input_default_parity.fixture.json`,
 * which was rendered from the pre-#4420 PhoneInput (origin/main 2419c642c8)
 * by this same harness (pointed at a copy of that package). Byte-identical
 * tree, byte-identical field.
 *
 * FAILS ON REVERT of the default guard: any default style key, value or order
 * that moves (height, border width, radius, padding, error indent, focus
 * shadow, fill) changes the serialized tree.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any, import/first */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { jest } from "@jest/globals";

// Boundary: the native keyboard library (its jest entry is untransformed ESM).
jest.mock("react-native-keyboard-controller", () => ({
  KeyboardProvider: ({ children }: { children?: unknown }) => children,
  KeyboardToolbar: () => null,
  KeyboardAwareScrollView: ({ children }: { children?: unknown }) => children,
  KeyboardAvoidingView: ({ children }: { children?: unknown }) => children,
  useKeyboardHandler: () => undefined,
}));
jest.mock("expo-haptics", () => ({ selectionAsync: async () => undefined, impactAsync: async () => undefined, ImpactFeedbackStyle: {} }), { virtual: true });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Json = { type: string; props: Record<string, unknown>; children: Array<Json | string> | null };
type Tree = { toJSON: () => Json | Json[] | null; root: { findAll: (p: (n: any) => boolean) => any[] } };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void) => void;
};

const { PhoneInput } = require("../../packages/phone-input/PhoneInput") as typeof import("../../packages/phone-input/PhoneInput");

// Explorer's own theme overrides (app-mobile passes a light theme on some sheets).
const EXPLORER_THEME = { backgroundPrimary: "#ffffff", textPrimary: "#111827", borderDefault: "#e5e7eb" };

const LABELS = {
  phonePlaceholder: "Phone number",
  countryButtonAccessibilityLabel: (name: string) => `Country: ${name}`,
  phoneInputAccessibilityLabel: "Phone number",
  doneButton: "Done",
  pickerTitle: "Select country",
  pickerSearchPlaceholder: "Search",
  pickerCloseAccessibilityLabel: "Close",
};
const BASE = {
  value: "2025550123",
  countryCode: "US",
  onChangePhone: () => undefined,
  onChangeCountry: () => undefined,
  error: null,
  disabled: false,
  labels: LABELS,
  iconRenderer: (name: string, opts: { size: number; color: string }) => React.createElement("Icon", { name, ...opts }),
};

const scrub = (value: unknown): unknown => {
  if (typeof value === "function") return "[fn]";
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    if ("_value" in (value as Record<string, unknown>)) return `[animated ${(value as { _value: unknown })._value}]`;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
};

function render(props: Record<string, unknown>, focus = false): unknown {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      React.createElement(PhoneInput as React.ComponentType<any>, { ...BASE, ...props }),
    );
  });
  if (focus) {
    const input = tree.root.findAll((n) => typeof n.type === "string" && typeof n.props.onFocus === "function")[0];
    TestRenderer.act(() => input.props.onFocus({ nativeEvent: {} }));
  }
  return scrub(tree.toJSON());
}

export const CASES: Record<string, () => unknown> = {
  idle: () => render({}),
  focused: () => render({}, true),
  error: () => render({ error: "Enter a valid number" }),
  smartEntryRequired: () => render({ smartEntry: true, required: true, testID: "explorer-phone" }),
  explorerTheme: () => render({ theme: EXPLORER_THEME }),
  explorerThemeFocused: () => render({ theme: EXPLORER_THEME }, true),
};

const FIXTURE = path.join(__dirname, "issue_4420_phone_input_default_parity.fixture.json");

describe("#4420 PhoneInput renders byte-identical for Explorer (no metrics, no fieldBackground)", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  test.each(Object.keys(CASES))("%s", (name) => {
    expect(JSON.stringify(CASES[name]())).toBe(JSON.stringify(fixture[name]));
  });

  test("the Host metrics really do change the field (the fixture is not vacuous)", () => {
    const host = render({ metrics: { height: 48, borderWidth: 1, borderRadius: 8, errorIndent: 0, focusShadow: false } });
    expect(JSON.stringify(host)).not.toBe(JSON.stringify(fixture.idle));
  });
});
