/**
 * Wizard Step 1 — Basics.
 *
 * Designer source: screens-creator.jsx lines 82-104 (CreatorStep1).
 * PRD U.5.1 required fields surfaced here: name, description, category.
 * Format chip (in_person / online / hybrid) is also captured here so
 * Step 3 (Where) can branch its render without re-asking.
 *
 * Description field is added beyond the designer mock (designer omits it
 * but PRD U.5.1 requires it). Founder may iterate placement post-smoke
 * (W-CYCLE-3-DESC-PLACEMENT).
 *
 * Category sheet ships 8 placeholder values per spec §3.9 + dispatch
 * W-CYCLE-3-CATEGORY-LIST. Founder may override the list at smoke.
 *
 * Per Cycle 3 spec §3.9 Step 1.
 */

import React, { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { DraftEventFormat } from "../../store/draftEventStore";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";

import { errorForKey, type StepBodyProps } from "./types";

// [TRANSITIONAL] 8 placeholder categories — TRANS-CYCLE-3-6.
// Real categories taxonomy lands B-cycle when consumer-side filtering
// + admin-side categorization tooling come online together.
const CATEGORIES: readonly string[] = [
  "Nightlife",
  "Brunch",
  "Concert",
  "Festival",
  "Workshop",
  "Pop-up",
  "Private",
  "Other",
] as const;

const FORMAT_OPTIONS: ReadonlyArray<{ id: DraftEventFormat; label: string }> = [
  { id: "in_person", label: "In person" },
  { id: "online", label: "Online" },
  { id: "hybrid", label: "Hybrid" },
];

interface FormatPillProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

const FormatPill: React.FC<FormatPillProps> = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
    style={[styles.formatPill, active && styles.formatPillActive]}
  >
    <Text style={[styles.formatPillLabel, active && styles.formatPillLabelActive]}>
      {label}
    </Text>
  </Pressable>
);

export const CreatorStep1Basics: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
  scrollToBottom,
}) => {
  const [categorySheetVisible, setCategorySheetVisible] = useState<boolean>(false);

  const nameError = showErrors ? errorForKey(errors, "name") : undefined;
  const descError = showErrors ? errorForKey(errors, "description") : undefined;
  const categoryError = showErrors ? errorForKey(errors, "category") : undefined;

  const handleSelectFormat = useCallback(
    (format: DraftEventFormat): void => {
      updateDraft({ format });
    },
    [updateDraft],
  );

  const handleOpenCategorySheet = useCallback((): void => {
    setCategorySheetVisible(true);
  }, []);

  const handleSelectCategory = useCallback(
    (category: string): void => {
      updateDraft({ category });
      setCategorySheetVisible(false);
    },
    [updateDraft],
  );

  return (
    <View>
      {/* Event name */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Event name</Text>
        <Input
          value={draft.name}
          onChangeText={(v) => updateDraft({ name: v })}
          placeholder="e.g. Slow Burn vol. 4"
          variant="text"
          accessibilityLabel="Event name"
          style={nameError !== undefined ? styles.inputError : undefined}
        />
        {nameError !== undefined ? (
          <Text style={styles.helperError}>{nameError}</Text>
        ) : null}
      </View>

      {/* Format */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Format</Text>
        <View style={styles.formatRow}>
          {FORMAT_OPTIONS.map((opt) => (
            <FormatPill
              key={opt.id}
              label={opt.label}
              active={draft.format === opt.id}
              onPress={() => handleSelectFormat(opt.id)}
            />
          ))}
        </View>
      </View>

      {/* Category */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Category</Text>
        <Pressable
          onPress={handleOpenCategorySheet}
          accessibilityRole="button"
          accessibilityLabel={
            draft.category !== null ? `Category: ${draft.category}` : "Pick a category"
          }
          style={[
            styles.pickerRow,
            categoryError !== undefined && styles.inputError,
          ]}
        >
          <Text
            style={
              draft.category !== null
                ? styles.pickerValue
                : styles.pickerPlaceholder
            }
          >
            {draft.category ?? "Pick a category"}
          </Text>
          <Icon name="chevD" size={16} color={textTokens.tertiary} />
        </Pressable>
        {categoryError !== undefined ? (
          <Text style={styles.helperError}>{categoryError}</Text>
        ) : null}
      </View>

      {/* Description */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Description</Text>
        <View
          style={[
            styles.textareaWrap,
            descError !== undefined && styles.inputError,
          ]}
        >
          <TextInput
            value={draft.description}
            onChangeText={(v) => updateDraft({ description: v })}
            // Multiline TextInput on iOS doesn't trigger reliable
            // scroll-into-view from `automaticallyAdjustKeyboardInsets`,
            // so on focus we manually scroll the wizard to the bottom
            // (Description is the last field on Step 1).
            onFocus={scrollToBottom}
            placeholder="What's the vibe? Doors, dress code, sound system, who it's for…"
            placeholderTextColor={textTokens.quaternary}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            style={styles.textarea}
            accessibilityLabel="Event description"
          />
        </View>
        {descError !== undefined ? (
          <Text style={styles.helperError}>{descError}</Text>
        ) : null}
      </View>

      {/* Category sheet */}
      <Sheet
        visible={categorySheetVisible}
        onClose={() => setCategorySheetVisible(false)}
        snapPoint="half"
      >
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Pick a category</Text>
          {CATEGORIES.map((cat) => {
            const active = draft.category === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => handleSelectCategory(cat)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={cat}
                style={[styles.categoryRow, active && styles.categoryRowActive]}
              >
                <Text
                  style={[
                    styles.categoryRowLabel,
                    active && styles.categoryRowLabelActive,
                  ]}
                >
                  {cat}
                </Text>
                {active ? (
                  <Icon name="check" size={18} color={accent.warm} />
                ) : null}
              </Pressable>
            );
          })}
          <Text style={styles.sheetFooterCaption}>
            Real categories taxonomy lands B-cycle.
          </Text>
        </ScrollView>
      </Sheet>
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  inputError: {
    borderColor: semantic.error,
    borderWidth: 1,
  },
  formatRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  formatPill: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
  },
  formatPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  formatPillLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  formatPillLabelActive: {
    color: textTokens.primary,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  pickerValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  pickerPlaceholder: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.tertiary,
  },
  textareaWrap: {
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 110,
  },
  textarea: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    minHeight: 90,
    padding: 0,
  },

  // Sheet styles --------------------------------------------------------
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  sheetTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.md,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.xs,
  },
  categoryRowActive: {
    backgroundColor: accent.tint,
  },
  categoryRowLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  categoryRowLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  sheetFooterCaption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.md,
  },
});

// Suppress unused-import warning for GlassCard (not used in v1 but kept
// available for future variants). NB: tsc strict still requires an import
// to be used; remove if linter flags.
void GlassCard;
