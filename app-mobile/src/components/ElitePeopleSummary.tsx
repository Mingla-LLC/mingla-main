import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "../utils/responsive";
import { colors } from "../constants/designSystem";
import { SavedPerson } from "../services/savedPeopleService";

interface ElitePeopleSummaryProps {
  people: SavedPerson[];
  isElite: boolean;
  onPersonPress: (personId: string) => void;
  onUpgradePress: () => void;
}

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

interface PersonWithEvent {
  person: SavedPerson;
  daysAway: number;
}

const ElitePeopleSummary: React.FC<ElitePeopleSummaryProps> = ({
  people,
  isElite,
  onPersonPress,
  onUpgradePress,
}) => {
  // Filter to people with birthdays and compute days away
  const peopleWithEvents: PersonWithEvent[] = people
    .filter((p) => p.birthday !== null)
    .map((p) => ({
      person: p,
      daysAway: getDaysUntilBirthday(p.birthday!),
    }))
    .sort((a, b) => a.daysAway - b.daysAway);

  if (peopleWithEvents.length === 0) {
    return null;
  }

  if (!isElite) {
    return (
      <View style={styles.teaserContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={false}
          contentContainerStyle={styles.scrollContent}
        >
          {peopleWithEvents.slice(0, 3).map(({ person, daysAway }) => (
            <View key={person.id} style={styles.card}>
              <View style={styles.daysBadge}>
                <Text style={styles.daysBadgeText}>{daysAway}d</Text>
              </View>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{person.initials}</Text>
              </View>
              <Text style={styles.cardName} numberOfLines={1}>
                {person.name}
              </Text>
              <Text style={styles.eventLabel} numberOfLines={1}>
                Birthday in {daysAway}d
              </Text>
            </View>
          ))}
        </ScrollView>
        <BlurView
          intensity={40}
          tint="light"
          style={StyleSheet.absoluteFill}
        >
          <View style={styles.blurOverlayContent}>
            <Ionicons name="lock-closed" size={s(28)} color={colors.gray[600]} />
            <TouchableOpacity style={styles.upgradeCta} onPress={onUpgradePress}>
              <Text style={styles.upgradeCtaText}>Unlock with Elite</Text>
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scrollContainer}
      contentContainerStyle={styles.scrollContent}
    >
      {peopleWithEvents.map(({ person, daysAway }) => (
        <TouchableOpacity
          key={person.id}
          style={styles.card}
          onPress={() => onPersonPress(person.id)}
          activeOpacity={0.7}
        >
          <View style={styles.daysBadge}>
            <Text style={styles.daysBadgeText}>{daysAway}d</Text>
          </View>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{person.initials}</Text>
          </View>
          <Text style={styles.cardName} numberOfLines={1}>
            {person.name}
          </Text>
          <Text style={styles.eventLabel} numberOfLines={1}>
            Birthday in {daysAway}d
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    marginHorizontal: -16,
    marginBottom: 16,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  teaserContainer: {
    position: "relative",
    overflow: "hidden",
    borderRadius: s(16),
    marginHorizontal: -16,
    marginBottom: 16,
  },
  card: {
    width: s(200),
    height: s(110),
    backgroundColor: colors.gray[800],
    borderRadius: s(16),
    padding: s(14),
    justifyContent: "center",
    alignItems: "flex-start",
    position: "relative",
  },
  daysBadge: {
    position: "absolute",
    top: s(10),
    right: s(10),
    backgroundColor: "#eb7825",
    paddingHorizontal: s(8),
    paddingVertical: vs(3),
    borderRadius: s(8),
  },
  daysBadgeText: {
    fontSize: s(11),
    fontWeight: "700",
    color: "#FFFFFF",
  },
  avatar: {
    width: s(36),
    height: s(36),
    borderRadius: s(18),
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: vs(8),
  },
  avatarText: {
    fontSize: s(14),
    fontWeight: "700",
    color: "#FFFFFF",
  },
  cardName: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#FFFFFF",
    marginBottom: vs(2),
  },
  eventLabel: {
    fontSize: s(11),
    color: "rgba(255,255,255,0.6)",
  },
  blurOverlayContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: vs(12),
  },
  upgradeCta: {
    backgroundColor: "#eb7825",
    paddingHorizontal: s(20),
    paddingVertical: vs(10),
    borderRadius: s(12),
  },
  upgradeCtaText: {
    fontSize: s(14),
    fontWeight: "700",
    color: "#FFFFFF",
  },
});

export default ElitePeopleSummary;
