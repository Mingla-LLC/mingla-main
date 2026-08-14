// ISSUE-1185 [Reddit video Phase B] implementor regression — Reddit paused-video
// create. NO live provider calls, NO ad objects, NO spend: pure builder unit tests
// + create-branch source assertions only (the reddit branch has heavy Supabase
// deps; the tester's adversarial suite + the PAUSED live-fire window exercise it
// end-to-end, Reddit having NO validate-only). Fails-on-revert targets are named
// per test.
//
// The build: Reddit — unlike Meta/Snap/TikTok/Google — has NO per-platform
// preparation step. It downloads and rehosts the master MP4 + poster straight from
// the #866 library clip (mp4_master_url + poster_url), so the create branch resolves
// the library row directly and builds a type:"VIDEO" structured-post ad, PAUSED at
// every level, through the existing redditCreateFullChain. The reddit.ts adapter is
// unchanged — it already models VIDEO (validateRedditCreative + the structured-post
// job builder), so this suite proves the adapter's video legs AND the create-branch
// wiring that now feeds them.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
// adChannel.ts is imported (value) BEFORE reddit.ts so its ADAPTERS registry —
// which references redditAdapter — evaluates first; importing reddit.ts first
// hits a circular-import TDZ (Cannot access 'redditAdapter' before init). Same
// ordering the #916 reddit.test.ts and #997 tiktok suites use.
import { REDDIT_CTA_MAP } from "../adChannel.ts";
import {
  buildRedditStructuredPostJobBody,
  validateRedditCreative,
} from "../reddit.ts";

const CANONICAL_URL = "https://host.usemingla.com/e/rooftop/summer-jam";
const MASTER_MP4 = "https://cdn.mingla.test/bunny/master.mp4";
const POSTER = "https://cdn.mingla.test/bunny/thumbnail.jpg";
// A verbatim Title-Case CTA from the 24-string enum (GR-29).
const CTA = REDDIT_CTA_MAP.ticketed_event;

// ── Adapter video legs (reddit.ts already models VIDEO — unchanged by #1185) ────

Deno.test("ISSUE-1185: buildRedditStructuredPostJobBody(VIDEO) emits creative.video + creative.thumbnail (mp4 + poster), never creative.image", () => {
  const body = buildRedditStructuredPostJobBody({
    type: "VIDEO",
    headline: "Rooftop tonight — who's in?",
    destinationUrl: CANONICAL_URL,
    callToAction: CTA,
    videoUrl: MASTER_MP4,
    thumbnailUrl: POSTER,
  });
  const creative = body.creative as Record<string, unknown>;
  assertEquals(creative.type, "VIDEO");
  const video = creative.video as Record<string, Record<string, unknown>>;
  const thumbnail = creative.thumbnail as Record<
    string,
    Record<string, unknown>
  >;
  // The master MP4 is the video media; the poster is the thumbnail media — both are
  // URL-typed (Reddit downloads and rehosts, §5.5). fails-on-revert: dropping the
  // VIDEO branch of the builder (or swapping mp4/poster) breaks this.
  assertEquals(video.media.url, MASTER_MP4);
  assertEquals(video.media.type, "URL");
  assertEquals(thumbnail.media.url, POSTER);
  assertEquals(thumbnail.media.type, "URL");
  assert(
    creative.image === undefined,
    "a VIDEO structured post must not carry creative.image",
  );
});

Deno.test("ISSUE-1185: an IMAGE structured post is UNREGRESSED — carries creative.image, no video/thumbnail", () => {
  const body = buildRedditStructuredPostJobBody({
    type: "IMAGE",
    headline: "Rooftop tonight — who's in?",
    destinationUrl: CANONICAL_URL,
    callToAction: CTA,
    imageUrl: "https://cdn.mingla.test/hero.jpg",
  });
  const creative = body.creative as Record<string, unknown>;
  assertEquals(creative.type, "IMAGE");
  assert(creative.image !== undefined, "IMAGE keeps creative.image");
  assert(creative.video === undefined, "IMAGE never emits creative.video");
  assert(
    creative.thumbnail === undefined,
    "IMAGE never emits creative.thumbnail",
  );
});

Deno.test("ISSUE-1185: validateRedditCreative(VIDEO) REQUIRES both the video URL and the poster (AC-R-25)", () => {
  // Missing video → video_url_required.
  const noVideo = validateRedditCreative({
    type: "VIDEO",
    headline: "ok headline",
    destinationUrl: CANONICAL_URL,
    callToAction: CTA,
    videoUrl: null,
    thumbnailUrl: POSTER,
  });
  assert(!noVideo.ok);
  assertEquals(noVideo.detail, "video_url_required");

  // Missing poster → video_thumbnail_required (a Reddit VIDEO post REQUIRES one).
  const noPoster = validateRedditCreative({
    type: "VIDEO",
    headline: "ok headline",
    destinationUrl: CANONICAL_URL,
    callToAction: CTA,
    videoUrl: MASTER_MP4,
    thumbnailUrl: null,
  });
  assert(!noPoster.ok);
  assertEquals(noPoster.detail, "video_thumbnail_required");

  // Both present → ok.
  const good = validateRedditCreative({
    type: "VIDEO",
    headline: "ok headline",
    destinationUrl: CANONICAL_URL,
    callToAction: CTA,
    videoUrl: MASTER_MP4,
    thumbnailUrl: POSTER,
  });
  assert(good.ok);
});

