/**
 * #4255 W5 — Mingla team in the Host app (rev 3 "Host app: Mingla team",
 * design contract v7 section 3): the chat list and Mentions, a new chat or
 * group, the staff-only settings group, and the screen a host who is not
 * staff sees. The thread lives in TeamThreadScreen.
 *
 * Every team route and the settings group load this one module lazily, so
 * none of it joins the bundle every Host app screen loads. Staff only: the
 * database refuses everyone else; these screens just say so kindly.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { accent, radius, spacing } from "../../constants/designSystem";
import { teamChatKey } from "../../hooks/useBusinessNotifications";
import { supabase } from "../../services/supabase";
import {
  addTeamMembers,
  createTeamGroup,
  markTeamMentionRead,
  openOutside,
  openTeamDm,
  teamAdminUrl,
  type TeamMention,
  type TeamPerson,
  type TeamThread,
} from "../../services/teamChatService";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { Toast } from "../ui/Toast";
import { teamTime, useTeamText, type TeamT } from "./teamText";
import { PersonAvatar, TeamAccessGate, TeamAvatar, TeamHeader, useBack } from "./TeamCommon";
import { useTeamMentions, useTeamPeople, useTeamRealtime, useTeamThreads } from "./useTeamChat";

import { TeamThreadScreen } from "./TeamThreadScreen";
export { TeamLockedScreen } from "./TeamCommon";

function threadPreview(thread: TeamThread, t: TeamT): string {
  const last = thread.last_message;
  if (!last) return t("team.no_messages");
  const words = last.preview === "Photo" ? t("team.preview_photo") : last.preview === "Document" ? t("team.preview_document") : last.preview === "Link" ? t("team.preview_link") : last.preview ?? "";
  return `${last.author_name}: ${words}`;
}

function ThreadRow({ thread, onOpen }: { thread: TeamThread; onOpen: () => void }): React.ReactElement {
  const { t, language } = useTeamText();
  const unread = thread.unread > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? t("team.thread_a11y_unread", { name: thread.title, count: thread.unread }) : thread.title}
      onPress={onOpen}
      style={({ pressed }) => [styles.threadRow, pressed && styles.pressed]}
      testID={`team-thread-${thread.id}`}
    >
      <TeamAvatar thread={thread} />
      <View style={styles.threadCopy}>
        <View style={styles.threadTop}>
          <Text style={[styles.threadName, unread && styles.bold]} numberOfLines={1}>{thread.title}</Text>
          {thread.kind !== "dm" ? <Text style={styles.memberCount}>{thread.member_count}</Text> : null}
          {thread.muted ? <Icon name="volumeOff" size={13} color={brandGroupChat.textMuted} /> : null}
        </View>
        <Text style={[styles.threadPreview, unread && styles.threadPreviewUnread]} numberOfLines={1}>{threadPreview(thread, t)}</Text>
      </View>
      <View style={styles.threadMeta}>
        <Text style={styles.threadTime}>{teamTime(thread.last_message?.at ?? thread.last_message_at, language)}</Text>
        {unread ? <View style={styles.unreadPill}><Text style={styles.unreadPillText}>{thread.unread > 99 ? "99+" : thread.unread}</Text></View> : null}
      </View>
    </Pressable>
  );
}

// ── Mingla team: Chats and Mentions ─────────────────────────────────────────

export function mentionKindLabel(mention: Pick<TeamMention, "kind" | "action">, t: TeamT): string {
  if (mention.kind === "mention") return t("team.kind_mention");
  if (mention.action === "decision" || mention.action === "approval_requested") return t("team.kind_decision");
  if (mention.kind === "work_update") return t("team.kind_update");
  return t("team.kind_update");
}

function MentionCard({ mention, highlighted, onOpen }: { mention: TeamMention; highlighted: boolean; onOpen: () => void }): React.ReactElement {
  const { t, language } = useTeamText();
  const unread = mention.read_at === null;
  return (
    <View style={[styles.mentionCard, highlighted && styles.mentionCardHighlighted]} testID={`team-mention-${mention.id}`}>
      <View style={styles.mentionTop}>
        <View style={[styles.dot, unread && styles.dotUnread]} />
        <Text style={styles.kindLabel}>{mentionKindLabel(mention, t)}</Text>
        <Text style={styles.mentionWho} numberOfLines={1}>{`${mention.actor_name} · ${teamTime(mention.created_at, language)}`}</Text>
      </View>
      {mention.body_excerpt ? <Text style={[styles.mentionQuote, unread && styles.bold]}>{mention.body_excerpt}</Text> : null}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t("team.open_admin")}
        onPress={onOpen}
        style={({ pressed }) => [styles.openAdmin, pressed && styles.pressed]}
        testID={`team-open-admin-${mention.id}`}
      >
        <Text style={styles.openAdminText}>{t("team.open_admin")}</Text>
        <Icon name="externalLink" size={14} color={brandGroupChat.mineText} />
      </Pressable>
    </View>
  );
}

/**
 * The one Mingla team route (/team): the chat list and Mentions, a chat
 * (?thread=<id>), or a new chat, group or added people (?compose=chat|group|add).
 * One route keeps the router's list in the boot bundle short.
 */
