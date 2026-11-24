import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BrandFormRenderer,
  BrandHeader,
  brandHeaderFromServer,
  type BrandAnswers,
  type FormIconProps,
  type FormRenderingPrimitives,
} from "@mingla/form-rendering";
import type {
  RsvpBrandFormPage,
  ThemePalette,
} from "@mingla/offering-rendering";

import { Icon } from "../ui/Icon";
import { RsvpFormWebDateInput } from "./RsvpFormWebDateInput";

const FormIcon: React.FC<FormIconProps> = (props) => (
  <Icon
    name={props.name}
    size={props.size}
    color={props.color}
    strokeWidth={props.strokeWidth}
  />
);

export interface RsvpBrandFormQuestionsProps {
  page: RsvpBrandFormPage;
  answers: BrandAnswers;
  onAnswersChange: (answers: BrandAnswers) => void;
  onMissingChange: (ids: string[]) => void;
  palette: ThemePalette;
  disabled?: boolean;
}

const RsvpBrandFormQuestions: React.FC<RsvpBrandFormQuestionsProps> = ({
  page,
  answers,
  onAnswersChange,
  onMissingChange,
  palette,
  disabled = false,
}) => {
  const primitives = useMemo<FormRenderingPrimitives>(() => ({
    tokens: {
      color: {
        danger: "#EF4444",
        warning: "#F59E0B",
        accent: palette.accent,
        accentLine: palette.accent,
        line: palette.panelBorder,
        text1: palette.primaryText,
        text2: palette.secondaryText,
        text3: palette.tertiaryText,
        text4: palette.tertiaryText,
        textStrong: palette.primaryText,
        fill: { inset: palette.panelStrong },
      },
      radius: { sm: 8, md: 12 },
      space: { 1: 4, 2: 8, 4: 16, 6: 24 },
      type: {
        body: { fontSize: 16, lineHeight: 24 },
        caption: { fontSize: 12, lineHeight: 16 },
        small: { fontSize: 14, lineHeight: 20 },
      },
    },
    Icon: FormIcon,
    WebDateTimeInput: RsvpFormWebDateInput,
  }), [palette]);

  return (
    <View
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
      testID="issue-4541-rsvp-questions"
    >
      <BrandHeader
        brand={brandHeaderFromServer(page.brand)}
        primitives={primitives}
        compact
        caption={`Questions from ${String(page.brand.displayName ?? "the host")}`}
      />
      <View style={styles.body}>
        <Text style={[styles.title, { color: palette.primaryText }]}>{page.name}</Text>
        <BrandFormRenderer
          definition={page.definition}
          answers={answers}
          onAnswersChange={onAnswersChange}
          primitives={primitives}
          doorFullAnswers={page.doorFullAnswers}
          onMissingChange={onMissingChange}
          disabled={disabled}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: "hidden", marginTop: 16 },
  body: { padding: 16, gap: 14 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
});

export default RsvpBrandFormQuestions;
