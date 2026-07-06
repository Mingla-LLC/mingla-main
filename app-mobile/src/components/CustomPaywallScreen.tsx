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
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './ui/Icon';
import InAppBrowserModal from './InAppBrowserModal';
import { LEGAL_URLS } from '../constants/urls';
import { useQueryClient } from '@tanstack/react-query';
import type { PurchasesPackage } from 'react-native-purchases';
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
  /**
   * ORCH-1315 [preferences-custom-location-paywall-not-firing] — in-window overlay
   * mode. When FALSE (default, the 7 non-preferences call sites) the paywall renders
   * in its own RN <Modal presentationStyle="pageSheet"> exactly as before. When TRUE
   * (PreferencesSheet, which itself lives inside a BaseBottomSheet `wrapInRNModal`
   * window) the SAME content renders in a plain absolutely-positioned opaque <View>
   * instead — because iOS will not reliably present a SECOND RN Modal over an
   * already-presented one, so a nested Modal silently never appears (F-1). The
   * overlay z-stacks inside the sheet's existing Modal window. Invariant
   * I-PROPOSED-1315-PAYWALL-PRESENTS-FROM-SHEET.
   */
  presentInline?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature-to-header mapping
// ─────────────────────────────────────────────────────────────────────────────

// Feature headers — i18n keys are in FEATURE_HEADER_KEYS inside the component

// ─────────────────────────────────────────────────────────────────────────────
// Feature checklists
// ─────────────────────────────────────────────────────────────────────────────

interface ComparisonRow {
  labelKey: string;
  /** Display value for the Free column: true = ✓, false = ✗, string = custom label */
  free: boolean | string;
  /** Display value for the Mingla+ column: true = ✓, false = ✗, string = custom label */
  plus: boolean | string;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  { labelKey: 'billing:paywall.compare_swipes', free: true, plus: true },
  { labelKey: 'billing:paywall.compare_pairings', free: '1', plus: '∞' },
  { labelKey: 'billing:paywall.compare_sessions', free: '1', plus: '∞' },
  { labelKey: 'billing:paywall.compare_curated', free: 'billing:paywall.compare_view', plus: 'billing:paywall.compare_save' },
  { labelKey: 'billing:paywall.compare_starting_point', free: false, plus: true },
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

type PackagePlan = 'annual' | 'monthly' | 'weekly' | 'lifetime' | 'subscribe';

function getPackagePlan(pkg: PurchasesPackage): PackagePlan {
  const id = `${pkg.identifier} ${pkg.product.identifier} ${pkg.product.subscriptionPeriod ?? ''}`.toLowerCase();
  if (id.includes('p1y') || id.includes('annual') || id.includes('yearly')) return 'annual';
  if (id.includes('p1m') || id.includes('monthly')) return 'monthly';
  if (id.includes('p1w') || id.includes('weekly')) return 'weekly';
  if (id.includes('lifetime')) return 'lifetime';
  return 'subscribe';
}

function getPackageSortWeight(pkg: PurchasesPackage): number {
  const plan = getPackagePlan(pkg);
  if (plan === 'annual') return 0;
  if (plan === 'monthly') return 1;
  if (plan === 'weekly') return 2;
  if (plan === 'lifetime') return 3;
  return 4;
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
  presentInline = false,
}: CustomPaywallScreenProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useTranslation(['billing', 'common']);
  // ORCH-1315: inline-overlay geometry. The overlay is a screen-tall opaque region
  // pinned to the top of the host so the paywall content lands in the visible
  // viewport (the realistic trigger — the GPS/curated sections sit at the top of
  // the preferences sheet), while its opaque background also covers the sheet.
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
  const activePackages = [...packages].sort((a, b) => getPackageSortWeight(a) - getPackageSortWeight(b));
  const selectedPackage =
    activePackages.find((p) => p.identifier === selectedPkgId) ?? activePackages[0] ?? null;

  const getBillingDetail = (pkg: PurchasesPackage, plan: PackagePlan): string => {
    if (plan === 'annual' && pkg.product.pricePerMonthString) {
      return t('billing:paywall.plan_equivalent_monthly', {
        price: pkg.product.pricePerMonthString,
        defaultValue: `${pkg.product.pricePerMonthString}/mo equivalent`,
      });
    }

    if (plan === 'monthly') {
      return t('billing:paywall.plan_billed_monthly', { defaultValue: 'Billed monthly' });
    }

    if (plan === 'weekly') {
      return t('billing:paywall.plan_billed_weekly', { defaultValue: 'Billed weekly' });
    }

    if (plan === 'lifetime') {
      return t('billing:paywall.plan_one_time', { defaultValue: 'One-time purchase' });
    }

    return t('billing:paywall.plan_billed_at_checkout', { defaultValue: 'Billed at checkout' });
  };

