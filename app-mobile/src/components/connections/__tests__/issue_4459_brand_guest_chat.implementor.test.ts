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
import { brandGuestBookingAction } from "../../chat/brandGuestBooking.ts";
import { latestEnquiryForBrand, enquiryThreadHref } from "../../brandEnquiry/brandGuestEnquiry.ts";
import {
  BRAND_GUEST_RATE_FALLBACK_MS,
  BRAND_GUEST_RATE_WINDOW_MS,
  brandGuestRateLimitedUntil,
  formatRateCountdown,
  isRateLimited,
} from "../../chat/brandGuestRateLimit.ts";
import { isSystemPreviewRow } from "../chatListModel.ts";
import { announceBrandGuestRejoin, onBrandGuestRejoined, resetBrandGuestRejoinForTests } from "../../chat/brandGuestRejoin.ts";
import { hasLeftConversation, markConversationLeft, markConversationRejoined } from "../../../utils/presenceMembership.ts";

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
  // #4630: an empty Guest chat is ordered by my brand activity, never by its created_at.
  const g = guest("bg1", "b1", { brand_activity_known: true, brand_activity_at: "2026-11-16T12:00:00Z" });
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
    // #4630: the "<Brand> Guests" row name and the Guests tag became the brand name + the "Brand" pill.
    for (const key of ["filter_brands", "filter_empty_brands", "section_brands", "brand_chat_pill", "brand_chat_preview_empty", "brand_guests_removed_tag"]) {
      assert(typeof connections[key] === "string" && connections[key].trim().length > 0, `${locale} has ${key}`);
    }
    for (const key of ["filter_events", "filter_empty_events", "section_events", "tag_event"]) {
      assert(!(key in connections), `${locale} no longer has ${key}`);
    }
    const chat = JSON.parse(read(`i18n/locales/${locale}/chat.json`));
    // #4630: the "<Brand> Guests" header title became the brand name; the welcome copy is brandChat*.
    for (const key of ["brandChatWelcomeTitle", "brandGuestsHostChip", "brandGuestsRemovedTitle", "brandGuestsPushNote", "tombstoneHostRemoved"]) {
      assert(typeof chat[key] === "string" && chat[key].trim().length > 0, `${locale} chat has ${key}`);
    }
    assert(!Object.keys(chat).some((key) => key.startsWith("brandChannelSubtitle") || key.startsWith("sendingTo")), `${locale} drops the fold copy`);
  }
});

Deno.test("#4459 booking card: Open, Rejoin after a sticky leave, Message <Brand> when removed", () => {
  eq(brandGuestBookingAction({ status: "member", canRejoin: false }), "open", "member opens the chat");
  eq(brandGuestBookingAction({ status: "left", canRejoin: true }), "rejoin", "left and still booked: Rejoin");
  eq(brandGuestBookingAction({ status: "left", canRejoin: false }), null, "left with no booking: nothing");
  eq(brandGuestBookingAction({ status: "removed", canRejoin: false }), "message", "removed: Message <Brand>, never Rejoin");
  eq(brandGuestBookingAction({ status: "not_eligible", canRejoin: false }), null, "no booking: nothing");
  eq(brandGuestBookingAction(null), null, "unknown: nothing");
  const card = read("components/purchases/BrandGuestChatBookingAction.tsx");
  assert(card.includes("messagingService.rejoinBrandGuestChat(brandId)") && card.includes("messagingService.getMyBrandGuestStatus(brandId)"), "the RPCs drive it");
  const page = read("../app/purchases/[kind]/[id].tsx");
  assert(page.includes("<BrandGuestChatBookingAction") && !page.includes("handleOpenChat"), "the booking card uses it, the per-listing chat link is gone");
});

Deno.test("#4459 Message <Brand> opens the enquiry thread, never the brand page", () => {
  const rows = [
    { enquiryId: "e-old", brandId: "b1", lastActivityAt: "2026-11-01T00:00:00Z" },
    { enquiryId: "e-new", brandId: "b1", lastActivityAt: "2026-11-10T00:00:00Z" },
    { enquiryId: "e-other", brandId: "b2", lastActivityAt: "2026-11-12T00:00:00Z" },
  ];
  eq(latestEnquiryForBrand(rows, "b1")?.enquiryId, "e-new", "the latest thread with that brand");
  eq(latestEnquiryForBrand(rows, "b9"), null, "none yet: start one");
  eq(enquiryThreadHref("e-new"), "/enquiry/e-new", "the #4111 thread route");
  const hook = read("components/brandEnquiry/useMessageBrandFromGuestChat.tsx");
  assert(hook.includes("router.push(enquiryThreadHref(existing.enquiryId)") && hook.includes("useExplorerBrandMessage("), "opens the thread, else the shared sheet");
  const chat = read("components/MessageInterface.tsx");
  assert(/onPress=\{brandMessage\.messageBrand\}/.test(chat), "the removed card's Message <Brand>");
  assert(chat.includes("onMessageBrand: () => { setShowGroupInfo(false); brandMessage.messageBrand(); }"), "the info sheet's Message <Brand>");
  const sheet = read("components/chat/GroupInfoSheet.tsx");
  assert(sheet.includes('testID="brand-guests-message-brand"'), "the info sheet row");
});

