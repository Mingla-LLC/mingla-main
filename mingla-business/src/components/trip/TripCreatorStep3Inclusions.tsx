/**
 * TripCreatorStep3Inclusions — Step 3 of TripCreatorWizard. Two parallel
 * lists: included / excluded. Add via input + per-row delete.
 *
 * Tr2 (ORCH-0859). Per SPEC §4.8 Step 3.
 */

import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export interface InclusionDraft {
  kind: "included" | "excluded";
  item: string;
  ordinal: number;
}

export interface TripCreatorStep3InclusionsProps {
  items: InclusionDraft[];
  onChange: (items: InclusionDraft[]) => void;
  disabled?: boolean;
  /**
   * ORCH-0876 — present when the operator is editing a published trip with
   * confirmed bookings. The server's refund-gate rejects inclusion removals
   * with `inclusions_removed_with_sales`; additions remain additive and the
   * parent surface owns the pre-flight UX rejection on Save.
   */
  editMode?: {
    totalConfirmedOrders: number;
  };
}

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

export const TripCreatorStep3Inclusions: React.FC<TripCreatorStep3InclusionsProps> = ({
  items,
  onChange,
  disabled,
}) => {
  const [includedDraft, setIncludedDraft] = useState<string>("");
  const [excludedDraft, setExcludedDraft] = useState<string>("");

  const included = items.filter((i) => i.kind === "included");
  const excluded = items.filter((i) => i.kind === "excluded");

  const addItem = (kind: "included" | "excluded", text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const sameKind = items.filter((i) => i.kind === kind);
    const nextOrdinal =
      sameKind.length === 0 ? 0 : Math.max(...sameKind.map((i) => i.ordinal)) + 1;
    onChange([...items, { kind, item: trimmed, ordinal: nextOrdinal }]);
    if (kind === "included") setIncludedDraft("");
    else setExcludedDraft("");
  };

  const deleteAt = (kind: "included" | "excluded", ordinal: number): void => {
    onChange(items.filter((i) => !(i.kind === kind && i.ordinal === ordinal)));
  };

  return (
    <ScrollView
      style={styles.host}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.helper}>
        What&rsquo;s included in the price, and what isn&rsquo;t.
      </Text>

      {/* Included list */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>What&rsquo;s included</Text>
        {included.length === 0 ? (
          <Text style={styles.emptyText}>None added yet.</Text>
        ) : (
          <View style={styles.itemsList}>
            {included.map((i) => (
              <View key={`inc-${i.ordinal}`} style={styles.itemRow}>
                <Icon name="check" size={14} color={accent.warm} />
                <Text style={styles.itemText}>{i.item}</Text>
                <Pressable
                  onPress={() => deleteAt("included", i.ordinal)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${i.item} from included`}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Icon name="trash" size={14} color={textTokens.tertiary} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={styles.addRow}>
          <TextInput
            value={includedDraft}
            onChangeText={setIncludedDraft}
            onSubmitEditing={() => addItem("included", includedDraft)}
            placeholder="e.g. Lodging, all meals, daily yoga"
            placeholderTextColor={textTokens.tertiary}
            editable={!disabled}
            accessibilityLabel="Add included item"
            style={styles.addInput}
            returnKeyType="done"
            testID="trip-step3-included-input"
          />
          <Pressable
            onPress={() => addItem("included", includedDraft)}
            disabled={disabled || includedDraft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Add this included item"
            accessibilityState={{
              disabled: disabled === true || includedDraft.trim().length === 0,
            }}
            style={[
              styles.addBtn,
              (disabled === true || includedDraft.trim().length === 0) &&
                styles.addBtnDisabled,
            ]}
            testID="trip-step3-included-add"
          >
            <Icon name="plus" size={16} color={accent.warm} />
          </Pressable>
        </View>
      </View>

      {/* Excluded list */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>What&rsquo;s NOT included</Text>
        {excluded.length === 0 ? (
          <Text style={styles.emptyText}>None added yet.</Text>
        ) : (
          <View style={styles.itemsList}>
            {excluded.map((i) => (
              <View key={`exc-${i.ordinal}`} style={styles.itemRow}>
                <Icon name="close" size={14} color={textTokens.tertiary} />
                <Text style={styles.itemText}>{i.item}</Text>
                <Pressable
                  onPress={() => deleteAt("excluded", i.ordinal)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${i.item} from excluded`}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Icon name="trash" size={14} color={textTokens.tertiary} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={styles.addRow}>
          <TextInput
            value={excludedDraft}
            onChangeText={setExcludedDraft}
            onSubmitEditing={() => addItem("excluded", excludedDraft)}
            placeholder="e.g. Flights, alcohol, optional excursions"
            placeholderTextColor={textTokens.tertiary}
            editable={!disabled}
            accessibilityLabel="Add excluded item"
            style={styles.addInput}
            returnKeyType="done"
            testID="trip-step3-excluded-input"
          />
          <Pressable
            onPress={() => addItem("excluded", excludedDraft)}
            disabled={disabled || excludedDraft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Add this excluded item"
            accessibilityState={{
              disabled: disabled === true || excludedDraft.trim().length === 0,
            }}
            style={[
              styles.addBtn,
              (disabled === true || excludedDraft.trim().length === 0) &&
                styles.addBtnDisabled,
            ]}
            testID="trip-step3-excluded-add"
          >
            <Icon name="plus" size={16} color={accent.warm} />
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: textTokens.secondary,
    textTransform: "uppercase",
  },
  emptyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  itemsList: {
    gap: spacing.xs,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  itemText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  deleteBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  addInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radiusTokens.md,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  addBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.4)",
  },
  addBtnDisabled: {
    opacity: 0.4,
  },
});

export default TripCreatorStep3Inclusions;
