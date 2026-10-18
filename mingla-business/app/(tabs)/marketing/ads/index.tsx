/**
 * toward #3697 Wave 7 / 7b / 7c / 8 — Blast → Ads (credit + host campaigns +
 * status filters).
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { applyAdCreditTopUp } from "../../../../src/services/adCreditService";
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

function statusLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === "ACTIVE") return "Live";
  if (s === "PAUSED") return "Paused";
  if (s === "ARCHIVED" || s === "DELETED") return "Ended";
  return status;
}

type CampaignFilter = "all" | "live" | "paused" | "ended";

function campaignMatchesFilter(
  status: string,
  filter: CampaignFilter,
): boolean {
  if (filter === "all") return true;
  const s = status.toUpperCase();
  if (filter === "live") return s === "ACTIVE";
  if (filter === "paused") return s === "PAUSED";
  return s === "ARCHIVED" || s === "DELETED";
}

export default function MarketingAdsRoute(): React.ReactElement {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const walletQuery = useAdCreditWallet(brandId);
  const campaignsQuery = useHostAdCampaigns(brandId);
  const plansQuery = useHostAdPlans(brandId);
  const creditManage = useCanManageBrandPayments(brandId);
  const permissions = useHostAdPermissions(brandId);
  const [sheetMode, setSheetMode] = useState<AdCreditQuoteMode | null>(null);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
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
  const campaigns = campaignsQuery.campaigns;
  const plans = plansQuery.plans;
  const filteredCampaigns = campaigns.filter((c) =>
    campaignMatchesFilter(c.status, campaignFilter),
  );

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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your ads</Text>
          <Pressable
            style={[
              styles.createBtn,
              !permissions.canPlan && styles.createBtnDisabled,
            ]}
            onPress={() => router.push("/(tabs)/marketing/ads/create" as never)}
            disabled={!permissions.canPlan}
            accessibilityRole="button"
            accessibilityLabel="Create a Host ad"
            accessibilityState={{ disabled: !permissions.canPlan }}
            testID="ads-create"
          >
            <Text style={styles.createBtnLabel}>Create ad</Text>
          </Pressable>
        </View>
        {plans.length > 0 ? (
          <>
            <Text style={styles.subsectionTitle}>Plans in progress</Text>
            <GlassCard
              variant="base"
              padding={0}
              testID="ads-plans-in-progress"
            >
              {plans.map((item) => {
                const canonical = item.version.canonical_plan;
                const planName = String(canonical.name ?? "Saved ad plan");
                const platforms = item.provider_allocations
                  .map((allocation) => String(allocation.platform))
                  .join(" · ");
                const reviewReason = item.reviews[0]?.reason;
                return (
                  <Pressable
                    key={item.plan.id}
                    style={styles.campaignRow}
                    onPress={() =>
                      router.push(
                        `/(tabs)/marketing/ads/create?plan_id=${item.plan.id}` as never,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${planName}, ${item.plan.state.replaceAll("_", " ")}`}
                    testID={`ads-plan-row-${item.plan.id}`}
                  >
                    <View style={styles.campaignText}>
                      <Text style={styles.campaignName}>{planName}</Text>
                      <Text style={styles.campaignMeta}>
                        {platforms} ·{" "}
                        {formatCurrency(
                          item.version.host_budget_cents,
                          item.version.host_currency,
                          true,
                        )}{" "}
                        cap
                      </Text>
                      {reviewReason ? (
                        <Text style={styles.planReason}>{reviewReason}</Text>
                      ) : null}
                    </View>
                    <View style={styles.statusPill}>
                      <Text style={styles.statusPillLabel}>
                        {item.plan.state.replaceAll("_", " ")}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </GlassCard>
          </>
        ) : null}
        <View style={styles.filterRow} testID="ads-campaign-filters">
          {(
            [
              ["all", "All", "ads-filter-all"],
              ["live", "Live", "ads-filter-live"],
              ["paused", "Paused", "ads-filter-paused"],
              ["ended", "Ended", "ads-filter-ended"],
            ] as const
          ).map(([key, label, testID]) => {
            const selected = campaignFilter === key;
            return (
              <Pressable
                key={key}
                style={[styles.filterChip, selected && styles.filterChipOn]}
                onPress={() => setCampaignFilter(key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Filter ads: ${label}`}
                testID={testID}
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
        </View>
        <GlassCard variant="base" padding={0}>
          {campaigns.length === 0 ? (
            <View style={styles.emptyHistory} testID="ads-campaigns-empty">
              <Text style={styles.emptyHistoryText}>
                No Host ads yet. Create one here or ask Ari to propose the same
                immutable plan.
              </Text>
            </View>
          ) : filteredCampaigns.length === 0 ? (
            <View
              style={styles.emptyHistory}
              testID="ads-campaigns-filter-empty"
            >
              <Text style={styles.emptyHistoryText}>
                No ads in this filter.
              </Text>
            </View>
          ) : (
            filteredCampaigns.map((c) => (
              <Pressable
                key={c.id}
                style={styles.campaignRow}
                onPress={() =>
                  router.push(`/(tabs)/marketing/ads/${c.id}` as never)
                }
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${statusLabel(c.status)}`}
                testID={`ads-campaign-row-${c.id}`}
              >
                <View style={styles.campaignText}>
                  <Text style={styles.campaignName}>{c.name}</Text>
                  <Text style={styles.campaignMeta}>
                    {c.platform} ·{" "}
                    {typeof c.currency === "string" &&
                    /^[A-Z]{3}$/.test(c.currency)
                      ? formatCurrency(
                          Number(c.cap_cents ?? c.daily_budget_cents ?? 0),
                          c.currency,
                          true,
                        )
                      : "Budget currency unavailable"}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    String(c.status).toUpperCase() === "ACTIVE" &&
                      styles.statusPillLive,
                  ]}
                >
                  <Text style={styles.statusPillLabel}>
                    {statusLabel(c.status)}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </GlassCard>

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
    alignItems: "center",
    justifyContent: "space-between",
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
  campaignName: {
    ...typography.body,
    color: textTokens.primary,
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
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: glass.tint.chrome.idle,
  },
  statusPillLive: {
    backgroundColor: "rgba(46, 160, 90, 0.18)",
  },
  statusPillLabel: {
    ...typography.caption,
    color: textTokens.primary,
  },
});
