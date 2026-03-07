import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { s, vs, SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { colors, spacing, radius, shadows, typography } from "../constants/designSystem";
import { SavedPerson } from "../services/savedPeopleService";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getDaysUntilBirthday(birthdayStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bday = new Date(birthdayStr);
  const thisYear = today.getFullYear();
  let next = new Date(thisYear, bday.getMonth(), bday.getDate());
  next.setHours(0, 0, 0, 0);
  if (next < today) {
    next = new Date(thisYear + 1, bday.getMonth(), bday.getDate());
  }
  return Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatBirthdayDate(birthdayStr: string): string {
  const bday = new Date(birthdayStr);
  return `${MONTHS[bday.getMonth()]} ${bday.getDate()}`;
}

interface BirthdayHeroProps {
  person: SavedPerson;
  aiSummary: string | null;
  isLoadingSummary: boolean;
}

const BirthdayHero: React.FC<BirthdayHeroProps> = ({
  person,
  aiSummary,
  isLoadingSummary,
}) => {
  if (isLoadingSummary && !aiSummary) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.gray[400]} />
      </View>
    );
  }

  if (!person.birthday) {
    return (
      <View
        style={[styles.container, styles.noBirthdayContainer]}
        accessibilityLabel={`${person.name}'s Picks`}
      >
        <Text style={styles.noBirthdayTitle}>{person.name}'s Picks</Text>
        <Text style={styles.noBirthdaySubtitle}>Experiences they'd love</Text>
      </View>
    );
  }

  const daysAway = getDaysUntilBirthday(person.birthday);
  const formattedDate = formatBirthdayDate(person.birthday);

  const daysLabel =
    daysAway === 0 ? "today!" : daysAway === 1 ? "day away" : "days away";

  const accessibilityText = `${person.name}'s birthday in ${daysAway} days.${
    aiSummary ? ` ${aiSummary}` : ""
  }`;

  return (
    <View
      style={[styles.container, styles.birthdayContainer]}
      accessibilityLabel={accessibilityText}
    >
      <View style={styles.topSection}>
        <Text style={styles.birthdayTitle}>{person.name}'s Birthday</Text>
        <Text style={styles.birthdayDate}>{formattedDate}</Text>
      </View>

      <View style={styles.countdownSection}>
        {daysAway === 0 ? (
          <Text style={styles.countdownNumber}>!</Text>
        ) : (
          <Text style={styles.countdownNumber}>{daysAway}</Text>
        )}
        <Text style={styles.countdownLabel}>{daysLabel}</Text>
      </View>

      {aiSummary ? (
        <View style={styles.summarySection}>
          <Text style={styles.summaryText}>{aiSummary}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: SCREEN_HEIGHT * 0.4,
    borderRadius: s(16),
    padding: s(24),
    justifyContent: "space-between",
    overflow: "hidden",
  },
  loadingContainer: {
    backgroundColor: colors.gray[200],
    justifyContent: "center",
    alignItems: "center",
  },
  birthdayContainer: {
    backgroundColor: "#eb7825",
  },
  noBirthdayContainer: {
    backgroundColor: colors.gray[800],
    justifyContent: "center",
  },
  topSection: {
    alignItems: "flex-start",
  },
  birthdayTitle: {
    fontSize: s(22),
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: vs(4),
  },
  birthdayDate: {
    fontSize: s(16),
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
  },
  countdownSection: {
    alignItems: "center",
    justifyContent: "center",
  },
  countdownNumber: {
    fontSize: s(56),
    fontWeight: "800",
    color: "#FFFFFF",
    lineHeight: s(64),
  },
  countdownLabel: {
    fontSize: s(18),
    fontWeight: "600",
    color: "rgba(255,255,255,0.9)",
    marginTop: vs(4),
  },
  summarySection: {
    alignSelf: "flex-start",
  },
  summaryText: {
    fontSize: s(14),
    fontStyle: "italic",
    color: "rgba(255,255,255,0.85)",
    lineHeight: s(20),
  },
  noBirthdayTitle: {
    fontSize: s(24),
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: vs(8),
  },
  noBirthdaySubtitle: {
    fontSize: s(16),
    fontWeight: "400",
    color: "rgba(255,255,255,0.7)",
  },
});

export default BirthdayHero;
