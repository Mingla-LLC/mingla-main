// Issue #3697 — the Admin Creative Library and Builder video step: no dead
// end, the console flag, the menu's delete reasons, and no infrastructure copy.
// Invariant I-CREATIVE-ARCHIVE-NOT-DELETE (declared in supabase/migrations/__tests__/issue_3697_creative_library_lifecycle.implementor.pg17.test.sql)
// Invariant I-VIDEO-ONE-UPLOADER (declared in packages/video-upload/__tests__/videoUpload.test.mjs)
//
// FAILS ON REVERT: bring back the "shared resumable media flow" dead-end copy,
// stop reading enable_ads_console for the tab, change a delete reason, or
// call the retired video validate-by-URL path from the Builder.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canManageLifecycle,
  dragSummary,
  fitReason,
  purgeBlockedReason,
  refusalTitle,
  sourceLine,
  usageLine,
} from "../../components/ad-engine/creativeLibraryModel.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../AdEnginePage.jsx");
const step = read("../../components/campaign-builder/StepCreative.jsx");
const service = read("../../services/adEngineService.js");

test("#3697 the library and the Builder no longer send the operator in a circle", () => {
  for (const source of [page, step]) {
    assert.doesNotMatch(source, /shared resumable media flow/);
    assert.doesNotMatch(source, /Storage IDs, master URLs/);
    assert.doesNotMatch(source, /One canonical video, safely reused/);
  }
  assert.match(page, /<Button variant="brandContrast" icon=\{Upload\} onClick=\{\(\) => openPicker\(\)\}>\s*Upload media/);
  assert.match(page, /No media yet/);
  assert.match(page, /Nothing archived\. Archived media stays here and never affects running ads\./);
  assert.match(step, /Upload a new video, or drop it here/);
  assert.match(step, /Saved to the library too/);
});

test("#3697 the Creative Library tab follows enable_ads_console", () => {
  assert.match(page, /setAdsConsoleEnabled\(flags\.enable_ads_console !== false\)/);
  assert.match(page, /adsConsoleEnabled \|\| tab\.id !== "creative-library"/);
  assert.match(page, /<Tabs tabs=\{visibleTabs\}/);
  assert.match(page, /shownTab === "creative-library" && <CreativeLibraryPanel \/>/);
});

test("#3697 delete reasons follow the design's first-match order", () => {
  const creative = { usage: { campaign_count: 2, active_campaign_count: 1 } };
  assert.equal(purgeBlockedReason(["campaign", "plan_version", "platform_ref"], creative), "Can't delete: used by 2 campaigns (1 running). Archive it instead.");
  assert.equal(purgeBlockedReason(["platform_ref", "status_event"], creative), "An ad platform still holds a copy.");
  assert.equal(purgeBlockedReason(["duplicate_creative"], creative), "Another library item uses the same file.");
  assert.equal(purgeBlockedReason(["live_surface"], creative), "Still the cover on an event or brand.");
  assert.equal(purgeBlockedReason(["legal_hold"], creative), "Under legal hold.");
  assert.equal(purgeBlockedReason([], creative), null);
});

test("#3697 the menu calls the guarded server actions, never a delete of the row", () => {
  assert.match(service, /action: "creative_archive"/);
  assert.match(service, /action: "creative_unarchive"/);
  assert.match(service, /action: "creative_purge_check"/);
  assert.match(service, /action: "creative_purge",\s*creative_id: creativeId,\s*confirm_phrase: "DELETE"/);
  assert.doesNotMatch(page, /from\("ad_creatives"\)[\s\S]{0,40}\.delete\(/);
  assert.match(page, /disabled=\{deletePhrase !== "DELETE"\}/);
  assert.match(page, /Something started using this video\. Archive it instead\./);
});

test("#3697 Builder video validation comes from the server, not a media URL", () => {
  assert.match(step, /getAdCreativeForReuse\(\s*creativeId,\s*reportPlatforms\.length > 0 \? reportPlatforms : undefined,?\s*\)/);
  assert.doesNotMatch(step, /kind: "video",\s*name: row\.name,\s*source_url/);
  const builder = read("../CampaignBuilderPage.jsx");
  assert.match(builder, /row\.kind === "video"\s*\? \{ data: \{ validation: data\.validation \?\? null \}, error: null \}/);
});

test("#3697 card copy helpers", () => {
  assert.equal(fitReason(["at least 5 seconds"]), "Needs at least 5 s");
  assert.equal(fitReason(["60 seconds or less"]), "Too long (max 60 s)");
  assert.equal(fitReason(["9:16", "1080×1920"]), "Needs 9:16, 1080×1920");
  assert.equal(fitReason(["sound"]), "Needs sound");
  assert.equal(fitReason(["720p or higher"]), "Short side must be 720+");
  assert.equal(usageLine({ usage: { campaign_count: 0 } }), "Not used yet");
  assert.equal(sourceLine({ source: "ari_upload", brand_name: "Gogi" }), "From Ari · Gogi");
  assert.equal(
    sourceLine({ source: "admin_upload", created_by_name: "Seth", created_at: "2026-10-19T10:00:00Z" }, Date.parse("2026-10-19T10:00:20Z")),
    "Uploaded by Seth · just now",
  );
  assert.deepEqual(dragSummary({ videos: 2, images: 1 }), { title: "Drop to upload 3 files", sub: "2 videos, 1 image" });
  assert.equal(refusalTitle(1), "1 file wasn't added");
  assert.equal(canManageLifecycle({ house_reuse_allowed: true }), true);
  assert.equal(canManageLifecycle({ house_reuse_allowed: false }), false);
});
