/**
 * ORCH-1186-C — add/edit MENU ITEM sheet.
 *
 * Mirrors VenueTableSheet + the VenueSettingsModule currency-aware price input.
 * Name (required), description, price (optional, currency-aware), availability
 * toggle. Price uses majorFromMinor (hydrate) / minorFromMajor (commit) so it is
 * zero-decimal-currency safe; a BLANK price commits NULL ("price on request").
 * The currency is the brand default_currency (NO per-item currency picker, never
 * GBP-defaulted). DISPLAY-ONLY — NO quantity/order/add-to-cart/checkout control.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import {
  majorFromMinor,
  minorFromMajor,
  normalizeCurrency,
} from "../../utils/currency";
import type { MenuItem } from "../../services/menusService";

export interface MenuItemSheetSaveInput {
  name: string;
  description: string | null;
  /** Minor units (cents/kobo); null = "price on request". */
  priceCents: number | null;
  isAvailable: boolean;
}

export interface MenuItemSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Present → edit; absent → add. */
  item: MenuItem | null;
  /** Brand default currency (3-letter ISO) — drives the price input + label. */
  currency: string;
  onSave: (input: MenuItemSheetSaveInput) => void;
  saving: boolean;
  onDelete?: (id: string) => void;
  deleting?: boolean;
  canDelete?: boolean;
  testID?: string;
}

export function MenuItemSheet({
  visible,
  onClose,
  item,
  currency,
  onSave,
  saving,
  onDelete,
  deleting = false,
  canDelete = false,
  testID,
}: MenuItemSheetProps): React.ReactElement {
  const isEdit = item !== null;
  const code = normalizeCurrency(currency);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [priceDraft, setPriceDraft] = useState<string>("");
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!visible) {
      setConfirmDeleteOpen(false);
      return;
    }
    setName(item?.name ?? "");
    setDescription(item?.description ?? "");
    // Hydrate the major-unit draft from stored minor cents (currency-aware).
    setPriceDraft(
      item?.priceCents != null && item.priceCents >= 0
        ? String(majorFromMinor(item.priceCents, code))
        : "",
    );
    setIsAvailable(item?.isAvailable ?? true);
  }, [visible, item, code]);

  // Parse the draft → integer cents (currency-aware; zero-decimal safe). A
  // blank / non-numeric draft → null ("price on request"). Negative → null.
  const priceCents = useMemo<number | null>(() => {
    const trimmed = priceDraft.replace(/,/g, "").trim();
    if (trimmed.length === 0) return null;
    const major = Number.parseFloat(trimmed);
    if (!Number.isFinite(major) || major < 0) return null;
    return minorFromMajor(major, code);
  }, [priceDraft, code]);

  const showDelete = isEdit && canDelete && onDelete !== undefined;
  const canSave = name.trim().length > 0 && !saving;
  const snap = useMemo<number>(() => 0.9, []);

  const handleSave = useCallback((): void => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      description: description.trim().length > 0 ? description.trim() : null,
      priceCents,
      isAvailable,
    });
  }, [canSave, name, description, priceCents, isAvailable, onSave]);

  const handleConfirmDelete = useCallback((): void => {
    if (item === null || onDelete === undefined) return;
    onDelete(item.id);
  }, [item, onDelete]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={snap}
      testID={testID ?? "menu-item-sheet"}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>{isEdit ? "Edit item" : "Add item"}</Text>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.groupLabel}>Item</Text>
          <Field label="Item name">
            <Input
              value={name}
              onChangeText={setName}
              placeholder="e.g. Margherita"
              accessibilityLabel="Item name"
              testID="menu-item-name"
            />
          </Field>
          <Field label="Description (optional)">
            <Input
              value={description}
              onChangeText={setDescription}
              placeholder="What's in it"
              accessibilityLabel="Item description"
              testID="menu-item-desc"
            />
          </Field>

          <Text style={styles.groupLabel}>Price</Text>
          <Field label={`Price (${code})`}>
            <Input
              value={priceDraft}
              onChangeText={setPriceDraft}
              variant="number"
              placeholder="0.00"
              accessibilityLabel={`Item price in ${code}`}
              testID="menu-item-price"
            />
          </Field>
          <Text style={styles.helper}>
            Leave blank to show “Price on request”.
          </Text>

          <Text style={styles.groupLabel}>Availability</Text>
          <ToggleRow
            label="Show this item to guests"
            value={isAvailable}
            onValueChange={setIsAvailable}
            testID="menu-item-available"
          />

          <Button
            label={isEdit ? "Save item" : "Add item"}
            onPress={handleSave}
            variant="primary"
            size="lg"
            fullWidth
            loading={saving}
            disabled={!canSave}
            style={styles.saveBtn}
            testID="menu-item-save"
          />

          {showDelete ? (
            <Button
              label="Delete item"
              onPress={() => setConfirmDeleteOpen(true)}
              variant="destructive"
              size="md"
              fullWidth
              disabled={deleting}
              loading={deleting}
              style={styles.deleteBtn}
              testID="menu-item-delete"
            />
          ) : null}
        </ScrollView>
      </View>

      {showDelete ? (
        <ConfirmDialog
          visible={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={handleConfirmDelete}
          title="Delete this item?"
          description={
            `“${item?.name ?? "This item"}” will be removed from your menu and` +
            " your public page. This can't be undone."
          }
          variant="simple"
          destructive
          confirmLabel="Delete"
          cancelLabel="Keep item"
          confirmLoading={deleting}
          confirmTestID="menu-item-delete-confirm"
          cancelTestID="menu-item-delete-cancel"
          testID="menu-item-delete-dialog"
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

interface ToggleRowProps {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  testID: string;
}

function ToggleRow({
  label,
  value,
  onValueChange,
  testID,
}: ToggleRowProps): React.ReactElement {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <BrandSwitch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        testID={testID}
      />
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
  scroll: {
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  groupLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xxs,
  },
  field: {
    gap: spacing.xxs,
    marginBottom: spacing.xs,
  },
  fieldLabel: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  helper: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  toggleLabel: {
    ...typography.body,
    color: textTokens.primary,
    flex: 1,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
  deleteBtn: {
    marginTop: spacing.sm,
  },
});

export default MenuItemSheet;
