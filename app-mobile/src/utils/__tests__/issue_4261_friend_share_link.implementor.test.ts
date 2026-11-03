// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 Wave B1: the personal invite link, the group link, and what the
// app does when one is opened (spec 5.2, 5.3, 8.3 #2).
//
// MINGLA-INVARIANT: I-4261-INVITE-LINK-PERSONAL | issue #4261 | The generic Share an invite always carries the sharer's personal friend_share token on the Explorer OneLink base.
//
// FAILS-ON-REVERT: put the bare `https://go.usemingla.com/w36m` back in the
// Share an invite path (AddFriendView / RequestsView / the share hook), let
// the builder return the bare base without a token, or route a share claim
// through claim_friend_invite, and the matching case fails.
import {
  buildFriendShareOneLink,
  buildGroupInviteOneLink,
  claimRpcForPendingInvite,
  EXPLORER_ONELINK_BASE,
  groupChatUrl,
  groupJoinAction,
  groupLinkDisplay,
  normalizePendingInviteKind,
  readShareClaim,
  shareJoinedNotificationBody,
  TERMINAL_INVITE_REFUSALS,
} from "../friendShareLink.ts";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  actual:   ${a}\n  expected: ${e}`);
}
function assert(cond: unknown, label: string): void {
  if (!cond) throw new Error(label);
}

const SRC = new URL("../../", import.meta.url);
const REPO = new URL("../../../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, SRC));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const TOKEN = "0123456789abcdef0123456789abcdef";
const GROUP = "fedcba9876543210fedcba9876543210";

Deno.test("SC-1 the personal link: friend_share + my token + my referral code on the Explorer OneLink", () => {
  assertEquals(
    buildFriendShareOneLink({ token: TOKEN, referralCode: "SETH-4KQ2" }),
    `https://go.usemingla.com/w36m?pid=friend_invite&c=friend_share&deep_link_value=friend_share&deep_link_sub1=${TOKEN}&af_sub1=SETH-4KQ2`,
    "full link",
  );
  const link = buildFriendShareOneLink({ token: TOKEN, referralCode: null });
  assert(/deep_link_value=friend_share&deep_link_sub1=[0-9a-f]{32}/.test(link), "SC-1 pattern");
  assert(!link.includes("af_sub1"), "no code, no af_sub1");
  assert(!buildFriendShareOneLink({ token: TOKEN, referralCode: "bad code!" }).includes("af_sub1"), "bad code omitted");
});

Deno.test("SC-1 never the bare link: no valid token means no link at all", () => {
  for (const token of [null, undefined, "", "abc", TOKEN.toUpperCase(), `${TOKEN}00`]) {
    assertEquals(buildFriendShareOneLink({ token, referralCode: "SETH" }), null, `token ${token}`);
  }
});

Deno.test("the OneLink base equals the edge functions' EXPLORER_ONELINK_BASE", async () => {
  const edge = await Deno.readTextFile(new URL("supabase/functions/_shared/friendInviteLink.ts", REPO));
  const m = edge.match(/export const EXPLORER_ONELINK_BASE = "([^"]+)";/);
  assert(m, "edge constant found");
  assertEquals(EXPLORER_ONELINK_BASE, m[1], "same base");
});

Deno.test("SC-11 the group link carries group_invite, the group token and my share token", () => {
  assertEquals(
    buildGroupInviteOneLink({ groupToken: GROUP, shareToken: TOKEN, referralCode: "SETH" }),
    `https://go.usemingla.com/w36m?pid=group_invite&c=group_link&deep_link_value=group_invite&deep_link_sub1=${GROUP}&deep_link_sub2=${TOKEN}&af_sub1=SETH`,
    "full group link",
  );
  assertEquals(
    buildGroupInviteOneLink({ groupToken: GROUP, shareToken: "nope" }),
    `https://go.usemingla.com/w36m?pid=group_invite&c=group_link&deep_link_value=group_invite&deep_link_sub1=${GROUP}`,
    "bad share token left out",
  );
  assertEquals(buildGroupInviteOneLink({ groupToken: "x", shareToken: TOKEN }), null, "no group token, no link");
  assertEquals(groupLinkDisplay(GROUP), "go.usemingla.com/…543210", "display: last 6");
  assertEquals(groupLinkDisplay(null), null, "display: none");
});

