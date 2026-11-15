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