  const getPlanBadge = (plan: PackagePlan): string | null => {
    if (plan === 'annual') {
      return t('billing:paywall.plan_best_value', { defaultValue: 'Best value' });
    }
    if (plan === 'monthly') {
      return t('billing:paywall.plan_most_flexible', { defaultValue: 'Flexible' });
    }
    return null;
  };

  // ── Purchase handler ────────────────────────────────────────────────────
  const handlePurchase = async () => {
    const pkg = selectedPackage;
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

  // ── Cell renderer for comparison table ─────────────────────────────────
  const renderCellValue = (value: boolean | string, isPlus: boolean): React.ReactNode => {
    if (typeof value === 'boolean') {
      return (
        <Icon
          name={value ? 'checkmark-circle' : 'close-circle'}
          size={18}
          color={value ? (isPlus ? '#22C55E' : '#9CA3AF') : '#4B5563'}
        />
      );
    }
    // String value — could be a plain label ('1', '∞') or an i18n key
    const displayText = value.includes(':') ? t(value) : value;
    return (
      <Text style={[styles.compareCellText, isPlus && styles.compareCellTextPlus]}>
        {displayText}
      </Text>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────
  // ORCH-1315: the SAME content renders in BOTH modes (Modal default / inline
  // overlay) so the two branches are byte-identical in content.
  const content = (
      <View style={styles.safeArea}>
        {/* Swipe-down handle — the existing close affordance (tap to dismiss). */}
        <TouchableOpacity style={styles.handleBar} onPress={onClose} activeOpacity={0.8}>
          <View style={styles.handle} />
        </TouchableOpacity>

        {/* ORCH-1315: in overlay mode there is NO OS swipe-to-dismiss chrome, so a
            VISIBLE close control MUST exist. Rendered top-right in presentInline
            mode only, so the 7 pageSheet-Modal call sites are visually unchanged. */}
        {presentInline && (
          <TouchableOpacity
            style={styles.inlineCloseButton}
            onPress={onClose}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('common:close', { defaultValue: 'Close' })}
          >
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
        )}

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

          {/* Feature comparison table */}
          <View style={styles.compareTable}>
            {/* Column headers */}
            <View style={styles.compareHeaderRow}>
              <View style={styles.compareLabelCol} />
              <View style={styles.compareValueCol}>
                <Text style={styles.compareHeaderText}>{t('billing:paywall.compare_col_free')}</Text>
              </View>
              <View style={styles.compareValueCol}>
                <Text style={[styles.compareHeaderText, styles.compareHeaderPlus]}>
                  {t('billing:paywall.compare_col_plus')}
                </Text>
              </View>
            </View>

            {/* Data rows */}
            {COMPARISON_ROWS.map((row) => (
              <View key={row.labelKey} style={styles.compareRow}>
                <View style={styles.compareLabelCol}>
                  <Text style={styles.compareLabel}>{t(row.labelKey)}</Text>
                </View>
                <View style={styles.compareValueCol}>
                  {renderCellValue(row.free, false)}
                </View>
                <View style={styles.compareValueCol}>
                  {renderCellValue(row.plus, true)}
                </View>
              </View>
            ))}
          </View>

          {/* Package pills */}
          {activePackages.length > 0 ? (
            <View style={styles.packageList}>
              {/* ORCH-1244 (Apple Guideline 3.1.2(c)) — the auto-renewing
                  subscription's TITLE must be shown in the purchase flow. We
                  surface the real StoreKit product title (RevenueCat
                  pkg.product.title), falling back to the i18n "Mingla+"
                  (billing:tier.plus_name) if a product title is somehow empty. */}
              <Text style={styles.subscriptionTitle}>
                {activePackages[0]?.product.title?.trim() || t('billing:tier.plus_name')}
              </Text>
              {activePackages.map((pkg) => {
                const plan = getPackagePlan(pkg);
                const planLabel = t(getPeriodLabelKey(pkg.identifier));
                const billingDetail = getBillingDetail(pkg, plan);
                const badge = getPlanBadge(plan);
                const isSelected = selectedPackage?.identifier === pkg.identifier;
                const accentColor = colors.primary[500];
                return (
                  <TouchableOpacity
                    key={pkg.identifier}
                    style={[
                      styles.packageCard,
                      isSelected && {
                        borderColor: accentColor,
                        backgroundColor: 'rgba(249,115,22,0.12)',
                      },
                    ]}
                    onPress={() => setSelectedPkgId(pkg.identifier)}
                    activeOpacity={0.86}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${planLabel}, ${pkg.product.priceString}, ${billingDetail}`}
                  >
                    <View style={styles.packageMainRow}>
                      <View style={styles.packageTitleBlock}>
                        <View style={styles.packageTitleRow}>
                          <Text style={[styles.packagePeriod, isSelected && styles.packagePeriodSelected]}>
                            {planLabel}
                          </Text>
                          {badge ? (
                            <View style={[styles.packageBadge, isSelected && styles.packageBadgeSelected]}>
                              <Text style={[styles.packageBadgeText, isSelected && styles.packageBadgeTextSelected]}>
                                {badge}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.packageDetail}>{billingDetail}</Text>
                      </View>
                      <View style={styles.packagePriceBlock}>
                        <Text style={styles.packagePrice}>{pkg.product.priceString}</Text>
                        {isSelected ? (
                          <Icon name="checkmark-circle" size={22} color={accentColor} />
                        ) : null}
                      </View>
                    </View>
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
              <Text style={styles.ctaText}>
                {selectedPackage
                  ? t('billing:paywall.subscribe_with_plan', {
                      plan: t(getPeriodLabelKey(selectedPackage.identifier)),
                      price: selectedPackage.product.priceString,
                      defaultValue: `Start ${t(getPeriodLabelKey(selectedPackage.identifier))} - ${selectedPackage.product.priceString}`,
                    })
                  : t('billing:paywall.subscribe')}
              </Text>
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
  );

  return (
    <>
    {presentInline ? (
      // ORCH-1315: in-window overlay. Return null when hidden so nothing mounts
      // (no racing second RN Modal); when visible, an opaque absolutely-positioned
      // View z-stacks inside the sheet's existing wrapInRNModal window. The inner
      // one-screen-tall wrapper keeps the content in the visible viewport while the
      // overlay's opaque background covers the sheet at any scroll position.
      isVisible ? (
        <View style={styles.inlineOverlay} accessibilityViewIsModal>
          <View style={[styles.inlineViewport, { height: windowHeight, paddingTop: insets.top }]}>
            {content}
          </View>
        </View>
      ) : null
    ) : (
      <Modal
        visible={isVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          mixpanelService.trackPaywallDismissed({ trigger: feature || 'general' });
          onClose();
        }}
      >
        {content}
      </Modal>
    )}
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
  // ORCH-1315 [preferences-custom-location-paywall-not-firing] — in-window overlay
  // container. Absolutely positioned + opaque so it fully covers the sheet behind
  // it; high zIndex/elevation so it z-stacks above the sheet content on both iOS
  // and Android. Only mounted while isVisible (parent returns null otherwise).
  inlineOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1C1C1E',
    zIndex: 1000,
    elevation: 1000,
  },
  // The content is capped to one screen height, anchored at the overlay's top, so
  // it lands in the visible viewport (the GPS/curated triggers sit at the top of
  // the sheet). The opaque `inlineOverlay` background covers everything below it.
  inlineViewport: {
    width: '100%',
  },
  // ORCH-1315 — visible close control for overlay mode (no OS swipe chrome).
  inlineCloseButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.lg,
    zIndex: 2,
    padding: spacing.xs,
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

  // Comparison table
  compareTable: {
    marginBottom: spacing.lg,
  },
  compareHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
  },
  compareLabelCol: {
    flex: 1,
  },
  compareValueCol: {
    width: 64,
    alignItems: 'center',
  },
  compareHeaderText: {
    color: '#9CA3AF',
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  compareHeaderPlus: {
    color: '#22C55E',
  },
  compareLabel: {
    color: '#fff',
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.regular,
  },
  compareCellText: {
    color: '#9CA3AF',
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.medium,
  },
  compareCellTextPlus: {
    color: '#22C55E',
    fontWeight: fontWeights.bold,
  },

  // Packages
  packageList: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  // ORCH-1244 (Apple 3.1.2(c)) — subscription title shown above the plans.
  subscriptionTitle: {
    color: '#fff',
    fontSize: typography.lg.fontSize,
    lineHeight: typography.lg.lineHeight,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.xs,
  },
  packageCard: {
    minHeight: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[700],
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  packageMainRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  packageTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  packageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  packagePeriod: {
    color: '#fff',
    fontSize: typography.md.fontSize,
    lineHeight: typography.md.lineHeight,
    fontWeight: fontWeights.bold,
  },
  packagePeriodSelected: {
    color: colors.primary[100],
  },
  packageBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  packageBadgeSelected: {
    backgroundColor: colors.primary[500],
  },
  packageBadgeText: {
    color: '#D1D5DB',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
  },
  packageBadgeTextSelected: {
    color: '#fff',
  },
  packageDetail: {
    color: '#9CA3AF',
    fontSize: typography.xs.fontSize,
    lineHeight: typography.xs.lineHeight,
    fontWeight: fontWeights.medium,
    marginTop: spacing.xxs,
  },
  packagePriceBlock: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  packagePrice: {
    color: '#fff',
    fontSize: typography.lg.fontSize,
    lineHeight: typography.lg.lineHeight,
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
