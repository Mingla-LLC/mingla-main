import React, { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { EventCoverMedia } from "@mingla/offering-rendering";

import { usePurchases } from "../../hooks/usePurchases";
import { postHogService } from "../../services/postHogService";
import type { PurchaseTimelineItem } from "../../utils/purchaseTimeline";
import SettingsRow from "./SettingsRow";

interface PurchasesCardProps {
  userId: string | null | undefined;
  setupDeferred: boolean;
  onOpen: () => void;
  onFinishSetup: () => void;
}

function itemWhen(
  item: PurchaseTimelineItem,
  tonight: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const date = new Date(item.startsAt);
  if (Number.isNaN(date.getTime())) return t("card.dateTbd");
  try {
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: item.timezone,
    }).format(date);
    if (tonight) return t("card.tonightAt", { time });
    const day = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: item.timezone,
    }).format(date);
    return `${day} · ${time}`;
  } catch {
    return date.toLocaleString();
  }
}

export function PurchasesCard({
  userId,
  setupDeferred,
  onOpen,
  onFinishSetup,
}: PurchasesCardProps): React.ReactElement {
  const { t } = useTranslation("purchases");
  const purchases = usePurchases(userId);
  const upcoming = useMemo(
    () =>
      purchases.timeline.upcoming.flatMap((group) =>
        group.items.map((item) => ({ item, tonight: group.key === "tonight" })),
      ),
    [purchases.timeline.upcoming],
  );
  const next = upcoming[0] ?? null;
  const moreTitles = upcoming.slice(1, 3).map(({ item }) => item.title);
  const itemPill = (item: PurchaseTimelineItem): string => {
    if (item.kind === "rsvp") return t("pill.rsvp");
    if (item.kind === "reservation") return t("pill.reservation");
    if (item.source === "comp") return t("pill.guestList");
    return t("pill.tickets", { count: item.count });
  };

  useEffect(() => {
    if (purchases.isError) {
      console.warn("[PurchasesCard] purchase preview unavailable");
    }
  }, [purchases.isError]);

  const open = (): void => {
    postHogService.capture("profile_purchases_card_tapped", {
      upcoming_count: upcoming.length,
    });
    onOpen();
  };

  const accessibilityLabel = next
    ? `${t("screen.title")}. ${t("card.upcomingCount", { count: upcoming.length })}. Next: ${next.item.title}, ${itemWhen(
        next.item,
        next.tonight,
        t,
      )}.`
    : `${t("screen.title")}. ${t("card.empty")}`;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={open}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
        testID="profile-purchases-card"
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t("card.title")}</Text>
          <Text style={styles.seeAll}>{t("card.seeAll")}</Text>
        </View>

        {purchases.isLoading ? (
          <View style={styles.skeleton} testID="profile-purchases-loading" />
        ) : next ? (
          <View style={styles.preview}>
            {next.item.coverMediaUrl ? (
              <View style={styles.thumb}>
                <EventCoverMedia
                  accessibleLabel={`${next.item.title} cover`}
                  autoplay={false}
                  height="100%"
                  mediaType={next.item.coverMediaType}
                  mediaUrl={next.item.coverMediaUrl}
                  playbackActive={false}
                  radius={12}
                  width="100%"
                />
              </View>
            ) : (
              <View style={[styles.thumb, styles.thumbFallback]}>
                <Text style={styles.thumbFallbackText}>M</Text>
              </View>
            )}
            <View style={styles.copy}>
              <Text style={styles.when}>
                {itemWhen(next.item, next.tonight, t)}
              </Text>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {next.item.title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {itemPill(next.item)}
                {next.item.venueLine ? ` · ${next.item.venueLine}` : ""}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.empty}>{t("card.empty")}</Text>
        )}

        {moreTitles.length > 0 ? (
          <Text style={styles.more} numberOfLines={2}>
            {t("card.moreUpcoming", {
              count: moreTitles.length,
              names: moreTitles.join(", "),
            })}
          </Text>
        ) : null}
      </Pressable>

      {setupDeferred ? (
        <SettingsRow
          icon="sparkles"
          label={t("finishSetup.title")}
          description={t("finishSetup.body")}
          showChevron
          isLast
          onPress={() => {
            postHogService.capture("profile_finish_setup_tapped", {});
            onFinishSetup();
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: { paddingBottom: 4 },
  pressed: { opacity: 0.72 },
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: "#ffffff", fontSize: 19, fontWeight: "700" },
  seeAll: { color: "#eb7825", fontSize: 14, fontWeight: "700" },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  thumb: { width: 56, height: 56, borderRadius: 12, overflow: "hidden" },
  thumbFallback: {
    backgroundColor: "rgba(235,120,37,.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbFallbackText: { color: "#eb7825", fontSize: 21, fontWeight: "900" },
  copy: { flex: 1, minWidth: 0 },
  when: { color: "#eb7825", fontSize: 12, fontWeight: "700", marginBottom: 2 },
  itemTitle: {
    color: "#ffffff",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "700",
  },
  meta: { color: "rgba(255,255,255,.55)", fontSize: 12, marginTop: 3 },
  more: {
    color: "rgba(255,255,255,.58)",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  empty: {
    color: "rgba(255,255,255,.58)",
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 10,
  },
  skeleton: {
    height: 56,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,.08)",
    marginVertical: 8,
  },
});
