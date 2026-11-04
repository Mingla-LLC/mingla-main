// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — the Chats tab wiring. The behaviour is driven in
// issue_4265_chat_list_load.implementor.happy.test.ts; this suite pins the
// call sites so a revert of any of them fails CI:
//   * ConnectionsPage keeps NO local copy of the conversations: the list is
//     useChatList (React Query, key chatListKeys.list, persisted, 30-60 s
//     staleTime), and every local change writes through setConversations →
//     updateChatListConversations (no `useState<Conversation[]>`);
//   * "reload the chats" refetches that one entry;
//   * the startup AsyncStorage reads no longer run before the list loads;
//   * getConversations skips its own sender-profiles read for the list and
//     counts unread from the anti-join read;
//   * useSessionCreationGate keys by user only (no double fetch when the tier
//     resolves) and refreshes on a real tier change.
//
// FAILS-ON-REVERT: bring back `const [conversations, setConversations] =
// useState<Conversation[]>([])`, the `await fetchConversations(user.id)` in
// the mount effect, `tier` in the session-gate key, or the
// `message_reads(user_id)` download in getConversations and this suite fails.

const root = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("#4265 ConnectionsPage reads the list from one React Query entry and writes into it", () => {
  const page = strip(read("components/ConnectionsPage.tsx"));
  assert(!/useState<Conversation\[\]>/.test(page), "no local conversations state (one owner, Constitution #2)");
  assert(/const chatListQuery = useChatList\(user\?\.id \?\? null, chatListDeps\);/.test(page), "the list is useChatList");
  assert(/const chatListView = chatListViewState\(chatListQuery\);/.test(page) &&
    /const conversationsLoading = chatListView\.loading;/.test(page), "the skeleton follows chatListViewState");
  assert(/const showSkeleton = conversationsLoading && conversations\.length === 0 && !error;/.test(page), "skeleton only with no rows");
  assert(/updateChatListConversations<Conversation>\(queryClient, chatListKeyRef\.current, updater\)/.test(page),
    "local changes write into the query cache");
  assert(/chatListKeyRef\.current = chatListKeys\.list\(user\?\.id \?\? 'none'\);/.test(page), "the key comes from the factory");
  const fetch = page.slice(page.indexOf("const fetchConversations = useCallback("), page.indexOf("const handleRefresh = useCallback("));
  assert(/queryClient\.refetchQueries\(\{ queryKey: chatListKeys\.list\(userId\), exact: true \}\)/.test(fetch),
    "every reload refetches that one entry");
  assert(/const archivedIds = useMemo\(\(\) => archivedConversationIds\(/.test(page), "archive state is read from the rows");
  assert(!/setArchivedIds|setConversationsLoading|setTeamBrandIds\(/.test(page), "no parallel list state left");
});

Deno.test("#4265 nothing waits in front of the list on mount", () => {
  const page = read("components/ConnectionsPage.tsx");
  const mount = page.slice(page.indexOf("// ── Startup reads that never block the list"), page.indexOf("// ── Friends & requests freshness"));
  const mountCode = strip(mount);
  assert(mountCode.length > 0, "the startup effect exists");
  assert(!/await AsyncStorage\.getItem\(teamBrandCacheKey/.test(mountCode), "the team cache read is not awaited ahead of anything");
  assert(!/\n\s*if \(!cancelled\) await fetchConversations\(user\.id\);\n\s*\}\)\(\);/.test(mountCode), "the list fetch is not chained behind the reads");
  assert(/Promise\.all\(\s*legacyIds\.map/.test(mountCode), "the one-time archive move runs in parallel");
  assert(!/for \(const conversationId of ids/.test(mountCode), "no serial archive loop");
});

Deno.test("#4265 the chat list query: factory key, persisted per user, 30-60 s fresh", () => {
  const hook = strip(read("hooks/useChatList.ts"));
  const keys = read("hooks/queryKeys.ts");
  assert(/export const chatListKeys = \{\s*all: \['chatList'\] as const,\s*list: \(userId: string\) => \[\.\.\.chatListKeys\.all, 'list', userId\] as const,/.test(keys),
    "chatListKeys in the factory (the user id is in the key)");
  assert(/queryKey = chatListKeys\.list\(userId \?\? 'none'\)/.test(hook), "the hook uses the factory key");
  assert(/staleTime: CHAT_LIST_STALE_TIME_MS/.test(hook), "cached revisits do not refetch inside the fresh window");
  assert(/enabled: Boolean\(userId\)/.test(hook), "no read without a user");
  assert(!/gcTime:\s*0|meta:\s*\{\s*persist:\s*false/.test(hook), "not opted out of the persisted cache");
});

Deno.test("#4265 getConversations: no second profiles read for the list, unread from the anti-join", () => {
  const service = strip(read("services/messagingService.ts"));
  const start = service.indexOf("async getConversations(");
  const list = service.slice(start, service.indexOf("async getMessages(", start));
  assert(/applyUnreadFilters\(\s*supabase\.from\('messages'\)\.select\(UNREAD_MESSAGES_SELECT\),\s*userId,/.test(list) &&
    /isNull: \(query, column\) => query\.is\(column, null\),/.test(list) &&
    /eq: \(query, column, value\) => query\.eq\(column, value\),/.test(list), "unread read is the anti-join");
  assert(!/select\('id, conversation_id, message_reads\(user_id\)'\)/.test(list), "the download-every-read embed is gone");
  assert(/const unreadByConv = countUnreadRows\(unreadResult\.data\);/.test(list), "counted per conversation");
  assert(/if \(senderIds\.size > 0 && !options\.deferSenderProfiles\) \{/.test(list), "the list can skip the sender read");
  const page = strip(read("components/ConnectionsPage.tsx"));
  assert(/messagingService\.getConversations\(userId, \{ deferSenderProfiles: true \}\)/.test(page), "and the list does");
  assert(/rememberSenderProfiles: \(profiles\) => messagingService\.rememberSenderProfiles\(profiles\)/.test(page),
    "sender names still warm the messaging cache");
  assert(/last_message:messages\(/.test(list) && /read_status:message_reads\(user_id\)/.test(list),
    "the last-message embed is unchanged (one place for its columns)");
});

Deno.test("#4265 the session gate fetches once per user, not once per tier guess", () => {
  const gate = strip(read("hooks/useSessionCreationGate.ts"));
  assert(/const queryKey = \['session-creation-gate', user\?\.id\] as const;/.test(gate), "the key has no tier");
  assert(!/\['session-creation-gate', user\?\.id, tier\]/.test(gate), "tier is out of the key");
  assert(/if \(previous !== null && previous !== tier\) \{\s*void queryClient\.invalidateQueries\(\{ queryKey: \['session-creation-gate', user\.id\] \}\);/.test(gate),
    "a real tier change after it settled refreshes the gate");
  assert(/if \(tierLoading \|\| !user\?\.id\) return;/.test(gate), "the first tier resolution does not count as a change");
  assert(/maxSessions: data\?\.max \?\? maxSessions,/.test(gate), "the limit falls back to the tier at render time");
});
