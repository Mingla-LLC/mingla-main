/**
 * /partner/brands — Mingla partner brand portfolio list. ORCH-1081.
 *
 * Visible only to flagged Mingla partners (creator_accounts.partner_enabled
 * = true). Reads partner_brand_links via the usePartnerBrandLinks hook
 * (RLS gates: partner_account_id = auth.uid()) and surfaces:
 *   - rows in priority order (awaiting_owner → awaiting_stripe → active)
 *   - status chip + subtext per row
 *   - tap-through → /brand/{id} dashboard
 *   - empty state CTA → /brand/new?partner_mode=client (BrandCreationFlow
 *     reads partner_mode and lands on step 1 with mode='client').
 *
 * Mirrors earnings.tsx structure (modal-style with X close header, scroll
 * content, dark canvas, GlassCard rows).
 */

import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";

import { usePartnerBrandLinks } from "../../src/hooks/usePartnerBrandLinks";
import type {
  PartnerBrandLinkStatus,
  PartnerBrandLinkWithStatus,
} from "../../src/services/partnerBrandLinksService";
import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { IconChrome } from "../../src/components/ui/IconChrome";

const STATUS_RANK: Record<PartnerBrandLinkStatus, number> = {
  awaiting_owner: 0,
  awaiting_stripe: 1,
  active: 2,
  cancelled: 3,
};

