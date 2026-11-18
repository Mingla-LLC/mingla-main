// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 QA round 1 (tester comment on #4435): the app fixes. Pure rules run
// for real; the screens are pinned by behaviour markers in their source (no
// RN renderer in the Deno lane).
// FAILS-ON-REVERT: put the lifecycle binding back on the combined social
// channel, open Add people from the deck on a timer, keep a removed member
// hidden forever, use dark text on the deck's black, drop the singular "time"
// strings, show "Start your conversation" after Clear chat, throw away a late
// Group info load, drop the plan sheet's top inset or Done-bar spacer, or put
// the Undo bar back inside the scrolling body, and a case fails.
import { pruneHiddenMembers } from "../../../utils/groupChatModel.ts";

const root = new URL("../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert(start >= 0, `marker ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert(end > start, `marker ${to} after ${from}`);
  return source.slice(start, end);
}

Deno.test("F-1 the chat-list lifecycle listener has its own channel, apart from tables the server does not publish", () => {
  const hook = strip(read("src/hooks/useSocialRealtime.ts"));
  const combined = between(hook, ".channel(`social-realtime-", ".subscribe();");
  const lifecycle = between(hook, ".channel(`chat-lifecycle-", ".subscribe();");
  assert(!/conversation_participant_lifecycle/.test(combined), "lifecycle is not on the combined channel");
  // #4435 leftovers (#4275): the three unpublished tables are no longer bound
  // anywhere (they silenced the whole social channel); see
  // issue_4435_social_realtime.implementor.test.ts.
  for (const table of ["friend_requests", "pending_invites", "message_reads"]) {
    assert(!hook.includes(`table: "${table}"`), `${table} is not bound on any channel`);
  }
  assert(/table: "conversation_participant_lifecycle",\s*filter: `user_id=eq\.\$\{userId\}`/.test(lifecycle), "my rows only");
  assert(/invalidateQueries\(\{ queryKey: chatListKeys\.all \}\)/.test(lifecycle), "the Chats list refetches");
  assert(/`chat-lifecycle-\$\{userId\}:\$\{ownerRef\.current\}:\$\{channelEpoch\}`/.test(hook), "keyed like the social channel (#3988 remounts)");
  assert(/void supabase\.removeChannel\(channel\);\s*void supabase\.removeChannel\(lifecycleChannel\);/.test(hook), "both channels are removed on cleanup");
});

Deno.test("F-2 the deck's Add people opens Group info only after the deck's modal is gone, and Group info never presents first", () => {
  const deck = strip(read("src/components/connections/CollabDeckSheet.tsx"));
  assert(/onDismiss=\{flushAfterClose\}/.test(deck), "iOS: runs on the deck modal's onDismiss");
  assert(/if \(!visible && Platform\.OS !== "ios"\) flushAfterClose\(\);/.test(deck), "Android: runs on the visible -> false edge");
  assert(/pendingAfterCloseRef\.current = onAddGroupPeople;\s*setShowPrefsSheet\(false\);\s*onClose\(\);/.test(deck), "closes the deck, holds the action");
  assert(/onAddGroupPeople=\{handleAddGroupPeople\}/.test(deck), "the deck's button goes through the hand-off");
  const thread = strip(read("src/components/MessageInterface.tsx"));
  const mount = between(thread, "<CollabDeckSheet", "/>");
  assert(!/setTimeout/.test(mount), "no timer racing the iOS dismissal");
  assert(/onAddGroupPeople=\{friend\.sessionId \? \(\) => \{ setGroupInfoStartsOnAdd\(true\); setShowGroupInfo\(true\); \}/.test(mount), "opens Group info on Add people");
  const info = strip(read("src/components/chat/GroupInfoSheet.tsx"));
  // #4459: a brand Guest chat never offers Add people either.
  assert(/const showAdd = !managed && !isBrandGuests && \(addingPeople \|\| \(startWithAddPeople && !backFromAdd\)\);/.test(info), "Add people is derived in render");
  assert(/visible=\{visible && !showAdd\}/.test(info) && /visible=\{visible && showAdd\}/.test(info), "exactly one of the two sheets per open");
  assert(!/if \(visible && startWithAddPeople && !managed\) setAddingPeople\(true\)/.test(info), "no effect that flips the sheets after the first render");
});

Deno.test("F-3 a removed member's hide ends once the server's list drops them, so a re-added member shows", () => {
  const hidden = new Set(["tobi"]);
  assert(pruneHiddenMembers(hidden, ["me", "tobi"], ["tobi"]) === hidden, "a held remove stays hidden (unchanged set)");
  assert(pruneHiddenMembers(hidden, ["me", "tobi"], []) === hidden, "still listed (list not reloaded yet): still hidden");
  const after = pruneHiddenMembers(hidden, ["me"], []);
  assert(after !== hidden && after.size === 0, "gone from the server's list: the hide is dropped");
  assert(!pruneHiddenMembers(after, ["me", "tobi"], []).has("tobi"), "re-added later: shows again");
  const empty = new Set<string>();
  assert(pruneHiddenMembers(empty, ["me"], []) === empty, "nothing hidden: same set");
  const info = strip(read("src/components/chat/GroupInfoSheet.tsx"));
  assert(/setHidden\(\(prev\) => pruneHiddenMembers\(prev, ids, deferredRef\.current\.pending\(\)\)\);/.test(info), "Group info reconciles on each member list");
  assert(/\}, \[session\?\.members, session\?\.loading\]\);/.test(info), "runs when the member list changes");
});

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

