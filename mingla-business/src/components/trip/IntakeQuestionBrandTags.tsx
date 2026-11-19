/**
 * #4514 — the DOOR and "ONLY IF Qn IS …" tags on a question card in the brand
 * form builder. One component for the native and the web builder. The trip
 * builder never renders it (its features are off).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type as typeToken } from "../../constants/designSystem";
import type { IntakeQuestion } from "../../services/intakeSchemaService";
import { FORMS_COPY } from "../forms/brandFormsCopy";
import { isDoorType } from "../../utils/brandFormDefinition";

export interface IntakeQuestionBrandTagsProps {
  question: IntakeQuestion;
  questions: readonly IntakeQuestion[];
}

export function brandTagLabels(
  question: IntakeQuestion,
  questions: readonly IntakeQuestion[],
): string[] {
  const out: string[] = [];
  if (question.show_at_door === true && isDoorType(question.type)) out.push(FORMS_COPY.doorTag);
  if (question.show_if !== undefined) {
    const sourceIndex = questions.findIndex((q) => q.id === question.show_if?.question_id);
    const source = sourceIndex >= 0 ? questions[sourceIndex] : undefined;
    if (source !== undefined) {
      const optionIndex = (source.option_ids ?? []).indexOf(question.show_if.option_id);
      const optionLabel = optionIndex >= 0 ? source.options?.[optionIndex] ?? "" : "";
      out.push(FORMS_COPY.onlyIfTag(sourceIndex + 1, optionLabel.length > 0 ? optionLabel : "…"));
    }
  }
  return out;
}

export const IntakeQuestionBrandTags: React.FC<IntakeQuestionBrandTagsProps> = ({
  question,
  questions,
}) => {
  const labels = brandTagLabels(question, questions);
  if (labels.length === 0) return null;
  return (
    <>
      {labels.map((label) => (
        <View key={label} style={styles.tag} testID="intake-brand-tag">
          <Text style={styles.tagLabel}>{label}</Text>
        </View>
      ))}
    </>
  );
};

const styles = StyleSheet.create({
  tag: {
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.accentLine,
  },
  tagLabel: {
    fontSize: typeToken.caption.fontSize,
    lineHeight: typeToken.caption.lineHeight,
    fontWeight: "600",
    letterSpacing: 0.8,
    color: color.accent,
  },
});
