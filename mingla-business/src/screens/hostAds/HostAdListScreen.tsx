/**
 * #4238 W6b — Promote home (design v9, on the #4420 Graphite Glass kit).
 *
 * The Ads credit card first (what the Host has, how much is held for
 * running ads, and what reaches the apps after the 15% Mingla fee), then
 * the ads with their TRUE status ("Paused · Credit ran out", never "ended
 * or isn't public"), then Compare and Receipts and statements. Top up and
 * withdraw describe how money moves by currency, never by a provider's
 * name; the fee comes back on a withdraw only.
 *
 * Every amount is what the Host pays: the wallet and budgets are Ads credit
 * on the server, shown through hostAdPayFromCredit.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { color, radius, space, type } from "../../constants/designSystem";
import { useAdCreditWallet } from "../../hooks/marketing/useAdCreditWallet";
import { useHostAdCampaigns } from "../../hooks/marketing/useHostAdCampaigns";
import { useHostAdPlans } from "../../hooks/marketing/useHostAdPlans";
import { useCanManageBrandPayments } from "../../hooks/useCanManageBrandPayments";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import { applyAdCreditTopUp } from "../../services/adCreditService";
import { minorFromMajor } from "../../utils/currency";
import { buildHostAdList, type HostAdListItem } from "../../services/hostAdLifecycle";
import { AdListSummaryCard } from "../../components/marketing/ads/results/AdListSummaryCard";
import { hostAdScrollBottomPadding } from "../../components/marketing/ads/hostAdBuilderRules";
import { formatHostAdMoneyCents } from "../../components/marketing/ads/hostAdMoney";
import { hostAdPayFromCredit } from "../../components/marketing/ads/hostAdBuilderModel";
import {
  builderStyles as bs,
  Blocker,
  BuilderCard,
  BuilderLabel,
  BuilderList,
  Note,
  Segmented,
  ValueRow,
} from "../../components/marketing/ads/HostAdBuilderBits";
import { hm, hostAdReasonShort, hostAdUnit } from "../../components/marketing/ads/hostAdManageCopy";
import {
  hostAdCompareRows,
  hostAdCreditCard,
  hostAdGoalFromResult,
  hostAdReasonFromCode,
} from "../../components/marketing/ads/hostAdManageModel";
import {
  HostAdCompareSheet,
  HostAdMoneyExplainer,
  HostAdReceiptsSheet,
  HostAdWithdrawSheet,
} from "../../components/marketing/ads/HostAdManageSheets";
import { HostAdTopUpSheet } from "../../components/marketing/ads/HostAdTopUpSheet";

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) return value[0];
  return null;
}

type Filter = "all" | "running" | "ended";
type Overlay = "topUp" | "withdraw" | "receipts" | "compare" | null;

/** The status chip's words and tone for one row (true reason when paused). */
export function hostAdRowStatus(item: HostAdListItem): { label: string; tone: string } {
  const reason = item.lifecycle === "paused" ? hostAdReasonFromCode(item.pauseReason ?? null) : null;
  switch (item.lifecycle) {
    case "live":
      return { label: hm("status.running"), tone: color.successText };
    case "in_review":
      return { label: hm("status.inReview"), tone: color.infoText };
    case "scheduled":
      return { label: hm("status.scheduled"), tone: color.infoText };
    case "paused":
      return {
        label: reason ? hm("status.with", { status: hm("status.paused"), reason: hostAdReasonShort(reason) }) : hm("status.paused"),
        tone: color.warningText,
      };
    case "needs_attention":
      return { label: hm("status.attention"), tone: color.errorText };
    case "ended":
      return { label: hm("status.ended"), tone: color.text3 };
    case "draft":
      return { label: hm("status.draft"), tone: color.text3 };
    default: {
      const never: never = item.lifecycle;
      return { label: String(never), tone: color.text3 };
    }
  }
}

function Chip(props: { label: string; tone: string }): React.ReactElement {
  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: props.tone }]} />
      <Text style={styles.chipText}>{props.label}</Text>
    </View>
  );
}

