import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type BoardTab = "swipe" | "saved" | "discussion";

interface BoardTabsProps {
  activeTab: BoardTab;
  onTabChange: (tab: BoardTab) => void;
  swipeCount?: number;
  savedCount?: number;
  unreadMessages?: number;
}

export const BoardTabs: React.FC<BoardTabsProps> = ({
  activeTab,
  onTabChange,
  swipeCount = 0,
  savedCount = 0,
  unreadMessages = 0,
}) => {
  const tabs: Array<{
    id: BoardTab;
    label: string;
    count?: number;
  }> = [
    {
      id: "saved",
      label: "Cards",
      count: savedCount,
    },
    {
      id: "discussion",
      label: "Discussion",
      count: unreadMessages > 0 ? unreadMessages : undefined,
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.tabsContainer}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tab}
              onPress={() => onTabChange(tab.id)}
              activeOpacity={0.7}
            >
              <View style={styles.tabContent}>
                <Text
                  style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                >
                  {tab.label} ({tab.count ?? 0})
                </Text>
              </View>
              {isActive && <View style={styles.activeIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  tabsContainer: {
    flexDirection: "row",
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: "#9CA3AF",
  },
  tabLabelActive: {
    color: "#eb7825",
    fontWeight: "600",
  },
  tabContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  activeIndicator: {
    position: "absolute",
    bottom: 0,
    left: 16,
    right: 16,
    height: 2,
    backgroundColor: "#eb7825",
    borderRadius: 1,
  },
});
