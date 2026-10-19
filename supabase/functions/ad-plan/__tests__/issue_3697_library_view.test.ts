// Issue #3697 — the Creative Library view through the real ad-plan handler:
// in-flight uploads, filters, the cursor, per-platform fit, archived and
// purged rows, and reuse that ignores fit.
// Invariant I-CREATIVE-ARCHIVE-NOT-DELETE (declared in supabase/migrations/__tests__/issue_3697_creative_library_lifecycle.implementor.pg17.test.sql)
// Invariant I-ADS-MISFIT-BLOCKED-IN-BUILDER (declared in mingla-admin/src/pages/__tests__/creativeLibraryFit.issue3697.test.js)
//
// FAILS ON REVERT: drop `.is("purged_at", null)` from applyLibraryFilters (a
// tombstone shows under Archived), drop the pending-jobs read in
// creative_library (in-flight uploads vanish), make `reusable` depend on fit,
// or add a fit check to creative_reuse.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleAdPlan } from "../index.ts";
import {
  ADMIN,
  adminTables,
  callAdPlan,
  FakeAdPlanDb,
  videoCreative,
} from "./fakeAdPlanDb.ts";

const ACTIVE = videoCreative();
const SNAP_MISFIT = videoCreative({
  id: "c0000000-0000-4000-8000-000000000002",
  name: "Lantern Room hero",
  width: 720,
  height: 1280,
  created_at: "2026-10-18T09:00:00.000Z",
});
const ARCHIVED = videoCreative({
  id: "c0000000-0000-4000-8000-000000000003",
  name: "Spring launch",
  status: "archived",
  archived_at: "2026-10-18T12:00:00.000Z",
  archived_by: ADMIN.id,
  created_at: "2026-10-17T09:00:00.000Z",
});
const TOMBSTONE = videoCreative({
  id: "c0000000-0000-4000-8000-000000000004",
  name: "Deleted teaser",
  status: "archived",
  archived_at: "2026-10-18T12:00:00.000Z",
  purged_at: "2026-10-18T13:00:00.000Z",
  created_at: "2026-10-16T09:00:00.000Z",
});
const HOST_IMAGE: Record<string, unknown> = {
  ...videoCreative({
    id: "c0000000-0000-4000-8000-000000000005",
    name: "Brunch still",
    kind: "image",
    source: "host_upload",
    brand_id: "e0000000-0000-4000-8000-000000000001",
    source_brand_id: "e0000000-0000-4000-8000-000000000001",
    created_at: "2026-10-15T09:00:00.000Z",
  }),
  bunny_video_id: null,
};

function libraryDb() {
  return new FakeAdPlanDb(
    adminTables({
      ad_creatives: [ACTIVE, SNAP_MISFIT, ARCHIVED, TOMBSTONE, HOST_IMAGE],
      event_cover_video_jobs: [
        {
          id: "j0000000-0000-4000-8000-000000000101",
          target_kind: "ad_creative",
          requested_by: ADMIN.id,
          brand_id: null,
          status: "source_uploading",
          source_file_name: "rooftop-teaser.mp4",
          source_bytes: 16_800_000,
          source_duration_ms: 15_000,
          client_operation_id: "op-1",
          created_at: "2026-10-19T08:00:00.000Z",
        },
        {
          id: "j0000000-0000-4000-8000-000000000102",
          target_kind: "ad_creative",
          requested_by: ADMIN.id,
          brand_id: null,
          status: "processing",
          source_file_name: "supper-club.mov",
          created_at: "2026-10-19T07:00:00.000Z",
        },
        // Already in the library: not shown twice.
        {
          id: ACTIVE.source_job_id,
          target_kind: "ad_creative",
          requested_by: ADMIN.id,
          brand_id: null,
          status: "ready",
          source_file_name: "house.mp4",
          created_at: "2026-10-18T09:59:00.000Z",
        },
        // Someone else's upload, and a finished one: not shown.
        {
          id: "j0000000-0000-4000-8000-000000000104",
          target_kind: "ad_creative",
          requested_by: "a0000000-0000-4000-8000-000000000009",
          brand_id: null,
          status: "processing",
          created_at: "2026-10-19T06:00:00.000Z",
        },
        {
          id: "j0000000-0000-4000-8000-000000000105",
          target_kind: "ad_creative",
          requested_by: ADMIN.id,
          brand_id: null,
          status: "failed",
          created_at: "2026-10-19T05:00:00.000Z",
        },
      ],
      profiles: [{ id: ADMIN.id, first_name: "Seth Ogieva", display_name: null }],
      brands: [{ id: "e0000000-0000-4000-8000-000000000001", name: "Gogi" }],
    }),
    {},
    { admin: ADMIN },
  );
}

