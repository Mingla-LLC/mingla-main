/**
 * Issue #3568 implementor guard — exact modifier-number drafts.
 *
 * The pure corpus proves the accepted language. The rendered editor proof then
 * invokes its real handlers even while Save is disabled so visual state cannot
 * be the only mutation barrier.
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("MockInput", props),
}));

// Imports stay below the leaf mocks so state, validation, and handlers remain real.
// eslint-disable-next-line import/first
import {
  MenuModifierGroupEditor,
  type MenuModifierGroupEditorProps,
} from "../MenuModifierGroupEditor";
// eslint-disable-next-line import/first
import {
  parseMenuMoneyDraft,
  parseSignedMenuMoneyDraft,
} from "../menuMoneyDraft";
// eslint-disable-next-line import/first
import { parseModifierMaximumDraft } from "../menuModifierNumberDraft";
// eslint-disable-next-line import/first
import type { MenuModifierGroup } from "../../../hooks/useMenuModifiers";

interface TestNode {
  props: Record<string, unknown>;
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
}

interface TestRenderer {
  root: TestNode;
  unmount: () => void;
}

interface RendererApi {
  create: (node: React.ReactElement) => TestRenderer;
  act: (callback: () => void) => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
let tree: TestRenderer | null = null;
const save = jest.fn<MenuModifierGroupEditorProps["onSave"]>();
const clearSaveError = jest.fn();

const savedGroup: MenuModifierGroup = {
  id: "group-3568",
  menuItemId: "item-3568",
  name: "Choose sides",
  selectionMode: "multi",
  minSelect: 0,
  maxSelect: 2,
  isActive: true,
  sortOrder: 4,
  modifiers: [
    {
      id: "option-alpha",
      groupId: "group-3568",
      name: "Salad",
      priceDeltaCents: 0,
      currency: "USD",
      isAvailable: true,
      sortOrder: 0,
    },
    {
      id: "option-beta",
      groupId: "group-3568",
      name: "Smaller portion",
      priceDeltaCents: -50,
      currency: "USD",
      isAvailable: true,
      sortOrder: 1,
    },
  ],
};

const renderEditor = (currency = "USD"): void => {
  act(() => {
    tree = renderer.create(
      <MenuModifierGroupEditor
        menuItemId="item-3568"
        group={savedGroup}
        currency={currency}
        nextSortOrder={5}
        onSave={save}
        saving={false}
        onClearSaveError={clearSaveError}
        onCancel={() => undefined}
      />,
    );
  });
};

const byTestID = (testID: string): TestNode => {
  if (tree === null) throw new Error("Editor is not mounted");
  const matches = tree.root.findAllByProps({ testID });
  const match = matches[matches.length - 1];
  if (match === undefined) throw new Error(`Missing testID: ${testID}`);
  return match;
};

const hasTestID = (testID: string): boolean =>
  tree?.root.findAllByProps({ testID }).length !== 0;

const change = (testID: string, value: string): void => {
  const onChangeText = byTestID(testID).props.onChangeText;
  if (typeof onChangeText !== "function") {
    throw new Error(`${testID} has no onChangeText handler`);
  }
  act(() => (onChangeText as (next: string) => void)(value));
};

const press = (testID: string): void => {
  const onPress = byTestID(testID).props.onPress;
  if (typeof onPress !== "function") {
    throw new Error(`${testID} has no onPress handler`);
  }
  act(() => (onPress as () => void)());
};

beforeEach(() => {
  save.mockReset();
  clearSaveError.mockReset();
});

afterEach(() => {
  if (tree !== null) act(() => tree?.unmount());
  tree = null;
});

describe("signed money grammar", () => {
  test.each([
    ["", "USD", { kind: "blank", cents: null }],
    ["  \t", "USD", { kind: "blank", cents: null }],
    ["0", "USD", { kind: "valid", cents: 0 }],
    ["-0", "USD", { kind: "valid", cents: 0 }],
    ["-0.00", "USD", { kind: "valid", cents: 0 }],
    ["14.90", "USD", { kind: "valid", cents: 1490 }],
    ["-14.90", "USD", { kind: "valid", cents: -1490 }],
    ["1,234.56", "USD", { kind: "valid", cents: 123456 }],
    ["-1,234.56", "USD", { kind: "valid", cents: -123456 }],
    ["1234,56", "USD", { kind: "valid", cents: 123456 }],
    ["-1.234,56", "USD", { kind: "valid", cents: -123456 }],
    ["1000000.00", "USD", { kind: "valid", cents: 100_000_000 }],
    ["-1000000.00", "USD", { kind: "valid", cents: -100_000_000 }],
    ["100000000", "JPY", { kind: "valid", cents: 100_000_000 }],
    ["-100000000", "JPY", { kind: "valid", cents: -100_000_000 }],
  ])("parses %s in %s exactly", (draft, currency, expected) => {
    expect(parseSignedMenuMoneyDraft(draft, currency)).toEqual(expected);
  });

  test.each([
    "+1",
    "-",
    "--1",
    "1-",
    "- 1",
    "1e3",
    "12abc",
    "abc12",
    "14.9.9",
    "1,2,3",
    "−1.50",
  ])("rejects the complete malformed draft %s", (draft) => {
    expect(parseSignedMenuMoneyDraft(draft, "USD")).toEqual({
      kind: "invalid",
      reason: "format",
    });
  });

  test("distinguishes precision and inclusive range without rounding", () => {
    expect(parseSignedMenuMoneyDraft("1.001", "USD")).toEqual({
      kind: "invalid",
      reason: "precision",
    });
    expect(parseSignedMenuMoneyDraft("-1.50", "JPY")).toEqual({
      kind: "invalid",
      reason: "precision",
    });
    expect(parseSignedMenuMoneyDraft("1000000.01", "USD")).toEqual({
      kind: "invalid",
      reason: "range",
    });
    expect(parseSignedMenuMoneyDraft("-1000000.01", "USD")).toEqual({
      kind: "invalid",
      reason: "range",
    });
  });

  test("leaves the #3566 unsigned parser byte-compatible", () => {
    expect(parseMenuMoneyDraft("-1.50", "USD")).toEqual({
      kind: "invalid",
      reason: "format",
    });
    expect(parseMenuMoneyDraft("1.234,56", "USD")).toEqual({
      kind: "valid",
      cents: 123456,
    });
  });
});

describe("whole maximum grammar", () => {
  test.each([
    ["", { kind: "blank", value: null }],
    [" \t ", { kind: "blank", value: null }],
    ["1", { kind: "valid", value: 1 }],
    ["20", { kind: "valid", value: 20 }],
    ["002", { kind: "valid", value: 2 }],
  ])("parses %s without coercion", (draft, expected) => {
    expect(parseModifierMaximumDraft(draft)).toEqual(expected);
  });

  test.each([
    "2.9",
    "2abc",
    "+2",
    "-2",
    "2e0",
    "1,000",
    "2 0",
    "9".repeat(500),
    `${"0".repeat(500)}2`,
  ])("rejects malformed %s as format", (draft) => {
    expect(parseModifierMaximumDraft(draft)).toEqual({
      kind: "invalid",
      reason: "format",
    });
  });

  test.each(["0", "000", "21", "0021"])("rejects %s as range", (draft) => {
    expect(parseModifierMaximumDraft(draft)).toEqual({
      kind: "invalid",
      reason: "range",
    });
  });
});

describe("real modifier editor boundary", () => {
  test("uses the specified keyboards and isolates immediate accessible errors", () => {
    renderEditor();

    expect(byTestID("modifier-group-max").props).toMatchObject({
      variant: "number",
      inputMode: "numeric",
      accessibilityLabel: "Most options a guest can pick",
    });
    expect(byTestID("modifier-option-price-option-alpha").props).toMatchObject({
      variant: "text",
      inputMode: "text",
      placeholder: "± USD",
      accessibilityLabel: "Price change for option 1 in USD",
    });

    change("modifier-option-price-option-alpha", "12abc");
    change("modifier-option-price-option-beta", "1e3");

    expect(byTestID("modifier-option-price-option-alpha").props).toMatchObject({
      value: "12abc",
      error: "Enter a valid price change, for example -1.50 or 2.00.",
      errorId: "modifier-option-price-error-option-alpha",
      renderErrorMessage: false,
    });
    expect(
      byTestID("modifier-option-price-error-option-alpha").props,
    ).toMatchObject({
      nativeID: "modifier-option-price-error-option-alpha",
      accessibilityRole: "alert",
      accessibilityLiveRegion: "assertive",
      "aria-live": "assertive",
    });
    expect(hasTestID("modifier-option-price-error-option-beta")).toBe(true);
    expect(byTestID("modifier-group-save").props.disabled).toBe(true);

    // A direct/programmatic activation cannot bypass the disabled button.
    press("modifier-group-save");
    expect(save).not.toHaveBeenCalled();

    change("modifier-option-price-option-alpha", "-1.50");
    expect(hasTestID("modifier-option-price-error-option-alpha")).toBe(false);
    expect(hasTestID("modifier-option-price-error-option-beta")).toBe(true);
  });

  test("a malformed visible blank-name row blocks until corrected or removed", () => {
    renderEditor();
    change("modifier-option-name-option-alpha", "");
    change("modifier-option-price-option-alpha", "14.9.9");

    expect(byTestID("modifier-option-price-option-alpha").props.value).toBe(
      "14.9.9",
    );
    expect(byTestID("modifier-group-save").props.disabled).toBe(true);
    press("modifier-group-save");
    expect(save).not.toHaveBeenCalled();

    press("modifier-option-remove-option-alpha");
    expect(hasTestID("modifier-option-price-error-option-alpha")).toBe(false);
    expect(byTestID("modifier-group-save").props.disabled).toBe(false);
  });

  test("preserves a dormant invalid maximum and submits exact signed integers", () => {
    renderEditor();
    change("modifier-group-max", "2.9");
    expect(byTestID("modifier-group-max").props).toMatchObject({
      value: "2.9",
      error: "Enter a whole number from 1 to 20.",
      errorId: "modifier-group-max-error",
      renderErrorMessage: false,
    });
    expect(byTestID("modifier-group-max-error").props).toMatchObject({
      nativeID: "modifier-group-max-error",
      accessibilityRole: "alert",
      "aria-live": "assertive",
    });
    press("modifier-group-save");
    expect(save).not.toHaveBeenCalled();

    press("modifier-group-mode-single");
    expect(hasTestID("modifier-group-max")).toBe(false);
    expect(byTestID("modifier-group-save").props.disabled).toBe(false);
    press("modifier-group-save");
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxSelect: 1 }),
    );

    save.mockClear();
    press("modifier-group-mode-multi");
    expect(byTestID("modifier-group-max").props.value).toBe("2.9");
    expect(hasTestID("modifier-group-max-error")).toBe(true);
    change("modifier-group-max", "002");
    change("modifier-option-price-option-alpha", "-1.50");
    change("modifier-option-price-option-beta", "0.00");
    press("modifier-group-save");

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "group-3568",
        menuItemId: "item-3568",
        maxSelect: 2,
        modifiers: [
          {
            id: "option-alpha",
            name: "Salad",
            priceDeltaCents: -150,
            sortOrder: 0,
          },
          {
            id: "option-beta",
            name: "Smaller portion",
            priceDeltaCents: 0,
            sortOrder: 1,
          },
        ],
      }),
    );
  });

  test("an oversized zero-prefixed maximum stays visible and cannot cross Save", () => {
    renderEditor();
    const oversizedDraft = `${"0".repeat(500)}2`;

    change("modifier-group-max", oversizedDraft);

    expect(byTestID("modifier-group-max").props).toMatchObject({
      value: oversizedDraft,
      error: "Enter a whole number from 1 to 20.",
    });
    expect(byTestID("modifier-group-save").props.disabled).toBe(true);
    press("modifier-group-save");
    expect(save).not.toHaveBeenCalled();

    change("modifier-group-max", "002");
    press("modifier-group-save");
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ maxSelect: 2 }),
    );
  });

  test("uses the loaded item currency for precision and module propagation", () => {
    renderEditor("JPY");
    change("modifier-option-price-option-alpha", "-1.50");
    expect(byTestID("modifier-option-price-option-alpha").props.error).toBe(
      "JPY uses whole amounts; remove the decimal places.",
    );

    const repoRoot = path.resolve(__dirname, "../../../..");
    const moduleSource = fs.readFileSync(
      path.join(repoRoot, "src/components/venue/VenueMenuModule.tsx"),
      "utf8",
    );
    const sectionSource = fs.readFileSync(
      path.join(repoRoot, "src/components/venue/MenuItemOptionsSection.tsx"),
      "utf8",
    );
    expect(moduleSource).toContain(
      "itemCurrency={editingItem?.currency ?? currency}",
    );
    expect(sectionSource).toContain("currency={itemCurrency}");
    expect(sectionSource).not.toContain("currency={currency}");
  });
});
