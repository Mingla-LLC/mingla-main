// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 Wave B0: the shared prelude both mobile waves build on.
// Pins (1) the plan / group-link / friend-share query-key factory shapes from
// spec 5.1, and (2) every en i18n key from spec 5.10 with its placeholders.
//
// FAILS-ON-REVERT: delete a factory, change a key segment, or drop an i18n
// key / placeholder and the matching case fails.
import { friendShareKeys, groupLinkKeys, planKeys } from "../queryKeys.ts";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

Deno.test("#4261 B0: planKeys shape", () => {
  assertEquals(planKeys.all, ["chatPlans"], "all");
  assertEquals(planKeys.conversation("c1"), ["chatPlans", "conversation", "c1"], "conversation");
  assertEquals(planKeys.comments("p1"), ["chatPlans", "comments", "p1"], "comments");
  assertEquals(planKeys.placeSearch("bar", 6.4, 3.4), ["chatPlans", "places", "bar", 6.4, 3.4], "placeSearch");
  assertEquals(planKeys.placeSearch("bar", null, undefined), ["chatPlans", "places", "bar", "none", "none"], "placeSearch none");
});

Deno.test("#4261 B0: groupLinkKeys and friendShareKeys shape", () => {
  assertEquals(groupLinkKeys.all, ["groupLink"], "group all");
  assertEquals(groupLinkKeys.link("c1"), ["groupLink", "link", "c1"], "group link");
  assertEquals(groupLinkKeys.joinRequests("c1"), ["groupLink", "requests", "c1"], "group requests");
  assertEquals(groupLinkKeys.preview("t1"), ["groupLink", "preview", "t1"], "group preview");
  assertEquals(friendShareKeys.all, ["friendShare"], "share all");
  assertEquals(friendShareKeys.link("u1"), ["friendShare", "link", "u1"], "share link");
});

const CHAT_KEYS: Record<string, string[]> = {
  plan_add_title: [], plan_add_sub: [], plan_new_badge: [], plan_from_deck_title: [], plan_from_deck_sub: [],
  plan_form_title: [], plan_form_post: [], plan_form_cancel: [], plan_what_label: [], plan_what_placeholder: [],
  plan_where_label: [], plan_where_place: [], plan_where_link: [], plan_where_skip: [], plan_search_placeholder: [],
  plan_search_near: [], plan_search_results: [], plan_search_on_mingla: [], plan_search_attribution: [],
  plan_search_use_typed: ["query"], plan_search_use_typed_sub: [], plan_change: [], plan_link_placeholder: [],
  plan_link_helper: [], plan_when_label: [], plan_when_set: [], plan_when_vote: [], plan_quick_tonight: [],
  plan_quick_tomorrow: [], plan_add_time: [], plan_suggest_time: [], plan_open_times_title: [], plan_open_times_sub: [],
  plan_vote_helper: [], plan_note_label: [], plan_footer_helper: ["chatName"], plan_posted_toast: ["chatName"],
  plan_invalid_set: [], plan_invalid_vote: [], plan_added_by_you: [], plan_added_by: ["name"], plan_reply: [],
  plan_voting_heading: [], plan_poll_hint_owner: [], plan_poll_hint_other: ["name"], plan_poll_hint_empty: [],
  plan_add_your_time: [], plan_your_time_label: [], plan_add_and_vote: [], plan_lock_in: ["time"], plan_lock_it_in: [],
  plan_picked_by_vote: [], plan_going: [], plan_maybe: [], plan_cant: [], plan_summary_going: ["count"],
  plan_summary_maybe: ["count"], plan_summary_cant: ["count"], plan_summary_none: [], plan_comment_nudge: [],
  plan_comments_one: ["count"], plan_comments_other: ["count"], plan_cancelled: [], plan_cancel_confirm: ["title"],
  plan_edit: [], plan_time_exists_toast: [], plan_too_many_times: [], plan_action_failed: [], plan_past_time: [],
  plan_only_creator_locks: ["name"], plan_only_admin_locks: [], plan_unavailable: [], matches_title: [], matches_sub: [],
  matches_from_deck: [], matches_from_chat: ["name"], matches_needs_vote: [], matches_liked_by: ["names"],
  matches_no_likes: [], matches_when_heading: [], matches_no_time: [], matches_vote_on_time: [], matches_comment: [],
  matches_see_in_chat: [], matches_details: [], matches_counter: ["count", "index"], matches_nothing: [],
  matches_helper: [], plans_sub: [], plans_row_going: ["count", "time"], plans_from_deck: [], plans_from_chat: ["name"],
  plans_footer: [], plan_comments_heading: [], plan_comments_footer: [], plan_comments_reply: [],
  plan_comments_empty: [], plan_replying_to: ["title"], plan_composer_placeholder: ["title"], plan_quote_title: ["title"],
  plan_event_time_added: ["name", "time", "title"], plan_event_locked: ["name", "time", "title"],
  plan_event_cancelled: ["name", "title"], group_event_joined: ["name", "sharer"],
  group_event_members_added: ["actor", "names"], group_join_wants: ["name"], group_join_joined: ["name"],
  group_join_declined: ["name"], group_join_sub_pending: ["sharer"], group_join_sub_in: [], group_join_sub_out: [],
  group_join_decline: [], group_join_let_in: [], group_link_label: [], group_link_explainer: [],
  group_link_approve_title: [], group_link_approve_sub: [], group_link_reset: [], group_link_reset_confirm: [],
  group_link_share: [], group_link_share_message: ["link", "name"], group_add_people: [], group_add_people_title: [],
  group_add_people_cta: ["count"], group_add_friends_heading: [], group_add_all_in: [], group_add_share_instead: [],
  group_add_history_note: [], group_add_skipped: ["count"], group_join_requested: ["name"],
  group_link_reset_toast: [], group_link_unavailable: [], strip_to_vote: ["count"], plan_preview: ["title"],
  // Wave C: copy B2/B1 shipped behind defaultValue fallbacks, now real keys.
  plan_option_added_by: ["name"], plan_option_no_votes: [], matches_no_place: [], plan_search_partial_failure: [],
  group_join_requested_unnamed: [], group_link_full: [],
};

