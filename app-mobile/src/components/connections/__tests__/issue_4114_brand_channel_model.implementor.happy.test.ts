// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 6 — the brand channel (D10 / D11): one row and one thread
// per brand for guests.
//
// FAILS-ON-REVERT (each proven by deleting the line, not commenting it out):
//  - delete `return !teamBrandIds.has(brandId);` (return true) → the team
//    member's chats fold and "team members keep per-event rows" fails;
//  - delete the `brandChannelUnread(members)` sum (use the newest chat's
//    count) → "summed unread" fails;
//  - change `>= 2` in showSendTargetChip to `>= 1` → the one-upcoming case
//    shows a chip and fails;
//  - delete the reply branch of resolveSendTarget → a reply to an ended
//    event's message goes to the soonest event and fails;
//  - delete the `conversationId !== previous` run check → every message gets
//    a marker and "event markers" fails;
//  - sort nextUpEvent's list descending → "Next up" picks the later event.
// MINGLA-INVARIANT: I-4114-BRAND-CHANNEL-SEND-TARGET | issue #4114 | A brand channel message is written to exactly one event's conversation: the quoted message's when replying, otherwise the chosen upcoming event when two or more are upcoming, otherwise the soonest upcoming (or latest) event.

import {
  brandChannelId,
  brandChannelMessages,
  brandChannelUnread,
  defaultSendTarget,
  eventMarkerMessageIds,
  foldBrandChannels,
  isBrandChannelId,
  isEventEnded,
  nextUpEvent,
  resolveSendTarget,
  showSendTargetChip,
} from "../brandChannelModel.ts";
import { buildBrowseItems, buildSearchItems, chatKind, matchesChatFilter } from "../chatListModel.ts";
import { mergeMessages } from "../../../utils/mergeMessages.ts";
import { conversationChannelKey, conversationRealtimeFilter } from "../../../utils/conversationSubscription.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected ${b}\n  actual   ${a}`);
}

const NOW = Date.parse("2026-10-26T12:00:00Z");
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function eventChat(id: string, brandId: string, opts: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    created_at: iso(-30),
    type: "group",
    linked_entity_type: "event",
    name: `Event ${id}`,
    event_id: `ev-${id}`,
    participants: [{ id: "me" }, { id: `guest-${id}` }],
    unread_count: 0,
    eventBrandId: brandId,
    eventBrandName: `Brand ${brandId}`,
    eventBrandSlug: `brand-${brandId}`,
    eventBrandLogoUrl: `https://cdn.test/${brandId}.png`,
    eventStartAt: iso(5),
    eventEndAt: null,
    ...opts,
  };
}

const friendChat = {
  id: "dm-1",
  created_at: iso(-2),
  type: "direct",
  participants: [{ id: "me" }, { id: "ada" }],
  unread_count: 1,
  last_message: { content: "hi", created_at: iso(-1) },
};

Deno.test("W6 a guest's event and trip chats of one brand fold into ONE row", () => {
  const conversations = [
    friendChat,
    eventChat("a1", "lsc", { last_message: { content: "Doors open at 1pm", created_at: iso(-0.5) } }),
    eventChat("a2", "lsc", { linked_entity_type: "trip", eventStartAt: iso(20) }),
    eventChat("b1", "other"),
  ];
  const { rows, channels } = foldBrandChannels(conversations, new Set());
  eq(rows.map((row) => row.id), ["dm-1", brandChannelId("lsc"), brandChannelId("other")], "one row per brand, friend chat untouched, first position kept");
  const lsc = channels.get(brandChannelId("lsc"));
  assert(lsc, "the channel is returned");
  eq(lsc.events.map((event) => event.conversationId), ["a1", "a2"], "events soonest first");
  eq(lsc.brandName, "Brand lsc", "brand name");
  eq(lsc.logoUrl, "https://cdn.test/lsc.png", "brand logo");
  const row = rows[1];
  eq(row.name, "Brand lsc", "row shows the brand");
  eq(row.brandChannelLastEventTitle, "Event a1", "the preview leads with the newest message's event");
  eq(chatKind(row), "brand_channel", "its own chat kind");
  assert(isBrandChannelId(row.id), "row id is a brand channel id");
  assert(matchesChatFilter(row, "events"), "the Events filter shows brand channels");
  assert(!matchesChatFilter(row, "groups"), "a brand channel is not a group");
  eq(chatKind({ ...friendChat, isEnquiry: true }), "enquiry", "#4111 enquiry rows keep their own kind (D11)");
});

// Seth 2026-10-26: Explorer is the guest app. A team member's own brand chats
// are host chats, run from the Host app, and never listed in Explorer.
Deno.test("W7 a team member's own brand chats are hidden; other brands fold", () => {
  const conversations = [eventChat("a1", "lsc"), eventChat("a2", "lsc"), eventChat("b1", "other")];
  const { rows } = foldBrandChannels(conversations, new Set(["lsc"]));
  eq(rows.map((row) => row.id), [brandChannelId("other")], "the team's brand is hidden; other brands fold");
});

Deno.test("W6 the brand row's unread count is the sum of its chats", () => {
  const conversations = [
    eventChat("a1", "lsc", { unread_count: 2, last_message: { content: "x", created_at: iso(-1) } }),
    eventChat("a2", "lsc", { unread_count: 3 }),
  ];
  eq(brandChannelUnread(conversations), 5, "sum");
  const { rows } = foldBrandChannels(conversations, new Set());
  eq(rows[0].unread_count, 5, "the row carries the sum");
  const items = buildBrowseItems({ active: rows, archivedCount: 0, filter: "unread" });
  eq(items.map((item) => item.key), [brandChannelId("lsc")], "it counts as unread");
});

