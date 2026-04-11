import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Icon } from './ui/Icon';
import InAppBrowserModal from './InAppBrowserModal';
import { LEGAL_URLS } from '../constants/urls';
import { useQueryClient } from '@tanstack/react-query';
import { useOfferings, usePurchasePackage, useRestorePurchases, revenueCatKeys } from '../hooks/useRevenueCat';
import { syncSubscriptionFromRC } from '../services/subscriptionService';
import { subscriptionKeys } from '../hooks/useSubscription';
import type { GatedFeature } from '../hooks/useFeatureGate';
import { colors, spacing, radius, typography, fontWeights } from '../constants/designSystem';
import { logAppsFlyerEvent } from '../services/appsFlyerService';
import { mixpanelService } from '../services/mixpanelService';
import { useToast } from './ToastManager';
import { useTranslation } from 'react-i18next';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CustomPaywallScreenProps {
  isVisible: boolean;
  onClose: () => void;
  userId: string;
  feature?: GatedFeature;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature-to-header mapping
// ─────────────────────────────────────────────────────────────────────────────

// Feature headers — i18n keys are in FEATURE_HEADER_KEYS inside the component

// ─────────────────────────────────────────────────────────────────────────────
// Feature checklists
// ─────────────────────────────────────────────────────────────────────────────

interface ChecklistItem {
  labelKey: string;
  free: boolean;
  minglaPlus: boolean;
}

const FEATURE_CHECKLIST: ChecklistItem[] = [
  { labelKey: 'billing:paywall.checklist_unlimited_swipes', free: true, minglaPlus: true },
  { labelKey: 'billing:paywall.checklist_1_pairing', free: true, minglaPlus: false },
  { labelKey: 'billing:paywall.checklist_unlimited_pairings', free: false, minglaPlus: true },
  { labelKey: 'billing:paywall.checklist_1_session', free: true, minglaPlus: false },
  { labelKey: 'billing:paywall.checklist_unlimited_sessions', free: false, minglaPlus: true },
  { labelKey: 'billing:paywall.checklist_view_curated', free: true, minglaPlus: true },
  { labelKey: 'billing:paywall.checklist_save_curated', free: false, minglaPlus: true },
  { labelKey: 'billing:paywall.checklist_custom_starting_point', free: false, minglaPlus: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getPeriodLabelKey(identifier: string): string {
  const id = identifier.toLowerCase();
  if (id.includes('annual') || id.includes('yearly') || id === '$rc_annual') return 'billing:paywall.period_annual';
  if (id.includes('monthly') || id === '$rc_monthly') return 'billing:paywall.period_monthly';
  if (id.includes('weekly') || id === '$rc_weekly') return 'billing:paywall.period_weekly';
  if (id.includes('lifetime') || id === '$rc_lifetime') return 'billing:paywall.period_lifetime';
  return 'billing:paywall.period_subscribe';
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full-screen branded paywall with Mingla+ plan,
 * package selection, and purchase/restore flows.
 */
export function CustomPaywallScreen({
  isVisible,
  onClose,
  userId,
  feature,
}: CustomPaywallScreenProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation(['billing', 'common']);
  const { data: offering } = useOfferings(isVisible);
  const { mutateAsync: purchase, isPending: isPurchasing } = usePurchasePackage();
  const { mutateAsync: restore, isPending: isRestoring } = useRestorePurchases();

  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);
  const [legalBrowserVisible, setLegalBrowserVisible] = useState(false);
  const [legalBrowserUrl, setLegalBrowserUrl] = useState('');
  const [legalBrowserTitle, setLegalBrowserTitle] = useState('');

  // Log paywall view when modal opens
  useEffect(() => {
    if (isVisible) {
      setSelectedPkgId(null);
      logAppsFlyerEvent('paywall_viewed', {
        trigger: feature || 'general',
      });
      mixpanelService.trackPaywallViewed({
        trigger: feature || 'general',
        gated_feature: feature,
      });
    }
  }, [isVisible, feature]);

  const FEATURE_HEADER_KEYS: Record<GatedFeature, string> = {
    curated_cards: 'billing:paywall.header_curated_cards',
    pairing: 'billing:paywall.header_pairing',
    custom_starting_point: 'billing:paywall.header_custom_starting_point',
    session_creation: 'billing:paywall.header_session_creation',
  };
  const headerText = feature ? t(FEATURE_HEADER_KEYS[feature]) : t('billing:paywall.header_default');

  const packages = offering?.availablePackages ?? [];
  const activePackages = packages;

  // ── Purchase handler ────────────────────────────────────────────────────
  const handlePurchase = async () => {
    const pkg = activePackages.find((p) => p.identifier === selectedPkgId) ?? activePackages[0];
    if (!pkg) {
      Alert.alert(t('billing:paywall.no_package_title'), t('billing:paywall.no_package_body'));
      return;
    }

    try {
      const result = await purchase(pkg);
      // Sync to Supabase — retry once on failure
      try {
        await syncSubscriptionFromRC(userId, result.customerInfo);
      } catch (syncErr) {
        console.warn('[CustomPaywallScreen] Sync failed, retrying...', syncErr);
        setTimeout(async () => {
          try {
            await syncSubscriptionFromRC(userId, result.customerInfo);
          } catch (retryErr) {
            console.error('[CustomPaywallScreen] Sync retry failed:', retryErr);
            showToast({ message: t('billing:paywall.purchase_sync_info'), type: 'info' });
          }
        }, 2000);
      }
      // Invalidate caches so the rest of the app reflects the new tier
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
      queryClient.invalidateQueries({ queryKey: revenueCatKeys.all });
      onClose();
    } catch (err: unknown) {
      // RevenueCat throws { userCancelled: true } when user dismisses the payment sheet
      if (err != null && typeof err === 'object' && 'userCancelled' in err && (err as Record<string, unknown>).userCancelled) return;
      const message = err instanceof Error ? err.message : t('billing:paywall.purchase_failed_fallback');
      Alert.alert(t('billing:paywall.purchase_failed_title'), message);
    }
  };

  // ── Restore handler ─────────────────────────────────────────────────────
  const handleRestore = async () => {
    try {
      const customerInfo = await restore();
      // Sync to Supabase — retry once on failure
      try {
        await syncSubscriptionFromRC(userId, customerInfo);
      } catch (syncErr) {
        console.warn('[CustomPaywallScreen] Restore sync failed, retrying...', syncErr);
        setTimeout(async () => {
          try {
            await syncSubscriptionFromRC(userId, customerInfo);
          } catch (retryErr) {
            console.error('[CustomPaywallScreen] Restore sync retry failed:', retryErr);
            showToast({ message: t('billing:paywall.restore_sync_info'), type: 'info' });
          }
        }, 2000);
      }
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
      queryClient.invalidateQueries({ queryKey: revenueCatKeys.all });
      Alert.alert(t('billing:paywall.restored_title'), t('billing:paywall.restored_body'));
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('billing:paywall.restore_failed_fallback');
      Alert.alert(t('billing:paywall.restore_failed_title'), message);
    }
  };

  const isBusy = isPurchasing || isRestoring;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
    <Modal
      visible={isVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        mixpanelService.trackPaywallDismissed({ trigger: feature || 'general' });
        onClose();
      }}
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
            {t('billing:paywall.subheader')}
          </Text>

          {/* Feature checklist */}
          <View style={styles.checklist}>
            {FEATURE_CHECKLIST.map((item) => {
              const included = item.minglaPlus;
              return (
                <View key={item.labelKey} style={styles.checklistRow}>
                  <Icon
                    name={included ? 'checkmark-circle' : 'close-circle'}
                    size={20}
                    color={included ? '#22C55E' : '#6B7280'}
                  />
                  <Text style={[styles.checklistLabel, !included && styles.checklistLabelDimmed]}>
                    {t(item.labelKey)}
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
                const accentColor = colors.primary[500];
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
                      {t(getPeriodLabelKey(pkg.identifier))}
                    </Text>
                    <Text style={styles.packagePrice}>
                      {pkg.product.priceString}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={styles.noPackagesText}>{t('billing:paywall.loading_packages')}</Text>
          )}

          {/* Subscribe CTA */}
          <TouchableOpacity
            style={[
              styles.ctaButton,
              { backgroundColor: colors.primary[500] },
            ]}
            onPress={handlePurchase}
            disabled={isBusy}
            activeOpacity={0.85}
          >
            {isBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>{t('billing:paywall.subscribe')}</Text>
            )}
          </TouchableOpacity>

          {/* Restore link */}
          <TouchableOpacity
            style={styles.restoreButton}
            onPress={handleRestore}
            disabled={isBusy}
          >
            <Text style={styles.restoreText}>{t('billing:paywall.restore_purchases')}</Text>
          </TouchableOpacity>

          {/* Terms & Privacy */}
          <View style={styles.legalRow}>
            <TouchableOpacity onPress={() => {
              setLegalBrowserUrl(LEGAL_URLS.termsOfService);
              setLegalBrowserTitle(t('billing:paywall.terms_of_service'));
              setLegalBrowserVisible(true);
            }}>
              <Text style={styles.legalLink}>{t('billing:paywall.terms_of_service')}</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}> | </Text>
            <TouchableOpacity onPress={() => {
              setLegalBrowserUrl(LEGAL_URLS.privacyPolicy);
              setLegalBrowserTitle(t('billing:paywall.privacy_policy'));
              setLegalBrowserVisible(true);
            }}>
              <Text style={styles.legalLink}>{t('billing:paywall.privacy_policy')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
    <InAppBrowserModal
      visible={legalBrowserVisible}
      url={legalBrowserUrl}
      title={legalBrowserTitle}
      onClose={() => setLegalBrowserVisible(false)}
    />
    </>
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
