/**
 * #4255 W5 — one Mingla team chat (the Mingla team group, a group or a DM):
 * messages, replies, reactions, edit and delete your own, @mentions
 * (@everyone in groups, owner and admins only: the database refuses anyone
 * else), photos, documents and links (rev 4), marked read as you read it,
 * live through realtime.
 *
 * Files follow rev 4: refused over 25 MB before upload, uploaded to the path
 * the database issued in team-files, posted only once every upload is done;
 * a failed upload keeps the words and shows Retry on its chip.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { brandGroupChat } from "../../constants/brandGroupChatTokens";
import { accent, radius, spacing } from "../../constants/designSystem";
import { teamChatKey } from "../../hooks/useBusinessNotifications";
import type { BrandGroupMediaRow } from "../../services/brandGroupMediaService";
import {
  addTeamFile,
  addTeamLink,
  checkTeamFile,
  deleteTeamMessage,
  editTeamMessage,
  markTeamRead,
  muteTeamThread,
  normalizeTeamLink,
  openOutside,
  postTeamMessage,
  reactTeamMessage,
  removeTeamMember,
  renameTeamGroup,
  signTeamAttachment,
  teamLinkLabel,
  TEAM_MAX_ATTACHMENTS,
  TEAM_MAX_MESSAGE_CHARS,
  TEAM_PICK_OPTIONS,
  uploadTeamFile,
  type TeamAttachment,
  type TeamCheckedFile,
  type TeamMember,
  type TeamMessage,
} from "../../services/teamChatService";
import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView";
import { DONE_BAR_OCCUPIED, ScrollView } from "../../wrappers/SmartScrollView";
import { liftedBottomSpacer } from "../../wrappers/keyboardClearance";
import { useKeyboardHeight } from "../../wrappers/useKeyboardHeight";
import { BrandGroupFileUploadSheet } from "../messages/BrandGroupFileUploadSheet";
import type { BrandGroupPickedFile } from "../messages/brandGroupFilePickerShared";
import type { ViewerRequest } from "../media/MediaViewer";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { Toast } from "../ui/Toast";
import { PersonAvatar, TeamAccessGate, TeamAvatar } from "./TeamCommon";
import { teamTime, useTeamText, type TeamT } from "./teamText";
import { useTeamMessages, useTeamRealtime } from "./useTeamChat";

const LazyMediaViewer = React.lazy(async () => {
  const module = await import("../media/MediaViewer");
  return { default: module.MediaViewer };
});

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🙏", "👀"];

export interface TeamTrayItem {
  key: string;
  kind: "image" | "document" | "link";
  name: string;
  status: "uploading" | "ready" | "failed";
  progress: number;
  error: string | null;
  attachmentId: string | null;
  path: string | null;
  file: TeamCheckedFile | null;
  url: string | null;
  previewUri: string | null;
}

function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Which mentions the words still carry, and whether they mention everyone. */
export function mentionsInBody(body: string, picked: ReadonlyMap<string, string>, allowEveryone: boolean): { ids: string[]; everyone: boolean } {
  const ids: string[] = [];
  for (const [name, id] of picked) {
    if (body.includes(`@${name}`) && !ids.includes(id)) ids.push(id);
  }
  return { ids, everyone: allowEveryone && /(^|\s)@everyone\b/.test(body) };
}

/** Split a message into plain words and highlighted @mentions. */
export function splitMentions(body: string, names: readonly string[]): { text: string; mention: boolean }[] {
  const tokens = [...names.filter((n) => n.trim().length > 0).map((n) => `@${n}`), "@everyone"].sort((a, b) => b.length - a.length);
  const out: { text: string; mention: boolean }[] = [];
  let rest = body;
  while (rest.length > 0) {
    let best = -1;
    let token = "";
    for (const candidate of tokens) {
      const at = rest.indexOf(candidate);
      if (at >= 0 && (best < 0 || at < best)) { best = at; token = candidate; }
    }
    if (best < 0) { out.push({ text: rest, mention: false }); break; }
    if (best > 0) out.push({ text: rest.slice(0, best), mention: false });
    out.push({ text: token, mention: true });
    rest = rest.slice(best + token.length);
  }
  return out;
}

function formatSize(bytes: number | null): string {
  if (!bytes || bytes < 1) return "";
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function docType(name: string): string {
  return (name.split(".").pop() ?? "FILE").toUpperCase().slice(0, 4);
}

export function TeamThreadScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ thread?: string }>();
  const threadId = typeof params.thread === "string" ? params.thread : null;
  return <TeamAccessGate>{(userId) => <TeamThread userId={userId} threadId={threadId} />}</TeamAccessGate>;
}

