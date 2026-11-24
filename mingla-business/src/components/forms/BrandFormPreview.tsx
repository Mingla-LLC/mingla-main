/**
 * #4514 — "What guests see": the live preview beside the builder (from 1024 px)
 * or behind the Edit / Preview toggle on a phone. Opens with the brand header
 * and draws the form exactly as guests get it: `@mingla/form-rendering`'s
 * BrandFormRenderer decides "Show only if", prints "Shown to door staff" and the
 * "The host and their door staff can see your answers." line. Tap an answer to
 * see a question revealed. Preview only: nothing is saved or sent.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { BrandAnswers, BrandHeaderData } from "@mingla/form-rendering";

import { color, radius, space, type } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import type { BrandFormDefinition } from "../../utils/brandFormDefinition";
import { FORMS_COPY } from "./brandFormsCopy";

// The header and the renderers load through their ONE lazy owner (also used by
// the trip checkout questions screen and the guest link page), so they are
// never hoisted into the eager bundle.
const owner = () => import("../checkout/intake/formRenderingPrimitives");
const BusinessBrandForm = React.lazy(() => owner().then((m) => ({ default: m.BusinessBrandForm })));
const BusinessBrandHeader = React.lazy(() => owner().then((m) => ({ default: m.BusinessBrandHeader })));

export interface BrandFormPreviewProps {
  definition: BrandFormDefinition;
  name: string;
  brand: BrandHeaderData;
  /** The form lets door staff open full answers: guests see one line at the top. */
  doorFullAnswers: boolean;
}

export const BrandFormPreview: React.FC<BrandFormPreviewProps> = ({
  definition,
  name,
  brand,
  doorFullAnswers,
}) => {
  const [answers, setAnswers] = useState<BrandAnswers>({});
  const [missing, setMissing] = useState<boolean>(true);
  const handleMissing = useCallback((ids: string[]): void => setMissing(ids.length > 0), []);
  const hasQuestions = definition.questions.length > 0;

  return (
    <View style={styles.card} testID="brand-form-preview">
      <Text style={styles.caption}>{FORMS_COPY.previewTitle}</Text>
      <View style={styles.frame}>
        <React.Suspense fallback={<View style={styles.headerSlot} />}>
          <BusinessBrandHeader brand={brand} />
        </React.Suspense>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {name.length > 0 ? name : FORMS_COPY.untitledForm}
          </Text>
          {hasQuestions ? (
            <React.Suspense
              fallback={<Text style={styles.empty}>{FORMS_COPY.previewLoading}</Text>}
            >
              <BusinessBrandForm
                definition={definition}
                answers={answers}
                onAnswersChange={setAnswers}
                onMissingChange={handleMissing}
                doorFullAnswers={doorFullAnswers}
              />
            </React.Suspense>
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
  headerSlot: { height: 132, backgroundColor: color.fill.inset },
  body: { padding: space[4], gap: space[4] },
  title: { ...type.title, color: color.text1 },
  empty: { ...type.small, color: color.text3 },
  why: { ...type.caption, color: color.text3 },
});
