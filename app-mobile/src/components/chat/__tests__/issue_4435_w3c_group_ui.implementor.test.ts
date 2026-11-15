// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 W3c: the group UI on the approved model. Pure rules run for real
// (push, Undo window, member order, leave heir); the screens are pinned by
// behaviour markers in their source (no RN renderer in the Deno lane).
// FAILS-ON-REVERT: restore today's create sheet (name + a friend required, no
// picker cap), drop the push, or send Remove before the Undo window, and a
// case fails.
import {
  addedToGroupPush, addedToGroupRecipients, createDeferredAction, leaveHeir, MAX_CREATE_PICKS,
  REMOVE_UNDO_MS, sortGroupMembers,
} from "../../../utils/groupChatModel.ts";

const root = new URL("../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("#4435 Q3 push: one per added friend, 'Ada added you to …', never the adder", () => {
  equals(addedToGroupPush("Ada", "Saturday crew").title, "Ada added you to Saturday crew", "title");
  equals(addedToGroupRecipients(["t", "k", "t", "me", ""], "me"), ["t", "k"], "deduped, no adder, no blanks");
  const svc = strip(read("src/services/boardNotificationService.ts"));
  const fn = svc.slice(svc.indexOf("export function notifyAddedToGroup"));
  assert(/type: 'session_member_joined'/.test(fn), "rides the existing session push type (preference + mute)");
  assert(!/emailTo|email/.test(fn.slice(0, fn.indexOf("\n}\n"))), "no email");
  assert(/addedToGroupRecipients\(addedUserIds, actorId\)/.test(fn), "only the added ids");
});

