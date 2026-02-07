import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import SavedTab from "./activity/SavedTab";
import CalendarTab from "./activity/CalendarTab";
import { useAppState } from "./AppStateManager";

// Tab types for Likes screen
export type LikesTab = "saved" | "calendar";

interface LikesTabsProps {
  activeTab: LikesTab;
  onTabChange: (tab: LikesTab) => void;
}

// Reusable Tabs component
const LikesTabs: React.FC<LikesTabsProps> = ({
  activeTab,
  onTabChange,
}) => {
  const tabs: Array<{ id: LikesTab; label: string; icon: string }> = [
    { id: "saved", label: "Saved", icon: "bookmark-outline" },
    { id: "calendar", label: "Calendar", icon: "calendar-outline" },
  ];

  return (
    <View style={styles.tabsWrapper}>
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
              <Ionicons
                name={tab.icon as any}
                size={18}
                color={isActive ? "#FFFFFF" : "#6B7280"}
                style={styles.tabIcon}
              />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

interface LikesPageProps {
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  calendarEntries?: any[];
  isLoadingSavedCards?: boolean;
  onScheduleFromSaved?: (savedCard: any) => void;
  onPurchaseFromSaved?: (card: any, purchaseOption: any) => void;
  onRemoveFromCalendar?: (entry: any) => void;
  onShareCard?: (card: any) => void;
  onAddToCalendar?: (entry: any) => void;
  onShowQRCode?: (entryId: string) => void;
  navigationData?: {
    activeTab?: LikesTab;
  } | null;
  onNavigationComplete?: () => void;
}

export default function LikesPage({
  userPreferences,
  accountPreferences,
  calendarEntries = [],
  isLoadingSavedCards = false,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onRemoveFromCalendar,
  onShareCard,
  onAddToCalendar,
  onShowQRCode,
  navigationData,
  onNavigationComplete,
}: LikesPageProps) {
  const [activeTab, setActiveTab] = useState<LikesTab>("saved");

  // Handle navigation from external sources
  React.useEffect(() => {
    if (navigationData) {
      if (navigationData.activeTab) {
        setActiveTab(navigationData.activeTab);
      }
      // Clear navigation data after processing
      if (onNavigationComplete) {
        onNavigationComplete();
      }
    }
  }, [navigationData, onNavigationComplete]);

  const handleTabChange = (tab: LikesTab) => {
    setActiveTab(tab);
  };

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <LikesTabs activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Content */}
      <View style={styles.content}>
        {activeTab === "saved" && (
          <SavedTab
            isLoading={isLoadingSavedCards}
            onScheduleFromSaved={onScheduleFromSaved || (() => {})}
            onPurchaseFromSaved={onPurchaseFromSaved || (() => {})}
            onShareCard={onShareCard || (() => {})}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
          />
        )}

        {activeTab === "calendar" && (
          <CalendarTab
            calendarEntries={calendarEntries}
            onRemoveFromCalendar={onRemoveFromCalendar || (() => {})}
            onShareCard={onShareCard || (() => {})}
            onAddToCalendar={onAddToCalendar || (() => {})}
            onShowQRCode={onShowQRCode || (() => {})}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  // Tabs styles
  tabsWrapper: {
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e1e5e9",
    paddingHorizontal: 16,
  },
  tabsContainer: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    marginVertical: 12,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    marginHorizontal: 4,
    gap: 6,
  },
  tabActive: {
    backgroundColor: "#eb7825",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  tabIcon: {
    marginRight: 2,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: "#6B7280",
  },
  tabLabelActive: {
    color: "#FFFFFF",
  },
  // Content styles
  content: {
    flex: 1,
  },
});
