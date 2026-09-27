/**
 * Issue #3567 implementor regression guard for the dependency-independent core.
 * The required Business Jest lane discovers this append-only suite through the
 * stock test-file match under every `__tests__` directory.
 */
import { StyleSheet, type TextStyle } from "react-native";
import { describe, expect, test } from "@jest/globals";

import { semantic, text as textTokens } from "../../../constants/designSystem";
import { MenuTextCounter } from "../MenuTextCounter";
import {
  MENU_TEXT_LIMITS,
  MENU_TEXT_SAVE_COPY,
  canonicalizeMenuText,
  classifyMenuTextSaveFailure,
  countMenuStorageCharacters,
  menuTextFieldIds,
  validateMenuText,
  type MenuTextConstraintName,
  type MenuTextField,
} from "../menuTextValidation";

const EXACT_BOUNDARIES: readonly (readonly [MenuTextField, number])[] = [
  ["categoryName", 120],
  ["categoryDescription", 500],
  ["itemName", 160],
  ["itemDescription", 600],
  ["modifierGroupName", 80],
  ["modifierOptionName", 80],
];

const CONSTRAINT_CASES: readonly (
  readonly [MenuTextConstraintName, MenuTextField]
)[] = [
  ["menus_name_check", "categoryName"],
  ["menus_description_check", "categoryDescription"],
  ["menu_items_name_check", "itemName"],
  ["menu_items_description_check", "itemDescription"],
  ["menu_modifier_groups_name_check", "modifierGroupName"],
  ["menu_modifiers_name_check", "modifierOptionName"],
];

describe("menu text storage parity", () => {
  test.each(EXACT_BOUNDARIES)(
    "%s accepts its exact %i-code-point boundary and rejects boundary + 1",
    (field, limit) => {
      const exact = validateMenuText(field, "x".repeat(limit));
      const over = validateMenuText(field, "x".repeat(limit + 1));

      expect(MENU_TEXT_LIMITS[field]).toBe(limit);
      expect(exact).toMatchObject({
        canonicalValue: "x".repeat(limit),
        storageCount: limit,
        limit,
        error: null,
        isValid: true,
      });
      expect(over).toMatchObject({
        canonicalValue: "x".repeat(limit + 1),
        storageCount: limit + 1,
        limit,
        error: {
          kind: "too-long",
          message: `Use ${limit} characters or fewer.`,
        },
        isValid: false,
      });
    },
  );

  test("normalizes to NFC, trims only outer whitespace, and submits that exact value", () => {
    const result = validateMenuText("itemName", "  Cafe\u0301  menu  ");

    expect(canonicalizeMenuText("  Cafe\u0301  menu  ")).toBe("Café  menu");
    expect(result).toMatchObject({
      canonicalValue: "Café  menu",
      storageCount: 10,
      submitValue: "Café  menu",
      error: null,
      isValid: true,
    });
  });

  test("uses PostgreSQL-compatible code-point counts for astral and ZWJ input", () => {
    expect(countMenuStorageCharacters("😀")).toBe(1);
    expect(countMenuStorageCharacters(canonicalizeMenuText("e\u0301"))).toBe(1);
    expect(countMenuStorageCharacters("👨‍👩‍👧‍👦")).toBe(7);
  });

  test("keeps far-over-limit pasted text complete and editable", () => {
    const pasted = `  ${"😀".repeat(170)}  `;
    const result = validateMenuText("itemName", pasted);

    expect(result.canonicalValue).toBe("😀".repeat(170));
    expect(result.storageCount).toBe(170);
    expect(result.submitValue).toBe("😀".repeat(170));
    expect(result.error).toEqual({
      kind: "too-long",
      message: "Use 160 characters or fewer.",
    });
  });

  const requiredCases: readonly (readonly [MenuTextField, string])[] = [
    ["categoryName", "Give this category a name."],
    ["itemName", "Give this item a name."],
    ["modifierGroupName", "Give this group a name."],
  ];

  test.each(requiredCases)("%s owns its exact required copy", (field, message) => {
    expect(validateMenuText(field, " \t\n ")).toMatchObject({
      canonicalValue: "",
      storageCount: 0,
      submitValue: null,
      error: { kind: "required", message },
      isValid: false,
    });
  });

  test.each([
    "categoryDescription",
    "itemDescription",
    "modifierOptionName",
  ] as const)("%s treats canonical blank as valid and omittable", (field) => {
    expect(validateMenuText(field, " \t\n ")).toMatchObject({
      canonicalValue: "",
      storageCount: 0,
      submitValue: null,
      error: null,
      isValid: true,
    });
  });
});

