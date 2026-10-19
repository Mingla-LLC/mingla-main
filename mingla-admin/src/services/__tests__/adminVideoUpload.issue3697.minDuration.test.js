// Issue #3697 (answer 4) — the Admin drop zone refuses a video shorter than
// 5 seconds at pick, before any network call. So are a clip over one minute,
// one over 100 MB and an unsupported type.
// Invariant I-AD-VIDEO-MIN-5S (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_ad_min_duration.test.ts)
//
// FAILS ON REVERT: drop the AD_MIN_DURATION_MS arm from checkVideoFile, or the
// checkVideoFile call at the top of start().
import assert from "node:assert/strict";
import test from "node:test";
import { checkVideoFile, createAdminVideoUploader } from "../adminVideoUpload.js";

const file = (overrides = {}) => ({ name: "teaser.mp4", type: "video/mp4", size: 8_000_000, ...overrides });

test("#3697 a 4.2 s video is refused with the design line", () => {
  assert.deepEqual(checkVideoFile(file(), 4_200), {
    code: "too_short",
    line: "teaser.mp4 is 4.2 s long. Videos need at least 5 seconds.",
  });
});

test("#3697 5 s to 1 minute passes; the one-minute tolerance holds", () => {
  assert.equal(checkVideoFile(file(), 5_000), null);
  assert.equal(checkVideoFile(file(), 60_400), null);
  assert.equal(checkVideoFile(file(), 108_000).line, "teaser.mp4 is 1:48 long. Videos can be up to 1 minute.");
});

test("#3697 size and type refusals name the file", () => {
  assert.equal(
    checkVideoFile(file({ size: 104_857_601 }), 10_000).line,
    "teaser.mp4 is 100 MB. Videos must be under 100 MB.",
  );
  assert.equal(
    checkVideoFile(file({ name: "clip.avi", type: "video/x-msvideo" }), 10_000).line,
    "clip.avi isn't a supported type.",
  );
  // A browser that reports no MIME still accepts a known extension.
  assert.equal(checkVideoFile(file({ name: "clip.MOV", type: "" }), 10_000), null);
});

test("#3697 a too-short pick never reaches the lane", async () => {
  const calls = [];
  const uploader = createAdminVideoUploader({
    invoke: async (name) => {
      calls.push(name);
      return { data: null, error: null };
    },
    getUserId: () => "user",
    storage: null,
    sha256: async () => {
      calls.push("sha256");
      return "a".repeat(64);
    },
  });
  await assert.rejects(uploader.start(file(), { durationMs: 4_200 }), (error) => error.code === "too_short");
  assert.deepEqual(calls, []);
});
