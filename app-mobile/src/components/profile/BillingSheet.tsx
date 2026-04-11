import React, { useState, useMemo } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Pressable,
  Alert,
  Platform,
  Linking,
  useWindowDimensions,
} from "react-native";
import { Icon } from "../ui/Icon";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "../../store/appStore";
import { useRestorePurchases } from "../../hooks/useRevenueCat";
import {
  useEffectiveTier,
  useSubscription,
  useTrialDaysRemaining,
  useTrialTotalDays,
  useReferralDaysRemaining,
} from "../../hooks/useSubscription";
import type { SubscriptionTier } from "../../types/subscription";
import { CustomPaywallScreen } from "../CustomPaywallScreen";
import { getCustomerInfo } from "../../services/revenueCatService";

// --- Tier configuration ---

interface TierConfig {
  name: string;
  icon: string;
  description: string;
  perks: string[];
}

const TIERS: Record<SubscriptionTier, TierConfig> = {
  free: {
    name: "Free Plan",
    icon: "person-outline",
    description: "The essentials to start exploring.",
    perks: [
      "Unlimited swipes",
      "1 active pairing",
      "1 board session",
      "View curated experiences",
    ],
  },
  mingla_plus: {
    name: "Mingla+",
    icon: "diamond",
    description: "Everything unlocked. No limits.",
    perks: [
      "Unlimited swipes",
      "Unlimited pairings",
      "Unlimited board sessions",
      "Save curated experiences",
      "Set your own starting point",
    ],
  },
};

const TIER_ORDER: SubscriptionTier[] = ["free", "mingla_plus"];

const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, mingla_plus: 1 };

// --- CTA helpers ---

function getCtaLabel(tier: SubscriptionTier, isUpgrade: boolean): string {
  if (tier === "free") return "Manage Subscription";
  if (isUpgrade) return "Upgrade to Mingla+";
  return "";
}

// --- Props ---

interface BillingSheetProps {
  visible: boolean;
  onClose: () => void;
}

// --- Component ---

