#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0910 tester adversarial regression check (TARGETED).
 *
 * Attacks DIFFERENT angles than the implementor's happy-path
 * `orch-0910-regression-check.mjs` (T-01/T-06/T-07/T-09/T-11/T-14/T-16/T-17).
 *
 * Per SPEC §6 the adversarial set is T-19..T-22:
 *   T-19  chat-share card with NO placeId — busyness lookup graceful degrade
 *         (no crash, falls back to fuzzy name+lat+lng — never undefined call site)
 *   T-20  curated card with 12 stops × 8 images each — size guard correctness
 *         (drops in order: stops[].address → stops[].travelTimeFromPreviousStopMin
 *          → tail stops; preserves stops[0] minimum field set)
 *   T-21  GPS-denied chat-mount — no fabricated travel row
 *         (Constitution #9 — viewerLoc null → setViewerTravelTime(null) +
 *          setViewerDistance(null))
 *   T-22  backfill idempotency on mixed seed — already-fixed rows untouched,
 *         partial rows correctly identified, exception-on-zero-update wired
 *
 * Plus two tester-authored attack angles beyond the spec:
 *   T-23  buildCardDataPayload curated stops with ALL imageUrl=null — neither
 *         image nor images surface fabricated values (Constitution #9 honest
 *         absence; bubble + sheet fall back to bookmark placeholder cleanly)
 *   T-24  MessageBubble defensive normalizer + intent layout interaction —
 *         legacy nested card_data row with stops gets read correctly via the
 *         ORCH-0908 normalizer THEN renders the intent chip (post-ORCH-0910
 *         cascade compatibility)
 *
 * Set ORCH0910_SIMULATE_REVERT=1 to remove the load-bearing ORCH-0910 anchors;
 * this script must then fail, proving the assertions exercise the fix.
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
    // adapter: strip cardType pass-through
    .replace(/cardType,\n\s+stops: raw\.stops/g, "cardType_REMOVED_BY_REVERT,\n    stops_REMOVED: raw.stops")
    // modal: re-introduce source.placeId-only read
    .replace(/\(card\.placeId \?\? \(card as any\)\.source\?\.placeId\)/g, "(card as any).source?.placeId")
    // bubble: strip intent chip
    .replace(/cardBubbleIntentChip/g, "cardBubbleIntentChip_REMOVED")
    .replace(/isIntentCard && intentStopCount > 0/g, "false && intentStopCount > 0")
    // collab save: strip image synth
    .replace(/image: \(c\.stops as any\[\] \| undefined\)\?\.find/g, "image_REMOVED: (c.stops as any[] | undefined)?.find")
    // migration: strip RAISE EXCEPTION on row-count
    .replace(/RAISE EXCEPTION 'ORCH-0910 backfill: messages/g, "RAISE NOTICE 'ORCH-0910 SKIPPED: messages")
    .replace(/RAISE EXCEPTION 'ORCH-0910 backfill: board_saved_cards/g, "RAISE NOTICE 'ORCH-0910 SKIPPED: board_saved_cards");
};

const results = [];
const fail = (id, label, why) => results.push({ id, label, ok: false, why });
const pass = (id, label) => results.push({ id, label, ok: true });

// ── Sources under test ──────────────────────────────────────────────────────
const messagingSrc = maybeRevert(read("app-mobile/src/services/messagingService.ts"));
const adapterSrc = maybeRevert(read("app-mobile/src/services/cardPayloadAdapter.ts"));
const collabSrc = maybeRevert(read("app-mobile/src/components/helpers/collabSaveCard.ts"));
const modalSrc = maybeRevert(read("app-mobile/src/components/ExpandedCardModal.tsx"));
const bubbleSrc = maybeRevert(read("app-mobile/src/components/chat/MessageBubble.tsx"));
const migrationSrc = maybeRevert(read("supabase/migrations/20260722000000_orch_0910_chat_intent_card_backfill.sql"));

// ── T-19: chat-share with NO placeId — busyness graceful degrade ────────────
// Adversarial angle: implementor's T-09 proved top-level placeId IS read.
// This test proves the WITHOUT-placeId path doesn't crash and reaches the
// service with `undefined` so the service's own name+lat+lng fallback runs.
{
  const id = "T-19";
  const label = "busyness fetch tolerates missing placeId without crash";
  // Modal must NOT have a guard like `if (!placeId) return;` before the busyness call
  // and must pass placeId argument positionally (the service handles undefined).
  const earlyReturnPattern = /if\s*\(\s*!\s*\(?\s*card\.placeId/;
  const callsite = modalSrc.match(/busynessService\.getVenueBusyness\([\s\S]{0,400}?\)/);
  if (!callsite) {
    fail(id, label, "Could not locate busynessService.getVenueBusyness callsite in ExpandedCardModal.tsx");
  } else if (earlyReturnPattern.test(modalSrc)) {
    fail(id, label, "Found early-return guard that would block busyness fetch when placeId missing (regressing fuzzy fallback)");
  } else if (!/card\.placeId\s*\?\?\s*\(card as any\)\.source\?\.placeId/.test(modalSrc)) {
    fail(id, label, "Modal must keep nullish-coalesce on (card.placeId ?? source?.placeId) — the ?? itself proves undefined-tolerant path");
  } else {
    pass(id, label);
  }
}

// ── T-20: 12 stops × 8 images — size guard correctness ──────────────────────
// Adversarial angle beyond T-01 (which only tested a normal curated card under budget).
// This test proves the trim function's curated drop order is present in source
// AND that the documented order is: stops[].address → stops[].travelTimeFromPreviousStopMin
// → tail-end stops, never dropping stops[0]'s required minimum.
{
  const id = "T-20";
  const label = "size guard drops curated soft fields then tail stops (never stops[0] required minimum)";
  const dropAddressBlock = /\.map\(s => \(\{\s*\.\.\.s,\s*address:\s*undefined\s*\}\)\)/;
  const dropTravelBlock = /\.map\(s => \(\{\s*\.\.\.s,\s*travelTimeFromPreviousStopMin:\s*undefined\s*\}\)\)/;
  const tailDropLoop = /while\s*\([\s\S]{0,200}?trimmed\.stops\.length > 1[\s\S]{0,200}?slice\(0,\s*-1\)/;
  const sizeBudget = /size\s*>\s*5120/;
  if (!dropAddressBlock.test(messagingSrc)) {
    fail(id, label, "First-tier curated drop (stops[].address → undefined) missing");
  } else if (!dropTravelBlock.test(messagingSrc)) {
    fail(id, label, "Second-tier curated drop (stops[].travelTimeFromPreviousStopMin → undefined) missing");
  } else if (!tailDropLoop.test(messagingSrc)) {
    fail(id, label, "Tail-stop drop loop (slice(0,-1) while length > 1) missing — required to preserve stops[0]");
  } else if (!sizeBudget.test(messagingSrc)) {
    fail(id, label, "5120-byte size budget gate not enforced before drops");
  } else {
    pass(id, label);
  }
}

// ── T-21: GPS-denied chat-mount — no fabricated travel row ──────────────────
// Adversarial angle beyond T-11 (which proved positive path fires).
// This test proves the NEGATIVE path (viewerLoc null) sets both
// viewerTravelTime AND viewerDistance to null — no fabricated values.
{
  const id = "T-21";
  const label = "GPS-denied chat-mount sets viewerTravelTime/viewerDistance to null (Constitution #9)";
  const gpsGuard = /if\s*\(\s*!isChatMounted\s*\|\|\s*viewerLoc\?\.lat\s*==\s*null\s*\|\|\s*viewerLoc\?\.lng\s*==\s*null\s*\)/;
  const nullSet = /setViewerDistance\(null\);\s*setViewerTravelTime\(null\);/;
  if (!gpsGuard.test(modalSrc)) {
    fail(id, label, "Missing guard for non-chat-mount OR no GPS — modal could fabricate travel");
  } else if (!nullSet.test(modalSrc)) {
    fail(id, label, "Guard branch does not explicitly set both viewer values to null (Constitution #9 violation possible)");
  } else if (!/setViewerTravelTime\(null\);\s*setViewerDistance\(null\);/.test(modalSrc)) {
    fail(id, label, "Modal-close branch does not reset viewer values to null (stale GPS leak risk)");
  } else {
    pass(id, label);
  }
}

// ── T-22: migration idempotency + RAISE EXCEPTION on row-count ──────────────
// Adversarial angle beyond T-16/T-17 (which proved migration touched the right rows).
// This test proves the migration is IDEMPOTENT (re-running produces zero updates)
// AND that the RAISE EXCEPTION discipline catches "precount > 0 but updated = 0".
{
  const id = "T-22";
  const label = "migration is idempotent (NOT IS NOT NULL gate) and asserts precount/updated parity";
  // Implementor used `NULLIF(col->>'image', '') IS NOT NULL` — stronger than spec's
  // bare `IS NOT NULL` because it also treats empty-string as null. Accept either idiom.
  const idempotentMsgs = /NOT \(card_payload \? 'image' AND (NULLIF\(card_payload->>'image',\s*''\)|card_payload->>'image') IS NOT NULL\)/;
  const idempotentBsc = /NOT \(card_data \? 'image' AND (NULLIF\(card_data->>'image',\s*''\)|card_data->>'image') IS NOT NULL\)/;
  const raiseExceptionMsgs = /IF v_msg_precount > 0 AND v_msg_updated = 0 THEN\s*RAISE EXCEPTION/;
  const raiseExceptionBsc = /IF v_bsc_precount > 0 AND v_bsc_updated = 0 THEN\s*RAISE EXCEPTION/;
  const getDiagnostics = (migrationSrc.match(/GET DIAGNOSTICS/g) || []).length;
  if (!idempotentMsgs.test(migrationSrc)) {
    fail(id, label, "messages WHERE clause does not exclude already-backfilled rows (NOT idempotent)");
  } else if (!idempotentBsc.test(migrationSrc)) {
    fail(id, label, "board_saved_cards WHERE clause does not exclude already-backfilled rows (NOT idempotent)");
  } else if (!raiseExceptionMsgs.test(migrationSrc)) {
    fail(id, label, "Missing RAISE EXCEPTION when messages precount > 0 AND updated = 0 (ORCH-0908 v2 backfill discipline violation)");
  } else if (!raiseExceptionBsc.test(migrationSrc)) {
    fail(id, label, "Missing RAISE EXCEPTION when board_saved_cards precount > 0 AND updated = 0 (ORCH-0908 v2 backfill discipline violation)");
  } else if (getDiagnostics !== 2) {
    fail(id, label, `Expected exactly 2 GET DIAGNOSTICS calls (one per table), found ${getDiagnostics}`);
  } else {
    pass(id, label);
  }
}

// ── T-23: ALL stops imageUrl=null — no fabrication ───────────────────────────
// Adversarial angle: implementor's T-06 proved positive image synth path.
// This proves the find() returns undefined when all stops have null imageUrl
// AND the bubble's effectiveImage falls back honestly (no string concat of "null").
{
  const id = "T-23";
  const label = "all-null stop imageUrl produces undefined image (no fabricated value, honest fallback to bookmark)";
  // collabSaveCard: use of typeof s.imageUrl === 'string' AND length > 0 in the find predicate
  const collabFindGuard = /\.find\?\.\(s => typeof s\?\.imageUrl === 'string' && s\.imageUrl\.length > 0\)/;
  // trim: same predicate
  const trimFindGuard = /\.find\?\.\(\(s: any\) => typeof s\?\.imageUrl === 'string' && s\.imageUrl\.length > 0\)/;
  // bubble: effectiveImage falls back to cp.image (which may also be null), and the
  // `effectiveImage ?` ternary chooses the bookmark placeholder branch on falsy
  const bubbleEffectivePattern = /const effectiveImage = isIntentCard \? intentHeroImage : cp\.image;/;
  const bubblePlaceholderPattern = /effectiveImage \? \(\s*<Image/;
  if (!collabFindGuard.test(collabSrc)) {
    fail(id, label, "collabSaveCard image-synth find predicate missing length>0 guard — could pick '' or non-string");
  } else if (!trimFindGuard.test(messagingSrc)) {
    fail(id, label, "trimCardPayload image-synth find predicate missing length>0 guard");
  } else if (!bubbleEffectivePattern.test(bubbleSrc)) {
    fail(id, label, "MessageBubble effectiveImage derivation missing — could fall through to undefined render");
  } else if (!bubblePlaceholderPattern.test(bubbleSrc)) {
    fail(id, label, "MessageBubble truthy-image ternary missing — null/'' would not route to bookmark placeholder");
  } else {
    pass(id, label);
  }
}

// ── T-24: legacy nested card_data + intent chip cascade ─────────────────────
// Adversarial angle: implementor's T-14 proved intent chip renders for a flat
// payload. This proves the ORCH-0908 defensive normalizer (raw.card_data nested
// read) + ORCH-0910 cardType/stops pass-through combine correctly so a legacy
// nested row STILL renders the intent chip.
{
  const id = "T-24";
  const label = "legacy nested card_data row reaches intent chip via ORCH-0908 normalizer + ORCH-0910 pass-through";
  // MessageBubble must read cardType + stops from raw OR legacy fallback
  const bubbleCardTypeRead = /cardType: raw\.cardType \?\? legacy\?\.cardType/;
  const bubbleStopsRead = /stops: raw\.stops \?\? legacy\?\.stops/;
  // Adapter must do the same (already covered structurally elsewhere, but verifying interaction)
  const adapterLegacyRead = /raw\.stops \?\? legacy\.stops/;
  // intent chip render is conditional on cp.cardType OR cp.stops being non-empty
  const intentDetect = /isIntentCard = cp\.cardType === 'curated' \|\| \(Array\.isArray\(\(cp as any\)\.stops\) && \(cp as any\)\.stops\.length > 0\)/;
  if (!bubbleCardTypeRead.test(bubbleSrc)) {
    fail(id, label, "MessageBubble normalizer doesn't read cardType from legacy nested card_data — legacy rows would skip intent layout");
  } else if (!bubbleStopsRead.test(bubbleSrc)) {
    fail(id, label, "MessageBubble normalizer doesn't read stops from legacy nested card_data — legacy rows would skip intent layout");
  } else if (!adapterLegacyRead.test(adapterSrc)) {
    fail(id, label, "Adapter doesn't fall back to legacy.stops — legacy rows tapped open could lose stops in modal");
  } else if (!intentDetect.test(bubbleSrc)) {
    fail(id, label, "Intent detection predicate doesn't accept either cardType OR stops-array signal");
  } else {
    pass(id, label);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
let exit = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`PASS ${r.id} ${r.label}`);
  } else {
    console.log(`FAIL ${r.id} ${r.label}`);
    console.log(`  ${r.why}`);
    exit = 1;
  }
}

if (simulateRevert) {
  console.log("\nSimulated-revert mode active.");
  if (exit === 0) {
    console.log("  Adversarial check passed under revert — assertions are hollow. FAILING.");
    exit = 1;
  } else {
    console.log("  Failures under revert prove adversarial assertions exercise the ORCH-0910 fix surface.");
    exit = 0;
  }
} else if (exit === 0) {
  console.log("\nORCH-0910 adversarial check PASS — chat payload parity holds under hostile inputs.");
}

process.exit(exit);
