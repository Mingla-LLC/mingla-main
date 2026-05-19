/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeTypePickerSheet />.
 *
 * Per DESIGN_ORCH-0880 §3.4.G. Bottom sheet shown when planner taps "+ Add
 * question" in the schema-builder pane. Renders 7 type cards in a 2-col grid
 * (short_text/long_text, single_choice/multi_choice, date/number, file_upload
 * spanning both columns).
 *
 * Sheet primitive's `heightMode` does not exist — implementor maps DESIGN's
 * "compact" intent to a numeric content-fit snap point (~520pt — fits 7 cards
 * + header + handle without wasted bottom padding).
 *
 * Per `no-emoji-icons` rule: type icons map to existing Lucide-shaped icons
 * from the project's Icon.tsx set (closest visual analogues):
 *   short_text   → edit
 *   long_text    → list
 *   single_choice → target
 *   multi_choice → check
 *   date         → calendar
 *   number       → pound
 *   file_upload  → upload
 *
 * Composes Sheet + GlassCard + Icon + IntakeQuestionTypePill. No new primitives.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import type { IntakeQuestionType } from "../../services/intakeSchemaService";

export interface IntakeTypePickerSheetProps {
  visible: boolean;
  onSelect: (type: IntakeQuestionType) => void;
  onCancel: () => void;
  testID?: string;
}

interface TypeCard {
  type: IntakeQuestionType;
  label: string;
  description: string;
  icon: IconName;
  span?: 2;
}

const TYPE_CARDS: TypeCard[] = [
  { type: "short_text", label: "Short text", description: "One-line answer", icon: "edit" },
  { type: "long_text", label: "Long text", description: "Multi-line answer", icon: "list" },
  { type: "single_choice", label: "Choice", description: "Pick one option", icon: "target" },
  { type: "multi_choice", label: "Multi", description: "Pick many options", icon: "check" },
  { type: "date", label: "Date", description: "Calendar picker", icon: "calendar" },
  { type: "number", label: "Number", description: "Numeric input", icon: "pound" },
  { type: "file_upload", label: "File upload", description: "Images, PDFs, docs", icon: "upload", span: 2 },
];

// Compact-ish content-fit snap. 7 cards + header + handle + helper. Sheet
// clamps to [120, 95% screen] so this is safe on small viewports.
const TYPE_PICKER_SHEET_HEIGHT = 520;

export const IntakeTypePickerSheet: React.FC<IntakeTypePickerSheetProps> = ({
  visible,
  onSelect,
  onCancel,
  testID,
}) => {
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      snapPoint={TYPE_PICKER_SHEET_HEIGHT}
      testID={testID}
    >
      <View style={styles.container}>
        <Text style={styles.eyebrow} accessibilityRole="header">
          ADD QUESTION
        </Text>
        <Text style={styles.helper}>
          Choose what travelers need to provide.
        </Text>

        <View style={styles.grid}>
          {TYPE_CARDS.map((card) => (
            <Pressable
              key={card.type}
              accessibilityRole="button"
              accessibilityLabel={`Add ${card.label} question`}
              accessibilityHint={card.description}
              hitSlop={4}
              onPress={() => onSelect(card.type)}
              style={({ pressed }) => [
                styles.cellPress,
                card.span === 2 ? styles.cellFull : styles.cellHalf,
                pressed && styles.cellPressed,
              ]}
              testID={`intake-type-picker-${card.type}`}
            >
              <GlassCard variant="base" padding={spacing.md} radius="lg">
                <View style={styles.cardContent}>
                  <View style={styles.iconWrap}>
                    <Icon
                      name={card.icon}
                      size={20}
                      color={accent.warm}
                      strokeWidth={2}
                    />
                  </View>
                  <Text style={styles.label}>{card.label}</Text>
                  <Text style={styles.description} numberOfLines={1}>
                    {card.description}
                  </Text>
                </View>
              </GlassCard>
            </Pressable>
          ))}
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.xs,
  },
  eyebrow: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: accent.warm,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  cellPress: {
    minHeight: 88,
  },
  cellHalf: {
    flexBasis: "48%",
    flexGrow: 1,
  },
  cellFull: {
    flexBasis: "100%",
  },
  cellPressed: {
    opacity: 0.75,
  },
  cardContent: {
    minHeight: 72,
    gap: spacing.xxs,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  description: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
});

// Suppress unused-glass-import on platforms where lint flags unused imports.
void glass;

export default IntakeTypePickerSheet;
