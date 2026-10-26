// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 (Seth 2026-10-26) — Explorer is the guest app.
//   * a team member's own brand event and trip chats (host chats) never render
//     in Explorer: not in the list, search, filters, archive or unread badge,
//     and a push or deep link to one shows a toast instead of opening it;
//   * a guest's event and trip chats always fold into brand channels, also
//     while the team is unknown, and from the first frame with a cached set;
//   * unread totals exclude host chats;
//   * the last team set is cached per person and logout removes it.
//
// FAILS-ON-REVERT: return false from isHostChatForUser (or drop the
// isHostChatForUser skip in foldBrandChannels) and the "never render" test
// fails; bring back `if (teamBrandIds === null) return false;` in
// foldsIntoBrandChannel and the "always fold" test fails; count unread from
// every conversation again and the unread test fails; delete the cache read in
// ConnectionsPage, the toast guard in handleSelectConversation or the
// TEAM_BRAND_CACHE_PREFIX line in authCleanup and the wiring test fails.

import {
  brandChannelId,
  explorerConversations,
  explorerUnreadTotal,
  foldBrandChannels,
  isBrandChannelRow,
  isHostChatForUser,
} from "../brandChannelModel.ts";
import {
  TEAM_BRAND_CACHE_PREFIX,
  parseTeamBrandCache,
  serializeTeamBrandCache,
  startupTeamBrandIds,
  teamBrandCacheKey,
} from "../teamBrandCache.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected ${b}\n  actual   ${a}`);
}

function eventChat(id: string, brandId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    created_at: "2026-10-01T00:00:00Z",
    type: "group",
    linked_entity_type: "event",
    name: `Event ${id}`,
    event_id: `ev-${id}`,
    participants: [{ id: "me" }],
    unread_count: 0,
    eventBrandId: brandId,
    eventBrandName: `Brand ${brandId}`,
    ...extra,
  };
}
const dm = { id: "dm", created_at: "2026-10-01T00:00:00Z", type: "direct", participants: [{ id: "me" }, { id: "you" }], unread_count: 2 };

Deno.test("#4114 Explorer: a team member's own brand chats never render", () => {
  const team = new Set(["mine"]);
  const chats = [
    dm,
    eventChat("m1", "mine", { unread_count: 4 }),
    eventChat("m2", "mine", { linked_entity_type: "trip" }),
    eventChat("g1", "guest"),
  ];
  assert(isHostChatForUser(chats[1], team) && isHostChatForUser(chats[2], team), "own event and trip chats are host chats");
  assert(!isHostChatForUser(chats[3], team) && !isHostChatForUser(dm, team), "a guest chat and a DM are not");
  const { rows, channels } = foldBrandChannels(chats, team);
  eq(rows.map((row) => row.id), ["dm", brandChannelId("guest")], "the list shows the DM and the guest brand channel only");
  assert(!channels.has(brandChannelId("mine")), "no brand channel for the team's own brand");
  eq(explorerConversations(chats, team).map((chat) => chat.id), ["dm", "g1"], "search, filters and archive read only Explorer's chats");
});

Deno.test("#4114 Explorer: a guest's event chats always fold, from the first frame", () => {
  const chats = [eventChat("a", "b1"), eventChat("b", "b1", { linked_entity_type: "trip" }), eventChat("c", "b2")];
  const folded = (teams) => foldBrandChannels(chats, teams).rows.map((row) => (isBrandChannelRow(row) ? row.__brandChannel.brandId : row.id));
  eq(folded(null), ["b1", "b2"], "unknown team (first launch, no cache): hide nothing, fold everything");
  eq(folded(new Set()), ["b1", "b2"], "not on any team: everything folds");
  // First render of a later launch: the cached empty set is used before the fresh read.
  const cachedEmpty = startupTeamBrandIds(null, serializeTeamBrandCache(new Set()));
  assert(cachedEmpty !== null && cachedEmpty.size === 0, "a cached empty set is known, not unknown");
  eq(folded(cachedEmpty), ["b1", "b2"], "a guest with a cached empty team set sees folded rows on first render");
  // A host's first frame is right too: the cached set hides their own brand at once.
  eq(folded(startupTeamBrandIds(null, serializeTeamBrandCache(new Set(["b2"])))), ["b1"], "a cached host set hides at once");
  // What this launch already read wins over the cache.
  const fresh = new Set(["b1"]);
  eq(startupTeamBrandIds(fresh, serializeTeamBrandCache(new Set(["b2"]))), fresh, "the fresh set is never replaced by the cache");
});

