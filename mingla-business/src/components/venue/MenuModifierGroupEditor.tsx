/**
 * Issue #1789 (#1767 Phase 1) — the modifier-group builder (SPEC #1788 P-11,
 * P-11a; DESIGN D-6).
 *
 * "How would you like it?" (pick one, required) and "Extras" (pick up to N) —
 * the depth a menu needs before a guest can order from it.
 *
 * It is a PANEL, not a Sheet: it renders INSIDE its parent sheet's body
 * (the shipped RN rule — a sub-sheet must live inside its parent, and stacking
 * a second Sheet over MenuItemSheet is exactly what that rule forbids).
 *
 * MONEY RULE: an option's price delta is a stored FACT typed by the operator.
 * Nothing here computes a line total, a fee or a tax; every number a guest sees
 * comes back from the server (SPEC #1788 P-20). Deltas may be NEGATIVE — a half
 * portion legitimately costs less — which is why the column has no >= 0 CHECK.
 * The option's currency is welded to the item's by a database trigger, so a
 * cross-currency option cannot persist even if a client tried
 * (I-PROPOSED-1767-NEVER-CROSS-SUM-CURRENCIES).
 */

import React, { useCallback, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  androidOpaque,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { isLargeText } from "../../constants/dynamicType";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  majorFromMinor,
  minorFromMajor,
  normalizeCurrency,
} from "../../utils/currency";
import { validateModifierGroup, type ModifierSelectionMode } from "./menuDepth";
import type {
  MenuModifierGroup,
  ModifierGroupSaveInput,
} from "../../hooks/useMenuModifiers";
import { createMenuModifierDraftId } from "./menuModifierDraftId";
import { MenuTextCounter } from "./MenuTextCounter";
import {
  menuTextFieldIds,
  validateMenuText,
  type MenuTextSaveFailure,
} from "./menuTextValidation";

interface OptionDraft {
  id: string;
  name: string;
  /** Major units as typed, e.g. "1.50" or "-3.00". */
  price: string;
}

const modifierGroupNameIds = menuTextFieldIds("modifier-group-name");

const menuTextAccessibilityHint = (
  used: number,
  limit: number,
): string => `${used} of ${limit} characters will be saved.`;

export interface MenuModifierGroupEditorProps {
  menuItemId: string;
  /** Present → edit; absent → a new group. */
  group: MenuModifierGroup | null;
  currency: string;
  nextSortOrder: number;
  onSave: (input: ModifierGroupSaveInput) => void;
  saving: boolean;
  saveError?: MenuTextSaveFailure | null;
  onClearSaveError?: () => void;
  onDelete?: (groupId: string) => void;
  deleting?: boolean;
  onCancel: () => void;
  testID?: string;
}

