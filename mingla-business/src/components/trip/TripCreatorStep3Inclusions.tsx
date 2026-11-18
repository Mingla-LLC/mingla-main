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

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { TripGuideEditor } from "./TripGuideEditor";

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
  /**
   * Issue #2829 W4 — the trip's id. When present, the "Before you go" trip
   * guide editor (highlights, what to prepare, FAQs…) shows under the lists.
   */
  eventId?: string;
  onShowToast?: (message: string) => void;
}

const INPUT_BORDER = color.lineStrong;
const INPUT_BG = color.fill.inset;

export const TripCreatorStep3Inclusions: React.FC<TripCreatorStep3InclusionsProps> = ({
  items,
  onChange,
  disabled,
  eventId,
  onShowToast,
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
    <View style={styles.host}>
      {/* Included list */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>What&rsquo;s included</Text>
        {included.length === 0 ? (
          <Text style={styles.emptyText}>None added yet.</Text>
        ) : (
          <View style={styles.itemsList}>
            {included.map((i) => (
              <View key={`inc-${i.ordinal}`} style={styles.itemRow}>
                <Icon name="check" size={14} color={color.accent} />
                <Text style={styles.itemText}>{i.item}</Text>
                <Pressable
                  onPress={() => deleteAt("included", i.ordinal)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${i.item} from included`}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Icon name="trash" size={14} color={color.text3} />
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
            placeholderTextColor={color.text3}
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
            <Icon name="plus" size={16} color={color.accent} />
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
                <Icon name="close" size={14} color={color.text3} />
                <Text style={styles.itemText}>{i.item}</Text>
                <Pressable
                  onPress={() => deleteAt("excluded", i.ordinal)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${i.item} from excluded`}
                  hitSlop={8}
                  style={styles.deleteBtn}
                >
                  <Icon name="trash" size={14} color={color.text3} />
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
            placeholderTextColor={color.text3}
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
            <Icon name="plus" size={16} color={color.accent} />
          </Pressable>
        </View>
      </View>
      {eventId !== undefined ? (
        <TripGuideEditor
          eventId={eventId}
          disabled={disabled}
          onShowToast={onShowToast}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingTop: space[2],
    paddingBottom: space[6],
    gap: space[6],
  },
  section: {
    gap: space[2],
  },
  sectionLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: color.text2,
    textTransform: "uppercase",
  },
  emptyText: {
    fontSize: type.small.fontSize,
    color: color.text3,
    fontStyle: "italic",
  },
  itemsList: {
    gap: space[1],
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingVertical: space[1],
  },
  itemText: {
    flex: 1,
    fontSize: type.body.fontSize,
    color: color.text1,
  },
  deleteBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  addRow: {
    flexDirection: "row",
    gap: space[1],
  },
  addInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: color.text1,
    fontSize: type.body.fontSize,
  },
  addBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    backgroundColor: color.accentTint,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  addBtnDisabled: {
    opacity: 0.4,
  },
});

export default TripCreatorStep3Inclusions;
