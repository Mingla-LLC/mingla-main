import {
  isLikelyOfflineError,
  isPermissionDeniedError,
  normalizeSupabaseError,
  type NormalizedSupabaseError,
} from "../../utils/supabaseErrorMessage";

export type MenuTextField =
  | "categoryName"
  | "categoryDescription"
  | "itemName"
  | "itemDescription"
  | "modifierGroupName"
  | "modifierOptionName";

export const MENU_TEXT_LIMITS: Readonly<Record<MenuTextField, number>> =
  Object.freeze({
    categoryName: 120,
    categoryDescription: 500,
    itemName: 160,
    itemDescription: 600,
    modifierGroupName: 80,
    modifierOptionName: 80,
  });

export const MENU_TEXT_REQUIRED_COPY: Readonly<
  Partial<Record<MenuTextField, string>>
> = Object.freeze({
  categoryName: "Give this category a name.",
  itemName: "Give this item a name.",
  modifierGroupName: "Give this group a name.",
});

export type MenuTextLocalErrorKind = "required" | "too-long";

export interface MenuTextLocalError {
  kind: MenuTextLocalErrorKind;
  message: string;
}

export interface MenuTextValidationResult {
  field: MenuTextField;
  canonicalValue: string;
  storageCount: number;
  limit: number;
  submitValue: string | null;
  error: MenuTextLocalError | null;
  isValid: boolean;
}

export interface MenuTextFieldIds {
  labelId: string;
  counterId: string;
  errorId: string;
}

export function menuTextFieldIds(fieldId: string): MenuTextFieldIds {
  return {
    labelId: `${fieldId}-label`,
    counterId: `${fieldId}-counter`,
    errorId: `${fieldId}-error`,
  };
}

/** Canonicalize exactly once before both validation and submission. */
export function canonicalizeMenuText(raw: string): string {
  return raw.normalize("NFC").trim();
}

/** Match PostgreSQL length(text): count Unicode code points, not UTF-16 units. */
export function countMenuStorageCharacters(canonicalValue: string): number {
  return Array.from(canonicalValue).length;
}

export function menuTextOverLimitMessage(limit: number): string {
  return `Use ${limit} characters or fewer.`;
}

export function validateMenuText(
  field: MenuTextField,
  raw: string,
): MenuTextValidationResult {
  const canonicalValue = canonicalizeMenuText(raw);
  const storageCount = countMenuStorageCharacters(canonicalValue);
  const limit = MENU_TEXT_LIMITS[field];
  const requiredMessage = MENU_TEXT_REQUIRED_COPY[field];

  let error: MenuTextLocalError | null = null;
  if (canonicalValue === "" && requiredMessage !== undefined) {
    error = { kind: "required", message: requiredMessage };
  } else if (storageCount > limit) {
    error = { kind: "too-long", message: menuTextOverLimitMessage(limit) };
  }

  return {
    field,
    canonicalValue,
    storageCount,
    limit,
    submitValue: canonicalValue === "" ? null : canonicalValue,
    error,
    isValid: error === null,
  };
}

export type MenuTextConstraintName =
  | "menus_name_check"
  | "menus_description_check"
  | "menu_items_name_check"
  | "menu_items_description_check"
  | "menu_modifier_groups_name_check"
  | "menu_modifiers_name_check";

export const MENU_TEXT_CONSTRAINT_FIELDS: Readonly<
  Record<MenuTextConstraintName, MenuTextField>
> = Object.freeze({
  menus_name_check: "categoryName",
  menus_description_check: "categoryDescription",
  menu_items_name_check: "itemName",
  menu_items_description_check: "itemDescription",
  menu_modifier_groups_name_check: "modifierGroupName",
  menu_modifiers_name_check: "modifierOptionName",
});

export type MenuTextSaveContext = "category" | "item" | "modifier";

interface MenuTextSaveCopy {
  validation: string;
  offline: string;
  permission: string;
  unknown: string;
}

export const MENU_TEXT_SAVE_COPY: Readonly<
  Record<MenuTextSaveContext, MenuTextSaveCopy>
