/**
 * ScannerHome — the only home surface a rank-10 scanner sees.
 *
 * ORCH-1055 (META-ORCH-1048 sub-F): scanners are NOT brand operators. The
 * full Home dashboard (KPIs, drafts, upcoming creator CTAs, brand
 * switcher) is inappropriate for them. This surface shows the one thing
 * a scanner needs: the events on the current brand they can open the
 * scanner camera for. Each row routes to `/event/[id]/scanner` (the
 * camera surface used by both operators and scoped scanners — auth-gated
 * on the route via existing `event_scanners` / `brand_team_members` RLS
 * from ORCH-1051).
 *
 * Scope intentionally minimal:
 *   - No KPIs, no Stripe state, no drafts, no creation CTAs.
 *   - No multi-brand switcher (scanner-only callers are scoped to one
 *     brand in practice — Cycle 13a brand_team_members is per-brand and
 *     `currentBrandStore` already auto-selects the membership brand).
 *   - List = upcoming events for the current brand (past excluded by
 *     `useUpcomingForBrand`), filtered to `event` kind only (scanners
 *     do not scan trips/experiences today).
 *
 * Empty state: no upcoming events → quiet copy. Sign-out remains
 * reachable via the Account tab, which the rank-10 filter still allows.
 *
 * Per ORCH-1055 SPEC §3 / OPTION B implementation.
 */

import React, { useCallback } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";
import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useUpcomingForBrand } from "../../hooks/useUpcomingForBrand";
import type { UpcomingItem } from "../../utils/upcomingBuilder";

const itemName = (item: UpcomingItem): string => {
  const source = item.source as { name?: string } | null;
  return source?.name ?? "Event";
};

const formatStart = (item: UpcomingItem): string => {
  if (item.startAtUtc === null) return "Scheduled";
  const date = item.startAtUtc instanceof Date
    ? item.startAtUtc
    : new Date(item.startAtUtc);
  if (Number.isNaN(date.getTime())) return "Scheduled";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

interface ScannerEventRowProps {
  item: UpcomingItem;
  onOpen: (eventId: string) => void;
}

const ScannerEventRow: React.FC<ScannerEventRowProps> = ({ item, onOpen }) => {
  const handlePress = useCallback((): void => {
    onOpen(item.id);
  }, [item.id, onOpen]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Open scanner for ${itemName(item)}`}
      testID={`scanner-home-row-${item.id}`}
    >
      <GlassCard style={styles.row} variant="base">
        <View style={styles.rowContent}>
          <View style={styles.rowTextCol}>
            <Text style={styles.rowName} numberOfLines={2}>
              {itemName(item)}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {formatStart(item)}
            </Text>
          </View>
          <View style={styles.rowCta}>
            <Pill variant="accent">Scan</Pill>
            <Icon name="chevR" size={20} color={accent.warm} />
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
};

export const ScannerHome: React.FC = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const upcoming = useUpcomingForBrand(currentBrand?.id ?? null);

  // Scanners scan tickets at the door — events only. Drop trip/experience
  // kinds from the list (no scanner camera exists for them today).
  const events = (upcoming.items ?? []).filter((it) => it.kind === "event");

  const handleOpen = useCallback(
    (eventId: string): void => {
      router.push(`/event/${eventId}/scanner` as never);
    },
    [router],
  );

  return (
    <View style={[styles.host, { paddingTop: insets.top }]} testID="scanner-home">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Door</Text>
        {currentBrand?.displayName !== undefined &&
        currentBrand?.displayName !== null ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {currentBrand.displayName}
          </Text>
        ) : null}
      </View>
      <FlatList
        data={events}
        keyExtractor={(it) => it.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        renderItem={({ item }) => (
          <ScannerEventRow item={item} onOpen={handleOpen} />
        )}
        ListEmptyComponent={
          <View style={styles.empty} testID="scanner-home-empty">
            <Text style={styles.emptyTitle}>No events to scan yet</Text>
            <Text style={styles.emptyBody}>
              When an organiser schedules an event you can scan, it will
              show up here.
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 4,
  },
  headerTitle: {
    color: textTokens.primary,
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    letterSpacing: typography.h1.letterSpacing,
  },
  headerSubtitle: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: typography.bodySm.fontWeight,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  rowTextCol: {
    flex: 1,
    gap: 4,
  },
  rowName: {
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
  },
  rowMeta: {
    color: textTokens.secondary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  rowCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    textAlign: "center",
  },
  emptyBody: {
    color: textTokens.secondary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlign: "center",
  },
});
