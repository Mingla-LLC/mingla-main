/**
 * #3682 Wave 2.6 — Manage brands you follow (contract k.iii).
 */
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";

import { brandFollowKeys } from "../../hooks/useBrandFollow";
import {
  brandFollowIsMuted,
  brandFollowsService,
  type BrandFollowChannel,
  type BrandFollowRow,
} from "../../services/brandFollowsService";
import { toastManager } from "../ui/Toast";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { BrandFollowOverflowSheet } from "./BrandFollowOverflowSheet";

type Filter = "all" | "muted" | "emails_stopped";

type Props = {
  visible: boolean;
  onClose: () => void;
  userId: string | null;
};

export const BrandsYouFollowManageSheet: React.FC<Props> = ({
  visible,
  onClose,
  userId,
}) => {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [overflow, setOverflow] = useState<BrandFollowRow | null>(null);

  const listQuery = useQuery({
    queryKey: brandFollowKeys.list(userId ?? ""),
    queryFn: () => brandFollowsService.listFollows(userId as string),
    enabled: visible && !!userId,
  });

  const rows = listQuery.data ?? [];
  const mutedCount = rows.filter((r) => brandFollowIsMuted(r.mutedUntil)).length;
  const emailsStopped = rows.filter(
    (r) => !brandFollowIsMuted(r.mutedUntil) && !r.channels.email,
  ).length;

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === "muted") {
      list = list.filter((r) => brandFollowIsMuted(r.mutedUntil));
    } else if (filter === "emails_stopped") {
      list = list.filter(
        (r) => !brandFollowIsMuted(r.mutedUntil) && !r.channels.email,
      );
    }
    const needle = q.trim().toLowerCase();
    if (needle.length > 0) {
      list = list.filter((r) => r.brandName.toLowerCase().includes(needle));
    }
    return list;
  }, [rows, filter, q]);

  const showSearch = rows.length >= 8;

  const toggleChannel = async (
    row: BrandFollowRow,
    channel: BrandFollowChannel,
  ) => {
    if (!userId || brandFollowIsMuted(row.mutedUntil)) return;
    const next = !row.channels[channel];
    try {
      await brandFollowsService.setChannel(userId, row.brandId, channel, next);
      void queryClient.invalidateQueries({
        queryKey: brandFollowKeys.list(userId),
      });
    } catch {
      toastManager.show("Couldn't save that. Try again.", "error");
    }
  };

  const unmute = async (row: BrandFollowRow) => {
    if (!userId) return;
    try {
      await brandFollowsService.unmuteBrand(userId, row.brandId);
      toastManager.show(`${row.brandName} unmuted`, "success");
      void queryClient.invalidateQueries({
        queryKey: brandFollowKeys.list(userId),
      });
    } catch {
      toastManager.show("Couldn't save that. Try again.", "error");
    }
  };

  return (
    <>
      <BaseBottomSheet
        visible={visible && overflow === null}
        onClose={onClose}
        snapPoints={["92%"]}
        theme="light"
        scrollMode="none"
        wrapInRNModal
        accessibilityLabel="Brands you follow"
      >
        <View style={styles.root} testID="brands-you-follow-manage">
          <View style={styles.headerRow}>
            <Pressable
              onPress={onClose}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="Back to notification settings"
              testID="brands-manage-back"
            >
              <Ionicons name="chevron-back" size={24} color="#111827" />
            </Pressable>
            <Text style={styles.headerTitle}>Brands you follow</Text>
            <View style={{ width: 44 }} />
          </View>
          <Text style={styles.intro}>
            Choose how each brand reaches you. Tickets and order updates always
            come through.
          </Text>

          {showSearch ? (
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color="#6b7280" />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search brands"
                placeholderTextColor="#6b7280"
                style={styles.searchInput}
                testID="brands-manage-search"
              />
            </View>
          ) : null}

          {showSearch ? (
            <View style={styles.filters}>
              {(
                [
                  ["all", `All · ${rows.length}`],
                  mutedCount > 0 ? ["muted", `Muted · ${mutedCount}`] : null,
                  emailsStopped > 0
                    ? ["emails_stopped", `Emails stopped · ${emailsStopped}`]
                    : null,
                ] as const
              )
                .filter(Boolean)
                .map((item) => {
                  const [key, label] = item as [Filter, string];
                  const selected = filter === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setFilter(key)}
                      style={[styles.pill, selected && styles.pillOn]}
                    >
                      <Text
                        style={[styles.pillText, selected && styles.pillTextOn]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          ) : null}

          {listQuery.isLoading ? (
            <ActivityIndicator color="#c2560f" style={{ marginTop: 24 }} />
          ) : null}

          {!listQuery.isLoading && rows.length === 0 ? (
            <View style={styles.empty} testID="brands-manage-empty">
              <View style={styles.emptyIcon}>
                <Ionicons name="storefront-outline" size={26} color="#c2560f" />
              </View>
              <Text style={styles.emptyTitle}>
                You&apos;re not following any brands yet
              </Text>
              <Text style={styles.emptyBody}>
                Brands you follow, or buy, RSVP or book with, will show up here.
              </Text>
            </View>
          ) : null}

          {!listQuery.isLoading &&
          rows.length > 0 &&
          filtered.length === 0 ? (
            <Text style={styles.noResults}>
              No brands match &quot;{q}&quot;.
            </Text>
          ) : null}

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
          >
            {filtered.map((row) => {
              const muted = brandFollowIsMuted(row.mutedUntil);
              return (
                <View
                  key={row.brandId}
                  style={styles.card}
                  testID={`brands-manage-card-${row.brandId}`}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.logo}>
                      <Text style={styles.monogram}>
                        {(row.brandName[0] ?? "?").toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {row.brandName}
                      </Text>
                      <Text style={styles.cardCaption} numberOfLines={1}>
                        {muted
                          ? formatMuted(row.mutedUntil)
                          : !row.channels.email
                            ? "Emails stopped from an email link"
                            : `Following since ${new Date(
                                row.createdAt,
                              ).toLocaleDateString(undefined, {
                                month: "short",
                              })}`}
                      </Text>
                    </View>
                    {muted ? (
                      <Pressable
                        onPress={() => void unmute(row)}
                        hitSlop={8}
                        testID={`brands-manage-unmute-${row.brandId}`}
                      >
                        <Text style={styles.unmute}>Unmute</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => setOverflow(row)}
                        hitSlop={8}
                        style={styles.more}
                      >
                        <Ionicons
                          name="ellipsis-horizontal"
                          size={20}
                          color="#6b7280"
                        />
                      </Pressable>
                    )}
                  </View>
                  <View style={[styles.channels, muted && { opacity: 0.45 }]}>
                    {(
                      [
                        ["push", "Push", "phone-portrait-outline"],
                        ["email", "Email", "mail-outline"],
                        ["sms", "Text", "chatbubble-outline"],
                      ] as const
                    ).map(([ch, label, icon]) => {
                      const on = row.channels[ch];
                      return (
                        <Pressable
                          key={ch}
                          disabled={muted}
                          onPress={() => void toggleChannel(row, ch)}
                          style={[styles.channelBtn, on && styles.channelOn]}
                          accessibilityRole="switch"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={`${label} from ${row.brandName}, ${on ? "on" : "off"}`}
                          testID={`brands-manage-${ch}-${row.brandId}`}
                        >
                          <Ionicons
                            name={icon}
                            size={16}
                            color={on ? "#fff" : "#374151"}
                          />
                          <Text
                            style={[
                              styles.channelLabel,
                              on && styles.channelLabelOn,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </BaseBottomSheet>

      <BrandFollowOverflowSheet
        visible={overflow !== null}
        row={overflow}
        userId={userId}
        onClose={() => setOverflow(null)}
        onMuted={() => {
          setOverflow(null);
          if (userId) {
            void queryClient.invalidateQueries({
              queryKey: brandFollowKeys.list(userId),
            });
          }
        }}
        onUnfollowed={() => {
          setOverflow(null);
          if (userId) {
            void queryClient.invalidateQueries({
              queryKey: brandFollowKeys.list(userId),
            });
          }
        }}
        onOpenChannels={() => setOverflow(null)}
      />
    </>
  );
};

function formatMuted(mutedUntil: string | null): string {
  if (!mutedUntil || mutedUntil === "infinity" || mutedUntil.includes("infinity")) {
    return "Muted";
  }
  const d = new Date(mutedUntil);
  if (Number.isNaN(d.getTime())) return "Muted";
  return `Muted until ${d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    color: "#111827",
  },
  intro: {
    fontSize: 13,
    lineHeight: 18,
    color: "#6b7280",
    marginBottom: 12,
  },
  searchWrap: {
    height: 44,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: "#111827" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pill: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
    justifyContent: "center",
  },
  pillOn: { backgroundColor: "#111827", borderColor: "#111827" },
  pillText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  pillTextOn: { color: "#fff" },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff4ec",
    alignItems: "center",
    justifyContent: "center",
  },
  monogram: { color: "#c2560f", fontWeight: "700", fontSize: 15 },
  cardName: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: "#111827" },
  cardCaption: { fontSize: 12, lineHeight: 16, color: "#6b7280", marginTop: 2 },
  unmute: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#c2560f" },
  more: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  channels: { flexDirection: "row", gap: 8 },
  channelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  channelOn: { backgroundColor: "#c2560f" },
  channelLabel: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: "#374151" },
  channelLabelOn: { color: "#fff" },
  empty: { alignItems: "center", paddingTop: 40, paddingHorizontal: 16 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fff4ec",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 6,
  },
  noResults: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 24,
  },
});
