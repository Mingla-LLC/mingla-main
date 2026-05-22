#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0910 happy-path regression check.
 *
 * Covers implementor-owned tests T-01 / T-06 / T-07 / T-09 / T-11 / T-14 /
 * T-16 / T-17 / T-25 / T-26 from SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md.
 *
 * This repo currently uses structural `.mjs` checks for app-mobile ORCH gates.
 * The checks below pin the load-bearing code contracts that made the original
 * bug possible. Set ORCH0910_SIMULATE_REVERT=1 to remove the new anchors in
 * memory; the script must then fail, proving the checks are not hollow.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const simulateRevert = process.env.ORCH0910_SIMULATE_REVERT === "1";

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const maybeRevert = (source) => {
  if (!simulateRevert) return source;
  return source
    .replace(/firstStopImage = card\.stops\?\.find/g, "firstStopImage_REMOVED = card.stops?.find")
    .replace(/trimmed\.cardType = 'curated'/g, "trimmed.cardType_REMOVED = 'curated'")
    .replace(/trimmed\.stops = card\.stops\.map/g, "trimmed.stops_REMOVED = card.stops.map")
    .replace(/stopLabel\?: 'Start Here' \| 'Then' \| 'End With' \| 'Explore' \| 'Optional';/g, "stopLabel_REMOVED?: 'Start Here' | 'Then' | 'End With' | 'Explore' | 'Optional';")
    .replace(/placeType\?: string;/g, "placeType_REMOVED?: string;")
    .replace(/aiDescription\?: string;/g, "aiDescription_REMOVED?: string;")
    .replace(/travelModeFromPreviousStop\?: string \| null;/g, "travelModeFromPreviousStop_REMOVED?: string | null;")
    .replace(/stopLabel: typeof s\.stopLabel === 'string' \? s\.stopLabel : undefined/g, "stopLabel_REMOVED: typeof s.stopLabel === 'string' ? s.stopLabel : undefined")
    .replace(/placeType: typeof s\.placeType === 'string' \? s\.placeType\.slice\(0, 80\) : undefined/g, "placeType_REMOVED: typeof s.placeType === 'string' ? s.placeType.slice(0, 80) : undefined")
    .replace(/aiDescription: typeof s\.aiDescription === 'string' \? s\.aiDescription\.slice\(0, 300\) : undefined/g, "aiDescription_REMOVED: typeof s.aiDescription === 'string' ? s.aiDescription.slice(0, 300) : undefined")
    .replace(/travelModeFromPreviousStop: typeof s\.travelModeFromPreviousStop === 'string' \? s\.travelModeFromPreviousStop : null/g, "travelModeFromPreviousStop_REMOVED: typeof s.travelModeFromPreviousStop === 'string' ? s.travelModeFromPreviousStop : null")
    .replace(/trimmed\.stops = trimmed\.stops\.map\(s => \(\{ \.\.\.s, aiDescription: undefined \}\)\);/g, "trimmed.stops_REMOVED = trimmed.stops.map(s => ({ ...s, aiDescription_REMOVED: undefined }));")
    .replace(/trimmed\.stops = trimmed\.stops\.map\(s => \(\{ \.\.\.s, placeType: undefined \}\)\);/g, "trimmed.stops_REMOVED = trimmed.stops.map(s => ({ ...s, placeType_REMOVED: undefined }));")
    .replace(/\(stop\.placeType \?\? 'place'\)\.replace/g, "stop.placeType.replace")
    .replace(/image: \(c\.stops as any\[\] \| undefined\)\?\.find/g, "image_REMOVED: (c.stops as any[] | undefined)?.find")
    .replace(/const cardType = \(raw\.cardType \?\? legacy\.cardType\) === 'curated'/g, "const cardType_REMOVED = (raw.cardType ?? legacy.cardType) === 'curated'")
    .replace(/card\.placeId \?\? \(card as any\)\.source\?\.placeId/g, "(card as any).source?.placeId")
    .replace(/haversineKm\(viewerLoc\.lat, viewerLoc\.lng, targetLat, targetLng\)/g, "haversineKm_REMOVED(viewerLoc.lat, viewerLoc.lng, targetLat, targetLng)")
    .replace(/const isIntentCard = cp\.cardType === 'curated'/g, "const isIntentCard_REMOVED = cp.cardType === 'curated'")
    .replace(/cardBubbleIntentChip/g, "cardBubbleIntentChip_REMOVED")
    .replace(/RAISE EXCEPTION 'ORCH-0910 backfill: messages precount % but UPDATE moved 0 rows'/g, "RAISE NOTICE 'ORCH-0910 messages revert'")
    .replace(/RAISE EXCEPTION 'ORCH-0910 backfill: board_saved_cards precount % but UPDATE moved 0 rows'/g, "RAISE NOTICE 'ORCH-0910 board revert'");
};

