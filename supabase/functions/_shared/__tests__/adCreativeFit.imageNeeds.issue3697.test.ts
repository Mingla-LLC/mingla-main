// Issue #3697 — library fit tiles judge an image by the matrix's IMAGE rows and
// say what the image needs in image words. The production image "09"
// (1284×2778 PNG, 0.46:1, 4.3 MB) showed "Needs a different video" on every
// platform: its verdict was right (0.46:1 is on no platform's list) but the
// phrase fell through to the video default.
// MINGLA-INVARIANT: I-ADS-IMAGE-FIT-IMAGE-WORDS | issue #3697 | an image creative's fit needs come from the matrix image rules and never name a video
// Invariant I-ADS-FIT-ONE-MATRIX (declared in supabase/functions/_shared/__tests__/adCreativeFit.issue3040.test.ts)
//
// FAILS ON REVERT: remove the image.* cases from fitNeedFor (the phrases fall
// back to "a different video"), or make the default ignore the creative kind.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fitNeedFor, summarizeCreativeFit } from "../adCreativeFit.ts";
import { libraryFit } from "../adCreativeLifecycle.ts";

const PLATFORMS = ["meta", "tiktok", "google", "snapchat"] as const;

// The production row d0b537e6-… ("09"), as the library reads it.
const IMAGE_09 = {
  kind: "image",
  mime_type: "image/png",
  width: 1284,
  height: 2778,
  aspect_ratio: 0.4622,
  duration_seconds: null,
  has_audio: null,
  byte_size: 4475127,
  poster_url: null,
  variants: {},
};

Deno.test("#3697 the 0.46:1 image misfits by ratio, in image words, on every tile", () => {
  const fit = libraryFit(IMAGE_09, PLATFORMS);
  assertEquals(fit.map((tile) => tile.platform), [...PLATFORMS]);
  for (const tile of fit) {
    assertEquals(tile.fits, false, `${tile.platform} should not fit 0.46:1`);
    for (const need of tile.needs) {
      assert(
        !/video/i.test(need),
        `${tile.platform} need names a video: ${need}`,
      );
    }
  }
  const byPlatform = Object.fromEntries(
    fit.map((tile) => [tile.platform, tile.needs]),
  );
  assertEquals(byPlatform.meta, ["9:16, 4:5, 1:1 or 1.91:1"]);
  assertEquals(byPlatform.tiktok, ["9:16, 1:1 or 16:9"]);
  assertEquals(byPlatform.google, ["9:16, 4:5, 1:1 or 1.91:1"]);
  assertEquals(byPlatform.snapchat, ["9:16"]);
});

Deno.test("#3697 a 1080×1920 PNG under 5 MB fits Meta, TikTok, Google and Snapchat", () => {
  const fit = summarizeCreativeFit(PLATFORMS, {
    ...IMAGE_09,
    width: 1080,
    height: 1920,
    aspect_ratio: 0.5625,
    byte_size: 2 * 1024 * 1024,
  });
  for (const tile of fit) {
    assertEquals(tile.fits, true, `${tile.platform}: ${tile.needs.join(", ")}`);
  }
});

Deno.test("#3697 image size, type and resolution needs are image phrases", () => {
  const big = summarizeCreativeFit(["google", "snapchat"], {
    ...IMAGE_09,
    width: 1080,
    height: 1920,
    aspect_ratio: 0.5625,
    byte_size: 8 * 1024 * 1024,
  });
  assertEquals(big.map((tile) => tile.needs), [["a file under 5 MB"], [
    "a file under 5 MB",
  ]]);

  const webp = summarizeCreativeFit(["meta"], {
    ...IMAGE_09,
    mime_type: "image/webp",
    aspect_ratio: 0.5625,
    width: 1080,
    height: 1920,
  });
  assertEquals(webp[0].needs, ["JPG or PNG"]);

  const small = summarizeCreativeFit(["snapchat", "meta"], {
    ...IMAGE_09,
    width: 540,
    height: 960,
    aspect_ratio: 0.5625,
    byte_size: 300000,
  });
  assertEquals(small[0].needs, ["1080×1920"]);
  assertEquals(small[1].needs, ["600px wide or more"]);
});

Deno.test("#3697 an unknown blocking rule on an image never says video", () => {
  const facts = {
    kind: "image" as const,
    mimeType: "image/png",
    container: null,
    width: 1,
    height: 1,
    aspectRatio: 1,
    durationSeconds: null,
    hasAudio: null,
    byteSize: 1,
    overallBitrateKbps: null,
    posterPresent: false,
    variantRatios: [],
  };
  const need = fitNeedFor({
    platform: "meta",
    rule: "image.something_new",
    level: "reject",
    confidence: "OFFICIAL",
    message: "",
  }, facts);
  assertEquals(need, "a different image");
});
