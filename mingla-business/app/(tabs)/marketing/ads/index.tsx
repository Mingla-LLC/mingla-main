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

import { AdCreditLedgerRow } from "../../../../src/components/marketing/AdCreditLedgerRow";
import {
  AdCreditQuoteSheet,
  type AdCreditQuoteMode,
} from "../../../../src/components/marketing/AdCreditQuoteSheet";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import {
  canvas,
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useAdCreditWallet } from "../../../../src/hooks/marketing/useAdCreditWallet";
import { useHostAdCampaigns } from "../../../../src/hooks/marketing/useHostAdCampaigns";
import { useHostAdPlans } from "../../../../src/hooks/marketing/useHostAdPlans";
import { useCanManageBrandPayments } from "../../../../src/hooks/useCanManageBrandPayments";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useHostAdPermissions } from "../../../../src/hooks/useHostAdPermissions";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";
import { applyAdCreditTopUp } from "../../../../src/services/adCreditService";
import {
  buildHostAdList,
  hostAdMatchesFilter,
  type HostAdFilter,
  type HostAdLifecycle,
} from "../../../../src/services/hostAdLifecycle";
import { formatCurrency } from "../../../../src/utils/currency";

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
  const adItems = useMemo(
    () => buildHostAdList({ drafts, plans, campaigns }),
    [campaigns, drafts, plans],
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
        <ActivityIndicator color={textTokens.secondary} />
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
        contentContainerStyle={styles.scroll}
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
          <GlassCard variant="elevated" padding={spacing.lg}>
            <ActivityIndicator color={textTokens.secondary} />
          </GlassCard>
        ) : walletQuery.viewError ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
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
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.kicker}>Ads credit</Text>
            <Text style={styles.sub}>
              You can review plans and campaign results. A brand owner or
              finance manager manages the balance and payment history.
            </Text>
          </GlassCard>
        ) : !walletQuery.hasResolved && !walletQuery.isError ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <ActivityIndicator color={textTokens.secondary} />
          </GlassCard>
        ) : walletQuery.viewError || walletQuery.isError ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
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
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.kicker}>Finish payout setup</Text>
            <Text style={styles.sub}>
              Ads credit unlocks after this brand has one verified settlement
              currency and payout account. No default currency is assumed.
            </Text>
          </GlassCard>
        ) : (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.kicker}>Available credit</Text>
            <Text style={styles.balance} testID="ads-credit-balance">
              {formatCurrency(balanceCents, currency, true)}
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
              <ActivityIndicator color={textTokens.secondary} />
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
                No Host ads yet. Create one here or ask Ari to propose the same
                immutable plan.
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
              const hasMoney = item.currency !== null && item.capCents !== null;
              const providerSpend = item.spendByCurrency
                .map((row) =>
                  formatCurrency(row.spend_cents, row.currency, true),
                )
                .join(" · ");
              const money = hasMoney
                ? item.spendCents !== null
                  ? `${formatCurrency(item.spendCents, item.currency as string, true)} of ${formatCurrency(item.capCents as number, item.currency as string, true)} spent`
                  : `${formatCurrency(item.capCents as number, item.currency as string, true)} cap · ${providerSpend || "spend unavailable"}`
                : "Budget set before launch";
              return (
                <Pressable
                  key={`${item.kind}:${item.id}`}
                  style={styles.campaignRow}
                  onPress={() => router.push(item.route as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${LIFECYCLE_LABEL[item.lifecycle]}, ${item.nextAction}`}
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
                          {LIFECYCLE_LABEL[item.lifecycle]}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.campaignMeta} numberOfLines={1}>
                      {item.platforms.length > 0
                        ? item.platforms.join(" · ")
                        : "Platforms chosen during setup"}
                      {item.destination ? ` · ${item.destination}` : ""}
                    </Text>
                    <Text style={styles.campaignMeta}>{money}</Text>
                    {item.kind === "campaign" ? (
                      <Text style={styles.campaignMeta}>
                        {item.primaryResultCount.toLocaleString()}{" "}
                        {item.primaryResultLabel.replaceAll("_", " ")}
                        {item.costPerResultCents !== null && item.currency
                          ? ` · ${formatCurrency(item.costPerResultCents, item.currency, true)} each`
                          : ""}
                      </Text>
                    ) : null}
                    {item.reason ? (
                      <Text style={styles.planReason}>{item.reason}</Text>
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
    backgroundColor: canvas.discover,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  workspace: { gap: spacing.lg, flexDirection: "column-reverse" },
  workspaceWide: { flexDirection: "row-reverse", alignItems: "flex-start" },
  primaryColumn: { minWidth: 0, gap: spacing.sm },
  primaryColumnWide: { flexBasis: 0, flexGrow: 5 },
  supportColumn: { minWidth: 0, gap: spacing.sm },
  supportColumnWide: { flexBasis: 0, flexGrow: 3 },
  notice: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  kicker: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  balance: {
    ...typography.statValue,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  sub: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  actionLabel: {
    ...typography.buttonMd,
    color: textTokens.primary,
  },
  sectionTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.sm,
  },
  subsectionTitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontWeight: "700",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  createBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: "#F5F5F6",
  },
  createBtnDisabled: {
    opacity: 0.45,
  },
  createBtnLabel: {
    ...typography.buttonMd,
    color: "#0c0e12",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.chrome.idle,
  },
  filterChipOn: {
    borderColor: textTokens.primary,
    backgroundColor: glass.tint.chrome.pressed,
  },
  filterChipLabel: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  filterChipLabelOn: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  emptyHistory: {
    padding: spacing.lg,
  },
  emptyHistoryText: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  campaignRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.chrome,
    gap: spacing.sm,
  },
  campaignText: {
    flex: 1,
    gap: 2,
  },
  rowHeadline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  campaignName: {
    ...typography.body,
    color: textTokens.primary,
    flex: 1,
  },
  campaignMeta: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  planReason: {
    ...typography.caption,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  creativeThumb: {
    width: 56,
    height: 70,
    borderRadius: 10,
    backgroundColor: glass.tint.chrome.idle,
  },
  creativePlaceholder: {
    width: 56,
    height: 70,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  creativePlaceholderLabel: {
    ...typography.caption,
    color: textTokens.tertiary,
    fontWeight: "700",
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: glass.tint.chrome.idle,
  },
  statusPillLive: {
    backgroundColor: "rgba(46, 160, 90, 0.18)",
  },
  statusPillAttention: {
    backgroundColor: "rgba(180, 60, 60, 0.18)",
  },
  statusPillLabel: {
    ...typography.caption,
    color: textTokens.primary,
  },
  nextAction: {
    ...typography.caption,
    color: textTokens.primary,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
});
