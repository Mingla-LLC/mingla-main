/**
 * TripGuideReviewSections — Issue #2829 (amendment A9) on the trip creator's
 * Review step: the "Before you go" guide exactly as it will be published with
 * the trip (highlights, group size and activity, what to prepare, good to know,
 * questions with their answers), so nothing is hidden before publish.
 *
 * Reads the saved guide (the same team read the editor uses) and shapes it with
 * the same `toTripOfferingGuide` the public trip page uses, so the Review step
 * and the trip page cannot disagree. Every answer is shown open here — the
 * host is checking the words, not using the accordion. States: loading, load
 * error with retry, no guide (a plain note pointing to step 3), the guide.
 */

import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
  TRIP_GUIDE_ACTIVITY_LABEL,
  toTripOfferingGuide,
} from "@mingla/offering-rendering/tripGuide";

import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useTripGuideForEditor } from "../../hooks/useTripGuide";

export interface TripGuideReviewSectionsProps {
  eventId: string;
  /** The trip's capacity, for the "Group size 6–16" line (never guessed). */
  capacity: number | null;
  testID?: string;
}

export const TripGuideReviewSections: React.FC<TripGuideReviewSectionsProps> = ({
  eventId,
  capacity,
  testID = "trip-review-guide",
}) => {
  const guideQuery = useTripGuideForEditor(eventId);

  if (guideQuery.isLoading) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.title}>Before you go</Text>
        <View style={styles.row} testID={`${testID}-loading`}>
          <ActivityIndicator color={accent.warm} />
          <Text style={styles.helper}>Loading the trip guide…</Text>
        </View>
      </View>
    );
  }

  if (guideQuery.isError) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.title}>Before you go</Text>
        <Text style={styles.errorText} testID={`${testID}-load-error`}>
          The trip guide could not be loaded, so it is not shown here. Check your connection and try again.
        </Text>
        <Pressable
          onPress={() => {
            void guideQuery.refetch();
          }}
          accessibilityRole="button"
          accessibilityLabel="Try loading the trip guide again"
          style={styles.retryBtn}
          testID={`${testID}-retry`}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const guide = toTripOfferingGuide(guideQuery.data, capacity);
  if (guide === null) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.title}>Before you go</Text>
        <Text style={styles.helper} testID={`${testID}-empty`}>
          No trip guide yet. Add highlights, what to prepare and questions in step 3 to show them on your trip page.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.title}>Before you go</Text>
      <Text style={styles.helper}>Published with your trip, on every Mingla surface.</Text>
      {guide.highlights.length > 0 ? (
        <View style={styles.section} testID={`${testID}-highlights`}>
          <Text style={styles.sectionLabel}>Highlights</Text>
          {guide.highlights.map((highlight, index) => (
            <Text key={`highlight-${index}`} style={styles.body}>• {highlight}</Text>
          ))}
        </View>
      ) : null}
      {guide.groupSizeLabel !== null || guide.activityLevel !== null ? (
        <Text style={styles.body} testID={`${testID}-group`}>
          {[
            guide.groupSizeLabel,
            guide.activityLevel !== null ? `${TRIP_GUIDE_ACTIVITY_LABEL[guide.activityLevel]} activity` : null,
          ]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </Text>
      ) : null}
      {guide.whatToPrepare !== null ? (
        <View style={styles.section} testID={`${testID}-prepare`}>
          <Text style={styles.sectionLabel}>What to prepare</Text>
          <Text style={styles.body}>{guide.whatToPrepare}</Text>
        </View>
      ) : null}
      {guide.goodToKnow !== null ? (
        <View style={styles.section} testID={`${testID}-good-to-know`}>
          <Text style={styles.sectionLabel}>Good to know</Text>
          <Text style={styles.body}>{guide.goodToKnow}</Text>
        </View>
      ) : null}
      {guide.faqs.length > 0 ? (
        <View style={styles.section} testID={`${testID}-faqs`}>
          <Text style={styles.sectionLabel}>Questions</Text>
          {guide.faqs.map((faq, index) => (
            <View key={`faq-${index}`} style={styles.faq}>
              <Text style={styles.question}>{faq.question}</Text>
              <Text style={styles.body}>{faq.answer}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  title: { fontSize: typography.body.fontSize, fontWeight: "800", color: textTokens.primary },
  helper: { fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.secondary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  section: { gap: spacing.xs },
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: textTokens.secondary,
    textTransform: "uppercase",
  },
  body: { fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: textTokens.primary },
  faq: { gap: 2, paddingVertical: spacing.xs },
  question: { fontSize: typography.bodySm.fontSize, fontWeight: "700", color: textTokens.primary },
  errorText: { fontSize: typography.bodySm.fontSize, lineHeight: typography.bodySm.lineHeight, color: semantic.errorText },
  retryBtn: {
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.4)",
  },
  retryText: { fontSize: typography.bodySm.fontSize, fontWeight: "700", color: accent.warm },
});

export default TripGuideReviewSections;
