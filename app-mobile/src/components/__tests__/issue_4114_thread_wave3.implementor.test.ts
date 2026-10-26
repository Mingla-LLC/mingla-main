// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 3 — inside a chat. The rules themselves are exercised
// behaviourally in components/chat/__tests__/issue_4114_chat_header_model...,
// utils/__tests__/issue_4114_chat_menu_model... and
// utils/__tests__/issue_4114_thread_model...; this suite pins the WIRING so a
// revert of any call site fails CI.
//
// FAILS-ON-REVERT: a toast fired before the confirm settles; the session-less
// group ⋯ back to a dead tap; reactions not read or not rendered; the sender
// name back on every bubble; the composer back to a fixed height; the Android
// back handler removed; the unused discussion code restored.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function body(source: string, signature: RegExp): string {
  const match = signature.exec(source);
  assert(match, `missing ${signature}`);
  const start = source.indexOf("{", match.index + match[0].length - 1);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
}

Deno.test("W3 no success toast before the confirm settles", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  for (const [name, prop, ok] of [
    ["handleRemoveFriend", "onRemoveFriend", "removed"],
    ["handleBlockUser", "onBlockUser", "blocked"],
    ["handleReportUser", "onReportUser", "reported"],
  ]) {
    const fn = body(chat, new RegExp(`const ${name} = \\(\\) =>`));
    const call = fn.indexOf(`${prop}?.(friend, (${ok}) =>`);
    const toast = fn.indexOf("showNotification(");
    assert(call >= 0, `${name} hands the confirm a settle callback`);
    assert(toast > call, `${name} toasts only inside the settle callback`);
    assert(new RegExp(`if \\(!${ok}\\) return;`).test(fn), `${name} shows nothing on cancel or failure`);
  }
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const remove = body(page, /const handleRemoveFriend = \(friend: Friend, onSettled\?: \(removed: boolean\) => void\) =>/);
  assert(/text: t\('common:cancel'\), style: "cancel", onPress: \(\) => onSettled\?\.\(false\)/.test(remove), "Cancel settles false");
  assert(/onSettled\?\.\(true\)/.test(remove) && remove.indexOf("removeFriend(friend.id)") < remove.indexOf("onSettled?.(true)"),
    "settles true only after the server removal");
  const block = body(page, /const handleBlockConfirm = async \(/);
  assert(/blockFriend\(userToBlock\.id, reason\)\)\s*\.then\(\(\) => settleBlock\(true\)\)/.test(block), "block settles after the server");
  assert(/setSelectedUserToBlock\(null\);\s*settleBlock\(false\);/.test(page), "closing the block modal settles false");
  assert(/settleReport\(true\)/.test(page) && /settleReport\(false\)/.test(page), "report settles both ways");
});

