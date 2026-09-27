/**
 * Issue #1789 (#1767 Phase 1) — the "Options" section of the item sheet
 * (SPEC #1788 P-11, P-11a; DESIGN D-6).
 *
 * Lists an item's modifier groups and hands the editor panel the one group the
 * operator is working on. It renders INSIDE MenuItemSheet's body — never as a
 * second Sheet stacked over it (the shipped sub-sheet rule).
 *
 * It exists as its own component so `MenuItemSheet.tsx` — a SET-A
 * display-only-forever file — stays a plain form and never grows data hooks.
 *
 * Groups can only be attached to a SAVED item: a group carries a real
 * `menu_item_id` FK, so there is nothing to point at until the dish exists.
 * The section says that out loud instead of rendering a dead control.
 */

import React, { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import {
  useDeleteModifierGroup,
  useMenuModifierGroups,
  useSaveModifierGroup,
  type MenuModifierGroup,
} from "../../hooks/useMenuModifiers";
import { modifierGroupSummary } from "./menuDepth";
import { MenuModifierGroupEditor } from "./MenuModifierGroupEditor";

export interface MenuItemOptionsSectionProps {
  brandId: string | null;
  /** Null while the item is unsaved — groups need a real item id. */
  menuItemId: string | null;
  currency: string;
  canMutate: boolean;
  onSavingChange?: (saving: boolean) => void;
  testID?: string;
}

export function MenuItemOptionsSection({
  brandId,
  menuItemId,
  currency,
  canMutate,
  onSavingChange,
  testID,
}: MenuItemOptionsSectionProps): React.ReactElement {
  const groupsQuery = useMenuModifierGroups(brandId, menuItemId);
  const saveGroup = useSaveModifierGroup(brandId);
  const deleteGroup = useDeleteModifierGroup(brandId);

  const [editing, setEditing] = useState<MenuModifierGroup | null>(null);
  const [creating, setCreating] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const groups = groupsQuery.data ?? [];

  useEffect(() => {
    onSavingChange?.(saveGroup.isPending);
    return (): void => onSavingChange?.(false);
  }, [onSavingChange, saveGroup.isPending]);

  const closeEditor = useCallback((): void => {
    if (saveGroup.isPending) return;
    setEditing(null);
    setCreating(false);
  }, [saveGroup.isPending]);

  const handleSave = useCallback(
    (input: Parameters<typeof saveGroup.mutate>[0]): void => {
      if (saveGroup.isPending) return;
      setSaveError(null);
      setSuccessMessage(null);
      saveGroup.mutate(input, {
        onSuccess: (savedGroup) => {
          setEditing(null);
          setCreating(false);
          const count = savedGroup.modifiers.length;
          const announcement = `${savedGroup.name} saved with ${count} ${count === 1 ? "option" : "options"}.`;
          setSuccessMessage(announcement);
          AccessibilityInfo.announceForAccessibility(announcement);
        },
        onError: (error) => setSaveError(modifierGroupSaveError(error)),
      });
    },
    [saveGroup, closeEditor],
  );

  const handleDelete = useCallback(
    (groupId: string): void => {
      if (menuItemId === null) return;
      if (saveGroup.isPending || deleteGroup.isPending) return;
      setDeleteError(false);
      deleteGroup.mutate(
        { groupId, menuItemId },
        { onSuccess: closeEditor, onError: () => setDeleteError(true) },
      );
    },
    [deleteGroup, menuItemId, closeEditor, saveGroup.isPending],
  );

  if (menuItemId === null) {
    return (
      <View style={styles.host} testID={testID ?? "menu-item-options-empty"}>
        <Text style={styles.groupLabel}>Options</Text>
        <Text style={styles.helper}>
          Save the item first, then add choices like “How would you like it?”
          or “Extras”.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host} testID={testID ?? "menu-item-options"}>
      <Text style={styles.groupLabel}>Options</Text>

      {deleteError ? (
        <Text style={styles.error} testID="menu-item-options-error">
          Couldn&apos;t save. Check your connection and try again.
        </Text>
      ) : null}

      {successMessage !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
          {successMessage}
        </Text>
      ) : null}

      {groupsQuery.isLoading ? (
        <Text style={styles.helper} accessibilityLiveRegion="polite">
          Loading options…
        </Text>
      ) : groups.length === 0 && !creating ? (
        <Text style={styles.helper}>
          No choices yet. Add one so guests can say how they want it.
        </Text>
      ) : null}

      {groups.map((group) =>
        editing?.id === group.id ? (
          <MenuModifierGroupEditor
            key={group.id}
            menuItemId={menuItemId}
            group={group}
            currency={currency}
            nextSortOrder={group.sortOrder}
            onSave={handleSave}
            saving={saveGroup.isPending}
            saveError={saveError}
            onDelete={canMutate ? handleDelete : undefined}
            deleting={deleteGroup.isPending}
            onCancel={closeEditor}
          />
        ) : (
          <Pressable
            key={group.id}
            onPress={() => {
              if (saveGroup.isPending) return;
              setSaveError(null);
              setSuccessMessage(null);
              setCreating(false);
              setEditing(group);
            }}
            disabled={!canMutate || saveGroup.isPending}
            accessibilityRole="button"
            accessibilityLabel={`Edit the ${group.name} options`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`menu-item-option-group-${group.id}`}
          >
            <Text style={styles.rowTitle} numberOfLines={1}>
              {group.name}
            </Text>
            <Text style={styles.rowMeta}>
              {modifierGroupSummary({
                selectionMode: group.selectionMode,
                minSelect: group.minSelect,
                maxSelect: group.maxSelect,
                optionCount: group.modifiers.length,
              })}
            </Text>
          </Pressable>
        ),
      )}

      {creating ? (
        <MenuModifierGroupEditor
          menuItemId={menuItemId}
          group={null}
          currency={currency}
          nextSortOrder={groups.length}
          onSave={handleSave}
          saving={saveGroup.isPending}
          saveError={saveError}
          onCancel={closeEditor}
        />
      ) : canMutate && editing === null ? (
        <Button
          label="Add a choice"
          onPress={() => {
            if (saveGroup.isPending) return;
            setSaveError(null);
            setSuccessMessage(null);
            setCreating(true);
          }}
          variant="secondary"
          size="sm"
          style={styles.add}
          testID="menu-item-options-add"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.xxs,
    marginTop: spacing.sm,
  },
  groupLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  helper: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  error: {
    ...typography.bodySm,
    color: semantic.error,
  },
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  row: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  rowTitle: {
    ...typography.body,
    color: textTokens.primary,
  },
  rowMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  pressed: {
    opacity: 0.6,
  },
  add: {
    alignSelf: "flex-start",
    marginTop: spacing.xxs,
  },
});

export default MenuItemOptionsSection;

function modifierGroupSaveError(error: Error): string {
  const code = (error as Error & { code?: string }).code ?? "";
  const message = error.message.toLowerCase();
  if (
    code === "42501" ||
    message.includes("permission") ||
    message.includes("not authorized") ||
    message.includes("row-level security")
  ) {
    return "You cannot save this group with this account. Your changes are still here.";
  }
  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("offline")
  ) {
    return "You are offline. Reconnect, then try again. Your changes are still here.";
  }
  return "We could not save this group. Your changes are still here — try again.";
}