const CONNECTIONS_KEYS: Record<string, string[]> = {
  af_share_link_failed: [], af_invite_joined: ["count"], af_reset_link: [], af_reset_link_confirm: [],
  invite_connected: ["name"],
};

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

async function checkNamespace(file: string, keys: Record<string, string[]>): Promise<void> {
  const json = JSON.parse(await Deno.readTextFile(new URL(`../../i18n/locales/en/${file}`, import.meta.url)));
  for (const [key, expected] of Object.entries(keys)) {
    const value = json[key];
    if (typeof value !== "string" || value.trim().length === 0) throw new Error(`en/${file}: ${key} missing`);
    assertEquals(placeholders(value), [...expected].sort(), `en/${file}: ${key} placeholders`);
  }
}

Deno.test("#4261 B0: every spec 5.10 key exists in en with its placeholders", async () => {
  await checkNamespace("chat.json", CHAT_KEYS);
  await checkNamespace("connections.json", CONNECTIONS_KEYS);
});

Deno.test("#4261 B0: attribution copy names Mapbox, never Google (spec O-7)", async () => {
  const chat = JSON.parse(await Deno.readTextFile(new URL("../../i18n/locales/en/chat.json", import.meta.url)));
  if (!/Mapbox/.test(chat.plan_search_attribution) || /Google/.test(chat.plan_search_attribution)) {
    throw new Error(`attribution: ${chat.plan_search_attribution}`);
  }
});

// ── Wave C: integration pins (source checks; these files import React Native,
// so a Deno suite cannot load them — it reads them instead).
// FAILS-ON-REVERT: drop the plan fields from transformMessage, stop forwarding
// planId to sendMessage, put the inline preview back in ChatListItem, drop the
// join-request invalidation, or restore a defaultValue fallback.
const SRC = new URL("../../", import.meta.url);
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const readSrc = async (path: string) => stripComments(await Deno.readTextFile(new URL(path, SRC)));

Deno.test("#4261 C: ConnectionsPage carries plan fields both ways", async () => {
  const page = await readSrc("components/ConnectionsPage.tsx");
  const transform = page.slice(page.indexOf("const transformMessage = useCallback("), page.indexOf("const persistMessages"));
  if (!/planId:\s*msg\.plan_id\s*\?\?\s*undefined/.test(transform)) throw new Error("transformMessage drops plan_id");
  if (!/planQuote:\s*msg\.plan_quote\s*\?\?\s*null/.test(transform)) throw new Error("transformMessage drops plan_quote");
  const send = page.slice(page.indexOf("const handleSendMessage = async ("), page.indexOf("const handleSendMedia = async ("));
  if (!/cardTags: CardTagEntry\[\] = \[\],\s*planId\?: string,/.test(send)) throw new Error("handleSendMessage ignores the 7th planId argument");
  if (!/marketingCampaignId: null,\s*planId,/.test(send)) throw new Error("the optimistic bubble does not carry planId");
  const deliver = page.slice(page.indexOf("const deliverMessage = async ("), page.indexOf("const handleSendMessage = async ("));
  if (!/planId:\s*current\.planId\s*\?\?\s*null/.test(deliver)) throw new Error("deliverMessage does not pass planId to sendMessage");
});

Deno.test("#4261 C: the chat list preview comes from chatPreviewText", async () => {
  const item = await readSrc("components/connections/ChatListItem.tsx");
  if (!/const text = chatPreviewText\(lastMessage, t\);/.test(item)) throw new Error("ChatListItem does not use chatPreviewText");
  if (/message_type === 'image'\) text =/.test(item)) throw new Error("the old inline preview is back");
});

Deno.test("#4261 C: a join request change refreshes that chat's requests", async () => {
  const realtime = await readSrc("services/realtimeService.ts");
  if (!/table: "group_join_requests", filter: `conversation_id=eq\.\$\{conversationId\}`/.test(realtime)) {
    throw new Error("the plan channel does not listen to group_join_requests");
  }
  const hook = await readSrc("hooks/useChatPlans.ts");
  if (!/onJoinRequestChange: \(\) => \{\s*void queryClient\.invalidateQueries\(\{ queryKey: groupLinkKeys\.joinRequests\(conversationId\) \}\);/.test(hook)) {
    throw new Error("onJoinRequestChange does not invalidate groupLinkKeys.joinRequests");
  }
});

Deno.test("#4261 C: no defaultValue fallbacks remain for the Wave C keys", async () => {
  for (const file of ["components/chat/PlanCardBubble.tsx", "components/chat/PlanFormSheet.tsx", "components/chat/PlanMatchesSheet.tsx"]) {
    if (/defaultValue/.test(await readSrc(file))) throw new Error(`${file}: a defaultValue fallback is back`);
  }
  const index = await readSrc("../app/index.tsx");
  if (!/i18n\.t\('chat:group_join_requested_unnamed'\)/.test(index)) throw new Error("unnamed group toast key missing");
  if (/\.replace\(\/\\s\+\\\.\/, '\.'\)/.test(index)) throw new Error("the name-dropping string patch is back");
});
