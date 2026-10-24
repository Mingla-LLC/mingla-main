import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { useBrandGroupMediaPages } from "../../hooks/useBrandGroupMedia";
import type { BrandGroupMediaKind, BrandGroupMediaRow } from "../../services/brandGroupMediaService";
import { formatFileSize } from "../../utils/formatMediaDuration";
import { accent, glass, spacing, text as textTokens } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { MediaThumb } from "../media/MediaThumb";
import { BrandGroupFilePreviewModal } from "./BrandGroupFilePreviewModal";

interface Props {
  conversationId: string;
  groupName: string;
  compact?: boolean;
  onBack?: () => void;
  onShowInChat?: (messageId: string) => void;
}

interface MonthSection { title: string; data: BrandGroupMediaRow[][] }

function rowsOfThree(rows: BrandGroupMediaRow[]): BrandGroupMediaRow[][] {
  const result: BrandGroupMediaRow[][] = [];
  for (let index = 0; index < rows.length; index += 3) result.push(rows.slice(index, index + 3));
  return result;
}

export function BrandGroupMediaPanel({ conversationId, groupName, compact = false, onBack, onShowInChat = () => undefined }: Props): React.ReactElement {
  const { t, i18n } = useTranslation("brandGroupMedia");
  const [kind, setKind] = useState<BrandGroupMediaKind>("media");
  const [viewerFileId, setViewerFileId] = useState<string | null>(null);
  const mediaQuery = useBrandGroupMediaPages(conversationId, "media");
  const fileQuery = useBrandGroupMediaPages(conversationId, "files");
  const activeQuery = kind === "media" ? mediaQuery : fileQuery;
  const mediaRows = useMemo(() => mediaQuery.data?.pages.flatMap((page) => page.rows) ?? [], [mediaQuery.data]);
  const fileRows = useMemo(() => fileQuery.data?.pages.flatMap((page) => page.rows) ?? [], [fileQuery.data]);
  const rows = kind === "media" ? mediaRows : fileRows;
  const totals = mediaQuery.data?.pages[0]?.totals ?? fileQuery.data?.pages[0]?.totals ?? { media: 0, files: 0 };
  const photosCopy = totals.media > 0 ? t("media.count_photos_videos", { count: totals.media }) : "";
  const filesCopy = totals.files > 0 ? t("media.count_files", { count: totals.files }) : "";
  const subtitle = compact
    ? [photosCopy, filesCopy].filter(Boolean).join(" · ")
    : [groupName, photosCopy, filesCopy].filter(Boolean).join(" · ");

  const sections = useMemo<MonthSection[]>(() => {
    const map = new Map<string, BrandGroupMediaRow[]>();
    for (const item of mediaRows) {
      const date = new Date(item.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return [...map.entries()].sort(([left], [right]) => right.localeCompare(left)).map(([, monthRows]) => ({
      title: new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(new Date(monthRows[0].createdAt)),
      data: rowsOfThree(monthRows),
    }));
  }, [i18n.language, mediaRows]);

  const loadMore = (): void => {
    if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) void activeQuery.fetchNextPage();
  };
  const refresh = (): void => { void activeQuery.refetch(); };

  const header = (
    <>
      <View style={styles.header}>
        {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={t("media.back_a11y")} onPress={onBack} style={styles.iconButton}><Icon name="arrowL" size={18} color={textTokens.primary} /></Pressable> : null}
        <View style={styles.headerCopy}><Text style={styles.title}>{t("media.title")}</Text><Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text></View>
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {(["media", "files"] as const).map((value) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} onPress={() => setKind(value)} style={[styles.tab, kind === value && styles.tabActive]}>
            <Text style={[styles.tabText, kind === value && styles.tabTextActive]}>{value === "media" ? t("media.tab_media") : t("media.tab_files")}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  const content = activeQuery.isLoading ? (
    <View style={styles.state}><ActivityIndicator color={accent.warm} />{kind === "media" ? <View style={styles.skeletonGrid}>{Array.from({ length: 12 }, (_, index) => <View key={index} style={styles.skeleton} />)}</View> : <View style={styles.skeletonFiles}>{Array.from({ length: 6 }, (_, index) => <View key={index} style={styles.skeletonFile} />)}</View>}</View>
  ) : activeQuery.isError ? (
    <View style={styles.state}><Text style={styles.stateText}>{t("media.load_error")}</Text><Pressable accessibilityRole="button" onPress={refresh} style={styles.retry}><Text style={styles.retryText}>{t("media.retry")}</Text></Pressable></View>
  ) : rows.length === 0 ? (
    <View style={styles.state}><Icon name={kind === "media" ? "grid" : "notebook"} size={42} color={textTokens.tertiary} /><Text style={styles.emptyTitle}>{kind === "media" ? t("media.empty_media_title") : t("media.empty_files_title")}</Text><Text style={styles.stateText}>{t("media.empty_body")}</Text></View>
  ) : kind === "media" ? (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.map((item) => item.fileId).join(":")}
      renderSectionHeader={({ section }) => <Text style={styles.month}>{section.title}</Text>}
      renderItem={({ item: row }) => <View style={styles.gridRow}>{row.map((item) => <Pressable key={item.fileId} accessibilityRole="button" accessibilityLabel={item.name} onPress={() => setViewerFileId(item.fileId)} style={styles.tile}><MediaThumb item={item} style={styles.tileThumb} /></Pressable>)}{row.length < 3 ? Array.from({ length: 3 - row.length }, (_, index) => <View key={`empty-${index}`} style={styles.tile} />) : null}</View>}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={Platform.OS === "web" ? undefined : <RefreshControl refreshing={activeQuery.isRefetching} onRefresh={refresh} tintColor={accent.warm} />}
      ListFooterComponent={activeQuery.isFetchingNextPage ? <ActivityIndicator color={accent.warm} style={styles.footer} /> : null}
      contentContainerStyle={styles.listContent}
      stickySectionHeadersEnabled={false}
    />
  ) : (
    <FlatList
      data={fileRows}
      keyExtractor={(item) => item.fileId}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => setViewerFileId(item.fileId)} style={styles.fileRow}><View style={styles.fileIcon}><Text style={styles.extension}>{item.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</Text></View><View style={styles.fileCopy}><Text style={styles.fileName} numberOfLines={1}>{item.name}</Text><Text style={styles.fileMeta} numberOfLines={1}>{t("media.file_row_meta", { size: formatFileSize(item.sizeBytes, (key, variables) => t(key, variables)), sender: item.senderDisplayName, date: new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(new Date(item.createdAt)) })}</Text></View></Pressable>}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={Platform.OS === "web" ? undefined : <RefreshControl refreshing={activeQuery.isRefetching} onRefresh={refresh} tintColor={accent.warm} />}
      ListFooterComponent={activeQuery.isFetchingNextPage ? <ActivityIndicator color={accent.warm} style={styles.footer} /> : null}
      contentContainerStyle={styles.listContent}
    />
  );

  return (
    <View style={[styles.root, compact && styles.rootCompact]}>
      {header}
      <View style={styles.body}>{content}</View>
      <BrandGroupFilePreviewModal items={kind === "media" ? mediaRows : fileRows} initialFileId={viewerFileId} onShowInChat={onShowInChat} onClose={() => setViewerFileId(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#121113" },
  rootCompact: { width: 340, borderLeftWidth: 1, borderLeftColor: glass.border.profileBase },
  header: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: glass.border.profileBase },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: textTokens.primary, fontSize: 17, fontWeight: "800" },
  subtitle: { color: textTokens.tertiary, fontSize: 11, marginTop: 2 },
  tabs: { height: 36, flexDirection: "row", marginHorizontal: 14, marginVertical: 8, padding: 3, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)" },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  tabActive: { backgroundColor: "rgba(235,120,37,0.28)", borderWidth: 1, borderColor: "rgba(235,120,37,0.55)" },
  tabText: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  body: { flex: 1 },
  state: { flex: 1, minHeight: 260, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  stateText: { color: textTokens.secondary, textAlign: "center", lineHeight: 20 },
  emptyTitle: { color: textTokens.primary, fontSize: 16, fontWeight: "800", textAlign: "center" },
  retry: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 20, backgroundColor: accent.warm },
  retryText: { color: "#111", fontWeight: "800" },
  skeletonGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 2 },
  skeleton: { width: "32.7%", aspectRatio: 1, backgroundColor: "rgba(255,255,255,0.07)" },
  skeletonFiles: { width: "100%", gap: 8 },
  skeletonFile: { width: "100%", height: 56, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.07)" },
  listContent: { paddingBottom: spacing.xl },
  month: { color: textTokens.tertiary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, backgroundColor: "#121113" },
  gridRow: { flexDirection: "row", gap: 2 },
  tile: { flex: 1, aspectRatio: 1 },
  tileThumb: { width: "100%", height: "100%" },
  fileRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)" },
  fileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(235,120,37,0.2)" },
  extension: { color: accent.warm, fontSize: 11, fontWeight: "800" },
  fileCopy: { flex: 1, minWidth: 0 },
  fileName: { color: textTokens.primary, fontSize: 14, fontWeight: "800" },
  fileMeta: { color: textTokens.tertiary, fontSize: 11, marginTop: 3 },
  footer: { margin: spacing.md },
});
