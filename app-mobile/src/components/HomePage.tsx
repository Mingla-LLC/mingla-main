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
import CollaborationSessions, { CollaborationSession, Friend } from "./CollaborationSessions";
import minglaLogo from "../../assets/6850c6540f4158618f67e1fdd72281118b419a35.png";

// Moved to SwipeableCards component

interface HomePageProps {
  onOpenPreferences: () => void;
  onOpenCollaboration?: (friend?: any) => void;
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
  // Collaboration sessions props
  collaborationSessions?: CollaborationSession[];
  selectedSessionId?: string | null;
  onSessionSelect?: (sessionId: string | null) => void;
  onSoloSelect?: () => void;
  onCreateSession?: (sessionName: string, selectedFriends: Friend[]) => void;
  onAcceptInvite?: (sessionId: string) => void;
  onDeclineInvite?: (sessionId: string) => void;
  onCancelInvite?: (sessionId: string) => void;
  availableFriends?: Friend[];
  isCreatingSession?: boolean;
}

export default function HomePage({
  onOpenPreferences,
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
  // Collaboration sessions props
  collaborationSessions = [],
  selectedSessionId = null,
  onSessionSelect,
  onSoloSelect,
  onCreateSession,
  onAcceptInvite,
  onDeclineInvite,
  onCancelInvite,
  availableFriends = [],
  isCreatingSession = false,
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
              onPress={() => {
                // TODO: Navigate to notifications
              }}
              style={styles.notificationButton}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="notifications-outline" size={24} color="#1f2937" />
              {/* Notification indicator dot */}
              <View style={styles.notificationDot} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Collaboration Sessions Bar */}
        {onSessionSelect && onSoloSelect && onCreateSession && onAcceptInvite && onDeclineInvite && onCancelInvite && (
          <CollaborationSessions
            sessions={collaborationSessions}
            currentMode={currentMode}
            selectedSessionId={selectedSessionId}
            onSessionSelect={onSessionSelect}
            onSoloSelect={onSoloSelect}
            onCreateSession={onCreateSession}
            onAcceptInvite={onAcceptInvite}
            onDeclineInvite={onDeclineInvite}
            onCancelInvite={onCancelInvite}
            availableFriends={availableFriends}
            isCreatingSession={isCreatingSession}
          />
        )}

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
  notificationButton: {
    padding: 8,
    minWidth: 40,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
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
