/**
 * Issue #3568 independent tester guard — hostile paste and stable-row recovery.
 *
 * This independently attacks hostile Unicode/control inputs, oversized
 * leading-zero maximums, and removal of an earlier invalid row while later
 * errors stay bound to their stable option identities.
 */

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

// Imports stay below the leaf mocks so the editor's real state and handlers run.
// eslint-disable-next-line import/first
import {
  MenuModifierGroupEditor,
  type MenuModifierGroupEditorProps,
} from "../MenuModifierGroupEditor";
// eslint-disable-next-line import/first
import { parseSignedMenuMoneyDraft } from "../menuMoneyDraft";
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
  id: "group-adversarial",
  menuItemId: "item-adversarial",
  name: "Choose toppings",
  selectionMode: "multi",
  minSelect: 0,
  maxSelect: 3,
  isActive: true,
  sortOrder: 7,
  modifiers: [
    {
      id: "stable-alpha",
      groupId: "group-adversarial",
      name: "Avocado",
      priceDeltaCents: 0,
      currency: "USD",
      isAvailable: true,
      sortOrder: 0,
    },
    {
      id: "stable-beta",
      groupId: "group-adversarial",
      name: "Smaller portion",
      priceDeltaCents: -50,
      currency: "USD",
      isAvailable: true,
      sortOrder: 1,
    },
    {
      id: "stable-gamma",
      groupId: "group-adversarial",
      name: "Chilli",
      priceDeltaCents: 100,
      currency: "USD",
      isAvailable: true,
      sortOrder: 2,
    },
  ],
};

const renderEditor = (saving = false): void => {
  act(() => {
    tree = renderer.create(
      <MenuModifierGroupEditor
        menuItemId="item-adversarial"
        group={savedGroup}
        currency="USD"
        nextSortOrder={8}
        onSave={save}
        saving={saving}
        onClearSaveError={clearSaveError}
        onCancel={() => undefined}
      />,
    );
  });
};

const allByTestID = (testID: string): TestNode[] => {
  if (tree === null) throw new Error("Editor is not mounted");
  return tree.root.findAllByProps({ testID });
};

const byTestID = (testID: string): TestNode => {
  const matches = allByTestID(testID);
  const match = matches[matches.length - 1];
  if (match === undefined) throw new Error(`Missing testID: ${testID}`);
  return match;
};

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

describe("hostile complete-string numeric drafts", () => {
  test.each([
    "\u22121.50",
    "\u20131.50",
    "\uff0d1.50",
    "-\u00a01.50",
    "-1\n.50",
    "1_000",
    "1'000",
    "Infinity",
    "NaN",
    "\u0661\u0662",
    "\uff11\uff12",
  ])("rejects pasted lookalike/control draft %p", (draft) => {
    expect(parseSignedMenuMoneyDraft(draft, "USD")).toEqual({
      kind: "invalid",
      reason: "format",
    });
  });

  test("keeps locale symmetry and the exact inclusive signed bound", () => {
    expect(parseSignedMenuMoneyDraft(" -1,234.56 ", "USD")).toEqual({
      kind: "valid",
      cents: -123456,
    });
    expect(parseSignedMenuMoneyDraft(" -1.234,56 ", "USD")).toEqual({
      kind: "valid",
      cents: -123456,
    });
    expect(parseSignedMenuMoneyDraft("-1000000.00", "USD")).toEqual({
      kind: "valid",
      cents: -100_000_000,
    });
    expect(parseSignedMenuMoneyDraft("-1000000.01", "USD")).toEqual({
      kind: "invalid",
      reason: "range",
    });
  });

  test("rejects an oversized maximum even when leading zeroes hide a small suffix", () => {
    expect(parseModifierMaximumDraft(`${"0".repeat(500)}2`)).toEqual({
      kind: "invalid",
      reason: "format",
    });
  });
});

describe("stable-row recovery and fail-closed interaction", () => {
  test("keeps later errors on stable ids when an earlier row is removed", () => {
    renderEditor();

    change("modifier-option-price-stable-alpha", "12abc");
    change("modifier-option-price-stable-beta", "\u22121.50");
    change("modifier-option-name-stable-gamma", "");
    change("modifier-option-price-stable-gamma", "1e3");

    expect(byTestID("modifier-option-price-stable-alpha").props.value).toBe(
      "12abc",
    );
    expect(byTestID("modifier-option-price-stable-beta").props.value).toBe(
      "\u22121.50",
    );
    expect(byTestID("modifier-option-price-stable-gamma").props.value).toBe(
      "1e3",
    );
    expect(byTestID("modifier-group-save").props.disabled).toBe(true);
    press("modifier-group-save");
    expect(save).not.toHaveBeenCalled();

    press("modifier-option-remove-stable-alpha");
    expect(
      allByTestID("modifier-option-price-error-stable-alpha"),
    ).toHaveLength(0);
    expect(byTestID("modifier-option-header-stable-beta").props.children).toBe(
      "Option 1",
    );
    expect(byTestID("modifier-option-price-stable-beta").props).toMatchObject({
      errorId: "modifier-option-price-error-stable-beta",
      error: "Enter a valid price change, for example -1.50 or 2.00.",
      renderErrorMessage: false,
    });
    expect(
      byTestID("modifier-option-price-error-stable-beta").props,
    ).toMatchObject({
      nativeID: "modifier-option-price-error-stable-beta",
      accessibilityRole: "alert",
      accessibilityLiveRegion: "assertive",
      "aria-live": "assertive",
    });

    change("modifier-option-price-stable-beta", "-1.50");
    expect(allByTestID("modifier-option-price-error-stable-beta")).toHaveLength(
      0,
    );
    expect(
      allByTestID("modifier-option-price-error-stable-gamma").length,
    ).toBeGreaterThan(0);
    expect(byTestID("modifier-group-save").props.disabled).toBe(true);

    press("modifier-option-remove-stable-gamma");
    expect(byTestID("modifier-group-save").props.disabled).toBe(false);
    press("modifier-group-save");
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        modifiers: [
          {
            id: "stable-beta",
            name: "Smaller portion",
            priceDeltaCents: -150,
            sortOrder: 0,
          },
        ],
      }),
    );
  });

  test("locks every numeric mutation and the direct handler while pending", () => {
    renderEditor(true);

    expect(byTestID("modifier-group-max").props.disabled).toBe(true);
    expect(byTestID("modifier-option-price-stable-alpha").props.disabled).toBe(
      true,
    );
    expect(byTestID("modifier-option-add").props.disabled).toBe(true);
    expect(byTestID("modifier-option-remove-stable-alpha").props.disabled).toBe(
      true,
    );
    expect(byTestID("modifier-group-save").props).toMatchObject({
      disabled: true,
      loading: true,
      accessibilityLabel: "Saving options group",
    });

    press("modifier-group-save");
    expect(save).not.toHaveBeenCalled();
  });
});
