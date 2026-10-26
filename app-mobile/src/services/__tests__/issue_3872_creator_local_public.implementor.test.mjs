import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// [TEST-MOD-APPROVED #3872] The Explorer app exposes only reviewed public
// Creator/Local DTOs and obtains every video from the short-lived playback edge
// boundary. These source contracts catch accidental direct-storage regressions.
const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const profile = read("src/components/profile/PublicCreatorSection.tsx");
const publicLocal = read("src/components/profile/PublicLocalSection.tsx");
const placeLocal = read("src/components/expandedCard/LocalReviewsSection.tsx");
const media = read("src/services/creatorMediaService.ts");
const creatorService = read("src/services/creatorProgramService.ts");
const localService = read("src/services/localProgramService.ts");

test("#3872 public Creator showcase uses the public DTO and signed playback boundary", () => {
  assert.match(profile, /creatorProgramService\.publicProfile/);
  assert.match(creatorService, /public_creator_profile/);
  assert.match(profile, /publicCreatorMedia/);
  assert.match(media, /creator-media-public/);
  assert.doesNotMatch(profile, /storage\.from|createSignedUrl/);
});

test("#3872 Local videos render on profiles and place cards without exposing private review rows", () => {
  assert.match(publicLocal, /localProgramService\.publicProfile/);
  assert.match(placeLocal, /localProgramService\.publicPlaceReviews/);
  assert.match(localService, /public_local_profile/);
  assert.match(localService, /public_place_local_reviews/);
  assert.match(publicLocal, /publicCreatorMedia/);
  assert.match(placeLocal, /publicCreatorMedia/);
  assert.match(localService, /media_job_ids/);
  assert.doesNotMatch(`${publicLocal}\n${placeLocal}`, /from\(["']local_reviews["']\)/);
});

test("#3872 public review views emit surface-only analytics", () => {
  assert.match(publicLocal, /local_review_viewed/);
  assert.match(publicLocal, /surface:\s*["']profile["']/);
  assert.match(placeLocal, /local_review_viewed/);
  assert.match(placeLocal, /surface:\s*["']place_card["']/);
});
