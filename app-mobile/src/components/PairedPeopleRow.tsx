import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import { s, vs } from "../utils/responsive";
import { colors } from "../constants/designSystem";

interface PairedPerson {
  pairedUserId: string;
  pairingId: string;
  displayName: string;
  firstName: string | null;
  avatarUrl: string | null;
  initials: string;
  birthday: string | null;
  gender: string | null;
}

interface PairedPeopleRowProps {
  people: PairedPerson[];
  onSelectPerson: (person: PairedPerson) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parse "YYYY-MM-DD" without UTC shift */
function parseDateOnly(dateStr: string): { month: number; day: number } {
  const parts = dateStr.split("-").map(Number);
  return { month: parts[1] - 1, day: parts[2] }; // month 0-indexed
}

function getDaysUntilBirthday(birthdayStr: string): number {
  const { month, day } = parseDateOnly(birthdayStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisYear = today.getFullYear();
  let nextBday = new Date(thisYear, month, day);
  nextBday.setHours(0, 0, 0, 0);

  if (nextBday < today) {
    nextBday = new Date(thisYear + 1, month, day);
    nextBday.setHours(0, 0, 0, 0);
  }

  return Math.ceil(
    (nextBday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatBirthdayShort(birthdayStr: string): string {
  const { month, day } = parseDateOnly(birthdayStr);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[month]} ${day}`;
}

function getCountdownLabel(daysAway: number): string {
  if (daysAway === 0) return "Today! \uD83C\uDF89";
  if (daysAway === 1) return "Tomorrow!";
  return `${daysAway} days away`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PairedPeopleRow({
  people,
  onSelectPerson,
}: PairedPeopleRowProps) {
  if (people.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Your People</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {people.map((person) => {
          const name = person.firstName || person.displayName.split(" ")[0];
          const hasBirthday = !!person.birthday;
          const daysAway = hasBirthday
            ? getDaysUntilBirthday(person.birthday!)
            : null;

          return (
            <TouchableOpacity
              key={person.pairingId}
              style={styles.card}
              onPress={() => onSelectPerson(person)}
              activeOpacity={0.7}
            >
              {/* Avatar */}
              <View style={styles.avatarContainer}>
                {person.avatarUrl ? (
                  <Image
                    source={{ uri: person.avatarUrl }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text style={styles.avatarInitials}>{person.initials}</Text>
                )}
              </View>

              {/* Name */}
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>

              {/* Birthday info */}
              {hasBirthday && (
                <>
                  <Text style={styles.birthday} numberOfLines={1}>
                    \uD83C\uDF82 {formatBirthdayShort(person.birthday!)}
                  </Text>
                  <Text style={styles.countdown} numberOfLines={1}>
                    {getCountdownLabel(daysAway!)}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: s(16),
  },
  sectionTitle: {
    fontSize: s(16),
    fontWeight: "700",
    color: "#111827",
    marginBottom: s(12),
    paddingHorizontal: s(4),
  },
  scrollContent: {
    gap: s(12),
    paddingRight: s(16),
  },
  card: {
    width: s(140),
    height: s(160),
    backgroundColor: "white",
    borderRadius: s(16),
    padding: s(12),
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarContainer: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    backgroundColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: s(8),
    overflow: "hidden",
  },
  avatarImage: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
  },
  avatarInitials: {
    fontSize: s(18),
    fontWeight: "700",
    color: "white",
  },
  name: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#111827",
    marginBottom: s(4),
    textAlign: "center",
  },
  birthday: {
    fontSize: s(12),
    color: colors.gray[500],
    marginBottom: s(2),
  },
  countdown: {
    fontSize: s(12),
    fontWeight: "600",
    color: "#eb7825",
  },
});
