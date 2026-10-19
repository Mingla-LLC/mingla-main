// Issue #3040 (T-C4 edge half, E-13) — video creatives come only from the lane.
// MINGLA-INVARIANT: I-CREATIVE-FROM-JOB-ONLY | issue #3697 | video creatives are created only from a READY lane job
//
// FAILS ON REVERT: restore the video `record` branch (or let `validate` use the
// request's bunny_video_id / mp4_master_url / poster_url) and the assertions
// below fail.
import { handleAdminAdCreativeUpload } from "./index.ts";
import {
  assert,
  makeFakeDb,
  type Row,
  withEnv,
} from "../_shared/__tests__/issue3040_fakeSupabase.ts";

const ADMIN = "3040ffff-ffff-4fff-8fff-ffffffff0001";
const JOB = "3040ffff-ffff-4fff-8fff-ffffffff0002";

const harness = (jobs: Row[], allow = true) => {
  const db = makeFakeDb({
    admin_users: [{ id: "a", email: "ops@mingla.test", status: "active" }],
    event_cover_video_jobs: jobs,
    ad_creatives: [],
  });
  db.client.auth.getUser = () => Promise.resolve({ data: { user: { id: ADMIN, email: "ops@mingla.test" } }, error: null });
  const probes: unknown[] = [];
  const deps = {
    createClient: () => db.client,
    probeTrustedVideoSources: (asset: unknown) => {
      probes.push(asset);
      return Promise.resolve({
        bytes: { video: new Uint8Array(1), poster: new Uint8Array(1) },
        videoProbe: { kind: "video", mimeType: "video/mp4", container: "mp4", width: 1080, height: 1920, aspectRatio: 0.5625,
          durationSeconds: 10, hasAudio: true, videoCodecFourcc: "avc1", overallBitrateKbps: 1, byteSize: 1, contentHash: "a".repeat(64) },
        posterProbe: { kind: "image", mimeType: "image/jpeg", container: null, width: 1, height: 1, aspectRatio: 1,
          durationSeconds: null, hasAudio: null, videoCodecFourcc: null, overallBitrateKbps: null, byteSize: 1, contentHash: "b".repeat(64) },
        videoHash: "a".repeat(64),
        posterHash: "b".repeat(64),
      });
    },
    requireAdCreativeLaneAccess: () =>
      Promise.resolve(allow ? null : new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
  };
  return { db, deps, probes };
};

const post = (body: Record<string, unknown>, deps: unknown) =>
  withEnvResult(() =>
    handleAdminAdCreativeUpload(
      new Request("https://test/admin-ad-creative-upload", {
        method: "POST",
        headers: { authorization: "Bearer admin", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      deps as never,
    )
  );

const withEnvResult = async (fn: () => Promise<Response>): Promise<Response> => {
  let response: Response | null = null;
  await withEnv({ BUNNY_STREAM_CDN_HOSTNAME: "vz-3040.b-cdn.net" }, async () => {
    response = await fn();
  });
  return response as unknown as Response;
};

const readyJob: Row = {
  id: JOB, status: "ready", target_kind: "ad_creative", brand_id: null, requested_by: ADMIN,
  draft_owner_key: `admin-library:${ADMIN}`, source_asset_id: "guid-lane-3040",
  processed_url: "https://vz-3040.b-cdn.net/guid-lane-3040/play_1080p.mp4",
  processed_poster_url: "https://vz-3040.b-cdn.net/guid-lane-3040/thumbnail.jpg",
};

Deno.test("#3040 recording a video from browser-supplied links answers 410 and writes nothing", async () => {
  const { db, deps, probes } = harness([readyJob]);
  const response = await post({
    action: "record", kind: "video", name: "x", bunny_video_id: "guid-lane-3040",
    mp4_master_url: readyJob.processed_url, poster_url: readyJob.processed_poster_url,
  }, deps);
  const payload = await response.json();
  assert(response.status === 410 && payload.error === "video_record_retired" && payload.detail === "use_video_lane", JSON.stringify(payload));
  assert(db.tables.ad_creatives.length === 0 && probes.length === 0, "a retired video record still probed or wrote");
});

Deno.test("#3040 validating a video probes only the named lane job's own media", async () => {
  const { deps, probes } = harness([readyJob]);
  const response = await post({
    action: "validate", kind: "video", name: "x", source_job_id: JOB,
    bunny_video_id: "someone-elses-guid",
    mp4_master_url: "https://vz-3040.b-cdn.net/someone-elses-guid/play_720p.mp4",
    poster_url: "https://vz-3040.b-cdn.net/someone-elses-guid/thumbnail.jpg",
  }, deps);
  assert(response.status === 200, `got ${response.status}: ${await response.clone().text()}`);
  assert(JSON.stringify(probes[0]) === JSON.stringify({
    bunny_video_id: "guid-lane-3040",
    mp4_master_url: readyJob.processed_url,
    poster_url: readyJob.processed_poster_url,
  }), `probed ${JSON.stringify(probes[0])}`);
});

Deno.test("#3040 video validation needs a lane job the caller may use", async () => {
  const missing = await post({ action: "validate", kind: "video", name: "x" }, harness([readyJob]).deps);
  assert(missing.status === 422 && (await missing.json()).detail === "source_job_id_required", "a video validate without a job was accepted");
  const forbidden = await post({ action: "validate", kind: "video", name: "x", source_job_id: JOB }, harness([readyJob], false).deps);
  assert(forbidden.status === 403, `another user's job was probed: ${forbidden.status}`);
  const notReady = await post(
    { action: "validate", kind: "video", name: "x", source_job_id: JOB },
    harness([{ ...readyJob, status: "processing", processed_url: null }]).deps,
  );
  assert(notReady.status === 409, `an unfinished job was probed: ${notReady.status}`);
  const coverJob = await post(
    { action: "validate", kind: "video", name: "x", source_job_id: JOB },
    harness([{ ...readyJob, target_kind: "event" }]).deps,
  );
  assert(coverJob.status === 409, `a cover job was validated as an ad video: ${coverJob.status}`);
});
