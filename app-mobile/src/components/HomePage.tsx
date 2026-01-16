import React from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import SwipeableCards from "./SwipeableCards";
import minglaLogo from "../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png";

// Moved to SwipeableCards component

interface HomePageProps {
  onOpenPreferences: () => void;
  onOpenCollaboration: (friend?: any) => void;
  onOpenCollabPreferences?: () => void;
  currentMode: "solo" | string;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  onAddToCalendar: (experienceData: any) => void;
  savedCards?: any[];
  onSaveCard?: (card: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  onResetCards?: () => void;
  generateNewMockCard?: () => any;
  onboardingData?: any;
  refreshKey?: number | string;
  isHighlightingHeader?: boolean;
}

export default function HomePage({
  onOpenPreferences,
  onOpenCollaboration,
  onOpenCollabPreferences,
  currentMode,
  userPreferences,
  accountPreferences,
  onAddToCalendar,
  savedCards,
  onSaveCard,
  onShareCard,
  onPurchaseComplete,
  removedCardIds,
  onResetCards,
  generateNewMockCard,
  onboardingData,
  refreshKey,
  isHighlightingHeader,
}: HomePageProps) {
  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <View style={styles.container}>
        {/* Top Navigation - Fixed */}
        <View
          style={[
            styles.header,
            isHighlightingHeader && { zIndex: 1000, elevation: 1000 },
          ]}
        >
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={() => {
                if (currentMode === "solo") {
                  onOpenPreferences();
                } else {
                  onOpenCollabPreferences?.();
                }
              }}
              style={[
                styles.preferencesButton,
                currentMode !== "solo" && styles.preferencesButtonActive,
              ]}
              activeOpacity={0.6}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            >
              <Ionicons
                name="options-outline"
                size={24}
                color={currentMode !== "solo" ? "#eb7825" : "#1f2937"}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.headerCenter}>
            <View style={styles.logoContainer}>
              <Image
                source={minglaLogo}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => onOpenCollaboration()}
              style={styles.collaborateButton}
            >
              <Ionicons name="people-outline" size={18} color="#eb7825" />
              {currentMode !== "solo" ? (
                <>
                  <Text style={styles.collaborateButtonText} numberOfLines={1}>
                    {currentMode.length > 12
                      ? `${currentMode.substring(0, 12)}...`
                      : currentMode}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={16}
                    color="#eb7825"
                    style={styles.chevronIcon}
                  />
                </>
              ) : (
                <Ionicons
                  name="add"
                  size={16}
                  color="#eb7825"
                  style={styles.addIcon}
                />
              )}
              {/* Notification indicator for pending invites */}
              <View style={styles.notificationDot} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Main Content - Centered middle section */}
        <View style={styles.mainContent}>
          <SwipeableCards
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
            currentMode={currentMode}
            onAddToCalendar={onAddToCalendar}
            onCardLike={onSaveCard || (() => {})}
            onShareCard={onShareCard}
            onPurchaseComplete={onPurchaseComplete}
            removedCardIds={removedCardIds}
            onResetCards={onResetCards}
            onOpenPreferences={onOpenPreferences}
            onOpenCollabPreferences={onOpenCollabPreferences}
            generateNewMockCard={generateNewMockCard}
            onboardingData={onboardingData}
            refreshKey={refreshKey}
            savedCards={savedCards}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
    zIndex: 100,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  preferencesButton: {
    padding: 8,
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    elevation: 1000,
  },
  preferencesButtonActive: {
    backgroundColor: "#FEF3E7",
    borderRadius: 20,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    /*  aspectRatio: 3.4, */
  },
  logoContainer: {
    height: 50, // Smaller than logo height to crop top/bottom
    width: 180, // Smaller than logo width to crop left/right
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    height: 100,
    width: 220,
    resizeMode: "contain",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  collaborateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF3E7",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    position: "relative",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    minWidth: 80,
  },
  addIcon: {
    marginLeft: 2,
  },
  collaborateButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#eb7825",
    maxWidth: 100,
  },
  chevronIcon: {
    marginLeft: 2,
  },
  notificationDot: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 10,
    height: 10,
    backgroundColor: "#eb7825",
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#ffffff",
  },
  mainContent: {
    flex: 1,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
});
