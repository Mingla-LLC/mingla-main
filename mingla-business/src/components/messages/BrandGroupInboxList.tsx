/**
 * #4304 part 2 — the Brand-group inbox, styled like the Explorer chat list
 * (app-mobile components/connections/ChatListItem.tsx): flat 72pt rows, no
 * card chrome, hairline separators inset past the tile, bold + orange when
 * unread, the last speaker in the preview. Used full-screen on phones and as
 * the left pane of the desktop Messages page.
 *
 * No pins: Brand groups have no pinning data, so none is shown.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { spacing } from "../../constants/designSystem";
import type { BrandGroupSummary } from "../../services/brandGroupsService";
import {
  brandGroupInboxPreview,
  brandGroupInboxTime,
  filterBrandGroups,
  type BrandGroupInboxFilter,
} from "../../utils/brandGroupThreadModel";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { BrandGroupTile } from "./BrandGroupTile";

const TILE = 48;

export function BrandGroupInboxRow({
  group,
  viewerId,
  selected,
  onPress,
  now,
}: {
  group: BrandGroupSummary;
  viewerId: string | null;
  selected?: boolean;
  onPress: () => void;
  now?: Date;
}): React.ReactElement {
  const unread = group.unread_count > 0;
  const time = brandGroupInboxTime(group.last_message_at, now);
  const preview = brandGroupInboxPreview(group, viewerId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.brand_name} Brand group${unread ? `, ${group.unread_count} unread` : ""}${group.muted ? ", muted" : ""}`}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && styles.rowPressed,
        selected && styles.rowSelected,
      ]}
      testID={`brand-group-row-${group.conversation_id}`}
    >
      <BrandGroupTile name={group.brand_name} photoUrl={group.brand_photo_url} seed={group.brand_id} size={TILE} />
      <View style={styles.rowCopy}>
        <View style={styles.rowLine}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>{group.brand_name}</Text>
          {time ? <Text style={[styles.time, unread && styles.timeUnread]}>{time}</Text> : null}
        </View>
        <View style={styles.rowLine}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>{preview}</Text>
          {group.muted ? (
            <View accessibilityElementsHidden style={styles.muteIcon}>
              <Icon name="volumeOff" size={14} color={brandGroupChat.textMuted} />
            </View>
          ) : null}
          {unread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{group.unread_count > 99 ? "99+" : group.unread_count}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function SkeletonRow({ opacity }: { opacity: Animated.Value }): React.ReactElement {
  return (
    <Animated.View style={[styles.row, { opacity }]}>
      <View style={[styles.skeletonBlock, { width: TILE, height: TILE, borderRadius: 14 }]} />
      <View style={styles.rowCopy}>
        <View style={[styles.skeletonBlock, { width: "46%", height: 13 }]} />
        <View style={[styles.skeletonBlock, { width: "78%", height: 11, marginTop: 8 }]} />
      </View>
    </Animated.View>
  );
}

function InboxSkeleton(): React.ReactElement {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.9, duration: 650, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: Platform.OS !== "web" }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <View accessibilityLabel="Loading Brand groups" testID="brand-group-inbox-skeleton">
      {[0, 1, 2, 3, 4].map((index) => <SkeletonRow key={index} opacity={opacity} />)}
    </View>
  );
}

const FILTERS: { key: BrandGroupInboxFilter; label: string; staffOnly?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "mine", label: "My brands", staffOnly: true },
  { key: "supporting", label: "Supporting", staffOnly: true },
];

export function BrandGroupInboxList({
  groups,
  loading,
  error,
  onRetry,
  viewerId,
  isStaff,
  selectedId,
  onOpen,
  header,
  scrollable = true,
}: {
  groups: BrandGroupSummary[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  viewerId: string | null;
  isStaff: boolean;
  selectedId?: string | null;
  onOpen: (group: BrandGroupSummary) => void;
  /** Support inbox row and customer enquiries, above the groups. */
  header?: React.ReactNode;
  scrollable?: boolean;
}): React.ReactElement {
  const [filter, setFilter] = useState<BrandGroupInboxFilter>("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterBrandGroups(groups, filter, query), [filter, groups, query]);
  const own = visible.filter((group) => group.access_kind === "brand");
  const supporting = visible.filter((group) => group.access_kind === "support");
  const splitSections = isStaff && filter === "all";
  const filters = FILTERS.filter((item) => !item.staffOnly || isStaff);

  const renderRows = (rows: BrandGroupSummary[]): React.ReactNode => rows.map((group, index) => (
    <View key={group.conversation_id}>
      <BrandGroupInboxRow
        group={group}
        viewerId={viewerId}
        selected={selectedId === group.conversation_id}
        onPress={() => onOpen(group)}
      />
      {index < rows.length - 1 ? <View style={styles.separator} /> : null}
    </View>
  ));

  const emptyText = query.trim()
    ? `No Brand groups match “${query.trim()}”.`
    : filter === "unread"
      ? "You’re all caught up."
      : filter === "supporting"
        ? "No additional Brand groups need Support access."
        : "Your active brand teams will appear here automatically.";

  const body = (
    <>
      <View style={styles.searchWrap}>
        <Icon name="search" size={16} color={brandGroupChat.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search Brand groups"
          placeholderTextColor={brandGroupChat.textMuted}
          style={styles.search}
          accessibilityLabel="Search Brand groups"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          testID="brand-group-search"
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery("")}>
            <Icon name="close" size={14} color={brandGroupChat.textSoft} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
        {filters.map((item) => {
          const active = filter === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityLabel={`Show ${item.label}`}
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(item.key)}
              style={[styles.chip, active && styles.chipActive]}
              testID={`brand-group-filter-${item.key}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {header}

      {loading ? (
        <InboxSkeleton />
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>{error}</Text>
          <Button label="Retry" variant="secondary" onPress={onRetry} />
        </View>
      ) : visible.length === 0 ? (
        <Text style={styles.emptyText}>{emptyText}</Text>
      ) : splitSections ? (
        <>
          <Text style={styles.sectionTitle}>Your Brand groups</Text>
          {own.length ? renderRows(own) : <Text style={styles.emptyText}>Your active brand teams will appear here automatically.</Text>}
          {supporting.length ? (
            <>
              <Text style={styles.sectionTitle}>Brand groups you support</Text>
              {renderRows(supporting)}
            </>
          ) : null}
        </>
      ) : renderRows(visible)}
    </>
  );

  if (!scrollable) return <View style={styles.list}>{body}</View>;
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  list: { paddingBottom: spacing.xxl },
  row: { minHeight: brandGroupChat.inboxRowHeight, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: spacing.md, paddingVertical: 10 },
  rowPressed: { backgroundColor: brandGroupChat.strip },
  rowSelected: { backgroundColor: brandGroupChat.accentSoft },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flex: 1, minWidth: 0, color: brandGroupChat.textPrimary, fontSize: 16, fontWeight: "600" },
  nameUnread: { fontWeight: "800" },
  time: { color: brandGroupChat.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  timeUnread: { color: brandGroupChat.accent, fontWeight: "700" },
  preview: { flex: 1, minWidth: 0, color: brandGroupChat.textSoft, fontSize: 14 },
  previewUnread: { color: brandGroupChat.textPrimary, fontWeight: "600" },
  muteIcon: { width: 16, alignItems: "center" },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: brandGroupChat.accent },
  badgeText: { color: "#101216", fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md + TILE + 12, backgroundColor: brandGroupChat.hairline },
  searchWrap: { minHeight: 40, marginHorizontal: spacing.md, marginTop: spacing.sm, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: brandGroupChat.surfaceRaised },
  search: { flex: 1, minHeight: 40, color: brandGroupChat.textPrimary, fontSize: 15, paddingVertical: 0 },
  chips: { gap: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: { minHeight: 34, justifyContent: "center", paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: brandGroupChat.hairline },
  chipActive: { borderColor: brandGroupChat.accent, backgroundColor: brandGroupChat.accentSoft },
  chipText: { color: brandGroupChat.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: brandGroupChat.accent, fontWeight: "800" },
  sectionTitle: { color: brandGroupChat.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 4 },
  skeletonBlock: { backgroundColor: brandGroupChat.surfaceRaised, borderRadius: 6 },
  state: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  stateText: { color: brandGroupChat.textSecondary, textAlign: "center" },
  emptyText: { color: brandGroupChat.textSoft, paddingHorizontal: spacing.md, paddingVertical: spacing.lg, textAlign: "center" },
});
