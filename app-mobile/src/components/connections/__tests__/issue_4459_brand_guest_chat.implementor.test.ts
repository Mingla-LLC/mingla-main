// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4459 — Explorer shows the brand's one server-side Guest chat
// (linked_entity_type 'brand_guests') as the only brand_channel row. The
// #4114 Wave 6 client fold (__brandChannel, brandChannelModel.ts,
// BrandChannelParts.tsx) is gone; the Events filter is now Brands.
//
// INVARIANT issue-4459-brand-guests: Explorer renders the brand Guest chat as the only brand_channel row (no client fold).
//
// FAILS-ON-REVERT: bring back the fold (any `__brandChannel`,
// `foldBrandChannels` or `brand-channel:` in app-mobile/src) and the source
// guard fails; map brand_guests to anything but brand_channel in chatKind and
// the kind / filter cases fail; drop the brand_guests send branch in
// ConnectionsPage and the send case fails.
import {
  buildBrowseItems,
  buildSearchItems,
  chatKind,
  explorerConversations,
  explorerUnreadTotal,
  isHostChatForUser,
  isRemovedBrandGuestsRow,
  matchesChatFilter,
} from "../chatListModel.ts";
import { loadChatList } from "../chatListLoad.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected ${b}\n  actual   ${a}`);
}
const root = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, root));

const guest = (id: string, brandId: string, extra = {}) => ({
  id, created_at: "2026-11-16T10:00:00Z", type: "group", linked_entity_type: "brand_guests", brand_id: brandId,
  name: `Brand ${brandId}`, participants: [{ id: "me" }], unread_count: 0, ...extra,
});
const dm = { id: "dm", created_at: "2026-11-16T09:00:00Z", type: "direct", participants: [{ id: "me" }, { id: "you" }], unread_count: 1 };
const group = { id: "grp", created_at: "2026-11-16T08:00:00Z", type: "group", linked_entity_type: "session", participants: [], unread_count: 0 };

Deno.test("#4459 a brand Guest chat is the brand_channel row, and only it fills Brands", () => {
  const g = guest("bg1", "b1");
  eq(chatKind(g), "brand_channel", "brand_guests renders as brand_channel");
  const removed = guest("removed-brand-guests:b2", "b2", { __removedBrandGuests: { brandId: "b2" } });
  eq(chatKind(removed), "brand_channel", "a Removed row is a brand row too");
  assert(isRemovedBrandGuestsRow(removed) && !isRemovedBrandGuestsRow(g), "the Removed flag is its own");
  const all = [g, removed, dm, group];
  eq(all.filter((c) => matchesChatFilter(c, "brands")).map((c) => c.id), ["bg1", "removed-brand-guests:b2"], "Brands holds brand rows only");
  eq(buildBrowseItems({ active: all, archivedCount: 0, filter: "brands" }).map((i) => i.key), ["bg1", "removed-brand-guests:b2"], "Brands chip");
  const search = buildSearchItems({ matchedChats: all, friends: [], allConversations: all, currentUserId: "me", query: "b" });
  eq(search.filter((i) => i.kind === "section").map((i) => i.section), ["chats", "brands"], "search has a Brands section");
});

Deno.test("#4459 unread is the Guest chat's own count (no fold sum), and host brands are hidden everywhere", () => {
  const team = new Set(["mine"]);
  const chats = [dm, guest("own", "mine", { unread_count: 9 }), guest("g1", "b1", { unread_count: 4 })];
  assert(isHostChatForUser(chats[1], team) && !isHostChatForUser(chats[2], team), "keyed on brand_id");
  eq(explorerConversations(chats, team).map((c) => c.id), ["dm", "g1"], "list, filters and search never show the host chat");
  eq(explorerUnreadTotal(chats, team), 5, "1 (dm) + 4 (its own count); the host chat's 9 never count");
});

