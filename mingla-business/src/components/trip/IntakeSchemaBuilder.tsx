/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeSchemaBuilder />.
 *
 * Per DESIGN_ORCH-0880 §3.3. Planner-side question list editor for ONE tier's
 * intake schema. Drag-drop reorder via react-native-draggable-flatlist,
 * per-card tap → opens IntakeQuestionEditor sheet, 2-tap confirm on remove
 * + clear-all (mirror ORCH-0875 RefundPolicyEditor ClearPolicyControl).
 *
 * Live-commit pattern (mirror ORCH-0875 RefundPolicyEditor): every change to
 * the schema commits via onSchemaChange immediately — no draft-vs-value race.
 * Bumps schema_version_id on every commit so the persisted record snapshots
 * the new version + the re-answer trigger fires post-publish.
 *
 * Composes GlassCard + Icon + IntakeQuestionEditor + IntakeTypePickerSheet +
 * NestableDraggableFlatList. No new primitives.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  NestableDraggableFlatList,
  type RenderItemParams,
} from "react-native-draggable-flatlist";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import {
  bumpSchemaVersion,
  createEmptyIntakeSchema,
  type IntakeQuestion,
  type IntakeQuestionType,
  type IntakeSchema,
} from "../../services/intakeSchemaService";
import { IntakeQuestionEditor } from "./IntakeQuestionEditor";
import { IntakeTypePickerSheet } from "./IntakeTypePickerSheet";

export interface IntakeSchemaBuilderProps {
  /** Current schema for the active tier; null = no schema configured yet. */
  schema: IntakeSchema | null;
  activeTicketTypeId: string;
  activeTierName: string;
  /** Fires on every change (live-commit; no draft-vs-value race). */
  onSchemaChange: (next: IntakeSchema) => void;
  /** Fires when planner confirms clear-all → caller should clear or null-out. */
  onClearAll: () => void;
  disabled?: boolean;
  testID?: string;
}

const MAX_QUESTIONS = 20;

// ORCH-0884: gap between picker-close-trigger and editor-open-trigger.
// Sheet's internal UNMOUNT_DELAY_MS is 280ms; iOS UIKit dismiss takes
// additional frames. 500ms gives a safe buffer past both, preventing
// the sibling-Modal presentation race that left the editor invisible
// but mounted (intercepting touches) on operator's iPhone 17 Pro live
// fire. See handleTypePickerSelect for the full reasoning.
const EDITOR_OPEN_DELAY_MS = 500;

const TYPE_PILL_LABELS: Record<IntakeQuestionType, string> = {
  short_text: "SHORT TEXT",
  long_text: "LONG TEXT",
  single_choice: "CHOICE",
  multi_choice: "MULTI",
  date: "DATE",
  number: "NUMBER",
  file_upload: "FILE",
};

