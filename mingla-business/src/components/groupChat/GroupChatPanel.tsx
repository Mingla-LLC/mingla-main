import React, { useEffect, useMemo, useState } from "react";
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
import { useEventGroupChat } from "../../hooks/useEventGroupChat";
import { useEventGroupChatModeration } from "../../hooks/useEventGroupChatModeration";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SafeScreen } from "../ui/SafeScreen";
import { GroupChatModerationSheet } from "./GroupChatModerationSheet";
import { GroupChatMessageMedia } from "./GroupChatMessageMedia";
import { groupChatMediaKind } from "../../utils/groupChatMedia";

export interface GroupChatPanelProps {
  /** A listing: opens its brand's Guest chat (#4459). */
  eventId?: string;
  /** #4459: Messages → Guests opens by brand. */
  brandId?: string;
  /** #4459: the desktop Messages page shows the panel beside the inbox (no Back). */
  embedded?: boolean;
}

export const GroupChatPanel: React.FC<GroupChatPanelProps> = ({ eventId, brandId, embedded = false }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const chat = useEventGroupChat(eventId ?? null, brandId ?? null);
  const moderation = useEventGroupChatModeration(chat.conversation?.id ?? null);
  // #4459: the Guest chat speaks as its brand. Without a brand name (an older
  // or partial conversation row) the copy falls back to the plain wording
  // rather than printing "Message as undefined".
  const postingAs = chat.conversation?.name?.trim() || null;
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

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

  const handleSend = async () => {
    const content = composer.trim();
    if (content.length === 0) return;
    setSending(true);
    try {
      const result = await chat.postMessage(content);
      if (result.error) throw new Error(result.error);
      setComposer("");
    } catch (err) {
      showAlert("Message failed", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSending(false);
    }
  };

  const handleToggleBroadcast = async (value: boolean) => {
    const result = await moderation.setBroadcastOnly(value);
    if (result.error) {
      showAlert("Could not update chat", result.error);
      return;
    }
    await chat.refresh();
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

      {chat.loading ? (
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
          <Text style={styles.errorText}>Your brand's Guest chat isn't ready yet. Try again in a moment.</Text>
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
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
            inverted
            data={invertedMessages}
            keyExtractor={(message) => message.id}
            renderItem={({ item: message }) => {
              // #4459: a brand post stores no sender; its author is team-only.
              const mine = message.sender_id === currentUserId ||
                (message.author_id != null && message.author_id === currentUserId);
              const blast = message.marketing_campaign_id !== null;
              // Team posts read as the brand (the team also sees who sent them);
              // guests by their own name.
              const fromBrand = message.sender_kind === "brand";
              const brandName = postingAs ?? "Your brand";
              const senderLabel = fromBrand
                ? `Sent as ${brandName} by ${mine ? "you" : message.author_name ?? "a teammate"}`
                : mine
                  ? null
                  : message.sender_display_name_snapshot;
              // #4114 Wave 6: Explorer photos and videos are private-bucket
              // paths (signed in GroupChatMessageMedia); view once is never shown.
              const hasImage = groupChatMediaKind(message) !== "none";
              const hasCaption = message.content.length > 0;
              return (
                <View
                  style={[
                    styles.messageRow,
                    mine ? styles.messageRowMine : styles.messageRowOther,
                    blast && styles.messageRowBlast,
                  ]}
                >
                  {senderLabel ? (
                    <Text style={styles.senderLabel} numberOfLines={1}>{senderLabel}</Text>
                  ) : null}
                  {hasImage ? <GroupChatMessageMedia message={message} mine={mine} /> : null}
                  {hasCaption ? (
                    <Text
                      style={[
                        styles.messageText,
                        mine && styles.messageTextMine,
                        hasImage && styles.messageTextWithImage,
                      ]}
                    >
                      {message.content}
                    </Text>
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
              #1834 measured the difference on glass: on iOS 26+ the library floats
              the bar 11pt clear of the keyboard's rounded corners, so it occupies 53
              and a 42pt lift left this composer 11pt behind it. DONE_BAR_OCCUPIED is
              derived from the same inputs the library uses, so an OS or library bump
              moves it without anyone editing this line.

              #1890 F-8 read this offset ALONE and called the screen a 23pt
              undershoot — "the field sits behind the bar". Measured on the
              physical Samsung it was a 59.47dp OVERSHOOT, and C-5's first
              attempt (adding MIN_VISIBLE_CLEARANCE here) pushed it 12.09dp
              further away, to 83.56dp against a 12dp contract. The premise was
              inverted because the reply field does NOT sit on this container's
              bottom edge: the composer's own bottom spacer stands between them,
              and THAT is where the overshoot lived. See the composer's
              paddingBottom below.
              So this offset budgets exactly ONE thing — the occluder. The
              promised visible gap is the composer's own bottom spacer while it
              is lifted, so the two terms are added once, in different places,
              instead of one of them twice. */}
          <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={DONE_BAR_OCCUPIED}>
            <View
              style={[
                styles.composer,
                {
                  // #1890 C-5 REWORK — this is the composer's ONE bottom spacer,
                  // and it must stay the only one: `styles.composer` carries
                  // paddingHorizontal/paddingTop only, so this value alone stands
                  // between the controls' bottom edge and the container's.
                  //
                  // At rest it clears the navigation bar / home indicator
                  // (measured 48 + 24 = 72dp on R58R54YV7JT). While the keyboard
                  // is up the KeyboardAvoidingView above has already put that
                  // container edge on the Done bar, so the resting value would be
                  // 72dp of dead space — which is exactly the overshoot #1890
                  // TEST measured. Lifted, the composer owes the promised visible
                  // gap and nothing else.
                  paddingBottom: liftedBottomSpacer(
                    keyboardHeight > 0,
                    Math.max(insets.bottom, 0) + space[6],
                  ),
                },
              ]}
            >
              {/* #4420 round 3 (6, 24): floating composer; send is an
                  icon-only Paper circle, dimmed until there is a message.
                  #4459: Guest chats are text only in v1 (no attach button). */}
              <View style={styles.field}>
              <TextInput
                value={composer}
                onChangeText={setComposer}
                placeholder={postingAs ? `Message as ${postingAs}` : "Write a reply"}
                placeholderTextColor={color.text3}
                style={styles.input}
                multiline
              />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: composer.trim().length === 0 || sending, busy: sending }}
                onPress={handleSend}
                disabled={composer.trim().length === 0 || sending}
                style={[
                  styles.send,
                  (composer.trim().length === 0 || sending) && styles.sendIdle,
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={color.ink} />
                ) : (
                  <Icon
                    name="send"
                    size={20}
                    color={composer.trim().length === 0 ? color.text4 : color.ink}
                  />
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </>
      )}

      <GroupChatModerationSheet
        visible={moderationOpen}
        onClose={() => setModerationOpen(false)}
        broadcastOnly={chat.conversation?.is_broadcast_only ?? false}
        participants={moderation.participants}
        loading={moderation.loading}
        onToggleBroadcastOnly={handleToggleBroadcast}
        onRemoveParticipant={handleRemoveParticipant}
      />
    </SafeScreen>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.card,
  },
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
    // Floats over the chat list (no top border / backdrop) — bottom inset + extra
    // breathing room is applied inline via insets in the JSX above.
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: size.btn.phone,
    paddingLeft: space[1],
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: materials.sheet.solidFill,
  },
  send: {
    width: size.btn.phone,
    height: size.btn.phone,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper,
  },
  sendIdle: {
    backgroundColor: color.card2,
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
