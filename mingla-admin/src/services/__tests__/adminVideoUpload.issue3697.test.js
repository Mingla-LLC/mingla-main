// Issue #3697 — Admin raw video upload rides the shared #3040 lane.
// Invariant I-VIDEO-ONE-UPLOADER (declared in packages/video-upload/__tests__/videoUpload.test.mjs)
// Invariant I-CREATIVE-FROM-JOB-ONLY (declared in supabase/functions/_shared/__tests__/adCreativeMaterialize.issue3040.test.ts)
//
// Proves: the intent is an ad_creative house upload owned by this admin; the
// bytes go through packages/video-upload with the lane's own transport; the
// library row id comes from the server's apply answer (no media URL is ever
// sent); a resume refuses a different file before any network call; a
// finished upload clears its resume record.
//
// FAILS ON REVERT: change the intent body (target, brandId, owner key), send
// a media URL anywhere, drop the size+hash check in resume(), or keep the
// record after `applied`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  UPLOAD_STORAGE_PREFIX,
  createAdminVideoUploader,
  listUploadRecords,
} from "../adminVideoUpload.js";

const USER = "a0000000-0000-4000-8000-000000000001";
const JOB = "j0000000-0000-4000-8000-000000000001";
const CREATIVE = "c0000000-0000-4000-8000-000000000001";

function memoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

function fakeFile({ name = "rooftop.mp4", type = "video/mp4", size = 16_800_000 } = {}) {
  return { name, type, size, lastModified: 1, slice: () => ({}) };
}

function laneInvoke(calls, overrides = {}) {
  let statusReads = 0;
  return async (name, { body }) => {
    calls.push({ name, body });
    if (overrides[name]) return overrides[name](body, calls);
    switch (name) {
      case "event-cover-video-upload-intent":
        return {
          data: {
            jobId: JOB,
            provider: "bunny",
            upload: { url: "https://video.bunnycdn.com/tusupload", protocol: "tus", fields: { AuthorizationSignature: "sig", LibraryId: "1", VideoId: "v" } },
          },
          error: null,
        };
      case "event-cover-video-source-uploaded":
        return { data: { jobId: JOB, status: "processing" }, error: null };
      case "event-cover-video-status":
        statusReads += 1;
        return {
          data: statusReads < 2
            ? { jobId: JOB, status: "processing" }
            : { jobId: JOB, status: "ready", applicationVersion: 2, processedUrl: "https://cdn.test/v/play_1080p.mp4" },
          error: null,
        };
      case "event-cover-video-apply":
        return { data: { ok: true, creativeId: CREATIVE }, error: null };
      default:
        throw new Error(`unexpected ${name}`);
    }
  };
}

function uploaderWith(calls, extra = {}) {
  const storage = memoryStorage();
  const uploads = [];
  const uploader = createAdminVideoUploader({
    invoke: laneInvoke(calls, extra.overrides),
    getUserId: () => USER,
    storage,
    sha256: async () => "a".repeat(64),
    upload: async (input) => {
      uploads.push(input);
      input.onProgress?.({ percent: 50, confirmedBytes: input.file.size / 2, totalBytes: input.file.size, final: false });
      input.onProgress?.({ percent: 100, confirmedBytes: input.file.size, totalBytes: input.file.size, final: true });
    },
    sleep: async () => {},
    randomUUID: () => "op-0000-0001",
    now: (() => {
      let t = 1_700_000_000_000;
      return () => (t += 10);
    })(),
  });
  return { uploader, storage, uploads };
}

