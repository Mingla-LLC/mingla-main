/**
 * #4541 R1.9 — "Answers to {form}" on guest detail and order detail: the one
 * guest's (or order's) answer to the page's active form, read through
 * `biz_brand_form_guest_answers` (marketing manager and up; the server checks
 * and picks the row exactly as the Responses screen does).
 *
 * States: loading "Loading answers…", error "Couldn't load answers. Try again"
 * with Try again, "Not answered", and none (no form on the page: draws nothing).
 *
 * Inside the one lazy forms owner (`formsOwner`); each detail screen loads it
 * through its own single `React.lazy` of that owner.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useGuestAnswers } from "../../hooks/useBrandForms";
import type { GuestAnswersSubjectKind } from "../../services/brandFormsService";
import { canReadGuestQuestions } from "../../utils/guestQuestionsModel";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { Button } from "../ui/Button";
import { GUEST_ANSWERS_CARD_COPY as COPY } from "./brandFormsCopy";

export interface GuestAnswersCardProps {
  brandId: string | null;
  eventId: string;
  subject: { kind: GuestAnswersSubjectKind; id: string };
  testID?: string;
}

const formatDate = (iso: string | null): string | null => {
  if (iso === null) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export const GuestAnswersCard: React.FC<GuestAnswersCardProps> = ({
  brandId,
  eventId,
  subject,
  testID = "guest-answers-card",
}) => {
  const role = useCurrentBrandRole(brandId);
  const readable = canReadGuestQuestions(role.rank);
  const answers = useGuestAnswers(eventId, subject, readable);
  if (!readable) return null;
  // isPending, not isLoading: while auth settles the query is disabled (not
  // fetching, no data) and must read as loading, never flash the error state.
  if (answers.isPending) {
    return (
      <View style={styles.block} testID={`${testID}-loading`}>
        <Text style={styles.muted}>{COPY.loading}</Text>
      </View>
    );
  }
  if (answers.isError || answers.data === undefined) {
    return (
      <View style={styles.block} accessibilityRole="alert" testID={`${testID}-error`}>
        <Text style={styles.muted}>{COPY.failed}</Text>
        <Button label={COPY.retry} variant="secondary" size="sm" onPress={() => void answers.refetch()} />
      </View>
    );
  }
  const data = answers.data;
  if (data.state === "none") return null;
  if (data.state === "not_answered") {
    return (
      <View style={styles.block} testID={`${testID}-not-answered`}>
        <Text style={styles.muted}>{COPY.notAnswered}</Text>
      </View>
    );
  }
  const meta = [
    formatDate(data.answeredAt),
    data.versionLabel,
    data.isCurrentVersion ? null : COPY.earlierVersion,
  ].filter((x): x is string => x !== null && x.length > 0);
  return (
    <View style={styles.block} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        {COPY.title(data.formName)}
      </Text>
      {meta.length > 0 ? <Text style={styles.muted}>{meta.join(" · ")}</Text> : null}
      {data.items.map((item, i) => (
        <View key={`${i}-${item.label}`} style={styles.qa}>
          <Text style={styles.q}>{item.label}</Text>
          <Text style={item.value.trim().length > 0 ? styles.a : styles.muted}>
            {item.value.trim().length > 0 ? item.value : COPY.notAnswered}
          </Text>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  title: { ...type.row, color: color.text1 },
  qa: { gap: 2, paddingTop: space[2] },
  q: { ...type.caption, color: color.text3 },
  a: { ...type.body, color: color.text1 },
  muted: { ...type.small, color: color.text3 },
});

export default GuestAnswersCard;
