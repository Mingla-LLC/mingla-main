/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeQuestionPreview />.
 *
 * Per DESIGN_ORCH-0880 §3.5. Read-only buyer-view preview pane that mirrors
 * what travelers will see at /checkout-trip/[tripEventId]/intake.tsx.
 *
 * Phase 3 caveat: Phase 4 builds the real buyer-fill question renderers
 * (IntakeQuestionShortText, …Date, …FileUpload etc). For Phase 3, this
 * preview pane renders DISABLED-LOOKING placeholder versions of each
 * question type — enough for the planner to visualize spacing, label
 * hierarchy, required asterisks, and which questions are on the form.
 *
 * When Phase 4 ships the SHARED renderers, this component swaps each type
 * branch to `<RealRenderer disabled />`. Behaviour and contract stay the
 * same; only the inner render pieces change. SC-32 (preview parity with
 * buyer fill) flips fully GREEN at that point.
 *
 * Composes GlassCard + Icon + token-only styles. No new primitives.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

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
import type {
  IntakeQuestion,
  IntakeSchema,
} from "../../services/intakeSchemaService";

export interface IntakeQuestionPreviewProps {
  schema: IntakeSchema | null;
  activeTierName: string;
  testID?: string;
}

export const IntakeQuestionPreview: React.FC<IntakeQuestionPreviewProps> = ({
  schema,
  activeTierName,
  testID,
}) => {
  const questions = schema?.questions ?? [];
  const isEmpty = questions.length === 0;

  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.eyebrow}>
        PREVIEW · {activeTierName.toUpperCase()}
      </Text>
      <View style={styles.divider} />

      {isEmpty ? (
        <View style={styles.emptyState}>
          <Icon
            name="list"
            size={48}
            color={textTokens.quaternary}
            strokeWidth={1.5}
          />
          <Text style={styles.emptyText}>
            Add a question to see how travelers will see this form.
          </Text>
        </View>
      ) : (
        <View style={styles.questions}>
          {questions
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((q) => (
              <PreviewQuestion key={q.id} question={q} />
            ))}
          <View style={styles.divider} />
          <Text style={styles.footerHint}>
            This is what travelers will see.
          </Text>
        </View>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Per-question read-only renderer
// ---------------------------------------------------------------------------

interface PreviewQuestionProps {
  question: IntakeQuestion;
}

const PreviewQuestion: React.FC<PreviewQuestionProps> = ({ question }) => {
  return (
    <View style={styles.questionWrap}>
      <View style={styles.labelRow}>
        <Text style={styles.questionLabel}>
          {question.label.length > 0 ? question.label : "Untitled question"}
          {question.required ? (
            <Text style={styles.requiredAsterisk}> *</Text>
          ) : null}
        </Text>
        {!question.required ? (
          <Text style={styles.optionalNote}>(optional)</Text>
        ) : null}
      </View>
      <PreviewInputForType question={question} />
    </View>
  );
};

const PreviewInputForType: React.FC<{ question: IntakeQuestion }> = ({
  question,
}) => {
  switch (question.type) {
    case "short_text":
      return (
        <View style={styles.disabledInput}>
          <Text style={styles.disabledInputText}>
            {question.placeholder ?? "Type an answer…"}
          </Text>
        </View>
      );
    case "long_text":
      return (
        <View style={[styles.disabledInput, styles.disabledInputMulti]}>
          <Text style={styles.disabledInputText}>
            {question.placeholder ?? "Type a longer answer…"}
          </Text>
        </View>
      );
    case "single_choice":
      return (
        <View style={styles.choicesWrap}>
          {(question.options ?? []).map((opt, idx) => (
            <View key={`opt-${idx}`} style={styles.choiceRow}>
              <View
                style={[
                  styles.radioOuter,
                  idx === 0 && styles.radioOuterFilled,
                ]}
              >
                {idx === 0 ? <View style={styles.radioDot} /> : null}
              </View>
              <Text style={styles.choiceLabel}>
                {opt.length > 0 ? opt : `Option ${idx + 1}`}
              </Text>
            </View>
          ))}
        </View>
      );
    case "multi_choice":
      return (
        <View style={styles.choicesWrap}>
          {(question.options ?? []).map((opt, idx) => (
            <View key={`opt-${idx}`} style={styles.choiceRow}>
              <View
                style={[
                  styles.checkboxOuter,
                  idx === 0 && styles.checkboxOuterFilled,
                ]}
              >
                {idx === 0 ? (
                  <Icon
                    name="check"
                    size={12}
                    color={textTokens.primary}
                    strokeWidth={3}
                  />
                ) : null}
              </View>
              <Text style={styles.choiceLabel}>
                {opt.length > 0 ? opt : `Option ${idx + 1}`}
              </Text>
            </View>
          ))}
        </View>
      );
    case "date":
      return (
        <View style={styles.disabledInput}>
          <Text style={styles.disabledInputText}>Tap to choose date</Text>
          <View style={styles.inputTrailingIcon}>
            <Icon
              name="calendar"
              size={16}
              color={textTokens.tertiary}
              strokeWidth={2}
            />
          </View>
        </View>
      );
    case "number":
      return (
        <View>
          <View style={styles.disabledInput}>
            <Text style={styles.disabledInputText}>
              {question.integer_only === true ? "0" : "0.0"}
            </Text>
          </View>
          {(question.min !== undefined || question.max !== undefined) && (
            <Text style={styles.minMaxHint}>
              {question.min !== undefined ? `Min ${question.min}` : ""}
              {question.min !== undefined && question.max !== undefined
                ? " · "
                : ""}
              {question.max !== undefined ? `Max ${question.max}` : ""}
            </Text>
          )}
        </View>
      );
    case "file_upload": {
      const max = question.max_files ?? 1;
      const types = [
        question.allow_images !== false ? "Images" : null,
        question.allow_pdfs !== false ? "PDFs" : null,
        question.allow_docs !== false ? "docs" : null,
      ]
        .filter((t): t is string => t !== null)
        .join(", ");
      return (
        <GlassCard variant="base" padding={spacing.md} radius="lg">
          <View style={styles.fileUploadPreview}>
            <View style={styles.uploadIconWrap}>
              <Icon
                name="upload"
                size={24}
                color={accent.warm}
                strokeWidth={2}
              />
            </View>
            <View style={styles.uploadPseudoButton}>
              <Text style={styles.uploadPseudoButtonLabel}>+ Choose file</Text>
            </View>
            <Text style={styles.uploadHint}>
              Up to {max} {max === 1 ? "file" : "files"} · 10 MB each
            </Text>
            <Text style={styles.uploadHint}>
              {types.length > 0 ? `${types} allowed` : "No file types selected"}
            </Text>
          </View>
        </GlassCard>
      );
    }
    default: {
      // Exhaustive type check.
      const _never: never = question.type;
      void _never;
      return null;
    }
  }
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  eyebrow: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
    marginVertical: spacing.md,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  questions: {
    gap: spacing.md,
  },
  questionWrap: {
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  questionLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    fontWeight: "500",
  },
  requiredAsterisk: {
    color: accent.warm,
    fontSize: typography.body.fontSize,
    fontWeight: "700",
  },
  optionalNote: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  disabledInput: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    opacity: 0.7,
  },
  disabledInputMulti: {
    minHeight: 76,
    alignItems: "flex-start",
    paddingTop: 10,
  },
  disabledInputText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.quaternary,
  },
  inputTrailingIcon: {
    marginLeft: spacing.sm,
  },
  choicesWrap: {
    gap: spacing.xs,
  },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minHeight: 44,
    opacity: 0.85,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterFilled: {
    borderColor: accent.border,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: accent.warm,
  },
  checkboxOuter: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOuterFilled: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  choiceLabel: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  minMaxHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  fileUploadPreview: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  uploadIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  uploadPseudoButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    opacity: 0.7,
  },
  uploadPseudoButtonLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  uploadHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  footerHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
});

// Suppress potentially-unused imports on some lint configs. semantic is
// reserved for future error-state rendering on the preview pane when the
// schema fails buyer-side validation rules.
void semantic;

export default IntakeQuestionPreview;
