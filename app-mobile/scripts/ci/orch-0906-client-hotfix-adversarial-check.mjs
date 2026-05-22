#!/usr/bin/env node
// ORCH-0906 [Collab deck single↔intent 1:1 alternation] CLIENT HOTFIX —
// tester-authored adversarial regression check.
//
// Attacks angles ORCH-0840 [Regression-test enforcement + append-only CI] gate
// criterion (b): MUST attack a DIFFERENT angle than the implementor's
// happy-path test at orch-0906-client-hotfix-regression-check.mjs.
//
// Implementor's tests are source-string-shape assertions on the new mapper.
// This adversarial attacks:
//
//  A-01: The single-place guard accepts EACH disjunctive signal independently
//        (lat OR lng OR placeId OR image). Implementor's T-04 only proves one
//        signal works (lat). If a future refactor weakened the OR to AND, the
//        guard would silently fail to protect single cards on a leaking
//        envelope and T-04 would still pass — but A-01 will fail.
//
//  A-02: The curated detection accepts EITHER the explicit `cardType: 'curated'`
//        label OR the structural fallback (stops + experienceType + tagline).
//        Loss of either disjunct would silently downgrade curated cards into
//        single rendering, surviving the implementor's tests because T-02 only
//        exercises the envelope-flag path.
//
//  A-03: SwipeableCards effectiveUIState's INITIAL_LOADING guard is keyed on
//        BOTH `isBoardSession` AND `!collabDeckDeadEndReason`. The implementor's
//        T-07 doesn't prove the second leg — a refactor that dropped the
//        dead-end check would still pass T-07 but would deadlock collab in
//        permanent loading after server-confirmed exhaustion.
//
//  A-04: RecommendationsContext's `hasExplicitEmptyVerdict` (line ~1581) must
//        be in the `deckEmpty` boolean clause. The implementor's T-08 reads
//        the SET path (line ~896); A-04 reads the deckEmpty/error path so a
//        partial revert that fixes set-isExhausted but drops the deckEmpty
//        guard still flickers `error="no_matches"` text in collab.
//
//  A-05: The empty-state condition in deckUIState (line ~1763) must require
//        `!isCollaborationMode` for the `(isDeckBatchLoaded && !deckHasMore)`
//        branch. Without that guard, collab without explicit terminal still
//        emits EMPTY ui-state and flashes exhausted UI during fetch.
//
// File-by-line evidence is read from the working tree so the test fails
// fast if the hotfix has been backed out or rotted.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");

const read = (rel) => fs.readFileSync(path.resolve(root, rel), "utf8");

let failed = 0;
let total = 0;
const fail = (name, msg) => {
  failed += 1;
  console.log(`FAIL ${name}`);
  console.log(`  ${msg}`);
};
const pass = (name) => console.log(`PASS ${name}`);
const expect = (cond, name, msg) => {
  total += 1;
  if (cond) pass(name);
  else fail(name, msg);
};

const deck = read("src/services/deckService.ts");
const sw = read("src/components/SwipeableCards.tsx");
const ctx = read("src/contexts/RecommendationsContext.tsx");

// ── A-01: single-place guard accepts each disjunctive signal ─────────────
const singleGuardBody =
  deck.match(/function isSinglePlacePayload\(card: any\): boolean \{[\s\S]*?\n\}/)?.[0] ?? "";

expect(
  singleGuardBody.includes("typeof card?.lat === 'number'"),
  "A-01a lat signal admits single",
  "isSinglePlacePayload must accept card.lat as a single-place signal.",
);
expect(
  singleGuardBody.includes("typeof card?.lng === 'number'"),
  "A-01b lng signal admits single",
  "isSinglePlacePayload must accept card.lng as a single-place signal.",
);
expect(
  singleGuardBody.includes("typeof card?.placeId === 'string'"),
  "A-01c placeId signal admits single",
  "isSinglePlacePayload must accept card.placeId as a single-place signal.",
);
expect(
  singleGuardBody.includes("typeof card?.image === 'string'"),
  "A-01d image signal admits single",
  "isSinglePlacePayload must accept card.image as a single-place signal.",
);
expect(
  (singleGuardBody.match(/\|\|/g) ?? []).length >= 3,
  "A-01e signals are OR-disjunctive (not AND)",
  "isSinglePlacePayload must compose signals with || not &&; tightening to AND lets corrupt envelopes mark singles as curated.",
);

