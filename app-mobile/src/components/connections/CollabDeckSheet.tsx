import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import SwipeableCards from "../SwipeableCards";
import PreferencesSheet from "../PreferencesSheet";
import { Icon } from "../ui/Icon";
import { colors, fontWeights } from "../../constants/designSystem";
import { s } from "../../utils/responsive";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { RecommendationsProvider } from "../../contexts/RecommendationsContext";

interface CollabDeckSheetProps {
  visible: boolean;
  onClose: () => void;
  sessionId?: string | null;
  sessionName?: string | null;
  userPreferences: any;
  accountPreferences: any;
  savedCards: any[];
  onSaveCard?: (card: any) => Promise<boolean>;
  onShareCard?: (card: any) => void;
  onAddToCalendar?: (data: any) => void;
  onPurchaseComplete?: (data: any, opt: any) => void;
  onOpenPreferences?: () => void;
}

export function CollabDeckSheet({
  visible,
  onClose,
  sessionId,
  sessionName,
  userPreferences,
  accountPreferences,
  savedCards,
  onSaveCard,
  onShareCard,
  onAddToCalendar,
  onPurchaseComplete,
  onOpenPreferences,
}: CollabDeckSheetProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(["social", "common"]);
  const [showPrefsSheet, setShowPrefsSheet] = useState(false);

  const noop = useMemo(() => () => {}, []);
  const asyncNoop = useMemo(() => async () => false, []);
  const title = sessionName?.trim() || t("social:collabDeckSheetTitle");

  const handleOpenPreferences = useCallback(() => {
    HapticFeedback.light();
    setShowPrefsSheet(true);
  }, []);

  const handleClose = () => {
    HapticFeedback.light();
    setShowPrefsSheet(false);
    onClose();
  };

  // ORCH-1059: after a successful "Notify the group" post, return the user to
  // the group chat so they see the success toast + the posted banner in context.
  // Dismiss any open prefs sub-sheet first, then close the deck via onClose
  // (the same path the back button uses). Distinct from onSessionLost — this is
  // an intentional, success-only return, not a lost-session teardown. No haptic
  // here (the toast already confirms); avoids a double-tap feel.
  const handleAfterNotify = useCallback(() => {
    setShowPrefsSheet(false);
    onClose();
  }, [onClose]);

  /*
    #4347 rework (tester P1-2) — a route out of the deck (a claimed venue's
    page, a host's brand page) would open BEHIND this full-screen modal. The
    deck hands it here instead: close the sheet, then push once the modal is
    gone (iOS `onDismiss`; Android has no onDismiss, so its effect flushes on
    the visible -> false edge).
  */
  const router = useRouter();
  const pendingRouteRef = React.useRef<string | null>(null);
  const flushPendingRoute = useCallback(() => {
    const path = pendingRouteRef.current;
    if (path === null) return;
    pendingRouteRef.current = null;
    router.push(path as never);
  }, [router]);
  const handleExternalRoute = useCallback(
    (path: string) => {
      pendingRouteRef.current = path;
      setShowPrefsSheet(false);
      onClose();
    },
    [onClose],
  );
  React.useEffect(() => {
    if (!visible && Platform.OS !== "ios") flushPendingRoute();
  }, [visible, flushPendingRoute]);

  if (!sessionId) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      accessibilityViewIsModal
      onRequestClose={handleClose}
      onDismiss={flushPendingRoute}
    >
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={t("common:close", { defaultValue: "Close deck" })}
            hitSlop={10}
            style={({ pressed }) => [
              styles.headerButton,
              pressed ? styles.headerButtonPressed : null,
            ]}
          >
            <Icon name="chevron-back" size={26} color="#FFFFFF" />
          </Pressable>

          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>

          <Pressable
            onPress={handleOpenPreferences}
            accessibilityRole="button"
            accessibilityLabel={t("common:preferences", { defaultValue: "Preferences" })}
            hitSlop={10}
            style={({ pressed }) => [
              styles.headerButton,
              pressed ? styles.headerButtonPressed : null,
            ]}
          >
            <Icon name="settings" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.deck}>
          {/* ORCH-0939: keep CollabDeckSheet's deck inside a session-scoped
              provider so SwipeableCards reads collab data instead of the
              global currentMode="solo" provider used by Home Explore. */}
          <RecommendationsProvider
            currentMode={sessionId}
            refreshKey={0}
            persistedSessionId={sessionId}
            onSessionLost={onClose}
            key={sessionId}
          >
            <SwipeableCards
              userPreferences={userPreferences}
              accountPreferences={accountPreferences}
              currentMode={sessionId}
              sessionIdOverride={sessionId}
              boardsSessions={[]}
              onAddToCalendar={onAddToCalendar ?? noop}
              onCardLike={onSaveCard ?? asyncNoop}
              onShareCard={onShareCard}
              onPurchaseComplete={onPurchaseComplete}
              removedCardIds={[]}
              onResetCards={noop}
              onOpenPreferences={onOpenPreferences}
              onOpenCollabPreferences={handleOpenPreferences}
              onAfterNotify={handleAfterNotify}
              onExternalRoute={handleExternalRoute}
              generateNewMockCard={noop}
              refreshKey={0}
              savedCards={savedCards}
            />
          </RecommendationsProvider>
        </View>
        <PreferencesSheet
          visible={showPrefsSheet}
          onClose={() => setShowPrefsSheet(false)}
          accountPreferences={accountPreferences}
          sessionId={sessionId}
          sessionName={title}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  header: {
    minHeight: s(60),
    paddingHorizontal: s(8),
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#000000",
  },
  headerButton: {
    width: s(48),
    height: s(48),
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  title: {
    flex: 1,
    color: colors.text.inverse,
    textAlign: "center",
    fontSize: s(17),
    fontWeight: fontWeights.bold,
  },
  deck: {
    flex: 1,
  },
});
