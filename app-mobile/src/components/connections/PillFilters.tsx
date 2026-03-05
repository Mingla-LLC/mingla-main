import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type PillId = "add" | "requests" | "blocked" | "invite";

interface Pill {
  id: PillId;
  label: string;
  icon: string;
  badgeCount?: number;
}

interface PillFiltersProps {
  activePill: PillId | null;
  onPillPress: (id: PillId) => void;
  requestCount: number;
}

const PILLS: Omit<Pill, "badgeCount">[] = [
  { id: "add", label: "Add", icon: "person-add-outline" },
  { id: "requests", label: "Requests", icon: "people-outline" },
  { id: "blocked", label: "Blocked", icon: "ban-outline" },
  { id: "invite", label: "Invite", icon: "link-outline" },
];

export function PillFilters({
  activePill,
  onPillPress,
  requestCount,
}: PillFiltersProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      style={styles.container}
    >
      {PILLS.map((pill) => {
        const isActive = activePill === pill.id;
        const badgeCount = pill.id === "requests" ? requestCount : 0;

        return (
          <TouchableOpacity
            key={pill.id}
            onPress={() => onPillPress(pill.id)}
            style={[styles.pill, isActive && styles.pillActive]}
            activeOpacity={0.7}
          >
            <Ionicons
              name={pill.icon as any}
              size={16}
              color={isActive ? "#ffffff" : "#eb7825"}
              style={styles.pillIcon}
            />
            <Text style={[styles.pillLabel, isActive && styles.pillLabelActive]}>
              {pill.label}
            </Text>

            {badgeCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {badgeCount > 9 ? "9+" : badgeCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#eb7825",
    backgroundColor: "transparent",
    position: "relative",
  },
  pillActive: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  pillIcon: {
    marginRight: 6,
  },
  pillLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#eb7825",
  },
  pillLabelActive: {
    color: "#ffffff",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 16,
    height: 16,
    backgroundColor: "#ef4444",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    color: "#ffffff",
    fontWeight: "700",
  },
});
