// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { PurchaseCard } from "../../src/components/purchases/PurchaseCard";
import { PurchaseEmptyState } from "../../src/components/purchases/PurchaseEmptyState";
import { usePurchases } from "../../src/hooks/usePurchases";
import { runClaimSweep } from "../../src/services/claimSweep";
import { postHogService } from "../../src/services/postHogService";
import { useAppStore } from "../../src/store/appStore";
import type {
  PurchaseGroup,
  PurchaseTimelineItem,
} from "../../src/utils/purchaseTimeline";

type Period = "upcoming" | "past";

export default function PurchasesRoute(): React.ReactElement {
  const { t } = useTranslation("purchases");
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const userId = useAppStore((state) => state.user?.id ?? null);
  const setupDeferred = useAppStore(
    (state) => state.profile?.setup_deferred_at != null,
  );
  const purchases = usePurchases(userId);
  const viewedRef = useRef(false);
  const initialTab =
    (Array.isArray(params.tab) ? params.tab[0] : params.tab) === "past"
      ? "past"
      : "upcoming";
  const [period, setPeriod] = useState<Period>(initialTab);
  const groups = purchases.timeline[period];
  const count = useMemo(
    () => groups.reduce((total, group) => total + group.items.length, 0),
    [groups],
  );

  const openItem = (item: PurchaseTimelineItem): void => {
    postHogService.capture("purchases_row_tapped", {
      kind: item.kind,
      tab: period,
    });
    router.push(
      `/purchases/${item.kind}/${encodeURIComponent(item.id)}` as never,
    );
  };

  const refresh = async (): Promise<void> => {
    await purchases.refetch();
    if (userId) await runClaimSweep(userId, "pull_to_refresh");
  };

  useEffect(() => {
    if (viewedRef.current || purchases.isLoading) return;
    viewedRef.current = true;
    postHogService.capture("purchases_viewed", {
      tab: initialTab,
      upcoming_count: purchases.timeline.upcoming.reduce(
        (total, group) => total + group.items.length,
        0,
      ),
      past_count: purchases.timeline.past.reduce(
        (total, group) => total + group.items.length,
        0,
      ),
    });
  }, [
    initialTab,
    purchases.isLoading,
    purchases.timeline.past,
    purchases.timeline.upcoming,
  ]);

  const changePeriod = (next: Period): void => {
    if (next === period) return;
    setPeriod(next);
    postHogService.capture("purchases_tab_changed", { tab: next });
  };

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 36 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={purchases.isFetching && !purchases.isLoading}
            tintColor="#eb7825"
            onRefresh={() => {
              void refresh();
            }}
          />
        }
      >
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("screen.back")}
            hitSlop={10}
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace("/")
            }
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{t("screen.eyebrow")}</Text>
            <Text style={styles.heading}>{t("screen.title")}</Text>
          </View>
        </View>

        <Text style={styles.intro}>{t("screen.intro")}</Text>

        <View accessibilityRole="tablist" style={styles.tabs}>
          {(["upcoming", "past"] as const).map((value) => {
            const selected = value === period;
            return (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => changePeriod(value)}
                style={[styles.tab, selected && styles.tabSelected]}
              >
                <Text
                  style={[styles.tabText, selected && styles.tabTextSelected]}
                >
                  {t(`tab.${value}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {!userId ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{t("screen.signInTitle")}</Text>
            <Text style={styles.noticeBody}>{t("screen.signInBody")}</Text>
          </View>
        ) : purchases.isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#eb7825" />
            <Text style={styles.loadingText}>{t("screen.loading")}</Text>
          </View>
        ) : purchases.isError ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{t("error.title")}</Text>
            <Text style={styles.noticeBody}>{t("error.body")}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void purchases.refetch();
              }}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>{t("error.retry")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {purchases.isPartialError ? (
              <View style={styles.partialBanner}>
                <Text style={styles.partialText}>
                  {t("screen.partialError")}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void purchases.refetch();
                  }}
                >
                  <Text style={styles.partialRetry}>{t("error.retry")}</Text>
                </Pressable>
              </View>
            ) : null}
            <Text style={styles.resultCount}>
              {t("screen.itemCount", { count })}
            </Text>
            {groups.length === 0 ? (
              <PurchaseEmptyState period={period} />
            ) : (
              groups.map((group: PurchaseGroup) => (
                <View key={group.key} style={styles.group}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                  <View style={styles.cardList}>
                    {group.items.map((item) => (
                      <PurchaseCard
                        key={item.key}
                        item={item}
                        onPress={() => openItem(item)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/purchases/missing" as never)}
              style={({ pressed }) => [
                styles.missingRow,
                pressed && styles.pressed,
              ]}
            >
              <View>
                <Text style={styles.missingRowTitle}>
                  {t("missing.rowTitle")}
                </Text>
                <Text style={styles.missingRowBody}>{t("missing.body")}</Text>
              </View>
              <Text style={styles.missingRowChevron}>›</Text>
            </Pressable>
            {setupDeferred ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("finishSetup.title")}
                onPress={() => router.replace("/?finishSetup=1" as never)}
                style={({ pressed }) => [
                  styles.missingRow,
                  pressed && styles.pressed,
                ]}
              >
                <View>
                  <Text style={styles.missingRowTitle}>
                    {t("finishSetup.title")}
                  </Text>
                  <Text style={styles.missingRowBody}>
                    {t("finishSetup.body")}
                  </Text>
                </View>
                <Text style={styles.missingRowChevron}>›</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0b0d11" },
  content: { paddingHorizontal: 18 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#171a20",
  },
  backText: { color: "#fff", fontSize: 32, lineHeight: 34, marginTop: -3 },
  pressed: { opacity: 0.7 },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: "#eb7825",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  heading: { color: "#fff", fontSize: 34, lineHeight: 39, fontWeight: "800" },
  intro: {
    color: "rgba(255,255,255,0.60)",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 20,
  },
  tabs: {
    flexDirection: "row",
    borderRadius: 18,
    padding: 4,
    backgroundColor: "#171a20",
    marginTop: 24,
    marginBottom: 18,
  },
  tab: { flex: 1, alignItems: "center", borderRadius: 14, paddingVertical: 11 },
  tabSelected: { backgroundColor: "#eb7825" },
  tabText: { color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: "700" },
  tabTextSelected: { color: "#fff" },
  resultCount: {
    color: "rgba(255,255,255,0.42)",
    fontSize: 12,
    marginBottom: 10,
  },
  group: { marginBottom: 28 },
  groupTitle: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 11,
  },
  cardList: { gap: 12 },
  loading: { alignItems: "center", paddingVertical: 64, gap: 12 },
  loadingText: { color: "rgba(255,255,255,0.62)", fontSize: 14 },
  notice: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#171a20",
    padding: 24,
  },
  noticeTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  noticeBody: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  retry: {
    alignSelf: "flex-start",
    borderRadius: 13,
    backgroundColor: "#eb7825",
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 18,
  },
  retryText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  partialBanner: {
    borderRadius: 14,
    backgroundColor: "rgba(235,120,37,0.13)",
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 14,
  },
  partialText: { color: "#f5bc8e", fontSize: 12, lineHeight: 17 },
  partialRetry: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },
  missingRow: {
    minHeight: 64,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
    paddingVertical: 16,
  },
  missingRowTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  missingRowBody: {
    color: "rgba(255,255,255,0.50)",
    fontSize: 12,
    marginTop: 3,
  },
  missingRowChevron: { color: "#eb7825", fontSize: 30, lineHeight: 32 },
});