Deno.test("I-4261-INVITE-LINK-PERSONAL: Share an invite shares the personal link, never the bare one", async () => {
  const view = strip(await read("components/connections/AddFriendView.tsx"));
  const requests = strip(await read("components/connections/RequestsView.tsx"));
  const hook = strip(await read("hooks/useFriendShareLink.ts"));
  for (const [name, src] of [["AddFriendView", view], ["RequestsView", requests], ["useFriendShareLink", hook]]) {
    assert(!src.includes("go.usemingla.com/w36m"), `${name} must not carry the bare install link`);
  }
  assert(/onPress=\{\(\) => void sharePersonalInvite\(\)\}/.test(view), "the generic row shares the personal link");
  assert(/useSharePersonalInvite\(\)/.test(requests), "Requests shares the personal link");
  const share = hook.slice(hook.indexOf("export function useSharePersonalInvite"));
  assert(/buildFriendShareOneLink\(\{ token: info\.token, referralCode: info\.referralCode \}\)/.test(share), "built from my token");
  assert(/if \(!link\) \{\s*toastManager\.error\(i18n\.t\("connections:af_share_link_failed"\)\);\s*return;/.test(share), "no link: toast, share nothing");
});

Deno.test("claim dispatch: a held share claims with claim_friend_share_link, a phone invite with claim_friend_invite", async () => {
  assertEquals(claimRpcForPendingInvite("share"), "claim_friend_share_link", "share");
  assertEquals(claimRpcForPendingInvite("invite"), "claim_friend_invite", "invite");
  assertEquals(normalizePendingInviteKind(undefined), "invite", "stored v1 value = phone invite");
  assertEquals(normalizePendingInviteKind("share"), "share", "share kept");
  assertEquals(normalizePendingInviteKind("SHARE"), "invite", "anything else = phone invite");
  assert(TERMINAL_INVITE_REFUSALS.includes("own_link"), "own link is terminal");
  for (const r of ["invalid_token", "unavailable", "own_invite", "already_claimed", "invite_cancelled"]) {
    assert(TERMINAL_INVITE_REFUSALS.includes(r), `${r} stays terminal`);
  }
  const svc = strip(await read("services/pendingFriendInvite.ts"));
  assert(/const rpc = claimRpcForPendingInvite\(kind\);\s*const \{ data, error \} = await supabase\.rpc\(rpc, \{ p_token: held\.token \}\)/.test(svc), "the service claims through the dispatch");
  assert(/export async function setPendingFriendShare\(token: string\)[\s\S]{0,80}kind: "share"/.test(svc), "share tokens are held as kind share");
});

Deno.test("share claim reading: notify the owner only on the claim that made the friendship", () => {
  const first = readShareClaim({ success: true, ownerId: "o", outcome: "connected", alreadyClaimed: false, friendRequestId: "fr" });
  assertEquals(first, { status: "claimed", ownerId: "o", friendRequestId: "fr", connected: true, notifyOwner: true }, "first");
  assertEquals(
    shareJoinedNotificationBody("me", first),
    { accepterId: "me", senderId: "o", requestId: "fr", source: "share_link" },
    "notification body",
  );
  const again = readShareClaim(JSON.stringify({ success: true, ownerId: "o", outcome: "connected", alreadyClaimed: true, friendRequestId: "fr" }));
  assertEquals(again.notifyOwner, false, "repeat: no second push");
  assertEquals(shareJoinedNotificationBody("me", again), null, "repeat: no body");
  const friends = readShareClaim({ success: true, ownerId: "o", outcome: "already_friends", alreadyClaimed: false, friendRequestId: null });
  assertEquals([friends.connected, friends.notifyOwner], [false, false], "already friends: nothing to announce");
  assertEquals(readShareClaim({ success: false, error: "unavailable" }), { status: "refused", reason: "unavailable" }, "blocked");
  assertEquals(readShareClaim(null), { status: "refused", reason: "unknown" }, "garbage");
  assertEquals(shareJoinedNotificationBody(null, first), null, "no session, no push");
});

Deno.test("opening a group link: each join_group_by_link answer maps to one action", () => {
  assertEquals(groupJoinAction({ status: "joined", conversationId: "c" }, null), { type: "open_chat", conversationId: "c", sessionId: null }, "joined");
  assertEquals(groupJoinAction({ status: "already_member", conversationId: "c" }, null).type, "open_chat", "already member");
  assertEquals(
    groupJoinAction({ status: "invited", conversationId: "c", sessionId: "s", inviteId: "i" }, null),
    { type: "accept_then_open", conversationId: "c", sessionId: "s", inviteId: "i" },
    "session group: accept the invite",
  );
  assertEquals(groupJoinAction({ status: "invited", conversationId: "c" }, null).type, "toast", "half-formed invite never navigates");
  assertEquals(groupJoinAction({ status: "requested" }, null), { type: "toast", key: "chat:group_join_requested", tone: "info" }, "requested");
  assertEquals(groupJoinAction(null, "not_found"), { type: "toast", key: "chat:group_link_reset_toast", tone: "error" }, "reset link");
  assertEquals(groupJoinAction(null, "unavailable").key, "chat:group_link_unavailable", "blocked: generic");
  assertEquals(groupJoinAction(null, "conflict_group_full").key, "chat:group_link_full", "full");
  assertEquals(groupJoinAction(null, "boom").key, "chat:plan_action_failed", "anything else");
  assertEquals(groupChatUrl("c1"), "mingla://chat/c1?type=group", "plain chat url");
  assertEquals(groupChatUrl("c1", "s1"), "mingla://chat/c1?type=group&sessionId=s1", "session chat url");
});

Deno.test("app/index.tsx routes both new link kinds and clears held links on logout", async () => {
  const index = strip(await Deno.readTextFile(new URL("app-mobile/app/index.tsx", REPO)));
  const share = index.slice(index.indexOf("case 'friend_share': {"), index.indexOf("case 'group_invite': {"));
  assert(/setPendingFriendShare\(dest\.token\)/.test(share), "friend_share is held");
  assert(/persistValidatedReferralCode\(dest\.referralCode\)/.test(share), "referral code kept");
  assert(/claimHeldFriendShare\(\{ announce: true \}\)/.test(share), "signed in: claim now");
  const group = index.slice(index.indexOf("case 'group_invite': {"), index.indexOf("case 'follow_invite': {"));
  assert(/setPendingGroupInvite\(dest\.groupToken, dest\.shareToken\)/.test(group), "group link held");
  assert(/setPendingFriendShare\(dest\.shareToken\)/.test(group), "sharer token held for the connect");
  assert(/joinHeldGroupInvite\(\)/.test(group), "signed in: join now");
  const join = index.slice(index.indexOf("async function joinHeldGroupInvite"), index.indexOf("function dispatchOneLinkDestination"));
  assert(join.indexOf("claimHeldFriendShare") < join.indexOf("joinGroupByLink("), "connect to the sharer before joining");
  assert(/groupJoinAction\(result, code\)/.test(join), "one mapping for the answer");
  assert(/clearPendingFriendInvite\(\), clearPendingGroupInvite\(\)/.test(index), "logout clears both held links");
});
