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
// ORCH-0884 follow-up #2: switched from NestableDraggableFlatList to
// standalone DraggableFlatList. The wizard wraps Step 6 in a plain
// ScrollView (TripCreatorWizard.tsx:898) which is NOT a
// NestableScrollContainer, so NestableDraggableFlatList crashes here
// with `useSafeNestableScrollContainerContext must be called within a
// NestableScrollContainerContext.Provider`. Standalone DraggableFlatList
// has no Provider dependency. List is bounded at MAX_QUESTIONS=20, so
// virtualization overhead inside the outer ScrollView is negligible.
import DraggableFlatList, {
  type RenderItemParams,
} from "react-native-draggable-flatlist";

import {
  radius,
  color,
  space,
  type as typeToken,
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
// #4514 — brand form additions to this ONE builder. The trip questions step
// passes no `features` and keeps today's behaviour.
import { IntakeQuestionBrandTags } from "./IntakeQuestionBrandTags";
import { TRIP_INTAKE_FEATURES, type IntakeBuilderFeatures } from "./intakeBuilderFeatures";
import {
  conditionSources as conditionSourcesFor,
  dependentNumbers as dependentNumbersFor,
  doorQuestionCount,
  moveQuestion,
  sanitizeShowIf,
} from "../../utils/brandFormDefinition";
import { FORMS_COPY } from "../forms/brandFormsCopy";

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
  /** #4514 — extras for brand forms. Omitted: today's trip builder. */
  features?: IntakeBuilderFeatures;
  /** The first-use door warning has been dismissed on this form. */
  doorNoticeAcked?: boolean;
  onDoorNoticeAck?: () => void;
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
  features = TRIP_INTAKE_FEATURES,
  doorNoticeAcked,
  onDoorNoticeAck,
}) => {
  const [notice, setNotice] = useState<string | null>(null);
  const [localDoorAck, setLocalDoorAck] = useState<boolean>(false);
  const doorAck = doorNoticeAcked ?? localDoorAck;
  const handleDoorAck = useCallback(() => {
    setLocalDoorAck(true);
    onDoorNoticeAck?.();
  }, [onDoorNoticeAck]);
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
      // #4514 — a changed question may end a "Show only if" that used it.
      const settled = features.conditions
        ? sanitizeShowIf(nextQuestions)
        : { questions: nextQuestions, cleared: [] as number[] };
      setNotice(
        settled.cleared.length > 0 ? FORMS_COPY.conditionCleared(settled.cleared) : null,
      );
      onSchemaChange(
        bumpSchemaVersion({ ...base, questions: settled.questions }),
      );
      setEditorState({ visible: false });
    },
    [ensureSchema, onSchemaChange, features.conditions],
  );

  const handleEditorCancel = useCallback(() => {
    setEditorState({ visible: false });
  }, []);

  // Drag-end reorder.
  const handleDragEnd = useCallback(
    (params: { data: IntakeQuestion[]; from: number; to: number }) => {
      if (schema === null) return;
      if (params.from === params.to) return;
      // #4514 — a dependent question cannot move above its source.
      if (features.conditions) {
        const result = moveQuestion(schema.questions, params.from, params.to);
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        setNotice(null);
        onSchemaChange(bumpSchemaVersion({ ...schema, questions: result.questions }));
        return;
      }
      const reordered = params.data.map((q, idx) => ({ ...q, position: idx }));
      onSchemaChange(
        bumpSchemaVersion({ ...schema, questions: reordered }),
      );
    },
    [schema, onSchemaChange, features.conditions],
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
      const settled = features.conditions
        ? sanitizeShowIf(next)
        : { questions: next, cleared: [] as number[] };
      setNotice(
        settled.cleared.length > 0 ? FORMS_COPY.conditionCleared(settled.cleared) : null,
      );
      onSchemaChange(bumpSchemaVersion({ ...schema, questions: settled.questions }));
      setRemoveArmed({});
    },
    [schema, removeArmed, onSchemaChange, features.conditions],
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

  // #4514 — what the question editor needs to know about the rest of the form.
  const editingQuestion = editorState.visible ? editorState.question : null;
  const editingIndex =
    editingQuestion !== null
      ? questions.findIndex((q) => q.id === editingQuestion.id)
      : -1;
  const editorSources = features.conditions
    ? conditionSourcesFor(questions, editingIndex >= 0 ? editingIndex : null)
    : [];
  const editorDependents =
    features.conditions && editingQuestion !== null
      ? dependentNumbersFor(questions, editingQuestion.id)
      : [];

  return (
    <View style={styles.container} testID={testID}>
      {/* ORCH-0949 — upfront-clarity banner. Intake is the ONE moment the
          planner collects info from each traveler; buyers fill it BEFORE
          paying, once per ticket. Makes the contract explicit at build time
          so planners don't ship incomplete schemas thinking they can "ask
          later" (they can't — schema_version_id bumps re-trigger fills, but
          the planner cannot re-prompt paid travelers out-of-band). */}
      {features.showUpfrontBanner ? (
      <View style={styles.upfrontBanner} testID="intake-upfront-banner">
        <Text style={styles.upfrontBannerTitle}>
          Ask EVERYTHING you need upfront
        </Text>
        <Text style={styles.upfrontBannerBody}>
          This is the only moment you'll collect info from each traveler. They
          fill it in BEFORE paying, once per ticket. Include everything you
          need — full names, DOB, dietary, passport, emergency contacts. You
          can't ask again after they've paid.
        </Text>
      </View>
      ) : null}

      <Text style={styles.eyebrow}>
        {features.variant === "brand_form"
          ? FORMS_COPY.questionCount(questionCount).toUpperCase()
          : `INTAKE QUESTIONS (${questionCount})`}
      </Text>

      {questionCount === 0 ? (
        features.variant === "brand_form" ? (
          <View style={styles.emptyHintBlock}>
            <Text style={styles.emptyHintTitle}>{FORMS_COPY.noQuestionsTitle}</Text>
            <Text style={styles.emptyHint}>{FORMS_COPY.noQuestionsBody}</Text>
          </View>
        ) : (
        <Text style={styles.emptyHint}>
          No questions yet. Tap "Add question" to ask travelers for the info
          you need.
        </Text>
        )
      ) : (
        <DraggableFlatList
          data={questions}
          keyExtractor={(item) => item.id}
          onDragEnd={handleDragEnd}
          activationDistance={8}
          scrollEnabled={false}
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
                <GlassCard variant="base" padding={space[4]} radius="lg">
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
                              color={color.accent}
                              strokeWidth={3}
                            />
                            <Text style={styles.requiredPillLabel}>
                              Required
                            </Text>
                          </View>
                        ) : (
                          <Text style={styles.optionalText}>Optional</Text>
                        )}
                        {features.door || features.conditions ? (
                          <IntakeQuestionBrandTags question={item} questions={questions} />
                        ) : null}
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
                          armed ? color.text1 : color.text3
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

      {notice !== null ? (
        <Text style={styles.noticeText} accessibilityLiveRegion="polite" testID="intake-builder-notice">
          {notice}
        </Text>
      ) : null}

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
          color={canAdd ? color.text1 : color.text4}
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

      {/* Clear-all 2-tap confirm (trip questions only) */}
      {questionCount > 0 && features.variant !== "brand_form" ? (
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
        fileUploadLater={features.fileUploadLater}
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
          features={features}
          otherDoorCount={doorQuestionCount(questions, editingQuestion?.id)}
          conditionSources={editorSources}
          dependentNumbers={editorDependents}
          questionNumber={editingIndex >= 0 ? editingIndex + 1 : null}
          doorNoticeAcked={doorAck}
          onDoorNoticeAck={handleDoorAck}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  // ORCH-0949 — upfront-clarity banner styles.
  upfrontBanner: {
    backgroundColor: color.fill.inset,
    borderColor: color.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: "hidden",
    paddingVertical: space[2] + 2,
    paddingHorizontal: space[4],
    marginBottom: space[2],
    gap: space[1],
  },
  upfrontBannerTitle: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },
  upfrontBannerBody: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.text2,
  },
  eyebrow: {
    fontSize: typeToken.label.fontSize,
    lineHeight: typeToken.label.lineHeight,
    fontWeight: typeToken.label.fontWeight,
    letterSpacing: typeToken.label.letterSpacing,
    textTransform: "uppercase",
    color: color.accent,
    marginBottom: space[1],
  },
  emptyHintBlock: {
    gap: space[1],
    paddingVertical: space[4],
  },
  emptyHintTitle: {
    fontSize: typeToken.body.fontSize,
    lineHeight: typeToken.body.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  noticeText: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.warning,
    paddingVertical: space[1],
  },
  emptyHint: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.text3,
    paddingVertical: space[4],
  },
  questionRow: {
    marginBottom: space[1],
  },
  questionRowActive: {
    opacity: 0.92,
    transform: [{ scale: 1.02 }],
  },
  questionRowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
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
    color: color.text3,
    letterSpacing: -1,
    fontWeight: "700",
  },
  questionMain: {
    flex: 1,
    gap: space[1],
  },
  questionLabel: {
    fontSize: typeToken.body.fontSize,
    lineHeight: typeToken.body.lineHeight,
    color: color.text1,
  },
  questionMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    flexWrap: "wrap",
  },
  typePill: {
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  typePillLabel: {
    fontSize: typeToken.caption.fontSize,
    lineHeight: typeToken.caption.lineHeight,
    fontWeight: "600",
    letterSpacing: 0.8,
    color: color.text2,
  },
  requiredPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: color.accentLine,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.accentLine,
  },
  requiredPillLabel: {
    fontSize: typeToken.caption.fontSize,
    lineHeight: typeToken.caption.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  optionalText: {
    fontSize: typeToken.caption.fontSize,
    lineHeight: typeToken.caption.lineHeight,
    color: color.text3,
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtnArmed: {
    backgroundColor: color.errorTint,
    borderWidth: 1,
    borderColor: color.danger,
  },
  removeBtnPressed: {
    opacity: 0.7,
  },
  confirmRow: {
    marginTop: space[2],
    paddingTop: space[2],
    borderTopWidth: 1,
    borderTopColor: color.danger,
  },
  confirmText: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.text1,
    marginBottom: space[2],
  },
  confirmButtons: {
    flexDirection: "row",
    gap: space[2],
    justifyContent: "flex-end",
  },
  confirmKeep: {
    paddingVertical: 8,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
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
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    fontWeight: "500",
    color: color.text2,
  },
  confirmDestroy: {
    paddingVertical: 8,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.danger,
    backgroundColor: color.danger,
    minHeight: 36,
    minWidth: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDestroyPressed: {
    opacity: 0.85,
  },
  confirmDestroyLabel: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: "transparent",
    minHeight: 44,
    marginTop: space[2],
  },
  addBtnDisabled: {
    opacity: 0.4,
    borderColor: color.line,
  },
  addBtnPressed: {
    opacity: 0.7,
  },
  addBtnLabel: {
    fontSize: typeToken.body.fontSize,
    lineHeight: typeToken.body.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  addBtnLabelDisabled: {
    color: color.text4,
  },
  clearAllLink: {
    paddingVertical: space[2],
    alignSelf: "center",
    marginTop: space[1],
  },
  clearAllLinkPressed: {
    opacity: 0.7,
  },
  clearAllLinkLabel: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.text3,
  },
  clearAllConfirmRow: {
    marginTop: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.danger,
    backgroundColor: color.errorTint,
  },
  clearAllConfirmText: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.text1,
    marginBottom: space[2],
  },
  clearAllConfirmButtons: {
    flexDirection: "row",
    gap: space[2],
    justifyContent: "flex-end",
  },
});

export default IntakeSchemaBuilder;
