/**
 * Issue #3567 implementor guard — item and modifier form integration.
 *
 * The real form handlers are invoked even when their buttons are disabled so
 * the test proves validation owns the mutation boundary, not visual state.
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
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { semantic } from "../../../constants/designSystem";
import type { MenuItem } from "../../../services/menusService";
import type { MenuModifierGroup } from "../../../hooks/useMenuModifiers";
import type { MenuTextSaveFailure } from "../menuTextValidation";

interface TestNode {
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
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

jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children, ...props }: { children?: React.ReactNode }) => (
    <View {...props}>{children}</View>
  ),
}));

jest.mock("../../ui/BrandSwitch", () => ({
  BrandSwitch: (props: Record<string, unknown>) =>
    React.createElement("MockBrandSwitch", props),
}));

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));

jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("MockInput", props),
}));

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) => (visible ? React.createElement("MockSheet", props, children) : null),
}));

// Imports stay below mocks so production binds to the focused test doubles.
// eslint-disable-next-line import/first
import {
  MenuItemSheet,
  type MenuItemSheetProps,
  type MenuItemSheetSaveInput,
} from "../MenuItemSheet";
// eslint-disable-next-line import/first
import {
  MenuModifierGroupEditor,
  type MenuModifierGroupEditorProps,
} from "../MenuModifierGroupEditor";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
const originalPlatform = Object.getOwnPropertyDescriptor(Platform, "OS");
let tree: TestRenderer | null = null;

const itemSave = jest.fn<(input: MenuItemSheetSaveInput) => void>();
const modifierSave = jest.fn<MenuModifierGroupEditorProps["onSave"]>();

const savedItem: MenuItem = {
  id: "item-3567",
  menuId: "menu-3567",
  brandId: "brand-3567",
  name: "Dinner",
  description: "Evening menu",
  priceCents: 1200,
  currency: "USD",
  isAvailable: true,
  sortOrder: 0,
  allowsNotes: true,
  prepStation: null,
  costCents: null,
};

const savedGroup: MenuModifierGroup = {
  id: "group-3567",
  menuItemId: savedItem.id,
  name: "Temperature",
  selectionMode: "single",
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  sortOrder: 0,
  modifiers: [
    {
      id: "option-a",
      groupId: "group-3567",
      name: "Rare",
      priceDeltaCents: 0,
      currency: "USD",
      isAvailable: true,
      sortOrder: 0,
    },
    {
      id: "option-b",
      groupId: "group-3567",
      name: "Well done",
      priceDeltaCents: 0,
      currency: "USD",
      isAvailable: true,
      sortOrder: 1,
    },
  ],
};

const setPlatform = (os: "ios" | "android" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

const renderItem = (props: Partial<MenuItemSheetProps> = {}): void => {
  act(() => {
    tree = renderer.create(
      <MenuItemSheet
        visible
        onClose={() => undefined}
        item={null}
        currency="USD"
        brandHasCurrency
        onSave={itemSave}
        saving={false}
        {...props}
      />,
    );
  });
};

const renderModifier = (
  props: Partial<MenuModifierGroupEditorProps> = {},
): void => {
  act(() => {
    tree = renderer.create(
      <MenuModifierGroupEditor
        menuItemId={savedItem.id}
        group={savedGroup}
        currency="USD"
        nextSortOrder={0}
        onSave={modifierSave}
        saving={false}
        onCancel={() => undefined}
        {...props}
      />,
    );
  });
};

const currentTree = (): TestRenderer => {
  if (tree === null) throw new Error("Renderer not mounted");
  return tree;
};

const byTestID = (testID: string): TestNode => {
  const matches = currentTree().root.findAllByProps({ testID });
  const node = matches[matches.length - 1];
  if (node === undefined) throw new Error(`Node not found: ${testID}`);
  return node;
};

const allByTestID = (testID: string): TestNode[] =>
  currentTree().root.findAllByProps({ testID });

const call = (node: TestNode, prop: string, ...args: unknown[]): void => {
  const callback = node.props[prop];
  if (typeof callback !== "function") {
    throw new Error(`${prop} is not callable`);
  }
  act(() => (callback as (...values: unknown[]) => void)(...args));
};

const textContent = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(textContent).join("");
  return "";
};

const renderedText = (testID: string): string =>
  byTestID(testID)
    .findAllByType(Text)
    .map((node) => textContent(node.props.children))
    .join("");

beforeEach(() => {
  itemSave.mockReset();
  modifierSave.mockReset();
  setPlatform("ios");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (tree !== null) act(() => tree?.unmount());
  tree = null;
  if (originalPlatform !== undefined) {
    Object.defineProperty(Platform, "OS", originalPlatform);
  }
});

describe("#3567 item text validation", () => {
  test.each(["ios", "android", "web"] as const)(
    "%s exposes persistent counts and stable field associations",
    (platform) => {
      setPlatform(platform);
      renderItem();

      expect(byTestID("menu-item-name").props).toMatchObject({
        accessibilityHint: "0 of 160 characters will be saved.",
        "aria-labelledby": "menu-item-name-label",
        "aria-describedby": "menu-item-name-counter",
        error: null,
        renderErrorMessage: false,
      });
      expect(byTestID("menu-item-desc").props).toMatchObject({
        accessibilityHint: "0 of 600 characters will be saved.",
        "aria-labelledby": "menu-item-description-label",
        "aria-describedby": "menu-item-description-counter",
        error: null,
        renderErrorMessage: false,
      });
      expect(byTestID("menu-item-name").props.maxLength).toBeUndefined();
      expect(byTestID("menu-item-desc").props.maxLength).toBeUndefined();
      expect(
        textContent(byTestID("menu-item-name-counter").props.children),
      ).toBe("0 / 160");
      expect(
        textContent(byTestID("menu-item-description-counter").props.children),
      ).toBe("0 / 600");
      expect(
        byTestID("menu-item-name-counter").props.accessibilityLiveRegion,
      ).toBeUndefined();
    },
  );

  test("required copy waits for blur and appears immediately after clearing saved text", () => {
    renderItem();
    expect(allByTestID("menu-item-name-error")).toHaveLength(0);
    expect(byTestID("menu-item-save").props.disabled).toBe(true);

    call(byTestID("menu-item-name"), "onBlur", {});
    expect(textContent(byTestID("menu-item-name-error").props.children)).toBe(
      "Give this item a name.",
    );
    expect(byTestID("menu-item-name-error").props).toMatchObject({
      nativeID: "menu-item-name-error",
      accessibilityRole: "alert",
      accessibilityLiveRegion: "assertive",
      "aria-live": "assertive",
    });

    act(() => tree?.unmount());
    tree = null;
    renderItem({ item: savedItem });
    call(byTestID("menu-item-name"), "onChangeText", "");
    expect(textContent(byTestID("menu-item-name-error").props.children)).toBe(
      "Give this item a name.",
    );
  });

  test("exact Unicode boundaries save while +1 remains editable and handler-blocked", () => {
    renderItem();
    const exactName = "😀".repeat(160);
    const exactDescription = "x".repeat(600);
    call(byTestID("menu-item-name"), "onChangeText", exactName);
    call(byTestID("menu-item-desc"), "onChangeText", exactDescription);
    expect(byTestID("menu-item-save").props.disabled).toBe(false);
    call(byTestID("menu-item-save"), "onPress");
    expect(itemSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: exactName,
        description: exactDescription,
      }),
    );

    const overName = `${exactName}😀`;
    call(byTestID("menu-item-name"), "onChangeText", overName);
    expect(byTestID("menu-item-name").props.value).toBe(overName);
    expect(
      textContent(byTestID("menu-item-name-counter").props.children),
    ).toBe("161 / 160");
    expect(textContent(byTestID("menu-item-name-error").props.children)).toBe(
      "Use 160 characters or fewer.",
    );
    call(byTestID("menu-item-save"), "onPress");
    expect(itemSave).toHaveBeenCalledTimes(1);
  });

  test("submits NFC-trimmed text and a canonical blank description as null", () => {
    renderItem();
    call(byTestID("menu-item-name"), "onChangeText", "  Cafe\u0301  ");
    call(byTestID("menu-item-desc"), "onChangeText", " \t\n ");
    call(byTestID("menu-item-save"), "onPress");

    expect(itemSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Café", description: null }),
    );
  });

  test("description +1 remains editable and cannot bypass the save handler", () => {
    renderItem();
    call(byTestID("menu-item-name"), "onChangeText", "Valid item");
    const over = "😀".repeat(601);
    call(byTestID("menu-item-desc"), "onChangeText", over);

    expect(byTestID("menu-item-desc").props.value).toBe(over);
    expect(
      textContent(byTestID("menu-item-description-counter").props.children),
    ).toBe("601 / 600");
    expect(
      textContent(byTestID("menu-item-description-error").props.children),
    ).toBe("Use 600 characters or fewer.");
    call(byTestID("menu-item-save"), "onPress");
    expect(itemSave).not.toHaveBeenCalled();
  });

  test("mapped backend failure marks its field, blocks retry, and clears on correction", () => {
    const clearFailure = jest.fn();
    const failure: MenuTextSaveFailure = {
      kind: "field",
      field: "itemDescription",
      constraint: "menu_items_description_check",
      target: "field",
      message: "Use 600 characters or fewer.",
      formMessage:
        "Item not saved. One detail wasn’t accepted. Review the form and try again. Your details are still here.",
    };
    renderItem({
      item: savedItem,
      saveFailure: failure,
      onClearSaveFailure: clearFailure,
    });
    clearFailure.mockClear();

    expect(byTestID("menu-item-desc").props.value).toBe("Evening menu");
    expect(byTestID("menu-item-desc").props).toMatchObject({
      error: "Use 600 characters or fewer.",
      errorId: "menu-item-description-counter menu-item-description-error",
    });
    expect(renderedText("menu-item-save-error")).toContain(
      "One detail wasn’t accepted",
    );
    expect(byTestID("menu-item-save").props).toMatchObject({
      label: "Try again",
      accessibilityLabel: "Try saving item again",
      disabled: true,
    });
    call(byTestID("menu-item-save"), "onPress");
    expect(itemSave).not.toHaveBeenCalled();

    call(byTestID("menu-item-desc"), "onChangeText", "Corrected");
    expect(clearFailure).toHaveBeenCalledTimes(1);
  });

  test("unknown failure stays in-sheet and retry clears it before resubmission", () => {
    const clearFailure = jest.fn();
    renderItem({
      item: savedItem,
      saveFailure: {
        kind: "unknown",
        message:
          "Item not saved. We couldn’t confirm the save, but your details are still here. It’s safe to try again.",
      },
      onClearSaveFailure: clearFailure,
    });
    clearFailure.mockClear();

    expect(renderedText("menu-item-save-error")).not.toContain("database");
    expect(byTestID("menu-item-save").props.disabled).toBe(false);
    call(byTestID("menu-item-save"), "onPress");
    expect(clearFailure).toHaveBeenCalledTimes(1);
    expect(itemSave).toHaveBeenCalledTimes(1);
  });

  test("every item field correction clears a stale typed failure", () => {
    const clearFailure = jest.fn();
    renderItem({
      item: savedItem,
      saveFailure: {
        kind: "validation",
        message:
          "Item not saved. One detail wasn’t accepted. Review the form and try again. Your details are still here.",
      },
      onClearSaveFailure: clearFailure,
    });
    clearFailure.mockClear();

    call(byTestID("menu-item-name"), "onChangeText", "Corrected item");
    call(byTestID("menu-item-desc"), "onChangeText", "Corrected detail");
    call(byTestID("menu-item-price"), "onChangeText", "14.00");
    call(byTestID("menu-item-cost"), "onChangeText", "4.00");
    call(byTestID("menu-item-available"), "onValueChange", false);
    call(byTestID("menu-item-allows-notes"), "onValueChange", false);
    call(byTestID("menu-item-station-kitchen"), "onPress");

    expect(clearFailure).toHaveBeenCalledTimes(7);
  });

  test.each(["ios", "android", "web"] as const)(
    "%s item alert uses the approved error surface",
    (platform) => {
      setPlatform(platform);
      renderItem({
        item: savedItem,
        saveFailure: {
          kind: "unknown",
          message:
            "Item not saved. We couldn’t confirm the save, but your details are still here. It’s safe to try again.",
        },
      });

      const style = StyleSheet.flatten(
        byTestID("menu-item-save-error").props.style,
      ) as ViewStyle;
      expect(style).toMatchObject({
        borderWidth: 1,
        borderColor: semantic.error,
        overflow: "hidden",
      });
      expect(style.shadowColor).toBeUndefined();
      expect(style.elevation).toBeUndefined();
    },
  );
});

describe("#3567 modifier text validation", () => {
  test("group and option counts use stable IDs with no truncation contract", () => {
    renderModifier();
    expect(
      textContent(byTestID("modifier-option-header-option-a").props.children),
    ).toBe("Option 1");
    expect(
      textContent(byTestID("modifier-option-header-option-b").props.children),
    ).toBe("Option 2");
    expect(byTestID("modifier-group-name").props).toMatchObject({
      accessibilityHint: "11 of 80 characters will be saved.",
      "aria-labelledby": "modifier-group-name-label",
      "aria-describedby": "modifier-group-name-counter",
      renderErrorMessage: false,
    });
    expect(byTestID("modifier-option-name-option-a").props).toMatchObject({
      accessibilityHint: "4 of 80 characters will be saved.",
      accessibilityLabel: "Option 1 name",
      "aria-labelledby": "modifier-option-name-option-a-label",
      "aria-describedby": "modifier-option-name-option-a-counter",
      renderErrorMessage: false,
    });
    expect(byTestID("modifier-group-name").props.maxLength).toBeUndefined();
    expect(
      byTestID("modifier-option-name-option-a").props.maxLength,
    ).toBeUndefined();
  });

  test("required group copy is delayed but Add at least one option remains structural", () => {
    renderModifier({ group: null });
    expect(allByTestID("modifier-group-name-error")).toHaveLength(0);
    expect(byTestID("modifier-group-save").props).toMatchObject({
      label: "Add group",
      disabled: true,
    });
    call(byTestID("modifier-group-name"), "onBlur", {});
    expect(
      textContent(byTestID("modifier-group-name-error").props.children),
    ).toBe("Give this group a name.");

    call(byTestID("modifier-group-name"), "onChangeText", "Sauce");
    expect(textContent(byTestID("modifier-group-error").props.children)).toBe(
      "Add at least one option.",
    );
  });

  test("canonical group/option values save and a blank option stays neutral and omitted", () => {
    renderModifier();
    call(
      byTestID("modifier-group-name"),
      "onChangeText",
      "  Cafe\u0301 choice  ",
    );
    call(
      byTestID("modifier-option-name-option-a"),
      "onChangeText",
      "  Jalapen\u0303o  ",
    );
    call(byTestID("modifier-option-add"), "onPress");

    const blankOption = currentTree().root
      .findAllByType("MockInput")
      .find(
        (node) =>
          String(node.props.testID).startsWith("modifier-option-name-") &&
          node.props.value === "",
      );
    expect(blankOption?.props.error).toBeNull();
    expect(blankOption?.props.maxLength).toBeUndefined();

    call(byTestID("modifier-group-save"), "onPress");
    const input = modifierSave.mock.calls[0]?.[0];
    expect(input?.name).toBe("Café choice");
    expect(input?.modifiers.map((option) => option.name)).toEqual([
      "Jalapeño",
      "Well done",
    ]);
  });

  test("group exact Unicode boundary saves while +1 remains handler-blocked", () => {
    renderModifier();
    const exact = "😀".repeat(80);
    call(byTestID("modifier-group-name"), "onChangeText", exact);
    expect(
      textContent(byTestID("modifier-group-name-counter").props.children),
    ).toBe("80 / 80");
    call(byTestID("modifier-group-save"), "onPress");
    expect(modifierSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: exact }),
    );

    const over = `${exact}😀`;
    call(byTestID("modifier-group-name"), "onChangeText", over);
    expect(byTestID("modifier-group-name").props.value).toBe(over);
    expect(
      textContent(byTestID("modifier-group-name-error").props.children),
    ).toBe("Use 80 characters or fewer.");
    call(byTestID("modifier-group-save"), "onPress");
    expect(modifierSave).toHaveBeenCalledTimes(1);
  });

  test("option exact/+1 boundary and stable association survive earlier-row removal", () => {
    renderModifier();
    const exact = "😀".repeat(80);
    call(
      byTestID("modifier-option-name-option-b"),
      "onChangeText",
      exact,
    );
    expect(
      textContent(
        byTestID("modifier-option-name-counter-option-b").props.children,
      ),
    ).toBe("80 / 80");
    call(byTestID("modifier-group-save"), "onPress");
    expect(modifierSave).toHaveBeenCalledTimes(1);

    const over = "😀".repeat(81);
    call(
      byTestID("modifier-option-name-option-b"),
      "onChangeText",
      over,
    );
    expect(
      textContent(
        byTestID("modifier-option-name-counter-option-b").props.children,
      ),
    ).toBe("81 / 80");
    expect(
      textContent(
        byTestID("modifier-option-name-option-b-error").props.children,
      ),
    ).toBe("Use 80 characters or fewer.");
    call(byTestID("modifier-group-save"), "onPress");
    expect(modifierSave).toHaveBeenCalledTimes(1);

    call(byTestID("modifier-option-remove-option-a"), "onPress");
    expect(byTestID("modifier-option-name-option-b").props.value).toBe(over);
    expect(byTestID("modifier-option-name-option-b").props.errorId).toBe(
      "modifier-option-name-option-b-counter modifier-option-name-option-b-error",
    );
  });

  test("typed group and unidentified option constraints block until correction", () => {
    const clearFailure = jest.fn();
    const groupFailure: MenuTextSaveFailure = {
      kind: "field",
      field: "modifierGroupName",
      constraint: "menu_modifier_groups_name_check",
      target: "field",
      message: "Use 80 characters or fewer.",
      formMessage:
        "We could not save this group because one detail was not accepted. Review the form and try again. Your changes are still here.",
    };
    renderModifier({
      saveError: groupFailure,
      onClearSaveError: clearFailure,
    });
    expect(byTestID("modifier-group-name").props.error).toBe(
      "Use 80 characters or fewer.",
    );
    expect(byTestID("modifier-group-save").props.disabled).toBe(true);
    call(byTestID("modifier-group-name"), "onChangeText", "Corrected");
    expect(clearFailure).toHaveBeenCalledTimes(1);

    act(() => tree?.unmount());
    tree = null;
    renderModifier({
      saveError: {
        kind: "field",
        field: "modifierOptionName",
        constraint: "menu_modifiers_name_check",
        target: "form",
        message:
          "One option name wasn’t accepted. Review the option names and try again. Your changes are still here.",
        formMessage:
          "One option name wasn’t accepted. Review the option names and try again. Your changes are still here.",
      },
    });
    expect(renderedText("modifier-group-save-error")).toBe(
      "One option name wasn’t accepted. Review the option names and try again. Your changes are still here.",
    );
    expect(byTestID("modifier-option-name-option-a").props.error).toBeNull();
    call(byTestID("modifier-group-save"), "onPress");
    expect(modifierSave).not.toHaveBeenCalled();
  });

  test.each([
    "We could not save this group because one detail was not accepted. Review the form and try again. Your changes are still here.",
    "You are offline. Reconnect, then try again. Your changes are still here.",
    "You cannot save this group with this account. Your changes are still here.",
    "We could not save this group. Your changes are still here — try again.",
  ])("renders safe form recovery copy: %s", (message) => {
    renderModifier({ saveError: { kind: "unknown", message } });
    expect(renderedText("modifier-group-save-error")).toBe(message);
    expect(byTestID("modifier-group-save").props).toMatchObject({
      label: "Save group",
      disabled: false,
    });
  });

  test.each(["ios", "android", "web"] as const)(
    "%s modifier alert uses the approved error surface",
    (platform) => {
      setPlatform(platform);
      renderModifier({
        saveError: {
          kind: "unknown",
          message:
            "We could not save this group. Your changes are still here — try again.",
        },
      });

      const alert = byTestID("modifier-group-save-error");
      const style = StyleSheet.flatten(alert.props.style) as ViewStyle;
      expect(alert.props).toMatchObject({
        accessibilityRole: "alert",
        accessibilityLiveRegion: "assertive",
        "aria-live": "assertive",
      });
      expect(style).toMatchObject({
        borderWidth: 1,
        borderColor: semantic.error,
        overflow: "hidden",
      });
      expect(style.shadowColor).toBeUndefined();
      expect(style.elevation).toBeUndefined();
    },
  );
});

describe("#3567 parent routing and preservation seams", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");
  const read = (relativePath: string): string =>
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

  test("category and item failures are isolated and classified at their own mutation", () => {
    const module = read("src/components/venue/VenueMenuModule.tsx");
    expect(module).toContain("categorySaveFailure, setCategorySaveFailure");
    expect(module).toContain("itemSaveFailure, setItemSaveFailure");
    expect(module).toContain(
      'classifyMenuTextSaveFailure(error, "category")',
    );
    expect(module).toContain('classifyMenuTextSaveFailure(error, "item")');
    expect(module).toContain("saveFailure={categorySaveFailure}");
    expect(module).toContain("saveFailure={itemSaveFailure}");
    expect(module).toContain(
      "That menu change wasn&apos;t saved. Try again.",
    );
    expect(module).toContain(
      "saveError && !categorySheetOpen && !itemSheetOpen",
    );

    for (const handler of [
      "openAddCategory",
      "openEditCategory",
      "handleSaveCategory",
      "openAddItem",
      "openEditItem",
      "handleSaveItem",
    ]) {
      const start = module.indexOf(`const ${handler}`);
      expect(start).toBeGreaterThan(-1);
      expect(module.slice(start, start + 450)).toContain("setSaveError(false)");
    }
  });

  test("category service corrections clear typed failure without changing picker mechanics", () => {
    const category = read("src/components/venue/MenuCategorySheet.tsx");
    expect(category).toContain("const handleWindowStartChange = useCallback(");
    expect(category).toContain("const handleWindowEndChange = useCallback(");
    expect(category).toContain("onChangeValue={handleWindowStartChange}");
    expect(category).toContain("onChangeValue={handleWindowEndChange}");

    for (const handler of [
      "handleWindowStartChange",
      "handleWindowEndChange",
      "toggleDay",
      "commitTimePickerValue",
      "clearTimes",
    ]) {
      const start = category.indexOf(`const ${handler}`);
      expect(start).toBeGreaterThan(-1);
      expect(category.slice(start, start + 420)).toContain(
        "onClearSaveFailure?.()",
      );
    }
    expect(category).toContain('if (Platform.OS === "android")');
    expect(category).toContain("commitTimePickerValue(mode, selected)");
  });

  test("shared validation replaces only group-name UTF-16 authority", () => {
    const depth = read("src/components/venue/menuDepth.ts");
    expect(depth).toContain(
      'validateMenuText("modifierGroupName", draft.name)',
    );
    expect(depth).not.toContain("name.length > 80");
    expect(depth).toContain('if (draft.optionCount === 0) return "Add at least one option."');
    expect(depth).toContain("const TIME_RE");
  });

  test("responsive and dependency preservation contracts remain explicit", () => {
    const editor = read("src/components/venue/MenuModifierGroupEditor.tsx");
    const item = read("src/components/venue/MenuItemSheet.tsx");
    const section = read("src/components/venue/MenuItemOptionsSection.tsx");
    const module = read("src/components/venue/VenueMenuModule.tsx");

    expect(editor).toContain(
      "width <= 360 || isLargeText(fontScale)",
    );
    for (const source of [editor, item]) {
      expect(source).toContain('flexWrap: "wrap"');
      expect(source).toContain('justifyContent: "space-between"');
      expect(source).toContain('alignItems: "flex-start"');
      expect(source).toContain("flexShrink: 1");
      expect(source).toContain("minWidth: 0");
      expect(source).toContain('marginLeft: "auto"');
      expect(source).toContain('alignItems: "flex-end"');
      expect(source).toContain(
        'Platform.OS === "android" ? androidOpaque.errorFill : semantic.errorTint',
      );
    }
    expect(editor).toContain("style={styles.optionBlock}");
    expect(editor).toContain("{`Option ${optionIndex + 1}`}");
    expect(editor).toContain("styles.optionControls");
    expect(editor).toContain("styles.optionControlsStacked");
    expect(editor).toContain("styles.optionSecondaryControls");
    expect(editor).toContain("styles.optionSecondaryControlsStacked");
    expect(editor).not.toContain('label="Option name"');
    expect(editor).toContain("minWidth: 44");
    expect(editor).toContain("minHeight: 44");
    expect(editor).not.toContain("maxLength=");
    expect(item).not.toContain("maxLength=");
    expect(section).toContain(
      "setSaveError(modifierGroupSaveError(error))",
    );
    expect(section).toContain('safe.category === "offline"');
    expect(section).toContain('safe.category === "permission"');
    expect(section).toContain("onSavingChange?.(true)");
    expect(section).toContain("onSavingChange?.(false)");
    expect(item).toContain("dismissDisabled={optionsSaving}");
    expect(module).toContain("onSavingChange={setOptionsSaving}");
  });
});