type LibraryRow = Record<string, unknown> & { fit: { platform: string; fits: boolean; needs: string[] }[] };

Deno.test("#3697 in-flight uploads show as pending cards; a tombstone shows nowhere", async () => {
  const db = libraryDb();
  const active = await callAdPlan(handleAdPlan, db, "admin", { action: "creative_library" });
  assertEquals(active.status, 200);
  const pending = active.body.pending as Record<string, unknown>[];
  assertEquals(pending.map((item) => item.fileName), ["rooftop-teaser.mp4", "supper-club.mov"]);
  assertEquals(pending.map((item) => item.stageLabel), ["Uploading", "Preparing video"]);
  const ids = (active.body.creatives as LibraryRow[]).map((row) => row.id);
  assertEquals(ids, [ACTIVE.id, SNAP_MISFIT.id, HOST_IMAGE.id]);

  const archived = await callAdPlan(handleAdPlan, db, "admin", {
    action: "creative_library",
    status: "archived",
  });
  const archivedRows = archived.body.creatives as LibraryRow[];
  assertEquals(archivedRows.map((row) => row.id), [ARCHIVED.id]);
  assertEquals(archivedRows[0].reusable, false);
  assertEquals(archivedRows[0].archived_by_name, "Seth");
  assertEquals(archived.body.pending, []);
  const counts = active.body.counts as Record<string, number>;
  assertEquals(counts, { all: 3, images: 1, videos: 2, from_hosts: 1, archived: 1 });
  assertFalse(JSON.stringify(active.body).includes("do-not-return"));
});

Deno.test("#3697 fit is advice: a Snapchat misfit stays reusable from the library", async () => {
  const db = libraryDb();
  const library = await callAdPlan(handleAdPlan, db, "admin", { action: "creative_library", kind: "video" });
  const misfit = (library.body.creatives as LibraryRow[]).find((row) => row.id === SNAP_MISFIT.id)!;
  assertEquals(misfit.fit.map((tile) => tile.platform), ["meta", "tiktok", "google", "snapchat", "reddit"]);
  const snap = misfit.fit.find((tile) => tile.platform === "snapchat")!;
  assertEquals(snap.fits, false);
  assert(snap.needs.includes("1080×1920"));
  assertEquals(misfit.reusable, true);

  const reuse = await callAdPlan(handleAdPlan, db, "admin", {
    action: "creative_reuse",
    creative_id: SNAP_MISFIT.id,
    platforms: ["snapchat"],
  });
  assertEquals(reuse.status, 200);
  const validation = reuse.body.validation as { channels: { platform: string; ok: boolean }[] };
  assertEquals(validation.channels.map((channel) => channel.platform), ["snapchat"]);
  assertEquals(validation.channels[0].ok, false);
  assertEquals((reuse.body.creative as Record<string, unknown>).source_job_id, SNAP_MISFIT.source_job_id);
});

Deno.test("#3697 filters: source, search and the cursor", async () => {
  const db = libraryDb();
  const hosts = await callAdPlan(handleAdPlan, db, "admin", { action: "creative_library", source: "host" });
  assertEquals((hosts.body.creatives as LibraryRow[]).map((row) => row.id), [HOST_IMAGE.id]);
  assertEquals((hosts.body.creatives as LibraryRow[])[0].brand_name, "Gogi");
  assertEquals(hosts.body.pending, []);

  const search = await callAdPlan(handleAdPlan, db, "admin", { action: "creative_library", q: "lantern" });
  assertEquals((search.body.creatives as LibraryRow[]).map((row) => row.id), [SNAP_MISFIT.id]);
  assertEquals(search.body.pending, []);

  const page = await callAdPlan(handleAdPlan, db, "admin", {
    action: "creative_library",
    before: { created_at: ACTIVE.created_at, id: ACTIVE.id },
  });
  assertEquals((page.body.creatives as LibraryRow[]).map((row) => row.id), [SNAP_MISFIT.id, HOST_IMAGE.id]);
  assertEquals(page.body.pending, []);

  const bad = await callAdPlan(handleAdPlan, db, "admin", { action: "creative_library", status: "purged" });
  assertEquals(bad.status, 400);
});
