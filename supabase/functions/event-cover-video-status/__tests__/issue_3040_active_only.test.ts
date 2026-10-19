// Issue #3040 (E-10, A-3, A-6) — reopening a sheet asks only for in-flight work.
// MINGLA-INVARIANT: I-VIDEO-NO-RESURRECT | issue #3040 | opening a sheet never re-emits a finished, failed or cancelled job not started by this device
//
// FAILS ON REVERT: drop the activeOnly status filter and the applied video
// below is handed back to a client that has since chosen a photo.
import { handleEventCoverVideoStatus } from "../index.ts";
import { assert, makeFakeDb, type Row } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";

const EVENT = "3040eeee-eeee-4eee-8eee-eeeeeeee0001";
const BRAND = "3040eeee-eeee-4eee-8eee-eeeeeeee0002";
const USER = "3040eeee-eeee-4eee-8eee-eeeeeeee0003";

const status = async (rows: Row[], body: Record<string, unknown>, extra: Record<string, Row[]> = {}) => {
  const db = makeFakeDb({ event_cover_video_jobs: rows, ad_creatives: [], ...extra });
  const response = await handleEventCoverVideoStatus(
    new Request("https://test/status", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    {
      requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
      requireUserId: () => Promise.resolve(USER),
      serviceRoleClient: () => db.client,
    } as never,
  );
  return response;
};

const appliedVideo: Row = {
  id: "job-applied", status: "applied", target_kind: "event", event_id: EVENT, brand_id: BRAND,
  processed_url: "https://cdn.test/v/play_1080p.mp4", created_at: "2026-10-19T10:00:00Z",
  provider_payload: { rendition_height: 1080 },
};

Deno.test("#3040 activeOnly never hands back an applied, failed or cancelled job", async () => {
  const rows = [appliedVideo, { ...appliedVideo, id: "job-failed", status: "failed", created_at: "2026-10-19T09:00:00Z" }];
  const response = await status(rows, { target: "event", eventId: EVENT, brandId: BRAND, activeOnly: true });
  assert(response.status === 404, `a finished job resurfaced: ${response.status}`);
  const legacy = await status(rows, { target: "event", eventId: EVENT, brandId: BRAND });
  const payload = await legacy.json();
  assert(legacy.status === 200 && payload.jobId === "job-applied", "old clients lost the latest-job contract");
  assert(payload.renditionHeight === 1080, "renditionHeight missing");
});

Deno.test("#3040 activeOnly returns the in-flight job", async () => {
  const rows = [appliedVideo, { ...appliedVideo, id: "job-live", status: "processing", created_at: "2026-10-19T11:00:00Z" }];
  const response = await status(rows, { target: "event", eventId: EVENT, brandId: BRAND, activeOnly: true });
  const payload = await response.json();
  assert(response.status === 200 && payload.jobId === "job-live", JSON.stringify(payload));
});

Deno.test("#3040 a house ad upload is found by its owner key and reports its library row", async () => {
  const adJob: Row = {
    id: "job-ad", status: "applied", target_kind: "ad_creative", event_id: null, brand_id: null,
    draft_owner_key: `admin-library:${USER}`, requested_by: USER, created_at: "2026-10-19T12:00:00Z",
  };
  const otherAdmin: Row = { ...adJob, id: "job-other", requested_by: "someone-else", created_at: "2026-10-19T13:00:00Z" };
  const response = await status([adJob, otherAdmin], {
    target: "ad_creative", brandId: null, draftOwnerKey: `admin-library:${USER}`,
  }, { ad_creatives: [{ id: "creative-1", source_job_id: "job-ad" }] });
  const payload = await response.json();
  assert(response.status === 200 && payload.jobId === "job-ad", JSON.stringify(payload));
  assert(payload.creativeId === "creative-1" && payload.targetKind === "ad_creative" && payload.brandId === null, JSON.stringify(payload));
});
