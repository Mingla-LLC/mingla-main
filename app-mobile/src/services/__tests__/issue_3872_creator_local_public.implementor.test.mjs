import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// [TEST-MOD-APPROVED #3872] The Explorer app exposes only reviewed public
// Creator/Local DTOs and obtains every video from the short-lived playback edge
// boundary. These source contracts catch accidental direct-storage regressions.
// Walkthrough build: playback moved into the shared VideoTile `playPublicVideo`.
const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const profile = read("src/components/profile/PublicCreatorSection.tsx");
const publicLocal = read("src/components/profile/PublicLocalSection.tsx");
const placeLocal = read("src/components/expandedCard/LocalReviewsSection.tsx");
const media = read("src/services/creatorMediaService.ts");
const tile = read("src/components/programs/VideoTile.tsx");
const player = read("src/components/programs/CreatorMediaPlayerModal.tsx");
const creatorService = read("src/services/creatorProgramService.ts");
const localService = read("src/services/localProgramService.ts");
const localScreen = read("app/local/index.tsx");
const localReview = read("app/local/review.tsx");

test("#3872 public Creator showcase uses the public DTO and signed playback boundary", () => {
  assert.match(profile, /creatorProgramService\.publicProfile/);
  assert.match(creatorService, /public_creator_profile/);
  // Playback goes through the shared VideoTile helper, which calls the signed edge.
  assert.match(profile, /playPublicVideo/);
  assert.match(
    tile,
    /export async function playPublicVideo[\s\S]*publicCreatorMedia\(jobId\)/,
  );
  assert.match(media, /creator-media-public/);
  assert.doesNotMatch(tile, /storage\.from|createSignedUrl/);
  assert.doesNotMatch(profile, /storage\.from|createSignedUrl/);
});

test("#3872 Local videos render on profiles and place cards without exposing private review rows", () => {
  assert.match(publicLocal, /localProgramService\.publicProfile/);
  assert.match(placeLocal, /localProgramService\.publicPlaceReviews/);
  assert.match(localService, /public_local_profile/);
  assert.match(localService, /public_place_local_reviews/);
  assert.match(publicLocal, /playPublicVideo/);
  assert.match(placeLocal, /publicCreatorMedia/);
  assert.match(placeLocal, /CreatorMediaPlayerModal/);
  assert.match(player, /<WebView/);
  assert.match(player, /https:\/\/player\.mediadelivery\.net/);
  assert.doesNotMatch(placeLocal, /openBrowserAsync/);
  assert.match(localService, /media_job_ids/);
  assert.doesNotMatch(
    `${publicLocal}\n${placeLocal}`,
    /from\(["']local_reviews["']\)/,
  );
});

test("#3872 public review views emit surface-only analytics", () => {
  assert.match(publicLocal, /local_review_viewed/);
  assert.match(publicLocal, /surface:\s*["']profile["']/);
  assert.match(placeLocal, /local_review_viewed/);
  assert.match(placeLocal, /surface:\s*["']place_card["']/);
});

test("#4182 the place-card Local review follows the expanded-card content grid", () => {
  assert.match(placeLocal, /content:\s*\{\s*paddingHorizontal:\s*SPINE\.gutter/);
  assert.match(placeLocal, /width:\s*["']100%["'][\s\S]*aspectRatio:\s*16\s*\/\s*9/);
  assert.match(placeLocal, /label=\{`Watch \$\{review\.name\}'s visit`\}/);
  assert.doesNotMatch(placeLocal, /Independent visits|This place did not buy or approve/);
  assert.doesNotMatch(placeLocal, /styles\.videoPad|styles\.note/);
});

test("#4182 only the applicant signs the published Local agreement before activation", () => {
  assert.match(localScreen, /Sign your Local agreement/);
  assert.match(localScreen, /Only you can sign this agreement\. A Mingla Admin cannot sign it for you\./);
  assert.match(localScreen, /Full legal name/);
  assert.match(localScreen, /I’ve read and agree to the Mingla Local agreement/);
  assert.match(localScreen, /Sign and activate my seat/);
  assert.match(localService, /programWrite\('local_agreement_sign'/);
  assert.match(localService, /p_signature_name:\s*signatureName\.trim\(\)/);
});

test("#4182 the Local gets the marketing-ready video format and social collaboration gate", () => {
  assert.match(localReview, /Your video format · 30–60 seconds, vertical/);
  assert.match(localReview, /Show how you found it/);
  assert.match(localReview, /place card in your Mingla deck/);
  assert.match(localReview, /Post the same finished video/);
  assert.match(localReview, /invited Mingla’s official account as a collaborator/);
  assert.match(localReview, /formatConfirmed && collaborationConfirmed/);
  assert.match(localReview, /place’s expanded card and in Mingla marketing/);
  assert.doesNotMatch(localReview, /visit was paid by Mingla|Disclose the paid visit/);
});
