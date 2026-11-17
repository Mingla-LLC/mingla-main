/**
 * toward #3697 Wave 7 / 7b / 7c / 8 — Blast → Ads (credit + host campaigns +
 * status filters).
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AdCreditLedgerRow } from "../../components/marketing/AdCreditLedgerRow";
import {
  AdCreditQuoteSheet,
  type AdCreditQuoteMode,
} from "../../components/marketing/AdCreditQuoteSheet";
import { EmptyState } from "../../components/ui/EmptyState";
import { GlassCard } from "../../components/ui/GlassCard";
import { color, radius, space, type } from "../../constants/designSystem";
import { useAdCreditWallet } from "../../hooks/marketing/useAdCreditWallet";
import { useHostAdCampaigns } from "../../hooks/marketing/useHostAdCampaigns";
import { AdListSummaryCard } from "../../components/marketing/ads/results/AdListSummaryCard";
import { useHostAdPlans } from "../../hooks/marketing/useHostAdPlans";
import { useCanManageBrandPayments } from "../../hooks/useCanManageBrandPayments";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { applyAdCreditTopUp } from "../../services/adCreditService";
import {
  buildHostAdList,
  hostAdListRowMoney,
  hostAdMatchesFilter,
  type HostAdFilter,
  type HostAdLifecycle,
} from "../../services/hostAdLifecycle";
import {
  hostAdResultLabel,
  hostAdReviewReason,
  platformName,
} from "../../components/marketing/ads/hostAdCopy";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import { hostAdScrollBottomPadding } from "../../components/marketing/ads/hostAdBuilderRules";
import { formatCurrency } from "../../utils/currency";
import { formatHostAdMoneyCents } from "../../components/marketing/ads/hostAdMoney";
import {
  hostAdLearningAlert,
  hostAdPausedReason,
} from "../../components/marketing/ads/hostAdAlerts";

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (
    Array.isArray(value) &&
    typeof value[0] === "string" &&
    value[0].length > 0
  ) {
    return value[0];
  }
  return null;
}

const LIFECYCLE_LABEL: Record<HostAdLifecycle, string> = {
  draft: "Draft",
  in_review: "In review",
  scheduled: "Scheduled",
  live: "Live",
  paused: "Paused",
  needs_attention: "Needs attention",
  ended: "Ended",
};

const FILTERS: { key: HostAdFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "in_review", label: "In review" },
  { key: "scheduled", label: "Scheduled" },
  { key: "live", label: "Live" },
  { key: "paused", label: "Paused" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "ended", label: "Ended" },
];

export default function MarketingAdsRoute(): React.ReactElement {
  // #4238: keep the last buttons clear of the bottom nav and the floating
  // action button at full scroll on phones (business web and native).
  const scrollBottomPadding = hostAdScrollBottomPadding(useStickyFooterOffset());
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const walletQuery = useAdCreditWallet(brandId);
  const campaignsQuery = useHostAdCampaigns(brandId);
  const plansQuery = useHostAdPlans(brandId);
  const creditManage = useCanManageBrandPayments(brandId);
  const permissions = useHostAdPermissions(brandId);
  const { isWideDesktop } = useResponsiveLayout();
  const [sheetMode, setSheetMode] = useState<AdCreditQuoteMode | null>(null);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<HostAdFilter>("all");
  const params = useLocalSearchParams<{
    ad_credit_top_up?: string | string[];
    session_id?: string | string[];
    payment?: string | string[];
    reference?: string | string[];
    trxref?: string | string[];
  }>();
  const router = useRouter();
  const appliedSessionRef = useRef<string | null>(null);

  const onRefresh = useCallback(() => {
    if (walletQuery.canView) void walletQuery.refetch();
    void campaignsQuery.refetch();
    void plansQuery.refetch();
  }, [campaignsQuery, plansQuery, walletQuery]);

  // Stripe Checkout return: ?ad_credit_top_up=1&session_id=cs_...
  // Paystack return: ?reference=mingla_adc_... (and/or trxref)
  useEffect(() => {
    const flag = firstParam(params.ad_credit_top_up);
    const sessionId = firstParam(params.session_id);
    const payment = firstParam(params.payment);
    const paystackRef =
      firstParam(params.reference) ?? firstParam(params.trxref);
    if (payment === "cancelled" || flag === "0") {
      setReturnNotice("Checkout canceled. Credit was not added.");
      router.replace("/(tabs)/marketing/ads" as never);
      return;
    }

    if (brandId === null) return;
    if (!creditManage.allowed || creditManage.isLoading) return;

    if (paystackRef && paystackRef.startsWith("mingla_adc_")) {
      if (appliedSessionRef.current === paystackRef) return;
      appliedSessionRef.current = paystackRef;
      void (async () => {
        try {
          await applyAdCreditTopUp({
            brandId,
            paystackReference: paystackRef,
            idempotencyKey: `top_up:${paystackRef}`,
          });
          setReturnNotice("Ads credit added.");
          await walletQuery.refetch();
        } catch {
          setReturnNotice(
            "Payment returned but credit was not added. Try again or contact support.",
          );
          appliedSessionRef.current = null;
        } finally {
          router.replace("/(tabs)/marketing/ads" as never);
        }
      })();
      return;
    }

    if (flag !== "1" || sessionId === null) return;
    if (appliedSessionRef.current === sessionId) return;

    appliedSessionRef.current = sessionId;
    void (async () => {
      try {
        await applyAdCreditTopUp({
          brandId,
          checkoutSessionId: sessionId,
        });
        setReturnNotice("Ads credit added.");
        await walletQuery.refetch();
      } catch {
        setReturnNotice(
          "Payment returned but credit was not added. Try again or contact support.",
        );
        appliedSessionRef.current = null;
      } finally {
        router.replace("/(tabs)/marketing/ads" as never);
      }
    })();
  }, [
    brandId,
    creditManage.allowed,
    creditManage.isLoading,
    params.ad_credit_top_up,
    params.payment,
    params.reference,
    params.session_id,
    params.trxref,
    router,
    walletQuery,
  ]);

  const campaigns = campaignsQuery.campaigns;
  const plans = plansQuery.plans;
  const drafts = plansQuery.drafts;
  const launchedPlanIds = plansQuery.launchedPlanIds;
  const planIdByVersionId = plansQuery.planIdByVersionId;
  const adItems = useMemo(
    () =>
      buildHostAdList({
        drafts,
        plans,
        campaigns,
        launchedPlanIds,
        planIdByVersionId,
      }),
    [campaigns, drafts, launchedPlanIds, planIdByVersionId, plans],
  );
  const filteredAds = useMemo(
    () => adItems.filter((item) => hostAdMatchesFilter(item, campaignFilter)),
    [adItems, campaignFilter],
  );

  if (brandId === null) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Pick a brand"
          description="Choose a brand to see Ads credit."
          testID="ads-no-brand"
        />
      </View>
    );
  }

  if (permissions.isLoading) {
    return (
      <View style={styles.host} testID="ads-skeleton">
        <ActivityIndicator color={color.text2} />
      </View>
    );
  }

  if (permissions.isError) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Couldn't check Ads access"
          description="Check your connection and try again."
          testID="ads-view-error"
          cta={{
            label: "Retry",
            onPress: () => {
              void permissions.refetch();
            },
          }}
        />
      </View>
    );
  }

  if (!permissions.canRead) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Ads access required"
          description="Ask a brand owner to grant Ads view access for this brand."
          testID="ads-view-denied"
        />
      </View>
    );
  }

  const wallet = walletQuery.canView ? walletQuery.data?.wallet : null;
  const history = walletQuery.canView ? (walletQuery.data?.history ?? []) : [];
  const authority = walletQuery.canView
    ? walletQuery.data?.currency_authority
    : undefined;
  const authorityCurrency =
    authority?.resolved === true &&
    typeof authority.currency === "string" &&
    /^[A-Z]{3}$/.test(authority.currency)
      ? authority.currency
      : null;
  const walletAligned =
    wallet === null ||
    wallet === undefined ||
    (wallet.currency_status === "aligned" &&
      wallet.currency === authorityCurrency &&
      wallet.authority_currency === authorityCurrency);
  const currency = authorityCurrency;
  const balanceCents = wallet?.balance_cents ?? 0;

  return (
    <View style={styles.host} testID="ads-credit-screen">
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: scrollBottomPadding },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={
              walletQuery.isRefetching ||
              campaignsQuery.isRefetching ||
              plansQuery.isRefetching
            }
            onRefresh={onRefresh}
          />
        }
      >
        {returnNotice !== null ? (
          <Text style={styles.notice} testID="ads-return-notice">
            {returnNotice}
          </Text>
        ) : null}
        <View style={[styles.workspace, isWideDesktop && styles.workspaceWide]}>
          <View
            style={[
              styles.supportColumn,
              isWideDesktop && styles.supportColumnWide,
            ]}
          >
        {walletQuery.viewLoading ? (
          <GlassCard variant="elevated" padding={space[6]}>
            <ActivityIndicator color={color.text2} />
          </GlassCard>
        ) : walletQuery.viewError ? (
          <GlassCard variant="elevated" padding={space[6]}>
            <Text style={styles.kicker}>Ads credit unavailable</Text>
            <Text style={styles.sub}>Check your connection and try again.</Text>
            <Pressable
              style={styles.actionBtn}
              onPress={() => void walletQuery.refetchView()}
              accessibilityRole="button"
              accessibilityLabel="Retry Ads credit access"
            >
              <Text style={styles.actionLabel}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : !walletQuery.canView ? (
          <GlassCard variant="elevated" padding={space[6]}>
            <Text style={styles.kicker}>Ads credit</Text>
            <Text style={styles.sub}>
              You can review plans and campaign results. A brand owner or
              finance manager manages the balance and payment history.
            </Text>
          </GlassCard>
        ) : !walletQuery.hasResolved && !walletQuery.isError ? (
          <GlassCard variant="elevated" padding={space[6]}>
            <ActivityIndicator color={color.text2} />
          </GlassCard>
        ) : walletQuery.viewError || walletQuery.isError ? (
          <GlassCard variant="elevated" padding={space[6]}>
            <Text style={styles.kicker}>Ads credit unavailable</Text>
            <Text style={styles.sub}>Check your connection and try again.</Text>
            <Pressable
              style={styles.actionBtn}
              onPress={() => void walletQuery.refetch()}
              accessibilityRole="button"
              accessibilityLabel="Retry Ads credit"
            >
              <Text style={styles.actionLabel}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : currency === null || !walletAligned ? (
          <GlassCard variant="elevated" padding={space[6]}>
            <Text style={styles.kicker}>Finish payout setup</Text>
            <Text style={styles.sub}>
              Ads credit unlocks after this brand has one verified settlement
              currency and payout account. No default currency is assumed.
            </Text>
          </GlassCard>
        ) : (
          <GlassCard variant="elevated" padding={space[6]}>
            <Text style={styles.kicker}>Available credit</Text>
            <Text style={styles.balance} testID="ads-credit-balance">
              {formatHostAdMoneyCents(balanceCents, currency) ??
                formatCurrency(balanceCents, currency, true)}
            </Text>
            <Text style={styles.sub}>
              Top-ups keep 15% as Mingla&apos;s fee. Withdraw unused credit any
              time. Payments and refunds stay in this brand&apos;s verified
              settlement currency.
            </Text>
            {creditManage.allowed ? (
              <View style={styles.actions}>
                <Pressable
                  style={styles.actionBtn}
                  onPress={() => setSheetMode("top_up")}
                  accessibilityRole="button"
                  accessibilityLabel="Add Ads credit"
                  testID="ads-add-credit"
                >
                  <Text style={styles.actionLabel}>Add credit</Text>
                </Pressable>
                <Pressable
                  style={styles.actionBtn}
                  onPress={() => setSheetMode("withdraw")}
                  accessibilityRole="button"
                  accessibilityLabel="Withdraw Ads credit"
                  testID="ads-withdraw"
                >
                  <Text style={styles.actionLabel}>Withdraw</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.sub}>
                A brand owner or finance manager controls top-ups and
                withdrawals.
              </Text>
            )}
          </GlassCard>
        )}
          </View>
          <View
            style={[
              styles.primaryColumn,
              isWideDesktop && styles.primaryColumnWide,
            ]}
          >
        {adItems.length > 0 ? (
          <AdListSummaryCard summary={campaignsQuery.summary} />
        ) : null}
        {adItems.length > 0 ? <View style={styles.filterRow} testID="ads-campaign-filters">
          {FILTERS.map(({ key, label }) => {
            const selected = campaignFilter === key;
            return (
              <Pressable
                key={key}
                style={[styles.filterChip, selected && styles.filterChipOn]}
                onPress={() => setCampaignFilter(key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Filter ads: ${label}`}
                testID={`ads-filter-${key.replaceAll("_", "-")}`}
              >
                <Text
                  style={[
                    styles.filterChipLabel,
                    selected && styles.filterChipLabelOn,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View> : null}
        <GlassCard variant="base" padding={0}>
          {campaignsQuery.isLoading || plansQuery.isLoading ? (
            <View style={styles.emptyHistory} testID="ads-list-loading">
              <ActivityIndicator color={color.text2} />
            </View>
          ) : campaignsQuery.isError || plansQuery.isError ? (
            <View style={styles.emptyHistory} testID="ads-list-error">
              <Text style={styles.emptyHistoryText}>
                We couldn&apos;t load your ads. Pull to refresh and try again.
              </Text>
            </View>
          ) : adItems.length === 0 ? (
            <View style={styles.emptyHistory} testID="ads-campaigns-empty">
              <Text style={styles.emptyHistoryText}>
                No ads yet. Create one here, or ask Ari to set one up for you.
              </Text>
            </View>
          ) : filteredAds.length === 0 ? (
            <View
              style={styles.emptyHistory}
              testID="ads-campaigns-filter-empty"
            >
              <Text style={styles.emptyHistoryText}>
                No ads in this filter.
              </Text>
            </View>
          ) : (
            filteredAds.map((item) => {
              const money = hostAdListRowMoney(item);
              const costEach =
                item.costPerResultCents !== null && item.currency
                  ? formatHostAdMoneyCents(
                      Math.round(item.costPerResultCents),
                      item.currency,
                    )
                  : null;
              return (
                <Pressable
                  key={`${item.kind}:${item.id}`}
                  style={styles.campaignRow}
                  onPress={() => router.push(item.route as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${item.statusLabel ?? LIFECYCLE_LABEL[item.lifecycle]}, ${item.nextAction}`}
                  testID={`ads-${item.kind}-row-${item.id}`}
                >
                  {item.creative?.previewUrl ? (
                    <Image
                      source={{ uri: item.creative.previewUrl }}
                      style={styles.creativeThumb}
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <View style={styles.creativePlaceholder}>
                      <Text style={styles.creativePlaceholderLabel}>AD</Text>
                    </View>
                  )}
                  <View style={styles.campaignText}>
                    <View style={styles.rowHeadline}>
                      <Text style={styles.campaignName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          item.lifecycle === "live" && styles.statusPillLive,
                          item.lifecycle === "needs_attention" &&
                            styles.statusPillAttention,
                        ]}
                      >
                        <Text style={styles.statusPillLabel}>
                          {item.statusLabel ?? LIFECYCLE_LABEL[item.lifecycle]}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.campaignMeta} numberOfLines={1}>
                      {item.platforms.length > 0
                        ? item.platforms.map(platformName).join(" · ")
                        : "Apps chosen during setup"}
                      {item.destination && !/^https?:\/\//i.test(item.destination)
                        ? ` · ${item.destination}`
                        : ""}
                    </Text>
                    <Text style={styles.campaignMeta}>{money}</Text>
                    {item.kind === "campaign" ? (
                      <Text style={styles.campaignMeta}>
                        {item.primaryResultCount.toLocaleString()}{" "}
                        {hostAdResultLabel(item.primaryResultLabel)}
                        {costEach ? ` · ${costEach} each` : ""}
                      </Text>
                    ) : null}
                    {item.reason ? (
                      <Text style={styles.planReason}>
                        {hostAdReviewReason(item.reason)}
                      </Text>
                    ) : null}
                    {item.lifecycle === "paused" &&
                    hostAdPausedReason(item.pauseReason) ? (
                      <Text style={styles.planReason} testID={`ads-paused-reason-${item.id}`}>
                        {hostAdPausedReason(item.pauseReason)}
                      </Text>
                    ) : null}
                    {item.kind === "campaign" &&
                    hostAdLearningAlert({
                      name: item.name,
                      live: item.lifecycle === "live",
                      startedAt: item.startedAt ?? null,
                      nowIso: new Date().toISOString(),
                    }) ? (
                      <Text style={styles.campaignMeta} testID={`ads-learning-${item.id}`}>
                        Still learning: leave it running for about a week before changing it.
                      </Text>
                    ) : null}
                    <Text style={styles.nextAction}>{item.nextAction} →</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </GlassCard>
          </View>
        </View>

        {walletQuery.canView ? (
          <>
            <Text style={styles.sectionTitle}>History</Text>
            <GlassCard variant="base" padding={0}>
              {history.length === 0 ? (
                <View style={styles.emptyHistory} testID="ads-history-empty">
                  <Text style={styles.emptyHistoryText}>
                    No top-ups or withdrawals yet.
                  </Text>
                </View>
              ) : (
                history.map((row) => (
                  <AdCreditLedgerRow key={row.id} row={row} />
                ))
              )}
            </GlassCard>
          </>
        ) : null}
      </ScrollView>

      {sheetMode !== null && currency !== null && walletAligned ? (
        <AdCreditQuoteSheet
          visible
          mode={sheetMode}
          brandId={brandId}
          currency={currency}
          balanceCents={balanceCents}
          canManage={creditManage.allowed}
          onClose={() => setSheetMode(null)}
          onTopUpApplied={() => {
            void walletQuery.refetch();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  scroll: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[9],
    gap: space[4],
  },
  workspace: { gap: space[6], flexDirection: "column-reverse" },
  workspaceWide: { flexDirection: "row-reverse", alignItems: "flex-start" },
  primaryColumn: { minWidth: 0, gap: space[2] },
  primaryColumnWide: { flexBasis: 0, flexGrow: 5 },
  supportColumn: { minWidth: 0, gap: space[2] },
  supportColumnWide: { flexBasis: 0, flexGrow: 3 },
  notice: {
    ...type.caption,
    color: color.text2,
  },
  kicker: {
    ...type.caption,
    color: color.text2,
  },
  balance: {
    ...type.stat,
    color: color.text1,
    marginTop: space[1],
  },
  sub: {
    ...type.caption,
    color: color.text3,
    marginTop: space[2],
  },
  actions: {
    flexDirection: "row",
    gap: space[2],
    marginTop: space[4],
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space[2],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  actionLabel: {
    ...type.btnSm,
    color: color.text1,
  },
  sectionTitle: {
    ...type.h1,
    color: color.text1,
    marginTop: space[2],
  },
  subsectionTitle: {
    ...type.small,
    color: color.text2,
    fontWeight: "700",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  createBtn: {
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.full,
    backgroundColor: color.paper,
  },
  createBtnDisabled: {
    opacity: 0.45,
  },
  createBtnLabel: {
    ...type.btnSm,
    color: color.ink,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
  },
  filterChip: {
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tile,
  },
  filterChipOn: {
    borderColor: color.text1,
    backgroundColor: color.fill.pressed,
  },
  filterChipLabel: {
    ...type.caption,
    color: color.text2,
  },
  filterChipLabelOn: {
    color: color.text1,
    fontWeight: "600",
  },
  emptyHistory: {
    padding: space[6],
  },
  emptyHistoryText: {
    ...type.small,
    color: color.text2,
  },
  campaignRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: space[6],
    paddingVertical: space[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.lineStrong,
    gap: space[2],
  },
  campaignText: {
    flex: 1,
    gap: 2,
  },
  rowHeadline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  campaignName: {
    ...type.body,
    color: color.text1,
    flex: 1,
  },
  campaignMeta: {
    ...type.caption,
    color: color.text2,
  },
  planReason: {
    ...type.caption,
    color: color.text2,
    marginTop: space[1],
  },
  creativeThumb: {
    width: 56,
    height: 70,
    borderRadius: 10,
    backgroundColor: color.fill.tile,
  },
  creativePlaceholder: {
    width: 56,
    height: 70,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
  },
  creativePlaceholderLabel: {
    ...type.caption,
    color: color.text3,
    fontWeight: "700",
  },
  statusPill: {
    paddingHorizontal: space[2],
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
  },
  statusPillLive: {
    backgroundColor: color.successTint,
  },
  statusPillAttention: {
    backgroundColor: color.errorTint,
  },
  statusPillLabel: {
    ...type.caption,
    color: color.text1,
  },
  nextAction: {
    ...type.caption,
    color: color.text1,
    fontWeight: "700",
    marginTop: space[1],
  },
});
