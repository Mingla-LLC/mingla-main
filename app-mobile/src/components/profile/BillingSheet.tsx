import React from "react";
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
  useReferralMonthsRemaining,
} from "../../hooks/useSubscription";
import type { SubscriptionTier } from "../../types/subscription";

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
      "20 swipes per day",
      "1 board session (up to 5 people)",
      "Basic experience discovery",
    ],
  },
  pro: {
    name: "Pro Plan",
    icon: "flash",
    description: "More sessions, curated picks, your starting point.",
    perks: [
      "Unlimited swipes",
      "3 board sessions (up to 5 people)",
      "Curated cards picked for you",
      "Set your own starting point",
    ],
  },
  elite: {
    name: "Elite Plan",
    icon: "diamond",
    description: "Everything unlocked. No limits.",
    perks: [
      "Unlimited swipes",
      "Unlimited board sessions (up to 15 people)",
      "Unlimited pairings",
      "Curated cards picked for you",
      "Set your own starting point",
    ],
  },
};

const TIER_ORDER: SubscriptionTier[] = ["free", "pro", "elite"];

const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, pro: 1, elite: 2 };

// --- CTA labels per upgrade path ---

const CTA_LABELS: Partial<Record<SubscriptionTier, string>> = {
  pro: "Upgrade to Pro",
  elite: "Go Elite",
};

// --- Props ---

interface BillingSheetProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

// --- Component ---

export default function BillingSheet({ visible, onClose, onUpgrade }: BillingSheetProps) {
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const userId = user?.id;

  const effectiveTier = useEffectiveTier(userId);
  const { data: subscription, isLoading, isError, refetch } = useSubscription(userId);
  const trialDays = useTrialDaysRemaining(userId);
  const trialTotalDays = useTrialTotalDays(userId);
  const referralMonths = useReferralMonthsRemaining(userId);
  const { mutateAsync: restorePurchases, isPending: isRestoring } = useRestorePurchases();

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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ height: SHEET_TOP }} onPress={onClose} />
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
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
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
                  referralMonths={referralMonths}
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
                      onUpgrade={onUpgrade}
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
  referralMonths: number;
}

function CurrentPlanCard({ tier, trialDays, trialTotalDays, referralMonths }: CurrentPlanCardProps) {
  const config = TIERS[tier];
  const isOnTrial = trialDays > 0;
  const hasReferralBonus = referralMonths > 0 && !isOnTrial;

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
            <Text style={styles.trialLabel}>Elite trial</Text>
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
            {referralMonths} bonus {referralMonths === 1 ? "month" : "months"} remaining
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
  onUpgrade: () => void;
}

function TierCard({ tier, isCurrent, isUpgrade, isDowngrade, onUpgrade }: TierCardProps) {
  const config = TIERS[tier];
  const ctaText = CTA_LABELS[tier] ?? "";

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

      {/* CTA or downgrade note */}
      {isUpgrade && ctaText ? (
        <TouchableOpacity
          style={styles.upgradeCta}
          onPress={onUpgrade}
          activeOpacity={0.8}
          accessibilityLabel={ctaText}
          accessibilityRole="button"
        >
          <Text style={styles.upgradeCtaText}>{ctaText}</Text>
        </TouchableOpacity>
      ) : isDowngrade ? (
        <Text style={styles.downgradeNote}>
          Your current plan includes everything here and more.
        </Text>
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

  // Downgrade note
  downgradeNote: {
    marginTop: 8,
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
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