Deno.test("W6 search lists brand channels under Events", () => {
  const { rows } = foldBrandChannels([friendChat, eventChat("a1", "lsc")], new Set());
  const items = buildSearchItems({ matchedChats: rows, friends: [], allConversations: rows, currentUserId: "me", query: "x" });
  eq(items.map((item) => item.key), ["section:chats", "dm-1", "section:events", brandChannelId("lsc")], "brand channel in the Events section");
});

Deno.test("W6 the Sending to chip shows only with two or more UPCOMING events", () => {
  const one = foldBrandChannels([eventChat("a1", "lsc")], new Set()).channels.get(brandChannelId("lsc"));
  assert(!showSendTargetChip(one.events, NOW), "one event: no chip");
  const onePlusPast = foldBrandChannels([
    eventChat("a1", "lsc"),
    eventChat("old", "lsc", { eventStartAt: iso(-20), eventEndAt: iso(-19) }),
  ], new Set()).channels.get(brandChannelId("lsc"));
  assert(!showSendTargetChip(onePlusPast.events, NOW), "a past event never triggers the chip");
  eq(defaultSendTarget(onePlusPast.events, NOW), "a1", "no chip: sends go to the upcoming event");
  const two = foldBrandChannels([
    eventChat("later", "lsc", { eventStartAt: iso(20) }),
    eventChat("soon", "lsc", { eventStartAt: iso(3) }),
  ], new Set()).channels.get(brandChannelId("lsc"));
  assert(showSendTargetChip(two.events, NOW), "two upcoming: chip");
  eq(defaultSendTarget(two.events, NOW), "soon", "the chip defaults to the soonest");
  eq(resolveSendTarget({ events: two.events, chosenConversationId: "later", replyToConversationId: null, now: NOW }), "later", "a picked upcoming event is honoured");
  eq(resolveSendTarget({ events: onePlusPast.events, chosenConversationId: "old", replyToConversationId: null, now: NOW }), "a1", "with no chip a stale choice is ignored");
});

Deno.test("W6 a reply always goes to the quoted message's event, even an ended one", () => {
  const channel = foldBrandChannels([
    eventChat("soon", "lsc", { eventStartAt: iso(3) }),
    eventChat("later", "lsc", { eventStartAt: iso(20) }),
    eventChat("old", "lsc", { eventStartAt: iso(-20), eventEndAt: iso(-19) }),
  ], new Set()).channels.get(brandChannelId("lsc"));
  assert(isEventEnded(channel.events.find((event) => event.conversationId === "old"), NOW), "fixture: old has ended");
  eq(resolveSendTarget({ events: channel.events, chosenConversationId: "soon", replyToConversationId: "old", now: NOW }), "old", "reply to an ended event's message");
  eq(resolveSendTarget({ events: channel.events, chosenConversationId: "soon", replyToConversationId: "later", now: NOW }), "later", "reply beats the chip");
  eq(resolveSendTarget({ events: channel.events, chosenConversationId: "soon", replyToConversationId: "not-a-member", now: NOW }), "soon", "a reply outside the channel never leaks a send elsewhere");
});

Deno.test("W6 the Next up card picks the soonest UPCOMING event", () => {
  const channel = foldBrandChannels([
    eventChat("later", "lsc", { eventStartAt: iso(20) }),
    eventChat("old", "lsc", { eventStartAt: iso(-3), eventEndAt: iso(-2) }),
    eventChat("soon", "lsc", { eventStartAt: iso(6) }),
    eventChat("nodate", "lsc", { eventStartAt: null }),
  ], new Set()).channels.get(brandChannelId("lsc"));
  eq(nextUpEvent(channel.events, NOW)?.conversationId, "soon", "soonest upcoming, past and undated skipped");
  const allPast = foldBrandChannels([eventChat("old", "lsc", { eventStartAt: iso(-3), eventEndAt: iso(-2) })], new Set())
    .channels.get(brandChannelId("lsc"));
  eq(nextUpEvent(allPast.events, NOW), null, "no upcoming event: no card");
  eq(defaultSendTarget(allPast.events, NOW), "old", "but you can still post in the latest event");
});

Deno.test("W6 the thread merges every event chat and marks where the event changes", () => {
  const msg = (id: string, minutes: number) => ({ id, timestamp: new Date(NOW + minutes * 60_000).toISOString() });
  const merged = brandChannelMessages(
    [
      { conversationId: "a1", messages: [msg("m1", 1), msg("m3", 3), msg("m4", 4)] },
      { conversationId: "a2", messages: [msg("m2", 2), msg("m5", 5)] },
    ],
    mergeMessages,
  );
  eq(merged.map((m) => `${m.id}@${m.conversationId}`), ["m1@a1", "m2@a2", "m3@a1", "m4@a1", "m5@a2"], "time-sorted, each tagged with its chat");
  eq([...eventMarkerMessageIds(merged)], ["m1", "m2", "m3", "m5"], "a marker above each run from a new event");
  eq([...eventMarkerMessageIds([msg("x", 1), msg("y", 2)])], [], "ordinary chats (no conversation id) get no markers");
});

Deno.test("W6 one realtime filter and channel key for all of a brand's chats", () => {
  eq(conversationRealtimeFilter("c1"), "conversation_id=eq.c1", "one chat unchanged");
  eq(conversationRealtimeFilter(["c2", "c1", "c2"]), "conversation_id=in.(c1,c2)", "several: one in.() filter, deduped and sorted");
  eq(conversationChannelKey("c1"), "c1", "one chat keeps its old channel name");
  eq(conversationChannelKey(["c2", "c1"]), "c1,c2", "stable key for the channel");
});