export default function PartnerBrandsScreen(): React.ReactElement {
  const router = useRouter();
  const linksQuery = usePartnerBrandLinks();

  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  const handleOpenBrand = useCallback(
    (brandId: string): void => {
      router.push(`/brand/${brandId}` as never);
    },
    [router],
  );

  const handleSetUpFirst = useCallback((): void => {
    router.push("/brand/new?partner_mode=client" as never);
  }, [router]);

  const sortedRows = useMemo<PartnerBrandLinkWithStatus[]>(() => {
    const rows = linksQuery.data ?? [];
    return [...rows].sort((a, b) => {
      const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rankDiff !== 0) return rankDiff;
      // Within active: sort by first_split_at desc (most recent earnings first).
      if (a.status === "active" && b.status === "active") {
        const aTime = a.first_split_at
          ? new Date(a.first_split_at).getTime()
          : 0;
        const bTime = b.first_split_at
          ? new Date(b.first_split_at).getTime()
          : 0;
        return bTime - aTime;
      }
      // Within any other state: newest invite first.
      const aTime = new Date(a.invited_at).getTime();
      const bTime = new Date(b.invited_at).getTime();
      return bTime - aTime;
    });
  }, [linksQuery.data]);

  const activeCount = sortedRows.filter((r) => r.status === "active").length;
  const pendingCount = sortedRows.filter(
    (r) => r.status === "awaiting_owner" || r.status === "awaiting_stripe",
  ).length;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <View style={styles.headerTextCol}>
          <Text style={styles.eyebrow}>MINGLA PARTNER</Text>
          <Text style={styles.h1}>Brands</Text>
          {(activeCount > 0 || pendingCount > 0) ? (
            <Text style={styles.headerMeta}>
              {activeCount} active · {pendingCount} pending
            </Text>
          ) : null}
        </View>
        <IconChrome
          icon="x"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close partner brands"
          testID="partner-brands-close-button"
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {linksQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={accent.warm} />
          </View>
        ) : linksQuery.error ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.cardTitle}>Couldn't load your brands</Text>
            <Text style={styles.cardBody}>{linksQuery.error.message}</Text>
            <Pressable
              accessibilityLabel="Retry"
              style={styles.secondaryBtn}
              onPress={() => linksQuery.refetch()}
            >
              <Text style={styles.secondaryBtnText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : sortedRows.length === 0 ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.cardTitle}>No partner brands yet</Text>
            <Text style={styles.cardBody}>
              Brands you set up for clients show up here. You'll see them go
              from invite-sent to live to earning.
            </Text>
            <Pressable
              accessibilityLabel="Set up your first partner brand"
              style={styles.primaryBtn}
              onPress={handleSetUpFirst}
            >
              <Text style={styles.primaryBtnText}>
                Set up your first partner brand →
              </Text>
            </Pressable>
          </GlassCard>
        ) : (
          sortedRows.map((row) => (
            <BrandLinkRow
              key={row.id}
              row={row}
              onPress={() => handleOpenBrand(row.brand_id)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BrandLinkRow(props: {
  row: PartnerBrandLinkWithStatus;
  onPress: () => void;
}): React.ReactElement {
  const { row, onPress } = props;
  const brand = row.brand ?? null;
  const brandName = brand?.name ?? "Brand";
  const coverUrl = brand?.cover_media_url ?? null;
  const coverType = brand?.cover_media_type ?? null;
  // Stills only for the round thumbnail; skip videos.
  const hasStillCover = coverUrl !== null &&
    coverUrl.length > 0 &&
    coverType !== "video";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${brandName}`}
      onPress={onPress}
    >
      <GlassCard variant="elevated" padding={spacing.md}>
        <View style={styles.rowOuter}>
          <View style={styles.thumbWrap}>
            {hasStillCover ? (
              <Image
                source={{ uri: coverUrl as string }}
                style={styles.thumb}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback]}>
                <Text style={styles.thumbFallbackText}>
                  {brandName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.brandName} numberOfLines={1}>
              {brandName}
            </Text>
            <View style={styles.statusRow}>
              <StatusDot status={row.status} />
              <Text style={styles.statusLabel}>{statusLabel(row.status)}</Text>
            </View>
            <Text style={styles.subText} numberOfLines={1}>
              {subTextFor(row)}
            </Text>
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

function StatusDot({ status }: { status: PartnerBrandLinkStatus }): React.ReactElement {
  const color = status === "active"
    ? semantic.success
    : status === "awaiting_stripe"
    ? semantic.warning
    : status === "awaiting_owner"
    ? accent.warm
    : textTokens.tertiary;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function statusLabel(status: PartnerBrandLinkStatus): string {
  switch (status) {
    case "awaiting_owner":
      return "Awaiting Owner";
    case "awaiting_stripe":
      return "Awaiting Stripe";
    case "active":
      return "Active";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function subTextFor(row: PartnerBrandLinkWithStatus): string {
  switch (row.status) {
    case "awaiting_owner":
      return `Invite sent ${timeAgo(row.invited_at)}`;
    case "awaiting_stripe":
      return row.accepted_at !== null
        ? `Owner accepted ${timeAgo(row.accepted_at)}`
        : "Owner accepted";
    case "active":
      return row.first_split_at !== null
        ? `First split ${timeAgo(row.first_split_at)}`
        : "Stripe connected";
    case "cancelled":
      return "Cancelled";
    default:
      return "";
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: canvas.profile },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerTextCol: { flex: 1, gap: 2 },
  eyebrow: {
    ...typography.labelCap,
    color: accent.warm,
  },
  h1: {
    ...typography.h1,
    color: textTokens.primary,
  },
  headerMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  cardTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  cardBody: {
    ...typography.body,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  primaryBtn: {
    backgroundColor: accent.warm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  primaryBtnText: {
    ...typography.buttonMd,
    color: textTokens.inverse,
  },
  secondaryBtn: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    marginTop: spacing.md,
    backgroundColor: glass.tint.profileBase,
  },
  secondaryBtnText: {
    ...typography.buttonMd,
    color: textTokens.primary,
  },
  rowOuter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  thumbWrap: {
    width: 60,
    height: 60,
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: "hidden",
  },
  thumbFallback: {
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbFallbackText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  brandName: {
    ...typography.bodyLg,
    fontWeight: "700",
    color: textTokens.primary,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    ...typography.micro,
    fontWeight: "700",
    color: textTokens.secondary,
    letterSpacing: 0.5,
  },
  subText: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
});
