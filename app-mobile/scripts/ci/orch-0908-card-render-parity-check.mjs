#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0908 CARD-RENDER-PARITY adversarial check (2026-05-21).
 *
 * The combined RPC originally nested the card under card_payload.card_data,
 * which broke the ORCH-0667 chat substrate (it reads CardPayload fields at the
 * top level — title, image, category — and falls back to a bookmark
 * placeholder + "No images available" stub when they're missing).
 *
 * Migration 20260630000000 fixes this by spreading saved_card.card_data at the
 * top level of card_payload and adding four lock-in extras alongside
 * (lockInEvent, scheduledAt, durationMinutes, lockerUserId, savedCardId,
 * sessionId).
 *
 * This adversarial check enforces:
 *
 *   §R-1. SQL: card_payload is built by spreading v_card_data at the top
 *         level (jsonb_strip_nulls(v_card_data || jsonb_build_object(...))).
 *         There is NO 'card_data' key at the top level of the built payload.
 *
 *   §R-2. SQL: the four lock-in extras + savedCardId + sessionId are added at
 *         the top level alongside the spread card_data.
 *
 *   §R-3. TS: CardPayload interface (messagingService.ts) exposes
 *         lockInEvent, scheduledAt, durationMinutes, lockerUserId,
 *         savedCardId, sessionId.
 *
 *   §R-4. TS: cardPayloadAdapter.ts passes lockInEvent + scheduledAt +
 *         durationMinutes + lockerUserId + savedCardId + sessionId through
 *         to ExpandedCardData, AND falls back to scheduledAt for
 *         selectedDateTime when set.
 *
 *   §R-5. TS: MessageBubble.tsx renders a locked banner when
 *         cardPayload.lockInEvent === 'card_locked_and_scheduled'.
 *
 *   §R-6. TS: ExpandedCardModal.tsx mounts <LockedInBanner /> inside the
 *         BottomSheetScrollView (gated on card non-null).
 *
 *   §R-7. TS: ExpandedCardData type (expandedCardTypes.ts) carries
 *         lockInEvent + scheduledAt + lockerUserId + savedCardId + sessionId.
 *
 * Different angle than the implementor's happy-path
 * (orch-0908-combined-regression-check.mjs) which asserts the architectural
 * flow (sender_id=v_uid, message_type='card', two-step sheet, auto-add).
 * This check is strictly about CardPayload shape parity + render-side
 * consumption — the bug class that produced the orange-placeholder
 * regression.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const read = (relFromRepoRoot) => {
  const abs = path.join(repoRoot, relFromRepoRoot);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    console.error(`Cannot read ${relFromRepoRoot}:`, e.message);
    process.exit(2);
  }
};

let passed = 0;
let failed = 0;
const fails = [];

function check(label, ok, hint) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    fails.push({ label, hint });
    console.log(`  ✗ ${label}`);
    if (hint) console.log(`     hint: ${hint}`);
  }
}

const migration = read(
  "supabase/migrations/20260630000000_orch_0908_card_payload_flatten.sql",
);
const messagingService = read("app-mobile/src/services/messagingService.ts");
const adapter = read("app-mobile/src/services/cardPayloadAdapter.ts");
const messageBubble = read("app-mobile/src/components/chat/MessageBubble.tsx");
const expandedModal = read("app-mobile/src/components/ExpandedCardModal.tsx");
const expandedTypes = read("app-mobile/src/types/expandedCardTypes.ts");

console.log("\n[ORCH-0908 card-render-parity adversarial check]");

// §R-1: SQL spreads v_card_data at top level; no nested 'card_data' key in payload.
console.log("\n§R-1 SQL: flat spread, no nested card_data key");
check(
  "migration uses `v_card_data ||` spread to build payload at top level",
  /v_card_payload\s*:=[^;]*COALESCE\(v_card_data,\s*'\{\}'::jsonb\)\s*\|\|\s*jsonb_build_object/.test(
    migration,
  ),
  "card_payload must spread v_card_data, not nest under a 'card_data' key",
);
check(
  "migration does NOT write 'card_data' as a top-level key in card_payload jsonb_build_object",
  !/jsonb_build_object\([^)]*'card_data'[^)]*v_card_data/s.test(migration),
  "fix: remove any 'card_data', v_card_data pair from jsonb_build_object",
);

// §R-2: lock-in extras present.
console.log("\n§R-2 SQL: lock-in extras at top level of card_payload");
const r2Required = [
  "'lockInEvent', 'card_locked_and_scheduled'",
  "'scheduledAt'",
  "'durationMinutes'",
  "'lockerUserId'",
  "'savedCardId'",
  "'sessionId'",
];
for (const needle of r2Required) {
  check(
    `migration includes ${needle} in jsonb_build_object`,
    migration.includes(needle),
    `add ${needle} to the jsonb_build_object alongside v_card_data spread`,
  );
}

// §R-3: CardPayload type carries the lock-in fields.
console.log("\n§R-3 CardPayload interface carries lock-in fields");
for (const field of [
  "lockInEvent?: 'card_locked_and_scheduled'",
  "scheduledAt?: string",
  "durationMinutes?: number",
  "lockerUserId?: string",
  "savedCardId?: string",
  "sessionId?: string",
]) {
  check(
    `CardPayload exposes ${field}`,
    messagingService.includes(field),
    `add ${field} to interface CardPayload`,
  );
}