Deno.test("#4459 rate limit: amber countdown to when the oldest send leaves the window; Send held", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const sends = Array.from({ length: 20 }, (_, i) => new Date(now - (9 * 60 - i) * 1000).toISOString());
  const until = brandGuestRateLimitedUntil(sends, now);
  eq(until, now - 9 * 60 * 1000 + BRAND_GUEST_RATE_WINDOW_MS, "opens when the oldest counted send leaves the 10 minutes");
  eq(formatRateCountdown(until, now), "1:00", "m:ss");
  eq(formatRateCountdown(until, until + 5000), "0:00", "never negative");
  eq(brandGuestRateLimitedUntil([], now), now + BRAND_GUEST_RATE_FALLBACK_MS, "nothing local: a minute");
  assert(isRateLimited(until, now) && !isRateLimited(until, until) && !isRateLimited(null, now), "limited only before until");
  const chat = read("components/MessageInterface.tsx");
  assert(/if \(isRateLimited\(rateLimitedUntil, Date\.now\(\)\)\) return;/.test(chat), "Send is held (the text stays)");
  assert(chat.includes('testID="brand-guests-rate-limit"') && chat.includes("chat:brandGuestsRateLimitCountdown"), "the amber notice renders");
  const page = read("components/ConnectionsPage.tsx");
  assert(page.includes("setBrandGuestRateLimit({ conversationId, until: brandGuestRateLimitedUntil(mine, Date.now()) })"), "the page computes the countdown");
  assert(!page.includes("chat:brandGuestsRateLimited'"), "no toast for the rate limit");
});

Deno.test("#4459 a brand post (no sender) is never drawn as a system line", () => {
  assert(!isSystemPreviewRow({ sender_id: null, sender_kind: "brand", message_type: "text" }), "brand post");
  assert(isSystemPreviewRow({ sender_id: null, message_type: "text" }), "a real system row stays one");
  const service = read("services/messagingService.ts");
  assert(/if \(message\.sender_id == null\) return message\.sender_kind !== 'brand';/.test(service), "thread rows too");
});

