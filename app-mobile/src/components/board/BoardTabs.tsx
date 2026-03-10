import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
export type BoardTab = "swipe" | "saved" | "discussion";

interface BoardTabsProps {
  activeTab: BoardTab;
  onTabChange: (tab: BoardTab) => void;
  swipeCount?: number;
  savedCount?: number;
  unreadMessages?: number;
  canGenerateCards?: boolean;
}

export const BoardTabs: React.FC<BoardTabsProps> = ({
  activeTab,
  onTabChange,
  swipeCount = 0,
  savedCount = 0,
  unreadMessages = 0,
  canGenerateCards = false,
}) => {
  const tabs: Array<{
    id: BoardTab;
    label: string;
    count?: number;
  }> = [
    ...(canGenerateCards
      ? [
          {
            id: "swipe" as BoardTab,
            label: "Swipe",
            count: swipeCount > 0 ? swipeCount : undefined,
          },
        ]
      : []),
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
            <View
              key={tab.id}
              style={styles.tab}
            >
              <TouchableOpacity
                style={styles.tabTouchable}
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
            </View>
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
    borderBottomColor: "#F3F4F6",
    paddingBottom: 0,
  },
  tabsContainer: {
    flexDirection: "row",
  },
  tab: {
    flex: 1,
    position: "relative",
  },
  tabTouchable: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#9CA3AF",
    letterSpacing: 0.2,
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
    bottom: -1,
    left: 16,
    right: 16,
    height: 3,
    backgroundColor: "#eb7825",
    borderRadius: 1.5,
  },
});