Deno.test("#4435 create: pick first, nobody required, 14 picks, live chat + link sheet, push to the added", () => {
  equals(MAX_CREATE_PICKS, 14, "14 picks");
  const sheet = strip(read("src/components/connections/CreateGroupChatSheet.tsx"));
  assert(/<GroupFriendPicker[\s\S]*?slots=\{MAX_CREATE_PICKS\}/.test(sheet), "the picker stops at 14");
  assert(!/name\.trim\(\)\.length > 0 && selectedIds\.size > 0/.test(sheet), "no name + friend requirement");
  assert(/resolvedGroupName\(name, fallbackName\)/.test(sheet), "blank name uses the default");
  assert(/chat:group_create_just_me/.test(sheet) && /chat:group_create_next/.test(sheet), "Just me for now / Next");
  const page = strip(read("src/components/ConnectionsPage.tsx"));
  assert(/void handleSelectConversation\(createdConversation\)/.test(page), "the chat opens at once");
  assert(/setLiveGroup\(\{/.test(page) && /<GroupLiveSheet/.test(page), "the link sheet follows");
  assert(!/group_invites_sent/.test(page), "no 'invites sent, opens once someone accepts' toast");
  const index = strip(read("app/index.tsx"));
  assert(/notifyAddedToGroup\(\{[\s\S]*?addedUserIds: created\.added/.test(index), "push only to the server's added ids");
  const live = strip(read("src/components/chat/GroupLiveSheet.tsx"));
  assert(/<GroupLinkCard conversationId=\{conversationId\} groupName=\{groupName\} withSettings=\{false\}/.test(live), "Share / Copy / QR");
});

Deno.test("#4435 link card: Share, Copy, QR; admins get approval + reset, members a note", () => {
  const card = strip(read("src/components/chat/GroupLinkCard.tsx"));
  assert(/Share\.share\(/.test(card) && /Clipboard\.setString\(url\)/.test(card) && /<QRCode value=\{qrLink\}/.test(card), "three actions");
  assert(/canManage \?[\s\S]*?<Switch[\s\S]*?confirmReset/.test(card), "admin row");
  assert(/group_link_member_note_on/.test(card), "member note");
});

Deno.test("#4435 Undo window: nothing runs before 6 s; Undo cancels; close flushes", () => {
  equals(REMOVE_UNDO_MS, 6000, "6 seconds");
  const timers = new Map<number, () => void>();
  let next = 1;
  const clock = { set: (fn: () => void) => { const id = next++; timers.set(id, fn); return id; }, clear: (id: number) => { timers.delete(id); } };
  const ran: string[] = [];
  const d = createDeferredAction(REMOVE_UNDO_MS, clock);
  d.schedule("tobi", () => ran.push("tobi"));
  equals(ran, [], "no server call yet");
  assert(d.cancel("tobi"), "undo finds it");
  equals(timers.size, 0, "timer cleared");
  equals(ran, [], "Undo: never sent");
  d.schedule("kemi", () => ran.push("kemi"));
  d.schedule("ola", () => ran.push("ola"));
  [...timers.values()][0]();
  equals(ran, ["kemi"], "the window ends: sent");
  d.flush();
  equals(ran, ["kemi", "ola"], "sheet closed: sent at once");
  equals(d.pending(), [], "nothing left");
  assert(!d.cancel("ola"), "too late to undo");
});

Deno.test("#4435 member order and the leave heir follow the server's joined_at order", () => {
  const m = (userId, isCreator, isAdmin, joinedAt) => ({ userId, isCreator, isAdmin, joinedAt });
  const rows = [m("k", false, false, "2026-01-03"), m("c", true, true, "2026-01-01"), m("me", false, true, "2026-01-02"), m("t", false, false, null)];
  equals(sortGroupMembers(rows, "me").map((r) => r.userId), ["me", "c", "k", "t"], "you, creator, then by join, nulls last");
  equals(leaveHeir([m("me", false, true, "1"), m("t", false, false, null), m("k", false, false, "3")], "me")?.userId, "k", "longest-standing, NULLS LAST");
  equals(leaveHeir([m("me", false, true, "1"), m("a", false, true, "2")], "me"), null, "another admin stays: no heir");
  equals(leaveHeir([m("me", false, false, "1"), m("k", false, false, "2")], "me"), null, "a non-admin leaving hands nothing over");
});

Deno.test("#4435 Add people: link on top, phone invite, In group / Group full, one call, push to the added", () => {
  const sheet = strip(read("src/components/chat/AddGroupPeopleSheet.tsx"));
  const link = sheet.indexOf("<GroupLinkCard conversationId={conversationId} groupName={groupName} withSettings />");
  assert(link > 0 && link < sheet.indexOf("<GroupFriendPicker"), "the link card sits above the friends");
  assert(/const slots = isSession \? remainingSlots\(accepted\) : MAX_ADD;/.test(sheet), "session cap = 15 minus accepted");
  assert(/inGroupIds=\{inGroup\}/.test(sheet) && /slots=\{slots\}/.test(sheet), "In group and Group full rows");
  assert(/<GroupPhoneInvite sessionId=\{sessionId\}/.test(sheet), "invite by phone number");
  assert(/addMembers\.mutate\(picked,/.test(sheet), "one add_group_members call");
  assert(/notifyAddedToGroup\(\{[\s\S]*?addedUserIds: result\.added/.test(sheet), "push only to the server's added ids");
  const phone = strip(read("src/components/chat/GroupPhoneInvite.tsx"));
  const cold = phone.indexOf('if (outcome.kind === "cold" && !outcome.texted) {');
  assert(cold > 0 && cold < phone.indexOf("Alert.alert("), "a cold invite not texted never claims it went out");
});

Deno.test("#4435 group info for session groups: roles, held remove with Undo, leave variants, delete", () => {
  const info = strip(read("src/components/chat/GroupInfoSheet.tsx"));
  const confirm = info.slice(info.indexOf("const confirmRemove ="), info.indexOf("const setAdmin ="));
  assert(/deferredRef\.current\.schedule\(member\.userId,/.test(confirm), "Remove is held for the Undo window");
  assert(!/removeGroupMember\(/.test(confirm), "no server call at confirm time");
  assert(/createDeferredAction\(REMOVE_UNDO_MS/.test(info), "6-second window");
  assert(/deferredRef\.current\.cancel\(undo\.userId\)/.test(info), "Undo cancels the held call");
  assert(/if \(!visible\) deferredRef\.current\.flush\(\);/.test(info), "sheet closed: sent at once");
  assert(/AppState\.addEventListener\("change"[\s\S]*?deferredRef\.current\.flush\(\)/.test(info), "app backgrounded: sent at once");
  assert(/await setGroupAdmin\(conversationId, member\.userId, makeAdmin\)/.test(info), "roles through set_group_admin");
  assert(/memberActions\(viewerRole, member\)/.test(info), "who can manage whom comes from the model");
  assert(/onLongPress=/.test(info), "long-press opens the same actions");
  assert(/leaveCopyVariant\(acceptedCount\)/.test(info) && /group_leave_last_body/.test(info) && /group_leave_second_body/.test(info), "leave copy variants");
  assert(/leaveHeir\(sessionMembers, currentUserId\)/.test(info), "last admin hands over in the copy");
  assert(/leaveGroupConversation\(conversationId, currentUserId\)/.test(info), "leave through leave_group_conversation");
  assert(/await deleteGroup\(session\.sessionId, currentUserId\)/.test(info), "creator deletes through the service");
  assert(/pendingRequests\.map[\s\S]*?<GroupJoinRequestCard/.test(info), "join requests at the top");
  const chat = strip(read("src/components/MessageInterface.tsx"));
  assert(!/<BoardSettingsDropdown/.test(chat), "the chat no longer uses the board settings sheet");
  assert(!/from\("session_participants"\)\s*\.delete\(\)/.test(chat), "no client-side leave delete in the chat");
  assert(/session=\{sessionGroupInfo\}/.test(chat), "session groups pass their roles");
});

import {
  clearOpenPlanCards, foldedPlanAction, foldedPlanLine, isPlanCardOpen, planFormMissing, setPlanCardOpen,
} from "../planModel.ts";

const basePlan = (over = {}) => ({
  id: "p", title: "Rooftop", status: "deciding", whenMode: "set", whereKind: "none", canLock: false,
  options: [], places: [], scheduledAt: null, place: null, link: null, commentCount: 0,
  rsvps: { going: [], maybe: [], cant: [] }, ...over,
});

Deno.test("#4435 folded card: one action and line 2 per plan state", () => {
  equals(foldedPlanAction(basePlan({ status: "scheduled" })), "rsvp", "a set plan: Going / Maybe / Can't");
  equals(foldedPlanAction(basePlan({ status: "cancelled" })), "none", "cancelled: nothing");
  equals(foldedPlanAction(basePlan({ whenMode: "poll", options: [{ id: "o", startsAt: "2099-01-01T19:00:00Z", voterIds: [] }] })), "vote_time", "a time vote");
  equals(foldedPlanAction(basePlan({ whenMode: "poll", canLock: true, options: [{ id: "o", startsAt: "2099-01-01T19:00:00Z", voterIds: ["a"] }] })), "lock", "the maker locks a voted time");
  equals(foldedPlanAction(basePlan({ places: [{ voterIds: [] }, { voterIds: [] }] })), "vote_place", "a place vote");
  const poll = foldedPlanLine(basePlan({ whenMode: "poll", options: [
    { id: "a", startsAt: "2099-01-02T19:00:00Z", voterIds: ["x"] },
    { id: "b", startsAt: "2099-01-03T19:00:00Z", voterIds: ["x", "y"] },
    { id: "c", startsAt: "2099-01-04T19:00:00Z", voterIds: [] },
  ] }), "en-US", "UTC");
  equals(poll.kind, "poll", "poll line");
  equals(poll.count, 3, "3 times");
  assert(typeof poll.leadingTime === "string" && poll.leadingTime.length > 0, "leading time named");
  const set = foldedPlanLine(basePlan({ status: "scheduled", scheduledAt: "2099-01-02T19:00:00Z", place: { name: "Rooftop bar" } }), "en-US", "UTC");
  equals(set.kind, "when_where", "when · where");
  equals(set.place, "Rooftop bar", "where");
});

Deno.test("#4435 decision F: folded by default; an opened card stays open until the chat closes", () => {
  assert(!isPlanCardOpen("c1", "p1"), "folded by default");
  setPlanCardOpen("c1", "p1", true);
  assert(isPlanCardOpen("c1", "p1"), "stays open (scroll away and back)");
  assert(!isPlanCardOpen("c2", "p1"), "per chat");
  clearOpenPlanCards("c1");
  assert(!isPlanCardOpen("c1", "p1"), "closing the chat forgets it");
  const bubble = strip(read("src/components/chat/PlanCardBubble.tsx"));
  assert(/useState\(\(\) => isPlanCardOpen\(conversationId, planId\)\)/.test(bubble), "the card starts folded");
  assert(/accessibilityState=\{\{ expanded: open \}\}/.test(bubble), "the header is one button with expanded state");
  assert(/\{open \? \([\s\S]*?<PlanCardDetails/.test(bubble), "opening shows PlanCardDetails");
  assert(/LayoutAnimation\.configureNext\([\s\S]*?duration: 220/.test(bubble) && /reduceMotion/.test(bubble), "220 ms, cross-fade under Reduce Motion");
  const chat = strip(read("src/components/MessageInterface.tsx"));
  assert(/return \(\) => clearOpenPlanCards\(conversationId\)/.test(chat), "cleared when the chat closes");
  assert(/t\('chat:plan_member_left'/.test(chat), "removed members read '(left)'");
});

Deno.test("#4435 plan sheet: sticky Post says what's missing; same payload; auto-lock line", () => {
  const blank = { title: "", where: "none", place: null, placeLink: "", link: "", when: "set", date: "", time: "19:00", options: [], openTimes: false, note: "" };
  equals(planFormMissing(blank), "what", "nothing yet");
  equals(planFormMissing({ ...blank, title: "Drinks" }), "set_time", "needs a time");
  equals(planFormMissing({ ...blank, title: "Drinks", when: "poll" }), "vote_times", "needs 2 times");
  equals(planFormMissing({ ...blank, title: "Drinks", date: "2099-01-01" }), null, "ready");
  const sheet = strip(read("src/components/chat/PlanFormSheet.tsx"));
  assert(/stickyFooter=\{/.test(sheet) && /chat:plan_missing_\$\{missing\}/.test(sheet), "sticky Post with the missing line");
  assert(/const input = planCreateInput\(form, conversationId, clientId\);/.test(sheet), "the server payload is unchanged");
  assert(/memberCount >= 2 \? t\("chat:plan_auto_lock_group"\) : t\("chat:plan_auto_lock_solo"\)/.test(sheet), "auto-lock line, group of one");
  assert(/noteOpen \|\| form\.note \?/.test(sheet), "the note is folded");
});