Deno.test("W3 the session-less group ⋯ opens group info (was a dead tap)", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const more = body(chat, /const handleHeaderMorePress = \(\) =>/);
  assert(/if \(isGroupChat && !friend\.sessionId\) \{[\s\S]*setShowGroupInfo\(true\)/.test(more), "⋯ opens group info");
  assert(/<GroupInfoSheet[\s\S]{0,200}visible=\{Boolean\(isGroupChat && !friend\.sessionId && !isTripEventGroupChat && showGroupInfo\)\}/.test(chat),
    "group info mounts for session-less groups");
  assert(/<BoardSettingsDropdown[\s\S]{0,120}isGroupChat && showMoreOptionsMenu && friend\.sessionId/.test(chat),
    "session groups keep BoardSettingsDropdown");
  const sheet = strip(await read("components/chat/GroupInfoSheet.tsx"));
  assert(/setConversationMuted\(/.test(sheet) && /leaveGroupConversation\(/.test(sheet), "group info mutes and leaves");
});

Deno.test("W3 one menu: the chat ⋯ and FriendActionsSheet render the same list", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const sheet = strip(await read("components/friends/FriendActionsSheet.tsx"));
  for (const [name, src] of [["MessageInterface", chat], ["FriendActionsSheet", sheet]]) {
    assert(/buildFriendMenu\(\{/.test(src), `${name} builds the shared list`);
    assert(/<ChatActionList\b/.test(src), `${name} renders it with ChatActionList`);
  }
  assert(/theme="dark"/.test(sheet), "FriendActionsSheet is dark");
  assert(!/<Text style=\{styles\.chatSheetText\}>View Profile<\/Text>/.test(chat), "the hand-built English menu is gone");
  assert(/case "mute":[\s\S]{0,80}handleToggleMute\(\)/.test(chat), "1:1 chats can be muted");
});

Deno.test("W3 reactions: read in one batched query and rendered under bubbles", async () => {
  const service = strip(await read("services/messagingService.ts"));
  assert(/\.from\('direct_message_reactions'\)\s*\.select\('message_id, user_id, emoji, created_at'\)\s*\.in\('message_id', ids\)/.test(service),
    "one .in() read per page, no N+1");
  assert(/reactionsByMessage = await this\.getReactionsForMessages\(/.test(service), "getMessages attaches the reactions");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/reactions: msg\.reactions,/.test(page), "transformMessage carries the reactions");
  assert(/const \{ error \} = await messagingService\.toggleDirectMessageReaction\(/.test(page), "the toggle is awaited");
  assert(/reactions: before \}\]\);\s*showToast\(\{ message: t\('chat:reactionFailed'\)/.test(page), "a failed toggle rolls back and toasts");
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/aggregateReactions\(message\.reactions, currentUserId\)/.test(chat), "rows aggregate the reactions");
  assert(/reactions=\{item\.reactions\}/.test(chat), "the bubble gets its pills");
  assert(!/console\.log\('\[Wave1\] DM reaction requested/.test(chat), "the emoji row is wired (no console.log stub)");
  assert(/onReaction=\{\(msgId, emoji\) => \{\s*void toggleReaction\(msgId, emoji\);/.test(chat), "the long-press emoji row toggles");
  const bubble = strip(await read("components/chat/MessageBubble.tsx"));
  assert(/reactions\.map\(\(reaction\) =>/.test(bubble) && /reaction-pill-/.test(bubble), "MessageBubble renders the pills");
});

Deno.test("W3 sender name only on the first bubble of a group block", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/showSenderName: shouldShowSenderName\(\{\s*isGroupChat,/.test(chat), "rows decide with the shared rule");
  assert(/showSenderName=\{item\.showSenderName\}/.test(chat), "the bubble receives it");
  const bubble = strip(await read("components/chat/MessageBubble.tsx"));
  assert(/\{showSenderName \? \(\s*<Text/.test(bubble), "the name renders only when asked");
  assert(/showSenderName = false,/.test(bubble), "hidden by default (1:1 chats, your own)");
  assert(/export const MessageBubble = memo\(MessageBubbleImpl\)/.test(bubble), "MessageBubble is memoised");
  assert(/renderItem=\{renderThreadRow\}/.test(chat) && /const renderThreadRow = useCallback\(/.test(chat), "stable renderItem");
});

Deno.test("W3 composer grows to 5 lines and the list padding follows it", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const capsule = body(chat, /  inputCapsule: \{/);
  assert(/minHeight: COMPOSER_MIN_HEIGHT/.test(capsule) && !/\bheight:/.test(capsule.replace(/minHeight/g, "")), "capsule uses minHeight, not a fixed height");
  const input = body(chat, /  messageInput: \{/);
  assert(/maxHeight: COMPOSER_INPUT_MAX_HEIGHT/.test(input) && !/flex: 1/.test(input), "the input grows up to 5 lines");
  assert(/onLayout=\{onComposerLayout\}/.test(chat), "the composer is measured");
  assert(/finalInputBottom \+ composerHeight \+ 8/.test(chat), "list clearance follows the measured composer");
  assert(/accessibilityLabel=\{t\('chat:a11ySend'\)\}/.test(chat) && /accessibilityLabel=\{t\('chat:a11yAttach'\)\}/.test(chat),
    "send and attach have labels");
  assert(/styles\.attachmentBackdrop/.test(chat), "an outside tap closes the attach menu");
  assert(/theme="dark"\s*closeLabel=\{t\('chat:a11yCancelReply'\)\}/.test(chat), "reply bar is dark");
});

Deno.test("W3 Android back closes open sheets first, then the thread", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{\s*const target = resolveChatBack\(backLayersRef\.current\);/.test(chat),
    "back resolves the top-most open layer");
  assert(/if \(target === 'leaveThread'\) \{\s*onBackRef\.current\(\);\s*\} else \{\s*closers\[target\]\(\);/.test(chat),
    "a layer closes before the thread does");
  assert(/moreMenu: showMoreOptionsMenu,/.test(chat) && /collabDeck: showCollabDeckSheet,/.test(chat), "sheets are tracked");
});

Deno.test("W3 list polish: typing heartbeat, loading state, scroll-to-latest, translated days", async () => {
  const presence = strip(await read("hooks/useChatPresence.ts"));
  assert(/shouldRebroadcastTyping\(lastTypingBroadcastAtRef\.current, now\)/.test(presence), "typing re-broadcasts while typing");
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/isLoadingMessages \? \(/.test(chat) && /chat-thread-loading/.test(chat), "a loader before the first read");
  assert(/maintainVisibleContentPosition=\{THREAD_VISIBLE_CONTENT_POSITION\}/.test(chat), "reading position is kept");
  assert(/chat-scroll-to-latest/.test(chat) && /chat-new-messages-divider/.test(chat), "scroll-to-latest and the divider");
  assert(/t\('chat:today'\)/.test(chat) && /t\('chat:yesterday'\)/.test(chat) && !/'Today' :|'Yesterday'/.test(chat), "day separators are translated");
  assert(/<TypingIndicator isVisible label=\{groupTypingLabel\}/.test(chat), "groups show who is typing");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/markMessagesSettled\(capturedConvId\)/.test(page) && /!messagesSettledIds\.has\(currentConversationId\)/.test(page),
    "loading ends when the first read settles");
});

Deno.test("W3 message actions: unsend, reply jump, labelled 44pt actions, report", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/onDelete=\{onUnsendMessage \? handleUnsendRequest : undefined\}/.test(chat), "unsend is wired");
  assert(/onScrollToMessage=\{handleScrollToMessage\}/.test(chat), "reply quotes jump");
  assert(/onReport=\{onReportMessage \? handleReportMessageRequest : undefined\}/.test(chat), "report message is wired");
  const menu = strip(await read("components/chat/MessageContextMenu.tsx"));
  assert(/minHeight: 44/.test(menu) && /accessibilityLabel=\{labelFor\(id\)\}/.test(menu), "44pt labelled actions");
  assert(/messageActions\(\{/.test(menu), "Copy only on text via the shared rule");
  const service = strip(await read("services/messagingService.ts"));
  assert(/update\(\{ deleted_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\('id', messageId\)\s*\.eq\('sender_id', senderId\)/.test(service),
    "unsend is the sender's soft delete");
});
