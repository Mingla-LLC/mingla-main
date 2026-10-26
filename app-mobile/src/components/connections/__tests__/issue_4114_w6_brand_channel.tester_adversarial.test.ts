// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 6 — tester adversarial suite for the brand channel fold and
// the send target. The implementor suite covers a guest with two events; this
// one attacks the edges:
//   * a brand team member never gets a folded row for their own brand, even
//     when they are also a guest of another event of that brand, while another
//     brand's chats still fold;
//   * direct, group and enquiry chats, and event chats with no brand id, never
//     fold or move;
//   * the "Sending to" chip with exactly 1 upcoming + 3 past events is hidden
//     (D10), and the default target is that one upcoming event;
//   * a reply to an ENDED event's message goes to that ended event, while a
//     stale chip choice that has since ended falls back to the default;
//   * per-event guest lists never merge across events;
//   * the unread total ignores negative counts.
//
// FAILS-ON-REVERT: drop the teamBrandIds check in foldsIntoBrandChannel, make
// the chip show at 1 upcoming, or let resolveSendTarget prefer the chip over a
// reply, and this suite fails.

import {
  brandChannelId,
  brandChannelUnread,
  foldBrandChannels,
  isBrandChannelRow,
  resolveSendTarget,
  showSendTargetChip,
  defaultSendTarget,
  upcomingEvents,
} from "../brandChannelModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const DAY = 86400000;
const iso = (ms: number) => new Date(NOW + ms).toISOString();

const eventChat = (id: string, brandId: string | null, startOffset: number, extra: Record<string, unknown> = {}) => ({
  id,
  created_at: iso(-30 * DAY),
  type: "group",
  linked_entity_type: "event",
  name: `Event ${id}`,
  event_id: `evt-${id}`,
  eventBrandId: brandId,
  eventBrandName: brandId ? `Brand ${brandId}` : null,
  eventStartAt: iso(startOffset),
  eventEndAt: iso(startOffset + 3 * 3600000),
  participants: [{ id: `guest-${id}` }],
  unread_count: 0,
  ...extra,
});
const event = (id: string, startOffset: number) => ({
  conversationId: id,
  eventId: `evt-${id}`,
  title: id,
  linkedEntityType: "event",
  startAt: iso(startOffset),
  endAt: iso(startOffset + 3 * 3600000),
  participantCount: 1,
  unreadCount: 0,
  people: [],
  publicCard: null,
});

Deno.test("#4114 W6 adversarial: a team member never gets a folded row for their own brand", () => {
  const conversations = [
    eventChat("mine-1", "B-team", DAY),
    eventChat("mine-2", "B-team", 2 * DAY),
    eventChat("other-1", "B-other", DAY),
    eventChat("other-2", "B-other", 3 * DAY, { linked_entity_type: "trip" }),
  ];
  const { rows, channels } = foldBrandChannels(conversations, new Set(["B-team"]));
  const ids = rows.map((row) => row.id);
  assertEquals(ids, ["mine-1", "mine-2", brandChannelId("B-other")], "own brand stays per event, in place; the other brand folds");
  assert(!channels.has(brandChannelId("B-team")), "no channel object for a team brand");
  assert(!rows.some((row) => isBrandChannelRow(row) && row.__brandChannel.brandId === "B-team"), "never a folded team row");
  assertEquals(channels.get(brandChannelId("B-other"))?.events.map((e) => e.conversationId), ["other-1", "other-2"], "trips fold with events, soonest first");
});

Deno.test("#4114 W6 adversarial: non-offering chats and brandless event chats never fold or move", () => {
  const conversations = [
    { id: "dm", created_at: iso(0), type: "direct", linked_entity_type: "direct", participants: [], eventBrandId: "B1" },
    { id: "grp", created_at: iso(0), type: "group", linked_entity_type: "session", participants: [], eventBrandId: "B1" },
    eventChat("no-brand", null, DAY),
    eventChat("b1-a", "B1", DAY),
    eventChat("b1-b", "B1", 2 * DAY),
  ];
  const { rows } = foldBrandChannels(conversations, new Set());
  assertEquals(rows.map((row) => row.id), ["dm", "grp", "no-brand", brandChannelId("B1")], "only real brand event chats fold");
});

Deno.test("#4114 W6 adversarial: exactly 1 upcoming + 3 past events shows no chip and targets the upcoming one", () => {
  const events = [event("past-1", -10 * DAY), event("past-2", -5 * DAY), event("past-3", -DAY), event("next", 2 * DAY)];
  assertEquals(upcomingEvents(events, NOW).map((e) => e.conversationId), ["next"], "one upcoming");
  assert(!showSendTargetChip(events, NOW), "D10: no chip with a single upcoming event");
  assertEquals(defaultSendTarget(events, NOW), "next", "new messages go to the upcoming event");
  assertEquals(
    resolveSendTarget({ events, chosenConversationId: "past-3", replyToConversationId: null, now: NOW }),
    "next",
    "a stale chip choice cannot send into a past event while the chip is hidden",
  );
  const allPast = [event("p1", -3 * DAY), event("p2", -DAY)];
  assertEquals(defaultSendTarget(allPast, NOW), "p2", "with nothing upcoming, the latest event");
  assertEquals(defaultSendTarget([], NOW), null, "no events, no target (never a guess)");
});

Deno.test("#4114 W6 adversarial: a reply to an ended event's message goes to that event", () => {
  const events = [event("ended", -2 * DAY), event("soon", DAY), event("later", 4 * DAY)];
  assert(showSendTargetChip(events, NOW), "two upcoming: the chip shows");
  assertEquals(
    resolveSendTarget({ events, chosenConversationId: "later", replyToConversationId: "ended", now: NOW }),
    "ended",
    "the reply wins over the chip, even for an ended event",
  );
  assertEquals(
    resolveSendTarget({ events, chosenConversationId: "later", replyToConversationId: "not-in-this-channel", now: NOW }),
    "later",
    "a reply to a chat outside this channel never redirects the send",
  );
  assertEquals(
    resolveSendTarget({ events, chosenConversationId: "ended", replyToConversationId: null, now: NOW }),
    "soon",
    "picking an ended event in the chip falls back to the default",
  );
});

Deno.test("#4114 W6 adversarial: guest lists stay per event and the unread total never goes negative", () => {
  const { channels } = foldBrandChannels([
    eventChat("a", "B1", DAY, { participants: [{ id: "alice" }], unread_count: 2 }),
    eventChat("b", "B1", 2 * DAY, { participants: [{ id: "bob" }], unread_count: -5 }),
  ], new Set());
  const channel = channels.get(brandChannelId("B1"));
  assertEquals(channel?.events.map((e) => e.people.map((p) => p.id)), [["alice"], ["bob"]], "no cross-event guest merge");
  assertEquals(brandChannelUnread([{ unread_count: 2 }, { unread_count: -5 }, {}]), 2, "negative or missing counts add nothing");
});
