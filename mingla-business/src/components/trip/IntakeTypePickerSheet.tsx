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
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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
// ORCH-0884 [IntakeTypePickerSheet height + sibling-Modal race]: bumped
// 520→640 to fit all 7 cards. The 520 snap measured short of the actual
// content height (~556pt: 4 rows × 110pt cards + 3 × 8pt gaps + ~50pt header
// + ~14pt drag handle + ~28pt Sheet body padding). On iPhone 17 Pro the
// 36pt overflow clipped the File upload card's bottom half off-screen,
// making the card unreachable. 640pt gives ~84pt of headroom over measured
// content. Sheet's internal clamp keeps it ≤ 95% screen so this is safe on
// small devices. Plus the grid is now wrapped in ScrollView for defense
// in depth: smaller screens (iPhone SE) still render every card via scroll
// when 640pt exceeds 95% screen.
const TYPE_PICKER_SHEET_HEIGHT = 640;

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

        <ScrollView
          style={styles.gridScroll}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
        </ScrollView>
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
  gridScroll: {
    // ORCH-0884: ScrollView wrapper for defense in depth on small devices.
    // flexShrink: 1 ensures the ScrollView respects the Sheet's body bounds
    // and scrolls overflow rather than competing for height.
    flexShrink: 1,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    // ORCH-0884: padding at bottom so the last card row never butts against
    // the Sheet's body padding when scrolled all the way down.
    paddingBottom: spacing.md,
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
