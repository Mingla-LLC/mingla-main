/**
 * toward #3697 Wave 7c / 8 — Host ad campaign detail (spend vs cap,
 * pause / Cancel-before-spend / End-after-spend — never both).
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import {
  canvas,
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useHostAdPermissions } from "../../../../src/hooks/useHostAdPermissions";
import {
  cancelHostAdCampaign,
  endHostAdCampaign,
  getHostAdCampaign,
  type HostAdCampaignDetail,
  pauseHostAdCampaign,
} from "../../../../src/services/hostAdCampaignService";
import { formatCurrency } from "../../../../src/utils/currency";
import { randomId } from "../../../../src/utils/randomId";

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

export default function HostAdDetailRoute(): React.ReactElement {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const permissions = useHostAdPermissions(brandId);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const campaignId = firstParam(params.id);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<HostAdCampaignDetail | null>(null);

  const load = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canRead) return;
    setError(null);
    try {
      const res = await getHostAdCampaign(brandId, campaignId);
      setPayload(res);
    } catch {
      setError("Could not load this ad.");
      setPayload(null);
    }
  }, [brandId, campaignId, permissions.canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPause = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canPause)
      return;
    setBusy(true);
    setError(null);
    try {
      await pauseHostAdCampaign({ brandId, campaignId });
      await load();
    } catch {
      setError("Could not pause this ad.");
    } finally {
      setBusy(false);
    }
  }, [brandId, campaignId, load, permissions.canPause]);

  const onEnd = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canEnd) return;
    setBusy(true);
    setError(null);
    try {
      await endHostAdCampaign({
        brandId,
        campaignId,
        idempotencyKey: randomId(),
      });
      await load();
    } catch {
      setError("Could not end this ad.");
    } finally {
      setBusy(false);
    }
  }, [brandId, campaignId, load, permissions.canEnd]);

  const onCancel = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canEnd) return;
    setBusy(true);
    setError(null);
    try {
      await cancelHostAdCampaign({
        brandId,
        campaignId,
        idempotencyKey: randomId(),
      });
      await load();
    } catch {
      setError("Could not cancel this ad.");
    } finally {
      setBusy(false);
    }
  }, [brandId, campaignId, load, permissions.canEnd]);

  if (brandId === null || campaignId === null) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Ad not found"
          description="Pick a brand and open an ad from the Ads list."
          testID="ads-detail-missing"
        />
      </View>
    );
  }

  if (permissions.isLoading) {
    return (
      <View style={styles.host} testID="ads-detail-permission-loading">
        <ActivityIndicator color={textTokens.secondary} />
      </View>
    );
  }

  if (permissions.isError || !permissions.canRead) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Ads access required"
          description="Ask a brand owner to grant Ads view access for this brand."
          testID="ads-detail-permission-denied"
        />
      </View>
    );
  }

  if (payload === null && error === null) {
    return (
      <View style={styles.host} testID="ads-detail-skeleton">
        <ActivityIndicator color={textTokens.secondary} />
      </View>
    );
  }

  if (payload === null) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Couldn't load ad"
          description={error ?? "Try again."}
          testID="ads-detail-error"
          cta={{ label: "Retry", onPress: () => void load() }}
        />
      </View>
    );
  }

  const c = payload.campaign;
  const name = String(c.name ?? "Ad");
  const status = payload.plan_state ?? String(c.status ?? "");
  const currencyCandidate = payload.plan_currency ?? c.currency;
  const currency =
    typeof currencyCandidate === "string" &&
    /^[A-Z]{3}$/.test(currencyCandidate)
      ? currencyCandidate
      : null;
  const cap = Number(
    payload.plan_cap_cents ?? c.cap_cents ?? c.daily_budget_cents ?? 0,
  );
  const spent = payload.host_spend_equivalent_cents;
  const hasProviderSpend = payload.provider_spend_by_currency.some(
    (row) => Number(row.spend_cents) > 0,
  );
  const isLive =
    ["LIVE", "PARTIALLY_LIVE"].includes(status.toUpperCase()) ||
    payload.plan_campaigns.some(
      (row) => String(row.status).toUpperCase() === "ACTIVE",
    );
  const isEnded =
    status.toUpperCase() === "ENDED" ||
    payload.plan_campaigns.every((row) =>
      ["ARCHIVED", "DELETED"].includes(String(row.status).toUpperCase()),
    );
  // Phase 3: Cancel before spend; End after — a card never shows both.
  const canCancel = !isEnded && !hasProviderSpend;
  const canEnd = !isEnded && hasProviderSpend;
  const conversions = Number(payload.results?.conversions ?? 0);
  const resultHierarchy = Array.isArray(
    payload.measurement?.manifest?.result_hierarchy,
  )
    ? payload.measurement.manifest.result_hierarchy
    : [];
  const primaryResultLabel = String(
    resultHierarchy[0] ?? "conversions",
  ).replaceAll("_", " ");
  const impressions = payload.spend_daily.reduce(
    (total, row) => total + Number(row.impressions ?? 0),
    0,
  );
  const clicks = payload.spend_daily.reduce(
    (total, row) => total + Number(row.clicks ?? 0),
    0,
  );
  const capUsed =
    spent !== null && cap > 0
      ? Math.min(100, Math.round((spent / cap) * 100))
      : null;
  const latestPauseReason = payload.timeline.find(
    (event) =>
      event.action === "pause" &&
      event.provider_response &&
      typeof event.provider_response.reason === "string",
  )?.provider_response?.reason;
  const endState = isEnded
    ? status.toUpperCase() === "DELETED"
      ? "Cancelled before platform spend — full Ads credit was returned"
      : "Ended — unspent Ads credit was returned"
    : latestPauseReason === "destination_unavailable"
      ? "Destination page ended or is no longer public — delivery paused"
      : latestPauseReason === "destination_check_failed"
        ? "Destination availability could not be verified — delivery paused safely"
        : latestPauseReason === "end_date_passed"
          ? "Campaign schedule ended — delivery paused"
          : latestPauseReason === "spend_fetch_failed"
            ? "Results feed unavailable — delivery paused for budget safety"
            : spent !== null && cap > 0 && spent >= Math.floor(cap * 0.98)
              ? "Budget used — delivery paused at the safety cap"
              : null;

  return (
    <View style={styles.host} testID="ads-detail-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to Ads"
          testID="ads-detail-back"
        >
          <Text style={styles.back}>← Ads</Text>
        </Pressable>

        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.kicker}>
            {payload.plan_campaigns
              .map((row) => String(row.platform))
              .join(" · ")}
          </Text>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.status} testID="ads-detail-status">
            {status}
          </Text>
          <Text style={styles.metric}>
            {currency
              ? spent !== null
                ? `Host-equivalent spend ${formatCurrency(spent, currency, true)} of ${formatCurrency(cap, currency, true)} cap`
                : `Host budget ${formatCurrency(cap, currency, true)} held · spend conversion unavailable`
              : "Currency authority unavailable — spending actions are blocked"}
          </Text>
          {payload.provider_spend_by_currency.length > 0 ? (
            <Text style={styles.muted}>
              Platform-reported spend:{" "}
              {payload.provider_spend_by_currency
                .map((row) =>
                  formatCurrency(row.spend_cents, row.currency, true),
                )
                .join(" · ")}
            </Text>
          ) : null}
          {capUsed !== null ? (
            <Text style={styles.progress}>{capUsed}% of cap used</Text>
          ) : null}
          {typeof c.dest_url === "string" && c.dest_url.length > 0 ? (
            <Text style={styles.dest} numberOfLines={2}>
              {c.dest_url}
            </Text>
          ) : null}
        </GlassCard>

        {endState ? (
          <GlassCard variant="elevated" padding={spacing.md}>
            <Text style={styles.sectionTitle}>End state</Text>
            <Text style={styles.body}>{endState}</Text>
          </GlassCard>
        ) : null}

        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.sectionTitle}>Results</Text>
          <Text style={styles.muted}>
            Primary result: {primaryResultLabel} · quality{" "}
            {String(
              payload.measurement?.manifest?.quality ?? "unavailable",
            ).replaceAll("_", " ")}
          </Text>
          <Text style={styles.muted}>
            Browser pixels and outbound platform conversion sharing require
            consent. Mingla shows trusted finalized results in aggregate even
            when outbound sharing is withheld.
          </Text>
          <View style={styles.metricGrid}>
            <View style={styles.metricCell}>
              <Text style={styles.metricNumber}>
                {impressions.toLocaleString()}
              </Text>
              <Text style={styles.metricLabel}>Impressions</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricNumber}>{clicks.toLocaleString()}</Text>
              <Text style={styles.metricLabel}>Clicks</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricNumber}>
                {conversions.toLocaleString()}
              </Text>
              <Text style={styles.metricLabel}>{primaryResultLabel}</Text>
            </View>
          </View>
          {payload.measurement?.platform_withheld_conversion_count > 0 ? (
            <Text style={styles.muted}>
              {payload.measurement.platform_withheld_conversion_count} trusted
              result(s) counted by Mingla and withheld from ad platforms by
              consent.
            </Text>
          ) : null}
          {(payload.results.by_platform ?? []).map((row) => (
            <View key={row.platform} style={styles.resultRow}>
              <Text style={styles.body}>{row.platform}</Text>
              <Text style={styles.body}>{row.conversions} conversions</Text>
            </View>
          ))}
          {payload.by_placement.map((row) => (
            <View
              key={`${row.platform}:${row.placement}`}
              style={styles.resultRow}
            >
              <Text style={styles.body}>{row.placement}</Text>
              <Text style={styles.body}>{row.conversions} conversions</Text>
            </View>
          ))}
        </GlassCard>

        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.sectionTitle}>Creative</Text>
          {payload.creatives.length === 0 ? (
            <Text style={styles.body}>No creative record yet.</Text>
          ) : (
            payload.creatives.map((creative) => (
              <View key={creative.id} style={styles.timelineRow}>
                <Text style={styles.body}>
                  {creative.ad_creatives?.name ?? creative.name}
                </Text>
                <Text style={styles.muted}>
                  {creative.ad_creatives?.kind ?? "creative"} ·{" "}
                  {creative.review_status ?? creative.status}
                </Text>
                {creative.review_status?.toUpperCase().includes("REJECT") ? (
                  <Text style={styles.error}>
                    Provider rejected this creative. Review the provider detail
                    and replace it.
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </GlassCard>

        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          {payload.timeline.length === 0 ? (
            <Text style={styles.body}>No status changes yet.</Text>
          ) : (
            payload.timeline.map((event) => (
              <View key={event.id} style={styles.timelineRow}>
                <Text style={styles.body}>
                  {event.action.replace(/_/g, " ")} ·{" "}
                  {event.to_status ?? event.entity ?? "recorded"}
                </Text>
                <Text style={styles.muted}>
                  {new Date(event.created_at).toLocaleString()}
                </Text>
              </View>
            ))
          )}
          {payload.credit_events.map((event) => (
            <View key={event.id} style={styles.timelineRow}>
              <Text style={styles.body}>
                {event.entry_kind.replace(/_/g, " ")} ·{" "}
                {formatCurrency(event.amount_cents, event.currency, true)}
              </Text>
              <Text style={styles.muted}>
                {new Date(event.created_at).toLocaleString()}
              </Text>
            </View>
          ))}
        </GlassCard>

        {error !== null ? (
          <Text style={styles.error} testID="ads-detail-action-error">
            {error}
          </Text>
        ) : null}

        {!isEnded &&
        currency &&
        (permissions.canPause || permissions.canEnd) ? (
          <View style={styles.actions}>
            {isLive && permissions.canPause ? (
              <Pressable
                style={styles.actionBtn}
                disabled={busy}
                onPress={() => void onPause()}
                accessibilityRole="button"
                accessibilityLabel="Pause ad"
                testID="ads-detail-pause"
              >
                <Text style={styles.actionLabel}>
                  {busy ? "Working…" : "Pause"}
                </Text>
              </Pressable>
            ) : null}
            {canCancel && permissions.canEnd ? (
              <Pressable
                style={[styles.actionBtn, styles.actionDanger]}
                disabled={busy}
                onPress={() => void onCancel()}
                accessibilityRole="button"
                accessibilityLabel="Cancel ad"
                testID="ads-detail-cancel"
              >
                <Text style={styles.actionLabel}>
                  {busy ? "Working…" : "Cancel ad"}
                </Text>
              </Pressable>
            ) : null}
            {canEnd && permissions.canEnd ? (
              <Pressable
                style={[styles.actionBtn, styles.actionDanger]}
                disabled={busy}
                onPress={() => void onEnd()}
                accessibilityRole="button"
                accessibilityLabel="End ad"
                testID="ads-detail-end"
              >
                <Text style={styles.actionLabel}>
                  {busy ? "Working…" : "End ad"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
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
  back: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  kicker: {
    ...typography.caption,
    color: textTokens.secondary,
    textTransform: "uppercase",
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  status: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  metric: {
    ...typography.body,
    color: textTokens.primary,
    marginTop: spacing.md,
  },
  progress: {
    ...typography.caption,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
  muted: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  metricGrid: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metricCell: {
    flex: 1,
  },
  metricNumber: {
    ...typography.h3,
    color: textTokens.primary,
  },
  metricLabel: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  timelineRow: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.chrome,
  },
  dest: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  error: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  actionDanger: {
    borderColor: "rgba(180, 60, 60, 0.35)",
  },
  actionLabel: {
    ...typography.buttonMd,
    color: textTokens.primary,
  },
});
