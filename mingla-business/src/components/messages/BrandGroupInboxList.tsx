/**
 * #4304 part 2 — the Brand-group inbox, styled like the Explorer chat list
 * (app-mobile components/connections/ChatListItem.tsx): flat 72pt rows, no
 * card chrome, hairline separators inset past the tile, bold + orange when
 * unread, the last speaker in the preview. Used full-screen on phones and as
 * the left pane of the desktop Messages page.
 *
 * No pins: Brand groups have no pinning data, so none is shown.
 *
 * #4420 — ONE row per brand: the brand's Team chat (Brand group) and its Guest
 * chat are joined in memory (buildBrandInboxRows). The preview says which side
 * spoke last; a white count is team unread, a blue megaphone count is guests
 * unread. The list ends with a quiet "All N brands" marker.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { color, space } from "../../constants/designSystem";
import type { BrandGroupSummary } from "../../services/brandGroupsService";
import type { BrandGuestActivity, BrandGuestChatSummary } from "../../services/brandGuestChatList";
import {
  brandGroupInboxTime,
  type BrandGroupInboxFilter,
} from "../../utils/brandGroupThreadModel";
import {
  brandInboxRowPreview,
  buildBrandInboxRows,
  filterBrandInboxRows,
  type BrandInboxRow,
} from "../../utils/brandMessagesInbox";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useBusinessMediaTranslation } from "../../i18n";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { BrandGroupTile } from "./BrandGroupTile";

const TILE = 48;

export function BrandGroupInboxRow({
  row,
  viewerId,
  selected,
  onPress,
  now,
}: {
  row: BrandInboxRow;
  viewerId: string | null;
  selected?: boolean;
  onPress: () => void;
  now?: Date;
}): React.ReactElement {
  const { t } = useBusinessMediaTranslation();
  const unread = row.teamUnread + row.guestUnread > 0;
  const time = brandGroupInboxTime(row.lastAt, now);
  const preview = brandInboxRowPreview(row, viewerId, t);
  const muted = row.group?.muted === true;
  const label = [
    row.brandName,
    row.teamUnread > 0 ? t("messages.row_team_unread", { n: row.teamUnread }) : null,
    row.guestUnread > 0 ? t("messages.row_guest_unread", { n: row.guestUnread }) : null,
    row.guestChat ? t("messages.row_has_guests") : null,
    muted ? t("messages.row_muted") : null,
  ].filter(Boolean).join(", ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && styles.rowPressed,
        selected && styles.rowSelected,
      ]}
      // Team rows keep the Brand group row id (device flows key on it).
      testID={row.group ? `brand-group-row-${row.group.conversation_id}` : `brand-inbox-row-${row.brandId}`}
    >
      <BrandGroupTile name={row.brandName} photoUrl={row.photoUrl} seed={row.brandId} size={TILE} />
      <View style={styles.rowCopy}>
        <View style={styles.rowLine}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>{row.brandName}</Text>
          {time ? <Text style={[styles.time, unread && styles.timeUnread]}>{time}</Text> : null}
        </View>
        <View style={styles.rowLine}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {preview.side ? (
              <Text style={preview.side === "guests" ? styles.sideTagGuests : styles.sideTag}>
                {preview.side === "guests" ? t("messages.tag_guests") : t("messages.tag_team")}
              </Text>
            ) : null}
            {preview.text}
          </Text>
          {muted ? (
            <View accessibilityElementsHidden style={styles.muteIcon}>
              <Icon name="volumeOff" size={14} color={brandGroupChat.textMuted} />
            </View>
          ) : null}
          {row.teamUnread > 0 ? (
            <View style={styles.badge} testID={`brand-inbox-team-unread-${row.brandId}`}>
              <Text style={styles.badgeText}>{row.teamUnread > 99 ? "99+" : row.teamUnread}</Text>
            </View>
          ) : null}
          {row.guestUnread > 0 ? (
            <View style={styles.badgeGuests} testID={`brand-inbox-guest-unread-${row.brandId}`}>
              <Icon name="megaphone" size={11} color={color.infoText} />
              <Text style={styles.badgeGuestsText}>{row.guestUnread > 99 ? "99+" : row.guestUnread}</Text>
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
  guestChats = [],
  guestActivity,
  loading,
  error,
  onRetry,
  viewerId,
  isStaff,
  selectedBrandId,
  onOpen,
  header,
  scrollable = true,
}: {
  groups: BrandGroupSummary[];
  /** #4420: the brand Guest chats I run, joined onto their brand's row. */
  guestChats?: readonly BrandGuestChatSummary[];
  guestActivity?: ReadonlyMap<string, BrandGuestActivity>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  viewerId: string | null;
  isStaff: boolean;
  /** #4420: rows are brands, so the selection is a brand id. */
  selectedBrandId?: string | null;
  onOpen: (row: BrandInboxRow) => void;
  /** Support inbox row and customer enquiries, above the groups. */
  header?: React.ReactNode;
  scrollable?: boolean;
}): React.ReactElement {
  const { t } = useBusinessMediaTranslation();
  const [filter, setFilter] = useState<BrandGroupInboxFilter>("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => buildBrandInboxRows(groups, guestChats, guestActivity),
    [groups, guestActivity, guestChats],
  );
  const visible = useMemo(() => filterBrandInboxRows(rows, filter, query, viewerId, t), [filter, query, rows, t, viewerId]);
  const own = visible.filter((row) => row.accessKind === "brand");
  const supporting = visible.filter((row) => row.accessKind === "support");
  const splitSections = isStaff && filter === "all";
  const filters = FILTERS.filter((item) => !item.staffOnly || isStaff);

  const renderRows = (list: BrandInboxRow[]): React.ReactNode => list.map((row, index) => (
    <View key={row.key}>
      <BrandGroupInboxRow
        row={row}
        viewerId={viewerId}
        selected={selectedBrandId === row.brandId}
        onPress={() => onOpen(row)}
      />
      {index < list.length - 1 ? <View style={styles.separator} /> : null}
    </View>
  ));

  const emptyText = query.trim()
    ? t("messages.no_match", { query: query.trim() })
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
          placeholder={t("messages.search")}
          placeholderTextColor={brandGroupChat.textMuted}
          style={styles.search}
          accessibilityLabel={t("messages.search")}
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
      <View style={styles.chips} accessibilityRole="tablist">
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
      </View>

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
          <Text style={styles.sectionTitle}>{t("messages.section_mine")}</Text>
          {own.length ? renderRows(own) : <Text style={styles.emptyText}>Your active brand teams will appear here automatically.</Text>}
          {supporting.length ? (
            <>
              <Text style={styles.sectionTitle}>{t("messages.section_support")}</Text>
              {renderRows(supporting)}
            </>
          ) : null}
        </>
      ) : renderRows(visible)}
      {!loading && !error && visible.length > 0 ? (
        <View style={styles.listEnd} testID="brand-inbox-list-end">
          <View style={styles.listEndRule} />
          <Text style={styles.listEndText}>{rows.length === 1 ? t("messages.list_end_one") : t("messages.list_end", { n: rows.length })}</Text>
          <View style={styles.listEndRule} />
        </View>
      ) : null}
    </>
  );

  if (!scrollable) return <View style={styles.list}>{body}</View>;
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} testID="brand-group-inbox-scroll">
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  list: { paddingBottom: space[9] },
  row: { minHeight: brandGroupChat.inboxRowHeight, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space[4], paddingVertical: 10 },
  rowPressed: { backgroundColor: brandGroupChat.strip },
  rowSelected: { backgroundColor: brandGroupChat.accentSoft },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { flex: 1, minWidth: 0, color: brandGroupChat.textPrimary, fontSize: 16, fontWeight: "600" },
  nameUnread: { fontWeight: "800" },
  time: { color: brandGroupChat.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  timeUnread: { color: brandGroupChat.textPrimary, fontWeight: "700" },
  preview: { flex: 1, minWidth: 0, color: brandGroupChat.textSoft, fontSize: 14 },
  previewUnread: { color: brandGroupChat.textPrimary, fontWeight: "600" },
  muteIcon: { width: 16, alignItems: "center" },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: color.paper },
  badgeText: { color: color.ink, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  // #4420: guests unread, the blue megaphone count.
  badgeGuests: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, borderWidth: 1, borderColor: color.guestLine, backgroundColor: color.guestTint2 },
  badgeGuestsText: { color: color.infoText, fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  sideTag: { color: brandGroupChat.textSoft, fontWeight: "600" },
  sideTagGuests: { color: color.infoText, fontWeight: "600" },
  listEnd: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space[4], paddingTop: space[6], paddingBottom: space[7] },
  listEndRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  listEndText: { color: brandGroupChat.textSoft, fontSize: 13 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: space[4] + TILE + 12, backgroundColor: brandGroupChat.hairline },
  searchWrap: { minHeight: 40, marginHorizontal: space[4], marginTop: space[2], flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: brandGroupChat.surfaceRaised },
  search: { flex: 1, minHeight: 40, color: brandGroupChat.textPrimary, fontSize: 15, paddingVertical: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: space[4], paddingVertical: space[2] },
  chip: { minHeight: 34, justifyContent: "center", paddingHorizontal: 14, borderRadius: 17, borderWidth: 1, borderColor: brandGroupChat.hairline },
  chipActive: { borderColor: brandGroupChat.accent, backgroundColor: brandGroupChat.accentSoft },
  chipText: { color: brandGroupChat.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: brandGroupChat.accent, fontWeight: "800" },
  sectionTitle: { color: brandGroupChat.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7, paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: 4 },
  skeletonBlock: { backgroundColor: brandGroupChat.surfaceRaised, borderRadius: 6 },
  state: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: space[4], padding: space[6] },
  stateText: { color: brandGroupChat.textSecondary, textAlign: "center" },
  emptyText: { color: brandGroupChat.textSoft, paddingHorizontal: space[4], paddingVertical: space[6], textAlign: "center" },
});
