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
    icon: string;
    badge?: number;
  }> = [
    {
      id: "saved",
      label: `Cards (${savedCount})`,
      icon: "bookmark",
    },
    {
      id: "discussion",
      label: "Discussion",
      icon: "chatbubbles",
      badge: unreadMessages > 0 ? unreadMessages : undefined,
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
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onTabChange(tab.id)}
              activeOpacity={0.7}
            >
              <View style={styles.tabContent}>
                <Text
                  style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                >
                  {tab.label}
                </Text>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {tab.badge > 99 ? "99+" : tab.badge}
                    </Text>
                  </View>
                )}
              </View>
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
    borderBottomColor: "#e1e5e9",
    paddingHorizontal: 8,
  },
  tabsContainer: {
    flexDirection: "row",
    paddingHorizontal: 8,
    backgroundColor: "#f3f4f6",
    borderRadius: 24,
    paddingVertical: 4,
    marginVertical: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    marginHorizontal: 4,
  },
  tabActive: {
    backgroundColor: "white",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
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
  badge: {
    backgroundColor: "#eb7825",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "600",
  },
});
