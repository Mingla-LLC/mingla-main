#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const deckService = read("app-mobile/src/services/deckService.ts");
const swipeableCards = read("app-mobile/src/components/SwipeableCards.tsx");
const recommendationsContext = read("app-mobile/src/contexts/RecommendationsContext.tsx");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const mapperBody =
  deckService.slice(
    deckService.indexOf("export function discoverCardsPayloadToRecommendations"),
    deckService.indexOf("class DeckService"),
  );

check(
  "T-01 curated envelope mapper exists",
  /export function discoverCardsPayloadToRecommendations\(data: any\): Recommendation\[\]/.test(deckService),
  "deckService must expose the response-envelope mapper used by both fetch paths.",
);

check(
  "T-02 envelope card_type='curated' preserves curated payload",
  /data\?\.card_type === 'curated'/.test(mapperBody) &&
    /cardType: 'curated'/.test(mapperBody) &&
    /return \{ \.\.\.card, cardType: 'curated' \} as unknown as Recommendation/.test(mapperBody),
  "A response with envelope card_type='curated' must return the original payload plus cardType, not unifiedCardToRecommendation(card).",
);

check(
  "T-03 curated shape preserves stops, tagline, and experienceType",
  /Array\.isArray\(card\?\.stops\)/.test(deckService) &&
    /typeof card\?\.experienceType === 'string'/.test(deckService) &&
    /typeof card\?\.tagline === 'string'/.test(deckService),
  "Curated payload detection must use the journey fields that CuratedExperienceSwipeCard consumes.",
);

check(
  "T-04 leaking curated envelope cannot corrupt single place rows",
  /function isSinglePlacePayload\(card: any\): boolean/.test(deckService) &&
    /isCuratedEnvelope && !isSinglePlacePayload\(card\)/.test(mapperBody),
  "A single-place card in a mixed/leaking envelope response must still flow through unifiedCardToRecommendation.",
);

const mapperCallCount = (deckService.match(/discoverCardsPayloadToRecommendations\(data\)/g) ?? []).length;
check(
  "T-05 solo and collab discover-cards paths both use envelope mapper",
  mapperCallCount === 2,
  `Expected exactly two discoverCardsPayloadToRecommendations(data) call sites, found ${mapperCallCount}.`,
);

check(
  "T-06 no direct response-card map through single mapper remains",
  !/data(?:\?\.)?\.cards[^;\n]+map\(unifiedCardToRecommendation\)/.test(deckService) &&
    !/\(data\.cards as any\[\]\)\.map\(unifiedCardToRecommendation\)/.test(deckService),
  "discover-cards responses must not map directly through unifiedCardToRecommendation because that strips curated fields.",
);

const effectiveStateBody =
  swipeableCards.slice(
    swipeableCards.indexOf("const effectiveUIState: DeckUIState = React.useMemo"),
    swipeableCards.indexOf("// ── Prefetch next 2 card images"),
  );

check(
  "T-07 collab transient empty renders loading, not exhausted",
  /if \(isBoardSession && !collabDeckDeadEndReason\)/.test(effectiveStateBody) &&
    /return \{ type: 'INITIAL_LOADING' \}/.test(effectiveStateBody) &&
    effectiveStateBody.indexOf("if (isBoardSession && !collabDeckDeadEndReason)") <
      effectiveStateBody.indexOf("return { type: 'EXHAUSTED' }"),
  "SwipeableCards must guard the local swipe-through branch before rendering EXHAUSTED.",
);

check(
  "T-08 context empty state requires explicit collab terminal signal",
  /const hasExplicitEmptyVerdict =/.test(recommendationsContext) &&
    /!isCollaborationMode \|\| soloServerPath === 'pool-empty' \|\| soloCuratedEmptyReason !== undefined/.test(recommendationsContext) &&
    /\(!isCollaborationMode && isDeckBatchLoaded && !deckHasMore\)/.test(recommendationsContext),
  "RecommendationsContext must not classify a collab transient zero-card query as EMPTY without a dead-end verdict.",
);

check(
  "T-09 collab dead-end clears the prior one-card recommendation",
  /isCollaborationMode && \(soloServerPath === 'pool-empty' \|\| soloCuratedEmptyReason !== undefined\)/.test(recommendationsContext),
  "When the server explicitly returns dead_end, context must clear the prior card so the terminal UI can render truthfully.",
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
