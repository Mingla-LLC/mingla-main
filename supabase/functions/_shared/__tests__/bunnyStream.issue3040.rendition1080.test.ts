// Issue #3040 (T-B2, B-2, C-10) — the lane selects up to 1080p, highest first.
// MINGLA-INVARIANT: I-VIDEO-LIMITS-PARITY | issue #3040 | the lane selects the highest served rendition <= 1080p within FINAL_MAX_BYTES
//
// FAILS ON REVERT: restore the 720 ceiling (or drop bunnyMp4Candidates) and the
// first candidate is play_720p.mp4, never play_1080p.mp4.
import {
  bunnyBestMp4,
  bunnyMp4Candidates,
  type BunnyVideo,
} from "../bunnyStream.ts";
import { MAX_RENDITION_HEIGHT } from "../eventCoverVideo.ts";
import { assert, withEnv } from "./issue3040_fakeSupabase.ts";

const video = (availableResolutions: string | null): BunnyVideo => ({
  guid: "guid-3040",
  status: 4,
  length: 30,
  storageSize: 1,
  availableResolutions,
  encodeProgress: 100,
});

Deno.test("#3040 the first MP4 candidate is 1080p when Bunny rendered it", async () => {
  await withEnv({ BUNNY_STREAM_CDN_HOSTNAME: "vz-3040.b-cdn.net" }, () => {
    const candidates = bunnyMp4Candidates(video("240p,360p,480p,720p,1080p"));
    assert(MAX_RENDITION_HEIGHT === 1080, "the lane ceiling must be 1080");
    assert(
      candidates[0]?.url === "https://vz-3040.b-cdn.net/guid-3040/play_1080p.mp4",
      `first candidate was ${candidates[0]?.url}`,
    );
    assert(
      candidates.map((c) => c.heightP).join(",") === "1080,720,480,360,240",
      "candidates must be highest first",
    );
    return Promise.resolve();
  });
});

Deno.test("#3040 renditions above 1080p are never selected, and duplicates collapse", async () => {
  await withEnv({ BUNNY_STREAM_CDN_HOSTNAME: "vz-3040.b-cdn.net" }, () => {
    const heights = bunnyMp4Candidates(video("1440p,1080p,1080p,720p")).map((c) => c.heightP);
    assert(heights.join(",") === "1080,720", `got ${heights.join(",")}`);
    assert(bunnyMp4Candidates(video(null)).length === 0, "missing list must fail closed");
    assert(bunnyMp4Candidates(video("2160p")).length === 0, "only-4K must fail closed");
    // The thin legacy wrapper keeps its historical 720 ceiling for its callers.
    assert(bunnyBestMp4(video("1080p,720p"))?.heightP === 720, "bunnyBestMp4 default changed");
    assert(bunnyBestMp4(video("1080p,720p"), 1080)?.heightP === 1080, "bunnyBestMp4 ceiling ignored");
    return Promise.resolve();
  });
});
