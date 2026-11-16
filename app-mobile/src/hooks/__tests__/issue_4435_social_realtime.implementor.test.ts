// #4435 / #4275: the app-wide social realtime channels bind only tables that
// are in the supabase_realtime publication. One binding the server cannot
// serve makes the whole channel deliver nothing, so friend, chat-membership,
// calendar and pairing live updates never arrived in production.
// FAILS-ON-REVERT: re-adding the friend_requests, pending_invites or
// message_reads binding fails "only published tables".
// The publication itself is pinned by
// supabase/migrations/__tests__/issue_4435_leftovers.implementor.pg17.test.sql (L-REALTIME).

const HOOK = new URL("../useSocialRealtime.ts", import.meta.url);

// Production's public tables in supabase_realtime, read 2026-11-16 (a fresh
// replay of the migrations gives the same 50).
const PUBLISHED = new Set([
  "agent_activity_events", "board_card_messages", "board_card_rsvps", "board_message_reactions", "board_messages",
  "board_participant_presence", "board_saved_cards", "board_votes", "brand_enquiries", "brand_group_reads",
  "calendar_entries", "chat_plans", "collaboration_invites", "collaboration_sessions", "community_post_comments",
  "community_posts", "conversation_participant_lifecycle", "conversation_participants", "conversation_presence",
  "conversations", "direct_message_reactions", "door_pay_codes", "event_rsvps", "friends", "group_join_requests",
  "guest_roster_change_events", "leaderboard_presence", "message_media_views", "messages", "notifications", "orders",
  "pair_requests", "pairings", "pending_pair_invites", "reservations", "session_participants", "support_attachments",
  "support_product_signals", "support_tickets", "tag_along_requests", "team_mentions", "team_message_reactions",
  "team_messages", "team_thread_members", "team_threads", "ticket_checkout_sessions", "tickets",
  "venue_order_sessions", "venue_orders", "venue_waitlist",
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function channelBody(source: string, prefix: string): string {
  const start = source.indexOf(`.channel(\`${prefix}`);
  assert(start >= 0, `channel ${prefix}`);
  const end = source.indexOf(".subscribe();", start);
  assert(end > start, `subscribe after ${prefix}`);
  return source.slice(start, end);
}
function tablesOf(body: string): string[] {
  return [...body.matchAll(/table:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

Deno.test("only published tables are bound, on every channel the hook opens", () => {
  const source = strip(Deno.readTextFileSync(HOOK));
  const all = tablesOf(source);
  assert(all.length >= 8, "the hook still binds its listeners");
  for (const table of all) assert(PUBLISHED.has(table), `${table} is not in supabase_realtime`);
  for (const table of ["friend_requests", "pending_invites", "message_reads"]) {
    assert(!all.includes(table), `${table} is not published and must not be bound`);
  }
});

Deno.test("the social channel keeps every published listener; the lifecycle listener stays on its own channel", () => {
  const source = strip(Deno.readTextFileSync(HOOK));
  const social = tablesOf(channelBody(source, "social-realtime-"));
  const lifecycle = tablesOf(channelBody(source, "chat-lifecycle-"));
  const expected = ["conversation_participants", "friends", "calendar_entries", "pair_requests", "pair_requests", "pairings", "pairings"];
  assert(JSON.stringify(social) === JSON.stringify(expected), `social channel binds ${social.join(", ")}`);
  assert(JSON.stringify(lifecycle) === JSON.stringify(["conversation_participant_lifecycle"]), "lifecycle channel");
  const declared = /SOCIAL_REALTIME_TABLES: readonly string\[\] = \[([\s\S]*?)\]/.exec(Deno.readTextFileSync(HOOK));
  assert(declared, "the hook declares its tables");
  const names = [...declared[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify([...new Set(social)].sort()) === JSON.stringify([...names].sort()), "the declared list matches the bindings");
});

Deno.test("the listeners still refresh the same caches", () => {
  const social = channelBody(strip(Deno.readTextFileSync(HOOK)), "social-realtime-");
  // Issue #4456: chat membership refreshes the Chats list (["messages"] had no query).
  assert(/table: "conversation_participants"[\s\S]*?queryKey: chatListKeys\.all/.test(social), "chat membership refreshes the Chats list");
  assert(/table: "friends"[\s\S]*?queryKey: \["friends"\][\s\S]*?onFriendListChange/.test(social), "friends refresh");
  assert(/table: "calendar_entries"[\s\S]*?queryKey: \["calendarEntries"\]/.test(social), "calendar refresh");
  assert(/table: "pair_requests"[\s\S]*?pairingKeys\.incomingRequests\(userId\)/.test(social), "pair requests refresh");
  assert(/table: "pairings"[\s\S]*?pairingKeys\.pills\(userId\)/.test(social), "pairings refresh");
});
