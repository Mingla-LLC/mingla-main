// Issue #4114 Wave 7 (D18) — the media sweep deletes the full file of an
// ordinary chat video after 90 days, keeps its thumbnail, and marks the message
// media_expired_at (never view_once_purged_at).
//
// Drives the real sweep with fakes for the listing, the deleter and the marks:
//   * a "video_retention" row: the video's full file is removed, its message is
//     marked expired, and it is NOT marked view-once purged;
//   * view-once rows are still marked purged, and only they;
//   * a thumbnail is never removed as a retention row (only an orphaned one is);
//   * a failed expiry mark fails the sweep (500) instead of reporting success.
//
// FAILS-ON-REVERT: route every message id to markPurged again (delete the
// MEDIA_EXPIRY_REASONS split) and the first test fails; drop the `once === false`
// retention filter and the thumbnail test fails.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createOpenViewOnceHandler, type DueRow, type OpenViewOnceDeps } from "../handler.ts";

const CONV = "11111111-1111-4111-8111-111111111111";
const VIDEO_MSG = "22222222-2222-4222-8222-222222222222";
const ONCE_MSG = "33333333-3333-4333-8333-333333333333";
const VIDEO_OBJ = "44444444-4444-4444-8444-444444444444";
const ONCE_OBJ = "55555555-5555-4555-8555-555555555555";
const STRAY = "66666666-6666-4666-8666-666666666666";

interface Seen {
  removed: string[];
  purged: string[];
  expired: string[];
}

function deps(due: DueRow[], seen: Seen, failExpiry = false): OpenViewOnceDeps {
  return {
    userIdFor: async () => null,
    isCronCaller: async (authorization) => authorization === "Bearer service-role",
    loadMessage: async () => ({ data: null, error: null }),
    isParticipant: async () => ({ data: false, error: null }),
    signUrl: async () => ({ data: null, error: "unused" }),
    recordView: async () => ({ data: { inserted: false, viewedAt: null }, error: null }),
    listDue: async () => ({ data: due, error: null }),
    removeObjects: async (paths) => {
      seen.removed.push(...paths);
      return { error: null };
    },
    markPurged: async (ids) => {
      seen.purged.push(...ids);
      return { error: null };
    },
    markExpired: async (ids) => {
      if (failExpiry) return { error: "boom" };
      seen.expired.push(...ids);
      return { error: null };
    },
  };
}

function sweepRequest(): Request {
  return new Request("http://local/open-view-once", {
    method: "POST",
    headers: { Authorization: "Bearer service-role", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sweep" }),
  });
}

Deno.test("#4114 W7: a 90-day video is deleted and marked expired, never purged", async () => {
  const seen: Seen = { removed: [], purged: [], expired: [] };
  const due: DueRow[] = [
    { message_id: VIDEO_MSG, storage_path: `${CONV}/${VIDEO_OBJ}.mp4`, reason: "video_retention" },
    { message_id: ONCE_MSG, storage_path: `${CONV}/once/${ONCE_OBJ}.jpg`, reason: "opened" },
  ];
  const response = await createOpenViewOnceHandler(deps(due, seen))(sweepRequest());
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(seen.removed.sort(), [`${CONV}/${VIDEO_OBJ}.mp4`, `${CONV}/once/${ONCE_OBJ}.jpg`].sort());
  assertEquals(seen.expired, [VIDEO_MSG]);
  assertEquals(seen.purged, [ONCE_MSG]);
  assertEquals(body.expired, 1);
  assertEquals(body.purged, 1);
  // The video's thumbnail is a different object and is never touched.
  assertEquals(seen.removed.includes(`${CONV}/${VIDEO_OBJ}_thumb.jpg`), false);
});

Deno.test("#4114 W7: a thumbnail is never deleted as a retention row; an orphaned one is", async () => {
  const seen: Seen = { removed: [], purged: [], expired: [] };
  const due: DueRow[] = [
    { message_id: VIDEO_MSG, storage_path: `${CONV}/${VIDEO_OBJ}_thumb.jpg`, reason: "video_retention" },
    { message_id: VIDEO_MSG, storage_path: `${CONV}/once/${VIDEO_OBJ}.mp4`, reason: "video_retention" },
    { message_id: null, storage_path: `${CONV}/${STRAY}_thumb.jpg`, reason: "orphan" },
    { message_id: null, storage_path: `${CONV}/once/${STRAY}_thumb.jpg`, reason: "orphan" },
  ];
  const response = await createOpenViewOnceHandler(deps(due, seen))(sweepRequest());
  assertEquals(response.status, 200);
  assertEquals(seen.removed, [`${CONV}/${STRAY}_thumb.jpg`]);
  assertEquals(seen.expired, []);
  assertEquals(seen.purged, []);
});

Deno.test("#4114 W7: a failed expiry mark fails the sweep", async () => {
  const seen: Seen = { removed: [], purged: [], expired: [] };
  const due: DueRow[] = [
    { message_id: VIDEO_MSG, storage_path: `${CONV}/${VIDEO_OBJ}.mp4`, reason: "video_retention" },
  ];
  const response = await createOpenViewOnceHandler(deps(due, seen, true))(sweepRequest());
  assertEquals(response.status, 500);
  assertEquals((await response.json()).error, "sweep_mark_failed");
});
