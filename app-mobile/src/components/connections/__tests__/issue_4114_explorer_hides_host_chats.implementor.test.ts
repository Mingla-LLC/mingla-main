// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 (Seth 2026-10-26) — Explorer is the guest app.
//   * a team member's own brand event and trip chats (host chats) never render
//     in Explorer: not in the list, search, filters, archive or unread badge,
//     and a push or deep link to one shows a toast instead of opening it;
//   * #4459: the host chat is now the brand's one Guest chat (brand_id), and
//     a guest's Guest chat always shows, also while the team is unknown, and
//     from the first frame with a cached set;
//   * unread totals exclude host chats;
//   * the last team set is cached per person and logout removes it.
//
// FAILS-ON-REVERT: return false from isHostChatForUser and the "never render"
// test fails; drop `if (teamBrandIds === null) return false;` and the
// "unknown team" case fails; count unread from every conversation again and
// the unread test fails; delete the cache read in
// ConnectionsPage, the toast guard in handleSelectConversation or the
// TEAM_BRAND_CACHE_PREFIX line in authCleanup and the wiring test fails.
// MINGLA-INVARIANT: I-4114-EXPLORER-HIDES-HOST-CHATS | issue #4114 | Explorer never lists, searches, filters or counts unread for a brand Guest chat whose brand is in the user's team set; it never opens one either.

import {
  explorerConversations,
  explorerUnreadTotal,
  isHostChatForUser,
} from "../chatListModel.ts";
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

// #4459: one Guest chat per brand (server-side).
function guestChat(id: string, brandId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    created_at: "2026-10-01T00:00:00Z",
    type: "group",
    linked_entity_type: "brand_guests",
    brand_id: brandId,
    name: `Brand ${brandId}`,
    participants: [{ id: "me" }],
    unread_count: 0,
    eventBrandId: brandId,
    eventBrandName: `Brand ${brandId}`,
    ...extra,
  };
}
const dm = { id: "dm", created_at: "2026-10-01T00:00:00Z", type: "direct", participants: [{ id: "me" }, { id: "you" }], unread_count: 2 };

Deno.test("#4114 / #4459 Explorer: a team member's own brand Guest chat never renders", () => {
  const team = new Set(["mine"]);
  const chats = [dm, guestChat("m1", "mine", { unread_count: 4 }), guestChat("g1", "guest")];
  assert(isHostChatForUser(chats[1], team), "your own brand's Guest chat is a host chat");
  assert(!isHostChatForUser(chats[2], team) && !isHostChatForUser(dm, team), "a guest's Guest chat and a DM are not");
  eq(explorerConversations(chats, team).map((chat) => chat.id), ["dm", "g1"], "list, search, filters and archive read only Explorer's chats");
});

Deno.test("#4114 / #4459 Explorer: a guest's Guest chat always shows, from the first frame", () => {
  const chats = [guestChat("a", "b1"), guestChat("c", "b2")];
  const shown = (teams) => explorerConversations(chats, teams).map((row) => row.id);
  eq(shown(null), ["a", "c"], "unknown team (first launch, no cache): hide nothing");
  eq(shown(new Set()), ["a", "c"], "not on any team: everything shows");
  const cachedEmpty = startupTeamBrandIds(null, serializeTeamBrandCache(new Set()));
  assert(cachedEmpty !== null && cachedEmpty.size === 0, "a cached empty set is known, not unknown");
  eq(shown(cachedEmpty), ["a", "c"], "a guest with a cached empty team set sees the rows on first render");
  eq(shown(startupTeamBrandIds(null, serializeTeamBrandCache(new Set(["b2"])))), ["a"], "a cached host set hides at once");
  const fresh = new Set(["b1"]);
  eq(startupTeamBrandIds(fresh, serializeTeamBrandCache(new Set(["b2"]))), fresh, "the fresh set is never replaced by the cache");
});

Deno.test("#4114 / #4459 Explorer: unread excludes hidden host chats and counts each Guest chat once", () => {
  const team = new Set(["mine"]);
  const chats = [dm, guestChat("m1", "mine", { unread_count: 7 }), guestChat("g1", "guest", { unread_count: 3 })];
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
  const sorted = page.slice(page.indexOf("const sortedConversations = useMemo("), page.indexOf("const listConversations = sortedConversations;"));
  assert(sorted.includes("explorerChats") && !/\bconversations\s*\.filter/.test(sorted), "the list and archive read Explorer's chats only");
  assert(page.includes("allConversations: explorerChats,"), "search reads Explorer's chats only");
  assert(/const totalUnread = explorerUnreadTotal\(/.test(page), "the unread badge excludes host chats");
  const selectStart = page.indexOf("const handleSelectConversation = async (");
  const select = page.slice(selectStart, page.indexOf("if (isRemovedBrandGuestsRow(known)) {", selectStart));
  assert(select.includes("isHostChatForUser(known, teamBrandIds)") && select.includes("t('connections:host_chat_in_business_app')"),
    "a push or deep link to a host chat shows the Host app toast and never opens it");
  // #4265: the startup read no longer blocks the list; the fresh set is
  // written by the chat list query (hooks/useChatList.ts).
  const hook = Deno.readTextFileSync(new URL("hooks/useChatList.ts", root));
  assert(page.includes("AsyncStorage.getItem(teamBrandCacheKey(user.id))") &&
    page.includes("setCachedTeamBrandIds((current) => startupTeamBrandIds(current, cachedTeams))") &&
    page.includes("loadedTeamBrandIds ? new Set(loadedTeamBrandIds) : cachedTeamBrandIds"), "the cached set is used at startup");
  assert(hook.includes("AsyncStorage.setItem(teamBrandCacheKey(userId), serializeTeamBrandCache(new Set(data.teamBrandIds)))"), "each fresh read is cached");
  assert(cleanup.includes("if (key.startsWith(TEAM_BRAND_CACHE_PREFIX)) return true;"), "logout removes the cached set");
  for (const locale of ["en", "fr", "yo", "zh"]) {
    const strings = JSON.parse(Deno.readTextFileSync(new URL(`i18n/locales/${locale}/connections.json`, root)));
    assert(typeof strings.host_chat_in_business_app === "string" && strings.host_chat_in_business_app.length > 0, `${locale} toast`);
  }
});
