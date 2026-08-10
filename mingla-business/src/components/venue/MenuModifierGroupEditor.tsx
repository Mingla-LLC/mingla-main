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

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  majorFromMinor,
  minorFromMajor,
  normalizeCurrency,
} from "../../utils/currency";
import {
  validateModifierGroup,
  type ModifierSelectionMode,
} from "./menuDepth";
import type {
  MenuModifierGroup,
  ModifierGroupSaveInput,
} from "../../hooks/useMenuModifiers";

interface OptionDraft {
  id?: string;
  /** Stable key for the render list — never sent to the server. */
  key: string;
  name: string;
  /** Major units as typed, e.g. "1.50" or "-3.00". */
  price: string;
}

export interface MenuModifierGroupEditorProps {
  menuItemId: string;
  /** Present → edit; absent → a new group. */
  group: MenuModifierGroup | null;
  currency: string;
  nextSortOrder: number;
  onSave: (input: ModifierGroupSaveInput) => void;
  saving: boolean;
  onDelete?: (groupId: string) => void;
  deleting?: boolean;
  onCancel: () => void;
  testID?: string;
}

let optionKeySeed = 0;
const nextOptionKey = (): string => `opt-${(optionKeySeed += 1)}`;

export function MenuModifierGroupEditor({
  menuItemId,
  group,
  currency,
  nextSortOrder,
  onSave,
  saving,
  onDelete,
  deleting = false,
  onCancel,
  testID,
}: MenuModifierGroupEditorProps): React.ReactElement {
  const code = normalizeCurrency(currency);
  const [name, setName] = useState<string>("");
  const [mode, setMode] = useState<ModifierSelectionMode>("single");
  const [required, setRequired] = useState<boolean>(true);
  const [maxSelect, setMaxSelect] = useState<string>("");
  const [options, setOptions] = useState<OptionDraft[]>([]);

  useEffect(() => {
    setName(group?.name ?? "");
    setMode(group?.selectionMode ?? "single");
    setRequired((group?.minSelect ?? 1) >= 1);
    setMaxSelect(
      group?.maxSelect === null || group?.maxSelect === undefined
        ? ""
        : String(group.maxSelect),
    );
    setOptions(
      (group?.modifiers ?? []).map((modifier) => ({
        id: modifier.id,
        key: nextOptionKey(),
        name: modifier.name,
        price:
          modifier.priceDeltaCents === 0
            ? ""
            : String(majorFromMinor(modifier.priceDeltaCents, code)),
      })),
    );
  }, [group, code]);

  const parsedMax =
    mode === "single"
      ? 1
      : maxSelect.trim().length === 0
        ? null
        : Number.parseInt(maxSelect.trim(), 10);
  const minSelect = required ? 1 : 0;
  const error = validateModifierGroup({
    name,
    selectionMode: mode,
    minSelect,
    maxSelect:
      parsedMax === null || Number.isNaN(parsedMax) ? null : parsedMax,
    optionCount: options.filter((o) => o.name.trim().length > 0).length,
  });

  const addOption = useCallback((): void => {
    setOptions((current) => [
      ...current,
      { key: nextOptionKey(), name: "", price: "" },
    ]);
  }, []);

  const removeOption = useCallback((key: string): void => {
    setOptions((current) => current.filter((o) => o.key !== key));
  }, []);

  const patchOption = useCallback(
    (key: string, patch: Partial<OptionDraft>): void => {
      setOptions((current) =>
        current.map((o) => (o.key === key ? { ...o, ...patch } : o)),
      );
    },
    [],
  );

  const handleSave = useCallback((): void => {
    if (error !== null || saving) return;
    onSave({
      id: group?.id,
      menuItemId,
      name: name.trim(),
      selectionMode: mode,
      minSelect,
      maxSelect:
        parsedMax === null || Number.isNaN(parsedMax) ? null : parsedMax,
      sortOrder: group?.sortOrder ?? nextSortOrder,
      currency: code,
      modifiers: options
        .filter((option) => option.name.trim().length > 0)
        .map((option, index) => {
          // `minorFromMajor` clamps negatives to 0 by design (it serves prices,
          // which cannot be negative). A modifier delta CAN be, so the sign is
          // carried separately and the magnitude converted.
          const typed = Number.parseFloat(option.price.replace(/,/g, ""));
          const magnitude = Number.isFinite(typed)
            ? minorFromMajor(Math.abs(typed), code)
            : 0;
          return {
            id: option.id,
            name: option.name.trim(),
            priceDeltaCents:
              Number.isFinite(typed) && typed < 0 ? -magnitude : magnitude,
            sortOrder: index,
          };
        }),
    });
  }, [
    error,
    saving,
    onSave,
    group,
    menuItemId,
    name,
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

      <Field label="What are you asking?">
        <Input
          value={name}
          onChangeText={setName}
          placeholder="e.g. How would you like it?"
          accessibilityLabel="Options group name"
          testID="modifier-group-name"
        />
      </Field>

      <View style={styles.modeRow}>
        <Button
          label="Pick one"
          onPress={() => setMode("single")}
          variant={mode === "single" ? "primary" : "secondary"}
          size="sm"
          testID="modifier-group-mode-single"
        />
        <Button
          label="Pick several"
          onPress={() => setMode("multi")}
          variant={mode === "multi" ? "primary" : "secondary"}
          size="sm"
          testID="modifier-group-mode-multi"
        />
        <Button
          label={required ? "Required" : "Optional"}
          onPress={() => setRequired((r) => !r)}
          variant={required ? "primary" : "secondary"}
          size="sm"
          testID="modifier-group-required"
        />
      </View>

      {mode === "multi" ? (
        <Field label="Most they can pick (leave blank for no limit)">
          <Input
            value={maxSelect}
            onChangeText={setMaxSelect}
            variant="number"
            placeholder="3"
            accessibilityLabel="Most options a guest can pick"
            testID="modifier-group-max"
          />
        </Field>
      ) : null}

      <Text style={styles.sectionLabel}>Options</Text>
      {options.map((option) => (
        <View key={option.key} style={styles.optionRow}>
          <View style={styles.optionName}>
            <Input
              value={option.name}
              onChangeText={(next) => patchOption(option.key, { name: next })}
              placeholder="e.g. Rare"
              accessibilityLabel="Option name"
              testID={`modifier-option-name-${option.key}`}
            />
          </View>
          <View style={styles.optionPrice}>
            <Input
              value={option.price}
              onChangeText={(next) => patchOption(option.key, { price: next })}
              variant="number"
              placeholder={`± ${code}`}
              accessibilityLabel={`Price change for this option in ${code}`}
              testID={`modifier-option-price-${option.key}`}
            />
          </View>
          <Pressable
            onPress={() => removeOption(option.key)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${option.name.trim().length > 0 ? option.name : "this option"}`}
            hitSlop={8}
            style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            testID={`modifier-option-remove-${option.key}`}
          >
            <Text style={styles.removeGlyph}>×</Text>
          </Pressable>
        </View>
      ))}
      <Text style={styles.hint}>
        Leave the price blank when an option costs the same. A smaller portion
        can cost less — type a minus.
      </Text>
      <Button
        label="Add an option"
        onPress={addOption}
        variant="secondary"
        size="sm"
        style={styles.addOption}
        testID="modifier-option-add"
      />

      {error !== null ? (
        <Text style={styles.error} testID="modifier-group-error">
          {error}
        </Text>
      ) : null}

      <Button
        label={group === null ? "Add group" : "Save group"}
        onPress={handleSave}
        variant="primary"
        size="md"
        fullWidth
        loading={saving}
        disabled={error !== null || saving}
        style={styles.save}
        testID="modifier-group-save"
      />
      <Button
        label="Cancel"
        onPress={onCancel}
        variant="ghost"
        size="sm"
        fullWidth
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
          disabled={deleting}
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
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
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
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  optionName: {
    flex: 2,
  },
  optionPrice: {
    flex: 1,
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
  save: {
    marginTop: spacing.sm,
  },
  delete: {
    marginTop: spacing.xs,
  },
});

export default MenuModifierGroupEditor;
