import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
} from "react-native";
import { Icon } from './ui/Icon';
import { s } from "../utils/responsive";

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
  if (daysAway === 0) return "Today!";
  if (daysAway === 1) return "Tomorrow";
  return `${daysAway}d away`;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PairedPeopleRow({
  people,
  onSelectPerson,
}: PairedPeopleRowProps) {
  const [failedAvatars, setFailedAvatars] = useState<Set<string>>(new Set());

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
          const name = person.firstName || person.displayName?.split(" ")[0] || 'Friend';
          const hasBirthday = !!person.birthday;
          const rawDaysAway = hasBirthday
            ? getDaysUntilBirthday(person.birthday!)
            : null;
          const daysAway = rawDaysAway != null && !isNaN(rawDaysAway) ? rawDaysAway : null;

          return (
            <TouchableOpacity
              key={person.pairingId}
              style={styles.card}
              onPress={() => onSelectPerson(person)}
              activeOpacity={0.7}
            >
              {/* Avatar with ring */}
              <View style={styles.avatarRing}>
                <View style={styles.avatarContainer}>
                  {person.avatarUrl && !failedAvatars.has(person.pairedUserId) ? (
                    <Image
                      source={{ uri: person.avatarUrl }}
                      style={styles.avatarImage}
                      onError={() => setFailedAvatars(prev => new Set([...prev, person.pairedUserId]))}
                    />
                  ) : (
                    <Text style={styles.avatarInitials}>{person.initials}</Text>
                  )}
                </View>
              </View>

              {/* Name */}
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>

              {/* Birthday countdown badge */}
              {hasBirthday && daysAway != null && (
                <View style={styles.badgeRow}>
                  <Icon name="gift-outline" size={s(11)} color="#eb7825" />
                  <Text style={styles.badgeText}>
                    {formatBirthdayShort(person.birthday!)}
                  </Text>
                  <View style={styles.badgeDot} />
                  <Text style={styles.badgeCountdown}>
                    {getCountdownLabel(daysAway)}
                  </Text>
                </View>
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
    marginBottom: s(20),
  },
  sectionTitle: {
    fontSize: s(17),
    fontWeight: "700",
    color: "#111827",
    marginBottom: s(14),
    paddingHorizontal: s(4),
    letterSpacing: -0.2,
  },
  scrollContent: {
    gap: s(12),
    paddingRight: s(16),
  },
  card: {
    width: s(130),
    backgroundColor: "white",
    borderRadius: s(20),
    paddingTop: s(18),
    paddingBottom: s(14),
    paddingHorizontal: s(12),
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.04)",
  },
  avatarRing: {
    width: s(60),
    height: s(60),
    borderRadius: s(30),
    borderWidth: s(2),
    borderColor: "#eb7825",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: s(10),
  },
  avatarContainer: {
    width: s(52),
    height: s(52),
    borderRadius: s(26),
    backgroundColor: "#1C1C1E",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: s(52),
    height: s(52),
    borderRadius: s(26),
  },
  avatarInitials: {
    fontSize: s(19),
    fontWeight: "700",
    color: "white",
    letterSpacing: 0.5,
  },
  name: {
    fontSize: s(15),
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    letterSpacing: -0.2,
    marginBottom: s(4),
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(3),
    marginTop: s(2),
  },
  badgeText: {
    fontSize: s(10),
    fontWeight: "500",
    color: "#6b7280",
  },
  badgeDot: {
    width: s(2),
    height: s(2),
    borderRadius: s(1),
    backgroundColor: "#d1d5db",
  },
  badgeCountdown: {
    fontSize: s(10),
    fontWeight: "600",
    color: "#eb7825",
  },
});