// ── A-02: curated detection has BOTH explicit-label and structural paths ──
const curatedGuardBody =
  deck.match(/function isCuratedPayload\(card: any\): boolean \{[\s\S]*?\n\}/)?.[0] ?? "";

expect(
  curatedGuardBody.includes("card?.cardType === 'curated'"),
  "A-02a explicit cardType label admits curated",
  "isCuratedPayload must accept explicit `cardType: 'curated'` from server.",
);
expect(
  curatedGuardBody.includes("Array.isArray(card?.stops)") &&
    curatedGuardBody.includes("typeof card?.experienceType === 'string'") &&
    curatedGuardBody.includes("typeof card?.tagline === 'string'"),
  "A-02b structural fallback admits curated",
  "isCuratedPayload must accept stops[] + experienceType + tagline as structural fallback when explicit label is absent.",
);
expect(
  curatedGuardBody.includes("||"),
  "A-02c label OR structural (disjunctive)",
  "isCuratedPayload must compose label and structural detection with ||, not require both.",
);

// ── A-03: SwipeableCards INITIAL_LOADING guard checks BOTH legs ─────────
const swGuardBlock = sw.match(
  /effectiveUIState[\s\S]*?if \(deckUIState\.type === 'LOADED' && availableRecommendations\.length === 0\) \{[\s\S]*?return \{ type: 'EXHAUSTED' \};[\s\S]*?\}/,
)?.[0] ?? "";

expect(
  swGuardBlock.includes("isBoardSession") && swGuardBlock.includes("!collabDeckDeadEndReason"),
  "A-03 SwipeableCards INITIAL_LOADING guard requires both isBoardSession AND !collabDeckDeadEndReason",
  "Effective UI state must check both legs; dropping the dead-end leg deadlocks collab in INITIAL_LOADING after server-confirmed exhaustion.",
);
expect(
  swGuardBlock.indexOf("return { type: 'INITIAL_LOADING' };") <
    swGuardBlock.indexOf("return { type: 'EXHAUSTED' };"),
  "A-03b INITIAL_LOADING branch precedes EXHAUSTED branch",
  "INITIAL_LOADING short-circuit must be evaluated BEFORE EXHAUSTED to win the race against the swipe-through fall-through.",
);

// ── A-04: deckEmpty in RecommendationsContext requires hasExplicitEmptyVerdict ─
const deckEmptyLine = ctx.match(/const deckEmpty =[^;]*;/s)?.[0] ?? "";
expect(
  deckEmptyLine.includes("hasExplicitEmptyVerdict"),
  "A-04 deckEmpty guard requires explicit empty verdict in collab",
  "deckEmpty must AND with hasExplicitEmptyVerdict; otherwise error=\"no_matches\" leaks during in-flight collab fetches.",
);

// ── A-05: deckUIState EMPTY branch protects collab path ─────────────────
const emptyBranchBlock = ctx.match(
  /recommendations\.length === 0 &&[\s\S]*?return \{ type: 'EMPTY' \};/,
)?.[0] ?? "";
expect(
  emptyBranchBlock.includes("!isCollaborationMode && isDeckBatchLoaded && !deckHasMore"),
  "A-05 EMPTY branch gates the batchLoaded-no-more leg with !isCollaborationMode",
  "In collab mode, `isDeckBatchLoaded && !deckHasMore` is a normal one-card-at-a-time response, not an EMPTY state.",
);

if (failed > 0) {
  console.log(`\nORCH-0906 client hotfix adversarial: ${failed}/${total} FAIL`);
  process.exit(1);
}
console.log(`\nORCH-0906 client hotfix adversarial: ${total}/${total} PASS`);