const files = {
  messaging: maybeRevert(read("app-mobile/src/services/messagingService.ts")),
  collab: maybeRevert(read("app-mobile/src/components/helpers/collabSaveCard.ts")),
  adapter: maybeRevert(read("app-mobile/src/services/cardPayloadAdapter.ts")),
  modal: maybeRevert(read("app-mobile/src/components/ExpandedCardModal.tsx")),
  bubble: maybeRevert(read("app-mobile/src/components/chat/MessageBubble.tsx")),
  timeline: maybeRevert(read("app-mobile/src/utils/curatedToTimeline.ts")),
  migration: maybeRevert(read("supabase/migrations/20260722000000_orch_0910_chat_intent_card_backfill.sql")),
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

function applyBackfill(rows, payloadKey) {
  let updated = 0;
  const nextRows = rows.map((row) => {
    const payload = row[payloadKey];
    const hasStops = Array.isArray(payload?.stops);
    const hasImage = typeof payload?.image === "string" && payload.image.length > 0;
    const hasCuratedType = payload?.cardType === "curated";
    if (!hasStops || (hasImage && hasCuratedType)) return row;
    updated += 1;
    const firstImage = payload.stops.find((stop) => typeof stop?.imageUrl === "string" && stop.imageUrl.length > 0)?.imageUrl;
    return {
      ...row,
      [payloadKey]: {
        ...payload,
        ...(hasImage ? {} : firstImage ? { image: firstImage } : {}),
        cardType: "curated",
      },
    };
  });
  return { rows: nextRows, updated };
}

const seededMessageBackfill = (() => {
  const seed = [
    { card_payload: { stops: [{ imageUrl: "https://img.example/one.jpg" }] } },
    { card_payload: { image: "", stops: [{ imageUrl: "" }, { imageUrl: "https://img.example/two.jpg" }] } },
    { card_payload: { image: "https://img.example/three.jpg", cardType: "curated", stops: [{ imageUrl: "https://img.example/three.jpg" }] } },
  ];
  const first = applyBackfill(seed, "card_payload");
  const second = applyBackfill(first.rows, "card_payload");
  return first.updated === 2 &&
    second.updated === 0 &&
    first.rows.every((row) => row.card_payload.image && row.card_payload.cardType === "curated");
})();

const seededBoardBackfill = (() => {
  const seed = [
    { card_data: { stops: [{ imageUrl: "https://img.example/one.jpg" }] } },
    { card_data: { image: "https://img.example/two.jpg", stops: [{ imageUrl: "https://img.example/two.jpg" }] } },
    { card_data: { image: "https://img.example/three.jpg", cardType: "curated", stops: [{ imageUrl: "https://img.example/three.jpg" }] } },
  ];
  const first = applyBackfill(seed, "card_data");
  const second = applyBackfill(first.rows, "card_data");
  return first.updated === 2 &&
    second.updated === 0 &&
    first.rows.every((row) => row.card_data.image && row.card_data.cardType === "curated");
})();

function makeWorstCaseCuratedCard() {
  const makeStop = (index) => ({
    stopNumber: index,
    stopLabel: "Start Here",
    placeName: "P".repeat(100),
    placeId: `place_${index}_${"x".repeat(64)}`,
    imageUrl: `https://img.example.com/${index}/${"x".repeat(150)}.jpg`,
    lat: 37.123456 + index / 100,
    lng: -122.123456 - index / 100,
    priceLevelLabel: "Very expensive dining level",
    priceTier: "expensive",
    rating: 4.9,
    estimatedDurationMinutes: 180,
    placeType: "restaurant_with_long_type_".repeat(4).slice(0, 80),
    aiDescription: "D".repeat(300),
    travelModeFromPreviousStop: "transit",
    address: "A".repeat(200),
    travelTimeFromPreviousStopMin: 45,
  });

  return {
    id: "card-curated-worst",
    title: "T".repeat(100),
    category: "curated",
    image: null,
    cardType: "curated",
    tagline: "G".repeat(300),
    totalPriceMin: 10,
    totalPriceMax: 500,
    estimatedDurationMinutes: 600,
    stops: Array.from({ length: 5 }, (_, index) => makeStop(index + 1)),
    matchFactors: { location: 1, budget: 1, category: 1, time: 1, popularity: 1 },
    socialStats: { views: 1, likes: 1, saves: 1, shares: 1 },
    tags: Array.from({ length: 10 }, () => "t".repeat(32)),
    openingHours: { weekday_text: Array.from({ length: 7 }, () => "Open 00:00-23:59") },
    highlights: Array.from({ length: 5 }, () => "h".repeat(80)),
    description: "d".repeat(500),
    images: Array.from({ length: 6 }, (_, index) => `https://img.example.com/gallery/${index}/${"x".repeat(120)}`),
    address: "a".repeat(200),
  };
}

function simulateWorstCaseTrim(card) {
  const trimmed = {
    id: card.id,
    title: card.title || "Saved experience",
    category: card.category ?? null,
    image: card.image ?? null,
    cardType: "curated",
    tagline: card.tagline,
    totalPriceMin: card.totalPriceMin,
    totalPriceMax: card.totalPriceMax,
    estimatedDurationMinutes: card.estimatedDurationMinutes,
    stops: card.stops.map((s, idx) => ({
      stopNumber: typeof s.stopNumber === "number" ? s.stopNumber : idx + 1,
      placeName: String(s.placeName ?? "").slice(0, 100),
      placeId: String(s.placeId ?? ""),
      imageUrl: typeof s.imageUrl === "string" && s.imageUrl.length > 0 ? s.imageUrl : null,
      lat: Number(s.lat) || 0,
      lng: Number(s.lng) || 0,
      priceLevelLabel: String(s.priceLevelLabel ?? "").slice(0, 32),
      priceTier: String(s.priceTier ?? ""),
      rating: Number(s.rating) || 0,
      estimatedDurationMinutes: Number(s.estimatedDurationMinutes) || 45,
      stopLabel: typeof s.stopLabel === "string" ? s.stopLabel : undefined,
      placeType: typeof s.placeType === "string" ? s.placeType.slice(0, 80) : undefined,
      aiDescription: typeof s.aiDescription === "string" ? s.aiDescription.slice(0, 300) : undefined,
      travelModeFromPreviousStop: typeof s.travelModeFromPreviousStop === "string" ? s.travelModeFromPreviousStop : null,
      address: typeof s.address === "string" ? s.address.slice(0, 200) : undefined,
      travelTimeFromPreviousStopMin: typeof s.travelTimeFromPreviousStopMin === "number" ? s.travelTimeFromPreviousStopMin : null,
    })),
    matchFactors: card.matchFactors,
    socialStats: card.socialStats,
    tags: card.tags,
    openingHours: card.openingHours,
    highlights: card.highlights,
    description: card.description,
    images: card.images,
    address: card.address,
  };

  const topLevelDropOrder = [
    "matchFactors",
    "socialStats",
    "tags",
    "openingHours",
    "highlights",
    "description",
    "images",
    "address",
    "tagline",
  ];
  let size = JSON.stringify(trimmed).length;
  for (const key of topLevelDropOrder) {
    if (size <= 5120) break;
    delete trimmed[key];
    size = JSON.stringify(trimmed).length;
  }
  const stopDropOrder = [
    "aiDescription",
    "placeType",
    "travelModeFromPreviousStop",
    "stopLabel",
    "address",
    "travelTimeFromPreviousStopMin",
  ];
  for (const key of stopDropOrder) {
    if (size <= 5120) break;
    trimmed.stops = trimmed.stops.map((s) => ({ ...s, [key]: undefined }));
    size = JSON.stringify(trimmed).length;
  }
  while (trimmed.stops.length > 1 && size > 5120) {
    trimmed.stops = trimmed.stops.slice(0, -1);
    size = JSON.stringify(trimmed).length;
  }
  return { payload: trimmed, size };
}

function appearsInOrder(source, fragments) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor + 1);
    if (next === -1) return false;
    cursor = next;
  }
  return true;
}