Deno.test("#4114 Explorer: unread excludes hidden host chats", () => {
  const team = new Set(["mine"]);
  const chats = [dm, eventChat("m1", "mine", { unread_count: 7 }), eventChat("g1", "guest", { unread_count: 3 })];
  eq(explorerUnreadTotal(chats, team), 5, "the host chat's 7 never count");
  eq(explorerUnreadTotal(chats, null), 12, "unknown team: nothing is hidden");
  eq(explorerUnreadTotal(chats, team, (chat) => chat.id === "dm"), 3, "muted chats still never count");
});

Deno.test("#4114 Explorer: the team cache parses safely", () => {
  eq(teamBrandCacheKey("u1"), `${TEAM_BRAND_CACHE_PREFIX}u1`, "per person");
  eq(parseTeamBrandCache(null), null, "nothing cached is unknown");
  eq(parseTeamBrandCache("{broken"), null, "a broken entry is unknown");
  eq(parseTeamBrandCache('{"a":1}'), null, "a wrong shape is unknown");
  eq([...parseTeamBrandCache('["b2","b1",3,""]')], ["b2", "b1"], "only brand ids");
  eq(serializeTeamBrandCache(new Set(["b2", "b1"])), '["b1","b2"]', "stable");
});

Deno.test("#4114 Explorer: the page hides host chats everywhere, uses the cache and clears it on logout", () => {
  const root = new URL("../../../", import.meta.url);
  const page = Deno.readTextFileSync(new URL("components/ConnectionsPage.tsx", root));
  const cleanup = Deno.readTextFileSync(new URL("utils/authCleanup.ts", root));
  assert(page.includes("explorerConversations(conversations as ChatListItemConversation[], teamBrandIds)"), "one Explorer chat list");
  const sorted = page.slice(page.indexOf("const sortedConversations = useMemo("), page.indexOf("const brandFold = useMemo("));
  assert(sorted.includes("explorerChats") && !/\bconversations\s*\.filter/.test(sorted), "the list and archive read Explorer's chats only");
  assert(page.includes("allConversations: explorerChats,"), "search reads Explorer's chats only");
  assert(/const totalUnread = explorerUnreadTotal\(/.test(page), "the unread badge excludes host chats");
  const selectStart = page.indexOf("const handleSelectConversation = async (");
  const select = page.slice(selectStart, page.indexOf("if (isBrandChannelRow(conversation)) {", selectStart));
  assert(select.includes("isHostChatForUser(known, teamBrandIds)") && select.includes("t('connections:host_chat_in_business_app')"),
    "a push or deep link to a host chat shows the Host app toast and never opens it");
  assert(page.includes("await AsyncStorage.getItem(teamBrandCacheKey(user.id))") &&
    page.includes("setTeamBrandIds((current) => startupTeamBrandIds(current, cachedTeams))"), "the cached set is used at startup");
  assert(page.includes("AsyncStorage.setItem(teamBrandCacheKey(userId), serializeTeamBrandCache(teams))"), "each fresh read is cached");
  assert(cleanup.includes("if (key.startsWith(TEAM_BRAND_CACHE_PREFIX)) return true;"), "logout removes the cached set");
  for (const locale of ["en", "fr", "yo", "zh"]) {
    const strings = JSON.parse(Deno.readTextFileSync(new URL(`i18n/locales/${locale}/connections.json`, root)));
    assert(typeof strings.host_chat_in_business_app === "string" && strings.host_chat_in_business_app.length > 0, `${locale} toast`);
  }
});