export default function BillingSheet({ visible, onClose }: BillingSheetProps) {
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const userId = user?.id;

  const { tier: effectiveTier } = useEffectiveTier(userId);
  const { data: subscription, isLoading, isError, refetch } = useSubscription(userId);
  const trialDays = useTrialDaysRemaining(userId);
  const trialTotalDays = useTrialTotalDays(userId);
  const referralDays = useReferralDaysRemaining(userId);
  const { mutateAsync: restorePurchases, isPending: isRestoring } = useRestorePurchases();

  // Internal paywall state for upgrade/downgrade flows
  const [showPaywall, setShowPaywall] = useState(false);
  const handleChangePlan = (tier: SubscriptionTier) => {
    if (tier === "free") {
      handleManageSubscription();
      return;
    }
    setShowPaywall(true);
  };

  const handleManageSubscription = async () => {
    try {
      const info = await getCustomerInfo();
      const url = info.managementURL;
      if (url) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Fall through to platform-specific fallback
    }

    // Fallback: open platform subscription management
    const fallbackUrl = Platform.select({
      ios: "https://apps.apple.com/account/subscriptions",
      android: "https://play.google.com/store/account/subscriptions",
    });
    if (fallbackUrl) {
      Linking.openURL(fallbackUrl).catch(() => {
        Alert.alert(
          "Unable to open",
          "Please manage your subscription in your device's Settings.",
        );
      });
    } else {
      Alert.alert(
        "Subscription Management",
        "Please manage your subscription through your device's app store settings.",
      );
    }
  };

  const handleRestore = async () => {
    try {
      await restorePurchases();
      Alert.alert("Purchases restored", "Your subscription status has been updated.");
    } catch {
      Alert.alert(
        "Restore failed",
        "We couldn't find any previous purchases. If you believe this is an error, contact support@mingla.app.",
      );
    }
  };

  const currentRank = TIER_RANK[effectiveTier];

  const { height: windowHeight } = useWindowDimensions();
  const SHEET_TOP = Math.round(windowHeight * 0.08);

  const overlayTapStyle = useMemo(() => ({ height: SHEET_TOP }), [SHEET_TOP]);
  const scrollContentStyle = useMemo(
    () => ({ paddingBottom: Math.max(insets.bottom, 16) + 24 }),
    [insets.bottom],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={overlayTapStyle} onPress={onClose} />
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Your Plan</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Close billing"
              accessibilityRole="button"
            >
              <Icon name="close" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView
            style={styles.scrollContent}
            contentContainerStyle={scrollContentStyle}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#eb7825" />
              </View>
            ) : isError ? (
              <View style={styles.errorCard}>
                <Icon name="cloud-offline-outline" size={32} color="#9ca3af" />
                <Text style={styles.errorTitle}>Couldn't load your plan</Text>
                <Text style={styles.errorBody}>Check your connection and try again.</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* Current Plan Summary */}
                <CurrentPlanCard
                  tier={effectiveTier}
                  trialDays={trialDays}
                  trialTotalDays={trialTotalDays}
                  referralDays={referralDays}
                />

                {/* Compare Plans */}
                <Text style={styles.compareSectionTitle}>Compare plans</Text>

                {TIER_ORDER.map((tier) => {
                  const isCurrent = tier === effectiveTier;
                  const tierRank = TIER_RANK[tier];
                  const isUpgrade = tierRank > currentRank;
                  const isDowngrade = tierRank < currentRank;

                  return (
                    <TierCard
                      key={tier}
                      tier={tier}
                      isCurrent={isCurrent}
                      isUpgrade={isUpgrade}
                      isDowngrade={isDowngrade}
                      onChangePlan={handleChangePlan}
                    />
                  );
                })}

                {/* Restore purchases */}
                <TouchableOpacity
                  style={styles.restoreButton}
                  onPress={handleRestore}
                  disabled={isRestoring}
                  accessibilityLabel="Restore purchases"
                  accessibilityRole="button"
                >
                  {isRestoring ? (
                    <ActivityIndicator size="small" color="#6b7280" />
                  ) : (
                    <Text style={styles.restoreText}>Restore purchases</Text>
                  )}
                </TouchableOpacity>


              </>
            )}
          </ScrollView>

          {/* Internal paywall for upgrade/downgrade */}
          {userId && (
            <CustomPaywallScreen
              isVisible={showPaywall}
              onClose={() => setShowPaywall(false)}
              userId={userId}

            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// --- Current Plan Card ---

interface CurrentPlanCardProps {
  tier: SubscriptionTier;
  trialDays: number;
  trialTotalDays: number;
  referralDays: number;
}

function CurrentPlanCard({ tier, trialDays, trialTotalDays, referralDays }: CurrentPlanCardProps) {
  const config = TIERS[tier];
  const isOnTrial = trialDays > 0;
  const hasReferralBonus = referralDays > 0 && !isOnTrial;

  // Progress bar: fraction of trial remaining, derived from actual trial duration
  const trialProgress = trialTotalDays > 0
    ? Math.min(1, Math.max(0, trialDays / trialTotalDays))
    : 0;

  return (
    <View style={styles.currentCard}>
      {/* Top row */}
      <View style={styles.currentTopRow}>
        <Icon name={config.icon} size={22} color="#eb7825" />
        <Text style={styles.currentTierName}>{config.name}</Text>
        {isOnTrial && (
          <View style={styles.trialBadge}>
            <Text style={styles.trialBadgeText}>TRIAL</Text>
          </View>
        )}
        {hasReferralBonus && (
          <View style={styles.trialBadge}>
            <Text style={styles.trialBadgeText}>REFERRAL BONUS</Text>
          </View>
        )}
      </View>

      {/* Description */}
      <Text style={styles.currentDescription}>{config.description}</Text>

      {/* Trial progress bar */}
      {isOnTrial && (
        <View style={styles.trialSection}>
          <View style={styles.trialLabelRow}>
            <Text style={styles.trialLabel}>Trial</Text>
            <Text style={styles.trialDaysText}>
              {trialDays} {trialDays === 1 ? "day" : "days"} left
            </Text>
          </View>
          <View style={styles.trialTrack}>
            <LinearGradient
              colors={["#eb7825", "#f5a623"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[
                styles.trialFill,
                { width: `${Math.round(trialProgress * 100)}%` },
              ]}
            />
          </View>
        </View>
      )}

      {/* Referral bonus */}
      {hasReferralBonus && (
        <View style={styles.referralRow}>
          <Icon name="gift-outline" size={14} color="#eb7825" />
          <Text style={styles.referralText}>
            {referralDays} bonus {referralDays === 1 ? "day" : "days"} remaining
          </Text>
        </View>
      )}
    </View>
  );
}

// --- Tier Comparison Card ---

interface TierCardProps {
  tier: SubscriptionTier;
  isCurrent: boolean;
  isUpgrade: boolean;
  isDowngrade: boolean;
  onChangePlan: (tier: SubscriptionTier) => void;
}

function TierCard({ tier, isCurrent, isUpgrade, isDowngrade, onChangePlan }: TierCardProps) {
  const config = TIERS[tier];
  const ctaText = getCtaLabel(tier, isUpgrade);
  const showCta = !isCurrent && ctaText;

  return (
    <View style={[styles.tierCard, isCurrent && styles.tierCardCurrent]}>
      {/* Header */}
      <View style={styles.tierHeaderRow}>
        <View style={styles.tierHeaderLeft}>
          <Icon
            name={config.icon}
            size={20}
            color={isCurrent ? "#eb7825" : "#9ca3af"}
          />
          <Text style={styles.tierName}>{config.name}</Text>
        </View>
        {isCurrent && (
          <View style={styles.currentBadge}>
            <Text style={styles.currentBadgeText}>Current</Text>
          </View>
        )}
      </View>

      {/* Perks */}
      <View style={styles.perksList}>
        {config.perks.map((perk, i) => (
          <View key={i} style={styles.perkRow}>
            <Icon
              name="checkmark-circle"
              size={16}
              color={isCurrent ? "#eb7825" : "#9ca3af"}
            />
            <Text style={styles.perkText}>{perk}</Text>
          </View>
        ))}
      </View>

      {/* CTA for upgrade, downgrade, or manage */}
      {showCta ? (
        <TouchableOpacity
          style={[
            styles.upgradeCta,
            isDowngrade && styles.downgradeCta,
          ]}
          onPress={() => onChangePlan(tier)}
          activeOpacity={0.8}
          accessibilityLabel={ctaText}
          accessibilityRole="button"
        >
          <Text
            style={[
              styles.upgradeCtaText,
              isDowngrade && styles.downgradeCtaText,
            ]}
          >
            {ctaText}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// --- Styles ---

const styles = StyleSheet.create({
  // Shell
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    flex: 1,
    backgroundColor: "#f9fafb",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#111827" },
  scrollContent: { flex: 1, paddingHorizontal: 16 },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 80,
  },

  // Error
  errorCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 24,
    alignItems: "center",
    marginTop: 16,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    textAlign: "center",
    marginTop: 8,
  },
  errorBody: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 4,
  },
  retryButton: {
    marginTop: 12,
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: "center",
  },
  retryText: { fontSize: 16, fontWeight: "600", color: "#374151" },

  // Current plan card
  currentCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#eb7825",
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  currentTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  currentTierName: { fontSize: 18, fontWeight: "700", color: "#111827" },
  currentDescription: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 6,
  },
  trialBadge: {
    backgroundColor: "#fff7ed",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  trialBadgeText: { fontSize: 11, fontWeight: "600", color: "#eb7825" },

  // Trial progress
  trialSection: { marginTop: 12 },
  trialLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  trialLabel: { fontSize: 13, fontWeight: "500", color: "#374151" },
  trialDaysText: { fontSize: 13, fontWeight: "600", color: "#eb7825" },
  trialTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    overflow: "hidden",
  },
  trialFill: {
    height: 6,
    borderRadius: 999,
  },

  // Referral
  referralRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  referralText: { fontSize: 13, fontWeight: "500", color: "#374151" },

  // Compare section
  compareSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
  },

  // Tier cards
  tierCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  tierCardCurrent: {
    borderWidth: 2,
    borderColor: "#eb7825",
    backgroundColor: "#fff7ed",
  },
  tierHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tierHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tierName: { fontSize: 16, fontWeight: "700", color: "#111827" },
  currentBadge: {
    backgroundColor: "#eb7825",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  currentBadgeText: { fontSize: 11, fontWeight: "700", color: "#ffffff" },

  // Perks
  perksList: { marginTop: 12, gap: 8 },
  perkRow: { flexDirection: "row", alignItems: "center" },
  perkText: {
    fontSize: 14,
    color: "#374151",
    marginLeft: 8,
    flex: 1,
  },

  // Upgrade CTA
  upgradeCta: {
    marginTop: 12,
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  upgradeCtaText: { fontSize: 16, fontWeight: "600", color: "#ffffff" },

  // Downgrade CTA
  downgradeCta: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "#d1d5db",
  },
  downgradeCtaText: {
    color: "#374151",
  },

  // Restore purchases
  restoreButton: {
    alignItems: "center",
    marginTop: 4,
    marginBottom: 8,
    paddingVertical: 8,
  },
  restoreText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6b7280",
    textDecorationLine: "underline",
  },

});