check(
  "T-01 [FAILS-ON-REVERT KEY] trimCardPayload curated happy path keeps image/cardType/stops",
  /firstStopImage = card\.stops\?\.find/.test(files.messaging) &&
    /if \(firstStopImage\) trimmed\.image = firstStopImage/.test(files.messaging) &&
    /trimmed\.cardType = 'curated'/.test(files.messaging) &&
    /trimmed\.stops = card\.stops\.map/.test(files.messaging) &&
    /placeName: String\(s\.placeName \?\? ''\)\.slice\(0, 100\)/.test(files.messaging) &&
    /estimatedDurationMinutes: Number\(s\.estimatedDurationMinutes\) \|\| 45/.test(files.messaging),
  "Reverting the curated trim branch must fail this check.",
);

check(
  "T-06 buildCardDataPayload curated synths top-level image/images from stops",
  /c\.cardType === 'curated'/.test(files.collab) &&
    /image: \(c\.stops as any\[\] \| undefined\)\?\.find/.test(files.collab) &&
    /images: \(c\.stops as any\[\] \| undefined\)[\s\S]+?\.filter\(\(url\): url is string/.test(files.collab) &&
    /\.slice\(0, 6\)/.test(files.collab),
  "Collab lock-in card_data must expose image/images before the RPC spreads it into chat.",
);

check(
  "T-07 adapter passes cardType + stops to ExpandedCardData",
  /const cardType = \(raw\.cardType \?\? legacy\.cardType\) === 'curated'/.test(files.adapter) &&
    /cardType,\s*\n\s*stops: raw\.stops \?\? legacy\.stops/.test(files.adapter) &&
    /tagline: raw\.tagline \?\? legacy\.tagline/.test(files.adapter) &&
    /estimatedDurationMinutes: raw\.estimatedDurationMinutes \?\? legacy\.estimatedDurationMinutes/.test(files.adapter),
  "Removing adapter pass-through would send chat-mounted intent cards back to the regular modal branch.",
);

check(
  "T-09 modal busyness fetch uses top-level placeId before source.placeId",
  /card\.placeId \?\? \(card as any\)\.source\?\.placeId/.test(files.modal) &&
    /busynessService\.getVenueBusyness\([\s\S]+?card\.title[\s\S]+?card\.placeId \?\? \(card as any\)\.source\?\.placeId/.test(files.modal),
  "Chat-mounted single cards carry placeId at top level; source.placeId-only lookup regresses busyness.",
);

check(
  "T-11 modal recomputes viewer-relative travel from GPS for chat-mounted cards",
  /useUserLocation\(user\?\.id, currentMode\)/.test(files.modal) &&
    /const isChatMounted = !!\(card as any\)\.lockInEvent \|\| \(!card\.travelTime && !card\.distance\)/.test(files.modal) &&
    /haversineKm\(viewerLoc\.lat, viewerLoc\.lng, targetLat, targetLng\)/.test(files.modal) &&
    /estimateTravelMinutes\(distKm, effectiveTravelMode\)/.test(files.modal) &&
    /setViewerTravelTime\(`\$\{minutes\} min`\)/.test(files.modal) &&
    /distance=\{viewerDistance != null \? `\$\{viewerDistance\} km` : card\.distance\}/.test(files.modal),
  "Travel-time must be computed per viewer at modal-open time, not carried in CardPayload.",
);

check(
  "T-14 MessageBubble renders intent layout with first-stop image and stops chip",
  /const isIntentCard = cp\.cardType === 'curated'/.test(files.bubble) &&
    /const intentHeroImage = isIntentCard \? \(\(cp as any\)\.stops\?\.\[0\]\?\.imageUrl \?\? cp\.image\) : cp\.image/.test(files.bubble) &&
    /const effectiveImage = isIntentCard \? intentHeroImage : cp\.image/.test(files.bubble) &&
    /styles\.cardBubbleIntentChip/.test(files.bubble) &&
    /\{`\$\{intentStopCount\} stops`\}/.test(files.bubble),
  "Intent bubbles must not collapse to a single-card bookmark placeholder.",
);

check(
  "T-16 SQL backfill covers messages.card_payload with row-count assert",
  /SELECT COUNT\(\*\) INTO v_msg_precount[\s\S]+?FROM public\.messages/.test(files.migration) &&
    /UPDATE public\.messages[\s\S]+?SET card_payload = jsonb_strip_nulls/.test(files.migration) &&
    /GET DIAGNOSTICS v_msg_updated = ROW_COUNT/.test(files.migration) &&
    /RAISE EXCEPTION 'ORCH-0910 backfill: messages precount % but UPDATE moved 0 rows'/.test(files.migration) &&
    /card_payload->>'cardType' IS DISTINCT FROM 'curated'/.test(files.migration) &&
    seededMessageBackfill,
  "messages.card_payload migration block must be idempotent and assert update row count.",
);

check(
  "T-17 SQL backfill covers board_saved_cards.card_data with row-count assert",
  /SELECT COUNT\(\*\) INTO v_bsc_precount[\s\S]+?FROM public\.board_saved_cards/.test(files.migration) &&
    /UPDATE public\.board_saved_cards[\s\S]+?SET card_data = jsonb_strip_nulls/.test(files.migration) &&
    /GET DIAGNOSTICS v_bsc_updated = ROW_COUNT/.test(files.migration) &&
    /RAISE EXCEPTION 'ORCH-0910 backfill: board_saved_cards precount % but UPDATE moved 0 rows'/.test(files.migration) &&
    /card_data->>'cardType' IS DISTINCT FROM 'curated'/.test(files.migration) &&
    seededBoardBackfill,
  "board_saved_cards.card_data migration block must be idempotent and assert update row count.",
);

check(
  "T-25 [FAILS-ON-REVERT KEY] TrimmedCuratedStop carries modal-read fields and timeline helper is null-safe",
  /stopLabel\?: 'Start Here' \| 'Then' \| 'End With' \| 'Explore' \| 'Optional';/.test(files.messaging) &&
    /placeType\?: string;/.test(files.messaging) &&
    /aiDescription\?: string;/.test(files.messaging) &&
    /travelModeFromPreviousStop\?: string \| null;/.test(files.messaging) &&
    /stopLabel: typeof s\.stopLabel === 'string' \? s\.stopLabel : undefined/.test(files.messaging) &&
    /placeType: typeof s\.placeType === 'string' \? s\.placeType\.slice\(0, 80\) : undefined/.test(files.messaging) &&
    /aiDescription: typeof s\.aiDescription === 'string' \? s\.aiDescription\.slice\(0, 300\) : undefined/.test(files.messaging) &&
    /travelModeFromPreviousStop: typeof s\.travelModeFromPreviousStop === 'string' \? s\.travelModeFromPreviousStop : null/.test(files.messaging) &&
    /stop\.stopLabel \?\? `Stop \$\{stepNumber\}`/.test(files.timeline) &&
    /\(stop\.placeType \?\? 'place'\)\.replace\(/.test(files.timeline) &&
    /address: stop\.address \?\? ''/.test(files.timeline) &&
    /address: nextStop\.address \?\? ''/.test(files.timeline),
  "Trimmed stops must carry every field read by the curated modal path, and future dropped fields must not crash curatedStopsToTimeline.",
);

const worstCaseTrim = simulateWorstCaseTrim(makeWorstCaseCuratedCard());
check(
  "T-26 worst-case 5-stop curated payload fits 5KB under amended stop drop order",
  appearsInOrder(files.messaging, [
    "aiDescription: undefined",
    "placeType: undefined",
    "travelModeFromPreviousStop: undefined",
    "stopLabel: undefined",
    "address: undefined",
    "travelTimeFromPreviousStopMin: undefined",
  ]) &&
    worstCaseTrim.size <= 5120 &&
    worstCaseTrim.payload.stops.length === 5 &&
    worstCaseTrim.payload.stops.every((stop) => stop.aiDescription === undefined && stop.placeType === undefined),
  `Worst-case trimmed size was ${worstCaseTrim.size}; expected <=5120 with all five stops preserved after dropping aiDescription then placeType before address.`,
);

console.log(`\n[ORCH-0910 regression check]${simulateRevert ? " simulated revert mode" : ""}`);
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
console.log("\nORCH-0910 regression check PASS — implementor happy path locked.");
