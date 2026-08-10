/**
 * ORCH-1186-C — add/edit MENU ITEM sheet.
 *
 * Mirrors VenueTableSheet + the VenueSettingsModule currency-aware price input.
 * Name (required), description, price (optional, currency-aware), availability
 * toggle. Price uses majorFromMinor (hydrate) / minorFromMajor (commit) so it is
 * zero-decimal-currency safe; a BLANK price commits NULL ("price on request").
 * The currency is the brand default_currency (NO per-item currency picker, never
 * GBP-defaulted).
 *
 * SET-A, FOREVER (SPEC #1788 P-61): this is an AUTHORING form. Even though the
 * venue menu becomes an ordering surface under #1767, an authoring form never
 * becomes a buying form — no basket, no order control, no payment control here,
 * ever. Enforced by orch-1186c-menu-display-only.mjs SET-A.
 *
 * Issue #1789 (SPEC #1788 P-11, P-12) adds the depth an orderable dish needs:
 * a kitchen-note allowance, a prep station (the Phase-5 kiosk routing seam),
 * an opt-in food cost that is NEVER public, and the options groups. Options are
 * edited in a PANEL rendered inside this sheet — never a second Sheet stacked
 * over it (the shipped sub-sheet rule).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
// ORCH-1193 [sheet-cutoff]: body ScrollView via SmartScrollView wrapper so the
// CTA clears the keyboard + 42dp Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
import { ScrollView } from "../../wrappers/SmartScrollView";

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
  // ---- Issue #1789 (SPEC #1788 P-12) — menu depth.
  /** Whether a guest may attach a kitchen note to this line. */
  allowsNotes: boolean;
  /** Phase-5 kiosk routing seam. Nullable, never required. */
  prepStation: "kitchen" | "bar" | "other" | null;
  /** Opt-in food cost, minor units. NEVER exposed on the public menu. */
  costCents: number | null;
}

export interface MenuItemSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Present → edit; absent → add. */
  item: MenuItem | null;
  /** Brand default currency (3-letter ISO) — drives the price input + math. */
  currency: string;
  /**
   * #962 VM2 — whether the brand has an ESTABLISHED currency. False for a
   * pre-bank brand (brands.default_currency = NULL); the `currency` prop is a
   * normalized crash-guard value ("GBP") upstream, so this explicit signal is
   * what suppresses the currency code in the field label + a11y so a pre-bank
   * brand never SEES a fabricated £. The stored value + math are untouched.
   */
  brandHasCurrency: boolean;
  onSave: (input: MenuItemSheetSaveInput) => void;
  saving: boolean;
  onDelete?: (id: string) => void;
  deleting?: boolean;
  canDelete?: boolean;
  /**
   * Issue #1789 — the options-group builder, rendered INSIDE this sheet's body
   * by the parent module (which owns the modifier hooks). Absent for an unsaved
   * item: a group cannot reference an item id that does not exist yet.
   */
  optionsSection?: React.ReactNode;
  testID?: string;
}

export function MenuItemSheet({
  visible,
  onClose,
  item,
  currency,
  brandHasCurrency,
  onSave,
  saving,
  onDelete,
  deleting = false,
  canDelete = false,
  optionsSection,
  testID,
}: MenuItemSheetProps): React.ReactElement {
  const isEdit = item !== null;
  const code = normalizeCurrency(currency);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [priceDraft, setPriceDraft] = useState<string>("");
  const [isAvailable, setIsAvailable] = useState<boolean>(true);
  const [allowsNotes, setAllowsNotes] = useState<boolean>(true);
  const [prepStation, setPrepStation] = useState<
    "kitchen" | "bar" | "other" | null
  >(null);
  const [costDraft, setCostDraft] = useState<string>("");
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
    setAllowsNotes(item?.allowsNotes ?? true);
    setPrepStation(item?.prepStation ?? null);
    setCostDraft(
      item?.costCents != null && item.costCents >= 0
        ? String(majorFromMinor(item.costCents, code))
        : "",
    );
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

  // Same currency-aware parse as the price. Blank -> null (not yet costed).
  const costCents = useMemo<number | null>(() => {
    const trimmed = costDraft.replace(/,/g, "").trim();
    if (trimmed.length === 0) return null;
    const major = Number.parseFloat(trimmed);
    if (!Number.isFinite(major) || major < 0) return null;
    return minorFromMajor(major, code);
  }, [costDraft, code]);

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
      allowsNotes,
      prepStation,
      costCents,
    });
  }, [
    canSave,
    name,
    description,
    priceCents,
    isAvailable,
    allowsNotes,
    prepStation,
    costCents,
    onSave,
  ]);

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
          style={styles.scrollFlex}
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
          <Field label={`Price${brandHasCurrency ? ` (${code})` : ""}`}>
            <Input
              value={priceDraft}
              onChangeText={setPriceDraft}
              variant="number"
              placeholder="0.00"
              accessibilityLabel={`Item price${brandHasCurrency ? ` in ${code}` : ""}`}
              testID="menu-item-price"
            />
          </Field>
          <Text style={styles.helper}>
            Leave blank to show “Price on request”.
          </Text>

          {/*
            Issue #1789 (P-12) — the venue's own food cost. Opt-in, never
            public, and the ONLY honest input to a margin figure: until a venue
            fills it, menu quadrants are labelled BY PRICE and never called
            profit (SPEC #1788 P-58). Nothing on this screen computes a margin.
          */}
          <Field
            label={`What it costs you (optional${brandHasCurrency ? `, ${code}` : ""})`}
          >
            <Input
              value={costDraft}
              onChangeText={setCostDraft}
              variant="number"
              placeholder="0.00"
              accessibilityLabel={`What this item costs you${brandHasCurrency ? ` in ${code}` : ""}`}
              testID="menu-item-cost"
            />
          </Field>
          <Text style={styles.helper}>
            Only you ever see this. Guests never do.
          </Text>

          <Text style={styles.groupLabel}>Availability</Text>
          <ToggleRow
            label="Show this item to guests"
            value={isAvailable}
            onValueChange={setIsAvailable}
            testID="menu-item-available"
          />

          <Text style={styles.groupLabel}>Kitchen</Text>
          <ToggleRow
            label="Let guests add a note (no ice, extra hot)"
            value={allowsNotes}
            onValueChange={setAllowsNotes}
            testID="menu-item-allows-notes"
          />
          <Text style={styles.helper}>
            Notes are capped so a kitchen ticket stays readable.
          </Text>
          <Field label="Where it&apos;s made (optional)">
            <View style={styles.stationRow}>
              {STATION_CHOICES.map((choice) => (
                <Button
                  key={choice.label}
                  label={choice.label}
                  onPress={() =>
                    setPrepStation(
                      prepStation === choice.value ? null : choice.value,
                    )
                  }
                  variant={prepStation === choice.value ? "primary" : "secondary"}
                  size="sm"
                  testID={`menu-item-station-${choice.value ?? "none"}`}
                />
              ))}
            </View>
          </Field>

          {optionsSection !== undefined ? (
            <View testID="menu-item-options-section">{optionsSection}</View>
          ) : null}

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

const STATION_CHOICES: readonly {
  label: string;
  value: "kitchen" | "bar" | "other";
}[] = [
  { label: "Kitchen", value: "kitchen" },
  { label: "Bar", value: "bar" },
  { label: "Somewhere else", value: "other" },
];

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
  // ORCH-1193: bound the scroll viewport to the fixed-height panel so the CTA
  // scrolls into view instead of overflowing past the panel's overflow:hidden.
  scrollFlex: {
    flex: 1,
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
  stationRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
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
