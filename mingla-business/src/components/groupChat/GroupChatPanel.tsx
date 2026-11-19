import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { showAlert } from "../ui/showAlert";
// Library-recommended primitive for sticky-composer-above-keyboard pattern.
// react-native-keyboard-controller is the canonical Mingla keyboard library
// per I-PROPOSED-KEYBOARD-LIBRARY-ONLY (ORCH-0892-C) — already a project dep.
// orch-strict-grep-allow orch-0892 — chat composer needs sticky-above-keyboard lift
import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// #1850 — the composer's lift is budgeted against the DERIVED Done-bar cost, not
// a hand-typed number. See the comment at the KeyboardAvoidingView below.
//
// #2649 — the `ScrollView` this used to also import is GONE, and its removal is
// the point rather than tidying. That specifier resolves to the wrapper's
// re-export of KeyboardAwareScrollView, which appended a `keyboardHeight + 1`
// spacer to this thread's content whenever the keyboard opened — measured at
// 335pt on iOS and 302.9dp on Android, buying nothing, because this screen's
// composer is a SIBLING of the thread, not a child, so there is no focused
// input inside it for the library to keep clear. Worse, that phantom content
// made `scrollToEnd` land ~351pt past the last message in blank space. The
// thread is now an inverted FlatList and needs neither.
import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";
// #1890 C-5 REWORK — the composer's bottom spacer comes from the shared
// occluder budget, which is where the rule "a lifted surface does not also
// budget for the screen edge it is no longer touching" is written down. Both
// platform variants export it, so this never reads `undefined`.
import { liftedBottomSpacer } from "../../wrappers/keyboardClearance";
// #1890 C-5 REWORK — the composer needs to know whether it is LIFTED, and the
// library-backed wrapper is the sanctioned source (orch-0892 forbids a bespoke
// Keyboard.addListener pair). Same hook AriChatScreen uses, and for the same
// reason: `onStart` carries the target height as the keyboard BEGINS moving, so
// the spacer swaps in the same frame the KeyboardAvoidingView starts lifting
// rather than an animation late.
import { useKeyboardHeight } from "../../wrappers/useKeyboardHeight";
import { useRouter } from "expo-router";

import { color, materials, radius, size, space } from "../../constants/designSystem";
import { supabase } from "../../services/supabase";
import { markBrandGuestChatRead, postPlannerMessage } from "../../services/groupChatService";
import { useEventGroupChat } from "../../hooks/useEventGroupChat";
import { useEventGroupChatModeration } from "../../hooks/useEventGroupChatModeration";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { GroupChatModerationSheet } from "./GroupChatModerationSheet";
import { GroupChatMessageMedia } from "./GroupChatMessageMedia";
import { groupChatMediaKind } from "../../utils/groupChatMedia";
import { useBusinessMediaTranslation } from "../../i18n";
import {
  guestAudienceCount,
  guestAudienceLine,
  guestConfirmCopy,
  guestModeConfirmCopy,
  guestModeLine,
  guestSendA11y,
  guestSendLabel,
  guestWho,
} from "../../utils/brandGuestAudience";
import { showsJumpToLatest } from "../../utils/brandThreadHistory";
import {
  captureSendTarget,
  dispatchBrandThreadSend,
  guestSendNeedsConfirm,
  type BrandThreadSendTarget,
} from "../../utils/brandThreadSend";

/**
 * #4420 — the Guests side of a brand's one thread. The thread screen owns the
 * header, the Team | Guests switcher and the per-side drafts; this panel draws
 * the loud Guests treatment (band, Broadcast / Open chat, blue composer) below
 * it and sends only to the Guest chat.
 */
