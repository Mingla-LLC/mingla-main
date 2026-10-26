/**
 * Issue #4114 Wave 2b — the friends sheet's Friends tab (dark, design v6).
 *
 * Search, then the Paired section (58pt avatars with a gold ring and star and
 * each friend's next birthday — the same birthday their profile's paired view
 * shows, read once for every paired friend by fetchPairingPills; a + tile that
 * pairs someone and shows the free plan's limit), then all friends (44pt
 * avatar, name, @username, a message button and ⋯), then "Blocked N ›".
 *
 * The Pair button has left the row: pair / unpair lives in ⋯ (FriendActionsSheet).
 */
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { Friend } from "../../hooks/useFriends";
import { getDisplayName } from "../../utils/getDisplayName";
import { glass } from "../../constants/designSystem";
import { ChatAvatar } from "./ChatAvatar";
import { friendMatches, friendUserIdOf } from "./chatListModel";
import { nextBirthdayLabel, type BirthdayLabel, type PairingPillLike } from "./friendsSheetModel";

const ink = glass.discover.chatList;
const fs = glass.discover.friendsSheet;

interface FriendsManagementListProps {
  friends: Friend[];
  loading: boolean;
  mutedUserIds: string[];
  currentUserId: string;
  /** Active pairs (pairing pills with pillState 'active'). */
  pairedPills: PairingPillLike[];
  /** The + tile: free-plan count, or nothing on Mingla+. */
  pairTile: { showFreeCount: boolean; used: number; limit: number };
  onPairTile: () => void;
  /** Opens the friend's profile at their birthday, holidays and saves. */
  onOpenPaired: (friendUserId: string) => void;
  onAvatarPress: (friendUserId: string) => void;
  onMessage: (friend: Friend) => void;
  onOpenFriendActions: (friend: Friend) => void;
  blockedCount: number;
  onOpenBlocked: () => void;
}

function useBirthdayText(): (label: BirthdayLabel | null) => string | null {
  const { t, i18n } = useTranslation(["connections"]);
  return (label) => {
    if (!label) return null;
    if (label.kind === "today") return t("connections:fs_bday_today");
    if (label.kind === "in_days") return t("connections:fs_bday_in_days", { count: label.days });
    let date: string;
    try {
      date = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", timeZone: "UTC" }).format(
        new Date(Date.UTC(2000, label.month - 1, label.day)),
      );
    } catch {
      date = `${label.day}/${label.month}`;
    }
    return t("connections:fs_bday_on", { date });
  };
}