describe("menu text save failure classification", () => {
  test.each(CONSTRAINT_CASES)(
    "maps exact SQLSTATE 23514 constraint %s to %s without exposing database text",
    (constraint, field) => {
      const rawMessage = `new row violates check constraint \"${constraint}\" PRIVATE-DB-TEXT`;
      const failure = classifyMenuTextSaveFailure(
        { code: "23514", message: rawMessage },
        field.startsWith("category")
          ? "category"
          : field.startsWith("item")
            ? "item"
            : "modifier",
      );

      expect(failure).toMatchObject({
        kind: "field",
        field,
        constraint,
        target: field === "modifierOptionName" ? "form" : "field",
      });
      expect(failure.message).toBe(
        field === "modifierOptionName"
          ? "One option name wasn’t accepted. Review the option names and try again. Your changes are still here."
          : `Use ${MENU_TEXT_LIMITS[field]} characters or fewer.`,
      );
      expect(failure.message).not.toContain("PRIVATE-DB-TEXT");
      expect(JSON.stringify(failure)).not.toContain(rawMessage);
    },
  );

  test("does not confuse a constraint prefix or a non-23514 response with a known field", () => {
    expect(
      classifyMenuTextSaveFailure(
        {
          code: "23514",
          message: 'violates check constraint "menu_items_name_check_shadow"',
        },
        "item",
      ),
    ).toEqual({
      kind: "validation",
      message: MENU_TEXT_SAVE_COPY.item.validation,
    });
    expect(
      classifyMenuTextSaveFailure(
        { code: "22001", message: "value too long PRIVATE-DB-TEXT" },
        "category",
      ),
    ).toEqual({
      kind: "validation",
      message: MENU_TEXT_SAVE_COPY.category.validation,
    });
    expect(
      classifyMenuTextSaveFailure(
        {
          code: "22001",
          message: 'mentions "menu_items_name_check" under a different SQLSTATE',
        },
        "item",
      ),
    ).toEqual({
      kind: "validation",
      message: MENU_TEXT_SAVE_COPY.item.validation,
    });
  });

  test("keeps permission, proven offline, and unknown failures distinct", () => {
    expect(
      classifyMenuTextSaveFailure(
        { code: "42501", message: "failed to fetch permission denied" },
        "item",
      ),
    ).toEqual({
      kind: "permission",
      message: MENU_TEXT_SAVE_COPY.item.permission,
    });
    expect(
      classifyMenuTextSaveFailure(
        { message: "Network request failed" },
        "category",
      ),
    ).toEqual({
      kind: "offline",
      message: MENU_TEXT_SAVE_COPY.category.offline,
    });
    expect(
      classifyMenuTextSaveFailure(
        { message: "server returned an opaque failure PRIVATE-DB-TEXT" },
        "modifier",
      ),
    ).toEqual({
      kind: "unknown",
      message: MENU_TEXT_SAVE_COPY.modifier.unknown,
    });
  });

  test("routes an option constraint to the form because the backend has no row identity", () => {
    expect(
      classifyMenuTextSaveFailure(
        {
          code: "23514",
          details: 'constraint "menu_modifiers_name_check" failed',
        },
        "modifier",
      ),
    ).toMatchObject({
      kind: "field",
      field: "modifierOptionName",
      target: "form",
      message:
        "One option name wasn’t accepted. Review the option names and try again. Your changes are still here.",
    });
  });
});

describe("menu text counter presentation", () => {
  test("builds stable association ids for ordinary and keyed option fields", () => {
    expect(menuTextFieldIds("menu-item-name")).toEqual({
      labelId: "menu-item-name-label",
      counterId: "menu-item-name-counter",
      errorId: "menu-item-name-error",
    });
    expect(menuTextFieldIds("menu-option-opt_27-name")).toEqual({
      labelId: "menu-option-opt_27-name-label",
      counterId: "menu-option-opt_27-name-counter",
      errorId: "menu-option-opt_27-name-error",
    });
  });

  test("renders an always-visible neutral, non-live exact-boundary counter", () => {
    const element = MenuTextCounter({
      used: 160,
      limit: 160,
      nativeID: "menu-item-name-counter",
      testID: "counter",
    });
    const props = element.props as Record<string, unknown>;
    const style = StyleSheet.flatten(props.style) as TextStyle;

    expect(props.children).toEqual([160, " / ", 160]);
    expect(props.nativeID).toBe("menu-item-name-counter");
    expect(props.accessibilityRole).toBe("text");
    expect(props.accessibilityLiveRegion).toBeUndefined();
    expect(props["aria-live"]).toBeUndefined();
    expect(style).toMatchObject({
      color: textTokens.tertiary,
      fontWeight: "500",
    });
  });

  test("uses the approved error text token and weight only when invalid", () => {
    const element = MenuTextCounter({
      used: 161,
      limit: 160,
      invalid: true,
      nativeID: "menu-item-name-counter",
    });
    const props = element.props as Record<string, unknown>;
    const style = StyleSheet.flatten(props.style) as TextStyle;

    expect(style).toMatchObject({
      color: semantic.errorText,
      fontWeight: "600",
    });
  });
});
