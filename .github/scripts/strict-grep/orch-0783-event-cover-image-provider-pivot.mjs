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
  // ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity]
  // SPEC v2 Q3: extract shared `<CoverPicker>` consumed by 3 sites (event
  // Step4 wrapper, trip Step1Basics, EditPublishedTripScreen). The provider
  // search + provider-metadata tokens now live in CoverPicker.tsx; event
  // Step4 is a thin wrapper that forwards via the picker.
  "mingla-business/src/components/ui/CoverPicker.tsx",
  // ORCH-0989 — unified Sheet host + the browse service for gallery-first tabs.
  "mingla-business/src/components/ui/CoverPickerSheet.tsx",
  "mingla-business/src/services/coverProviderBrowseService.ts",
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
const coverPicker = read("mingla-business/src/components/ui/CoverPicker.tsx");
// ORCH-0989: the picker UI moved out of CreatorStep4Cover (now a button +
// preview) into the shared CoverPickerSheet. The provider tokens live in
// CoverPicker (the sheet's body) + coverProviderBrowseService. Concatenate
// the sheet too so the composite substring checks find the tokens wherever
// they land.
const coverPickerSheet = read("mingla-business/src/components/ui/CoverPickerSheet.tsx");
const browseService = read("mingla-business/src/services/coverProviderBrowseService.ts");
// ORCH-0876: the event-side cover provider invariant is now satisfied when
// EITHER CreatorStep4Cover OR the shared CoverPicker/CoverPickerSheet it
// composes carries the tokens. Combined source for the substring checks below.
const eventCoverComposite = step4 + "\n" + coverPicker + "\n" + coverPickerSheet;
const giphy = read("mingla-business/src/services/giphyEventCoverService.ts");
const pexelsClient = read("mingla-business/src/services/pexelsEventCoverService.ts");
const pexelsEdge = read("supabase/functions/event-cover-pexels-search/index.ts");
const migration = read("supabase/migrations/20260515000018_orch_0783_event_cover_provider_metadata.sql");
// ORCH-0964 — EventCoverMedia moved into the shared @mingla/event-rendering
// package (mingla-business path is now a re-export shim). Read the shared
// implementation so the legacy-video-support assertion reflects reality.
const eventCoverMedia = read("packages/event-rendering/EventCoverMedia.tsx");
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

if (!eventCoverComposite.includes("searchGiphyEventCovers") || !eventCoverComposite.includes("searchPexelsEventCovers")) {
  fail("CreatorStep4Cover (or its shared CoverPicker) must expose GIPHY and Pexels provider search.");
}
if (!eventCoverComposite.includes("coverMediaProvider") || !eventCoverComposite.includes("coverMediaCredit")) {
  fail("CreatorStep4Cover (or its shared CoverPicker) must persist provider metadata with cover selections.");
}
if (!giphy.includes("https://api.giphy.com/v1/gifs/search")) {
  fail("GIPHY adapter must use direct client GIF search.");
}
if (giphy.includes("supabase.functions.invoke") || giphy.includes("PEXELS_API_KEY")) {
  fail("GIPHY must not be proxied through Supabase or share Pexels secret handling.");
}
// ORCH-0989 gallery-first: the browse service must expose trending/curated and
// keep the GIPHY/Pexels transport asymmetry (GIPHY client-direct, Pexels edge).
if (
  !browseService.includes("trendingGiphyCovers") ||
  !browseService.includes("curatedPexelsCovers")
) {
  fail("coverProviderBrowseService must export trendingGiphyCovers + curatedPexelsCovers.");
}
if (!browseService.includes("https://api.giphy.com/v1/gifs/trending")) {
  fail("coverProviderBrowseService GIPHY trending must call the direct client endpoint.");
}
if (!browseService.includes("event-cover-pexels-curated")) {
  fail("coverProviderBrowseService Pexels curated must call the authenticated Edge proxy.");
}
if (browseService.includes("PEXELS_API_KEY")) {
  fail("Pexels API key must not be read client-side in coverProviderBrowseService.");
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
