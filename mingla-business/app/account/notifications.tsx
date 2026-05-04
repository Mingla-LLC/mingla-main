/**
 * Notification settings route — Cycle 14 J-A2 (DEC-096 D-14-4..D-14-7).
 *
 * D-14-4: 4 categories (Order activity / Scanner activity / Brand team / Marketing)
 * D-14-5: TRANSITIONAL toggles only — B-cycle wires real delivery
 * D-14-6: GDPR-favored defaults — transactional ON · marketing OFF
 * D-14-7: Zustand persist + sync marketing to creator_accounts.marketing_opt_in only
 *
 * I-21: operator-side route. NEVER imported by anon-tolerant buyer routes.
 *
 * ORCH-0710: ALL hooks declared BEFORE any conditional early-return.
 *
 * [TRANSITIONAL] Toggles save to local Zustand store + (marketing only)
 * creator_accounts.marketing_opt_in. Real push/email delivery wires up in
 * B-cycle (OneSignal SDK + Resend + edge fn + user_notification_prefs table).
 *
 * Per Cycle 14 SPEC §4.7.3.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import {
  useCreatorAccount,
  useUpdateCreatorAccount,
} from "../../src/hooks/useCreatorAccount";
import {
  useNotificationPrefsStore,
  type NotificationPrefs,
} from "../../src/store/notificationPrefsStore";

import { GlassCard } from "../../src/components/ui/GlassCard";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";

export default function NotificationsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: account } = useCreatorAccount();
  const { mutateAsync: updateAccount } = useUpdateCreatorAccount();
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const setPref = useNotificationPrefsStore((s) => s.setPref);
  const hydrateMarketing = useNotificationPrefsStore(
    (s) => s.hydrateMarketingFromBackend,
  );
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // Hydrate marketing toggle from canonical schema column once
  useEffect(() => {
    if (account !== null) {
      hydrateMarketing(account.marketing_opt_in);
    }
  }, [account, hydrateMarketing]);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  const handleToggle = useCallback(
    async (key: keyof NotificationPrefs, value: boolean): Promise<void> => {
      setPref(key, value);
      if (key === "marketing") {
        // DOUBLE-WIRE per D-14-7: also persist to creator_accounts.marketing_opt_in.
        try {
          await updateAccount({ marketing_opt_in: value });
        } catch (_err) {
          showToast("Couldn't save. Tap to try again.");
          // Revert local toggle on backend failure (single source of truth = backend)
          setPref(key, !value);
        }
      }
    },
    [setPref, updateAccount, showToast],
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
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Back"
        />
        <Text style={styles.chromeTitle}>Notifications</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* TRANSITIONAL banner — D-14-5 */}
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>NOTIFICATION SETTINGS</Text>
          <Text style={styles.bannerBody}>
            Toggles save now; delivery wires up when the backend ships in
            B-cycle.
          </Text>
        </View>

        {/* 4 category toggles */}
        <GlassCard variant="elevated" radius="md" padding={spacing.md}>
          <ToggleRow
            label="Order activity"
            description="When buyers purchase, refund, or cancel"
            value={prefs.orderActivity}
            onToggle={(v) => {
              void handleToggle("orderActivity", v);
            }}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Scanner activity"
            description="When scanners check in guests at the door"
            value={prefs.scannerActivity}
            onToggle={(v) => {
              void handleToggle("scannerActivity", v);
            }}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Brand team"
            description="When team invitations are accepted or roles change"
            value={prefs.brandTeam}
            onToggle={(v) => {
              void handleToggle("brandTeam", v);
            }}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Marketing"
            description="Newsletter and product updates from Mingla"
            value={prefs.marketing}
            onToggle={(v) => {
              void handleToggle("marketing", v);
            }}
          />
        </GlassCard>
      </ScrollView>

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

// ============================================================
// ToggleRow (composed inline)
// ============================================================

interface ToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  onToggle: (value: boolean) => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  description,
  value,
  onToggle,
}) => (
  <Pressable
    onPress={() => onToggle(!value)}
    accessibilityRole="switch"
    accessibilityState={{ checked: value }}
    accessibilityLabel={label}
    style={styles.toggleRow}
  >
    <View style={styles.toggleCol}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Text style={styles.toggleDescription} numberOfLines={2}>
        {description}
      </Text>
    </View>
    <Switch
      value={value}
      onValueChange={onToggle}
      trackColor={{ false: "rgba(255, 255, 255, 0.12)", true: accent.warm }}
      thumbColor="#ffffff"
    />
  </Pressable>
);

// ============================================================
// Styles
// ============================================================

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
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },

  // TRANSITIONAL banner ----------------------------------------------
  banner: {
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.30)",
  },
  bannerTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: accent.warm,
    marginBottom: 4,
  },
  bannerBody: {
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
  },

  // Toggle rows ------------------------------------------------------
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleCol: {
    flex: 1,
    minWidth: 0,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.secondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginVertical: 2,
  },

  // Toast ------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