> = Object.freeze({
  category: {
    validation:
      "Category not saved. One detail wasn’t accepted. Review the form and try again. Your details are still here.",
    offline:
      "Category not saved. You’re offline. Reconnect, then try again. Your details are still here.",
    permission:
      "Category not saved. You don’t have permission to change this menu. Ask an owner or manager to update your access. Your details are still here.",
    unknown:
      "Category not saved. We couldn’t confirm the save, but your details are still here. It’s safe to try again.",
  },
  item: {
    validation:
      "Item not saved. One detail wasn’t accepted. Review the form and try again. Your details are still here.",
    offline:
      "Item not saved. You’re offline. Reconnect, then try again. Your details are still here.",
    permission:
      "Item not saved. You don’t have permission to change this menu. Ask an owner or manager to update your access. Your details are still here.",
    unknown:
      "Item not saved. We couldn’t confirm the save, but your details are still here. It’s safe to try again.",
  },
  modifier: {
    validation:
      "We could not save this group because one detail was not accepted. Review the form and try again. Your changes are still here.",
    offline:
      "You are offline. Reconnect, then try again. Your changes are still here.",
    permission:
      "You cannot save this group with this account. Your changes are still here.",
    unknown:
      "We could not save this group. Your changes are still here — try again.",
  },
});

export type MenuTextSaveFailure =
  | {
      kind: "field";
      field: MenuTextField;
      constraint: MenuTextConstraintName;
      target: "field" | "form";
      message: string;
      formMessage: string;
    }
  | { kind: "validation"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "permission"; message: string }
  | { kind: "unknown"; message: string };

const MODIFIER_OPTION_SAVE_MESSAGE =
  "One option name wasn’t accepted. Review the option names and try again. Your changes are still here.";

const constraintNames = Object.keys(
  MENU_TEXT_CONSTRAINT_FIELDS,
) as MenuTextConstraintName[];

function containsExactConstraint(
  error: NormalizedSupabaseError,
  constraint: MenuTextConstraintName,
): boolean {
  const pattern = new RegExp(
    `(?:^|[^A-Za-z0-9_])${constraint}(?:$|[^A-Za-z0-9_])`,
  );
  return [error.message, error.details, error.hint].some(
    (value) => value !== undefined && pattern.test(value),
  );
}

function findMenuTextConstraint(
  error: NormalizedSupabaseError,
): MenuTextConstraintName | null {
  if (error.code !== "23514") return null;
  return (
    constraintNames.find((constraint) =>
      containsExactConstraint(error, constraint),
    ) ?? null
  );
}

function isSqlValidationCode(code: string | undefined): boolean {
  return (
    code === "23514" ||
    code?.startsWith("22") === true ||
    code?.startsWith("23") === true
  );
}

/**
 * Classify a rejected save without retaining or returning raw database text.
 * Known checks win before broader validation, permission, transport, and unknown
 * categories so a server response is never mislabeled as a connection failure.
 */
export function classifyMenuTextSaveFailure(
  raw: unknown,
  context: MenuTextSaveContext,
): MenuTextSaveFailure {
  const normalized = normalizeSupabaseError(raw, "");
  const constraint = findMenuTextConstraint(normalized);
  const copy = MENU_TEXT_SAVE_COPY[context];

  if (constraint !== null) {
    const field = MENU_TEXT_CONSTRAINT_FIELDS[constraint];
    const optionWithoutRowIdentity = field === "modifierOptionName";
    return {
      kind: "field",
      field,
      constraint,
      target: optionWithoutRowIdentity ? "form" : "field",
      message: optionWithoutRowIdentity
        ? MODIFIER_OPTION_SAVE_MESSAGE
        : menuTextOverLimitMessage(MENU_TEXT_LIMITS[field]),
      formMessage: optionWithoutRowIdentity
        ? MODIFIER_OPTION_SAVE_MESSAGE
        : copy.validation,
    };
  }

  if (isSqlValidationCode(normalized.code)) {
    return { kind: "validation", message: copy.validation };
  }
  if (isPermissionDeniedError(normalized)) {
    return { kind: "permission", message: copy.permission };
  }
  if (isLikelyOfflineError(normalized)) {
    return { kind: "offline", message: copy.offline };
  }
  return { kind: "unknown", message: copy.unknown };
}