export default function MarketingAdsRoute(): React.ReactElement {
  const scrollBottomPadding = hostAdScrollBottomPadding(useStickyFooterOffset());
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const walletQuery = useAdCreditWallet(brandId);
  const campaignsQuery = useHostAdCampaigns(brandId);
  const plansQuery = useHostAdPlans(brandId);
  const creditManage = useCanManageBrandPayments(brandId);
  const permissions = useHostAdPermissions(brandId);
  const network = useNetInfoSafe();
  const offline = network?.isConnected === false;
  const { isWideDesktop } = useResponsiveLayout();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
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

  // The secure payment window returns here: ?ad_credit_top_up=1&session_id=…
  // or ?reference=mingla_adc_… (and/or trxref). Applied once per reference.
  useEffect(() => {
    const flag = firstParam(params.ad_credit_top_up);
    const sessionId = firstParam(params.session_id);
    const payment = firstParam(params.payment);
    const reference = firstParam(params.reference) ?? firstParam(params.trxref);
    if (payment === "cancelled" || flag === "0") {
      setReturnNotice(hm("credit.cancelled"));
      router.replace("/(tabs)/marketing/ads" as never);
      return;
    }
    if (brandId === null || !creditManage.allowed || creditManage.isLoading) return;
    const apply = (key: string, input: Parameters<typeof applyAdCreditTopUp>[0]): void => {
      if (appliedSessionRef.current === key) return;
      appliedSessionRef.current = key;
      void (async () => {
        try {
          await applyAdCreditTopUp(input);
          setReturnNotice(hm("credit.added"));
          await walletQuery.refetch();
        } catch {
          setReturnNotice(hm("credit.notAdded"));
          appliedSessionRef.current = null;
        } finally {
          router.replace("/(tabs)/marketing/ads" as never);
        }
      })();
    };
    if (reference && reference.startsWith("mingla_adc_")) {
      apply(reference, { brandId, paystackReference: reference, idempotencyKey: `top_up:${reference}` });
      return;
    }
    if (flag === "1" && sessionId !== null) apply(sessionId, { brandId, checkoutSessionId: sessionId });
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

  const adItems = useMemo(
    () =>
      buildHostAdList({
        drafts: plansQuery.drafts,
        plans: plansQuery.plans,
        campaigns: campaignsQuery.campaigns,
        launchedPlanIds: plansQuery.launchedPlanIds,
        planIdByVersionId: plansQuery.planIdByVersionId,
      }),
    [campaignsQuery.campaigns, plansQuery.drafts, plansQuery.launchedPlanIds, plansQuery.planIdByVersionId, plansQuery.plans],
  );
  const shown = useMemo(
    () =>
      adItems.filter((item) =>
        filter === "all" ? true : filter === "ended" ? item.lifecycle === "ended" : item.lifecycle !== "ended" && item.lifecycle !== "draft",
      ),
    [adItems, filter],
  );

  if (brandId === null) {
    return (
      <View style={styles.host}>
        <EmptyState illustration="users" title={hm("detail.notFound")} description={hm("detail.notFoundBody")} testID="ads-no-brand" />
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
          title={hm("list.errorTitle")}
          description={hm("list.errorBody")}
          testID="ads-view-error"
          cta={{ label: hm("detail.tryAgain"), onPress: () => void permissions.refetch() }}
        />
      </View>
    );
  }
  if (!permissions.canRead) {
    return (
      <View style={styles.host}>
        <EmptyState illustration="users" title={hm("detail.noAccess")} description={hm("detail.noAccessNoName")} testID="ads-view-denied" />
      </View>
    );
  }

  // ── Money ───────────────────────────────────────────────────────────────
  const wallet = walletQuery.canView ? walletQuery.data?.wallet ?? null : null;
  const history = walletQuery.canView ? walletQuery.data?.history ?? [] : [];
  const authority = walletQuery.canView ? walletQuery.data?.currency_authority : undefined;
  const currency =
    authority?.resolved === true && typeof authority.currency === "string" && /^[A-Z]{3}$/.test(authority.currency)
      ? authority.currency
      : null;
  const walletAligned =
    wallet === null ||
    (wallet.currency_status === "aligned" && wallet.currency === currency && wallet.authority_currency === currency);
  const walletCredit = wallet?.balance_cents ?? 0;
  const campaignItems = adItems.filter((item) => item.kind === "campaign");
  const card = hostAdCreditCard({
    walletCredit,
    ads: campaignItems.map((item) => ({ ended: item.lifecycle === "ended", capCredit: item.capCents, spentCredit: item.spendCents })),
  });
  const listCurrency = currency ?? campaignItems.find((item) => item.currency)?.currency ?? null;
  const money = (cents: number): string => (listCurrency ? formatHostAdMoneyCents(cents, listCurrency) ?? "" : "");
  const topUpTiles = (currency === "NGN" ? [20_000, 50_000, 100_000] : [20, 50, 100]).map((major) =>
    currency ? minorFromMajor(major, currency) : 0,
  );
  const compareRows = hostAdCompareRows(
    campaignItems.map((item) => ({
      id: item.id,
      name: item.name,
      result: item.primaryResultLabel,
      spentCredit: item.spendCents,
      count: item.primaryResultCount,
    })),
  );
  const canPromote = permissions.canPlan && !offline;
  const promoteWhy = offline ? hm("promoteOffline") : null;
  const loading = campaignsQuery.isLoading || plansQuery.isLoading;
  const listError = campaignsQuery.isError || plansQuery.isError;

  const creditCard = !walletQuery.canView ? null : walletQuery.viewLoading || (!walletQuery.hasResolved && !walletQuery.isError) ? (
    <BuilderCard testID="ads-credit-loading">
      <ActivityIndicator color={color.text2} />
    </BuilderCard>
  ) : walletQuery.isError || walletQuery.viewError ? (
    <BuilderCard testID="ads-credit-error">
      <BuilderLabel>{hm("credit.label")}</BuilderLabel>
      <Text style={bs.small}>{hm("credit.error")}</Text>
      <View style={bs.actions}>
        <Button label={hm("detail.tryAgain")} variant="secondary" size="sm" onPress={() => void walletQuery.refetch()} testID="ads-credit-retry" />
      </View>
    </BuilderCard>
  ) : currency === null || !walletAligned ? (
    <BuilderCard testID="ads-credit-setup">
      <BuilderLabel>{hm("credit.label")}</BuilderLabel>
      <Text style={bs.small}>{hm("credit.setup")}</Text>
    </BuilderCard>
  ) : (
    <BuilderCard accessibilityLabel={hm("credit.label")} testID="ads-credit-card">
      <BuilderLabel>{hm("credit.label")}</BuilderLabel>
      <View style={styles.creditStack}>
        <Text style={bs.statXl} testID="ads-credit-balance">{money(card.totalPay)}</Text>
        <Text style={bs.small} testID="ads-credit-held">
          {card.totalPay > 0 ? hm("credit.held", { amount: money(card.heldPay) }) : hm("credit.none")}
        </Text>
        {card.totalPay > 0 ? (
          <>
            <Text style={bs.small} testID="ads-credit-free">{hm("credit.free", { amount: money(card.freePay) })}</Text>
            <Text style={bs.caption} testID="ads-credit-to-ads">{hm("credit.toAds", { amount: money(card.toAdsCredit) })}</Text>
          </>
        ) : null}
      </View>
      {!creditManage.allowed ? (
        <Note tone="info" text={hm("credit.teamNoName")} testID="ads-credit-team" />
      ) : offline ? null : (
        <View style={bs.actions}>
          <Button label={hm("credit.topUp")} variant="secondary" size="md" onPress={() => setOverlay("topUp")} testID="ads-add-credit" />
          {walletCredit > 0 ? (
            <Button label={hm("credit.withdraw")} variant="ghost" size="md" onPress={() => setOverlay("withdraw")} testID="ads-withdraw" />
          ) : null}
        </View>
      )}
    </BuilderCard>
  );

  const banner = offline ? <Note tone="info" text={hm("list.offline")} testID="ads-offline" /> : null;

  const rowLine = (item: HostAdListItem): string => {
    if (item.kind === "draft") return hm("list.draftLine");
    if (item.kind !== "campaign" || !item.spendCents) return item.nextAction;
    const spent = money(hostAdPayFromCredit(item.spendCents));
    const goal = hostAdGoalFromResult(item.primaryResultLabel);
    return item.primaryResultCount > 0
      ? hm("list.resultLine", {
          spent,
          count: item.primaryResultCount,
          unit: hostAdUnit(goal, item.primaryResultCount === 1),
          each: money(Math.round(hostAdPayFromCredit(item.spendCents) / item.primaryResultCount)),
        })
      : hm("list.spentLine", { spent });
  };

  const list = loading ? (
    <View style={bs.stack} testID="ads-list-loading">
      {[0, 1, 2].map((key) => (
        <View key={key} style={styles.skelRow} />
      ))}
    </View>
  ) : listError ? (
    <BuilderCard testID="ads-list-error">
      <Text style={styles.h2}>{hm("list.errorTitle")}</Text>
      <Text style={bs.small}>{hm("list.errorBody")}</Text>
      <View style={bs.actions}>
        <Button label={hm("detail.tryAgain")} variant="secondary" size="md" onPress={onRefresh} testID="ads-list-retry" />
        <Button label={hm("detail.help")} variant="ghost" size="md" onPress={() => router.push("/account/support" as never)} testID="ads-list-help" />
      </View>
    </BuilderCard>
  ) : adItems.length === 0 ? (
    <BuilderCard testID="ads-campaigns-empty">
      <Text style={styles.h2}>{hm("list.emptyTitle")}</Text>
      <Text style={bs.small}>{hm("list.emptyBody")}</Text>
      <View style={bs.actions}>
        <Button
          label={hm("list.askAri")}
          variant="secondary"
          size="md"
          onPress={() => router.push(`/(tabs)/ari?brandId=${encodeURIComponent(brandId)}` as never)}
          testID="ads-empty-ari"
        />
      </View>
    </BuilderCard>
  ) : shown.length === 0 ? (
    <Text style={bs.small} testID="ads-campaigns-filter-empty">{hm("list.filterEmpty")}</Text>
  ) : isWideDesktop ? (
    <View style={styles.table} testID="ads-table">
      <View style={[styles.tr, styles.th]}>
        <Text style={[styles.td, styles.tdName, styles.thText]}>{hm("list.colAd")}</Text>
        <Text style={[styles.td, styles.tdStatus, styles.thText]}>{hm("list.colStatus")}</Text>
        <Text style={[styles.td, styles.thText]}>{hm("list.colSpent")}</Text>
        <Text style={[styles.td, styles.thText]}>{hm("list.colResults")}</Text>
        <Text style={[styles.td, styles.thText]}>{hm("list.colEach")}</Text>
      </View>
      {shown.map((item) => {
        const status = hostAdRowStatus(item);
        const spentPay = item.spendCents ? hostAdPayFromCredit(item.spendCents) : 0;
        return (
          <Pressable
            key={`${item.kind}:${item.id}`}
            style={({ pressed }) => [styles.tr, pressed && styles.rowPressed]}
            onPress={() => router.push(item.route as never)}
            accessibilityRole="button"
            accessibilityLabel={hm("list.open", { name: item.name })}
            testID={`ads-${item.kind}-row-${item.id}`}
          >
            <Text style={[styles.td, styles.tdName]} numberOfLines={1}>{item.name}</Text>
            <View style={[styles.td, styles.tdStatus]}>
              <Chip label={status.label} tone={status.tone} />
            </View>
            <Text style={styles.td}>{spentPay ? money(spentPay) : "—"}</Text>
            <Text style={styles.td}>
              {item.primaryResultCount ? `${item.primaryResultCount} ${hostAdUnit(hostAdGoalFromResult(item.primaryResultLabel))}` : "—"}
            </Text>
            <Text style={styles.td}>{item.primaryResultCount && spentPay ? money(Math.round(spentPay / item.primaryResultCount)) : "—"}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : (
    <BuilderList testID="ads-list">
      {shown.map((item, index) => {
        const status = hostAdRowStatus(item);
        return (
          <Pressable
            key={`${item.kind}:${item.id}`}
            style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.rowPressed]}
            onPress={() => router.push(item.route as never)}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${status.label}, ${rowLine(item)}`}
            testID={`ads-${item.kind}-row-${item.id}`}
          >
            <View style={styles.grow}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Chip label={status.label} tone={status.tone} />
              <Text style={bs.caption} testID={`ads-row-line-${item.id}`}>{rowLine(item)}</Text>
            </View>
          </Pressable>
        );
      })}
    </BuilderList>
  );

  const tools =
    adItems.length > 0 && !loading ? (
      <BuilderList testID="ads-tools">
        <ValueRow label={hm("tools.compare")} value={hm("tools.compareSub")} onPress={() => setOverlay("compare")} testID="ads-compare" />
        {creditManage.allowed && walletQuery.canView ? (
          <ValueRow divider label={hm("tools.receipts")} value={hm("tools.receiptsSub")} onPress={() => setOverlay("receipts")} testID="ads-receipts" />
        ) : null}
      </BuilderList>
    ) : null;

  const promoteButton = (
    <View style={bs.stack}>
      {promoteWhy ? <Blocker text={promoteWhy} testID="ads-promote-why" /> : null}
      <Button
        label={hm("promotePage")}
        variant="primary"
        fullWidth={!isWideDesktop}
        disabled={!canPromote}
        onPress={() => router.push("/(tabs)/marketing/ads/create" as never)}
        testID="ads-promote"
      />
    </View>
  );

  const filters =
    adItems.length > 0 ? (
      <Segmented
        value={filter}
        options={[
          { id: "all", label: hm("filter.all") },
          { id: "running", label: hm("filter.running") },
          { id: "ended", label: hm("filter.ended") },
        ]}
        onChange={setFilter}
        accessibilityLabel={hm("filter.label")}
        testID="ads-campaign-filters"
      />
    ) : null;

  return (
    <View style={styles.host} testID="ads-credit-screen">
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPadding }]}
        refreshControl={
          <RefreshControl
            refreshing={walletQuery.isRefetching || campaignsQuery.isRefetching || plansQuery.isRefetching}
            onRefresh={onRefresh}
          />
        }
      >
        {returnNotice !== null ? <Note tone="info" text={returnNotice} testID="ads-return-notice" /> : null}
        {isWideDesktop ? (
          <View style={styles.desk}>
            <View style={styles.deskMain}>
              <View style={bs.rowBetween}>
                <Text style={styles.title} accessibilityRole="header">{hm("title")}</Text>
                {promoteButton}
              </View>
              {banner}
              {adItems.length > 0 ? <AdListSummaryCard summary={campaignsQuery.summary} /> : null}
              {filters}
              {list}
            </View>
            <View style={styles.deskSide}>
              {creditCard}
              {tools}
              <HostAdMoneyExplainer />
            </View>
          </View>
        ) : (
          <View style={styles.phone}>
            <Text style={styles.title} accessibilityRole="header">{hm("title")}</Text>
            {banner}
            {creditCard}
            {adItems.length > 0 ? <Text style={styles.h2} accessibilityRole="header">{hm("yourAds")}</Text> : null}
            {filters}
            {list}
            {tools}
            <HostAdMoneyExplainer />
            {promoteButton}
          </View>
        )}
      </ScrollView>

      {currency !== null && walletAligned ? (
        <>
          <HostAdTopUpSheet
            visible={overlay === "topUp"}
            brandId={brandId}
            currency={currency}
            neededCents={topUpTiles[1] ?? 0}
            options={topUpTiles}
            returnPath="/marketing/ads"
            money={money}
            onClose={() => setOverlay(null)}
            onApplied={() => {
              setOverlay(null);
              setReturnNotice(hm("credit.added"));
              void walletQuery.refetch();
            }}
          />
          <HostAdWithdrawSheet
            visible={overlay === "withdraw"}
            brandId={brandId}
            currency={currency}
            money={money}
            walletCredit={walletCredit}
            heldPay={card.heldPay}
            onClose={() => setOverlay(null)}
            onDone={(message) => {
              setOverlay(null);
              setReturnNotice(message);
              void walletQuery.refetch();
            }}
          />
          <HostAdReceiptsSheet
            visible={overlay === "receipts"}
            brandId={brandId}
            money={money}
            history={history}
            nowIso={new Date().toISOString()}
            onClose={() => setOverlay(null)}
          />
        </>
      ) : null}
      <HostAdCompareSheet visible={overlay === "compare"} rows={compareRows} money={money} onClose={() => setOverlay(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: color.canvas },
  scroll: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[9], gap: space[6] },
  phone: { gap: space[6] },
  desk: { flexDirection: "row", alignItems: "flex-start", gap: space[8] },
  deskMain: { flex: 1, minWidth: 0, gap: space[6] },
  deskSide: { width: 360, gap: space[6] },
  title: { ...type.h1, color: color.text1 },
  h2: { ...type.h2, color: color.text1 },
  creditStack: { gap: space[2] },
  grow: { flex: 1, minWidth: 0, gap: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[4], paddingVertical: space[4], paddingHorizontal: space[5], minHeight: 72 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  rowPressed: { backgroundColor: color.fill.rowHover },
  rowTitle: { ...type.row, color: color.text1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space[2],
    paddingVertical: 2,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { ...type.caption, color: color.text1 },
  skelRow: { height: 72, borderRadius: radius.lg, backgroundColor: color.fill.tile },
  table: { borderRadius: radius.xl, overflow: "hidden", backgroundColor: color.card2 },
  tr: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    paddingVertical: space[4],
    paddingHorizontal: space[5],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  th: { backgroundColor: color.fill.tableHead, borderTopWidth: 0 },
  thText: { color: color.text2 },
  td: { ...type.small, color: color.text1, flex: 1, textAlign: "right" },
  tdName: { flex: 2, textAlign: "left" },
  tdStatus: { flex: 2, alignItems: "flex-start" },
});