export function FriendsManagementList({
  friends,
  loading,
  mutedUserIds,
  currentUserId,
  pairedPills,
  pairTile,
  onPairTile,
  onOpenPaired,
  onAvatarPress,
  onMessage,
  onOpenFriendActions,
  blockedCount,
  onOpenBlocked,
}: FriendsManagementListProps): React.ReactElement {
  const { t } = useTranslation(["connections", "social"]);
  const [query, setQuery] = useState("");
  const birthdayText = useBirthdayText();
  const today = useMemo(() => new Date(), []);

  const pairedIds = useMemo(
    () => new Set(pairedPills.map((pill) => pill.pairedUserId).filter((id): id is string => Boolean(id))),
    [pairedPills],
  );
  const sortedFriends = useMemo(
    () =>
      friends
        .filter((friend) => friendMatches(friend, query))
        .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b))),
    [friends, query],
  );
  const searching = query.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.search}>
        <Icon name="search" size={15} color={ink.faint} />
        <BottomSheetTextInput
          placeholder={t("connections:fs_search")}
          placeholderTextColor={ink.faint}
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t("connections:fs_search")}
        />
      </View>

      {searching ? null : (
        <>
          <Text style={styles.label}>{t("connections:fs_paired_label")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pairedRow}>
            {pairedPills.map((pill) => {
              const name = pill.displayName;
              const firstName = name.split(" ")[0] || name;
              const bday = birthdayText(nextBirthdayLabel(pill.birthday, today));
              return (
                <Pressable
                  key={pill.id}
                  onPress={() => pill.pairedUserId && onOpenPaired(pill.pairedUserId)}
                  accessibilityRole="button"
                  accessibilityLabel={t("connections:fs_paired_a11y", { name })}
                  style={styles.pairedTile}
                >
                  <View style={styles.goldRing}>
                    <ChatAvatar people={[{ id: pill.pairedUserId ?? pill.id, name, avatarUrl: pill.avatarUrl }]} shape="circle" label={name} size={58} />
                    <View style={styles.star}>
                      <Text style={styles.starText} allowFontScaling={false}>★</Text>
                    </View>
                  </View>
                  <Text style={styles.pairedName} numberOfLines={1}>{firstName}</Text>
                  {bday ? <Text style={styles.pairedBday} numberOfLines={1}>{bday}</Text> : null}
                </Pressable>
              );
            })}
            <Pressable
              onPress={onPairTile}
              accessibilityRole="button"
              accessibilityLabel={
                pairTile.showFreeCount
                  ? `${t("connections:fs_pair_tile")}, ${t("connections:fs_pair_tile_free", { used: pairTile.used, limit: pairTile.limit })}`
                  : t("connections:fs_pair_tile")
              }
              style={styles.pairedTile}
            >
              <View style={styles.addTile}>
                <Icon name="add" size={24} color={ink.dim} />
              </View>
              <Text style={styles.pairedName}>{t("connections:fs_pair_tile")}</Text>
              {pairTile.showFreeCount ? (
                <Text style={[styles.pairedBday, styles.addTileSub]} numberOfLines={1}>
                  {t("connections:fs_pair_tile_free", { used: pairTile.used, limit: pairTile.limit })}
                </Text>
              ) : null}
            </Pressable>
          </ScrollView>
          <Text style={styles.label}>{t("connections:fs_all_friends")}</Text>
        </>
      )}

      {loading && friends.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator color={ink.accent} />
        </View>
      ) : sortedFriends.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {friends.length === 0 ? t("connections:fs_empty_friends") : t("connections:fs_empty_search")}
          </Text>
        </View>
      ) : (
        sortedFriends.map((friend) => {
          const friendUserId = friendUserIdOf(friend, currentUserId);
          const name = getDisplayName(friend);
          const isPaired = pairedIds.has(friendUserId);
          const isMuted = mutedUserIds.includes(friendUserId);
          const sub = [
            friend.username ? `@${friend.username}` : null,
            isPaired ? t("connections:fs_paired_suffix") : null,
          ].filter(Boolean).join(" · ");
          return (
            <View key={friend.id} style={styles.row}>
              <Pressable
                onPress={() => onAvatarPress(friendUserId)}
                accessibilityRole="button"
                accessibilityLabel={name}
                hitSlop={4}
              >
                <ChatAvatar people={[{ id: friendUserId, name, avatarUrl: friend.avatar_url }]} shape="circle" label={name} size={44} />
              </Pressable>
              <View style={styles.rowText}>
                <View style={styles.nameRow}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{name}</Text>
                  {isMuted ? <Icon name="volume-mute" size={13} color={ink.faint} /> : null}
                </View>
                {sub ? <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text> : null}
              </View>
              <Pressable
                onPress={() => onMessage(friend)}
                accessibilityRole="button"
                accessibilityLabel={t("connections:fs_message_a11y", { name })}
                hitSlop={6}
                style={styles.mini}
              >
                <Icon name="chatbubble-outline" size={16} color={ink.ink} />
              </Pressable>
              <Pressable
                onPress={() => onOpenFriendActions(friend)}
                accessibilityRole="button"
                accessibilityLabel={t("connections:fs_more_a11y", { name })}
                hitSlop={6}
                style={styles.mini}
              >
                <Icon name="ellipsis-horizontal" size={16} color={ink.ink} />
              </Pressable>
            </View>
          );
        })
      )}

      <Pressable
        onPress={onOpenBlocked}
        accessibilityRole="button"
        accessibilityLabel={`${t("connections:fs_blocked_row")}, ${blockedCount}`}
        style={styles.blockedRow}
      >
        <Text style={styles.blockedText}>{t("connections:fs_blocked_row")}</Text>
        <Text style={styles.blockedText}>{blockedCount} ›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingBottom: 32,
  },
  search: {
    height: 36,
    borderRadius: 10,
    backgroundColor: ink.searchBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: ink.ink,
    fontSize: 14,
    paddingVertical: 0,
  },
  label: {
    color: ink.faint,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingTop: 12,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  pairedRow: {
    gap: 14,
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 6,
  },
  pairedTile: {
    width: 66,
    alignItems: "center",
    gap: 5,
  },
  goldRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2,
    borderColor: fs.gold,
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  star: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: fs.gold,
    borderWidth: 2.5,
    borderColor: fs.sheetBg,
    alignItems: "center",
    justifyContent: "center",
  },
  starText: {
    color: fs.goldInk,
    fontSize: 10,
    fontWeight: "900",
  },
  pairedName: {
    color: ink.ink,
    fontSize: 12,
    fontWeight: "600",
    maxWidth: 66,
  },
  pairedBday: {
    color: fs.goldLabel,
    fontSize: 10.5,
    fontWeight: "600",
    marginTop: -4,
  },
  addTile: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: fs.addTileBg,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: fs.addTileBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  addTileSub: {
    color: ink.faint,
  },
  row: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowTitle: {
    flexShrink: 1,
    color: ink.ink,
    fontSize: 15.5,
    fontWeight: "600",
  },
  rowSub: {
    color: ink.faint,
    fontSize: 12.5,
    marginTop: 1,
  },
  mini: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: fs.miniButtonBg,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyText: {
    color: ink.dim,
    fontSize: 14,
    textAlign: "center",
  },
  blockedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: fs.hairline,
  },
  blockedText: {
    color: ink.dim,
    fontSize: 14.5,
  },
});