export function MenuModifierGroupEditor({
  menuItemId,
  group,
  currency,
  nextSortOrder,
  onSave,
  saving,
  saveError = null,
  onClearSaveError,
  onDelete,
  deleting = false,
  onCancel,
  testID,
}: MenuModifierGroupEditorProps): React.ReactElement {
  const code = normalizeCurrency(currency);
  const { width, fontScale } = useWindowDimensions();
  const stackOptionControls = width <= 360 || isLargeText(fontScale);
  const [draftGroupId] = useState<string>(
    () => group?.id ?? createMenuModifierDraftId(),
  );
  // This component is keyed by the draft/group identity at its caller. Hydrate
  // exactly once so a background query refresh cannot replace an open draft.
  const [name, setName] = useState<string>(() => group?.name ?? "");
  const [mode, setMode] = useState<ModifierSelectionMode>(
    () => group?.selectionMode ?? "single",
  );
  const [required, setRequired] = useState<boolean>(
    () => (group?.minSelect ?? 1) >= 1,
  );
  const [maxSelect, setMaxSelect] = useState<string>(() =>
    group?.maxSelect === null || group?.maxSelect === undefined
      ? ""
      : String(group.maxSelect),
  );
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    (group?.modifiers ?? []).map((modifier) => ({
      id: modifier.id,
      name: modifier.name,
      price:
        modifier.priceDeltaCents === 0
          ? ""
          : String(majorFromMinor(modifier.priceDeltaCents, code)),
    })),
  );
  const [nameBlurred, setNameBlurred] = useState<boolean>(false);
  const [nameHadNonBlankValue, setNameHadNonBlankValue] = useState<boolean>(
    () =>
      validateMenuText("modifierGroupName", group?.name ?? "")
        .canonicalValue !== "",
  );

  const parsedMax =
    mode === "single"
      ? 1
      : maxSelect.trim().length === 0
        ? null
        : Number.parseInt(maxSelect.trim(), 10);
  const minSelect = required ? 1 : 0;
  const groupNameValidation = validateMenuText("modifierGroupName", name);
  const optionValidations = options.map((option) => ({
    id: option.id,
    result: validateMenuText("modifierOptionName", option.name),
  }));
  const visibleGroupNameLocalError =
    groupNameValidation.error?.kind === "too-long" ||
    (groupNameValidation.error?.kind === "required" &&
      (nameBlurred || nameHadNonBlankValue))
      ? groupNameValidation.error.message
      : null;
  const groupFieldFailure =
    saveError?.kind === "field" && saveError.field === "modifierGroupName"
      ? saveError.message
      : null;
  const groupNameError = visibleGroupNameLocalError ?? groupFieldFailure;
  const modifierFieldFailureActive =
    saveError?.kind === "field" &&
    (saveError.field === "modifierGroupName" ||
      saveError.field === "modifierOptionName");
  const optionNameInvalid = optionValidations.some(
    ({ result }) => result.error?.kind === "too-long",
  );
  const error = groupNameValidation.isValid
    ? validateModifierGroup({
        name: groupNameValidation.canonicalValue,
        selectionMode: mode,
        minSelect,
        maxSelect:
          parsedMax === null || Number.isNaN(parsedMax) ? null : parsedMax,
        optionCount: optionValidations.filter(
          ({ result }) => result.canonicalValue !== "",
        ).length,
      })
    : null;
  const saveFailureMessage =
    saveError?.kind === "field"
      ? saveError.formMessage
      : (saveError?.message ?? null);
  const canSave =
    groupNameValidation.isValid &&
    !optionNameInvalid &&
    !modifierFieldFailureActive &&
    error === null &&
    !saving;

  const addOption = useCallback((): void => {
    if (saving) return;
    setOptions((current) => [
      ...current,
      { id: createMenuModifierDraftId(), name: "", price: "" },
    ]);
    onClearSaveError?.();
  }, [onClearSaveError, saving]);

  const removeOption = useCallback(
    (id: string): void => {
      if (saving) return;
      setOptions((current) => current.filter((o) => o.id !== id));
      onClearSaveError?.();
    },
    [onClearSaveError, saving],
  );

  const patchOption = useCallback(
    (id: string, patch: Partial<OptionDraft>): void => {
      if (saving) return;
      setOptions((current) =>
        current.map((o) => (o.id === id ? { ...o, ...patch } : o)),
      );
      onClearSaveError?.();
    },
    [onClearSaveError, saving],
  );

  const handleNameChange = useCallback(
    (next: string): void => {
      if (validateMenuText("modifierGroupName", next).canonicalValue !== "") {
        setNameHadNonBlankValue(true);
      }
      onClearSaveError?.();
      setName(next);
    },
    [onClearSaveError],
  );

  const handleSave = useCallback((): void => {
    if (
      !groupNameValidation.isValid ||
      optionNameInvalid ||
      modifierFieldFailureActive ||
      error !== null ||
      saving
    ) {
      return;
    }
    onClearSaveError?.();
    onSave({
      id: draftGroupId,
      menuItemId,
      name: groupNameValidation.canonicalValue,
      selectionMode: mode,
      minSelect,
      maxSelect:
        parsedMax === null || Number.isNaN(parsedMax) ? null : parsedMax,
      sortOrder: group?.sortOrder ?? nextSortOrder,
      modifiers: options
        .map((option) => ({
          option,
          validation: validateMenuText("modifierOptionName", option.name),
        }))
        .filter(({ validation }) => validation.canonicalValue !== "")
        .map(({ option, validation }, index) => {
          // `minorFromMajor` clamps negatives to 0 by design (it serves prices,
          // which cannot be negative). A modifier delta CAN be, so the sign is
          // carried separately and the magnitude converted.
          const typed = Number.parseFloat(option.price.replace(/,/g, ""));
          const magnitude = Number.isFinite(typed)
            ? minorFromMajor(Math.abs(typed), code)
            : 0;
          return {
            id: option.id,
            name: validation.canonicalValue,
            priceDeltaCents:
              Number.isFinite(typed) && typed < 0 ? -magnitude : magnitude,
            sortOrder: index,
          };
        }),
    });
  }, [
    groupNameValidation,
    optionNameInvalid,
    modifierFieldFailureActive,
    error,
    saving,
    onClearSaveError,
    onSave,
    group,
    draftGroupId,
    menuItemId,
    mode,
    minSelect,
    parsedMax,
    nextSortOrder,
    code,
    options,
  ]);

  return (
    <View style={styles.panel} testID={testID ?? "menu-modifier-group-editor"}>
      <Text style={styles.title}>
        {group === null ? "New options group" : "Edit options group"}
      </Text>

      <MenuTextField
        label="What are you asking?"
        labelId={modifierGroupNameIds.labelId}
        error={groupNameError}
        errorId={modifierGroupNameIds.errorId}
        counter={
          <MenuTextCounter
            used={groupNameValidation.storageCount}
            limit={groupNameValidation.limit}
            invalid={
              groupNameValidation.error?.kind === "too-long" ||
              groupFieldFailure !== null
            }
            nativeID={modifierGroupNameIds.counterId}
            testID="modifier-group-name-counter"
          />
        }
      >
        <Input
          value={name}
          onChangeText={handleNameChange}
          onBlur={() => setNameBlurred(true)}
          placeholder="e.g. How would you like it?"
          accessibilityLabel="Options group name"
          accessibilityHint={menuTextAccessibilityHint(
            groupNameValidation.storageCount,
            groupNameValidation.limit,
          )}
          aria-labelledby={modifierGroupNameIds.labelId}
          aria-describedby={modifierGroupNameIds.counterId}
          error={groupNameError}
          errorId={`${modifierGroupNameIds.counterId} ${modifierGroupNameIds.errorId}`}
          renderErrorMessage={false}
          disabled={saving}
          testID="modifier-group-name"
        />
      </MenuTextField>

      <View style={styles.modeRow}>
        <Button
          label="Pick one"
          onPress={() => {
            onClearSaveError?.();
            setMode("single");
          }}
          variant={mode === "single" ? "primary" : "secondary"}
          size="sm"
          disabled={saving}
          testID="modifier-group-mode-single"
        />
        <Button
          label="Pick several"
          onPress={() => {
            onClearSaveError?.();
            setMode("multi");
          }}
          variant={mode === "multi" ? "primary" : "secondary"}
          size="sm"
          disabled={saving}
          testID="modifier-group-mode-multi"
        />
        <Button
          label={required ? "Required" : "Optional"}
          onPress={() => {
            onClearSaveError?.();
            setRequired((r) => !r);
          }}
          variant={required ? "primary" : "secondary"}
          size="sm"
          disabled={saving}
          testID="modifier-group-required"
        />
      </View>

      {mode === "multi" ? (
        <Field label="Most they can pick (leave blank for no limit)">
          <Input
            value={maxSelect}
            onChangeText={(next) => {
              onClearSaveError?.();
              setMaxSelect(next);
            }}
            variant="number"
            placeholder="3"
            accessibilityLabel="Most options a guest can pick"
            disabled={saving}
            testID="modifier-group-max"
          />
        </Field>
      ) : null}

      <Text style={styles.sectionLabel}>Options</Text>
      {options.map((option, optionIndex) => {
        const validation = validateMenuText(
          "modifierOptionName",
          option.name,
        );
        const ids = menuTextFieldIds(`modifier-option-name-${option.id}`);
        const optionError =
          validation.error?.kind === "too-long"
            ? validation.error.message
            : null;
        return (
          <View key={option.id} style={styles.optionBlock}>
            <View style={styles.fieldHeader}>
              <Text
                nativeID={ids.labelId}
                style={[styles.fieldLabel, styles.menuTextFieldLabel]}
                testID={`modifier-option-header-${option.id}`}
              >
                {`Option ${optionIndex + 1}`}
              </Text>
              <View style={styles.menuTextCounterWrap}>
                <MenuTextCounter
                  used={validation.storageCount}
                  limit={validation.limit}
                  invalid={optionError !== null}
                  nativeID={ids.counterId}
                  testID={`modifier-option-name-counter-${option.id}`}
                />
              </View>
            </View>
            <View
              style={[
                styles.optionControls,
                stackOptionControls && styles.optionControlsStacked,
              ]}
            >
              <View
                style={[
                  styles.optionName,
                  stackOptionControls && styles.optionNameStacked,
                ]}
              >
                <Input
                  value={option.name}
                  onChangeText={(next) =>
                    patchOption(option.id, { name: next })
                  }
                  placeholder="e.g. Rare"
                  accessibilityLabel={`Option ${optionIndex + 1} name`}
                  accessibilityHint={menuTextAccessibilityHint(
                    validation.storageCount,
                    validation.limit,
                  )}
                  aria-labelledby={ids.labelId}
                  aria-describedby={ids.counterId}
                  error={optionError}
                  errorId={`${ids.counterId} ${ids.errorId}`}
                  renderErrorMessage={false}
                  disabled={saving}
                  testID={`modifier-option-name-${option.id}`}
                />
                {optionError !== null ? (
                  <Text
                    nativeID={ids.errorId}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="assertive"
                    aria-live="assertive"
                    style={styles.fieldError}
                    testID={ids.errorId}
                  >
                    {optionError}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.optionSecondaryControls,
                  stackOptionControls && styles.optionSecondaryControlsStacked,
                ]}
              >
                <View style={styles.optionPrice}>
                  <Input
                    value={option.price}
                    onChangeText={(next) =>
                      patchOption(option.id, { price: next })
                    }
                    variant="number"
                    placeholder={`± ${code}`}
                    accessibilityLabel={`Price change for option ${optionIndex + 1} in ${code}`}
                    disabled={saving}
                    testID={`modifier-option-price-${option.id}`}
                  />
                </View>
                <Pressable
                  onPress={() => removeOption(option.id)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${validation.canonicalValue !== "" ? validation.canonicalValue : `option ${optionIndex + 1}`}`}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.remove,
                    pressed && styles.pressed,
                  ]}
                  testID={`modifier-option-remove-${option.id}`}
                >
                  <Text style={styles.removeGlyph}>×</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}
      <Text style={styles.hint}>
        Leave the price blank when an option costs the same. A smaller portion
        can cost less — type a minus.
      </Text>
      <Button
        label="Add an option"
        onPress={addOption}
        variant="secondary"
        size="sm"
        disabled={saving}
        style={styles.addOption}
        testID="modifier-option-add"
      />

      {error !== null ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          aria-live="assertive"
          style={styles.error}
          testID="modifier-group-error"
        >
          {error}
        </Text>
      ) : null}

      {saveFailureMessage !== null ? (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          aria-live="assertive"
          style={styles.saveError}
          testID="modifier-group-save-error"
        >
          <Text style={styles.mutationError}>{saveFailureMessage}</Text>
        </View>
      ) : null}

      <Button
        label={group === null ? "Add group" : "Save group"}
        onPress={handleSave}
        variant="primary"
        size="md"
        fullWidth
        loading={saving}
        disabled={!canSave}
        accessibilityLabel={saving ? "Saving options group" : undefined}
        style={styles.save}
        testID="modifier-group-save"
      />
      <Button
        label="Cancel"
        onPress={onCancel}
        variant="ghost"
        size="sm"
        fullWidth
        disabled={saving}
        testID="modifier-group-cancel"
      />
      {group !== null && onDelete !== undefined ? (
        <Button
          label="Remove this group"
          onPress={() => onDelete(group.id)}
          variant="destructive"
          size="sm"
          fullWidth
          loading={deleting}
          disabled={deleting || saving}
          style={styles.delete}
          testID="modifier-group-delete"
        />
      ) : null}
    </View>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

interface MenuTextFieldProps extends FieldProps {
  labelId: string;
  counter: React.ReactNode;
  error: string | null;
  errorId: string;
}

function MenuTextField({
  label,
  labelId,
  counter,
  error,
  errorId,
  children,
}: MenuTextFieldProps): React.ReactElement {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text
          nativeID={labelId}
          style={[styles.fieldLabel, styles.menuTextFieldLabel]}
        >
          {label}
        </Text>
        <View style={styles.menuTextCounterWrap}>{counter}</View>
      </View>
      {children}
      {error !== null ? (
        <Text
          nativeID={errorId}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          aria-live="assertive"
          style={styles.fieldError}
          testID={errorId}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function Field({ label, children }: FieldProps): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  field: {
    gap: spacing.xxs,
    marginBottom: spacing.xs,
  },
  fieldHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  menuTextFieldLabel: {
    flexShrink: 1,
    minWidth: 0,
  },
  menuTextCounterWrap: {
    marginLeft: "auto",
    alignItems: "flex-end",
  },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  fieldError: {
    ...typography.bodySm,
    color: semantic.errorText,
    fontWeight: "600",
    marginTop: spacing.xxs,
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  optionBlock: {
    gap: spacing.xxs,
    marginBottom: spacing.xs,
  },
  optionControls: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  optionControlsStacked: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  optionName: {
    flex: 2,
    minWidth: 0,
  },
  optionNameStacked: {
    flex: 0,
    width: "100%",
  },
  optionSecondaryControls: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  optionSecondaryControlsStacked: {
    flex: 0,
    width: "100%",
  },
  optionPrice: {
    flex: 1,
    minWidth: 0,
  },
  remove: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  removeGlyph: {
    ...typography.h3,
    color: textTokens.tertiary,
  },
  pressed: {
    opacity: 0.6,
  },
  hint: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  addOption: {
    alignSelf: "flex-start",
    marginTop: spacing.xxs,
  },
  error: {
    ...typography.bodySm,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  mutationError: {
    ...typography.bodySm,
    color: semantic.errorText,
  },
  saveError: {
    gap: spacing.xxs,
    padding: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    borderColor: semantic.error,
    overflow: "hidden",
    backgroundColor:
      Platform.OS === "android" ? androidOpaque.errorFill : semantic.errorTint,
  },
  save: {
    marginTop: spacing.sm,
  },
  delete: {
    marginTop: spacing.xs,
  },
});

export default MenuModifierGroupEditor;