export function TeamScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ thread?: string; compose?: string }>();
  if (typeof params.compose === "string") return <TeamAccessGate>{(userId) => <TeamNewChat userId={userId} />}</TeamAccessGate>;
  if (typeof params.thread === "string") return <TeamThreadScreen />;
  return <TeamAccessGate>{(userId) => <TeamHome userId={userId} />}</TeamAccessGate>;
}

function TeamHome({ userId }: { userId: string }): React.ReactElement {
  const { t } = useTeamText();
  const router = useRouter();
  const back = useBack();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string; mention?: string }>();
  const [tab, setTab] = useState<"chats" | "mentions">(params.tab === "mentions" ? "mentions" : "chats");
  const [find, setFind] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (params.tab === "mentions") setTab("mentions"); }, [params.tab, params.mention]);

  const threads = useTeamThreads(userId, true);
  const mentions = useTeamMentions(userId, true);
  const people = useTeamPeople(userId, find.trim().length > 0);
  useTeamRealtime(userId, null, true);

  const list = threads.data?.threads ?? [];
  const unreadChats = list.filter((x) => x.unread > 0).length;
  const unreadMentions = (mentions.data ?? []).filter((m) => m.read_at === null).length;
  const query = find.trim().toLowerCase();
  const shownThreads = query ? list.filter((x) => x.title.toLowerCase().includes(query)) : list;
  const dmWith = new Set(list.filter((x) => x.kind === "dm").map((x) => x.other_user_id));
  const shownPeople = query ? (people.data ?? []).filter((p) => !p.me && !dmWith.has(p.user_id) && p.name.toLowerCase().includes(query)) : [];

  const dm = useMutation({
    mutationFn: (person: TeamPerson) => openTeamDm(person.user_id),
    onSuccess: (thread) => {
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "threads") });
      setFind("");
      router.push(`/team?thread=${thread.id}` as never);
    },
    onError: (error) => setToast(error instanceof Error ? error.message : t("team.try_again")),
  });

  const openMention = useCallback(async (mention: TeamMention) => {
    try {
      await openOutside(teamAdminUrl(mention));
    } catch {
      setToast(t("team.open_admin_failed"));
      return;
    }
    if (mention.read_at !== null) return;
    try {
      await markTeamMentionRead(mention.id);
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "mentions") });
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "badge") });
    } catch (error) {
      setToast(error instanceof Error ? error.message : t("team.try_again"));
    }
  }, [queryClient, t, userId]);

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen} testID="team-home">
      <TeamHeader
        title={t("team.title")}
        onBack={back}
        right={(
          <Pressable accessibilityRole="button" accessibilityLabel={t("team.settings")} onPress={() => router.push("/account/notifications" as never)} hitSlop={6} style={styles.iconButton} testID="team-settings">
            <Icon name="settings" size={19} color={brandGroupChat.textPrimary} />
          </Pressable>
        )}
      />
      <View style={styles.segment} accessibilityRole="tablist">
        {(["chats", "mentions"] as const).map((key) => {
          const n = key === "chats" ? unreadChats : unreadMentions;
          const label = key === "chats" ? t("team.tab_chats") : t("team.tab_mentions");
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              accessibilityLabel={n ? `${label}, ${n}` : label}
              onPress={() => setTab(key)}
              style={[styles.segmentButton, tab === key && styles.segmentButtonOn]}
              testID={`team-tab-${key}`}
            >
              <Text style={[styles.segmentText, tab === key && styles.segmentTextOn]}>{n ? `${label} · ${n}` : label}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === "chats" ? (
        <ScrollView style={styles.flex} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
          <View style={styles.findRow}>
            <TextInput
              value={find}
              onChangeText={setFind}
              placeholder={t("team.find_placeholder")}
              placeholderTextColor={brandGroupChat.textMuted}
              style={styles.findInput}
              accessibilityLabel={t("team.find_placeholder")}
              autoCorrect={false}
              testID="team-find"
            />
            <Pressable accessibilityRole="button" accessibilityLabel={t("team.new_group")} onPress={() => router.push("/team?compose=group" as never)} style={styles.chipButton} testID="team-new-group">
              <Text style={styles.chipButtonText}>{t("team.new_group")}</Text>
            </Pressable>
          </View>
          {threads.isPending ? (
            <View style={styles.state}><ActivityIndicator color={accent.warm} accessibilityLabel={t("team.loading")} /></View>
          ) : threads.isError ? (
            <View style={styles.state}>
              <Text style={styles.stateText}>{threads.error instanceof Error ? threads.error.message : t("team.load_failed")}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t("team.retry")} onPress={() => void threads.refetch()} style={styles.chipButton}>
                <Text style={styles.chipButtonText}>{t("team.retry")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {shownThreads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} onOpen={() => router.push(`/team?thread=${thread.id}` as never)} />
              ))}
              {shownPeople.map((person) => (
                <Pressable
                  key={person.user_id}
                  accessibilityRole="button"
                  accessibilityLabel={person.name}
                  disabled={dm.isPending}
                  onPress={() => dm.mutate(person)}
                  style={({ pressed }) => [styles.threadRow, pressed && styles.pressed]}
                >
                  <PersonAvatar name={person.name} id={person.user_id} size={38} />
                  <View style={styles.threadCopy}>
                    <Text style={styles.threadName} numberOfLines={1}>{person.name}</Text>
                    <Text style={styles.threadPreview} numberOfLines={1}>{t("team.direct_message")}</Text>
                  </View>
                  {dm.isPending && dm.variables?.user_id === person.user_id ? <ActivityIndicator color={accent.warm} /> : null}
                </Pressable>
              ))}
              {query && people.isPending ? <View style={styles.state}><ActivityIndicator color={accent.warm} /></View> : null}
              {shownThreads.length === 0 && shownPeople.length === 0 && !(query && people.isPending) ? (
                <View style={styles.state}><Text style={styles.stateText}>{query ? t("team.find_none", { query: find.trim() }) : t("team.empty_chats")}</Text></View>
              ) : null}
              <Text style={styles.footnote}>{t("team.sync_note")}</Text>
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.listContent}>
          {mentions.isPending ? (
            <View style={styles.state}><ActivityIndicator color={accent.warm} accessibilityLabel={t("team.loading")} /></View>
          ) : mentions.isError ? (
            <View style={styles.state}>
              <Text style={styles.stateText}>{mentions.error instanceof Error ? mentions.error.message : t("team.load_failed")}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t("team.retry")} onPress={() => void mentions.refetch()} style={styles.chipButton}>
                <Text style={styles.chipButtonText}>{t("team.retry")}</Text>
              </Pressable>
            </View>
          ) : (mentions.data ?? []).length === 0 ? (
            <View style={styles.state}><Text style={styles.stateText}>{t("team.empty_mentions")}</Text></View>
          ) : (
            (mentions.data ?? []).map((mention) => (
              <MentionCard key={mention.id} mention={mention} highlighted={params.mention === mention.id} onOpen={() => void openMention(mention)} />
            ))
          )}
          <Text style={styles.footnote}>{t("team.mentions_note")}</Text>
        </ScrollView>
      )}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast visible={toast !== null} kind="error" message={toast ?? ""} onDismiss={() => setToast(null)} />
      </View>
    </SafeScreen>
  );
}

