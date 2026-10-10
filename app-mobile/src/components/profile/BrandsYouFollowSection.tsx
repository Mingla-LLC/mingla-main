/**
 * #3682 Wave 2.6 — Profile card: Brands you follow (design contract surface k.i).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { colors, fontWeights } from "../../constants/designSystem";
import { brandFollowKeys } from "../../hooks/useBrandFollow";
import { useAppStore } from "../../store/appStore";
import {
  brandFollowIsMuted,
  brandFollowsService,
  type BrandFollowRow,
  type MuteDuration,
} from "../../services/brandFollowsService";
import { BrandsYouFollowManageSheet } from "./BrandsYouFollowManageSheet";
import { BrandFollowOverflowSheet } from "./BrandFollowOverflowSheet";

function formatMutedCaption(mutedUntil: string | null): string {
  if (!mutedUntil) return "Muted";
  if (mutedUntil === "infinity" || mutedUntil.includes("infinity")) {
    return "Muted";
  }
  const d = new Date(mutedUntil);
  if (Number.isNaN(d.getTime())) return "Muted";
  return `Muted until ${d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
}

function formatWhy(row: BrandFollowRow): string {
  if (brandFollowIsMuted(row.mutedUntil)) {
    return formatMutedCaption(row.mutedUntil);
  }
  const src = row.source;
  if (src === "purchase" || src === "booking") return "Since you booked";
  if (src === "rsvp") return "Since you RSVP'd";
  const created = new Date(row.createdAt);
  if (!Number.isNaN(created.getTime())) {
    return `Following since ${created.toLocaleDateString(undefined, {
      month: "short",
    })}`;
  }
  return "Following";
}

function formatChannels(row: BrandFollowRow): string {
  if (brandFollowIsMuted(row.mutedUntil)) return "";
  if (!row.channels.email) return "Emails stopped";
  const parts: string[] = [];
  if (row.channels.push) parts.push("Push");
  if (row.channels.email) parts.push("email");
  if (row.channels.sms) parts.push("text");
  if (parts.length === 0) return "Emails stopped";
  if (parts.length === 1) return `${parts[0]} only`;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return "Push, email and text";
}

export const BrandsYouFollowSection: React.FC = () => {
  const userId = useAppStore((s) => s.user?.id) ?? null;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [manageOpen, setManageOpen] = useState(false);
  const [overflowRow, setOverflowRow] = useState<BrandFollowRow | null>(null);

  const listQuery = useQuery({
    queryKey: brandFollowKeys.list(userId ?? ""),
    queryFn: () => brandFollowsService.listFollows(userId as string),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const rows = listQuery.data ?? [];
  const top = useMemo(() => rows.slice(0, 3), [rows]);
  const showSeeAll = rows.length > 3;

  const invalidate = useCallback(() => {
    if (!userId) return;
    void queryClient.invalidateQueries({ queryKey: brandFollowKeys.list(userId) });
  }, [queryClient, userId]);

  const openBrand = useCallback(
    (row: BrandFollowRow) => {
      if (row.brandSlug) {
        router.push(`/b/${row.brandSlug}` as never);
      }
    },
    [router],
  );

  return (
    <View style={styles.container} testID="brands-you-follow-section">
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Brands you follow
        </Text>
        {showSeeAll ? (
          <Pressable
            onPress={() => setManageOpen(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`See all ${rows.length} brands you follow`}
            style={styles.seeAll}
            testID="brands-you-follow-see-all"
          >
            <Text style={styles.seeAllText}>See all ({rows.length})</Text>
            <Ionicons name="chevron-forward" size={14} color="#eb7825" />
          </Pressable>
        ) : null}
      </View>

      {listQuery.isLoading && rows.length === 0 ? (
        <View style={styles.skeletonBlock}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonRow} />
          ))}
        </View>
      ) : null}

      {listQuery.isError && rows.length === 0 ? (
        <Pressable
          onPress={() => void listQuery.refetch()}
          style={styles.errorBox}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID="brands-you-follow-error"
        >
          <Text style={styles.errorText}>
            Couldn&apos;t load the brands you follow.
          </Text>
          <Text style={styles.tryAgain}>Try again</Text>
        </Pressable>
      ) : null}

      {!listQuery.isLoading && !listQuery.isError && rows.length === 0 ? (
        <View style={styles.emptyBox} testID="brands-you-follow-empty">
          <Text style={styles.emptyTitle}>
            You&apos;re not following any brands yet
          </Text>
          <Text style={styles.emptyBody}>
            Brands you follow, or buy, RSVP or book with, will show up here.
          </Text>
        </View>
      ) : null}

      {top.map((row) => {
        const muted = brandFollowIsMuted(row.mutedUntil);
        const why = formatWhy(row);
        const channels = formatChannels(row);
        const reason = muted
          ? why
          : channels
            ? `${why} · ${channels}`
            : why;
        return (
          <Pressable
            key={row.brandId}
            style={styles.row}
            onPress={() => openBrand(row)}
            accessibilityRole="button"
            accessibilityLabel={`${row.brandName}. ${reason}.`}
            testID={`brands-you-follow-row-${row.brandId}`}
          >
            <View style={styles.logo}>
              <Text style={styles.monogram}>
                {(row.brandName[0] ?? "?").toUpperCase()}
              </Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.brandName} numberOfLines={1}>
                {row.brandName}
              </Text>
              <Text style={styles.reason} numberOfLines={2}>
                {muted ? (
                  <>
                    <Ionicons
                      name="notifications-off-outline"
                      size={13}
                      color="rgba(255,255,255,0.55)"
                    />{" "}
                    {why}
                  </>
                ) : (
                  reason
                )}
              </Text>
            </View>
            <Pressable
              onPress={() => setOverflowRow(row)}
              hitSlop={8}
              style={styles.overflow}
              accessibilityRole="button"
              accessibilityLabel={`More options for ${row.brandName}`}
              testID={`brands-you-follow-more-${row.brandId}`}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color="rgba(255,255,255,0.72)"
              />
            </Pressable>
          </Pressable>
        );
      })}

      {listQuery.isFetching && rows.length > 0 ? (
        <ActivityIndicator color="#eb7825" style={{ marginTop: 8 }} />
      ) : null}

      <BrandsYouFollowManageSheet
        visible={manageOpen}
        onClose={() => {
          setManageOpen(false);
          invalidate();
        }}
        userId={userId}
      />

      <BrandFollowOverflowSheet
        visible={overflowRow !== null}
        row={overflowRow}
        onClose={() => setOverflowRow(null)}
        onMuted={(_d: MuteDuration) => {
          setOverflowRow(null);
          invalidate();
        }}
        onUnfollowed={() => {
          setOverflowRow(null);
          invalidate();
        }}
        onOpenChannels={() => {
          setOverflowRow(null);
          setManageOpen(true);
        }}
        userId={userId}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { minHeight: 80 },
  header: {
    minHeight: 24,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: colors.text.inverse,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: fontWeights.bold,
  },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44 },
  seeAllText: {
    color: "#eb7825",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
  },
  row: {
    minHeight: 68,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  monogram: { color: "#fff", fontSize: 15, fontWeight: "700" },
  rowBody: { flex: 1, minWidth: 0 },
  brandName: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
  },
  reason: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 17,
    marginTop: 2,
  },
  overflow: {
    width: 44,
    height: 44,
    marginRight: -12,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyBox: { paddingVertical: 16 },
  emptyTitle: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    marginBottom: 6,
  },
  emptyBody: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 17,
  },
  errorBox: {
    paddingVertical: 18,
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  errorText: { color: colors.gray[200], fontSize: 14, textAlign: "center" },
  tryAgain: {
    color: "#eb7825",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
  skeletonBlock: { gap: 10, paddingVertical: 8 },
  skeletonRow: {
    height: 68,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
});
