import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import SavedTab from "./activity/SavedTab";
import CalendarTab from "./activity/CalendarTab";
import { useAppState } from "./AppStateManager";
import { mixpanelService } from "../services/mixpanelService";
import { useScreenLogger } from "../hooks/useScreenLogger";
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
    { id: "saved", label: "Saved", icon: "bookmark" },
    { id: "calendar", label: "Calendar", icon: "calendar" },
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
              <View style={styles.tabContent}>
                <Feather
                  name={tab.icon as any}
                  size={20}
                  color={isActive ? "#eb7825" : "#6B7280"}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </View>
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
  useScreenLogger('likes');
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
    mixpanelService.trackTabViewed({ screen: "Likes", tab: tab === "saved" ? "Saved" : "Calendar" });
  };

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <LikesTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

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
    backgroundColor: "#f5f5f5",
  },
  // Tabs styles
  tabsWrapper: {
    backgroundColor: "#FFFFFF",
  },
  tabsContainer: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: "#eb7825",
  },
  tabContent: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6B7280",
  },
  tabLabelActive: {
    color: "#eb7825",
  },
  // Content styles
  content: {
    flex: 1,
  },
});
