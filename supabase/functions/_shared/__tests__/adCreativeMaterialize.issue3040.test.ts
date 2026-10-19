// Issue #3040 (T-C4) — video creatives are created only from a READY lane job.
// MINGLA-INVARIANT: I-CREATIVE-FROM-JOB-ONLY | issue #3697 | video creatives are created only from a READY lane job
//
// FAILS ON REVERT: let materializeAdCreativeFromJob take media from anything
// but the job row (or drop the source_job_id idempotency) and the assertions
// below fail.
import { CreativeTrustError } from "../adCreativePrepare.ts";
import {
  creativeNameFromJob,
  creativeSourceForJob,
  materializeAdCreativeFromJob,
} from "../adCreativeMaterialize.ts";
import { assert, makeFakeDb, transitionJobHandler } from "./issue3040_fakeSupabase.ts";

const readyJob = () => ({
  id: "job-ad-3040",
  target_kind: "ad_creative",
  status: "ready",
  brand_id: null as string | null,
  requested_by: "admin-3040",
  draft_owner_key: "admin-library:admin-3040",
  source_asset_id: "guid-ad-3040",
  processed_url: "https://vz.test/guid-ad-3040/play_1080p.mp4",
  processed_poster_url: "https://vz.test/guid-ad-3040/thumbnail.jpg",
  source_file_name: "Summer launch.MOV",
  created_at: "2026-10-19T10:00:00Z",
  provider_payload: { rendition_height: 1080 },
  // Hostile extras a caller might try to smuggle in: never read.
  mp4_master_url: "https://evil.test/other.mp4",
  bunny_video_id: "someone-elses-guid",
});

const probe = (calls: unknown[]) => (asset: unknown) => {
  calls.push(asset);
  return Promise.resolve({
    bytes: { video: new Uint8Array(1), poster: new Uint8Array(1) },
    videoProbe: {
      kind: "video", mimeType: "video/mp4", container: "mp4/isom", width: 1080, height: 1920,
      aspectRatio: 0.5625, durationSeconds: 12, hasAudio: true, videoCodecFourcc: "avc1",
      overallBitrateKbps: 4000, byteSize: 6_000_000, contentHash: "c".repeat(64),
    },
    posterProbe: {
      kind: "image", mimeType: "image/jpeg", container: null, width: 1080, height: 1920,
      aspectRatio: 0.5625, durationSeconds: null, hasAudio: null, videoCodecFourcc: null,
      overallBitrateKbps: null, byteSize: 1000, contentHash: "d".repeat(64),
    },
    videoHash: "c".repeat(64),
    posterHash: "d".repeat(64),
  });
};

Deno.test("#3040 the creative is built from the job's own media, once", async () => {
  const db = makeFakeDb({ ad_creatives: [], event_cover_video_jobs: [] });
  const calls: unknown[] = [];
  const job = readyJob();
  assert(materializeAdCreativeFromJob.length === 2, "materialize must not take a media/URL parameter");
  const first = await materializeAdCreativeFromJob(db.client, job, { probeTrustedVideoSources: probe(calls) as never });
  assert(first.ok && first.created, JSON.stringify(first));
  assert(JSON.stringify(calls[0]) === JSON.stringify({
    bunny_video_id: "guid-ad-3040",
    mp4_master_url: "https://vz.test/guid-ad-3040/play_1080p.mp4",
    poster_url: "https://vz.test/guid-ad-3040/thumbnail.jpg",
  }), `probe was asked about ${JSON.stringify(calls[0])}`);
  const row = db.tables.ad_creatives[0];
  assert(row.source === "admin_upload" && row.source_job_id === job.id && row.bunny_video_id === "guid-ad-3040", JSON.stringify(row));
  assert(row.mp4_master_url === job.processed_url && row.rendition_height === 1080 && row.width === 1080 && row.height === 1920, "probe facts not recorded");
  assert(row.name === "Summer launch" && row.kind === "video" && row.ai_generated === false, `name ${row.name}`);
  const second = await materializeAdCreativeFromJob(db.client, job, { probeTrustedVideoSources: probe(calls) as never });
  assert(second.ok && !second.created && second.creativeId === (first.ok ? first.creativeId : ""), "second call made a second row");
  assert(db.tables.ad_creatives.length === 1 && calls.length === 1, "materialize is not idempotent");
});

Deno.test("#3040 an untrusted source fails the job; a network error is retryable", async () => {
  const db = makeFakeDb(
    { ad_creatives: [], event_cover_video_jobs: [readyJob()] },
    { cover_video_transition_job: transitionJobHandler },
  );
  const untrusted = await materializeAdCreativeFromJob(db.client, readyJob(), {
    probeTrustedVideoSources: () => Promise.reject(new CreativeTrustError("creative_source_untrusted", 422, "no")),
  });
  assert(!untrusted.ok && !untrusted.retryable && untrusted.code === "creative_source_untrusted", JSON.stringify(untrusted));
  const stored = db.tables.event_cover_video_jobs[0];
  assert(stored.status === "failed" && stored.failure_code === "creative_source_untrusted", JSON.stringify(stored));
  const db2 = makeFakeDb({ ad_creatives: [], event_cover_video_jobs: [readyJob()] });
  const network = await materializeAdCreativeFromJob(db2.client, readyJob(), {
    probeTrustedVideoSources: () => Promise.reject(new CreativeTrustError("creative_source_unreachable", 422, "net")),
  });
  assert(!network.ok && network.retryable && network.code === "creative_materialize_pending", JSON.stringify(network));
  assert(db2.tables.ad_creatives.length === 0, "a failed probe wrote a row");
});

Deno.test("#3040 only a READY ad_creative job with media can be materialized", async () => {
  const db = makeFakeDb({ ad_creatives: [] });
  const notAd = await materializeAdCreativeFromJob(db.client, { ...readyJob(), target_kind: "venue_draft" });
  const notReady = await materializeAdCreativeFromJob(db.client, { ...readyJob(), status: "processing" });
  const noPoster = await materializeAdCreativeFromJob(db.client, { ...readyJob(), processed_poster_url: null });
  for (const result of [notAd, notReady, noPoster]) {
    assert(!result.ok && !result.retryable && result.code === "creative_job_not_materializable", JSON.stringify(result));
  }
});

Deno.test("#3040 provenance and naming follow the job", () => {
  assert(creativeSourceForJob({ id: "a", brand_id: null }) === "admin_upload", "house");
  assert(creativeSourceForJob({ id: "a", brand_id: "b", draft_owner_key: "ari:proposal-123" }) === "ari_upload", "ari");
  assert(creativeSourceForJob({ id: "a", brand_id: "b", draft_owner_key: "host-ad:draft-123" }) === "host_upload", "host");
  assert(creativeNameFromJob({ id: "a", source_file_name: null, created_at: "2026-10-19T10:00:00Z" }) === "Video 2026-10-19", "fallback name");
  assert(creativeNameFromJob({ id: "a", source_file_name: "x".repeat(200) + ".mp4" }).length === 120, "name not trimmed to 120");
});
