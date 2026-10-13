/**
 * toward #3697 Wave 7 / 7b / 7c — Blast → Ads (credit + host campaigns).
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
import { useCanManageBrandPayments } from "../../../../src/hooks/useCanManageBrandPayments";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { applyAdCreditTopUp } from "../../../../src/services/adCreditService";
import { formatCurrency } from "../../../../src/utils/currency";

function firstParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) {
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

export default function MarketingAdsRoute(): React.ReactElement {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const walletQuery = useAdCreditWallet(brandId);
  const campaignsQuery = useHostAdCampaigns(brandId);
  const manage = useCanManageBrandPayments(brandId);
  const [sheetMode, setSheetMode] = useState<AdCreditQuoteMode | null>(null);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
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
    void walletQuery.refetch();
    void campaignsQuery.refetch();
  }, [campaignsQuery, walletQuery]);

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
    if (!manage.allowed || manage.isLoading) return;

    if (paystackRef && paystackRef.startsWith("mingla_adc_")) {
      if (appliedSessionRef.current === paystackRef) return;
      appliedSessionRef.current = paystackRef;
      void (async () => {
        try {
          await applyAdCreditTopUp({
            brandId,
            payCents: 0,
            currency: "NGN",
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
          payCents: 0,
          currency: "USD",
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
    manage.allowed,
    manage.isLoading,
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

  if (walletQuery.viewLoading || (!walletQuery.hasResolved && !walletQuery.isError)) {
    return (
      <View style={styles.host} testID="ads-skeleton">
        <ActivityIndicator color={textTokens.secondary} />
      </View>
    );
  }

  if (walletQuery.viewError) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Couldn't check access"
          description="Check your connection and try again."
          testID="ads-view-error"
          cta={{
            label: "Retry",
            onPress: () => {
              void walletQuery.refetchView();
            },
          }}
        />
      </View>
    );
  }

  if (!walletQuery.canView) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Payments view required"
          description="Ask a brand owner or finance manager to open Ads credit."
          testID="ads-view-denied"
        />
      </View>
    );
  }

  if (walletQuery.isError) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Couldn't load Ads credit"
          description="Check your connection and try again."
          testID="ads-load-error"
          cta={{
            label: "Retry",
            onPress: () => {
              void walletQuery.refetch();
            },
          }}
        />
      </View>
    );
  }

  const wallet = walletQuery.data?.wallet;
  const history = walletQuery.data?.history ?? [];
  const currency = wallet?.currency ?? "USD";
  const balanceCents = wallet?.balance_cents ?? 0;
  const campaigns = campaignsQuery.campaigns;

  return (
    <View style={styles.host} testID="ads-credit-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={walletQuery.isRefetching || campaignsQuery.isRefetching}
            onRefresh={onRefresh}
          />
        }
      >
        {returnNotice !== null ? (
          <Text style={styles.notice} testID="ads-return-notice">
            {returnNotice}
          </Text>
        ) : null}
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.kicker}>Available credit</Text>
          <Text style={styles.balance} testID="ads-credit-balance">
            {formatCurrency(balanceCents, currency, true)}
          </Text>
          <Text style={styles.sub}>
            Top-ups keep 15% as Mingla&apos;s fee. Withdraw unused credit any time.
            USD/GBP by card; Naira via Paystack.
          </Text>
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
        </GlassCard>

        <Text style={styles.sectionTitle}>Your ads</Text>
        <GlassCard variant="base" padding={0}>
          {campaigns.length === 0 ? (
            <View style={styles.emptyHistory} testID="ads-campaigns-empty">
              <Text style={styles.emptyHistoryText}>
                No Host ads yet. Ask Ari to propose a plan, or add credit first.
              </Text>
            </View>
          ) : (
            campaigns.map((c) => (
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
                    {formatCurrency(
                      Number(c.cap_cents ?? c.daily_budget_cents ?? 0),
                      c.currency ?? currency,
                      true,
                    )}
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
      </ScrollView>

      {sheetMode !== null ? (
        <AdCreditQuoteSheet
          visible
          mode={sheetMode}
          brandId={brandId}
          currency={currency}
          balanceCents={balanceCents}
          canManage={manage.allowed}
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
    ...typography.bodyMd,
    color: textTokens.primary,
  },
  campaignMeta: {
    ...typography.caption,
    color: textTokens.secondary,
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
