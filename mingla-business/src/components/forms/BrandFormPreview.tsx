/**
 * #4514 — "What guests see": the live preview beside the builder (from 1024 px)
 * or behind the Edit / Preview toggle on a phone. Opens with the brand header
 * and draws the questions with the shared renderers from
 * `@mingla/form-rendering`. Tap an answer to see "Show only if" reveal a
 * question. Preview only: nothing is saved or sent.
 */

import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { FormAnswerValue } from "@mingla/form-rendering";

import { color, radius, space, type } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import type { BrandFormDefinition } from "../../utils/brandFormDefinition";
import {
  ANSWERS_SEEN_LINE,
  missingRequired,
  previewSchema,
  visibleAnswers,
} from "../../utils/brandFormPreview";
import { BrandFormHeader, type BrandFormHeaderData } from "./BrandFormHeader";
import { FORMS_COPY } from "./brandFormsCopy";

// The shared renderers load through their ONE lazy owner (also used by the trip
// checkout questions screen), so they are never hoisted into the eager bundle.
const BusinessIntakeForm = React.lazy(() =>
  import("../checkout/intake/formRenderingPrimitives").then((m) => ({
    default: m.BusinessIntakeForm,
  })),
);

export interface BrandFormPreviewProps {
  definition: BrandFormDefinition;
  name: string;
  brand: BrandFormHeaderData;
  /** The form lets door staff open full answers: guests see one line at the top. */
  doorFullAnswers: boolean;
}

export const BrandFormPreview: React.FC<BrandFormPreviewProps> = ({
  definition,
  name,
  brand,
  doorFullAnswers,
}) => {
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const handleChange = useCallback(
    (next: Record<string, FormAnswerValue>): void => {
      // A hidden question's answer is dropped, exactly as the server does.
      setAnswers(visibleAnswers(definition, next));
    },
    [definition],
  );
  const schema = useMemo(() => previewSchema(definition, answers), [definition, answers]);
  const missing = missingRequired(definition, answers);
  const hasQuestions = definition.questions.length > 0;

  return (
    <View style={styles.card} testID="brand-form-preview">
      <Text style={styles.caption}>{FORMS_COPY.previewTitle}</Text>
      <View style={styles.frame}>
        <BrandFormHeader brand={brand} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {name.length > 0 ? name : FORMS_COPY.untitledForm}
          </Text>
          {doorFullAnswers && hasQuestions ? (
            <Text style={styles.seen}>{ANSWERS_SEEN_LINE}</Text>
          ) : null}
          {hasQuestions ? (
            <View accessibilityLiveRegion="polite">
              <React.Suspense
                fallback={<Text style={styles.empty}>{FORMS_COPY.previewLoading}</Text>}
              >
                <BusinessIntakeForm
                  schema={schema}
                  answers={answers}
                  onAnswersChange={handleChange}
                />
              </React.Suspense>
            </View>
          ) : (
            <Text style={styles.empty}>{FORMS_COPY.previewEmpty}</Text>
          )}
          <Button
            label={FORMS_COPY.previewSend}
            variant="primary"
            size="md"
            fullWidth
            disabled={!hasQuestions || missing}
            onPress={() => undefined}
            testID="brand-form-preview-send"
          />
          <Text style={styles.why}>
            {missing && hasQuestions ? FORMS_COPY.previewNeedsAnswers : FORMS_COPY.previewNote}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { gap: space[2] },
  caption: {
    ...type.label,
    textTransform: "uppercase",
    color: color.text3,
  },
  frame: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  body: { padding: space[4], gap: space[4] },
  title: { ...type.title, color: color.text1 },
  seen: { ...type.caption, color: color.text3 },
  empty: { ...type.small, color: color.text3 },
  why: { ...type.caption, color: color.text3 },
});
