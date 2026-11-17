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
import { Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";


import { Button } from "../src/components/ui/Button";
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

import { color, space, type } from "../src/constants/designSystem";
import { useResponsiveLayout } from "../src/hooks/useResponsiveLayout";
import { NOTIFICATIONS_COLUMN_MAX } from "../src/components/notifications/BusinessNotificationsScreen";
export default function NotificationsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();
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
        { paddingTop: insets.top, backgroundColor: color.canvas },
      ]}
    >
      <View style={[styles.chromeRow, isWideDesktop && styles.chromeRowDesktop]}>
        <IconChrome
          icon={Platform.OS === "web" ? "close" : "chevL"}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text
          style={[styles.chromeTitle, isWideDesktop && styles.chromeTitleDesktop]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          Notifications
        </Text>
        {/* ORCH-1142 four-state header cluster (DESIGN §3.2): "Mark all read"
            shows when unreadCount>0; "Clear read" shows when hasRead; both may
            co-exist (Mark all read first, Clear read rightmost); when neither,
            the 36pt spacer keeps the title centered. */}
        {/* #4420 — phone: two icon buttons (the mockup); desktop: the same
            actions as labelled quiet buttons. Both keep their a11y labels. */}
        {unreadCount > 0 || hasRead ? (
          <View style={styles.headerActions}>
            {unreadCount > 0 ? (
              isWideDesktop ? (
                <Button
                  label="Mark all read"
                  leadingIcon="check"
                  variant="secondary"
                  size="sm"
                  onPress={handleMarkAll}
                  accessibilityLabel="Mark all notifications as read"
                />
              ) : (
                <IconChrome
                  icon="check"
                  onPress={handleMarkAll}
                  accessibilityLabel="Mark all notifications as read"
                />
              )
            ) : null}
            {hasRead ? (
              isWideDesktop ? (
                <Button
                  label="Clear read"
                  leadingIcon="trash"
                  variant="secondary"
                  size="sm"
                  onPress={handleClearReadPress}
                  accessibilityLabel="Clear read notifications"
                />
              ) : (
                <IconChrome
                  icon="trash"
                  onPress={handleClearReadPress}
                  accessibilityLabel="Clear read notifications"
                />
              )
            ) : null}
          </View>
        ) : null}
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
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[2],
    gap: space[3],
  },
  // #4420 — on desktop the header sits on the same column as the list.
  chromeRowDesktop: {
    width: "100%",
    maxWidth: NOTIFICATIONS_COLUMN_MAX,
    alignSelf: "center",
  },
  chromeTitle: {
    flex: 1,
    minWidth: 0,
    ...type.h2,
    color: color.text1,
  },
  chromeTitleDesktop: {
    ...type.h1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: space[2],
  },
});
