/**
 * ORCH-1186-C — add/edit MENU CATEGORY sheet (a `menus` row).
 *
 * Mirrors VenueTableSheet's canonical Sheet + Field + Button pattern. Name
 * (required) + optional description. Delete (manager + edit mode) lives inside
 * the sheet behind a ConfirmDialog (honest cascade copy). DISPLAY-ONLY — no
 * ordering/cart/price-sum/checkout control here.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
// ORCH-1193 [sheet-cutoff]: body ScrollView via SmartScrollView wrapper so the
// CTA clears the keyboard + 42dp Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import type { Menu } from "../../services/menusService";

export interface MenuCategorySheetSaveInput {
  name: string;
  description: string | null;
}

export interface MenuCategorySheetProps {
  visible: boolean;
  onClose: () => void;
  /** Present → edit; absent → add. */
  category: Menu | null;
  onSave: (input: MenuCategorySheetSaveInput) => void;
  saving: boolean;
  /** Delete the category being edited (edit mode + manager). Omit to hide. */
  onDelete?: (id: string) => void;
  deleting?: boolean;
  canDelete?: boolean;
  testID?: string;
}

export function MenuCategorySheet({
  visible,
  onClose,
  category,
  onSave,
  saving,
  onDelete,
  deleting = false,
  canDelete = false,
  testID,
}: MenuCategorySheetProps): React.ReactElement {
  const isEdit = category !== null;
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!visible) {
      setConfirmDeleteOpen(false);
      return;
    }
    setName(category?.name ?? "");
    setDescription(category?.description ?? "");
  }, [visible, category]);

  const showDelete = isEdit && canDelete && onDelete !== undefined;
  const canSave = name.trim().length > 0 && !saving;
  const snap = useMemo<number>(() => 0.9, []);

  const handleSave = useCallback((): void => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      description: description.trim().length > 0 ? description.trim() : null,
    });
  }, [canSave, name, description, onSave]);

  const handleConfirmDelete = useCallback((): void => {
    if (category === null || onDelete === undefined) return;
    onDelete(category.id);
  }, [category, onDelete]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={snap}
      testID={testID ?? "menu-category-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>
          {isEdit ? "Edit category" : "Add category"}
        </Text>
        <ScrollView
          style={styles.scrollFlex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field label="Category name">
            <Input
              value={name}
              onChangeText={setName}
              placeholder="e.g. Starters, Drinks"
              accessibilityLabel="Category name"
              testID="menu-category-name"
            />
          </Field>
          <Field label="Description (optional)">
            <Input
              value={description}
              onChangeText={setDescription}
              placeholder="A short line guests see under the heading"
              accessibilityLabel="Category description"
              testID="menu-category-desc"
            />
          </Field>

          <Button
            label={isEdit ? "Save category" : "Add category"}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            style={styles.saveBtn}
            testID="menu-category-save"
          />

          {showDelete ? (
            <Button
              label="Delete category"
              onPress={() => setConfirmDeleteOpen(true)}
              variant="destructive"
              size="md"
              fullWidth
              disabled={deleting}
              loading={deleting}
              style={styles.deleteBtn}
              testID="menu-category-delete"
            />
          ) : null}
        </ScrollView>
      </View>

      {showDelete ? (
        <ConfirmDialog
          visible={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={handleConfirmDelete}
          title="Delete this category?"
          description={
            `“${category?.name ?? "This category"}” and all its items will be` +
            " removed from your menu and your public page. This can't be undone."
          }
          variant="simple"
          destructive
          confirmLabel="Delete"
          cancelLabel="Keep category"
          confirmLoading={deleting}
          confirmTestID="menu-category-delete-confirm"
          cancelTestID="menu-category-delete-cancel"
          testID="menu-category-delete-dialog"
        />
      ) : null}
    </Sheet>
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
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  heading: {
    ...typography.h3,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  // ORCH-1193: bound the scroll viewport to the fixed-height panel so the CTA
  // scrolls into view instead of overflowing past the panel's overflow:hidden.
  scrollFlex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  field: {
    gap: spacing.xxs,
    marginBottom: spacing.xs,
  },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
  deleteBtn: {
    marginTop: spacing.sm,
  },
});

export default MenuCategorySheet;