test("#3697 an Admin upload is a brandless ad_creative job owned by this admin", async () => {
  const calls = [];
  const { uploader, storage, uploads } = uploaderWith(calls);
  const stages = [];
  const result = await uploader.start(fakeFile(), { durationMs: 15_200, onStage: (s) => stages.push(s.phase) });

  const intent = calls.find((call) => call.name === "event-cover-video-upload-intent").body;
  assert.equal(intent.target, "ad_creative");
  assert.equal(intent.brandId, null);
  assert.equal(intent.draftOwnerKey, `admin-library:${USER}`);
  assert.equal(intent.clientOperationId, "op-0000-0001");
  assert.equal(intent.sourceMimeType, "video/mp4");
  assert.equal(intent.sourceExtension, "mp4");
  assert.equal(intent.sourceDurationMs, 15_200);
  assert.equal(intent.sourceSha256, "a".repeat(64));

  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].transport.url, "https://video.bunnycdn.com/tusupload");
  assert.equal(uploads[0].transport.headers.AuthorizationSignature, "sig");

  assert.deepEqual(result, { jobId: JOB, creativeId: CREATIVE });
  const apply = calls.find((call) => call.name === "event-cover-video-apply").body;
  assert.deepEqual(apply, { jobId: JOB, expectedVersion: 2, expectedProcessedUrl: "https://cdn.test/v/play_1080p.mp4" });
  assert.ok(stages.includes("uploading") && stages.includes("preparing") && stages.includes("saving"));
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith(UPLOAD_STORAGE_PREFIX)).length, 0);

  // No media URL or provider id is ever sent by Admin.
  for (const call of calls) {
    for (const key of Object.keys(call.body)) {
      assert.ok(!/mp4_master_url|poster_url|bunny_video_id|source_url/.test(key), `${call.name} sent ${key}`);
    }
  }
});

test("#3697 resume refuses a different file before any network call", async () => {
  const calls = [];
  const { uploader } = uploaderWith(calls);
  const record = { opId: "op-1", jobId: JOB, name: "a.mp4", size: 16_800_000, sha256: "b".repeat(64), mime: "video/mp4", ext: "mp4", durationMs: 15_000 };
  await assert.rejects(
    uploader.resume(record, fakeFile({ size: 16_800_000 })),
    (error) => error.code === "different_file",
  );
  await assert.rejects(
    uploader.resume({ ...record, sha256: "a".repeat(64) }, fakeFile({ size: 1 })),
    (error) => error.code === "different_file",
  );
  assert.equal(calls.length, 0);
});

test("#3697 resume with the same file replays the same operation", async () => {
  const calls = [];
  const { uploader } = uploaderWith(calls);
  const record = { opId: "op-keep", jobId: JOB, name: "a.mp4", size: 16_800_000, sha256: "a".repeat(64), mime: "video/mp4", ext: "mp4", durationMs: 15_000 };
  const result = await uploader.resume(record, fakeFile());
  assert.equal(result.creativeId, CREATIVE);
  assert.equal(calls[0].body.clientOperationId, "op-keep");
});

test("#3697 a failed job clears its resume record and is reported in plain words", async () => {
  const calls = [];
  const { uploader, storage } = uploaderWith(calls, {
    overrides: {
      "event-cover-video-status": () => ({ data: { jobId: JOB, status: "failed", failureCode: "processing_stalled" }, error: null }),
    },
  });
  await assert.rejects(
    uploader.start(fakeFile(), { durationMs: 15_000 }),
    (error) => !/_/.test(error.message) && error.jobId === JOB,
  );
  assert.deepEqual(listUploadRecords(storage), []);
});

test("#3697 the edge's refusal reaches the operator as copy, not a code", async () => {
  const calls = [];
  const { uploader } = uploaderWith(calls, {
    overrides: {
      "event-cover-video-upload-intent": () => ({
        data: null,
        error: { message: "422", context: { status: 422, json: async () => ({ error: "validation_error", detail: "ad_video_too_short" }) } },
      }),
    },
  });
  await assert.rejects(uploader.start(fakeFile(), { durationMs: 6_000 }), (error) => error.code === "ad_video_too_short" && error.message === "Videos need at least 5 seconds.");
});

test("#3697 Admin has no second uploader: the lane client imports packages/video-upload", () => {
  const source = readFileSync(new URL("../adminVideoUpload.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/\.\.\/\.\.\/packages\/video-upload\/index\.js"/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
  assert.doesNotMatch(source, /Tus-Resumable|method: "PATCH"/);
});
