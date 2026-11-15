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
  radius,
  color,
  space,
  type,
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
            color={color.text4}
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
                    color={color.text1}
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
              color={color.text3}
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
        <GlassCard variant="base" padding={space[4]} radius="lg">
          <View style={styles.fileUploadPreview}>
            <View style={styles.uploadIconWrap}>
              <Icon
                name="upload"
                size={24}
                color={color.accent}
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
    paddingVertical: space[2],
  },
  eyebrow: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    textTransform: "uppercase",
    color: color.accent,
    marginBottom: space[2],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.line,
    marginVertical: space[4],
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: space[7],
    gap: space[4],
  },
  emptyText: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text3,
    textAlign: "center",
    paddingHorizontal: space[6],
  },
  questions: {
    gap: space[4],
  },
  questionWrap: {
    marginBottom: space[4],
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: space[1],
    marginBottom: space[1],
  },
  questionLabel: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text1,
    fontWeight: "500",
  },
  requiredAsterisk: {
    color: color.accent,
    fontSize: type.body.fontSize,
    fontWeight: "700",
  },
  optionalNote: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
  },
  disabledInput: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: space[4],
    paddingVertical: 10,
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    opacity: 0.7,
  },
  disabledInputMulti: {
    minHeight: 76,
    alignItems: "flex-start",
    paddingTop: 10,
  },
  disabledInputText: {
    flex: 1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text4,
  },
  inputTrailingIcon: {
    marginLeft: space[2],
  },
  choicesWrap: {
    gap: space[1],
  },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[1],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    minHeight: 44,
    opacity: 0.85,
  },
  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: color.text3,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterFilled: {
    borderColor: color.accentLine,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.accent,
  },
  checkboxOuter: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: color.text3,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOuterFilled: {
    borderColor: color.accentLine,
    backgroundColor: color.accentLine,
  },
  choiceLabel: {
    flex: 1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text2,
  },
  minMaxHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: 2,
  },
  fileUploadPreview: {
    alignItems: "center",
    gap: space[1],
    paddingVertical: space[2],
  },
  uploadIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: color.accentLine,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space[1],
  },
  uploadPseudoButton: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
    opacity: 0.7,
  },
  uploadPseudoButtonLabel: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  uploadHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    textAlign: "center",
  },
  footerHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    textAlign: "center",
  },
});

export default IntakeQuestionPreview;