export interface GroupChatThreadBinding {
  /** The Guests draft, kept by the thread so it survives a switch to Team. */
  draft: string;
  onDraftChange: (value: string) => void;
  /** A send landed: the thread clears the draft it was sent from. */
  onSent: (target: BrandThreadSendTarget, text: string) => void;
  /** The first-send check was answered this thread open. */
  sendConfirmed: boolean;
  onSendConfirmed: () => void;
  /** The guest side was read (the inbox and switcher badges refresh). */
  onRead?: () => void;
  /** #4420 SC-15: message text with tappable links, from the thread. */
  renderText?: (content: string, mine: boolean) => React.ReactNode;
}

export interface GroupChatPanelProps {
  /** A listing: opens its brand's Guest chat (#4459). */
  eventId?: string;
  /** #4459: Messages → Guests opens by brand. */
  brandId?: string;
  /** #4459: the desktop Messages page shows the panel beside the inbox (no Back). */
  embedded?: boolean;
  /** #4420: rendered as the Guests side inside the brand's one thread (no own header). */
  thread?: GroupChatThreadBinding;
  /** #4420: a brand with a Guest chat but no Team chat says why Team is missing. */
  teamUnavailable?: boolean;
}

export const GroupChatPanel: React.FC<GroupChatPanelProps> = ({ eventId, brandId, embedded = false, thread, teamUnavailable = false }) => {
  const router = useRouter();
  const { t } = useBusinessMediaTranslation();
  const jumpLabel = t("messages.jump_latest");
  const insets = useSafeAreaInsets();
  const chat = useEventGroupChat(eventId ?? null, brandId ?? null);
  const moderation = useEventGroupChatModeration(chat.conversation?.id ?? null);
  // #4459: the Guest chat speaks as its brand. Without a brand name (an older
  // or partial conversation row) the copy falls back to the plain wording
  // rather than printing "Message as undefined".
  const postingAs = chat.conversation?.name?.trim() || null;
  const brandName = postingAs ?? "your brand";
  // #4420: standalone (listing route, guests-only brand) keeps its own draft
  // and first-send check; inside the thread the thread keeps both.
  const [localDraft, setLocalDraft] = useState("");
  const [localConfirmed, setLocalConfirmed] = useState(false);
  const composer = thread ? thread.draft : localDraft;
  const setComposer = thread ? thread.onDraftChange : setLocalDraft;
  const sendConfirmed = thread ? thread.sendConfirmed : localConfirmed;
  const [sending, setSending] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  // #4420: Jump to latest (the inverted list's newest end is offset 0).
  const listRef = useRef<FlatList<(typeof chat.messages)[number]>>(null);
  const [farFromLatest, setFarFromLatest] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const broadcastOnly = chat.conversation?.is_broadcast_only ?? false;
  // #4420: N = members not on the team, exactly as membership says; unknown
  // (loading / failed) is never shown as 0.
  const guestCount = guestAudienceCount(moderation.participants ?? [], {
    loaded: moderation.loaded === true,
    error: moderation.error ?? null,
  });
  const conversationId = chat.conversation?.id ?? null;
  const onRead = thread?.onRead;

  const keyboardHeight = useKeyboardHeight();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  const sortedMessages = useMemo(
    () => chat.messages.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [chat.messages],
  );

  // #2649 — the thread is an `inverted` FlatList, which paints data[0] at the
  // frame's bottom edge. Feeding it newest-first is what makes the thread open
  // on the NEWEST message and stay pinned there when the composer grows. Before
  // this, the panel had no scroll of any kind and opened on the OLDEST message
  // in every keyboard state — 692pt from the newest on iPhone 16.
  //
  // Deliberately NOT paired with a scrollToEnd: bottom-anchoring comes from
  // `inverted` alone. See the SmartScrollView import note for the trap that
  // rule exists to avoid.
  const invertedMessages = useMemo(() => sortedMessages.slice().reverse(), [sortedMessages]);

  // #4420: the team member has now seen the Guests side (inbox + switcher
  // badges). A failed mark only leaves a badge up, so it is logged.
  const newestMessageId = sortedMessages[sortedMessages.length - 1]?.id ?? null;
  useEffect(() => {
    if (conversationId === null) return;
    let active = true;
    void (async () => {
      try {
        const result = await markBrandGuestChatRead(conversationId);
        if (result.error) throw new Error(result.error);
        if (active) onRead?.();
      } catch (err) {
        console.warn("[GroupChatPanel] could not mark the Guests side read", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [conversationId, newestMessageId, onRead]);

  // #4420: the send goes to the Guest chat that was showing when Send was
  // pressed (captured once), never to the Team chat.
  const sendNow = async (target: BrandThreadSendTarget, content: string): Promise<void> => {
    setSending(true);
    try {
      const result = await dispatchBrandThreadSend(target, content, {
        team: () => Promise.reject(new Error("The Guests composer never sends to the Team chat.")),
        guests: (id, text) => postPlannerMessage(id, text),
      });
      if (result.error) throw new Error(result.error);
      if (thread) thread.onSent(target, content);
      else setLocalDraft((current) => (current.trim() === content ? "" : current));
      await chat.refresh();
    } catch (err) {
      showAlert("Message failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    const content = composer.trim();
    const target = captureSendTarget("guests", conversationId);
    if (content.length === 0 || target === null || sending) return;
    if (!guestSendNeedsConfirm(target.side, sendConfirmed)) {
      void sendNow(target, content);
      return;
    }
    // #4420 decision 5: asked before the first guest message each thread open.
    const copy = guestConfirmCopy(t, guestCount, brandName, broadcastOnly);
    showAlert(copy.title, copy.description, [
      { text: copy.cancelLabel, style: "cancel" },
      {
        text: copy.confirmLabel,
        onPress: () => {
          if (thread) thread.onSendConfirmed();
          else setLocalConfirmed(true);
          void sendNow(target, content);
        },
      },
    ]);
  };

  // #4420 SC-14: Broadcast / Open chat is the announcements-only setting. It
  // asks first; a failed switch says so and the control stays where it was
  // (the value only ever comes from the server row).
  const applyBroadcast = async (value: boolean) => {
    setModeBusy(true);
    try {
      const result = await moderation.setBroadcastOnly(value);
      if (result.error) {
        showAlert(t("messages.mode_failed_title"), t("messages.mode_failed_body", { error: result.error, mode: broadcastOnly ? t("messages.mode_broadcast") : t("messages.mode_open") }));
        return;
      }
      await chat.refresh();
    } finally {
      setModeBusy(false);
    }
  };

  const handleToggleBroadcast = (value: boolean) => {
    if (value === broadcastOnly || modeBusy) return;
    const copy = guestModeConfirmCopy(t, value, guestCount, brandName);
    showAlert(copy.title, copy.description, [
      { text: t("messages.cancel"), style: "cancel" },
      { text: copy.confirmLabel, onPress: () => void applyBroadcast(value) },
    ]);
  };

  // #4459 — removing a guest is sticky (new bookings never add them back), so
  // it asks first, then offers Undo (restore).
  const handleRemoveParticipant = (userId: string) => {
    const name = moderation.participants.find((p) => p.user_id === userId)?.display_name ?? "This guest";
    showAlert(
      `Remove ${name}?`,
      "They leave this Guest chat and new bookings won't add them back. Their booking is unchanged.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => void (async () => {
            const result = await moderation.removeParticipant(userId);
            if (result.error) {
              showAlert("Could not remove guest", result.error);
              return;
            }
            showAlert(`${name} was removed`, "You can add them back.", [
              {
                text: "Undo",
                onPress: () => void (async () => {
                  const undo = await moderation.restoreParticipant(userId);
                  if (undo.error) showAlert("Could not add them back", undo.error);
                })(),
              },
              { text: "OK", style: "cancel" },
            ]);
          })(),
        },
      ],
    );
  };

  const handleDeleteMessage = async (messageId: string) => {
    const result = await moderation.deleteMessage(messageId);
    if (result.error) {
      showAlert("Could not delete message", result.error);
      return;
    }
    await chat.refresh();
  };

  const sendDisabled = composer.trim().length === 0 || sending || conversationId === null;
  const audience = guestAudienceLine(t, guestCount, brandName, broadcastOnly);

  // #4420: the Guests band and the Broadcast / Open chat switch (SC-14).
  const guestsBand = chat.conversation !== null ? (
    <>
      <View style={styles.band} accessibilityRole="text" testID="brand-guests-band">
        <Icon name="megaphone" size={16} color={color.infoText} />
        <Text style={styles.bandText}>
          {guestCount === 0
            ? t("messages.band_none", { brand: brandName })
            : t("messages.band", { who: guestWho(t, guestCount), brand: brandName })}
        </Text>
      </View>
      <View style={styles.modeBar}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("messages.mode_a11y")} style={styles.modeSeg}>
          {([true, false] as const).map((value) => {
            const on = broadcastOnly === value;
            return (
              <Pressable
                key={value ? "broadcast" : "open"}
                accessibilityRole="radio"
                accessibilityLabel={value ? t("messages.mode_broadcast") : t("messages.mode_open")}
                accessibilityState={{ checked: on, disabled: modeBusy, busy: modeBusy && !on }}
                disabled={modeBusy}
                onPress={() => handleToggleBroadcast(value)}
                style={[styles.modeOption, on && styles.modeOptionOn]}
                testID={value ? "brand-guests-mode-broadcast" : "brand-guests-mode-open"}
              >
                <Icon name={value ? "megaphone" : "users"} size={14} color={on ? color.textStrong : color.infoText} />
                <Text style={[styles.modeText, on && styles.modeTextOn]}>{value ? t("messages.mode_broadcast") : t("messages.mode_open")}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.modeLine}>{guestModeLine(t, broadcastOnly, brandName)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("messages.manage_a11y")}
          onPress={() => setModerationOpen(true)}
          style={styles.modeManage}
          testID="brand-guests-manage"
        >
          <Icon name="users" size={16} color={color.text1} />
        </Pressable>
      </View>
    </>
  ) : null;

  const jumpButton = farFromLatest ? (
    <View style={styles.jumpWrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={jumpLabel}
        onPress={() => {
          setFarFromLatest(false);
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }}
        style={styles.jump}
        testID="brand-guests-jump-latest"
      >
        <Icon name="chevD" size={16} color={color.text1} />
        <Text style={styles.jumpText}>{jumpLabel}</Text>
      </Pressable>
    </View>
  ) : null;

  const composerBlock = (
        <View
          style={[
            styles.composer,
            {
              // #1890 C-5 REWORK — this is the composer's ONE bottom spacer,
              // and it must stay the only one: `styles.composer` carries
              // paddingHorizontal/paddingTop only, so this value alone stands
              // between the controls' bottom edge and the container's.
              // Lifted, the composer owes the promised visible gap and
              // nothing else.
              // #4420: inside the brand thread the thread's own keyboard
              // boundary lifts this composer, so it budgets like the Team
              // composer beside it (no second KeyboardAvoidingView).
              paddingBottom: thread
                ? liftedBottomSpacer(keyboardHeight > 0, Math.max(insets.bottom, space[2]))
                : liftedBottomSpacer(
                  keyboardHeight > 0,
                  Math.max(insets.bottom, 0) + space[6],
                ),
            },
          ]}
          testID="brand-guests-composer"
        >
          {/* #4420: the composer names its audience (SC-3). */}
          <View style={styles.audienceRow}>
            <View style={styles.audienceChip} testID="brand-guests-audience">
              <Icon name="megaphone" size={14} color={color.textStrong} />
              <Text style={styles.audienceText} numberOfLines={1}>{audience}</Text>
            </View>
          </View>
          <View style={styles.composerRow}>
            {/* #4459: Guest chats are text only in v1 (no attach button). */}
            <View style={styles.field}>
              <TextInput
                value={composer}
                onChangeText={setComposer}
                placeholder={broadcastOnly ? t("messages.placeholder_broadcast", { brand: brandName }) : t("messages.placeholder_open", { brand: brandName })}
                placeholderTextColor={color.text3}
                style={styles.input}
                multiline
                accessibilityLabel={audience}
                testID="brand-guests-input"
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={guestSendA11y(t, guestCount, brandName, broadcastOnly)}
              accessibilityState={{ disabled: sendDisabled, busy: sending }}
              onPress={handleSend}
              disabled={sendDisabled}
              style={[styles.send, sendDisabled && styles.sendIdle]}
              testID="brand-guests-send"
            >
              {sending ? (
                <ActivityIndicator size="small" color={color.textStrong} />
              ) : (
                <>
                  <Icon name="megaphone" size={16} color={color.textStrong} />
                  <Text style={styles.sendText}>{guestSendLabel(t, broadcastOnly)}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
  );

  const body = chat.loading ? (
    <View style={styles.state}>
      <ActivityIndicator color={color.text2} />
    </View>
  ) : chat.error ? (
    <View style={styles.state}>
      <Text style={styles.errorText}>{chat.error}</Text>
      <Button label="Retry" onPress={() => void chat.refresh()} variant="secondary" />
    </View>
  ) : chat.conversation === null ? (
    <View style={styles.state}>
      <Text style={styles.errorText}>{"Your brand's Guest chat isn't ready yet. Try again in a moment."}</Text>
    </View>
  ) : (
    <>
      {/* #2649 — virtualised and bottom-anchored. The `inverted` prop is the
          whole fix: the newest message is pinned to the frame's bottom edge
          by construction, so the composer can grow as much as the keyboard
          needs and the thread rides up with it. No keyboard height is read
          here, no listener is registered, and no scroll call holds it in
          place — which is why it also survives #1894. */}
      <FlatList
        ref={listRef}
        onScroll={(event) => setFarFromLatest(showsJumpToLatest(event.nativeEvent.contentOffset.y))}
        scrollEventThrottle={64}
        style={[styles.messages, styles.messagesGuests]}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
        inverted
        data={invertedMessages}
        keyExtractor={(message) => message.id}
        ListHeaderComponent={broadcastOnly ? (
          <View style={styles.repliesOff} accessibilityRole="text">
            <Icon name="shield" size={13} color={color.text3} />
            <Text style={styles.repliesOffText}>{t("messages.replies_off")}</Text>
          </View>
        ) : null}
        ListEmptyComponent={guestCount === 0 ? (
          <View style={styles.emptyGuests} testID="brand-guests-empty">
            <View style={styles.emptyIcon}><Icon name="megaphone" size={26} color={color.infoText} /></View>
            <Text style={styles.emptyTitle}>{t("messages.empty_title")}</Text>
            <Text style={styles.emptyText}>{t("messages.empty_body")}</Text>
          </View>
        ) : null}
        renderItem={({ item: message }) => {
          // #4459: a brand post stores no sender; its author is team-only.
          const mine = message.sender_id === currentUserId ||
            (message.author_id != null && message.author_id === currentUserId);
          const blast = message.marketing_campaign_id !== null;
          // Team posts read as the brand (the team also sees who sent them);
          // guests by their own name.
          const fromBrand = message.sender_kind === "brand";
          const senderLabel = fromBrand
            ? t("messages.sender_as_brand", { brand: brandName, who: mine ? t("messages.by_you") : message.author_name ?? t("messages.by_teammate") })
            : mine
              ? null
              : message.sender_display_name_snapshot || t("messages.people_guest");
          // #4114 Wave 6: Explorer photos and videos are private-bucket
          // paths (signed in GroupChatMessageMedia); view once is never shown.
          const hasImage = groupChatMediaKind(message) !== "none";
          const hasCaption = message.content.length > 0;
          return (
            <View
              style={[
                styles.messageRow,
                mine || fromBrand ? styles.messageRowMine : styles.messageRowOther,
                fromBrand && styles.messageRowBrand,
                blast && styles.messageRowBlast,
              ]}
            >
              {senderLabel ? (
                <Text style={styles.senderLabel} numberOfLines={1}>{senderLabel}</Text>
              ) : null}
              {hasImage ? <GroupChatMessageMedia message={message} mine={mine} /> : null}
              {hasCaption ? (
                thread?.renderText ? (
                  <View style={hasImage ? styles.messageTextWithImage : null}>{thread.renderText(message.content, mine)}</View>
                ) : (
                  <Text
                    selectable
                    style={[
                      styles.messageText,
                      mine && styles.messageTextMine,
                      hasImage && styles.messageTextWithImage,
                    ]}
                  >
                    {message.content}
                  </Text>
                )
              ) : null}
              <View style={styles.messageMetaRow}>
                <Text style={styles.messageMeta}>
                  {new Date(message.created_at).toLocaleString()}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete message"
                  onPress={() => void handleDeleteMessage(message.id)}
                >
                  <Icon name="trash" size={13} color={mine ? color.textStrong : color.text3} />
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      {/* ORCH-1165: lift the composer so the Done bar sits above it.
          #1850 — the literal 42 that used to sit here was KEYBOARD_TOOLBAR_HEIGHT,
          which is the bar's own height, NOT what it occupies above the keyboard.
          DONE_BAR_OCCUPIED is derived from the same inputs the library uses, so
          an OS or library bump moves it without anyone editing this line.
          #1890 C-5: this offset budgets exactly ONE thing — the occluder. The
          promised visible gap is the composer's own bottom spacer while it
          is lifted, so the two terms are added once, in different places,
          instead of one of them twice. */}
      {jumpButton}
      {thread ? composerBlock : (
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={DONE_BAR_OCCUPIED}>
          {composerBlock}
        </KeyboardAvoidingView>
      )}
    </>
  );

  const moderationSheet = (
    <GroupChatModerationSheet
      visible={moderationOpen}
      onClose={() => setModerationOpen(false)}
      broadcastOnly={broadcastOnly}
      participants={moderation.participants}
      loading={moderation.loading}
      onToggleBroadcastOnly={handleToggleBroadcast}
      onRemoveParticipant={handleRemoveParticipant}
    />
  );

  // #4420: inside the brand's thread the thread owns the header and switcher.
  if (thread) {
    return (
      <View style={styles.threadRoot} testID="brand-guests-side">
        {guestsBand}
        {body}
        {moderationSheet}
      </View>
    );
  }

  return (
    <SafeScreen style={styles.screen}>
      <View style={styles.header}>
        {embedded ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            style={styles.iconButton}
          >
            <Icon name="arrowL" size={18} color={color.text1} />
          </Pressable>
        )}
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={1}>
            {chat.conversation?.event_name ?? "Group chat"}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {postingAs ? `Posting as ${postingAs}` : "Read, reply, and moderate your guests"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open moderation"
          onPress={() => setModerationOpen(true)}
          style={styles.iconButton}
        >
          <Icon name="moreH" size={18} color={color.text1} />
        </Pressable>
      </View>
      {teamUnavailable ? (
        <View style={styles.teamUnavailable} testID="brand-guests-team-unavailable">
          <View accessibilityRole="tab" accessibilityState={{ disabled: true, selected: false }} accessibilityLabel={t("messages.team_unavailable_a11y", { reason: t("messages.team_unavailable") })} style={styles.teamUnavailablePill}>
            <Icon name="shield" size={13} color={color.text4} />
            <Text style={styles.teamUnavailablePillText}>{t("messages.team")}</Text>
          </View>
          <Text style={styles.teamUnavailableText}>{t("messages.team_unavailable")}</Text>
        </View>
      ) : null}
      {guestsBand}
      {body}
      {moderationSheet}
    </SafeScreen>
  );
};

/**
 * #4420 design: People on the Guests side is the guest list (members not on
 * the team), names through the shared fallback ("Guest" when a member has no
 * name, #4508). Loaded with this chunk through LazyGroupChatPanel.
 */
export interface BrandGuestPeoplePanelProps {
  conversationId: string;
  onClose?: () => void;
}

export const BrandGuestPeoplePanel: React.FC<BrandGuestPeoplePanelProps> = ({ conversationId, onClose }) => {
  const { t } = useBusinessMediaTranslation();
  const roster = useEventGroupChatModeration(conversationId);
  const guests = (roster.participants ?? []).filter((member) => !member.is_team);
  const count = guestAudienceCount(roster.participants ?? [], { loaded: roster.loaded === true, error: roster.error ?? null });
  return (
    <View style={styles.peopleRoot} testID="brand-guests-people-panel">
      <View style={styles.peopleHead}>
        <View style={styles.headerCopy}>
          <Text style={styles.peopleTitle}>{t("messages.guests")}</Text>
          <Text style={styles.peopleSub}>{t("messages.people_guests_sub", { who: guestWho(t, count) })}</Text>
        </View>
        {onClose ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("messages.close")} onPress={onClose} style={styles.iconButton}>
            <Icon name="close" size={18} color={color.text1} />
          </Pressable>
        ) : null}
      </View>
      {roster.loading && !roster.loaded ? (
        <View style={styles.state}><ActivityIndicator color={color.text2} /></View>
      ) : roster.error ? (
        <View style={styles.state}>
          <Text style={styles.errorText}>{t("messages.people_guests_error")}</Text>
          <Button label={t("messages.try_again")} variant="secondary" onPress={() => void roster.refresh()} />
        </View>
      ) : guests.length === 0 ? (
        <View style={styles.state}><Text style={styles.errorText}>{t("messages.people_guests_none")}</Text></View>
      ) : (
        <FlatList
          data={guests}
          keyExtractor={(guest) => guest.user_id}
          contentContainerStyle={styles.peopleList}
          renderItem={({ item: guest }) => {
            const name = guest.display_name?.trim() || t("messages.people_guest");
            return (
              <View style={styles.peopleRow}>
                <View style={styles.peopleAvatar}><Text style={styles.peopleAvatarText}>{name.charAt(0).toUpperCase()}</Text></View>
                <View style={styles.headerCopy}>
                  <Text style={styles.peopleName} numberOfLines={1}>{name}</Text>
                  <Text style={styles.peopleMeta}>{t("messages.people_guest")}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  threadRoot: { flex: 1, minHeight: 0 },
  peopleRoot: { flex: 1, minHeight: 0, backgroundColor: color.canvas },
  peopleHead: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: color.line },
  peopleTitle: { color: color.text1, fontSize: 17, lineHeight: 24, fontWeight: "600" },
  peopleSub: { marginTop: 2, color: color.text3, fontSize: 13 },
  peopleList: { paddingHorizontal: space[4], paddingBottom: space[6] },
  peopleRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  peopleAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: color.solidTint.info },
  peopleAvatarText: { color: color.infoText, fontSize: 14, fontWeight: "700" },
  peopleName: { color: color.text1, fontSize: 15, fontWeight: "600" },
  peopleMeta: { marginTop: 2, color: color.infoText, fontSize: 13 },
  jumpWrap: { position: "relative", height: 0, zIndex: 4 },
  jump: { position: "absolute", right: space[4], bottom: space[2], minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: radius.full, borderWidth: 1, borderColor: color.lineStrong, backgroundColor: color.card2 },
  jumpText: { color: color.text1, fontSize: 14, fontWeight: "600" },
  // #4420 Guests treatment (info blue): band, mode bar, composer, send.
  band: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space[4], paddingVertical: 9, backgroundColor: color.infoTint, borderBottomWidth: 1, borderBottomColor: color.guestLine },
  bandText: { flex: 1, color: color.infoText, fontSize: 13, lineHeight: 18 },
  modeBar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2], backgroundColor: color.infoTint, borderBottomWidth: 1, borderBottomColor: color.guestLine },
  modeSeg: { flexDirection: "row", gap: 2, padding: 3, borderRadius: radius.full, borderWidth: 1, borderColor: color.guestLine, backgroundColor: color.fill.inset },
  modeOption: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: radius.full },
  modeOptionOn: { backgroundColor: color.info },
  modeText: { color: color.infoText, fontSize: 13, fontWeight: "600" },
  modeTextOn: { color: color.textStrong },
  modeLine: { flex: 1, minWidth: 160, color: color.text1, fontSize: 13, lineHeight: 18 },
  modeManage: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.guestLine },
  messagesGuests: { backgroundColor: color.canvas },
  repliesOff: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, marginTop: space[4], paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: color.fill.tile },
  repliesOffText: { color: color.text3, fontSize: 13 },
  emptyGuests: { alignItems: "center", gap: space[2], paddingHorizontal: space[6], paddingVertical: space[7] },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.guestLine, backgroundColor: color.infoTint },
  emptyTitle: { color: color.text1, fontSize: 17, fontWeight: "600" },
  emptyText: { color: color.text2, fontSize: 14, lineHeight: 20, textAlign: "center", maxWidth: 380 },
  messageRowBrand: { backgroundColor: color.guestTint2, borderColor: color.guestLine },
  audienceRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  audienceChip: { flexShrink: 1, minHeight: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: radius.full, backgroundColor: color.info },
  audienceText: { flexShrink: 1, color: color.textStrong, fontSize: 13, fontWeight: "600" },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: space[2] },
  sendText: { color: color.textStrong, fontSize: 15, fontWeight: "600" },
  teamUnavailable: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: color.line },
  teamUnavailablePill: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: radius.full, borderWidth: 1, borderColor: color.line, opacity: 0.6 },
  teamUnavailablePillText: { color: color.text4, fontSize: 13, fontWeight: "600" },
  teamUnavailableText: { flex: 1, color: color.text3, fontSize: 13, lineHeight: 18 },
  senderLabel: {
    marginBottom: 4,
    fontSize: 11,
    fontWeight: "700",
    color: color.text3,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: color.text1,
  },
  // #4459: "Posting as <Brand>" under the title.
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: color.text3,
  },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space[4],
    padding: space[6],
  },
  errorText: {
    color: color.text1,
    textAlign: "center",
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: space[4],
    gap: space[2],
  },
  messageRow: {
    maxWidth: "84%",
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  messageRowMine: {
    alignSelf: "flex-end",
    backgroundColor: color.card3,
    borderColor: color.lineStrong,
  },
  messageRowOther: {
    alignSelf: "flex-start",
    backgroundColor: color.fill.inset,
    borderColor: color.line,
  },
  messageRowBlast: {
    alignSelf: "center",
    backgroundColor: color.fill.pressed,
  },
  messageText: {
    color: color.text1,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTextMine: {
    color: color.textStrong,
  },
  messageTextWithImage: {
    marginTop: space[2],
  },
  messageMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space[2],
    marginTop: space[2],
  },
  messageMeta: {
    fontSize: 10,
    color: color.text3,
  },
  composer: {
    // #4420: the Guests composer is loud: a blue wash and a 2px info edge on
    // top. Bottom inset + breathing room is applied inline (see the JSX).
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    borderTopWidth: 2,
    borderTopColor: color.info,
    backgroundColor: color.guestWash,
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: size.btn.phone,
    paddingLeft: space[1],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.guestLine,
    backgroundColor: materials.sheet.solidFill,
  },
  send: {
    minWidth: size.btn.phone,
    height: size.btn.phone,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.info,
  },
  sendIdle: {
    opacity: 0.4,
  },
  input: {
    flex: 1,
    minHeight: size.btn.phone,
    maxHeight: 120,
    paddingHorizontal: space[2],
    paddingTop: 14,
    paddingBottom: 14,
    color: color.text1,
  },
});

export default GroupChatPanel;
