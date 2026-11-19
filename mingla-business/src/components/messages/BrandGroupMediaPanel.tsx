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
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useBrandGroupMediaPages } from "../../hooks/useBrandGroupMedia";
import { useBusinessMediaTranslation } from "../../i18n";
import type { BrandGroupMediaKind, BrandGroupMediaRow } from "../../services/brandGroupMediaService";
import { formatFileSize } from "../../utils/formatMediaDuration";
import { color, radius, space } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

interface Props {
  conversationId: string;
  groupName: string;
  compact?: boolean;
  onBack?: () => void;
  onOpenItems: (items: BrandGroupMediaRow[], fileId: string) => void;
  renderThumbnail: (item: BrandGroupMediaRow, style: StyleProp<ViewStyle>) => React.ReactNode;
}

interface MonthSection { title: string; data: BrandGroupMediaRow[][] }

function rowsOfThree(rows: BrandGroupMediaRow[]): BrandGroupMediaRow[][] {
  const result: BrandGroupMediaRow[][] = [];
  for (let index = 0; index < rows.length; index += 3) result.push(rows.slice(index, index + 3));
  return result;
}

export function BrandGroupMediaPanel({ conversationId, groupName, compact = false, onBack, onOpenItems, renderThumbnail }: Props): React.ReactElement {
  const { t, language } = useBusinessMediaTranslation();
  const [kind, setKind] = useState<BrandGroupMediaKind>("media");
  const mediaQuery = useBrandGroupMediaPages(conversationId, "media");
  const fileQuery = useBrandGroupMediaPages(conversationId, "files");
  const activeQuery = kind === "media" ? mediaQuery : fileQuery;
  const mediaRows = useMemo(() => mediaQuery.data?.pages.flatMap((page) => page.rows) ?? [], [mediaQuery.data]);
  const fileRows = useMemo(() => fileQuery.data?.pages.flatMap((page) => page.rows) ?? [], [fileQuery.data]);
  const rows = kind === "media" ? mediaRows : fileRows;
  const totals = mediaQuery.data?.pages[0]?.totals ?? fileQuery.data?.pages[0]?.totals ?? { media: 0, files: 0 };
  const photosCopy = t("media.count_photos_videos", { count: totals.media });
  const filesCopy = t("media.count_files", { count: totals.files });
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
      title: new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(new Date(monthRows[0].createdAt)),
      data: rowsOfThree(monthRows),
    }));
  }, [language, mediaRows]);

  const loadMore = (): void => {
    if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) void activeQuery.fetchNextPage();
  };
  const refresh = (): void => { void activeQuery.refetch(); };

  const header = (
    <>
      <View style={styles.header}>
        {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={t("media.back_a11y")} onPress={onBack} style={styles.iconButton}><Icon name="arrowL" size={18} color={color.text1} /></Pressable> : null}
        <View style={styles.headerCopy}><Text style={styles.title}>{t("media.title")}</Text><Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text></View>
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {(["media", "files"] as const).map((value) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === "media" ? t("media.tab_media") : t("media.tab_files")} accessibilityState={{ selected: kind === value }} onPress={() => setKind(value)} style={[styles.tab, kind === value && styles.tabActive]}>
            <Text style={[styles.tabText, kind === value && styles.tabTextActive]}>{value === "media" ? t("media.tab_media") : t("media.tab_files")}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  const content = activeQuery.isLoading ? (
    <View style={styles.state}><ActivityIndicator color={color.text2} />{kind === "media" ? <View style={styles.skeletonGrid}>{Array.from({ length: 12 }, (_, index) => <View key={index} style={styles.skeleton} />)}</View> : <View style={styles.skeletonFiles}>{Array.from({ length: 6 }, (_, index) => <View key={index} style={styles.skeletonFile} />)}</View>}</View>
  ) : activeQuery.isError ? (
    <View style={styles.state}><Text style={styles.stateText}>{t("media.load_error")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("media.retry")} onPress={refresh} style={styles.retry}><Text style={styles.retryText}>{t("media.retry")}</Text></Pressable></View>
  ) : rows.length === 0 ? (
    <View style={styles.state}><Icon name={kind === "media" ? "grid" : "notebook"} size={42} color={color.text3} /><Text style={styles.emptyTitle}>{kind === "media" ? t("media.empty_media_title") : t("media.empty_files_title")}</Text><Text style={styles.stateText}>{t("media.empty_body")}</Text></View>
  ) : kind === "media" ? (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.map((item) => item.fileId).join(":")}
      renderSectionHeader={({ section }) => <Text style={styles.month}>{section.title}</Text>}
      renderItem={({ item: row }) => <View style={styles.gridRow}>{row.map((item) => <Pressable key={item.fileId} accessibilityRole="button" accessibilityLabel={item.name} onPress={() => onOpenItems(mediaRows, item.fileId)} style={styles.tile}>{renderThumbnail(item, styles.tileThumb)}</Pressable>)}{row.length < 3 ? Array.from({ length: 3 - row.length }, (_, index) => <View key={`empty-${index}`} style={styles.tile} />) : null}</View>}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={Platform.OS === "web" ? undefined : <RefreshControl refreshing={activeQuery.isRefetching} onRefresh={refresh} tintColor={color.text2} />}
      ListFooterComponent={activeQuery.isFetchingNextPage ? <ActivityIndicator color={color.text2} style={styles.footer} /> : null}
      contentContainerStyle={styles.listContent}
      stickySectionHeadersEnabled={false}
    />
  ) : (
    <FlatList
      data={fileRows}
      keyExtractor={(item) => item.fileId}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => onOpenItems(fileRows, item.fileId)} style={styles.fileRow}><View style={styles.fileIcon}><Text style={styles.extension}>{item.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</Text></View><View style={styles.fileCopy}><Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">{item.name}</Text><Text style={styles.fileMeta} numberOfLines={1}>{t("media.file_row_meta", { size: formatFileSize(item.sizeBytes, (key, variables) => t(key, variables)), sender: item.senderDisplayName, date: new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(new Date(item.createdAt)) })}</Text></View></Pressable>}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={Platform.OS === "web" ? undefined : <RefreshControl refreshing={activeQuery.isRefetching} onRefresh={refresh} tintColor={color.text2} />}
      ListFooterComponent={activeQuery.isFetchingNextPage ? <ActivityIndicator color={color.text2} style={styles.footer} /> : null}
      contentContainerStyle={styles.listContent}
    />
  );

  return (
    <View style={[styles.root, compact && styles.rootCompact]}>
      {header}
      <View style={styles.body}>{content}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  // #4420: the rail is 400 (size.sidePanel) and draws its own edge.
  rootCompact: { flex: 1, minWidth: 0 },
  header: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: color.line },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.pressed },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: color.text1, fontSize: 17, lineHeight: 24, fontWeight: "600" },
  subtitle: { color: color.text3, fontSize: 13, marginTop: 2 },
  // #4420 design: a pill segmented control.
  tabs: { minHeight: 40, flexDirection: "row", marginHorizontal: space[4], marginVertical: space[2], padding: 3, borderRadius: radius.full, borderWidth: 1, borderColor: color.line, backgroundColor: color.fill.input },
  tab: { flex: 1, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  tabActive: { backgroundColor: color.fill.tabOn, borderWidth: 1, borderColor: color.line, borderTopColor: color.lineStrong },
  tabText: { color: color.text2, fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: color.textStrong },
  body: { flex: 1 },
  state: { flex: 1, minHeight: 260, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[6] },
  stateText: { color: color.text2, textAlign: "center", lineHeight: 20 },
  emptyTitle: { color: color.text1, fontSize: 16, fontWeight: "800", textAlign: "center" },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: space[4], borderRadius: 22, backgroundColor: color.paper },
  retryText: { color: color.ink, fontWeight: "800" },
  skeletonGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 2 },
  skeleton: { width: "32.7%", aspectRatio: 1, backgroundColor: color.fill.tile },
  skeletonFiles: { width: "100%", gap: 8 },
  skeletonFile: { width: "100%", height: 56, borderRadius: 10, backgroundColor: color.fill.tile },
  listContent: { paddingBottom: space[7] },
  month: { color: color.text3, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.84, paddingHorizontal: space[4], paddingTop: 14, paddingBottom: space[2], backgroundColor: color.canvas },
  gridRow: { flexDirection: "row", gap: 4, paddingHorizontal: space[4], marginBottom: 4 },
  tile: { flex: 1, aspectRatio: 1, borderRadius: 10, overflow: "hidden" },
  tileThumb: { width: "100%", height: "100%" },
  fileRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: space[4], paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.line },
  fileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tile },
  extension: { color: color.text1, fontSize: 11, fontWeight: "800" },
  fileCopy: { flex: 1, minWidth: 0 },
  fileName: { color: color.text1, fontSize: 15, lineHeight: 21, fontWeight: "600" },
  fileMeta: { color: color.text3, fontSize: 13, marginTop: 2 },
  footer: { margin: space[4] },
});