// ── Create-branch wiring (source assertions — the reddit branch is Supabase-heavy;
//    the tester's adversarial suite + the downstream PAUSED acceptance probe run it
//    live, PAUSED). The reddit branch is sliced from its marker to the generic
//    (Meta) WP1 path so assertions target ONLY the reddit branch. ────────────────
const REDDIT_BRANCH_MARKER = 'if (platform === "reddit") {';
const GENERIC_PATH_MARKER =
  "// QA P1-1: WP1 accepts ONLY the §4.4b default bid strategy";

async function redditBranch(): Promise<string> {
  const src = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const start = src.indexOf(REDDIT_BRANCH_MARKER);
  const end = src.indexOf(GENERIC_PATH_MARKER, start);
  assert(
    start >= 0 && end > start,
    "could not locate the reddit branch bounds",
  );
  return src.slice(start, end);
}

/** Strip `//` line comments — a negative CODE assertion must ignore prose that
 * legitimately cites a contract (mirrors the #927 reddit no-hand-rolled-body
 * test: comments may name configured_status; CODE may not construct it). */
function codeOnly(branch: string): string {
  return branch.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join(
    "\n",
  );
}

Deno.test("ISSUE-1185: the Reddit video seam is OPENED — the phase-A 422 is GONE from the reddit branch", async () => {
  const reddit = await redditBranch();
  // fails-on-revert: restoring `return json({ error: "video_create_not_available_phase_a" }, 422)`
  // (the Phase-A gate) re-adds the string to the reddit branch and fails this.
  assert(
    !reddit.includes("video_create_not_available_phase_a"),
    "the reddit branch must no longer hard-fail video create",
  );
  // The branch now forks on creative kind instead of assuming IMAGE.
  assertStringIncludes(
    reddit,
    'const creativeKindR = creativeR.kind === "video" ? "video" : "image";',
  );
});

Deno.test('ISSUE-1185: Reddit video resolves the #866 clip (mp4_master_url→videoUrl, poster_url→thumbnailUrl) and builds type:"VIDEO"', async () => {
  const reddit = await redditBranch();
  // The canonical hosted video + poster come off the #866 library row (kind:"video").
  assertStringIncludes(
    reddit,
    '.select("id, kind, mp4_master_url, poster_url")',
  );
  assertStringIncludes(reddit, '.eq("id", creativeLibraryIdR)');
  assertStringIncludes(reddit, "libCreativeR.mp4_master_url");
  assertStringIncludes(reddit, "libCreativeR.poster_url");
  // The build feeds them into a type:"VIDEO" RedditCreativeBuildInput.
  assertStringIncludes(reddit, 'type: "VIDEO"');
  assertStringIncludes(reddit, "videoUrl: videoUrlR");
  assertStringIncludes(reddit, "thumbnailUrl: posterUrlR");
});

Deno.test("ISSUE-1185: honest provider limits — a missing clip fails reddit_video_library_required (NOT the siblings' video_preparation_required)", async () => {
  const reddit = await redditBranch();
  // Reddit has no prepare step, so the sibling wording would mislead.
  assertStringIncludes(reddit, "reddit_video_library_required");
  assert(
    !codeOnly(reddit).includes("video_preparation_required"),
    "the reddit branch must NOT borrow the prepare-based error code — Reddit never prepares",
  );
  // A partial/legacy #866 row still fails closed (no bad create body).
  assertStringIncludes(reddit, "reddit_video_master_missing");
  assertStringIncludes(reddit, "reddit_video_poster_missing");
});

Deno.test("ISSUE-1185: PAUSED-only + no hand-rolled body preserved — video routes through redditCreateFullChain, no validate-only", async () => {
  const reddit = await redditBranch();
  // G-1: the create bodies live in the reddit.ts builders — the branch CODE never
  // hand-rolls configured_status; both image AND video go through the full chain.
  assertStringIncludes(reddit, "redditCreateFullChain(");
  assert(
    !codeOnly(reddit).includes("configured_status"),
    "the reddit branch CODE must never hand-roll configured_status (G-1) — comments may cite it",
  );
  // PAUSED persisted on all three rows (unchanged by the video path).
  const paused = reddit.match(/(?<![a-z_])status:\s*"PAUSED"/g) ?? [];
  assert(
    paused.length >= 3,
    `reddit branch must persist PAUSED on campaign+ad_set+ad; found ${paused.length}`,
  );
  assertStringIncludes(reddit, 'to_status: "PAUSED"');
  // Reddit has NO validate_only — the named-skipped no-op is preserved for video too.
  assertStringIncludes(reddit, "reddit_no_validate_only");
});