Deno.test("F-4 the group-of-one deck's Add people reads on black (WCAG AA, design-system tokens)", () => {
  const cards = strip(read("src/components/SwipeableCards.tsx"));
  const text = between(cards, "soloSecondaryButtonText: {", "}");
  const button = between(cards, "soloSecondaryButton: {", "}");
  assert(/color: colors\.text\.inverse/.test(text), "text uses the inverse text token");
  assert(/borderColor: colors\.gray\[300\]/.test(button), "outline uses a gray token");
  const ds = read("src/constants/designSystem.ts");
  const inverse = /inverse: '(#[0-9a-fA-F]{6})'/.exec(ds)?.[1];
  const gray300 = /300: '(#[0-9a-fA-F]{6})'/.exec(between(ds, "gray: {", "}"))?.[1];
  assert(inverse && gray300, "tokens resolve");
  const deck = /container: \{\s*flex: 1,\s*backgroundColor: "(#[0-9A-Fa-f]{6})"/.exec(read("src/components/connections/CollabDeckSheet.tsx"))?.[1];
  assert(deck === "#000000", "the deck is black");
  assert(contrast(inverse, deck) >= 4.5, "text contrast at least 4.5:1");
  assert(contrast(gray300, deck) >= 3, "outline contrast at least 3:1");
});

Deno.test("P3 one time to vote on is singular (i18n plural keys)", () => {
  const en = JSON.parse(read("src/i18n/locales/en/chat.json"));
  assert(en.plan_fold_poll_one === "{{count}} time to vote on", "en singular");
  assert(en.plan_fold_poll_leading_one === "{{count}} time · leading {{time}}", "en singular, leading");
  assert(/times/.test(en.plan_fold_poll) && /times/.test(en.plan_fold_poll_leading), "plural stays the fallback");
  for (const lang of ["bin", "de", "el", "es", "fr", "it", "nl", "pt", "ro", "sv", "he", "ar"]) {
    const l = JSON.parse(read(`src/i18n/locales/${lang}/chat.json`));
    assert(typeof l.plan_fold_poll_one === "string" && typeof l.plan_fold_poll_leading_one === "string", `${lang} has the singular`);
    assert(l.plan_fold_poll_leading_one.includes("{{time}}"), `${lang} keeps the leading time`);
  }
  const bubble = strip(read("src/components/chat/PlanCardBubble.tsx"));
  assert(/t\("chat:plan_fold_poll", \{ count: line\.count \}\)/.test(bubble), "the card passes count (plural resolution)");
});

Deno.test("P3 right after Clear chat the empty thread says it was cleared", () => {
  const thread = strip(read("src/components/MessageInterface.tsx"));
  // #4459: the removed card comes first; the empty thread is the next branch.
  const empty = between(thread, ") : visibleMessages.length === 0 ? (", "<FlatList");
  const cleared = empty.indexOf("(isClearingChat || clearedAt) && !isTripEventGroupChat ?");
  const start = empty.indexOf("t('chat:startConversation')");
  assert(cleared > 0 && start > cleared, "the cleared notice is checked before the start-conversation state");
  assert(/t\("chat:cleared_notice"\)/.test(empty.slice(cleared, start)), "says You cleared this chat");
});

Deno.test("P3 Group info's first member load is not thrown away when it lands late, and opening retries a failed load", () => {
  const hook = strip(read("src/hooks/useBoardSession.ts"));
  assert(!/if \(didTimeout \|\| loadSessionIdRef\.current !== loadId\) return;/.test(hook), "a late answer is not discarded");
  assert(/if \(loadSessionIdRef\.current !== loadId\) return;/.test(hook), "only a newer load supersedes it");
  assert(/participants: participantsResult\.data \|\| \[\],\s*\} as BoardSession\);\s*setError\(null\);/.test(hook), "a good answer clears the timeout error");
  const info = strip(read("src/components/chat/GroupInfoSheet.tsx"));
  assert(/if \(visible && sessionNeedsLoad\) retryMembers\?\.\(\);/.test(info), "opening after a failed load loads again");
});

Deno.test("P3 the plan sheet stays below the status bar and Post clears the keyboard's Done bar", () => {
  const sheet = strip(read("src/components/chat/PlanFormSheet.tsx"));
  assert(/topInset=\{planSheetTopInset\(insets\.top\)\}/.test(sheet), "top inset from the safe area");
  assert(/return Math\.max\(0, safeTop\) \+ 8;/.test(sheet), "8pt of breathing room under the status bar");
  const footer = between(sheet, "stickyFooter={", "scrollProps=");
  assert(/<KeyboardToolbarSpacer \/>/.test(footer), "the footer lifts Post above the Done bar");
  assert(/toolbarSpacer: \{ height: KEYBOARD_TOOLBAR_HEIGHT \}/.test(sheet), "by the Done bar's height");
  assert(/const keyboardUp = useKeyboardIsVisible\(\);/.test(sheet), "only while the keyboard is up");
});

Deno.test("P3 the Undo bar (Remove and Make admin) is pinned to the sheet window, not the scrolling body", () => {
  const info = strip(read("src/components/chat/GroupInfoSheet.tsx"));
  const body = between(info, '<View style={styles.body} testID="group-info-sheet">', "</BaseBottomSheet>");
  assert(!/group-undo-bar/.test(body), "not inside the scrolling body");
  const overlay = between(info, "overlay={undo ? (", ") : undefined}");
  assert(/testID="group-undo-bar"/.test(overlay), "rendered in the viewport-fixed overlay");
  assert(/undo\.madeAdmin/.test(overlay), "covers Make admin and Remove admin");
  assert(/onPress=\{onUndo\}/.test(overlay), "Undo still works");
});
