/**
 * #4255 W5 — the Mingla team "M" in the Host app top bar (between the chat
 * bubble and the bell) and the one staff check every team surface uses
 * (team_badge). Its own small lazy chunk: TopBar, the Notifications screen and
 * the team screens all reach it through import(), so none of it joins the
 * bundle every screen loads. Hosts who are not staff get staff:false and see
 * nothing. Badge: unread team chats plus unread mentions, capped at 9+.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { canvas, semantic, text as textTokens, typography } from "../../constants/designSystem";
import { teamChatKey } from "../../hooks/useBusinessNotifications";
import { useBusinessMediaTranslation } from "../../i18n";
import { supabase } from "../../services/supabase";

export interface TeamBadge {
  staff: boolean;
  /** #4255 fix-up: an owner or admin (team_chat_admin): may mention everyone. */
  admin: boolean;
  chats: number;
  messages: number;
  mentions: number;
  total: number;
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The icon badge: unread team chats plus unread mentions; nothing for non-staff. */
export function teamBadgeCount(badge: Partial<TeamBadge> | null | undefined): number {
  if (!badge || badge.staff !== true) return 0;
  return count(badge.chats) + count(badge.mentions);
}

/** staff:false (never an error) for a signed-in host who is not staff; zeros for them. */
export async function fetchTeamBadge(): Promise<TeamBadge> {
  const { data, error } = await supabase.rpc("team_badge");
  if (error) throw new Error(error.message || "Couldn't check Mingla team.");
  const row = (data ?? {}) as Partial<TeamBadge>;
  const staff = row.staff === true;
  return {
    staff,
    admin: staff && row.admin === true,
    chats: staff ? count(row.chats) : 0,
    messages: staff ? count(row.messages) : 0,
    mentions: staff ? count(row.mentions) : 0,
    total: staff ? count(row.total) : 0,
  };
}

/** The top bar slot: nothing until team_badge says staff, then the M. */
export default function MinglaTeamSlot({ userId }: { userId: string }): React.ReactElement | null {
  const router = useRouter();
  const { t } = useBusinessMediaTranslation();
  const badge = useQuery({
    queryKey: teamChatKey(userId, "badge"),
    queryFn: fetchTeamBadge,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
  if (badge.data?.staff !== true) return null;
  const unread = teamBadgeCount(badge.data);
  return (
    <Pressable
      onPress={() => router.push("/team" as never)}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? t("team_icon.label_unread", { n: unread }) : t("team_icon.label")}
      hitSlop={4}
      style={styles.button}
      testID="topbar-mingla-team"
    >
      <Text style={styles.mark}>M</Text>
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel} numberOfLines={1}>{unread > 9 ? "9+" : String(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A solid chip: the one filled icon in the cluster, so staff can tell the
  // team space from the brand's own Messages at a glance.
  button: { width: 36, height: 36, borderRadius: 18, backgroundColor: textTokens.primary, alignItems: "center", justifyContent: "center" },
  mark: { color: canvas.discover, fontSize: 16, lineHeight: 20, fontWeight: "800" },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: semantic.error, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  badgeLabel: { color: textTokens.inverse, fontSize: typography.micro.fontSize, lineHeight: typography.micro.lineHeight, fontWeight: typography.micro.fontWeight },
});
