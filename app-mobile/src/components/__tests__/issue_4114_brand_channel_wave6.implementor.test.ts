// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 6 — the brand channel's WIRING and copy. The rules are
// exercised behaviourally in
// components/connections/__tests__/issue_4114_brand_channel_model.implementor.happy.test.ts;
// this suite pins the call sites so a revert of any of them fails CI.
//
// FAILS-ON-REVERT: the list no longer folds (sortedConversations straight into
// buildBrowseItems); the thread reads one chat instead of `.in()`; the realtime
// filter goes back to `eq.`; a send ignores the brand channel target (goes to
// ensureChatConversation); the event marker, the Sending to chip or the Next up
// card are no longer rendered; the "Broadcast" copy or the "Event chat ready"
// preview come back; a new string is missing or English in a locale.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function body(source: string, signature: RegExp): string {
  const match = signature.exec(source);
  assert(match, `missing ${signature}`);
  const start = source.indexOf("{", match.index + match[0].length - 1);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
}

Deno.test("W6 the Chats list folds guests' event chats per brand (team members excluded)", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/foldBrandChannels\(sortedConversations as ChatListItemConversation\[\], teamBrandIds\)/.test(page), "the list folds");
  assert(/\.from\('brand_team_members'\)\s*\.select\('brand_id'\)\s*\.eq\('user_id', userId\)\s*\.is\('removed_at', null\)/.test(page),
    "your own brand team rows are read");
  assert(/active: listConversations,/.test(page), "the browse list renders the folded rows");
  assert(!/active: sortedConversations,/.test(page), "the unfolded list is no longer rendered");
  assert(/eventBrandId: eventMeta\?\.brandId \?\? null/.test(page), "each event chat carries its brand id");
});

Deno.test("W6 one query, one realtime channel and per-chat writes for the merged thread", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const load = body(page, /const loadBrandChannelNewest = \(channel: BrandChannel, userId: string\) =>/);
  assert(/messagingService\.getMessages\(memberIds, userId\)/.test(load), "one read across the brand's chats");
  assert(/byConversation\.get\(raw\.conversation_id\)/.test(load), "rows are split by their own conversation");
  assert(/writeConversationMessages\(conversationId, list, \{ snapshot: \{ complete: !hasMore \} \}\)/.test(load), "through the Wave 1 merge");
  assert(/markConversationAsRead\(conversationId, userId, list\)/.test(load), "opening marks each chat read");
  const open = body(page, /const handleOpenBrandChannel = async \(/);
  assert(/setupRealtimeSubscription\(memberIds, userId\)/.test(open), "one realtime subscription for all ids");
  assert(/brandChannelMessages\(/.test(page) && /mergeMessages\(prev, incoming\)/.test(page), "the thread is merged with mergeMessages");

  const service = strip(await read("services/messagingService.ts"));
  const getMessages = service.slice(service.indexOf("async getMessages("), service.indexOf("async getReactionsForMessages("));
  assert(/base\.in\('conversation_id', ids\)/.test(getMessages), "getMessages pages across several chats with .in()");
  const subscribe = service.slice(service.indexOf("subscribeToConversation("), service.indexOf("unsubscribeFromConversation(conversationId: string)"));
  assert(/const filter = conversationRealtimeFilter\(conversationId\);/.test(subscribe), "the realtime filter covers every id");
  assert(!/conversation_id=eq\.\$\{conversationId\}/.test(subscribe), "no single-id filter left");
});

Deno.test("W6 a send goes to exactly one event chat (D10)", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  for (const name of ["handleSendMessage", "handleSendMedia"]) {
    const fn = body(page, new RegExp(`const ${name} = async \\(`));
    assert(/const brandTarget = brandChannelSendTarget\(replyToId\);/.test(fn), `${name} resolves the brand target with the reply`);
    assert(/const conversationId = brandTarget \?\? await ensureChatConversation\(\);/.test(fn), `${name} sends to that one chat`);
  }
  const target = body(page, /const brandChannelSendTarget = \(replyToId\?: string\): string \| null =>/);
  assert(/replyToConversationId: replyToId \? conversationOfMessage\(replyToId\) : null/.test(target), "a reply targets the quoted message's chat");
});