// §R-4: adapter passes through + falls back for selectedDateTime + legacy nested shape.
console.log(
  "\n§R-4 cardPayloadAdapter passes lock-in fields + tolerates legacy nested rows",
);
for (const [label, re] of [
  ["adapter emits lockInEvent (raw camel or legacy event discriminator)", /lockInEvent:\s*raw\.lockInEvent\s*\?\?\s*\(raw\.event === 'card_locked_and_scheduled'/],
  ["adapter emits scheduledAt (camel or snake fallback)", /scheduledAt\s*=\s*raw\.scheduledAt\s*\?\?\s*raw\.scheduled_at/],
  ["adapter emits durationMinutes (camel or snake)", /durationMinutes:\s*raw\.durationMinutes\s*\?\?\s*raw\.duration_minutes/],
  ["adapter emits lockerUserId (camel or snake)", /lockerUserId:\s*raw\.lockerUserId\s*\?\?\s*raw\.locker_user_id/],
  ["adapter emits savedCardId (camel or snake)", /savedCardId:\s*raw\.savedCardId\s*\?\?\s*raw\.saved_card_id/],
  ["adapter emits sessionId (camel or snake)", /sessionId:\s*raw\.sessionId\s*\?\?\s*raw\.session_id/],
]) {
  check(label, re.test(adapter), "see cardPayloadAdapter.ts return object");
}
check(
  "adapter falls back to scheduledAt for selectedDateTime",
  /selectedDateTime:[\s\S]*scheduledAt\s*\?\s*new Date\(scheduledAt\)/.test(
    adapter,
  ),
  "adapter must seed selectedDateTime from scheduledAt when present, so ExpandedCardModal's date-aware sections render",
);
check(
  "adapter reads legacy nested .card_data via raw.card_data fallback",
  /raw\.card_data\s+&&\s+typeof raw\.card_data === 'object'/.test(adapter),
  "adapter must tolerate the v1 nested shape so historical rows still render",
);

// §R-5: MessageBubble renders lock-in banner + tolerates legacy nested shape.
console.log("\n§R-5 MessageBubble renders lockInEvent banner + legacy-tolerant");
check(
  "MessageBubble guards banner on lockInEvent === 'card_locked_and_scheduled'",
  /cp\.lockInEvent === 'card_locked_and_scheduled'/.test(messageBubble),
  "wrap banner in `{cp.lockInEvent === 'card_locked_and_scheduled' && ...}`",
);
check(
  "MessageBubble normalizes legacy nested card_data + snake_case event/scheduled_at",
  /raw\.card_data\s+&&\s+typeof raw\.card_data === 'object'/.test(messageBubble) &&
    /raw\.event === 'card_locked_and_scheduled'/.test(messageBubble),
  "render path must fall back to legacy nested shape so historical rows still show image/title",
);
check(
  "MessageBubble defines cardBubbleLockedBanner style",
  messageBubble.includes("cardBubbleLockedBanner:"),
  "add a banner style block under styles",
);

// §R-6: ExpandedCardModal mounts LockedInBanner.
console.log("\n§R-6 ExpandedCardModal mounts LockedInBanner");
check(
  "ExpandedCardModal defines LockedInBanner component",
  /function LockedInBanner\(\s*\{\s*card\s*\}/.test(expandedModal),
  "add `function LockedInBanner({ card }: { card: ExpandedCardData })`",
);
check(
  "ExpandedCardModal mounts <LockedInBanner card={card} /> inside the scroll view",
  /\{card && <LockedInBanner card=\{card\} \/>\}/.test(expandedModal),
  "mount the banner at the top of BottomSheetScrollView, guarded on card non-null",
);
check(
  "LockedInBanner shows Add-to-Calendar CTA",
  expandedModal.includes("Add to Calendar"),
  "render an 'Add to Calendar' button in the banner",
);
check(
  "LockedInBanner flips CTA to 'Added' when device_calendar_event_id is set",
  /alreadyAdded\s*\?\s*'Added'/.test(expandedModal),
  "use a state flag (alreadyAdded) sourced from calendar_entries.device_calendar_event_id",
);

// §R-7: ExpandedCardData carries lock-in fields.
console.log("\n§R-7 ExpandedCardData carries lock-in fields");
for (const field of [
  "lockInEvent?: 'card_locked_and_scheduled'",
  "scheduledAt?: string",
  "durationMinutes?: number",
  "lockerUserId?: string",
  "savedCardId?: string",
  "sessionId?: string",
]) {
  check(
    `ExpandedCardData exposes ${field}`,
    expandedTypes.includes(field),
    `add ${field} to interface ExpandedCardData`,
  );
}

// §R-8: SQL one-shot backfill flattens existing nested rows.
console.log("\n§R-8 SQL: one-shot backfill flattens existing nested rows");
check(
  "migration includes UPDATE messages SET card_payload = ... for legacy nested rows",
  /UPDATE public\.messages[\s\S]*SET\s+card_payload[\s\S]*card_payload->'card_data'/.test(migration),
  "add a one-shot UPDATE to flatten card_payload where card_payload ? 'card_data'",
);
check(
  "backfill renames snake_case lock-in keys to camelCase",
  /'lockInEvent'[\s\S]*'scheduledAt'[\s\S]*card_payload->'scheduled_at'/.test(migration),
  "preserve scheduled_at/duration_minutes/locker_user_id under new camelCase keys",
);
check(
  "backfill is gated on message_type='card' AND card_payload ? 'card_data'",
  /WHERE message_type = 'card'[\s\S]*card_payload \? 'card_data'/.test(migration),
  "do not touch text messages or already-flat rows",
);

console.log(`\n[ORCH-0908 card-render-parity] passed=${passed} failed=${failed}`);
if (failed > 0) {
  console.log("\nFAIL summary:");
  for (const f of fails) {
    console.log(`  - ${f.label}`);
    if (f.hint) console.log(`      ${f.hint}`);
  }
  process.exit(1);
}
console.log("\nAll card-render-parity assertions passed.");
process.exit(0);
