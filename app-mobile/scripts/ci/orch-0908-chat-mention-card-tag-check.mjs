#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "../..");
const repoRoot = path.resolve(appRoot, "..");
const read = (relativePath, root = appRoot) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const checks = [];
const assert = (id, condition, detail) => {
  checks.push({ id, pass: Boolean(condition), detail });
};

const service = read("src/services/messagingService.ts");
const controller = read("src/hooks/useChatInputController.ts");
const participants = read("src/hooks/useConversationParticipants.ts");
const cardSource = read("src/hooks/useChatCardTagSource.ts");
const messageInterface = read("src/components/MessageInterface.tsx");
const bubble = read("src/components/chat/MessageBubble.tsx");
const notifyMessage = read("supabase/functions/notify-message/index.ts", repoRoot);

assert(
  "T-01/send-persists-structured-mentions",
  service.includes("mentions: validatedMentions") &&
    service.includes("card_tags: validatedCardTags") &&
    service.includes("type: 'message_mention'") &&
    messageInterface.includes("chatController.serializeForSend()"),
  "sendMessage must persist mentions/card_tags and fire message_mention fan-out from serialized input chips",
);

assert(
  "T-01/bubble-renders-card-tags",
  bubble.includes("isStructuredMention") &&
    bubble.includes("<ChatCardChip") &&
    messageInterface.includes("cardPayloadToExpandedCardData(cardTag.cardPayload)"),
  "MessageBubble must render structured mentions and tappable card-tag chips",
);

assert(
  "T-04/non-participant-filter",
  participants.includes(".from(\"conversation_participants\")") &&
    participants.includes("id !== currentUserId") &&
    !messageInterface.includes("availableFriends.map"),
  "Mention picker source must be conversation_participants and exclude self/app-wide search",
);

assert(
  "T-08/limit-enforcement",
  controller.includes("const MAX_MENTIONS = 10") &&
    controller.includes("const MAX_CARD_TAGS = 5") &&
    service.includes("mentions.length > 10") &&
    service.includes("cardTags.length > 5"),
  "Hook and service must reject mention/card-tag counts beyond the locked caps",
);

assert(
  "T-15/trim-card-payload",
  controller.includes("trimCardPayload(card.cardPayload)") &&
    service.includes("cardPayload: trimCardPayload(cardTag.cardPayload)") &&
    cardSource.includes(".from(\"board_saved_cards\")") &&
    cardSource.includes("useSavedCards"),
  "Every card tag must pass trimCardPayload and source from board_saved_cards/session or own saved cards/DM",
);

assert(
  "I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED",
  notifyMessage.includes("notifications_muted") &&
    notifyMessage.includes("skipPush: mutedSet.has(mentionedUserId)") &&
    notifyMessage.includes("mentioned you in \"${titleConvName}\""),
  "notify-message handleUnifiedMention must respect mute while preserving the in-app notification row",
);

const failed = checks.filter((check) => !check.pass);
for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"} ${check.id} — ${check.detail}`);
}

if (failed.length > 0) {
  console.error(`\nORCH-0908 chat mention/card-tag regression failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}

console.log(`\nORCH-0908 chat mention/card-tag regression passed: ${checks.length}/${checks.length}`);
