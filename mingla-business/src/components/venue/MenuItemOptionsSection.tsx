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

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
  testID?: string;
}

export function MenuItemOptionsSection({
  brandId,
  menuItemId,
  currency,
  canMutate,
  testID,
}: MenuItemOptionsSectionProps): React.ReactElement {
  const groupsQuery = useMenuModifierGroups(brandId, menuItemId);
  const saveGroup = useSaveModifierGroup(brandId);
  const deleteGroup = useDeleteModifierGroup(brandId);

  const [editing, setEditing] = useState<MenuModifierGroup | null>(null);
  const [creating, setCreating] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  const groups = groupsQuery.data ?? [];

  const closeEditor = useCallback((): void => {
    setEditing(null);
    setCreating(false);
  }, []);

  const handleSave = useCallback(
    (input: Parameters<typeof saveGroup.mutate>[0]): void => {
      setError(false);
      saveGroup.mutate(input, {
        onSuccess: closeEditor,
        onError: () => setError(true),
      });
    },
    [saveGroup, closeEditor],
  );

  const handleDelete = useCallback(
    (groupId: string): void => {
      if (menuItemId === null) return;
      setError(false);
      deleteGroup.mutate(
        { groupId, menuItemId },
        { onSuccess: closeEditor, onError: () => setError(true) },
      );
    },
    [deleteGroup, menuItemId, closeEditor],
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

      {error ? (
        <Text style={styles.error} testID="menu-item-options-error">
          Couldn&apos;t save. Check your connection and try again.
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
            onDelete={canMutate ? handleDelete : undefined}
            deleting={deleteGroup.isPending}
            onCancel={closeEditor}
          />
        ) : (
          <Pressable
            key={group.id}
            onPress={() => {
              setCreating(false);
              setEditing(group);
            }}
            disabled={!canMutate}
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
          onCancel={closeEditor}
        />
      ) : canMutate && editing === null ? (
        <Button
          label="Add a choice"
          onPress={() => setCreating(true)}
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
