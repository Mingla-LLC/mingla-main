/**
 * Issue #3567 implementor guard — category text/storage parity.
 *
 * This suite mounts the real category sheet and exercises the public field,
 * save, failure, and platform contracts. It deliberately invokes the save
 * handler even while the button is disabled so UI state cannot substitute for
 * the required handler-level validation guard.
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
import { Platform, StyleSheet, Text, View, type TextStyle } from "react-native";

import {
  semantic,
  text as textTokens,
} from "../../../constants/designSystem";
import type { Menu } from "../../../services/menusService";
import type { MenuTextSaveFailure } from "../menuTextValidation";

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
  findByProps: (props: Record<string, unknown>) => TestNode;
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

const mockSave = jest.fn();
const mockClose = jest.fn();

jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) =>
    React.createElement("MockDateTimePicker", props),
}));

jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children, ...props }: { children?: React.ReactNode }) => (
    <View {...props}>{children}</View>
  ),
}));

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children, ...props }: { children?: React.ReactNode }) => (
    <View {...props}>{children}</View>
  ),
}));

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

jest.mock("../../ui/WebDateTimeInput", () => ({
  WebDateTimeInput: (props: Record<string, unknown>) =>
    React.createElement("MockWebDateTimeInput", props),
}));

// Imports stay below mocks so production binds to these focused test doubles.
// eslint-disable-next-line import/first
import {
  MenuCategorySheet,
  type MenuCategorySheetProps,
  type MenuCategorySheetSaveInput,
} from "../MenuCategorySheet";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
const originalPlatform = Object.getOwnPropertyDescriptor(Platform, "OS");
let tree: TestRenderer | null = null;

const savedCategory: Menu = {
  id: "category-3567",
  brandId: "brand-a",
  venueId: "venue-a",
  name: "Dinner",
  description: "Evening menu",
  sortOrder: 0,
  isActive: true,
  serviceWindowStart: null,
  serviceWindowEnd: null,
  serviceDays: null,
  items: [],
};

const setPlatform = (os: "ios" | "android" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

const renderCategory = (
  props: Partial<MenuCategorySheetProps> = {},
): void => {
  act(() => {
    tree = renderer.create(
      <MenuCategorySheet
        visible
        onClose={mockClose}
        category={null}
        onSave={mockSave}
        saving={false}
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

const button = (testID = "menu-category-save"): TestNode => byTestID(testID);

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
  mockSave.mockReset();
  mockClose.mockReset();
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

describe("#3567 category text validation", () => {
  test.each(["ios", "android", "web"] as const)(
    "%s renders always-visible counters and the platform accessibility contract",
    (platform) => {
      setPlatform(platform);
      renderCategory();

      const name = byTestID("menu-category-name");
      const description = byTestID("menu-category-desc");
      expect(name.props).toMatchObject({
        accessibilityHint: "0 of 120 characters will be saved.",
        "aria-labelledby": "menu-category-name-label",
        "aria-describedby": "menu-category-name-counter",
        error: null,
        renderErrorMessage: false,
      });
      expect(description.props).toMatchObject({
        accessibilityHint: "0 of 500 characters will be saved.",
        "aria-labelledby": "menu-category-description-label",
        "aria-describedby": "menu-category-description-counter",
        error: null,
        renderErrorMessage: false,
      });
      expect(name.props.maxLength).toBeUndefined();
      expect(description.props.maxLength).toBeUndefined();
      expect(textContent(byTestID("menu-category-name-counter").props.children)).toBe(
        "0 / 120",
      );
      expect(
        textContent(byTestID("menu-category-description-counter").props.children),
      ).toBe("0 / 500");
      expect(
        byTestID("menu-category-name-counter").props.accessibilityLiveRegion,
      ).toBeUndefined();

      if (platform === "web") {
        expect(
          currentTree().root.findAllByType("MockWebDateTimeInput"),
        ).toHaveLength(2);
      } else {
        expect(byTestID("menu-category-window-start").props).toMatchObject({
          accessibilityRole: "button",
          accessibilityHint: "Opens the time picker",
        });
      }
    },
  );

  test("required copy waits for blur, then exposes one associated alert", () => {
    setPlatform("web");
    renderCategory();

    const name = byTestID("menu-category-name");
    expect(
      currentTree().root.findAllByProps({
        testID: "menu-category-name-error",
      }),
    ).toHaveLength(0);
    expect(button().props.disabled).toBe(true);

    call(name, "onBlur", {});

    const error = byTestID("menu-category-name-error");
    expect(textContent(error.props.children)).toBe(
      "Give this category a name.",
    );
    expect(error.props).toMatchObject({
      nativeID: "menu-category-name-error",
      accessibilityRole: "alert",
      accessibilityLiveRegion: "assertive",
      "aria-live": "assertive",
    });
    expect(byTestID("menu-category-name").props).toMatchObject({
      error: "Give this category a name.",
      errorId: "menu-category-name-counter menu-category-name-error",
      renderErrorMessage: false,
    });
    expect(
      StyleSheet.flatten(
        byTestID("menu-category-name-counter").props.style,
      ) as TextStyle,
    ).toMatchObject({ color: textTokens.tertiary });
  });

  test("exact code-point limits save; limit + 1 stays editable and handler-blocked", () => {
    renderCategory();
    const exactName = "😀".repeat(120);
    const exactDescription = "x".repeat(500);

    call(byTestID("menu-category-name"), "onChangeText", exactName);
    call(
      byTestID("menu-category-desc"),
      "onChangeText",
      exactDescription,
    );
    expect(button().props.disabled).toBe(false);
    expect(textContent(byTestID("menu-category-name-counter").props.children)).toBe(
      "120 / 120",
    );
    call(button(), "onPress");
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: exactName,
        description: exactDescription,
      }),
    );

    const overName = `${exactName}😀`;
    call(byTestID("menu-category-name"), "onChangeText", overName);
    expect(byTestID("menu-category-name").props.value).toBe(overName);
    expect(button().props.disabled).toBe(true);
    expect(textContent(byTestID("menu-category-name-error").props.children)).toBe(
      "Use 120 characters or fewer.",
    );
    expect(textContent(byTestID("menu-category-name-counter").props.children)).toBe(
      "121 / 120",
    );
    expect(
      StyleSheet.flatten(
        byTestID("menu-category-name-counter").props.style,
      ) as TextStyle,
    ).toMatchObject({ color: semantic.errorText, fontWeight: "600" });

    call(button(), "onPress");
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  test("submits NFC-trimmed text and converts a canonical blank description to null", () => {
    renderCategory();
    call(byTestID("menu-category-name"), "onChangeText", "  Cafe\u0301  ");
    call(byTestID("menu-category-desc"), "onChangeText", " \t\n ");

    expect(textContent(byTestID("menu-category-name-counter").props.children)).toBe(
      "4 / 120",
    );
    call(button(), "onPress");

    const input = mockSave.mock.calls[0]?.[0] as
      | MenuCategorySheetSaveInput
      | undefined;
    expect(input).toMatchObject({ name: "Café", description: null });
  });

  test("a cleared previously nonblank name shows required copy without waiting for blur", () => {
    renderCategory({ category: savedCategory });
    call(byTestID("menu-category-name"), "onChangeText", "");

    expect(textContent(byTestID("menu-category-name-error").props.children)).toBe(
      "Give this category a name.",
    );
    expect(button().props.disabled).toBe(true);
  });

  test("typed field failure stays in-sheet, preserves the draft, and clears on correction", () => {
    const clearFailure = jest.fn();
    const failure: MenuTextSaveFailure = {
      kind: "field",
      field: "categoryDescription",
      constraint: "menus_description_check",
      target: "field",
      message: "Use 500 characters or fewer.",
      formMessage:
        "Category not saved. One detail wasn’t accepted. Review the form and try again. Your details are still here.",
    };
    renderCategory({
      category: savedCategory,
      saveFailure: failure,
      onClearSaveFailure: clearFailure,
    });
    clearFailure.mockClear();

    expect(byTestID("menu-category-desc").props.value).toBe("Evening menu");
    expect(byTestID("menu-category-desc").props).toMatchObject({
      error: "Use 500 characters or fewer.",
      errorId:
        "menu-category-description-counter menu-category-description-error",
    });
    expect(
      textContent(byTestID("menu-category-description-error").props.children),
    ).toBe("Use 500 characters or fewer.");
    expect(renderedText("menu-category-save-error")).toContain(
      "One detail wasn’t accepted",
    );
    expect(button().props).toMatchObject({
      label: "Try again",
      accessibilityLabel: "Try saving category again",
      disabled: true,
    });
    call(button(), "onPress");
    expect(mockSave).not.toHaveBeenCalled();

    call(byTestID("menu-category-desc"), "onChangeText", "Updated detail");
    expect(clearFailure).toHaveBeenCalledTimes(1);
    expect(byTestID("menu-category-desc").props.value).toBe("Updated detail");
  });

  test("legacy failure copy and retry-safe id remain unchanged", () => {
    renderCategory({ category: savedCategory, saveFailed: true });

    expect(renderedText("menu-category-save-error")).toBe(
      "Category not saved. We couldn’t confirm the save, but your details are still here. It’s safe to try again.",
    );
    expect(button().props).toMatchObject({
      label: "Try again",
      accessibilityLabel: "Try saving category again",
    });
    call(button(), "onPress");
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: savedCategory.id,
        name: savedCategory.name,
        description: savedCategory.description,
      }),
    );
  });

  test.each([
    {
      kind: "validation" as const,
      message:
        "Category not saved. One detail wasn’t accepted. Review the form and try again. Your details are still here.",
    },
    {
      kind: "offline" as const,
      message:
        "Category not saved. You’re offline. Reconnect, then try again. Your details are still here.",
    },
    {
      kind: "permission" as const,
      message:
        "Category not saved. You don’t have permission to change this menu. Ask an owner or manager to update your access. Your details are still here.",
    },
    {
      kind: "unknown" as const,
      message:
        "Category not saved. We couldn’t confirm the save, but your details are still here. It’s safe to try again.",
    },
  ])("renders typed $kind recovery copy without dropping the draft", (failure) => {
    renderCategory({ category: savedCategory, saveFailure: failure });

    expect(renderedText("menu-category-save-error")).toBe(failure.message);
    expect(byTestID("menu-category-name").props.value).toBe("Dinner");
    expect(byTestID("menu-category-desc").props.value).toBe("Evening menu");
  });

  test("dismissal clears an external failure before closing", () => {
    const clearFailure = jest.fn();
    renderCategory({ onClearSaveFailure: clearFailure });
    clearFailure.mockClear();

    call(byTestID("menu-category-sheet"), "onClose");

    expect(clearFailure).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(currentTree().root.findAllByType(Text)).not.toHaveLength(0);
  });
});