// QA rework (D3, D5, rate-limit first refusal). MessageInterface is too heavy
// to mount in this lane, so these guard the exact wiring; each fails when the
// fix is reverted.
Deno.test("#4459 D3: a Guest chat offers no attachments (both the page and the thread say so)", () => {
  const page = read("components/ConnectionsPage.tsx");
  assert(page.includes("allowAttachments={!activeChat.brandGuest}"), "the page turns attachments off for brand_guests");
  const chat = read("components/MessageInterface.tsx");
  assert(chat.includes("const attachmentsAllowed = allowAttachments && !brandGuest;"), "the thread turns them off itself too");
  assert(!/\{allowAttachments \?/.test(chat), "no attach control reads the raw prop");
  eq((chat.match(/\{attachmentsAllowed \?/g) ?? []).length, 2, "the paperclip and its separator both read attachmentsAllowed");
});

Deno.test("#4459 D5: the Guest chat header counts the server's member total", () => {
  const chat = read("components/MessageInterface.tsx");
  assert(chat.includes("queryFn: () => messagingService.listBrandGuestMembers(conversationId as string)"), "reads the member RPC");
  assert(
    chat.includes("t('chat:brandGuestsSubtitle', { count: brandGuestMemberTotal ?? headerParticipantCount })"),
    "the subtitle uses the server total",
  );
});

Deno.test("#4459 rate limit: the first refused send keeps the words in the composer (no 'Not sent')", () => {
  const page = read("components/ConnectionsPage.tsx");
  const branch = page.indexOf('if (sendError === "brand_guests_rate_limited") {');
  const generic = page.indexOf("if (sendError || !sentMessage) {");
  assert(branch > 0 && generic > branch, "the rate-limit branch runs before the generic failure");
  const body = page.slice(branch, generic);
  assert(body.includes("failed: true, unsent: true"), "the refused bubble is hidden, not marked Not sent");
  assert(body.includes("setRestoreDraft(") && body.includes("text: current.content"), "the words go back");
  assert(/return;\s*\}\s*$/.test(body), "and it stops before markFailed");
  assert(page.includes("restoreDraft={restoreDraft && restoreDraft.conversationId === currentConversationId ? restoreDraft : null}"), "passed to the open thread");
  const chat = read("components/MessageInterface.tsx");
  assert(chat.includes("if (!chatController.readText().trim()) chatController.setDraftText(restoreDraft.text);"), "the composer takes them back");
});

// QA retest (P3 items). Each fails when its fix is reverted.
Deno.test("#4459 retest: the info sheet subtitle counts the server total for a Guest chat", () => {
  const sheet = read("components/chat/GroupInfoSheet.tsx");
  assert(
    sheet.includes("count: isBrandGuests ? brandGuestMembers.data?.total ?? members.length : members.length,"),
    "peopleInChat uses brandGuestMembers.data.total",
  );
});

Deno.test("#4459 retest: a rejoin reaches the Chats page, which drops the cached thread and reloads", () => {
  resetBrandGuestRejoinForTests();
  const seen: string[] = [];
  announceBrandGuestRejoin("c-early");
  const off = onBrandGuestRejoined((id) => seen.push(id));
  eq(seen, ["c-early"], "a rejoin announced before the Chats page listens is handed over");
  announceBrandGuestRejoin("c-live");
  eq(seen, ["c-early", "c-live"], "a live rejoin goes straight through");
  off();
  resetBrandGuestRejoinForTests();
  const page = read("components/ConnectionsPage.tsx");
  const at = page.indexOf("return onBrandGuestRejoined((conversationId) => {");
  assert(at > 0, "the Chats page listens for rejoins");
  const body = page.slice(at, at + 900);
  assert(body.includes("AsyncStorage.removeItem(getMessagesCacheKey(conversationId))"), "the saved copy goes");
  assert(body.includes("mergeMessages(EMPTY_MESSAGES, EMPTY_MESSAGES)"), "the in-memory thread restarts empty");
  assert(body.includes("messagingService.getMessages(conversationId, userId)"), "and reloads from the server");
});

Deno.test("#4459 retest: no presence write for a Guest chat just left; a rejoin turns it back on", () => {
  markConversationLeft("c1");
  assert(hasLeftConversation("c1"), "left");
  markConversationRejoined("c1");
  assert(!hasLeftConversation("c1"), "rejoined");
  const presence = read("services/chatPresenceService.ts");
  assert(/if \(hasLeftConversation\(conversationId\)\) return;\s*try \{\s*const \{ error \} = await supabase\s*\.from\('conversation_presence'\)\s*\.upsert/.test(presence),
    "upsertPresence skips a left chat before writing");
  const service = read("services/messagingService.ts");
  const leave = service.slice(service.indexOf("async leaveBrandGuestChat("), service.indexOf("async rejoinBrandGuestChat("));
  assert(/console\.error\('Error leaving brand guest chat:', error\);\s*return \{ error: error\.message \};\s*\}\s*\/\/[^\n]*\n\s*markConversationLeft\(conversationId\);/.test(leave),
    "a successful leave marks the chat left");
  const rejoin = service.slice(service.indexOf("async rejoinBrandGuestChat("), service.indexOf("async listBrandGuestMembers("));
  assert(rejoin.includes("if (conversationId) markConversationRejoined(conversationId);"), "a rejoin clears it");
});

Deno.test("#4459 retest: every enquiries channel is unique per mount", () => {
  const hooks = read("hooks/useBrandEnquiries.ts");
  assert(hooks.includes(".channel(`explorer-enquiries:${userId}:${suffix}`)"), "the list channel");
  assert(hooks.includes(".channel(`explorer-enquiry:${enquiryId}:${suffix}`)"), "the thread channel");
  assert(!/\.channel\(`explorer-enquir(?:y|ies):\$\{(?:userId|enquiryId)\}`\)/.test(hooks), "no fixed topic left");
});

Deno.test("#4459 retest 3: every successful Guest chat leave is announced (the booking status refreshes)", () => {
  const service = read("services/messagingService.ts");
  const leave = service.slice(service.indexOf("async leaveBrandGuestChat("), service.indexOf("async rejoinBrandGuestChat("));
  const failure = leave.indexOf("return { error: error.message };");
  const announce = leave.indexOf("announceBrandGuestLeft(conversationId);");
  assert(failure > 0 && announce > failure, "announced after the failure return, so only a successful leave");
});
