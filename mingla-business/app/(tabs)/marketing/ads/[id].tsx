/**
 * toward #3697 Wave 7c — Host ad campaign detail (spend vs cap, pause/end).
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
import { useCanManageBrandPayments } from "../../../../src/hooks/useCanManageBrandPayments";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import {
  endHostAdCampaign,
  getHostAdCampaign,
  pauseHostAdCampaign,
} from "../../../../src/services/hostAdCampaignService";
import { formatCurrency } from "../../../../src/utils/currency";
import { randomId } from "../../../../src/utils/randomId";

function firstParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }
  return null;
}

export default function HostAdDetailRoute(): React.ReactElement {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const manage = useCanManageBrandPayments(brandId);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const campaignId = firstParam(params.id);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<{
    campaign: Record<string, unknown>;
    spend_total_cents: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (brandId === null || campaignId === null) return;
    setError(null);
    try {
      const res = await getHostAdCampaign(brandId, campaignId);
      setPayload(res);
    } catch {
      setError("Could not load this ad.");
      setPayload(null);
    }
  }, [brandId, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPause = useCallback(async () => {
    if (brandId === null || campaignId === null) return;
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
  }, [brandId, campaignId, load]);

  const onEnd = useCallback(async () => {
    if (brandId === null || campaignId === null) return;
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
  }, [brandId, campaignId, load]);

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
  const status = String(c.status ?? "");
  const currency = String(c.currency ?? "USD");
  const cap = Number(c.cap_cents ?? c.daily_budget_cents ?? 0);
  const spent = payload.spend_total_cents;
  const isLive = status.toUpperCase() === "ACTIVE";
  const isEnded =
    status.toUpperCase() === "ARCHIVED" || status.toUpperCase() === "DELETED";

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
          <Text style={styles.kicker}>{String(c.platform ?? "")}</Text>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.status} testID="ads-detail-status">
            {status}
          </Text>
          <Text style={styles.metric}>
            Spend {formatCurrency(spent, currency, true)} of{" "}
            {formatCurrency(cap, currency, true)} cap
          </Text>
          {typeof c.dest_url === "string" && c.dest_url.length > 0 ? (
            <Text style={styles.dest} numberOfLines={2}>
              {c.dest_url}
            </Text>
          ) : null}
        </GlassCard>

        {error !== null ? (
          <Text style={styles.error} testID="ads-detail-action-error">
            {error}
          </Text>
        ) : null}

        {manage.allowed && !isEnded ? (
          <View style={styles.actions}>
            {isLive ? (
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
    ...typography.bodyMd,
    color: textTokens.primary,
    marginTop: spacing.md,
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
