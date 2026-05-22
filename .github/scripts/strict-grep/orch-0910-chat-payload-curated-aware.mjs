#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0910 strict-grep gate — I-PROPOSED-CHAT-PAYLOAD-CURATED-AWARE.
 *
 * Enforces the chat-mounted card parity contract:
 * - chat payload writers synthesize honest top-level images for curated cards;
 * - adapter passes cardType + stops into ExpandedCardModal;
 * - modal reads top-level placeId and computes viewer-relative travel;
 * - bubble renders the intent chip instead of falling back to bookmark-only UI;
 * - migration keeps ORCH-0908 row-count/idempotency discipline.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`ORCH-0910 strict-grep: cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const files = {
  messaging: read("app-mobile/src/services/messagingService.ts"),
  collab: read("app-mobile/src/components/helpers/collabSaveCard.ts"),
  adapter: read("app-mobile/src/services/cardPayloadAdapter.ts"),
  modal: read("app-mobile/src/components/ExpandedCardModal.tsx"),
  bubble: read("app-mobile/src/components/chat/MessageBubble.tsx"),
  migration: read("supabase/migrations/20260722000000_orch_0910_chat_intent_card_backfill.sql"),
};

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
  "CardPayload exposes curated discriminator and TrimmedCuratedStop",
  /cardType\?: 'curated' \| 'single'/.test(files.messaging) &&
    /export interface TrimmedCuratedStop/.test(files.messaging) &&
    /stops\?: TrimmedCuratedStop\[\]/.test(files.messaging),
  "Add cardType, stops, and TrimmedCuratedStop to messagingService.ts.",
);

check(
  "trimCardPayload derives image from stops and preserves curated metadata",
  /const isCurated = card\.cardType === 'curated' \|\| Array\.isArray\(card\.stops\)/.test(files.messaging) &&
    /firstStopImage = card\.stops\?\.find/.test(files.messaging) &&
    /trimmed\.cardType = 'curated'/.test(files.messaging) &&
    /trimmed\.stops = card\.stops\.map/.test(files.messaging),
  "Extend trimCardPayload with curated detection, first stop image synthesis, cardType, and stops.",
);

check(
  "curated size guard drops stop soft fields before tail stops",
  /trimmed\.stops = trimmed\.stops\.map\(s => \(\{ \.\.\.s, address: undefined \}\)\)/.test(files.messaging) &&
    /trimmed\.stops = trimmed\.stops\.map\(s => \(\{ \.\.\.s, travelTimeFromPreviousStopMin: undefined \}\)\)/.test(files.messaging) &&
    /trimmed\.stops = trimmed\.stops\.slice\(0, -1\)/.test(files.messaging) &&
    !/const dropOrder[\s\S]{0,450}'image'/.test(files.messaging) &&
    !/const dropOrder[\s\S]{0,450}'cardType'/.test(files.messaging),
  "Preserve image/cardType, then prune stops[].address, stops[].travelTimeFromPreviousStopMin, then tail stops.",
);

check(
  "buildCardDataPayload synthesizes curated image and images from stops",
  /c\.cardType === 'curated'/.test(files.collab) &&
    /image: \(c\.stops as any\[\] \| undefined\)\?\.find/.test(files.collab) &&
    /images: \(c\.stops as any\[\] \| undefined\)[\s\S]+?\.slice\(0, 6\)/.test(files.collab),
  "Curated collab save payload must emit top-level image and images.",
);

check(
  "cardPayloadAdapter passes curated fields through",
  /const cardType = \(raw\.cardType \?\? legacy\.cardType\) === 'curated'/.test(files.adapter) &&
    /cardType,\s*\n\s*stops: raw\.stops \?\? legacy\.stops/.test(files.adapter) &&
    /totalPriceMin: raw\.totalPriceMin \?\? legacy\.totalPriceMin/.test(files.adapter),
  "Adapter must pass cardType, stops, tagline, totals, and duration.",
);

check(
  "ExpandedCardModal reads top-level placeId and computes viewer-relative travel",
  /useUserLocation\(user\?\.id, currentMode\)/.test(files.modal) &&
    /haversineKm\(viewerLoc\.lat, viewerLoc\.lng, targetLat, targetLng\)/.test(files.modal) &&
    /estimateTravelMinutes\(distKm, effectiveTravelMode\)/.test(files.modal) &&
    /card\.placeId \?\? \(card as any\)\.source\?\.placeId/.test(files.modal),
  "Modal must use viewer GPS for chat-mounted travel and read card.placeId before source.placeId.",
);

check(
  "MessageBubble renders intent chip using effective stop image",
  /const isIntentCard = cp\.cardType === 'curated'/.test(files.bubble) &&
    /const effectiveImage = isIntentCard \? intentHeroImage : cp\.image/.test(files.bubble) &&
    /cardBubbleIntentChip/.test(files.bubble) &&
    /arrow-forward/.test(files.bubble),
  "Bubble must render first-stop image and the N stops overlay chip for curated payloads.",
);

check(
  "ORCH-0910 migration keeps RAISE EXCEPTION and idempotent WHERE discipline",
  /RAISE EXCEPTION 'ORCH-0910 backfill: messages precount % but UPDATE moved 0 rows'/.test(files.migration) &&
    /RAISE EXCEPTION 'ORCH-0910 backfill: board_saved_cards precount % but UPDATE moved 0 rows'/.test(files.migration) &&
    /card_payload->>'cardType' IS DISTINCT FROM 'curated'/.test(files.migration) &&
    /card_data->>'cardType' IS DISTINCT FROM 'curated'/.test(files.migration) &&
    /NOTIFY pgrst, 'reload schema'/.test(files.migration),
  "Migration must preserve row-count asserts, idempotent predicates, and schema reload notify.",
);

if (failures.length > 0) {
  console.error(`\nORCH-0910 strict-grep gate FAILED with ${failures.length} violation(s).`);
  process.exit(1);
}

console.log("\nORCH-0910 strict-grep gate PASS — chat payload is curated-aware.");