Deno.test("#4459 the Chats list load names Guest chats after their brand and adds Removed rows", async () => {
  const deps = {
    getConversations: async () => ({
      error: null,
      conversations: [
        { id: "bg1", type: "group", linked_entity_type: "brand_guests", brand_id: "b1", name: "Old name", created_at: "2026-11-16T00:00:00Z", participants: [{ user_id: "me" }] },
        { id: "own", type: "group", linked_entity_type: "brand_guests", brand_id: "mine", name: "Mine", created_at: "2026-11-16T00:00:00Z", participants: [{ user_id: "me" }] },
      ],
    }),
    fetchPendingInvites: async () => [],
    fetchTeamBrandIds: async () => ["mine"],
    fetchSessions: async () => [],
    fetchEventMeta: async () => new Map(),
    fetchBrandMeta: async (ids) => new Map(ids.map((id) => [id, { brandId: id, name: `Brand ${id}`, slug: `slug-${id}`, logoUrl: `https://x/${id}.png`, accountId: null }])),
    fetchRemovedBrandGuestChats: async () => [
      { brandId: "b9", brandName: "Club Nine", brandSlug: "club-nine", brandLogoUrl: null, brandAccountId: null, removedAt: "2026-11-15T00:00:00Z" },
      { brandId: "mine", brandName: "Mine", brandSlug: null, brandLogoUrl: null, brandAccountId: null, removedAt: "2026-11-15T00:00:00Z" },
    ],
    fetchProfiles: async (ids) => ids.map((id) => ({ id })),
    displayName: () => "Someone",
    eventPublicUrl: () => null,
    warn: () => {},
    setTimer: () => 0,
    clearTimer: () => {},
  };
  const data = await loadChatList("me", deps);
  const bg1 = data.conversations.find((c) => c.id === "bg1");
  eq([bg1.name, bg1.brand_id, bg1.eventBrandName, bg1.eventBrandSlug, bg1.eventBrandLogoUrl], ["Brand b1", "b1", "Brand b1", "slug-b1", "https://x/b1.png"], "named and drawn from its brand");
  eq(data.teamBrandIds, ["mine"], "the team set is read when Guest chats exist");
  const removed = data.conversations.filter((c) => c.__removedBrandGuests);
  eq(removed.map((c) => c.id), ["removed-brand-guests:b9"], "a Removed row per brand, never for your own brand");
  eq(removed[0].unread_count, 0, "a Removed row never has a badge count");
});

Deno.test("#4459 the client fold is gone (source guard)", () => {
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of Deno.readDirSync(dir)) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
      if (entry.isDirectory) walk(url);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = Deno.readTextFileSync(url);
        if (/__brandChannel|foldBrandChannels|brand-channel:/.test(text)) offenders.push(url.pathname);
      }
    }
  };
  walk(root);
  eq(offenders, [], "no fold code left in app-mobile/src");
  for (const gone of ["components/connections/brandChannelModel.ts", "components/chat/BrandChannelParts.tsx"]) {
    let exists = true;
    try { Deno.statSync(new URL(gone, root)); } catch { exists = false; }
    assert(!exists, `${gone} is deleted`);
  }
});

Deno.test("#4459 Guest chat sends go through the server RPC, and legacy event/trip rows are never listed", () => {
  const service = read("services/messagingService.ts");
  assert(service.includes("supabase.rpc('issue_4459_send_brand_guest_message'"), "the send RPC");
  assert(service.includes(".not('linked_entity_type', 'in', '(support,event,trip)')"), "the list never reads retired per-listing chats");
  const page = read("components/ConnectionsPage.tsx");
  assert(/const guestChat = isBrandGuestsConversation\(conversationId\);[\s\S]{0,900}messagingService\.sendBrandGuestMessage\(/.test(page),
    "deliverMessage routes a Guest chat send to the RPC");
  assert(page.includes("fetchBrandMeta: (brandIds) => messagingService.fetchBrandMeta(brandIds)"), "brand meta is wired");
  assert(page.includes("fetchRemovedBrandGuestChats: () => messagingService.listRemovedBrandGuestChats()"), "Removed rows are wired");
});

Deno.test("#4459 every locale has the Brands keys and none of the old Events keys", () => {
  const locales = [...Deno.readDirSync(new URL("i18n/locales/", root))].filter((e) => e.isDirectory).map((e) => e.name).sort();
  eq(locales.length, 29, "29 locales");
  for (const locale of locales) {
    const connections = JSON.parse(read(`i18n/locales/${locale}/connections.json`));
    for (const key of ["filter_brands", "filter_empty_brands", "section_brands", "tag_brand", "brand_guests_row_name", "brand_guests_removed_tag"]) {
      assert(typeof connections[key] === "string" && connections[key].trim().length > 0, `${locale} has ${key}`);
    }
    for (const key of ["filter_events", "filter_empty_events", "section_events", "tag_event"]) {
      assert(!(key in connections), `${locale} no longer has ${key}`);
    }
    const chat = JSON.parse(read(`i18n/locales/${locale}/chat.json`));
    for (const key of ["brandGuestsTitle", "brandGuestsHostChip", "brandGuestsRemovedTitle", "brandGuestsPushNote", "tombstoneHostRemoved"]) {
      assert(typeof chat[key] === "string" && chat[key].trim().length > 0, `${locale} chat has ${key}`);
    }
    assert(!Object.keys(chat).some((key) => key.startsWith("brandChannelSubtitle") || key.startsWith("sendingTo")), `${locale} drops the fold copy`);
  }
});