function TeamImage({ userId, attachment, style }: { userId: string; attachment: TeamAttachment; style: StyleProp<ViewStyle> }): React.ReactElement {
  const signed = useQuery({
    queryKey: teamChatKey(userId, "file", attachment.id),
    queryFn: () => signTeamAttachment(attachment.id),
    staleTime: 4 * 60 * 1000,
  });
  return (
    <View style={[styles.imageBox, style]}>
      {signed.data ? <Image source={{ uri: signed.data }} style={styles.imageFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : signed.isError ? <Icon name="flag" size={18} color={brandGroupChat.textMuted} /> : <ActivityIndicator color={accent.warm} />}
    </View>
  );
}

function TeamThread({ userId, threadId }: { userId: string; threadId: string | null }): React.ReactElement {
  const { t, language } = useTeamText();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const { query, messages, thread, members } = useTeamMessages(userId, threadId, threadId !== null);
  useTeamRealtime(userId, threadId, threadId !== null);

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const [editing, setEditing] = useState<TeamMessage | null>(null);
  const [tray, setTray] = useState<TeamTrayItem[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [renameText, setRenameText] = useState<string | null>(null);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ items: BrandGroupMediaRow[]; index: number } | null>(null);
  const pickedMentions = useRef(new Map<string, string>());
  const requestKey = useRef(newKey());
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const lastRead = useRef<string | null>(null);

  const refresh = useCallback(() => {
    if (!threadId) return;
    void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "messages", threadId) });
    void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "threads") });
    void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "badge") });
  }, [queryClient, threadId, userId]);

  const fail = useCallback((error: unknown, fallback?: string) => {
    setToast(error instanceof Error ? error.message : fallback ?? t("team.try_again"));
  }, [t]);

  // Read as you read it: once per newest message.
  const newestId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!threadId || !thread || lastRead.current === (newestId ?? "empty")) return;
    lastRead.current = newestId ?? "empty";
    void markTeamRead(threadId).then(() => {
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "threads") });
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "badge") });
    }).catch(() => { lastRead.current = null; });
  }, [newestId, queryClient, thread, threadId, userId]);

  const memberNames = useMemo(() => members.map((m) => m.name), [members]);
  const canEveryone = thread !== null && thread.kind !== "dm";

  // @mention suggestions for the word being typed at the end of the box.
  const mentionQuery = /(^|\s)@([^\s@]{0,40})$/.exec(body)?.[2] ?? null;
  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [] as { id: string; name: string }[];
    const q = mentionQuery.toLowerCase();
    const people = members.filter((m: TeamMember) => m.user_id !== userId && m.name.toLowerCase().includes(q)).slice(0, 6).map((m) => ({ id: m.user_id, name: m.name }));
    return canEveryone && "everyone".startsWith(q) ? [{ id: "everyone", name: "everyone" }, ...people] : people;
  }, [canEveryone, members, mentionQuery, userId]);

  const chooseMention = (option: { id: string; name: string }): void => {
    setBody((current) => current.replace(/@([^\s@]{0,40})$/, `@${option.name} `));
    if (option.id !== "everyone") pickedMentions.current.set(option.name, option.id);
  };

  // ── Attachments ───────────────────────────────────────────────────────
  const patch = (key: string, next: Partial<TeamTrayItem>): void => {
    setTray((items) => items.map((item) => (item.key === key ? { ...item, ...next } : item)));
  };

  const upload = useCallback(async (item: TeamTrayItem): Promise<void> => {
    if (!threadId || !item.file) return;
    patch(item.key, { status: "uploading", progress: 0, error: null });
    try {
      let attachmentId = item.attachmentId;
      let path = item.path;
      if (!attachmentId || !path) {
        const added = await addTeamFile(threadId, item.file);
        attachmentId = added.attachment.id;
        path = added.path;
        patch(item.key, { attachmentId, path });
      }
      await uploadTeamFile(threadId, attachmentId, path, item.file, (fraction) => patch(item.key, { progress: fraction }));
      patch(item.key, { status: "ready", progress: 1 });
    } catch (error) {
      patch(item.key, { status: "failed", error: error instanceof Error ? error.message : t("team.try_again") });
    }
  }, [t, threadId]);

  const onPicked = useCallback((files: BrandGroupPickedFile[]) => {
    const room = TEAM_MAX_ATTACHMENTS - tray.length;
    if (room <= 0) { setToast(t("team.too_many_files")); return; }
    const added: TeamTrayItem[] = [];
    for (const file of files.slice(0, room)) {
      try {
        const checked = checkTeamFile(file);
        added.push({ key: newKey(), kind: checked.kind, name: checked.name, status: "uploading", progress: 0, error: null, attachmentId: null, path: null, file: checked, url: null, previewUri: checked.kind === "image" ? file.uri : null });
      } catch (error) {
        fail(error);
      }
    }
    if (files.length > room) setToast(t("team.too_many_files"));
    setTray((items) => [...items, ...added]);
    for (const item of added) void upload(item);
  }, [fail, t, tray.length, upload]);

  const addLink = async (): Promise<void> => {
    if (!threadId) return;
    const url = normalizeTeamLink(linkText);
    if (!url) { setToast(t("team.link_invalid")); return; }
    if (tray.length >= TEAM_MAX_ATTACHMENTS) { setToast(t("team.too_many_files")); return; }
    const label = teamLinkLabel(url);
    const key = newKey();
    setTray((items) => [...items, { key, kind: "link", name: label.name, status: "uploading", progress: 0, error: null, attachmentId: null, path: null, file: null, url, previewUri: null }]);
    setLinkText("");
    setLinkOpen(false);
    try {
      const attachment = await addTeamLink(threadId, url, label.name);
      patch(key, { status: "ready", attachmentId: attachment.id, progress: 1 });
    } catch (error) {
      setTray((items) => items.filter((item) => item.key !== key));
      fail(error);
    }
  };

  // ── Send, edit, delete, react ─────────────────────────────────────────
  const uploading = tray.some((item) => item.status === "uploading");
  const failedUpload = tray.some((item) => item.status === "failed");
  const trimmed = body.trim();
  const canSend = !sending && !uploading && (editing ? trimmed.length > 0 : trimmed.length > 0 || tray.length > 0) && body.length <= TEAM_MAX_MESSAGE_CHARS;

  const send = async (): Promise<void> => {
    if (!threadId || !canSend) return;
    if (failedUpload) { setToast(t("team.retry_first")); return; }
    setSending(true);
    try {
      if (editing) {
        await editTeamMessage(editing.id, body, editing.revision);
        setEditing(null);
      } else {
        const found = mentionsInBody(body, pickedMentions.current, canEveryone);
        await postTeamMessage({
          threadId,
          body,
          mentions: found.ids,
          replyToId: replyTo?.id ?? null,
          attachmentIds: tray.map((item) => item.attachmentId).filter((id): id is string => typeof id === "string"),
          everyone: found.everyone,
          requestKey: requestKey.current,
        });
        requestKey.current = newKey();
        setTray([]);
        setReplyTo(null);
        pickedMentions.current.clear();
      }
      setBody("");
      refresh();
    } catch (error) {
      // The words and the files stay so nothing is lost (Constitution 3).
      fail(error);
      if (error && typeof error === "object" && "stale" in error && (error as { stale: boolean }).stale) refresh();
    } finally {
      setSending(false);
    }
  };

  const remove = (message: TeamMessage): void => {
    const go = (): void => {
      void deleteTeamMessage(message.id, message.revision).then(refresh).catch((error: unknown) => { fail(error); refresh(); });
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(t("team.delete_confirm"))) go();
      return;
    }
    Alert.alert(t("team.delete"), t("team.delete_confirm"), [
      { text: t("team.cancel"), style: "cancel" },
      { text: t("team.delete"), style: "destructive", onPress: go },
    ]);
  };

  const react = (message: TeamMessage, emoji: string): void => {
    setReactingTo(null);
    const on = !message.reactions.some((r) => r.emoji === emoji && r.mine);
    void reactTeamMessage(message.id, emoji, on).then(refresh).catch(fail);
  };

  const openAttachment = (message: TeamMessage, attachment: TeamAttachment): void => {
    if (attachment.kind === "link" && attachment.url) { void openOutside(attachment.url).catch(fail); return; }
    if (attachment.kind === "image") {
      const images = messages.flatMap((m) => m.attachments.filter((a) => a.kind === "image").map((a) => ({ a, m })));
      const items: BrandGroupMediaRow[] = images.map(({ a, m }) => ({
        fileId: a.id, messageId: m.id, name: a.name, mime: a.mime ?? "image/jpeg", sizeBytes: a.size_bytes ?? 0, createdAt: a.created_at,
        senderDisplayName: m.author_name, senderRole: "", kind: "image", durationMs: null, width: a.width, height: a.height, thumbState: "none",
      }));
      setViewer({ items, index: Math.max(0, items.findIndex((item) => item.fileId === attachment.id)) });
      return;
    }
    void signTeamAttachment(attachment.id).then(openOutside).catch(fail);
  };

  const requestFor = useCallback(async (fileId: string): Promise<ViewerRequest> => ({ uri: await signTeamAttachment(fileId), headers: {} }), []);

  // ── Options: mute, rename, add people, leave ──────────────────────────
  const toggleMute = (): void => {
    if (!threadId || !thread) return;
    setOptionsOpen(false);
    void muteTeamThread(threadId, !thread.muted).then(refresh).catch(fail);
  };
  const saveRename = (): void => {
    if (!threadId || !thread || renameText === null) return;
    const next = renameText.trim();
    setRenameText(null);
    setOptionsOpen(false);
    if (!next || next === thread.title) return;
    void renameTeamGroup(threadId, next, thread.revision).then(refresh).catch((error: unknown) => { fail(error); refresh(); });
  };
  const leave = (): void => {
    if (!threadId) return;
    setOptionsOpen(false);
    void removeTeamMember(threadId, userId).then(() => {
      void queryClient.invalidateQueries({ queryKey: teamChatKey(userId, "threads") });
      router.replace("/team" as never);
    }).catch(fail);
  };

  const back = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/team" as never);
  };

  const subtitle = !thread ? "" : thread.kind === "dm" ? t("team.direct_message") : t("team.people_count", { n: thread.member_count });

  if (!threadId || (query.isError && !thread)) {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.screen} testID="team-thread-missing">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("team.back")} onPress={back} style={styles.iconButton}><Icon name="arrowL" size={20} color={brandGroupChat.textPrimary} /></Pressable>
          <Text style={styles.title}>{t("team.title")}</Text>
        </View>
        <View style={styles.state}>
          <Text style={styles.stateText}>{query.error instanceof Error ? query.error.message : t("team.chat_missing")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("team.retry")} onPress={() => void query.refetch()} style={styles.chip}><Text style={styles.chipText}>{t("team.retry")}</Text></Pressable>
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen
      edges={["top"]}
      // On web the app root already leaves room for the privacy strip; a
      // window-height screen would push the composer under it.
      style={styles.screen}
      testID="team-thread"
    >
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("team.back")} onPress={back} hitSlop={6} style={styles.iconButton}>
          <Icon name="arrowL" size={20} color={brandGroupChat.textPrimary} />
        </Pressable>
        {thread ? <TeamAvatar thread={thread} size={34} /> : null}
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>{thread?.title ?? t("team.title")}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{thread?.muted ? `${subtitle} · ${t("team.muted")}` : subtitle}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("team.chat_options")} onPress={() => setOptionsOpen(true)} hitSlop={6} style={styles.iconButton} testID="team-thread-options">
          <Icon name="moreH" size={20} color={brandGroupChat.textPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={DONE_BAR_OCCUPIED} style={styles.flex}>
        {query.isPending ? (
          <View style={styles.state}><ActivityIndicator color={accent.warm} accessibilityLabel={t("team.loading")} /></View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
            testID="team-message-scroll"
          >
            {query.hasNextPage ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("team.load_earlier")} onPress={() => void query.fetchNextPage()} style={[styles.chip, styles.center]}>
                {query.isFetchingNextPage ? <ActivityIndicator color={accent.warm} /> : <Text style={styles.chipText}>{t("team.load_earlier")}</Text>}
              </Pressable>
            ) : null}
            {messages.length === 0 ? <View style={styles.state}><Text style={styles.stateText}>{t("team.empty_thread")}</Text></View> : null}
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                userId={userId}
                message={message}
                names={memberNames}
                language={language}
                t={t}
                reacting={reactingTo === message.id}
                onReact={(emoji) => react(message, emoji)}
                onToggleReacting={() => setReactingTo((current) => (current === message.id ? null : message.id))}
                onReply={() => { setEditing(null); setReplyTo(message); }}
                onEdit={() => { setReplyTo(null); setEditing(message); setBody(message.body ?? ""); }}
                onDelete={() => remove(message)}
                onOpenAttachment={(attachment) => openAttachment(message, attachment)}
              />
            ))}
          </ScrollView>
        )}

        <View style={[styles.composer, { paddingBottom: liftedBottomSpacer(keyboardHeight > 0, Math.max(insets.bottom, spacing.sm)) }]}>
          {replyTo || editing ? (
            <View style={styles.contextBar}>
              <View style={styles.contextAccent} />
              <View style={styles.headerCopy}>
                <Text style={styles.contextTitle} numberOfLines={1}>{editing ? t("team.editing") : t("team.replying_to", { name: replyTo?.author_name ?? "" })}</Text>
                <Text style={styles.contextText} numberOfLines={1}>{(editing ?? replyTo)?.body ?? ""}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t("team.cancel")} onPress={() => { if (editing) setBody(""); setEditing(null); setReplyTo(null); }} hitSlop={8} style={styles.iconButton}>
                <Icon name="close" size={16} color={brandGroupChat.textSoft} />
              </Pressable>
            </View>
          ) : null}
          {tray.length ? (
            <View style={styles.tray} testID="team-tray">
              {tray.map((item) => (
                <View key={item.key} style={[styles.trayChip, item.status === "failed" && styles.trayChipFailed]}>
                  {item.previewUri ? <Image source={{ uri: item.previewUri }} style={styles.trayThumb} /> : <Text style={styles.trayType}>{item.kind === "link" ? "LINK" : docType(item.name)}</Text>}
                  <Text style={styles.trayName} numberOfLines={1}>{item.name}</Text>
                  {item.status === "uploading" ? <Text style={styles.trayMeta}>{`${Math.round(item.progress * 100)}%`}</Text> : null}
                  {item.status === "failed" ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${t("team.retry")} ${item.name}`} onPress={() => void upload(item)} hitSlop={6}>
                      <Text style={styles.trayRetry}>{t("team.retry")}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable accessibilityRole="button" accessibilityLabel={t("team.remove_file", { name: item.name })} onPress={() => setTray((items) => items.filter((x) => x.key !== item.key))} hitSlop={6}>
                    <Icon name="close" size={14} color={brandGroupChat.textSoft} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {tray.some((item) => item.error) ? <Text style={styles.trayError}>{tray.find((item) => item.error)?.error}</Text> : null}
          {linkOpen ? (
            <View style={styles.linkRow}>
              <TextInput
                value={linkText}
                onChangeText={setLinkText}
                placeholder={t("team.link_placeholder")}
                placeholderTextColor={brandGroupChat.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onSubmitEditing={() => void addLink()}
                style={styles.linkInput}
                accessibilityLabel={t("team.add_link")}
                testID="team-link-input"
              />
              <Pressable accessibilityRole="button" accessibilityLabel={t("team.add")} onPress={() => void addLink()} style={styles.chip}><Text style={styles.chipText}>{t("team.add")}</Text></Pressable>
            </View>
          ) : null}
          {suggestions.length ? (
            <View style={styles.suggestions} accessibilityLabel={t("team.everyone")}>
              {suggestions.map((option) => (
                <Pressable key={option.id} accessibilityRole="button" accessibilityLabel={`@${option.name}`} onPress={() => chooseMention(option)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
                  {option.id === "everyone" ? <View style={styles.everyoneMark}><Icon name="users" size={14} color={brandGroupChat.textPrimary} /></View> : <PersonAvatar name={option.name} id={option.id} size={26} />}
                  <Text style={styles.suggestionText}>{option.id === "everyone" ? t("team.everyone") : option.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.composerLine}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("team.attach_title")} disabled={Boolean(editing)} onPress={() => setPickerOpen(true)} hitSlop={4} style={[styles.attach, editing && styles.disabled]} testID="team-attach">
              <Icon name="plus" size={20} color={brandGroupChat.textSecondary} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t("team.add_link")} disabled={Boolean(editing)} onPress={() => setLinkOpen((open) => !open)} hitSlop={4} style={[styles.attach, editing && styles.disabled]} testID="team-add-link">
              <Icon name="link" size={18} color={brandGroupChat.textSecondary} />
            </Pressable>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={thread ? t("team.message_placeholder", { name: thread.title }) : ""}
              placeholderTextColor={brandGroupChat.textMuted}
              multiline
              maxLength={TEAM_MAX_MESSAGE_CHARS}
              style={styles.input}
              accessibilityLabel={t("team.message")}
              testID="team-composer"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? t("team.save") : t("team.send")}
              accessibilityState={{ disabled: !canSend, busy: sending }}
              disabled={!canSend}
              onPress={() => void send()}
              style={[styles.send, !canSend && styles.disabled]}
              testID="team-send"
            >
              {sending ? <ActivityIndicator size="small" color={brandGroupChat.mineText} /> : <Icon name={editing ? "check" : "send"} size={17} color={brandGroupChat.mineText} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <BrandGroupFileUploadSheet
        visible={pickerOpen}
        conversationId={threadId}
        actorMode="brand"
        onClose={() => setPickerOpen(false)}
        onQueued={() => undefined}
        onPicked={onPicked}
        pickOptions={TEAM_PICK_OPTIONS}
        remaining={Math.max(1, TEAM_MAX_ATTACHMENTS - tray.length)}
        copy={{ title: t("team.attach_title"), subtitle: t("team.attach_hint"), camera: t("team.camera"), photos: t("team.photos"), files: t("team.documents"), close: t("team.close") }}
      />

      <Modal visible={optionsOpen} transparent animationType="fade" onRequestClose={() => setOptionsOpen(false)}>
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("team.close")} style={StyleSheet.absoluteFill} onPress={() => { setOptionsOpen(false); setRenameText(null); }} />
          <View style={styles.sheet} testID="team-options-sheet">
            <Text style={styles.sheetTitle}>{thread?.title ?? ""}</Text>
            <SheetButton label={thread?.muted ? t("team.unmute") : t("team.mute")} hint={t("team.mute_hint")} onPress={toggleMute} />
            {thread?.kind === "group" ? (
              <>
                {renameText === null ? (
                  <SheetButton label={t("team.rename")} onPress={() => setRenameText(thread.title)} />
                ) : (
                  <View style={styles.linkRow}>
                    <TextInput value={renameText} onChangeText={setRenameText} maxLength={80} style={styles.linkInput} accessibilityLabel={t("team.group_name")} autoFocus />
                    <Pressable accessibilityRole="button" accessibilityLabel={t("team.save")} onPress={saveRename} style={styles.chip}><Text style={styles.chipText}>{t("team.save")}</Text></Pressable>
                  </View>
                )}
                <SheetButton label={t("team.add_people")} onPress={() => { setOptionsOpen(false); router.push(`/team?compose=add&thread=${threadId}` as never); }} />
                <SheetButton label={t("team.leave")} danger onPress={leave} />
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {viewer ? (
        <React.Suspense fallback={null}>
          <LazyMediaViewer
            visible
            items={viewer.items}
            initialIndex={viewer.index}
            requestFor={requestFor}
            onShowInChat={() => setViewer(null)}
            renderThumbnail={(item, style) => {
              const attachment = messages.flatMap((m) => m.attachments).find((a) => a.id === item.fileId);
              return attachment ? <TeamImage userId={userId} attachment={attachment} style={style} /> : null;
            }}
            onClose={() => setViewer(null)}
          />
        </React.Suspense>
      ) : null}

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast visible={toast !== null} kind="error" message={toast ?? ""} onDismiss={() => setToast(null)} />
      </View>
    </SafeScreen>
  );
}

function SheetButton({ label, hint, danger, onPress }: { label: string; hint?: string; danger?: boolean; onPress: () => void }): React.ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.sheetButton, pressed && styles.pressed]}>
      <Text style={[styles.sheetButtonText, danger && styles.danger]}>{label}</Text>
      {hint ? <Text style={styles.sheetHint}>{hint}</Text> : null}
    </Pressable>
  );
}

function MessageRow({
  userId, message, names, language, t, reacting, onReact, onToggleReacting, onReply, onEdit, onDelete, onOpenAttachment,
}: {
  userId: string;
  message: TeamMessage;
  names: string[];
  language: string;
  t: TeamT;
  reacting: boolean;
  onReact: (emoji: string) => void;
  onToggleReacting: () => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenAttachment: (attachment: TeamAttachment) => void;
}): React.ReactElement {
  const id = message.author_id ?? message.id;
  if (message.deleted) {
    return (
      <View style={styles.row} testID={`team-message-${message.id}`}>
        <PersonAvatar name={message.author_name} id={id} />
        <View style={styles.rowBody}>
          <View style={styles.who}><Text style={styles.whoName}>{message.author_name}</Text><Text style={styles.whoTime}>{teamTime(message.created_at, language)}</Text></View>
          <Text style={styles.deleted}>{t("team.deleted")}</Text>
        </View>
      </View>
    );
  }
  const images = message.attachments.filter((a) => a.kind === "image");
  const others = message.attachments.filter((a) => a.kind !== "image");
  return (
    <View style={styles.row} testID={`team-message-${message.id}`}>
      <PersonAvatar name={message.author_name} id={id} />
      <View style={styles.rowBody}>
        <View style={styles.who}>
          <Text style={styles.whoName}>{message.author_name}</Text>
          <Text style={styles.whoTime}>{teamTime(message.created_at, language)}{message.edited_at ? ` · ${t("team.edited")}` : ""}</Text>
        </View>
        {message.reply_to ? (
          <View style={styles.quote}>
            <Text style={styles.quoteText} numberOfLines={2}>{message.reply_to.deleted ? t("team.reply_deleted", { name: message.reply_to.author_name }) : `${message.reply_to.author_name}: ${message.reply_to.excerpt ?? ""}`}</Text>
          </View>
        ) : null}
        {message.body ? (
          <Text style={styles.body} selectable>
            {splitMentions(message.body, [...names, ...message.mentions.map((m) => m.name)]).map((part, index) => (
              <Text key={index} style={part.mention ? styles.mention : undefined}>{part.text}</Text>
            ))}
          </Text>
        ) : null}
        {images.length ? (
          <View style={styles.imageGrid}>
            {images.map((attachment) => (
              <Pressable key={attachment.id} accessibilityRole="imagebutton" accessibilityLabel={attachment.name} onPress={() => onOpenAttachment(attachment)} testID={`team-attachment-${attachment.id}`}>
                <TeamImage userId={userId} attachment={attachment} style={images.length === 1 ? styles.imageOne : styles.imageMany} />
                <Text style={styles.attMeta} numberOfLines={1}>{`${attachment.name} · ${formatSize(attachment.size_bytes)}`}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {others.map((attachment) => {
          const link = attachment.kind === "link" ? teamLinkLabel(attachment.url ?? "") : null;
          return (
            <Pressable
              key={attachment.id}
              accessibilityRole={link ? "link" : "button"}
              accessibilityLabel={link ? `${attachment.name}, ${link.host}` : attachment.name}
              onPress={() => onOpenAttachment(attachment)}
              style={({ pressed }) => [styles.attTile, pressed && styles.pressed]}
              testID={`team-attachment-${attachment.id}`}
            >
              <View style={[styles.attIcon, link && styles.attIconLink]}>
                <Text style={styles.attIconText}>{link ? (link.host.charAt(0) || "?").toUpperCase() : docType(attachment.name)}</Text>
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.attName} numberOfLines={1}>{attachment.name}</Text>
                <Text style={styles.attMeta} numberOfLines={1}>{link ? link.host : `${t("team.preview_document")} · ${formatSize(attachment.size_bytes)}`}</Text>
              </View>
            </Pressable>
          );
        })}
        <View style={styles.acts}>
          {message.reactions.map((reaction) => (
            <Pressable key={reaction.emoji} accessibilityRole="button" accessibilityLabel={`${reaction.emoji} ${reaction.count}`} accessibilityState={{ selected: reaction.mine }} onPress={() => onReact(reaction.emoji)} style={[styles.reaction, reaction.mine && styles.reactionMine]}>
              <Text style={styles.reactionText}>{`${reaction.emoji} ${reaction.count}`}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" accessibilityLabel={t("team.react")} onPress={onToggleReacting} hitSlop={4} style={styles.act}><Text style={styles.actText}>☺+</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("team.reply")} onPress={onReply} hitSlop={4} style={styles.act}><Text style={styles.actText}>{t("team.reply")}</Text></Pressable>
          {message.mine ? (
            <>
              {message.body ? <Pressable accessibilityRole="button" accessibilityLabel={t("team.edit")} onPress={onEdit} hitSlop={4} style={styles.act}><Text style={styles.actText}>{t("team.edit")}</Text></Pressable> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={t("team.delete")} onPress={onDelete} hitSlop={4} style={styles.act}><Text style={styles.actText}>{t("team.delete")}</Text></Pressable>
            </>
          ) : null}
        </View>
        {reacting ? (
          <View style={styles.quickReactions}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={emoji} onPress={() => onReact(emoji)} style={styles.quickReaction}>
                <Text style={styles.quickReactionText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: brandGroupChat.screenBg },
  flex: { flex: 1 },
  center: { alignSelf: "center" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  danger: { color: "#ff6b6b" },
  header: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: brandGroupChat.hairline },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: brandGroupChat.textPrimary, fontSize: 16, fontWeight: "700" },
  subtitle: { color: brandGroupChat.textSoft, fontSize: 12 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  state: { padding: spacing.lg, alignItems: "center", gap: spacing.md },
  stateText: { color: brandGroupChat.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" },
  chip: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surfaceRaised, alignItems: "center", justifyContent: "center" },
  chipText: { color: brandGroupChat.textPrimary, fontSize: 13, fontWeight: "600" },
  messages: { padding: spacing.md, gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
  rowBody: { flex: 1, minWidth: 0, gap: 4 },
  who: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  whoName: { color: brandGroupChat.senderName, fontSize: 13, fontWeight: "700" },
  whoTime: { color: brandGroupChat.textMuted, fontSize: 11 },
  body: { color: brandGroupChat.textPrimary, fontSize: 15, lineHeight: 21 },
  mention: { color: brandGroupChat.mentionText, backgroundColor: brandGroupChat.mentionBg, fontWeight: "600" },
  deleted: { color: brandGroupChat.textMuted, fontSize: 14, fontStyle: "italic" },
  quote: { borderLeftWidth: 3, borderLeftColor: brandGroupChat.quoteBar, backgroundColor: brandGroupChat.quoteBg, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  quoteText: { color: brandGroupChat.textSoft, fontSize: 12 },
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  imageBox: { borderRadius: radius.md, overflow: "hidden", backgroundColor: brandGroupChat.surfaceRaised, alignItems: "center", justifyContent: "center" },
  imageFill: { width: "100%", height: "100%" },
  imageOne: { width: 220, height: 160 },
  imageMany: { width: 120, height: 96 },
  attTile: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface, maxWidth: 320 },
  attIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: "rgba(255, 107, 107, 0.16)", alignItems: "center", justifyContent: "center" },
  attIconLink: { backgroundColor: "rgba(47, 111, 214, 0.22)" },
  attIconText: { color: brandGroupChat.textPrimary, fontSize: 11, fontWeight: "800" },
  attName: { color: brandGroupChat.textPrimary, fontSize: 13, fontWeight: "600" },
  attMeta: { color: brandGroupChat.textSoft, fontSize: 11, maxWidth: 220 },
  acts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  act: { minHeight: 24, justifyContent: "center" },
  actText: { color: brandGroupChat.textMuted, fontSize: 12, fontWeight: "600" },
  reaction: { minHeight: 24, paddingHorizontal: 8, borderRadius: radius.full, borderWidth: 1, borderColor: brandGroupChat.hairline, justifyContent: "center" },
  reactionMine: { borderColor: accent.warm, backgroundColor: brandGroupChat.accentSoft },
  reactionText: { color: brandGroupChat.textPrimary, fontSize: 12 },
  quickReactions: { flexDirection: "row", gap: spacing.xs, padding: 4, borderRadius: radius.full, backgroundColor: brandGroupChat.surfaceRaised, alignSelf: "flex-start" },
  quickReaction: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  quickReactionText: { fontSize: 18 },
  composer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.screenBg },
  contextBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: brandGroupChat.surface },
  contextAccent: { width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: accent.warm },
  contextTitle: { color: brandGroupChat.textPrimary, fontSize: 12, fontWeight: "700" },
  contextText: { color: brandGroupChat.textSoft, fontSize: 12 },
  tray: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  trayChip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 220, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface },
  trayChipFailed: { borderColor: "#ff6b6b" },
  trayThumb: { width: 24, height: 24, borderRadius: 4 },
  trayType: { color: brandGroupChat.textPrimary, fontSize: 10, fontWeight: "800" },
  trayName: { flexShrink: 1, color: brandGroupChat.textSecondary, fontSize: 12 },
  trayMeta: { color: brandGroupChat.textMuted, fontSize: 11 },
  trayRetry: { color: accent.warm, fontSize: 12, fontWeight: "700" },
  trayError: { color: "#ff9b9b", fontSize: 12 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  linkInput: { flex: 1, minHeight: 38, borderRadius: radius.md, borderWidth: 1, borderColor: brandGroupChat.hairline, backgroundColor: brandGroupChat.surface, color: brandGroupChat.textPrimary, paddingHorizontal: spacing.sm, fontSize: 14 },
  suggestions: { borderRadius: radius.md, backgroundColor: brandGroupChat.surfaceRaised, paddingVertical: 4 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, minHeight: 40 },
  suggestionText: { color: brandGroupChat.textPrimary, fontSize: 14 },
  everyoneMark: { width: 26, height: 26, borderRadius: 13, backgroundColor: brandGroupChat.mentionBg, alignItems: "center", justifyContent: "center" },
  composerLine: { flexDirection: "row", alignItems: "flex-end", gap: spacing.xs },
  attach: { width: 36, height: 40, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 40, maxHeight: 140, borderRadius: brandGroupChat.composerRadius, backgroundColor: brandGroupChat.surface, color: brandGroupChat.textPrimary, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10, fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: accent.warm, alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: brandGroupChat.scrim, justifyContent: "flex-end", padding: spacing.md },
  sheet: { borderRadius: radius.xl, backgroundColor: brandGroupChat.surface, padding: spacing.md, gap: spacing.xs, width: "100%", maxWidth: 560, alignSelf: "center" },
  sheetTitle: { color: brandGroupChat.textPrimary, fontSize: 16, fontWeight: "700", paddingBottom: spacing.xs },
  sheetButton: { minHeight: 48, justifyContent: "center", paddingVertical: spacing.xs },
  sheetButtonText: { color: brandGroupChat.textPrimary, fontSize: 15, fontWeight: "600" },
  sheetHint: { color: brandGroupChat.textSoft, fontSize: 12 },
  toastWrap: { position: "absolute", top: 80, left: 0, right: 0, zIndex: 100, elevation: 12 },
});