export const IntakeSchemaBuilder: React.FC<IntakeSchemaBuilderProps> = ({
  schema,
  activeTicketTypeId,
  activeTierName,
  onSchemaChange,
  onClearAll,
  disabled = false,
  testID,
}) => {
  // Editor sheet state.
  const [typePickerOpen, setTypePickerOpen] = useState<boolean>(false);
  const [editorState, setEditorState] = useState<
    | { visible: false }
    | { visible: true; question: IntakeQuestion | null; initialType?: IntakeQuestionType }
  >({ visible: false });

  // Per-row confirm-on-clear state. Map of question id → armed bool.
  const [removeArmed, setRemoveArmed] = useState<Record<string, boolean>>({});
  // Clear-all confirm state.
  const [clearAllArmed, setClearAllArmed] = useState<boolean>(false);

  const questions = schema?.questions ?? [];
  const questionCount = questions.length;

  // Suppress unused-warning for tier-scoping props that callers MUST provide
  // for correctness even though they don't render here directly (preview pane
  // shows the tier name). Reading them ensures the prop contract is honored.
  void activeTicketTypeId;
  void activeTierName;

  // Ensure the schema exists when the planner adds the first question.
  const ensureSchema = useCallback((): IntakeSchema => {
    return schema ?? createEmptyIntakeSchema();
  }, [schema]);

  // Open editor for new question of the picked type.
  //
  // ORCH-0884 [IntakeTypePickerSheet height + sibling-Modal race]: defer the
  // editor's mount+visible-true transition until after the picker's close
  // animation completes AND iOS UIKit's presentation queue drains. Picker
  // and Editor are sibling Sheets (NOT nested per
  // feedback_rn_sub_sheet_must_render_inside_parent.md). Each Sheet wraps a
  // native iOS Modal which calls UIViewController.present/dismiss. iOS
  // UIKit serializes these — calling present while a dismiss is in flight
  // queues or silently drops the new presentation. The Sheet's internal
  // UNMOUNT_DELAY_MS=280ms is when React unmounts the Modal, but iOS
  // native dismiss takes additional frames (~150-200ms) to complete.
  //
  // Initial Fix A used setTimeout(300ms). Operator live-fire on iPhone 17
  // Pro dev build proved 300ms insufficient: editor mounted in React but
  // not presented by iOS → invisible scrim intercepted next "+ Add
  // question" tap → app appeared frozen.
  //
  // Final fix: 500ms gap (well past iOS dismiss completion). The buffer
  // is invisible to users — they tap an option and see the editor open
  // half a second later, which feels like a normal sheet transition.
  const handleTypePickerSelect = useCallback(
    (type: IntakeQuestionType) => {
      setTypePickerOpen(false);
      setTimeout(() => {
        setEditorState({
          visible: true,
          question: null,
          initialType: type,
        });
      }, EDITOR_OPEN_DELAY_MS);
    },
    [],
  );

  // Open editor for an existing question.
  const handleQuestionTap = useCallback((q: IntakeQuestion) => {
    setEditorState({ visible: true, question: q });
  }, []);

  // Save question from editor (new or edited).
  const handleEditorSave = useCallback(
    (q: IntakeQuestion) => {
      const base = ensureSchema();
      const isNew = !base.questions.some((existing) => existing.id === q.id);
      let nextQuestions: IntakeQuestion[];
      if (isNew) {
        nextQuestions = [
          ...base.questions,
          { ...q, position: base.questions.length },
        ];
      } else {
        nextQuestions = base.questions.map((existing) =>
          existing.id === q.id ? { ...q, position: existing.position } : existing,
        );
      }
      onSchemaChange(
        bumpSchemaVersion({ ...base, questions: nextQuestions }),
      );
      setEditorState({ visible: false });
    },
    [ensureSchema, onSchemaChange],
  );

  const handleEditorCancel = useCallback(() => {
    setEditorState({ visible: false });
  }, []);

  // Drag-end reorder.
  const handleDragEnd = useCallback(
    (params: { data: IntakeQuestion[]; from: number; to: number }) => {
      if (schema === null) return;
      if (params.from === params.to) return;
      const reordered = params.data.map((q, idx) => ({ ...q, position: idx }));
      onSchemaChange(
        bumpSchemaVersion({ ...schema, questions: reordered }),
      );
    },
    [schema, onSchemaChange],
  );

  // 2-tap remove with auto-disarm if planner taps elsewhere.
  const handleRemoveTap = useCallback(
    (q: IntakeQuestion) => {
      if (schema === null) return;
      if (!removeArmed[q.id]) {
        setRemoveArmed({ [q.id]: true });
        return;
      }
      const next = schema.questions
        .filter((existing) => existing.id !== q.id)
        .map((existing, idx) => ({ ...existing, position: idx }));
      onSchemaChange(bumpSchemaVersion({ ...schema, questions: next }));
      setRemoveArmed({});
    },
    [schema, removeArmed, onSchemaChange],
  );

  const handleRemoveCancel = useCallback(() => {
    setRemoveArmed({});
  }, []);

  // 2-tap clear-all.
  const handleClearAllTap = useCallback(() => {
    if (!clearAllArmed) {
      setClearAllArmed(true);
      return;
    }
    onClearAll();
    setClearAllArmed(false);
  }, [clearAllArmed, onClearAll]);

  const handleClearAllCancel = useCallback(() => {
    setClearAllArmed(false);
  }, []);

  const canAdd = questionCount < MAX_QUESTIONS;

  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.eyebrow}>
        INTAKE QUESTIONS ({questionCount})
      </Text>

      {questionCount === 0 ? (
        <Text style={styles.emptyHint}>
          No questions yet. Tap "Add question" to ask travelers for the info
          you need.
        </Text>
      ) : (
        <NestableDraggableFlatList
          data={questions}
          keyExtractor={(item) => item.id}
          onDragEnd={handleDragEnd}
          activationDistance={8}
          renderItem={({
            item,
            drag,
            isActive,
          }: RenderItemParams<IntakeQuestion>) => {
            const armed = removeArmed[item.id] === true;
            // Card is split into 3 mutually-exclusive tap zones: drag handle
            // (long-press), centre body (tap → edit), remove button (tap →
            // arm/confirm). No nested Pressables — each zone is a sibling so
            // taps route cleanly to one handler.
            return (
              <View
                style={[
                  styles.questionRow,
                  isActive && styles.questionRowActive,
                ]}
              >
                <GlassCard variant="base" padding={spacing.md} radius="lg">
                  <View style={styles.questionRowInner}>
                    <Pressable
                      onLongPress={drag}
                      delayLongPress={150}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Drag to reorder question"
                      style={styles.dragHandle}
                      disabled={disabled}
                    >
                      <Text style={styles.dragHandleGlyph}>⋮⋮</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleQuestionTap(item)}
                      disabled={disabled || isActive}
                      style={({ pressed }) => [
                        styles.questionMain,
                        pressed && styles.questionMainPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit question: ${item.label || "Untitled question"}`}
                    >
                      <Text
                        style={styles.questionLabel}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {item.label || "Untitled question"}
                      </Text>
                      <View style={styles.questionMeta}>
                        <View style={styles.typePill}>
                          <Text style={styles.typePillLabel}>
                            {TYPE_PILL_LABELS[item.type]}
                          </Text>
                        </View>
                        {item.required ? (
                          <View style={styles.requiredPill}>
                            <Icon
                              name="check"
                              size={12}
                              color={accent.warm}
                              strokeWidth={3}
                            />
                            <Text style={styles.requiredPillLabel}>
                              Required
                            </Text>
                          </View>
                        ) : (
                          <Text style={styles.optionalText}>Optional</Text>
                        )}
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => handleRemoveTap(item)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={
                        armed
                          ? "Confirm remove question"
                          : "Remove question"
                      }
                      style={({ pressed }) => [
                        styles.removeBtn,
                        armed && styles.removeBtnArmed,
                        pressed && styles.removeBtnPressed,
                      ]}
                      disabled={disabled}
                    >
                      <Icon
                        name="close"
                        size={16}
                        color={
                          armed ? textTokens.primary : textTokens.tertiary
                        }
                        strokeWidth={2}
                      />
                    </Pressable>
                  </View>
                  {armed ? (
                    <View style={styles.confirmRow}>
                      <Text style={styles.confirmText}>
                        Remove this question?
                      </Text>
                      <View style={styles.confirmButtons}>
                        <Pressable
                          onPress={handleRemoveCancel}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel="Keep question"
                          style={({ pressed }) => [
                            styles.confirmKeep,
                            pressed && styles.confirmKeepPressed,
                          ]}
                        >
                          <Text style={styles.confirmKeepLabel}>Keep</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleRemoveTap(item)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel="Confirm remove question"
                          style={({ pressed }) => [
                            styles.confirmDestroy,
                            pressed && styles.confirmDestroyPressed,
                          ]}
                        >
                          <Text style={styles.confirmDestroyLabel}>
                            Yes, remove
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </GlassCard>
              </View>
            );
          }}
        />
      )}

      {/* Add-question CTA */}
      <Pressable
        onPress={() => setTypePickerOpen(true)}
        disabled={disabled || !canAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={
          canAdd ? "Add question" : `Maximum ${MAX_QUESTIONS} questions`
        }
        accessibilityState={{ disabled: !canAdd || disabled }}
        style={({ pressed }) => [
          styles.addBtn,
          (!canAdd || disabled) && styles.addBtnDisabled,
          pressed && canAdd && !disabled && styles.addBtnPressed,
        ]}
        testID="intake-builder-add-question"
      >
        <Icon
          name="plus"
          size={16}
          color={canAdd ? textTokens.primary : textTokens.quaternary}
          strokeWidth={2.5}
        />
        <Text
          style={[
            styles.addBtnLabel,
            (!canAdd || disabled) && styles.addBtnLabelDisabled,
          ]}
        >
          {canAdd ? "Add question" : `Maximum ${MAX_QUESTIONS} questions`}
        </Text>
      </Pressable>

      {/* Clear-all 2-tap confirm */}
      {questionCount > 0 ? (
        clearAllArmed ? (
          <View style={styles.clearAllConfirmRow}>
            <Text style={styles.clearAllConfirmText}>
              Clear all intake questions for this tier? Buyers won't be asked
              anything.
            </Text>
            <View style={styles.clearAllConfirmButtons}>
              <Pressable
                onPress={handleClearAllCancel}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Keep questions"
                style={({ pressed }) => [
                  styles.confirmKeep,
                  pressed && styles.confirmKeepPressed,
                ]}
              >
                <Text style={styles.confirmKeepLabel}>Keep</Text>
              </Pressable>
              <Pressable
                onPress={handleClearAllTap}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Confirm clear all questions"
                style={({ pressed }) => [
                  styles.confirmDestroy,
                  pressed && styles.confirmDestroyPressed,
                ]}
              >
                <Text style={styles.confirmDestroyLabel}>Yes, clear all</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={handleClearAllTap}
            disabled={disabled}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear all questions"
            style={({ pressed }) => [
              styles.clearAllLink,
              pressed && styles.clearAllLinkPressed,
            ]}
          >
            <Text style={styles.clearAllLinkLabel}>
              Clear all questions
            </Text>
          </Pressable>
        )
      ) : null}

      {/* Type picker sheet */}
      <IntakeTypePickerSheet
        visible={typePickerOpen}
        onSelect={handleTypePickerSelect}
        onCancel={() => setTypePickerOpen(false)}
        testID="intake-builder-type-picker"
      />

      {/* Editor sheet (rendered INSIDE this builder per
          feedback_rn_sub_sheet_must_render_inside_parent.md) */}
      {editorState.visible ? (
        <IntakeQuestionEditor
          question={editorState.question}
          initialType={editorState.initialType}
          visible={editorState.visible}
          onSave={handleEditorSave}
          onCancel={handleEditorCancel}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  eyebrow: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
    paddingVertical: spacing.md,
  },
  questionRow: {
    marginBottom: spacing.xs,
  },
  questionRowActive: {
    opacity: 0.92,
    transform: [{ scale: 1.02 }],
  },
  questionRowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  questionMainPressed: {
    opacity: 0.7,
  },
  dragHandle: {
    width: 24,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  dragHandleGlyph: {
    fontSize: 16,
    color: textTokens.tertiary,
    letterSpacing: -1,
    fontWeight: "700",
  },
  questionMain: {
    flex: 1,
    gap: spacing.xs,
  },
  questionLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  questionMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  typePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  typePillLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    letterSpacing: 0.8,
    color: textTokens.secondary,
  },
  requiredPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
  },
  requiredPillLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  optionalText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtnArmed: {
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: semantic.error,
  },
  removeBtnPressed: {
    opacity: 0.7,
  },
  confirmRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: semantic.error,
  },
  confirmText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  confirmKeep: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "transparent",
    minHeight: 36,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmKeepPressed: {
    opacity: 0.7,
  },
  confirmKeepLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  confirmDestroy: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.error,
    minHeight: 36,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDestroyPressed: {
    opacity: 0.85,
  },
  confirmDestroyLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: "transparent",
    minHeight: 44,
    marginTop: spacing.sm,
  },
  addBtnDisabled: {
    opacity: 0.4,
    borderColor: glass.border.profileBase,
  },
  addBtnPressed: {
    opacity: 0.7,
  },
  addBtnLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  addBtnLabelDisabled: {
    color: textTokens.quaternary,
  },
  clearAllLink: {
    paddingVertical: spacing.sm,
    alignSelf: "center",
    marginTop: spacing.xs,
  },
  clearAllLinkPressed: {
    opacity: 0.7,
  },
  clearAllLinkLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
  },
  clearAllConfirmRow: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.errorTint,
  },
  clearAllConfirmText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  clearAllConfirmButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
});

export default IntakeSchemaBuilder;
