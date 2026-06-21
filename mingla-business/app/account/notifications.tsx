/**
 * Notification settings route — Cycle 14 J-A2 + META-ORCH-1074 Sub-C/Sub-D.
 *
 * Cycle 14 shipped 4 coarse master toggles (Zustand-backed). META-ORCH-1074
 * extends this to the 6-master layout (SUB-C_DESIGN §8 / SUB-D §5):
 *   - Order activity (existing master) → order_paid, event_sold_out,
 *     low_inventory, refund_processed
 *   - Payments & trust (NEW master) → dispute_opened, dispute_action_needed,
 *     payout_paid, account_status_changed
 *   - Audience & content (NEW master) → new_review
 *   - Brand team (existing master) → team_member_joined, claim_decision
 *   - Scanner activity (existing, no v1 child types) — unchanged
 *   - Marketing (existing, creator_accounts-backed) — unchanged
 *
 * Master-with-children rows expand to reveal per-type child rows, each with a
 * Push + In-app toggle persisting to `notification_preferences` (so
 * notify-dispatch honors them — NOT only Zustand). Master OFF disables +
 * writes opt_in=false for every child (SUB-C_DESIGN §8.1). The two NEW masters
 * (Payments & trust, Audience & content) are derived ON when any child is on.
 *
 * I-21: operator-side route. NEVER imported by anon-tolerant buyer routes.
 *
 * Per Cycle 14 SPEC §4.7.3 + SPEC_META-ORCH-1074_SUB-C_DESIGN.md §8.
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
import {
  useNotificationTypePrefs,
  type PrefChannel,
} from "../../src/hooks/useNotificationTypePrefs";
import { useAuth } from "../../src/context/AuthContext";
import type { BusinessNotificationType } from "../../src/constants/businessNotificationTemplates";
// META-ORCH-1187 [Growth Analytics Hub] §4.F(b) — in-app analytics opt-out.
// This account/settings screen (reachable from the Settings hub) is the
// user-facing host for the Analytics toggle. (Resolves the spec's STOP-AND-AMEND
// premise: a real account-settings screen DOES exist beyond AriSettingsScreen.)
import { useAnalyticsPrefsStore } from "../../src/store/analyticsPrefsStore";
import { postHogService } from "../../src/services/postHogService";

import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";

// ── Master + child config (SUB-C_DESIGN §8.2) ────────────────────────────────

interface ChildType {
  readonly type: BusinessNotificationType;
  readonly label: string;
  readonly description: string;
}

const ORDER_CHILDREN: readonly ChildType[] = [
  { type: "business.order_paid", label: "New sale", description: "When a ticket sells" },
  { type: "business.event_sold_out", label: "Sold out", description: "When a listing sells out" },
  { type: "business.low_inventory", label: "Almost gone", description: "When inventory runs low" },
  { type: "business.refund_processed", label: "Refunds", description: "When a refund is processed" },
];

const PAYMENTS_CHILDREN: readonly ChildType[] = [
  { type: "business.dispute_opened", label: "Disputes opened", description: "When a buyer disputes a charge" },
  { type: "business.dispute_action_needed", label: "Evidence due", description: "When you must submit dispute evidence" },
  { type: "business.payout_paid", label: "Payouts", description: "When money lands in your bank" },
  { type: "business.account_status_changed", label: "Account status", description: "When Stripe pauses or restores payments" },
];

const AUDIENCE_CHILDREN: readonly ChildType[] = [
  { type: "business.new_review", label: "New reviews", description: "When someone reviews your brand" },
];

const TEAM_CHILDREN: readonly ChildType[] = [
  { type: "business.team_member_joined", label: "Teammate joined", description: "When an invited teammate accepts" },
  { type: "business.claim_decision", label: "Claim decisions", description: "When a venue claim is approved or declined" },
];

export default function NotificationsRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { data: account } = useCreatorAccount();
  const { mutateAsync: updateAccount } = useUpdateCreatorAccount();
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const setPref = useNotificationPrefsStore((s) => s.setPref);
  const hydrateMarketing = useNotificationPrefsStore(
    (s) => s.hydrateMarketingFromBackend,
  );
  const typePrefs = useNotificationTypePrefs(userId);

  // META-ORCH-1187 — analytics opt-out. Toggle ON = sharing usage data
  // (analyticsOptOut=false). Flipping OFF calls postHogService.optOut() so
  // subsequent events do NOT reach PostHog (T-19); ON resumes capture.
  const analyticsOptOut = useAnalyticsPrefsStore((s) => s.analyticsOptOut);
  const setAnalyticsOptOut = useAnalyticsPrefsStore((s) => s.setAnalyticsOptOut);
  const handleAnalyticsToggle = useCallback((shareEnabled: boolean): void => {
    const optOut = !shareEnabled;
    setAnalyticsOptOut(optOut);
    if (optOut) {
      postHogService.optOut();
    } else {
      postHogService.optIn();
    }
  }, [setAnalyticsOptOut]);

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const toggleExpand = useCallback((key: string): void => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Zustand master toggle (Order / Scanner / Brand team / Marketing).
  const handleZustandToggle = useCallback(
    async (key: keyof NotificationPrefs, value: boolean): Promise<void> => {
      setPref(key, value);
      if (key === "marketing") {
        try {
          await updateAccount({ marketing_opt_in: value });
        } catch {
          showToast("Couldn't save. Tap to try again.");
          setPref(key, !value);
        }
      }
    },
    [setPref, updateAccount, showToast],
  );

  // A master with children gates them: master OFF writes opt_in=false for
  // every child (push + in_app) so the backend honors the master too.
  const handleMasterWithChildren = useCallback(
    async (
      zustandKey: keyof NotificationPrefs | null,
      children: readonly ChildType[],
      value: boolean,
    ): Promise<void> => {
      if (zustandKey !== null) {
        setPref(zustandKey, value);
      }
      try {
        await typePrefs.setMany(
          children.map((c) => c.type),
          value,
        );
      } catch {
        showToast("Couldn't save. Tap to try again.");
        if (zustandKey !== null) setPref(zustandKey, !value);
      }
    },
    [setPref, typePrefs, showToast],
  );

  const handleChildToggle = useCallback(
    async (
      type: BusinessNotificationType,
      channel: PrefChannel,
      value: boolean,
    ): Promise<void> => {
      try {
        await typePrefs.setPref(type, channel, value);
      } catch {
        showToast("Couldn't save. Tap to try again.");
      }
    },
    [typePrefs, showToast],
  );

  // Derived master-ON for the two NEW masters: ON when ANY child push/in-app on.
  const anyChildOn = (children: readonly ChildType[]): boolean =>
    children.some(
      (c) => typePrefs.isOn(c.type, "push") || typePrefs.isOn(c.type, "in_app"),
    );

  const paymentsMasterOn = anyChildOn(PAYMENTS_CHILDREN);
  const audienceMasterOn = anyChildOn(AUDIENCE_CHILDREN);

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
        {/* Order activity (master ON gates 4 children) */}
        <MasterCard
          label="Order activity"
          description="Sales, sold-out, low inventory, and refunds"
          masterOn={prefs.orderActivity}
          expanded={!!expanded.order}
          onToggleExpand={() => toggleExpand("order")}
          onToggleMaster={(v) =>
            void handleMasterWithChildren("orderActivity", ORDER_CHILDREN, v)
          }
          children_={ORDER_CHILDREN}
          isOn={typePrefs.isOn}
          onChild={handleChildToggle}
        />

        {/* Payments & trust (NEW master) */}
        <MasterCard
          label="Payments & trust"
          description="Disputes, payouts, and account status"
          masterOn={paymentsMasterOn}
          expanded={!!expanded.payments}
          onToggleExpand={() => toggleExpand("payments")}
          onToggleMaster={(v) =>
            void handleMasterWithChildren(null, PAYMENTS_CHILDREN, v)
          }
          children_={PAYMENTS_CHILDREN}
          isOn={typePrefs.isOn}
          onChild={handleChildToggle}
        />

        {/* Audience & content (NEW master) */}
        <MasterCard
          label="Audience & content"
          description="Reviews and audience activity"
          masterOn={audienceMasterOn}
          expanded={!!expanded.audience}
          onToggleExpand={() => toggleExpand("audience")}
          onToggleMaster={(v) =>
            void handleMasterWithChildren(null, AUDIENCE_CHILDREN, v)
          }
          children_={AUDIENCE_CHILDREN}
          isOn={typePrefs.isOn}
          onChild={handleChildToggle}
        />

        {/* Brand team (master ON gates 2 children) */}
        <MasterCard
          label="Brand team"
          description="Teammates joining and venue-claim decisions"
          masterOn={prefs.brandTeam}
          expanded={!!expanded.team}
          onToggleExpand={() => toggleExpand("team")}
          onToggleMaster={(v) =>
            void handleMasterWithChildren("brandTeam", TEAM_CHILDREN, v)
          }
          children_={TEAM_CHILDREN}
          isOn={typePrefs.isOn}
          onChild={handleChildToggle}
        />

        {/* Scanner activity (existing, no v1 children) */}
        <GlassCard variant="elevated" radius="md" padding={spacing.md}>
          <SimpleToggleRow
            label="Scanner activity"
            description="When scanners check in guests at the door"
            value={prefs.scannerActivity}
            onToggle={(v) => void handleZustandToggle("scannerActivity", v)}
          />
        </GlassCard>

        {/* Marketing (existing, creator_accounts-backed) */}
        <GlassCard variant="elevated" radius="md" padding={spacing.md}>
          <SimpleToggleRow
            label="Marketing"
            description="Newsletter and product updates from Mingla"
            value={prefs.marketing}
            onToggle={(v) => void handleZustandToggle("marketing", v)}
          />
        </GlassCard>

        {/* META-ORCH-1187 [Growth Analytics Hub] — Privacy: analytics opt-out.
            Toggle ON = sharing anonymous usage data (analyticsOptOut=false). */}
        <GlassCard variant="elevated" radius="md" padding={spacing.md}>
          <SimpleToggleRow
            label="Analytics"
            description="Help improve Mingla by sharing anonymous usage data. You can turn this off any time."
            value={!analyticsOptOut}
            onToggle={handleAnalyticsToggle}
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

