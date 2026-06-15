/**
 * Notifications route — META-ORCH-1074 Sub-C.
 *
 * Full-screen expo-router route (NOT a bottom sheet — SUB-C_DESIGN §1) reached
 * from the TopBar bell (`router.push("/notifications")`). Mounts the upgraded
 * BusinessNotificationsScreen under a lightweight chrome header (mirrors
 * account/notifications.tsx): back/close left, centred "Notifications" title,
 * "Mark all read" right when there are unread rows.
 *
 * Web-preview: the same route renders as a normal page (`close` affordance,
 * capped-width column inside the screen). No push (OneSignal is native-only;
 * the inbox + mark-read all run from the DB).
 *
 * I-21: operator-side route. Never imported by anon-tolerant buyer routes.
 */

import React, { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  spacing,
  text as textTokens,
} from "../src/constants/designSystem";
import { Icon } from "../src/components/ui/Icon";
import { IconChrome } from "../src/components/ui/IconChrome";
import { ConfirmDialog } from "../src/components/ui/ConfirmDialog";
import { BusinessNotificationsScreen } from "../src/components/notifications/BusinessNotificationsScreen";
import { useBusinessNotificationsInbox } from "../src/hooks/useBusinessNotifications";
import { useAuth } from "../src/context/AuthContext";
import {
  resolveBusinessNavTarget,
  type BusinessPushData,
} from "../src/services/businessNotificationRouting";
import { HapticFeedback } from "../src/utils/hapticFeedback";
import type { BusinessNotification } from "../src/hooks/useBusinessNotifications";

export default function NotificationsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { unreadCount, markAllAsRead, notifications, clearRead, hasRead } =
    useBusinessNotificationsInbox(userId);

  // ORCH-1142: "Clear read" opens a confirm (unlike "Mark all read", which is
  // non-destructive + immediate). The read count is FROZEN at open time so a
  // background realtime insert can't change the dialog copy mid-read.
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [frozenReadCount, setFrozenReadCount] = useState(0);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/home" as never);
    }
  }, [router]);

  const handleMarkAll = useCallback((): void => {
    if (Platform.OS !== "web") HapticFeedback.success();
    void markAllAsRead();
  }, [markAllAsRead]);

  const handleClearReadPress = useCallback((): void => {
    if (Platform.OS !== "web") HapticFeedback.buttonPress();
    setFrozenReadCount(notifications.filter((n) => n.read_at !== null).length);
    setConfirmVisible(true);
  }, [notifications]);

  const handleClearReadConfirm = useCallback((): void => {
    if (Platform.OS !== "web") HapticFeedback.success();
    void clearRead();
    setConfirmVisible(false);
  }, [clearRead]);

  const clearReadDescription =
    frozenReadCount === 1
      ? "This removes 1 read notification from your inbox. Unread ones stay. You can’t undo this here."
      : `This removes ${frozenReadCount} read notifications from your inbox. Unread ones stay. You can’t undo this here.`;

  // Tap on a row → resolve the row's deep link / type to an expo-router path
  // and navigate (the same routing map Sub-B's push tap uses). The screen
  // already marked the row read optimistically.
  const handleOpenDeepLink = useCallback(
    (deepLink: string, n: BusinessNotification): void => {
      const data: BusinessPushData = {
        type: n.type,
        deepLink,
        brandId: n.brand_id ?? undefined,
        ...(n.data ?? {}),
      };
      const target = resolveBusinessNavTarget(data);
      router.push(target as never);
    },
    [router],
  );

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      <View style={styles.chromeRow}>
        <IconChrome
          icon={Platform.OS === "web" ? "close" : "chevL"}
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Notifications</Text>
        {/* ORCH-1142 four-state header cluster (DESIGN §3.2): "Mark all read"
            shows when unreadCount>0; "Clear read" shows when hasRead; both may
            co-exist (Mark all read first, Clear read rightmost); when neither,
            the 36pt spacer keeps the title centered. */}
        {unreadCount > 0 || hasRead ? (
          <View style={styles.headerActions}>
            {unreadCount > 0 ? (
              <Pressable
                onPress={handleMarkAll}
                accessibilityRole="button"
                accessibilityLabel="Mark all notifications as read"
                accessibilityHint="Marks every unread notification as read"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={({ pressed }) => [
                  styles.markAll,
                  pressed ? styles.markAllPressed : null,
                ]}
              >
                <Icon name="check" size={16} color={accent.warm} />
                <Text style={styles.markAllLabel}>Mark all read</Text>
              </Pressable>
            ) : null}
            {hasRead ? (
              <Pressable
                onPress={handleClearReadPress}
                accessibilityRole="button"
                accessibilityLabel="Clear read notifications"
                accessibilityHint="Removes read notifications from your inbox; unread stay"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={({ pressed }) => [
                  styles.markAll,
                  pressed ? styles.markAllPressed : null,
                ]}
              >
                <Icon name="trash" size={16} color={accent.warm} />
                <Text style={styles.markAllLabel}>Clear read</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.chromeRightSlot} />
        )}
      </View>

      <BusinessNotificationsScreen
        userId={userId}
        onOpenDeepLink={handleOpenDeepLink}
      />

      <ConfirmDialog
        visible={confirmVisible}
        onClose={(): void => setConfirmVisible(false)}
        onConfirm={handleClearReadConfirm}
        variant="simple"
        destructive
        title="Clear read notifications?"
        description={clearReadDescription}
        confirmLabel="Clear read"
        cancelLabel="Cancel"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 20,
    lineHeight: 32,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  // ORCH-1142 — header action cluster when both "Mark all read" and "Clear
  // read" are present (DESIGN §3.3). Mark-all first, Clear-read rightmost.
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.md,
  },
  markAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    minWidth: 36,
    justifyContent: "flex-end",
  },
  markAllPressed: {
    opacity: 0.7,
  },
  markAllLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: accent.warm,
  },
});
