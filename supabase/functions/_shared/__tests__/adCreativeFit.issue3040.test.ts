// Issue #3040 (design AD-04) — Host Ads shows "Fits Meta and TikTok. Snapchat
// needs 1080×1920." The fit is judged by the shared channel matrix on the
// server; these tests pin the summary the Host app formats.
// MINGLA-INVARIANT: I-ADS-FIT-ONE-MATRIX | issue #3040 | Host fit text comes from adCreativeMatrix, never a client copy of its rules
// FAILS ON REVERT: drop the setup projection's fit, or treat needs_transcode
// as a fit, or let the summary invent its own duration rule.
import {
  summarizeCreativeFit,
  withHostCreativeFit,
} from "../adCreativeFit.ts";
import { assert } from "./issue3040_fakeSupabase.ts";

const lane1080 = {
  kind: "video",
  mime_type: "video/mp4",
  width: 1080,
  height: 1920,
  aspect_ratio: 0.5625,
  duration_seconds: 15,
  has_audio: true,
  byte_size: 20 * 1024 * 1024,
  poster_url: "https://cdn.example/guid/thumbnail.jpg",
  variants: {},
};

Deno.test("#3040 a 1080×1920 lane video with sound fits every platform", () => {
  const fit = summarizeCreativeFit(["meta", "tiktok", "google", "snapchat"], lane1080);
  assert(fit.length === 4, "one row per platform");
  for (const row of fit) {
    assert(row.fits === true, `${row.platform} should fit: ${row.needs.join(", ")}`);
  }
});

Deno.test("#3040 a 720×1280 video misses only Snapchat, which needs 1080×1920", () => {
  const fit = summarizeCreativeFit(["meta", "tiktok", "snapchat"], {
    ...lane1080,
    width: 720,
    height: 1280,
  });
  const snap = fit.find((row) => row.platform === "snapchat");
  assert(snap?.fits === false, "snapchat must not fit 720p");
  assert(JSON.stringify(snap?.needs) === JSON.stringify(["1080×1920"]), `needs: ${snap?.needs}`);
  assert(fit.filter((row) => row.fits).map((row) => row.platform).join() === "meta,tiktok", "meta and tiktok fit");
});

Deno.test("#3040 a 4 s legacy clip names the duration each platform needs", () => {
  const fit = summarizeCreativeFit(["meta", "snapchat"], {
    ...lane1080,
    duration_seconds: 4,
  });
  const meta = fit.find((row) => row.platform === "meta");
  assert(meta?.fits === false, "meta refuses under 5 s");
  assert(meta?.needs.includes("at least 5 seconds") === true, `meta needs: ${meta?.needs}`);
  assert(fit.find((row) => row.platform === "snapchat")?.fits === true, "snap takes 3 s and up");
});

Deno.test("#3040 a silent video needs sound on TikTok and Snapchat; a landscape one needs 9:16 on Snapchat", () => {
  const silent = summarizeCreativeFit(["tiktok", "snapchat", "meta"], { ...lane1080, has_audio: false });
  assert(silent.find((r) => r.platform === "tiktok")?.needs.includes("sound") === true, "tiktok sound");
  assert(silent.find((r) => r.platform === "snapchat")?.needs.includes("sound") === true, "snap sound");
  assert(silent.find((r) => r.platform === "meta")?.fits === true, "meta runs silent video");
  const landscape = summarizeCreativeFit(["snapchat"], {
    ...lane1080,
    width: 1920,
    height: 1080,
    aspect_ratio: 16 / 9,
  });
  assert(landscape[0].fits === false, "needs_transcode is not a fit");
  assert(landscape[0].needs.includes("9:16"), `landscape needs: ${landscape[0].needs}`);
});

Deno.test("#3040 setup projection: fit for connected platforms only, in a fixed order, no raw media columns", () => {
  const [row] = withHostCreativeFit(
    [{ id: "c1", name: "Clip", ...lane1080, width: 720, height: 1280 }],
    [{ platform: "snapchat" }, { platform: "meta" }, { platform: "snapchat" }, { platform: "nope" }],
  );
  const fit = row.fit as { platform: string; fits: boolean; needs: string[] }[];
  assert(fit.map((r) => r.platform).join() === "meta,snapchat", `order/dedupe: ${fit.map((r) => r.platform)}`);
  assert(fit[1].fits === false && fit[1].needs[0] === "1080×1920", "snap misfit carried");
  for (const column of ["width", "height", "has_audio", "mime_type", "byte_size", "variants"]) {
    assert(!(column in row), `${column} must stay off the wire`);
  }
  assert(row.id === "c1" && row.poster_url === lane1080.poster_url, "existing fields kept");
});

Deno.test("#3040 ad-plan setup returns creatives through the fit projection", async () => {
  const source = await Deno.readTextFile(new URL("../../ad-plan/index.ts", import.meta.url));
  assert(/creatives:\s*withHostCreativeFit\(/.test(source), "setup must project fit");
  assert(source.includes("width,height,has_audio,mime_type,byte_size,variants"), "setup must read the probe columns the fit needs");
});
