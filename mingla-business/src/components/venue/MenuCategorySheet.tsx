/**
 * ORCH-1186-C — add/edit MENU CATEGORY sheet (a `menus` row).
 *
 * Mirrors VenueTableSheet's canonical Sheet + Field + Button pattern. Name
 * (required) + optional description + the #1789 SERVICE WINDOW.
 * Delete (manager + edit mode) lives inside the sheet behind a ConfirmDialog
 * (honest cascade copy).
 *
 * SET-A, FOREVER (SPEC #1788 P-61): this is an AUTHORING form. An authoring
 * form never becomes a buying form — no ordering / basket / quantity /
 * payment control here, ever, even though the menu itself becomes orderable
 * under #1767. Enforced by orch-1186c-menu-display-only.mjs SET-A.
 *
 * Issue #1789 (SPEC #1788 P-12): a category can carry a service window
 * (breakfast 07:00–11:00) and a day set. Both blank = always available, which
 * is exactly today's behaviour. An end BEFORE a start means the window wraps
 * past midnight — a late-night menu — and the UI says so out loud. The window
 * is evaluated in VENUE-LOCAL time SERVER-SIDE via the shipped #1403 timezone
 * ladder; this sheet never consults the device clock.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
// ORCH-1193 [sheet-cutoff]: body ScrollView via SmartScrollView wrapper so the
// CTA clears the keyboard + 42dp Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import type { Menu } from "../../services/menusService";
import {
  DAY_LABELS,
  normalizeTimeInput,
  serviceWindowSummary,
  validateServiceWindow,
} from "./menuDepth";

export interface MenuCategorySheetSaveInput {
  name: string;
  description: string | null;
  // Issue #1789 (SPEC #1788 P-12) — null/null = always available.
  serviceWindowStart: string | null;
  serviceWindowEnd: string | null;
  /** ISO day-of-week 1..7; null = every day. */
  serviceDays: number[] | null;
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
  const [windowStart, setWindowStart] = useState<string>("");
  const [windowEnd, setWindowEnd] = useState<string>("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!visible) {
      setConfirmDeleteOpen(false);
      return;
    }
    setName(category?.name ?? "");
    setDescription(category?.description ?? "");
    // Postgres returns `time` as "HH:MM:SS"; the field shows "HH:MM".
    setWindowStart(
      normalizeTimeInput(category?.serviceWindowStart ?? "") ?? "",
    );
    setWindowEnd(normalizeTimeInput(category?.serviceWindowEnd ?? "") ?? "");
    setDays(category?.serviceDays ?? [1, 2, 3, 4, 5, 6, 7]);
  }, [visible, category]);

  const showDelete = isEdit && canDelete && onDelete !== undefined;
  const windowDraft = useMemo(
    () => ({
      start: windowStart.trim().length > 0 ? windowStart.trim() : null,
      end: windowEnd.trim().length > 0 ? windowEnd.trim() : null,
      days: days.length === 7 ? null : days,
    }),
    [windowStart, windowEnd, days],
  );
  const windowError = useMemo(
    () => validateServiceWindow(windowDraft),
    [windowDraft],
  );
  const canSave = name.trim().length > 0 && windowError === null && !saving;
  const snap = useMemo<number>(() => 0.9, []);

  const toggleDay = useCallback((isoDay: number): void => {
    setDays((current) =>
      current.includes(isoDay)
        ? current.filter((d) => d !== isoDay)
        : [...current, isoDay].sort((a, b) => a - b),
    );
  }, []);

  const handleSave = useCallback((): void => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      description: description.trim().length > 0 ? description.trim() : null,
      serviceWindowStart:
        windowDraft.start === null ? null : normalizeTimeInput(windowDraft.start),
      serviceWindowEnd:
        windowDraft.end === null ? null : normalizeTimeInput(windowDraft.end),
      serviceDays: windowDraft.days,
    });
  }, [canSave, name, description, windowDraft, onSave]);

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

          {/* Issue #1789 (P-12) — service window. Blank = always available. */}
          <Text style={styles.groupLabel}>When it&apos;s served</Text>
          <View style={styles.windowRow}>
            <View style={styles.windowCol}>
              <Field label="From (24h)">
                <Input
                  value={windowStart}
                  onChangeText={setWindowStart}
                  placeholder="07:00"
                  accessibilityLabel="Service window start time"
                  testID="menu-category-window-start"
                />
              </Field>
            </View>
            <View style={styles.windowCol}>
              <Field label="Until (24h)">
                <Input
                  value={windowEnd}
                  onChangeText={setWindowEnd}
                  placeholder="11:00"
                  accessibilityLabel="Service window end time"
                  testID="menu-category-window-end"
                />
              </Field>
            </View>
          </View>
          <View style={styles.dayRow}>
            {DAY_LABELS.map((label, index) => {
              const isoDay = index + 1;
              const on = days.includes(isoDay);
              return (
                <Button
                  key={label}
                  label={label}
                  onPress={() => toggleDay(isoDay)}
                  variant={on ? "primary" : "secondary"}
                  size="sm"
                  style={styles.dayChip}
                  testID={`menu-category-day-${isoDay}`}
                />
              );
            })}
          </View>
          <Text style={styles.windowSummary}>
            {serviceWindowSummary(windowDraft)}
          </Text>
          {windowError !== null ? (
            <Text style={styles.windowError} testID="menu-category-window-error">
              {windowError}
            </Text>
          ) : null}

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
  groupLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  windowRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  windowCol: {
    flex: 1,
  },
  dayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  dayChip: {
    minWidth: 56,
  },
  windowSummary: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  windowError: {
    ...typography.bodySm,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
  saveBtn: {
    marginTop: spacing.lg,
  },
  deleteBtn: {
    marginTop: spacing.sm,
  },
});

export default MenuCategorySheet;
