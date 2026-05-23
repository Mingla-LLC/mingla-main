#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const message = read("app-mobile/src/components/MessageInterface.tsx");
const banners = read(
  "app-mobile/src/components/chat/CollabSessionChatBanners.tsx",
);
const boardDiscussion = read(
  "app-mobile/src/components/board/BoardDiscussionTab.tsx",
);

const failures = [];
function check(label, ok, fix) {
  if (ok) {
    console.log(`PASS ${label}`);
  } else {
    failures.push({ label, fix });
    console.error(`FAIL ${label}`);
    console.error(`  fix: ${fix}`);
  }
}

check(
  "session group-chat discriminator is exact",
  /const isCollabSessionGroupChat =\s*\n\s*isGroupChat && friend\.linkedEntityType === "session" && !!friend\.sessionId;/.test(
    message,
  ),
  'Mount CollabSessionChatBanners only behind isGroupChat && friend.linkedEntityType === "session" && !!friend.sessionId.',
);

check(
  "CollabSessionChatBanners rendered from MessageInterface only",
  (message.match(/<CollabSessionChatBanners/g) ?? []).length === 1 &&
    !boardDiscussion.includes("CollabSessionChatBanners"),
  "There must be exactly one MessageInterface mount and no BoardDiscussionTab mount.",
);

const renderIndex = message.indexOf("<CollabSessionChatBanners");
const guardWindow = message.slice(
  Math.max(0, renderIndex - 220),
  renderIndex + 240,
);
check(
  "render is guarded by isCollabSessionGroupChat",
  /isCollabSessionGroupChat \? \(\s*\n\s*<CollabSessionChatBanners/.test(
    guardWindow,
  ),
  "Render the banners as a sibling conditional guarded by isCollabSessionGroupChat.",
);

check(
  "trip/event banner path remains separate",
  /isTripEventGroupChat \? \(/.test(message) &&
    /isCollabSessionGroupChat \? \(/.test(message) &&
    message.indexOf("isTripEventGroupChat ? (") <
      message.indexOf("isCollabSessionGroupChat ? ("),
  "Keep trip/event broadcast banners and collab session banners in separate sibling blocks.",
);

check(
  "new sheets use Modal and do not consume TopSheet",
  /<Modal[\s\S]+<Modal[\s\S]+<Modal/.test(banners) && !/TopSheet/.test(banners),
  "ScheduleSheet, SavedToSessionCardsSheet, and InChatDeckSheet must use standard Modal, not TopSheet.",
);

check(
  "in-chat deck mount carries strict session scope anchors",
  /sessionIdOverride=\{sessionId\}/.test(banners) &&
    /currentMode="collab"/.test(banners) &&
    /key=\{sessionId\}/.test(banners) &&
    /<PreferencesSheet[\s\S]+sessionId=\{sessionId\}/.test(banners),
  "InChatDeckSheet must pass sessionIdOverride, force collab mode, reset by key, and render PreferencesSheet inside the Modal.",
);

check(
  "in-chat deck mount is wrapped in session-scoped RecommendationsProvider",
  /import \{ RecommendationsProvider \} from "\.\.\/\.\.\/contexts\/RecommendationsContext";/.test(
    banners,
  ) &&
    /<RecommendationsProvider\s+currentMode=\{sessionId\}\s+key=\{sessionId\}>[\s\S]*?<SwipeableCards[\s\S]*?sessionIdOverride=\{sessionId\}[\s\S]*?<\/RecommendationsProvider>/.test(
      banners,
    ),
  "Wrap the InChatDeckSheet SwipeableCards mount in <RecommendationsProvider currentMode={sessionId} key={sessionId}>.",
);

check(
  "saved-to-session sheet remounts SwipeableSessionCards",
  /export function SavedToSessionCardsSheet/.test(banners) &&
    /<SwipeableSessionCards[\s\S]+cards=\{savedCards\}[\s\S]+sessionId=\{sessionId\}[\s\S]+userId=\{currentUserId \?\? undefined\}[\s\S]+participantCount=\{participantCount\}[\s\S]+onViewDetails=\{openExpandedCardModal\}[\s\S]+accountPreferences=\{accountPreferences\}[\s\S]+isAdmin=\{isAdmin\}/.test(
      banners,
    ),
  "The saved-to-session chat sheet must remount SwipeableSessionCards instead of reintroducing custom liked-card JSX.",
);

if (failures.length > 0) {
  console.error(
    `\nORCH-0918 strict-grep gate FAILED with ${failures.length} violation(s).`,
  );
  process.exit(1);
}

console.log(
  "\nORCH-0918 strict-grep gate PASS — collab banners are session-conversation scoped.",
);
