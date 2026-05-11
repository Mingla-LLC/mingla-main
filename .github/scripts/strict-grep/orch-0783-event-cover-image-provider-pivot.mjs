#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const read = (path) => readFileSync(join(root, path), "utf8");
const fail = (message) => {
  console.error(`[orch-0783] ${message}`);
  process.exit(1);
};

const requiredFiles = [
  "mingla-business/src/components/event/CreatorStep4Cover.tsx",
  "mingla-business/src/services/giphyEventCoverService.ts",
  "mingla-business/src/services/__tests__/giphyEventCoverService.test.ts",
  "mingla-business/src/services/pexelsEventCoverService.ts",
  "mingla-business/src/services/__tests__/pexelsEventCoverService.test.ts",
  "mingla-business/src/types/eventCoverProvider.ts",
  "supabase/functions/event-cover-pexels-search/index.ts",
  "supabase/migrations/20260515000018_orch_0783_event_cover_provider_metadata.sql",
];

for (const path of requiredFiles) {
  if (!existsSync(join(root, path))) fail(`missing required file: ${path}`);
}

const step4 = read("mingla-business/src/components/event/CreatorStep4Cover.tsx");
const giphy = read("mingla-business/src/services/giphyEventCoverService.ts");
const pexelsClient = read("mingla-business/src/services/pexelsEventCoverService.ts");
const pexelsEdge = read("supabase/functions/event-cover-pexels-search/index.ts");
const migration = read("supabase/migrations/20260515000018_orch_0783_event_cover_provider_metadata.sql");
const eventCoverMedia = read("mingla-business/src/components/ui/EventCoverMedia.tsx");
const publicPage = read("mingla-business/src/components/event/PublicEventPage.tsx");

const forbiddenStep4 = [
  "pickVideoCover",
  "createEventCoverVideoUploadIntent",
  "validateNativeTrimmedEventCoverVideo",
  "Check again",
  "Replace video",
  "Cancel processing",
  "Cover style",
  "HUE_TILES",
];

for (const token of forbiddenStep4) {
  if (step4.includes(token)) {
    fail(`CreatorStep4Cover must not expose active video/hue cover creation token: ${token}`);
  }
}

if (!step4.includes("searchGiphyEventCovers") || !step4.includes("searchPexelsEventCovers")) {
  fail("CreatorStep4Cover must expose GIPHY and Pexels provider search.");
}
if (!step4.includes("coverMediaProvider") || !step4.includes("coverMediaCredit")) {
  fail("CreatorStep4Cover must persist provider metadata with cover selections.");
}
if (!giphy.includes("https://api.giphy.com/v1/gifs/search")) {
  fail("GIPHY adapter must use direct client GIF search.");
}
if (giphy.includes("supabase.functions.invoke") || giphy.includes("PEXELS_API_KEY")) {
  fail("GIPHY must not be proxied through Supabase or share Pexels secret handling.");
}
if (!pexelsClient.includes("event-cover-pexels-search")) {
  fail("Pexels client must call the authenticated Edge proxy.");
}
if (pexelsClient.includes("PEXELS_API_KEY")) {
  fail("Pexels API key must not be read client-side.");
}
if (!pexelsEdge.includes("PEXELS_API_KEY") || !pexelsEdge.includes("orientation")) {
  fail("Pexels Edge function must hold the provider key and request landscape orientation.");
}
if (!migration.includes("cover_media_provider") || !migration.includes("business_publish_event_draft")) {
  fail("migration must add provider metadata and publish RPC persistence.");
}
if (!migration.includes("events_cover_media_provider_check")) {
  fail("migration must constrain provider values.");
}
if (!eventCoverMedia.includes("EventCoverVideo") || !eventCoverMedia.includes("mediaType === \"video\"")) {
  fail("EventCoverMedia must preserve legacy video rendering support.");
}
if (!publicPage.includes("isLegacyUnsafeEventCoverVideoUrl")) {
  fail("public event page must preserve legacy unsafe video fallback.");
}
if (!publicPage.includes("eventCoverProviderCreditLabel")) {
  fail("public event page must render provider attribution.");
}

console.log("[orch-0783] event cover image provider pivot guard passed");