Deno.test("W6 the thread draws markers, the Next up card, the chip and per-event guests", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/<BrandChannelEventMarker/.test(chat), "event markers render");
  assert((chat.match(/\{eventMarker\}/g) ?? []).length === 3, "every row kind can carry a marker");
  assert(/eventMarker: brandChannel && eventMarkerIds\?\.has\(message\.id\)/.test(chat), "markers come from the run starts");
  assert(/\{brandChannel && showSendChip && sendTargetEvent \? \(\s*<BrandChannelSendChip/.test(chat), "the chip shows only when showSendTargetChip says so");
  assert(/replyToConversationId: replyingTo\?\.conversationId \?\? null/.test(chat), "the chip names the reply's event");
  assert(/<TripCountdownBanner\s+eventId=\{nextUp\.eventId\}/.test(chat), "Next up reuses the countdown banner on the soonest event");
  assert(/router\.push\(`\/b\/\$\{brandSlug\}` as never\)/.test(chat), "the brand page opens on the existing route");
  assert(/audienceParticipants\.map\(/.test(chat), "the guest list is one event's people");
  assert(/avatarKind === "brand"/.test(strip(await read("components/chat/ChatHeader.tsx"))), "the header has the brand variant");
});

Deno.test("W6 no false Broadcast label and no placeholder preview", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const row = strip(await read("components/connections/ChatListItem.tsx"));
  for (const phrase of ["Trip broadcast", "Event broadcast", "Broadcast-only", "broadcast ready"]) {
    assert(!chat.includes(phrase) && !row.includes(phrase), `"${phrase}" is gone`);
  }
  assert(!row.includes("preview_event_ready") && row.includes("connections:preview_no_messages"), "empty event preview reads No messages yet");
  const banner = strip(await read("components/chat/TripCountdownBanner.tsx"));
  assert(!/days out|View details|your trip/.test(banner), "the countdown banner is translated");
  const plans = strip(await read("components/chat/CollabSessionChatBanners.tsx"));
  assert(/title=\{t\("chat:plansTitle"\)\}/.test(plans) && !plans.includes("No locked-in plans yet."), "the Plans sheet is translated");
});

const LOCALES = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"];
// bin, ha, ig and yo use English for these strings (no reviewed translations yet).
const ENGLISH_ALLOWED = new Set(["en", "bin", "ha", "ig", "yo"]);
const CHAT_KEYS = [
  "plansTitle", "plansClose", "plansRetryA11y", "plansLoadFailed", "plansEmpty", "theOrganiser", "eventChannel", "tripChannel",
  "channelDetailOpen", "channelDetailOpenTrip", "channelDetailHostOnly", "eventChannelLine", "tripChannelLine",
  "eventChannelHostOnlyLine", "tripChannelHostOnlyLine", "hostOnlyComposerNotice", "audienceRoleAttendee", "audienceRoleTraveller",
  "audienceEmptyAttendees", "audienceEmptyTravellers", "audienceEmptyEventBody", "audienceEmptyTripBody", "audienceViewEvent",
  "audienceViewTrip", "audienceViewEventA11y", "countdownYourTrip", "countdownToday", "countdownViewDetails", "countdownOpenEvent",
  "nextUpToday", "moreEvents", "a11yOpenBrandPage", "brandEventMarkerEnded", "brandEventMarkerA11y", "sendingTo", "sendingToA11y",
  "sendToTitle", "sendToNote", "sendToEnded", "sendToViewGuests",
];
const CHAT_PLURALS = ["countdownDaysOut", "nextUpInDays", "moreEventsA11y", "brandChannelSubtitle", "sendToGoing", "sendToWent", "sendToTravelled"];
const placeholders = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join("|");

Deno.test("W6 the channel, audience, countdown and Plans strings exist in all 29 locales", async () => {
  const load = async (locale: string, ns: string) => JSON.parse(await read(`i18n/locales/${locale}/${ns}.json`));
  const enChat = await load("en", "chat");
  for (const locale of LOCALES) {
    const chat = await load(locale, "chat");
    const connections = await load(locale, "connections");
    let localized = 0;
    for (const key of CHAT_KEYS) {
      const value = chat[key];
      assert(typeof value === "string" && value.trim().length > 0, `${locale}/chat ${key} missing`);
      assert(placeholders(value) === placeholders(enChat[key]), `${locale}/chat ${key} placeholders differ`);
      if (value !== enChat[key]) localized += 1;
    }
    for (const stem of CHAT_PLURALS) {
      const expected = new Intl.PluralRules(locale).resolvedOptions().pluralCategories.map((c) => `${stem}_${c}`).sort();
      const actual = Object.keys(chat).filter((key) => key.startsWith(`${stem}_`)).sort();
      assert(actual.join("|") === expected.join("|"), `${locale}/chat ${stem} plural categories: ${actual.join(",")}`);
      for (const key of actual) {
        assert(placeholders(chat[key]) === placeholders(enChat[`${stem}_other`]), `${locale}/chat ${key} placeholders differ`);
      }
    }
    assert(typeof connections.preview_no_messages === "string" && connections.preview_no_messages.length > 0, `${locale} preview_no_messages`);
    assert(!("preview_event_ready" in connections), `${locale} still has preview_event_ready`);
    if (!ENGLISH_ALLOWED.has(locale)) assert(localized >= CHAT_KEYS.length - 4, `${locale} is an English fallback (${localized})`);
  }
});