// ── New chat or group ───────────────────────────────────────────────────────

function TeamNewChat({ userId }: { userId: string }): React.ReactElement {
  const { t } = useTeamText();
  const router = useRouter();
  const back = useBack("/team");
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ compose?: string; thread?: string }>();
  const mode: "chat" | "group" | "add" = params.compose === "group" ? "group" : params.compose === "add" && typeof params.thread === "string" ? "add" : "chat";
  const group = mode !== "chat";
  const people = useTeamPeople(userId, true);
  const [name, setName] = useState("");
  const [find, setFind] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const others = useMemo(() => (people.data ?? []).filter((p) => !p.me && p.name.toLowerCase().includes(find.trim().toLowerCase())), [find, people.data]);

  const create = useMutation({
    mutationFn: async (ids: string[]): Promise<string> => {
      if (mode === "add") { await addTeamMembers(params.thread as string, ids); return params.thread as string; }
      return (mode === "group" ? await createTeamGroup(name.trim(), ids) : await openTeamDm(ids[0])).id;
    },
    onSuccess: (threadId) => {
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "threads") });
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "messages", threadId) });
      if (mode === "add") back();
      else router.replace(`/team?thread=${threadId}` as never);
    },
    onError: (error) => setToast(error instanceof Error ? error.message : t("team.try_again")),
  });

  const choose = (person: TeamPerson): void => {
    if (!group) {
      if (!create.isPending) create.mutate([person.user_id]);
      return;
    }
    setPicked((current) => (current.includes(person.user_id) ? current.filter((id) => id !== person.user_id) : [...current, person.user_id]));
  };
  const canCreate = !create.isPending && (mode === "add" ? picked.length > 0 : name.trim().length > 0 && name.trim().length <= 80);
  const title = mode === "group" ? t("team.new_group_title") : mode === "add" ? t("team.add_people") : t("team.new_chat_title");
  const action = mode === "add" ? t("team.add_count", { n: picked.length }) : picked.length ? t("team.create_group_count", { n: picked.length }) : t("team.create_group");

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen} testID="team-new">
      <TeamHeader title={title} onBack={back} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {mode === "group" ? (
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={80}
            placeholder={t("team.group_name")}
            placeholderTextColor={brandGroupChat.textMuted}
            style={styles.findInput}
            accessibilityLabel={t("team.group_name")}
            testID="team-group-name"
          />
        ) : null}
        <TextInput
          value={find}
          onChangeText={setFind}
          placeholder={t("team.find_teammate")}
          placeholderTextColor={brandGroupChat.textMuted}
          style={[styles.findInput, styles.findGap]}
          accessibilityLabel={t("team.find_teammate")}
          autoCorrect={false}
        />
        {people.isPending ? (
          <View style={styles.state}><ActivityIndicator color={accent.warm} accessibilityLabel={t("team.loading")} /></View>
        ) : people.isError ? (
          <View style={styles.state}>
            <Text style={styles.stateText}>{people.error instanceof Error ? people.error.message : t("team.load_failed")}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("team.retry")} onPress={() => void people.refetch()} style={styles.chipButton}>
              <Text style={styles.chipButtonText}>{t("team.retry")}</Text>
            </Pressable>
          </View>
        ) : others.length === 0 ? (
          <View style={styles.state}><Text style={styles.stateText}>{t("team.no_teammates")}</Text></View>
        ) : others.map((person) => {
          const on = picked.includes(person.user_id);
          return (
            <Pressable
              key={person.user_id}
              accessibilityRole={group ? "checkbox" : "button"}
              accessibilityState={group ? { checked: on } : undefined}
              accessibilityLabel={group ? person.name : person.name}
              onPress={() => choose(person)}
              style={({ pressed }) => [styles.threadRow, pressed && styles.pressed]}
            >
              <PersonAvatar name={person.name} id={person.user_id} size={36} />
              <View style={styles.threadCopy}><Text style={styles.threadName} numberOfLines={1}>{person.name}</Text></View>
              {group ? <View style={[styles.check, on && styles.checkOn]}>{on ? <Icon name="check" size={14} color={brandGroupChat.mineText} /> : null}</View> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {group ? (
        <View style={styles.footerBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            accessibilityState={{ disabled: !canCreate, busy: create.isPending }}
            disabled={!canCreate}
            onPress={() => create.mutate(picked)}
            style={[styles.primaryButton, !canCreate && styles.disabled]}
            testID="team-create-group"
          >
            {create.isPending ? <ActivityIndicator color={brandGroupChat.mineText} /> : <Text style={styles.primaryButtonText}>{action}</Text>}
          </Pressable>
        </View>
      ) : null}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast visible={toast !== null} kind="error" message={toast ?? ""} onDismiss={() => setToast(null)} />
      </View>
    </SafeScreen>
  );
}

// ── Settings: the staff-only group on the Notifications screen ──────────────

// #4255 fix-up: direct messages and group messages are switched apart
// (business.team_message, business.team_group_message). A group message only
// ever pushes (team chat lives in Mingla team, never the bell), so its row has
// a push switch alone.
type TeamPrefChannel = "inapp" | "push";
export const TEAM_PREF_ROWS: readonly {
  key: "business.team_mention" | "business.team_decision" | "business.team_message" | "business.team_group_message";
  label: "team.pref_mentions" | "team.pref_decisions" | "team.pref_messages" | "team.pref_group_messages";
  hint: "team.pref_mentions_hint" | "team.pref_decisions_hint" | "team.pref_messages_hint" | "team.pref_group_messages_hint";
  channels: readonly TeamPrefChannel[];
}[] = [
  { key: "business.team_mention", label: "team.pref_mentions", hint: "team.pref_mentions_hint", channels: ["inapp", "push"] },
  { key: "business.team_decision", label: "team.pref_decisions", hint: "team.pref_decisions_hint", channels: ["inapp", "push"] },
  { key: "business.team_message", label: "team.pref_messages", hint: "team.pref_messages_hint", channels: ["inapp", "push"] },
  { key: "business.team_group_message", label: "team.pref_group_messages", hint: "team.pref_group_messages_hint", channels: ["push"] },
];
type TeamPrefKey = (typeof TEAM_PREF_ROWS)[number]["key"];
interface TeamPrefRow { category_key: string; channel: string; enabled: boolean }

/**
 * Whether a switch is on. No row means the category's default: in-app and
 * push on, except group message pushes, which stay off until switched on
 * (a group pushes only on a mention; team_chat_enqueue).
 */
export function teamPrefOn(rows: readonly TeamPrefRow[], key: TeamPrefKey, channel: TeamPrefChannel): boolean {
  const row = rows.find((r) => r.category_key === key && r.channel === channel);
  if (row) return row.enabled;
  return key !== "business.team_group_message";
}

/** One set of settings for Admin and the Host app: notification_channel_prefs. */
export function TeamNotificationPrefs({ userId }: { userId: string }): React.ReactElement {
  const { t } = useTeamText();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const prefs = useQuery({
    queryKey: teamChatKey(userId, "prefs"),
    queryFn: async (): Promise<TeamPrefRow[]> => {
      const { data, error } = await supabase
        .from("notification_channel_prefs")
        .select("category_key, channel, enabled")
        .eq("user_id", userId)
        .in("category_key", TEAM_PREF_ROWS.map((r) => r.key));
      if (error) throw new Error(error.message || t("team.load_failed"));
      return (data ?? []) as TeamPrefRow[];
    },
    staleTime: 60 * 1000,
  });
  const save = useMutation({
    mutationFn: async ({ key, channel, on }: { key: TeamPrefKey; channel: TeamPrefChannel; on: boolean }): Promise<void> => {
      // Group message pushes off = back to the default (mentions only).
      const result = key === "business.team_group_message" && channel === "push" && !on
        ? await supabase.from("notification_channel_prefs").delete().eq("user_id", userId).eq("category_key", key).eq("channel", channel)
        : await supabase.from("notification_channel_prefs").upsert({ user_id: userId, category_key: key, channel, enabled: on, updated_at: new Date().toISOString() });
      if (result.error) throw new Error(result.error.message || t("team.save_failed"));
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "prefs") }); },
    onError: () => setToast(t("team.save_failed")),
  });
  const rows = prefs.data ?? [];
  const busy = prefs.isPending || save.isPending;
  return (
    <View style={styles.prefsCard} testID="team-prefs">
      <Text style={styles.prefsTitle}>{t("team.prefs_title")}</Text>
            {prefs.isError ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("team.retry")} onPress={() => void prefs.refetch()} style={styles.chipButton}>
          <Text style={styles.chipButtonText}>{t("team.load_failed")}</Text>
        </Pressable>
      ) : null}
      <View style={styles.prefsHead}>
        <Text style={styles.prefsHeadLabel} />
        <Text style={styles.prefsCol}>{t("team.col_inapp")}</Text>
        <Text style={styles.prefsCol}>{t("team.col_push")}</Text>
      </View>
      {TEAM_PREF_ROWS.map((row) => (
        <View key={row.key} style={styles.prefsRow}>
          <View style={styles.flex}>
            <Text style={styles.prefsLabel}>{t(row.label)}</Text>
            <Text style={styles.prefsRowHint}>{t(row.hint)}</Text>
          </View>
          {(["inapp", "push"] as const).map((channel) => {
            if (!row.channels.includes(channel)) return <View key={channel} style={styles.prefsSwitch} testID={`team-pref-${row.key}-${channel}-none`} />;
            const on = teamPrefOn(rows, row.key, channel);
            return (
              <View key={channel} style={styles.prefsSwitch}>
                <Switch
                  value={on}
                  disabled={busy || prefs.isError}
                  onValueChange={(next) => save.mutate({ key: row.key, channel, on: next })}
                  trackColor={{ false: "rgba(255, 255, 255, 0.12)", true: accent.warm }}
                  thumbColor="#ffffff"
                  accessibilityLabel={`${t(row.label)}: ${channel === "push" ? t("team.col_push") : t("team.col_inapp")}`}
                  accessibilityState={{ checked: on, disabled: busy }}
                  testID={`team-pref-${row.key}-${channel}`}
                />
              </View>
            );
          })}
        </View>
      ))}
      <Text style={styles.footnote}>{t("team.prefs_sync")}</Text>
      {toast ? (
        <Pressable accessibilityRole="button" accessibilityLabel={toast} onPress={() => setToast(null)}>
          <Text style={styles.prefsError}>{toast}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: brandGroupChat.screenBg },
  flex: { flex: 1 },
  header: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  headerTitle: { flex: 1, color: brandGroupChat.textPrimary, fontSize: 17, fontWeight: "700" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  bold: { fontWeight: "700", color: brandGroupChat.textPrimary },
  disabled: { opacity: 0.45 },
  state: { padding: spacing.lg, alignItems: "center", justifyContent: "center", gap: spacing.md },
  stateText: { color: brandGroupChat.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" },
  locked: { margin: spacing.lg, marginTop: spacing.xl, gap: spacing.sm, alignItems: "center" },
  lockedTitle: { color: brandGroupChat.textPrimary, fontSize: 17, fontWeight: "700", textAlign: "center" },
  lockedBody: { color: brandGroupChat.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: spacing.sm },
  chipButton: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surfaceRaised, alignItems: "center", justifyContent: "center" },
  chipButtonText: { color: brandGroupChat.textPrimary, fontSize: 13, fontWeight: "600" },
  segment: { flexDirection: "row", margin: spacing.md, marginBottom: spacing.sm, padding: 3, gap: 3, borderRadius: radius.md, backgroundColor: brandGroupChat.surface },
  segmentButton: { flex: 1, minHeight: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  segmentButtonOn: { backgroundColor: brandGroupChat.surfaceRaised },
  segmentText: { color: brandGroupChat.textSecondary, fontSize: 13, fontWeight: "500" },
  segmentTextOn: { color: brandGroupChat.textPrimary, fontWeight: "700" },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.xs },
  findRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  findInput: { flex: 1, minHeight: 40, borderRadius: radius.md, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface, color: brandGroupChat.textPrimary, paddingHorizontal: spacing.md, fontSize: 14 },
  findGap: { marginTop: spacing.sm, marginBottom: spacing.sm, flex: 0 },
  threadRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  threadCopy: { flex: 1, minWidth: 0, gap: 2 },
  threadTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  threadName: { flexShrink: 1, color: brandGroupChat.textPrimary, fontSize: 15, fontWeight: "600" },
  memberCount: { color: brandGroupChat.textMuted, fontSize: 12 },
  threadPreview: { color: brandGroupChat.textSoft, fontSize: 13 },
  threadPreviewUnread: { color: brandGroupChat.textSecondary },
  threadMeta: { alignItems: "flex-end", gap: 4 },
  threadTime: { color: brandGroupChat.textMuted, fontSize: 12 },
  unreadPill: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: accent.warm, alignItems: "center", justifyContent: "center" },
  unreadPillText: { color: brandGroupChat.mineText, fontSize: 11, fontWeight: "700" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  avatarTextTeam: { color: brandGroupChat.screenBg, fontWeight: "800" },
  footnote: { color: brandGroupChat.textMuted, fontSize: 12, lineHeight: 17, paddingVertical: spacing.md },
  mentionCard: { borderRadius: radius.md, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  mentionCardHighlighted: { borderColor: accent.warm },
  mentionTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "transparent" },
  dotUnread: { backgroundColor: accent.warm },
  kindLabel: { color: brandGroupChat.mentionText, backgroundColor: brandGroupChat.mentionBg, fontSize: 11, fontWeight: "700", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  mentionWho: { flex: 1, color: brandGroupChat.textSoft, fontSize: 12 },
  mentionQuote: { color: brandGroupChat.textSecondary, fontSize: 14, lineHeight: 20 },
  openAdmin: { minHeight: 38, borderRadius: radius.sm, backgroundColor: brandGroupChat.textPrimary, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  openAdminText: { color: brandGroupChat.mineText, fontSize: 14, fontWeight: "700" },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: brandGroupChat.textMuted, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: accent.warm, borderColor: accent.warm },
  footerBar: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: brandGroupChat.hairline },
  primaryButton: { minHeight: 48, borderRadius: radius.full, backgroundColor: accent.warm, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: brandGroupChat.mineText, fontSize: 15, fontWeight: "700" },
  toastWrap: { position: "absolute", top: 80, left: 0, right: 0, zIndex: 100, elevation: 12 },
  prefsCard: { borderRadius: radius.md, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface, padding: spacing.md, gap: spacing.xs },
  prefsTitle: { color: brandGroupChat.textPrimary, fontSize: 15, fontWeight: "700" },
  prefsHint: { color: brandGroupChat.textSoft, fontSize: 12, lineHeight: 16, marginBottom: spacing.xs },
  prefsHead: { flexDirection: "row", alignItems: "center", paddingTop: spacing.xs },
  prefsHeadLabel: { flex: 1 },
  prefsCol: { width: 64, textAlign: "center", color: brandGroupChat.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.6 },
  prefsRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: brandGroupChat.hairline },
  prefsLabel: { color: brandGroupChat.textPrimary, fontSize: 14, fontWeight: "600" },
  prefsRowHint: { color: brandGroupChat.textSoft, fontSize: 12, lineHeight: 16 },
  prefsSwitch: { width: 64, alignItems: "center" },
  prefsError: { color: accent.warm, fontSize: 13, paddingTop: spacing.xs },
});
