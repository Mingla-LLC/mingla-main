// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 5 — a collab inside a 1:1 chat. The rules are exercised in
// components/chat/__tests__/issue_4114_dm_collab_model...; this suite pins the
// WIRING so a revert of any call site fails CI.
//
// FAILS-ON-REVERT: the 1:1 start not going through start_dm_collab (or the
// friend's push not reusing send-collaboration-invite); the Collab button not
// gated by dmCollabMode / the paywall; the 1:1 collab header ("Collaborating",
// Swipe, the deck) not driven by the session id; the list's direct_collab not
// fed by the access RPC; the strings missing from a locale.

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

Deno.test("W5 the 1:1 start calls start_dm_collab, and the friend's push reuses send-collaboration-invite", async () => {
  const service = strip(await read("services/dmCollabService.ts"));
  const start = body(service, /export async function startDmCollab\([\s\S]*?\): Promise<StartDmCollabResult> \{/);
  assert(/supabase\.rpc\('start_dm_collab', \{\s*p_conversation_id: params\.conversationId,/.test(start), "one RPC creates the collab");
  assert(!/from\('collaboration_sessions'\)\s*\.insert/.test(service), "no client-side session insert");
  assert(/functions\.invoke\('send-collaboration-invite'/.test(start), "push through the existing invite function");
  assert(start.indexOf("rpc('start_dm_collab'") < start.indexOf("send-collaboration-invite"), "push only after the collab exists");
  assert(/parseDmCollabStartError\(error\.message\)/.test(start), "server refusals are typed");
});

Deno.test("W5 the chat's Collab button, paywall and menu are wired", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const startHandler = body(chat, /const handleStartDmCollab = useCallback\(async \(\): Promise<void> =>/);
  assert(/if \(sessionLimitReached\) \{\s*onSessionLimitPaywall\?\.\(\);\s*return;/.test(startHandler), "limit reached → paywall, no RPC");
  assert(startHandler.indexOf("onSessionLimitPaywall") < startHandler.indexOf("startDmCollab("), "the gate runs before the start");
  assert(/error\.reason === "limit"\) \{\s*onSessionLimitPaywall\?\.\(\);/.test(startHandler), "a server limit refusal also opens the paywall");
  assert(/: dmCollabMode === "start"\s*\? \{\s*\/\/[^\n]*\n\s*label: t\('chat:collabButton'\)/.test(await read("components/MessageInterface.tsx")), "Collab shows only in start mode");
  assert(/canStartCollab: dmCollabMode === "start"/.test(chat), "menu start slot follows the same rule");
  assert(/case "startCollab":\s*afterMenuCloses\(\(\) => \{\s*void handleStartDmCollab\(\);/.test(chat), "menu start runs the same handler");
  assert(/case "endCollab":\s*afterMenuCloses\(handleEndDmCollab\);/.test(chat), "End the collab is wired");
  assert(/endDmCollab\(sessionId\)/.test(body(chat, /const handleEndDmCollab = useCallback\(\(\): void =>/)), "end goes through end_dm_collab");

  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/sessionLimitReached=\{dmCollabNeedsPaywall\(\{ canCreateSession, isUnlimited \}\)\}/.test(page), "the same gate as a new group");
  assert(/onSessionLimitPaywall=\{\(\) => \{\s*setPaywallFeature\('session_creation'\);\s*setShowPaywall\(true\);/.test(page), "the session_creation paywall");
});

Deno.test("W5 once joined, the 1:1 chat uses the collab header and the session drives the deck", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/const dmCollab = useDmCollabSession\(isDirectChat \? conversationId : null\);/.test(chat), "live session looked up by the chat id");
  assert(/const isCollabChat = isCollabSessionGroupChat \|\| isDmCollabActive;/.test(chat), "group or joined 1:1 collab");
  assert(/: isDmCollabActive\s*\? dmCollabSession\?\.id \?\? null/.test(chat), "the 1:1 collab's session id");
  assert(/useSessionSavedCardsForSheet\(\s*collabSessionId,/.test(chat), "matches from the session");
  assert(/useSessionScheduledCards\(collabSessionId\)/.test(chat), "plans from the session");
  assert(/isCollabChat && showCollabDeckSheet && collabSessionId \? \(\s*<CollabDeckSheet[\s\S]*?sessionId=\{collabSessionId\}/.test(chat), "the deck takes the session id");
  assert(/collaborating=\{isCollabChat\}/.test(chat), "orange ring");
  assert(/isDmCollabActive \? \([\s\S]*?t\('chat:collaborating'\)/.test(chat), "Collaborating subtitle");
  assert(/primaryAction=\{\s*isCollabChat\s*\? \{\s*label: t\('chat:swipe'\)/.test(chat), "Swipe in a 1:1 collab");
  const hook = strip(await read("hooks/useDmCollabSession.ts"));
  assert(/queryKey: key/.test(hook) && /dmCollabKeys\.session\(/.test(hook), "query key from the factory");
  const service = strip(await read("services/dmCollabService.ts"));
  assert(/\.eq\('conversation_id', conversationId\)\s*\.in\('status', \[\.\.\.DM_COLLAB_LIVE_STATUSES\]\)\s*\.order\('created_at', \{ ascending: false \}\)/.test(service), "live, newest first");
});

Deno.test("W5 invite cards render in the thread from the system rows", async () => {
  const chat = strip(await read("components/MessageInterface.tsx"));
  const system = chat.slice(chat.indexOf("if (item.message.isSystem) {"), chat.indexOf("return (\n            <>"));
  assert(/isDmCollabEventPayload\(dmCollabPayload\)/.test(system), "dm_collab rows are recognised");
  assert(/<DmCollabCard[\s\S]*onJoin=\{\(\) => \{\s*void handleJoinDmCollab\(dmCollabPayload\.session_id\);/.test(system), "Join");
  assert(/onDecline=\{\(\) => \{\s*void handleDeclineDmCollab\(dmCollabPayload\.session_id\);/.test(system), "Not now");
  assert(/onSetVibes=\{\(\) => setCollabPrefsLink\(\{ visible: true \}\)\}/.test(system), "Set my vibes opens PreferencesSheet");
  assert(/acceptCollaborationInvite\(\{ userId: currentUserId, sessionId \}\)/.test(chat), "Join reuses the one accept path");
  assert(/declineCollaborationInvite\(\{ userId: currentUserId, sessionId \}\)/.test(chat), "Not now reuses decline");
  assert(/\{prefsSessionId \? \(\s*<PreferencesSheet/.test(chat), "the prefs sheet follows the pending session too");
});

Deno.test("W5 the Chats list learns the live session from the access RPC (no new list query)", async () => {
  const messaging = strip(await read("services/messagingService.ts"));
  const list = body(messaging, /async getConversations\(userId: string\): Promise<[^\n]*> \{/);
  assert(/live_session_id: row\.live_session_id \?\? null/.test(list), "read from list_connection_conversation_access");
  assert((list.match(/supabase\s*\.from\(|supabase\.rpc\(/g) ?? []).length === 4, "still 3 parallel reads + 1 profile batch");
  const page = strip(await read("components/ConnectionsPage.tsx"));
  assert(/live_session_status: \(conv as any\)\.live_session_status \?\? null/.test(page), "carried into the list row");
});

Deno.test("W5 every new chat string exists in all 29 locales (bin/ha/ig/yo in English)", async () => {
  const locales = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"];
  const keys = [
    "collabButton", "collaborating", "menuEndCollab", "dmCollabYouStarted", "dmCollabFriendStarted",
    "dmCollabFriendStartedNotice", "dmCollabStarterBody", "dmCollabInviteeBody", "dmCollabSetVibes",
    "dmCollabJoin", "dmCollabNotNow", "dmCollabYouJoined", "dmCollabFriendJoined", "dmCollabEnded",
    "dmCollabEndConfirmTitle", "dmCollabEndConfirmBody", "dmCollabStartFailed", "dmCollabJoinFailed",
    "dmCollabDeclineFailed", "dmCollabEndFailed", "dmCollabTryAgain",
  ];
  const english = JSON.parse(await read("i18n/locales/en/chat.json"));
  for (const locale of locales) {
    const chat = JSON.parse(await read(`i18n/locales/${locale}/chat.json`));
    for (const key of keys) {
      assert(typeof chat[key] === "string" && chat[key].trim().length > 0, `${locale}/chat.json missing ${key}`);
      if (english[key].includes("{{name}}")) assert(chat[key].includes("{{name}}"), `${locale} ${key} keeps {{name}}`);
    }
    if (!["en", "bin", "ha", "ig", "yo"].includes(locale)) {
      assert(chat.dmCollabStarterBody !== english.dmCollabStarterBody, `${locale} is translated, not an English fallback`);
    }
  }
});
