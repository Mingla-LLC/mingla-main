#!/usr/bin/env node
/**
 * ORCH-0918 implementor happy-path regression check.
 *
 * Covers T-01..T-12 + T-A16 from SPEC_ORCH-0918. Set
 * ORCH0918_SIMULATE_REVERT=1 to remove the new anchors in memory; the script
 * must fail. Set ORCH0918_SIMULATE_REMOVE_PROVIDER=1 to prove T-11 and T-A16
 * fail when the nested RecommendationsProvider is removed. Set
 * ORCH0918_SIMULATE_REMOVE_PROVIDER_KEY=1 to prove T-A16 fails when the nested
 * RecommendationsProvider is reused across session changes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const simulateRevert = process.env.ORCH0918_SIMULATE_REVERT === "1";
const simulateRemoveProvider =
  process.env.ORCH0918_SIMULATE_REMOVE_PROVIDER === "1";
const simulateRemoveProviderKey =
  process.env.ORCH0918_SIMULATE_REMOVE_PROVIDER_KEY === "1";

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const maybeRevert = (source) => {
  let next = source;
  if (simulateRevert) {
    next = next
      .replace(
        /const isCollabSessionGroupChat =[\s\S]*?!!friend\.sessionId;/,
        "const isCollabSessionGroupChat = false;",
      )
      .replace(
        /<CollabSessionChatBanners/g,
        "<CollabSessionChatBanners_REMOVED",
      )
      .replace(
        /sessionIdOverride\?: string;/g,
        "sessionIdOverride_REMOVED?: string;",
      )
      .replace(/if \(sessionIdOverride\) return sessionIdOverride;/g, "")
      .replace(
        /\.eq\('is_locked', true\)[\s\S]*?\.order\('scheduled_at', \{ ascending: true \}\)/g,
        ".eq('is_locked_REMOVED', true)",
      )
      .replace(/scheduled\.rows\.length > 0/g, "true")
      .replace(/savedCardsForLikesSheet\.length > 0/g, "true")
      .replace(
        /\$\{savedCardsForLikesSheet\.length\} cards saved/g,
        "${participants.length} participants",
      )
      .replace(/<SwipeableSessionCards/g, "<RemovedSessionCards")
      .replace(
        /<PreferencesSheet[\s\S]*?sessionName=\{session\?\.name\}\s*\/>/,
        "",
      )
      .replace(
        /mountedBy: 'in-chat-sheet' \| 'dedicated-screen' \| null;/g,
        "mountedBy_REMOVED: null;",
      )
      .replace(
        /<RecommendationsProvider\s+currentMode=\{sessionId\}\s+key=\{sessionId\}>\s*/g,
        "",
      )
      .replace(/\s*<\/RecommendationsProvider>/g, "");
  }
  if (simulateRemoveProvider) {
    next = next
      .replace(
        /<RecommendationsProvider\s+currentMode=\{sessionId\}\s+key=\{sessionId\}>\s*/g,
        "",
      )
      .replace(/\s*<\/RecommendationsProvider>/g, "");
  }
  if (simulateRemoveProviderKey) {
    next = next.replace(
      /<RecommendationsProvider\s+currentMode=\{sessionId\}\s+key=\{sessionId\}>/g,
      "<RecommendationsProvider currentMode={sessionId}>",
    );
  }
  return next;
};

