import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BrandFormRenderer,
  BrandHeader,
  brandHeaderFromServer,
  type BrandAnswers,
} from "@mingla/form-rendering";
import type { RsvpBrandFormPage } from "@mingla/offering-rendering";

import { color, radius, space, type } from "../../constants/designSystem";
// Imported from the defining module, not formRenderingPrimitives: that owner
// re-exports this file, so importing back from it would be a cycle.
import { businessFormPrimitives } from "../checkout/intake/businessFormPrimitives";

export interface RsvpBrandFormQuestionsProps {
  page: RsvpBrandFormPage;
  answers: BrandAnswers;
  onAnswersChange: (answers: BrandAnswers) => void;
  onMissingChange: (ids: string[]) => void;
  disabled?: boolean;
}

export const RsvpBrandFormQuestions: React.FC<RsvpBrandFormQuestionsProps> = ({
  page,
  answers,
  onAnswersChange,
  onMissingChange,
  disabled = false,
}) => (
  <View style={styles.card} testID="issue-4541-rsvp-questions">
    <BrandHeader
      primitives={businessFormPrimitives}
      brand={brandHeaderFromServer(page.brand)}
      compact
      caption={`Questions from ${String(page.brand.displayName ?? "the host")}`}
    />
    <View style={styles.body}>
      <Text style={styles.title}>{page.name}</Text>
      <BrandFormRenderer
        primitives={businessFormPrimitives}
        definition={page.definition}
        answers={answers}
        onAnswersChange={onAnswersChange}
        doorFullAnswers={page.doorFullAnswers}
        onMissingChange={onMissingChange}
        disabled={disabled}
      />
    </View>
  </View>
);

const styles = StyleSheet.create({
  card: {
    marginTop: space[4],
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    backgroundColor: color.card,
    overflow: "hidden",
  },
  body: { padding: space[4], gap: space[4] },
  title: { ...type.h2, color: color.text1 },
});

export default RsvpBrandFormQuestions;