// ── Master card with expandable children ─────────────────────────────────────

interface MasterCardProps {
  label: string;
  description: string;
  masterOn: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleMaster: (value: boolean) => void;
  children_: readonly ChildType[];
  isOn: (type: BusinessNotificationType, channel: PrefChannel) => boolean;
  onChild: (
    type: BusinessNotificationType,
    channel: PrefChannel,
    value: boolean,
  ) => void;
}

const MasterCard: React.FC<MasterCardProps> = ({
  label,
  description,
  masterOn,
  expanded,
  onToggleExpand,
  onToggleMaster,
  children_,
  isOn,
  onChild,
}) => (
  <GlassCard variant="elevated" radius="md" padding={spacing.md}>
    <View style={styles.masterRow}>
      <Pressable
        onPress={onToggleExpand}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${expanded ? "collapse" : "expand"} options`}
        style={styles.masterText}
      >
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDescription} numberOfLines={2}>
          {description}
        </Text>
      </Pressable>
      <Pressable
        onPress={onToggleExpand}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse" : "Expand"}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon
          name={expanded ? "chevU" : "chevD"}
          size={16}
          color={textTokens.tertiary}
        />
      </Pressable>
      <Switch
        value={masterOn}
        onValueChange={onToggleMaster}
        trackColor={{ false: "rgba(255, 255, 255, 0.12)", true: accent.warm }}
        thumbColor="#ffffff"
        accessibilityLabel={`${label} master toggle`}
      />
    </View>

    {expanded ? (
      <View>
        {!masterOn ? (
          <Text style={styles.masterOffNote}>
            Turn on {label} to choose which alerts you get.
          </Text>
        ) : null}
        {children_.map((child) => (
          <View
            key={child.type}
            style={[styles.childRow, !masterOn ? styles.childDisabled : null]}
          >
            <View style={styles.childTextCol}>
              <Text style={styles.childLabel}>{child.label}</Text>
              <Text style={styles.childDescription} numberOfLines={1}>
                {child.description}
              </Text>
            </View>
            <View style={styles.childToggles}>
              <ChannelToggle
                label="PUSH"
                value={isOn(child.type, "push")}
                disabled={!masterOn}
                onToggle={(v) => onChild(child.type, "push", v)}
                a11y={`${child.label} push`}
              />
              <ChannelToggle
                label="IN-APP"
                value={isOn(child.type, "in_app")}
                disabled={!masterOn}
                onToggle={(v) => onChild(child.type, "in_app", v)}
                a11y={`${child.label} in-app`}
              />
            </View>
          </View>
        ))}
      </View>
    ) : null}
  </GlassCard>
);

interface ChannelToggleProps {
  label: string;
  value: boolean;
  disabled: boolean;
  onToggle: (value: boolean) => void;
  a11y: string;
}

const ChannelToggle: React.FC<ChannelToggleProps> = ({
  label,
  value,
  disabled,
  onToggle,
  a11y,
}) => (
  <View style={styles.channelCol}>
    <Text style={styles.channelLabel}>{label}</Text>
    <Switch
      value={value}
      onValueChange={onToggle}
      disabled={disabled}
      trackColor={{ false: "rgba(255, 255, 255, 0.12)", true: accent.warm }}
      thumbColor="#ffffff"
      accessibilityLabel={a11y}
      accessibilityState={{ checked: value, disabled }}
    />
  </View>
);

// ── Simple single-toggle row (Scanner / Marketing) ───────────────────────────

interface SimpleToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  onToggle: (value: boolean) => void;
}

const SimpleToggleRow: React.FC<SimpleToggleRowProps> = ({
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

  // Master row
  masterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  masterText: {
    flex: 1,
    minWidth: 0,
  },
  masterOffNote: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },

  // Child rows
  childRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  childDisabled: {
    opacity: 0.4,
  },
  childTextCol: {
    flex: 1,
    minWidth: 0,
  },
  childLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  childDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.secondary,
  },
  childToggles: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  channelCol: {
    alignItems: "center",
    gap: 2,
  },
  channelLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
  },

  // Simple toggle rows
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

  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },
});
