// Issue #3040 (T-B8, B-8) — an unreadable provider HEAD after the TUS lease is
// not proof of anything: the upload is asked about again, and is called
// unverifiable only once the 30-minute grace is over.
// MINGLA-INVARIANT: I-VIDEO-READY-HAS-OWNER | issue #3040 | an unreadable provider HEAD never fails a transfer inside its bound
//
// FAILS ON REVERT: let the expiry branch run for `unreadable` again and the
// first test fails the job with source_transport_expired.
import { handleEventCoverVideoSourceUploaded } from "./index.ts";
import {
  assert,
  isoAgo,
  makeFakeDb,
  transitionJobHandler,
} from "../_shared/__tests__/issue3040_fakeSupabase.ts";

const JOB = "3040bbbb-bbbb-4bbb-8bbb-bbbbbbbb0001";
const job = (tusExpiresAt: string) => ({
  id: JOB,
  status: "source_uploading",
  target_kind: "event",
  event_id: "3040bbbb-bbbb-4bbb-8bbb-bbbbbbbb0002",
  brand_id: "3040bbbb-bbbb-4bbb-8bbb-bbbbbbbb0003",
  requested_by: "user-1",
  source_bytes: 6_000_000,
  source_asset_id: "guid-b8-3040",
  tus_resource_url: "https://video.bunnycdn.com/tusupload/r",
  tus_expires_at: tusExpiresAt,
  provider_payload: {},
});

const run = async (row: Record<string, unknown>, head: () => Promise<Response>) => {
  const db = makeFakeDb({ event_cover_video_jobs: [row] }, { cover_video_transition_job: transitionJobHandler });
  const response = await handleEventCoverVideoSourceUploaded(
    new Request("https://test/source-uploaded", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: JOB }),
    }),
    {
      bunnyPresignTusUpload: (videoId: string) =>
        Promise.resolve({ tusEndpoint: "https://t", libraryId: "l", videoId, authorizationSignature: "s", authorizationExpire: 1 }),
      requireUserId: () => Promise.resolve("user-1"),
      requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
      requireBrandCoverManager: () => Promise.resolve({ brandId: "b" }),
      requireEventManager: () => Promise.resolve({ event: {} }),
      serviceRoleClient: () => db.client,
      fetchImpl: head,
    } as never,
  );
  return { response, row: db.tables.event_cover_video_jobs[0] };
};

const serverError = () => Promise.resolve(new Response(null, { status: 502 }));

Deno.test("#3040 lease expired + HEAD unreadable inside the grace → 202, never failed", async () => {
  const { response, row } = await run(job(isoAgo(5 * 60_000)), serverError);
  const payload = await response.json();
  assert(response.status === 202, `got ${response.status}`);
  assert(payload.status === "source_uploading" && payload.retryAfterMs === 5_000, JSON.stringify(payload));
  assert(row.status === "source_uploading" && row.failure_code === undefined, `job moved to ${row.status}`);
});

Deno.test("#3040 lease expired + HEAD unreadable past the grace → source_unverifiable", async () => {
  const { row } = await run(job(isoAgo(31 * 60_000)), serverError);
  assert(row.status === "failed" && row.failure_code === "source_unverifiable", `${row.status}/${row.failure_code}`);
});

Deno.test("#3040 lease expired + HEAD proves an incomplete transfer → still expired at once", async () => {
  const partial = () =>
    Promise.resolve(new Response(null, { status: 200, headers: { "upload-offset": "512", "upload-length": "6000000" } }));
  const { row } = await run(job(isoAgo(60_000)), partial);
  assert(row.status === "failed" && row.failure_code === "source_transport_expired", `${row.status}/${row.failure_code}`);
});
