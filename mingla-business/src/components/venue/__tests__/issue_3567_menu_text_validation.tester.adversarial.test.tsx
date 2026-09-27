/**
 * Issue #3567 independent tester guard.
 *
 * This suite attacks the storage boundary from the database's point of view:
 * Unicode code points after NFC + trim, hostile error payloads, and the parent
 * routing seams that decide whether a failed authoring draft stays recoverable.
 * It deliberately does not duplicate the implementor's per-control happy-path
 * renderer scripts.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

import { androidOpaque, semantic } from "../../../constants/designSystem";
import {
  MENU_TEXT_LIMITS,
  MENU_TEXT_SAVE_COPY,
  classifyMenuTextSaveFailure,
  validateMenuText,
  type MenuTextConstraintName,
  type MenuTextField,
  type MenuTextSaveContext,
} from "../menuTextValidation";

const repoRoot = path.resolve(__dirname, "../../../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const fields: readonly (readonly [MenuTextField, number])[] = [
  ["categoryName", 120],
  ["categoryDescription", 500],
  ["itemName", 160],
  ["itemDescription", 600],
  ["modifierGroupName", 80],
  ["modifierOptionName", 80],
];

const constraints: readonly (
  readonly [MenuTextConstraintName, MenuTextField, MenuTextSaveContext]
)[] = [
  ["menus_name_check", "categoryName", "category"],
  ["menus_description_check", "categoryDescription", "category"],
  ["menu_items_name_check", "itemName", "item"],
  ["menu_items_description_check", "itemDescription", "item"],
  ["menu_modifier_groups_name_check", "modifierGroupName", "modifier"],
  ["menu_modifiers_name_check", "modifierOptionName", "modifier"],
];

const family = "👨‍👩‍👧‍👦"; // PostgreSQL length(text) = 7, JS .length = 11.
const decomposedAccent = "e\u0301"; // NFC canonical form is one code point.

const exactHostileUnicode = (limit: number): string => {
  const familyCount = Math.floor(limit / 7);
  const remainder = limit % 7;
  return `  ${family.repeat(familyCount)}${decomposedAccent.repeat(remainder)}  `;
};

describe("#3567 tester — PostgreSQL text boundary", () => {
  test.each(fields)(
    "%s accepts exact hostile Unicode and rejects one more code point without truncation",
    (field, limit) => {
      const rawExact = exactHostileUnicode(limit);
      const exact = validateMenuText(field, rawExact);
      const rawOver = `${rawExact.slice(0, -2)}😀  `;
      const over = validateMenuText(field, rawOver);

      expect(MENU_TEXT_LIMITS[field]).toBe(limit);
      expect(exact.storageCount).toBe(limit);
      expect(exact.isValid).toBe(true);
      expect(exact.error).toBeNull();
      expect(exact.canonicalValue).toBe(
        `${family.repeat(Math.floor(limit / 7))}${"é".repeat(limit % 7)}`,
      );
      expect(exact.submitValue).toBe(exact.canonicalValue);
      // Proves this fixture would be rejected by a regression to UTF-16 .length.
      expect(exact.canonicalValue.length).toBeGreaterThan(limit);

      expect(over.storageCount).toBe(limit + 1);
      expect(over.isValid).toBe(false);
      expect(over.error).toEqual({
        kind: "too-long",
        message: `Use ${limit} characters or fewer.`,
      });
      expect(over.canonicalValue).toBe(`${exact.canonicalValue}😀`);
      expect(over.submitValue).toBe(over.canonicalValue);
    },
  );

  test.each(fields)(
    "%s retains a far-over paste byte-for-behavior and never silently slices it",
    (field, limit) => {
      const pasted = `  ${family.repeat(limit + 3)}  `;
      const result = validateMenuText(field, pasted);

      expect(result.storageCount).toBe((limit + 3) * 7);
      expect(result.canonicalValue).toBe(family.repeat(limit + 3));
      expect(result.submitValue).toBe(result.canonicalValue);
      expect(result.error?.kind).toBe("too-long");
    },
  );

  test("optional blanks become null while every required blank remains handler-invalid", () => {
    for (const field of [
      "categoryDescription",
      "itemDescription",
      "modifierOptionName",
    ] as const) {
      expect(validateMenuText(field, " \t\n ")).toMatchObject({
        canonicalValue: "",
        submitValue: null,
        error: null,
        isValid: true,
      });
    }
    for (const field of [
      "categoryName",
      "itemName",
      "modifierGroupName",
    ] as const) {
      expect(validateMenuText(field, " \t\n ")).toMatchObject({
        canonicalValue: "",
        submitValue: null,
        error: { kind: "required" },
        isValid: false,
      });
    }
  });
});

describe("#3567 tester — hostile backend classification", () => {
  test.each(constraints)(
    "%s maps from diagnostic hint to %s and leaks none of the raw payload",
    (constraint, field, context) => {
      const secret = `PRIVATE-${constraint}-ROW-DUMP`;
      const failure = classifyMenuTextSaveFailure(
        {
          code: "23514",
          message: `opaque server refusal ${secret}`,
          details: `column snapshot ${secret}`,
          hint: `constraint \"${constraint}\" failed ${secret}`,
        },
        context,
      );

      expect(failure).toMatchObject({
        kind: "field",
        field,
        constraint,
        target: field === "modifierOptionName" ? "form" : "field",
      });
      expect(JSON.stringify(failure)).not.toContain(secret);
      if (failure.kind === "field" && field === "modifierOptionName") {
        expect(failure.formMessage).toBe(
          "One option name wasn’t accepted. Review the option names and try again. Your changes are still here.",
        );
      }
    },
  );

  test.each(["category", "item", "modifier"] as const)(
    "%s keeps validation, permission, proven offline, and unknown outcomes disjoint",
    (context) => {
      const copy = MENU_TEXT_SAVE_COPY[context];
      expect(
        classifyMenuTextSaveFailure(
          { code: "23514", message: "Network request failed after a check" },
          context,
        ),
      ).toEqual({ kind: "validation", message: copy.validation });
      expect(
        classifyMenuTextSaveFailure(
          { code: "42501", message: "failed to fetch: permission denied" },
          context,
        ),
      ).toEqual({ kind: "permission", message: copy.permission });
      expect(
        classifyMenuTextSaveFailure(
          { message: "Network request failed" },
          context,
        ),
      ).toEqual({ kind: "offline", message: copy.offline });
      expect(
        classifyMenuTextSaveFailure(
          { code: "XX999", message: "PRIVATE OPAQUE DATABASE TEXT" },
          context,
        ),
      ).toEqual({ kind: "unknown", message: copy.unknown });
    },
  );

  test("constraint lookalikes and the wrong SQLSTATE never accuse a field", () => {
    for (const raw of [
      {
        code: "23514",
        message: 'constraint "menu_items_name_check_shadow" failed',
      },
      {
        code: "23514",
        message: 'constraint "xmenu_items_name_check" failed',
      },
      {
        code: "22001",
        message: 'constraint "menu_items_name_check" is mentioned',
      },
    ]) {
      expect(classifyMenuTextSaveFailure(raw, "item")).toEqual({
        kind: "validation",
        message: MENU_TEXT_SAVE_COPY.item.validation,
      });
    }
  });
});

describe("#3567 tester — authoring recovery and accessibility wiring", () => {
  const category = read("src/components/venue/MenuCategorySheet.tsx");
  const item = read("src/components/venue/MenuItemSheet.tsx");
  const editor = read("src/components/venue/MenuModifierGroupEditor.tsx");
  const options = read("src/components/venue/MenuItemOptionsSection.tsx");
  const parent = read("src/components/venue/VenueMenuModule.tsx");
  const helper = read("src/components/venue/menuTextValidation.ts");

  test("all six write paths use the shared canonical payload and no text field truncates", () => {
    expect(helper).toContain('return raw.normalize("NFC").trim();');
    expect(helper).toContain("return Array.from(canonicalValue).length;");
    for (const source of [category, item, editor, helper]) {
      expect(source).not.toContain("maxLength=");
    }
    expect(category).toContain("name: nameValidation.canonicalValue");
    expect(category).toContain(
      "description: descriptionValidation.submitValue",
    );
    expect(item).toContain("name: nameValidation.canonicalValue");
    expect(item).toContain(
      "description: descriptionValidation.submitValue",
    );
    expect(editor).toContain("name: groupNameValidation.canonicalValue");
    expect(editor).toContain("name: validation.canonicalValue");
  });

  test("direct save handlers repeat validation instead of trusting disabled buttons", () => {
    expect(category).toContain("!nameValidation.isValid");
    expect(category).toContain("!descriptionValidation.isValid");
    expect(category).toContain("categoryFieldFailureActive");
    expect(item).toContain("!nameValidation.isValid");
    expect(item).toContain("!descriptionValidation.isValid");
    expect(item).toContain("itemFieldFailureActive");
    expect(editor).toContain("!groupNameValidation.isValid");
    expect(editor).toContain("optionNameInvalid");
    expect(editor).toContain("modifierFieldFailureActive");
  });

  test("first-category and item failures remain independently inside their open sheets", () => {
    expect(parent).toContain(
      'setCategorySaveFailure(\n              classifyMenuTextSaveFailure(error, "category"),',
    );
    expect(parent).toContain(
      'setItemSaveFailure(classifyMenuTextSaveFailure(error, "item"))',
    );
    expect(parent.match(/saveFailure=\{categorySaveFailure\}/g)).toHaveLength(2);
    expect(parent).toContain("saveFailure={itemSaveFailure}");
    expect(parent).toContain(
      "saveError && !categorySheetOpen && !itemSheetOpen",
    );
    expect(parent).toContain(
      "That menu change wasn&apos;t saved. Try again.",
    );
    expect(parent).not.toContain(
      "Couldn&apos;t save. Check your connection and try again.",
    );
  });

  test("new action, correction, dismissal, retry, and success all have explicit clear owners", () => {
    for (const handler of [
      "openAddCategory",
      "openEditCategory",
      "handleSaveCategory",
    ]) {
      const start = parent.indexOf(`const ${handler}`);
      expect(start).toBeGreaterThan(-1);
      expect(parent.slice(start, start + 520)).toContain(
        "setCategorySaveFailure(null)",
      );
    }
    for (const handler of ["openAddItem", "openEditItem", "handleSaveItem"]) {
      const start = parent.indexOf(`const ${handler}`);
      expect(start).toBeGreaterThan(-1);
      expect(parent.slice(start, start + 620)).toContain(
        "setItemSaveFailure(null)",
      );
    }
    expect(category.match(/onClearSaveFailure\?\.\(\)/g)?.length).toBeGreaterThanOrEqual(
      8,
    );
    expect(item.match(/onClearSaveFailure\?\.\(\)/g)?.length).toBeGreaterThanOrEqual(
      8,
    );
    expect(editor.match(/onClearSaveError\?\.\(\)/g)?.length).toBeGreaterThanOrEqual(
      8,
    );
    expect(options).toContain("setSaveError(null)");
    expect(options).toContain("setSuccessMessage(null)");
  });

  test("an unidentified backend option failure stays form-level and stable option keys own row errors", () => {
    expect(editor).toContain("<View key={option.id} style={styles.optionBlock}>");
    expect(editor).toContain(
      "const ids = menuTextFieldIds(`modifier-option-name-${option.id}`)",
    );
    expect(editor).toContain(
      "saveError?.kind === \"field\" &&\n    (saveError.field === \"modifierGroupName\" ||\n      saveError.field === \"modifierOptionName\")",
    );
    expect(editor).not.toContain(
      'saveError.field === "modifierOptionName" ? option.id',
    );
    expect(helper).toContain(
      'target: optionWithoutRowIdentity ? "form" : "field"',
    );
  });

  test("compact and large-text layouts stack without shrinking the 44-point remove control", () => {
    expect(editor).toContain(
      "const stackOptionControls = width <= 360 || isLargeText(fontScale);",
    );
    expect(editor).toContain(
      "stackOptionControls && styles.optionControlsStacked",
    );
    expect(editor).toContain(
      "stackOptionControls && styles.optionSecondaryControlsStacked",
    );
    expect(editor).toContain("minWidth: 44");
    expect(editor).toContain("minHeight: 44");
    expect(editor).toContain('width: "100%"');
  });

  test("field IDs, non-live counters, assertive errors, and Android opaque alerts are explicit", () => {
    for (const source of [category, item, editor]) {
      expect(source).toContain('accessibilityRole="alert"');
      expect(source).toContain('accessibilityLiveRegion="assertive"');
      expect(source).toContain('aria-live="assertive"');
      expect(source).toContain('aria-labelledby=');
      expect(source).toContain('aria-describedby=');
      expect(source).toContain('renderErrorMessage={false}');
      expect(source).toContain(
        'Platform.OS === "android" ? androidOpaque.errorFill : semantic.errorTint',
      );
    }
    const counter = read("src/components/venue/MenuTextCounter.tsx");
    expect(counter).not.toContain("accessibilityLiveRegion");
    expect(counter).not.toContain("aria-live");
    expect(androidOpaque.errorFill).not.toBe(semantic.errorTint);
  });
});