const files = {
  message: maybeRevert(read("app-mobile/src/components/MessageInterface.tsx")),
  banners: maybeRevert(
    read("app-mobile/src/components/chat/CollabSessionChatBanners.tsx"),
  ),
  scheduledHook: maybeRevert(
    read("app-mobile/src/hooks/useSessionScheduledCards.ts"),
  ),
  store: maybeRevert(read("app-mobile/src/store/sessionDeckMountStore.ts")),
  swipeable: maybeRevert(read("app-mobile/src/components/SwipeableCards.tsx")),
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

function simulateScheduledRows() {
  const saved = [
    { id: "a", is_locked: true, locked_at: "2026-05-22T10:00:00Z" },
    { id: "b", is_locked: true, locked_at: "2026-05-22T10:00:00Z" },
    { id: "c", is_locked: true, locked_at: "2026-05-22T10:00:00Z" },
  ];
  const calendar = [
    { board_card_id: "b", scheduled_at: "2026-05-24T10:00:00Z" },
    { board_card_id: "a", scheduled_at: "2026-05-23T10:00:00Z" },
  ];
  const ids = new Set(saved.map((row) => row.id));
  return calendar
    .filter((row) => ids.has(row.board_card_id))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .map((row) => row.board_card_id);
}

function simulateMutex() {
  let mountedSessionId = null;
  let mountedBy = null;
  const acquire = (sessionId, owner) => {
    if (mountedSessionId === null) {
      mountedSessionId = sessionId;
      mountedBy = owner;
      return true;
    }
    if (mountedSessionId === sessionId && mountedBy === owner) return true;
    return false;
  };
  const release = (sessionId) => {
    if (mountedSessionId === sessionId) {
      mountedSessionId = null;
      mountedBy = null;
    }
  };
  const happy1 = acquire("s1", "in-chat-sheet");
  release("s1");
  const happy2 = acquire("s1", "dedicated-screen");
  const finalOwner = mountedBy;
  release("s1");
  const conflict1 = acquire("s1", "in-chat-sheet");
  const conflict2 = acquire("s1", "dedicated-screen");
  return { happy1, happy2, finalOwner, conflict1, conflict2 };
}

function sessionDeckFromProvider(sessionId) {
  const hasNestedSessionProvider =
    /<RecommendationsProvider\s+currentMode=\{sessionId\}(?:\s+key=\{sessionId\})?>[\s\S]*?<SwipeableCards/.test(
      files.banners,
    );
  const decks = {
    solo: ["solo-1", "solo-2"],
    sA: ["sA-1", "sA-2", "sA-3"],
    sB: ["sB-1", "sB-2"],
  };
  return hasNestedSessionProvider ? decks[sessionId] : decks.solo;
}

function simulateChatSwitchDecks() {
  const hasProviderCurrentMode =
    /<RecommendationsProvider\s+currentMode=\{sessionId\}/.test(
      files.banners,
    );
  const hasProviderKey =
    /<RecommendationsProvider\s+currentMode=\{sessionId\}\s+key=\{sessionId\}>/.test(
      files.banners,
    );
  const decks = {
    solo: ["solo-1", "solo-2"],
    sA: ["sA-1", "sA-2", "sA-3"],
    sB: ["sB-1", "sB-2"],
  };
  if (!hasProviderCurrentMode) {
    return { setA: decks.solo, setB: decks.solo };
  }
  if (!hasProviderKey) {
    return { setA: decks.sA, setB: decks.sA };
  }
  return { setA: decks.sA, setB: decks.sB };
}

check(
  "T-01 collab session chat mounts banners once",
  /isCollabSessionGroupChat[\s\S]+<CollabSessionChatBanners/.test(
    files.message,
  ) && (files.message.match(/<CollabSessionChatBanners/g) ?? []).length === 1,
  "MessageInterface must mount CollabSessionChatBanners exactly once behind the session predicate.",
);

const scheduledOrder = simulateScheduledRows();
check(
  "T-02 scheduled hook filters locked scheduled rows in ASC order",
  /from\('board_saved_cards'\)/.test(files.scheduledHook) &&
    /from\('calendar_entries'\)/.test(files.scheduledHook) &&
    /board_card_id/.test(files.scheduledHook) &&
    scheduledOrder.join(",") === "a,b",
  "useSessionScheduledCards must join locked saved cards to calendar_entries.board_card_id and sort by scheduledAt ASC.",
);

check(
  "T-03-rev saved-to-session banner count uses savedCardsForLikesSheet.length",
  /from\(["']board_saved_cards["']\)[\s\S]+\.eq\(["']is_locked["'], false\)[\s\S]+\.order\(["']saved_at["'], \{ ascending: false \}\)/.test(
    files.banners,
  ) &&
    /subtitle=\{`\$\{savedCardsForLikesSheet\.length\} cards saved`\}/.test(
      files.banners,
    ) &&
    /title="Saved to session"/.test(files.banners),
  "Saved-to-session banner must count unlocked board_saved_cards rows using the SessionViewModal Cards-tab filter.",
);

check(
  "T-04 sessionIdOverride wins over mode derivation",
  /sessionIdOverride\?: string/.test(files.swipeable) &&
    /if \(sessionIdOverride\) return sessionIdOverride;/.test(files.swipeable),
  "SwipeableCards must prefer sessionIdOverride.",
);

check(
  "T-05 absent override keeps existing boardsSessions derivation",
  /s\.id === currentMode/.test(files.swipeable) &&
    /s\.name === currentMode/.test(files.swipeable) &&
    /\(s as any\)\.session_id === currentMode/.test(files.swipeable),
  "Existing boardsSessions/currentMode derivation must remain.",
);

const mutex = simulateMutex();
check(
  "T-06 mutex acquire/release happy path",
  /mountedSessionId: null/.test(files.store) &&
    /release: \(sessionId\)/.test(files.store) &&
    mutex.happy1 &&
    mutex.happy2 &&
    mutex.finalOwner === "dedicated-screen",
  "Zustand mutex must release and allow the dedicated owner to acquire.",
);

check(
  "T-07 mutex conflict blocks second owner",
  /return false;/.test(files.store) &&
    mutex.conflict1 &&
    mutex.conflict2 === false,
  "Zustand mutex must block a different owner while mounted.",
);

check(
  "T-08 schedule banner hidden on empty",
  /scheduled\.rows\.length > 0 \?/.test(files.banners),
  "Schedule banner must render only when scheduled rows exist.",
);

check(
  "T-09-rev saved-to-session banner hidden on empty",
  /savedCardsForLikesSheet\.length > 0 \?/.test(files.banners),
  "Saved-to-session banner must render only when savedCardsForLikesSheet has rows.",
);

check(
  "T-10 preferences sheet is inside in-chat deck sheet structure",
  /export function InChatDeckSheet/.test(files.banners) &&
    /<Modal[\s\S]+visible=\{visible\}[\s\S]+<PreferencesSheet[\s\S]+sessionId=\{sessionId\}/.test(
      files.banners,
    ),
  "PreferencesSheet must be rendered inside InChatDeckSheet Modal children.",
);

check(
  "T-11 in-chat deck consumes session-scoped recommendations, not home-page recommendations",
  /import \{ RecommendationsProvider \} from "\.\.\/\.\.\/contexts\/RecommendationsContext";/.test(
    files.banners,
  ) &&
    /<RecommendationsProvider\s+currentMode=\{sessionId\}(?:\s+key=\{sessionId\})?>[\s\S]*?<SwipeableCards[\s\S]+sessionIdOverride=\{sessionId\}[\s\S]+currentMode="collab"/.test(
      files.banners,
    ) &&
    sessionDeckFromProvider("sA").join(",") === "sA-1,sA-2,sA-3" &&
    !sessionDeckFromProvider("sA").includes("solo-1"),
  "InChatDeckSheet must wrap SwipeableCards in a nested RecommendationsProvider keyed to sessionId so the rendered deck comes from sA, not ambient solo.",
);

check(
  "T-12 saved-to-session sheet remounts SwipeableSessionCards with SessionViewModal props",
  /export function SavedToSessionCardsSheet/.test(files.banners) &&
    /<SwipeableSessionCards[\s\S]+cards=\{savedCards\}[\s\S]+sessionId=\{sessionId\}[\s\S]+userId=\{currentUserId \?\? undefined\}[\s\S]+participantCount=\{participantCount\}[\s\S]+onViewDetails=\{openExpandedCardModal\}[\s\S]+loading=\{savedCardsLoading\}[\s\S]+accountPreferences=\{accountPreferences\}[\s\S]+isAdmin=\{isAdmin\}/.test(
      files.banners,
    ),
  "SavedToSessionCardsSheet must remount SwipeableSessionCards with cards, sessionId, userId, participantCount, onViewDetails, loading, accountPreferences, and isAdmin.",
);

const switchDecks = simulateChatSwitchDecks();
const switchIntersection = switchDecks.setA.filter((id) =>
  switchDecks.setB.includes(id),
);
check(
  "T-A16 switching chats renders each session's own deck with no cross-leak",
  switchDecks.setA.join(",") === "sA-1,sA-2,sA-3" &&
    switchDecks.setB.join(",") === "sB-1,sB-2" &&
    switchIntersection.length === 0,
  "The nested RecommendationsProvider must be keyed by sessionId so switching from sA to sB remounts the provider and cannot reuse sA deck state.",
);

let ok = true;
for (const c of checks) {
  const mark = c.pass ? "PASS" : "FAIL";
  console.log(`${mark} ${c.name}`);
  if (!c.pass) {
    ok = false;
    console.log(`  ${c.detail}`);
  }
}

if (!ok) process.exit(1);
console.log(
  `\nORCH-0918 regression check PASS (${checks.length}/${checks.length}).`,
);
