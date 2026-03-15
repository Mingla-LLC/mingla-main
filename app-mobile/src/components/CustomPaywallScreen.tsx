import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { PurchasesPackage } from 'react-native-purchases';

import { useOfferings, usePurchasePackage, useRestorePurchases, revenueCatKeys } from '../hooks/useRevenueCat';
import { syncSubscriptionFromRC } from '../services/subscriptionService';
import { subscriptionKeys } from '../hooks/useSubscription';
import type { GatedFeature } from '../hooks/useFeatureGate';
import { colors, spacing, radius, typography, fontWeights } from '../constants/designSystem';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CustomPaywallScreenProps {
  isVisible: boolean;
  onClose: () => void;
  userId: string;
  feature?: GatedFeature;
  initialTier?: 'pro' | 'elite';
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature-to-header mapping
// ─────────────────────────────────────────────────────────────────────────────

const FEATURE_HEADERS: Record<GatedFeature, string> = {
  curated_cards: 'Unlock Curated Experiences',
  pairing: 'Connect with Your People',
  custom_starting_point: 'Explore From Anywhere',
  unlimited_swipes: 'Never Stop Discovering',
  session_creation: 'Plan More Adventures',
};

// ─────────────────────────────────────────────────────────────────────────────
// Feature checklists
// ─────────────────────────────────────────────────────────────────────────────

interface ChecklistItem {
  label: string;
  pro: boolean;
  elite: boolean;
}

const FEATURE_CHECKLIST: ChecklistItem[] = [
  { label: 'Unlimited swipes', pro: true, elite: true },
  { label: 'Curated experiences', pro: true, elite: true },
  { label: 'Custom starting point', pro: true, elite: true },
  { label: 'Pairing', pro: false, elite: true },
  { label: '3 sessions', pro: true, elite: false },
  { label: 'Unlimited sessions (15 members)', pro: false, elite: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type TierKey = 'pro' | 'elite';

function filterPackagesByTier(
  packages: PurchasesPackage[],
  tier: TierKey,
): PurchasesPackage[] {
  return packages.filter((pkg) =>
    pkg.product.identifier.toLowerCase().includes(tier),
  );
}

function getPeriodLabel(identifier: string): string {
  const id = identifier.toLowerCase();
  if (id.includes('annual') || id.includes('yearly') || id === '$rc_annual') return 'Annual';
  if (id.includes('monthly') || id === '$rc_monthly') return 'Monthly';
  if (id.includes('weekly') || id === '$rc_weekly') return 'Weekly';
  if (id.includes('lifetime') || id === '$rc_lifetime') return 'Lifetime';
  return 'Subscribe';
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full-screen branded paywall with Pro and Elite tier comparison,
 * package selection, and purchase/restore flows.
 */
export function CustomPaywallScreen({
  isVisible,
  onClose,
  userId,
  feature,
  initialTier = 'pro',
}: CustomPaywallScreenProps) {
  const queryClient = useQueryClient();
  const { data: offering } = useOfferings();
  const { mutateAsync: purchase, isPending: isPurchasing } = usePurchasePackage();
  const { mutateAsync: restore, isPending: isRestoring } = useRestorePurchases();

  const [selectedTier, setSelectedTier] = useState<TierKey>(initialTier);
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);

  const headerText = feature ? FEATURE_HEADERS[feature] : 'Upgrade Your Experience';

  // Split packages by tier
  const proPackages = useMemo(
    () => (offering ? filterPackagesByTier(offering.availablePackages, 'pro') : []),
    [offering],
  );
  const elitePackages = useMemo(
    () => (offering ? filterPackagesByTier(offering.availablePackages, 'elite') : []),
    [offering],
  );

  const activePackages = selectedTier === 'pro' ? proPackages : elitePackages;

  // ── Purchase handler ────────────────────────────────────────────────────
  const handlePurchase = async () => {
    const pkg = activePackages.find((p) => p.identifier === selectedPkgId) ?? activePackages[0];
    if (!pkg) {
      Alert.alert('No Package', 'No subscription package is available right now.');
      return;
    }

    try {
      const result = await purchase(pkg);
      // Sync to Supabase (best-effort)
      await syncSubscriptionFromRC(userId, result.customerInfo).catch(() => {});
      // Invalidate caches so the rest of the app reflects the new tier
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
      queryClient.invalidateQueries({ queryKey: revenueCatKeys.all });
      onClose();
    } catch (err: unknown) {
      const error = err as { userCancelled?: boolean; message?: string };
      if (error.userCancelled) return; // user tapped cancel — do nothing
      Alert.alert('Purchase Failed', error.message ?? 'Something went wrong. Please try again.');
    }
  };

  // ── Restore handler ─────────────────────────────────────────────────────
  const handleRestore = async () => {
    try {
      const customerInfo = await restore();
      await syncSubscriptionFromRC(userId, customerInfo).catch(() => {});
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
      queryClient.invalidateQueries({ queryKey: revenueCatKeys.all });
      Alert.alert('Restored', 'Your purchases have been restored.');
      onClose();
    } catch (err: unknown) {
      const error = err as { message?: string };
      Alert.alert('Restore Failed', error.message ?? 'Could not restore purchases.');
    }
  };

  const isBusy = isPurchasing || isRestoring;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.safeArea}>
        {/* Swipe-down handle */}
        <TouchableOpacity style={styles.handleBar} onPress={onClose} activeOpacity={0.8}>
          <View style={styles.handle} />
        </TouchableOpacity>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <Text style={styles.header}>{headerText}</Text>
          <Text style={styles.subheader}>
            Choose the plan that fits your lifestyle
          </Text>

          {/* Tier selector tabs */}
          <View style={styles.tierTabs}>
            <TouchableOpacity
              style={[styles.tierTab, selectedTier === 'pro' && styles.tierTabActivePro]}
              onPress={() => setSelectedTier('pro')}
            >
              <Text style={[styles.tierTabText, selectedTier === 'pro' && styles.tierTabTextActive]}>
                Pro
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tierTab, selectedTier === 'elite' && styles.tierTabActiveElite]}
              onPress={() => setSelectedTier('elite')}
            >
              <View style={styles.bestValueBadge}>
                <Text style={styles.bestValueText}>Best Value</Text>
              </View>
              <Text style={[styles.tierTabText, selectedTier === 'elite' && styles.tierTabTextActive]}>
                Elite
              </Text>
            </TouchableOpacity>
          </View>

          {/* Feature checklist */}
          <View style={styles.checklist}>
            {FEATURE_CHECKLIST.map((item) => {
              const included = selectedTier === 'pro' ? item.pro : item.elite;
              return (
                <View key={item.label} style={styles.checklistRow}>
                  <Ionicons
                    name={included ? 'checkmark-circle' : 'close-circle'}
                    size={20}
                    color={included ? '#22C55E' : '#6B7280'}
                  />
                  <Text style={[styles.checklistLabel, !included && styles.checklistLabelDimmed]}>
                    {item.label}
                    {!included && item.label === 'Pairing' ? ' (Elite only)' : ''}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Package pills */}
          {activePackages.length > 0 ? (
            <View style={styles.packageList}>
              {activePackages.map((pkg) => {
                const isSelected = selectedPkgId === pkg.identifier ||
                  (selectedPkgId === null && pkg === activePackages[0]);
                const accentColor = selectedTier === 'pro' ? colors.primary[500] : '#F59E0B';
                return (
                  <TouchableOpacity
                    key={pkg.identifier}
                    style={[
                      styles.packagePill,
                      isSelected && { borderColor: accentColor, borderWidth: 2 },
                    ]}
                    onPress={() => setSelectedPkgId(pkg.identifier)}
                  >
                    <Text style={styles.packagePeriod}>
                      {getPeriodLabel(pkg.identifier)}
                    </Text>
                    <Text style={styles.packagePrice}>
                      {pkg.product.priceString}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={styles.noPackagesText}>Loading packages...</Text>
          )}

          {/* Subscribe CTA */}
          <TouchableOpacity
            style={[
              styles.ctaButton,
              { backgroundColor: selectedTier === 'pro' ? colors.primary[500] : '#F59E0B' },
            ]}
            onPress={handlePurchase}
            disabled={isBusy}
            activeOpacity={0.85}
          >
            {isBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>Subscribe</Text>
            )}
          </TouchableOpacity>

          {/* Restore link */}
          <TouchableOpacity
            style={styles.restoreButton}
            onPress={handleRestore}
            disabled={isBusy}
          >
            <Text style={styles.restoreText}>Restore Purchases</Text>
          </TouchableOpacity>

          {/* Terms & Privacy */}
          <View style={styles.legalRow}>
            <TouchableOpacity onPress={() => Linking.openURL('https://mingla.app/terms')}>
              <Text style={styles.legalLink}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}> | </Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://mingla.app/privacy')}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1C1C1E',
  },
  handleBar: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  // Header
  header: {
    color: '#fff',
    fontSize: typography.xxl.fontSize,
    lineHeight: typography.xxl.lineHeight,
    fontWeight: fontWeights.bold,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  subheader: {
    color: '#9CA3AF',
    fontSize: typography.sm.fontSize,
    lineHeight: typography.sm.lineHeight,
    fontWeight: fontWeights.regular,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },

  // Tier tabs
  tierTabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tierTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[700],
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  tierTabActivePro: {
    borderColor: colors.primary[500],
    borderWidth: 2,
    backgroundColor: 'rgba(249,115,22,0.1)',
  },
  tierTabActiveElite: {
    borderColor: '#F59E0B',
    borderWidth: 2,
    backgroundColor: 'rgba(245,158,11,0.1)',
  },
  tierTabText: {
    color: '#9CA3AF',
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.semibold,
  },
  tierTabTextActive: {
    color: '#fff',
  },
  bestValueBadge: {
    position: 'absolute',
    top: -10,
    backgroundColor: '#F59E0B',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  bestValueText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: fontWeights.bold,
    letterSpacing: 0.5,
  },

  // Checklist
  checklist: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checklistLabel: {
    color: '#fff',
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.regular,
  },
  checklistLabelDimmed: {
    color: '#6B7280',
  },

  // Packages
  packageList: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  packagePill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[700],
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  packagePeriod: {
    color: '#9CA3AF',
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.medium,
    marginBottom: spacing.xxs,
  },
  packagePrice: {
    color: '#fff',
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.bold,
  },
  noPackagesText: {
    color: '#9CA3AF',
    fontSize: typography.sm.fontSize,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  // CTA
  ctaButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  ctaText: {
    color: '#fff',
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.bold,
  },

  // Restore
  restoreButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  restoreText: {
    color: '#9CA3AF',
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.medium,
    textDecorationLine: 'underline',
  },

  // Legal
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  legalLink: {
    color: '#6B7280',
    fontSize: typography.xs.fontSize,
    textDecorationLine: 'underline',
  },
  legalDot: {
    color: '#6B7280',
    fontSize: typography.xs.fontSize,
  },
});
