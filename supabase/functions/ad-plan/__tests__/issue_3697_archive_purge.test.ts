// Issue #3697 — archive and the guarded permanent delete, through the real
// ad-plan handler.
// Invariant I-CREATIVE-ARCHIVE-NOT-DELETE (declared in supabase/migrations/__tests__/issue_3697_creative_library_lifecycle.implementor.pg17.test.sql)
//
// Proves: an archived creative is refused for a NEW selection (409) but a plan
// whose current version already carries it can freeze a new version; a purged
// creative is refused (410); a delete with any blocker never destroys media;
// a clear delete records the tombstone (the database re-checks under the row
// lock), then destroys the file through the one guarded provider delete,
// which re-reads live references and stamps the source job; a destroy
// failure is reported and retryable on the tombstone; only an Admin may
// delete; the typed DELETE phrase is required.
//
// FAILS ON REVERT: drop the creativeSelectionError call in creative_reuse or
// create_version, or drop the blocker / phrase checks in
// handleCreativeLifecycleAction (_shared/adCreativeLifecycle.ts).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleAdPlan } from "../index.ts";
import {
  ADMIN,
  adminTables,
  callAdPlan,
  FakeAdPlanDb,
  HOST,
  videoCreative,
} from "./fakeAdPlanDb.ts";

const ARCHIVED = videoCreative({
  status: "archived",
  archived_at: "2026-10-18T11:00:00.000Z",
  archived_by: ADMIN.id,
});
const PLAN_ID = "b0000000-0000-4000-8000-000000000011";
const VERSION_ID = "b0000000-0000-4000-8000-000000000012";

function lifecycleDb(
  creative: Record<string, unknown>,
  blockers: string[] = [],
  extraTables: Record<string, Record<string, unknown>[]> = {},
) {
  const recorded: Record<string, unknown>[] = [];
  const db = new FakeAdPlanDb(
    adminTables({ ad_creatives: [creative], ...extraTables }),
    {
      ad_creative_purge_blockers: () => ({ data: blockers }),
      ad_creative_record_purge: (args) => {
        recorded.push(args);
        return { data: { ...creative, purged_at: "2026-10-19T00:00:00.000Z" } };
      },
      ad_creative_set_archived: (args) => ({
        data: {
          ...creative,
          status: args.p_archived ? "archived" : "active",
          archived_at: args.p_archived ? "2026-10-19T00:00:00.000Z" : null,
        },
      }),
      ad_can_host_action: () => ({ data: false }),
    },
    { admin: ADMIN, host: HOST },
  );
  return { db, recorded };
}

Deno.test("#3697 an archived creative is refused for a new selection, a purged one is gone", async () => {
  const archived = lifecycleDb(ARCHIVED);
  const reuse = await callAdPlan(handleAdPlan, archived.db, "admin", {
    action: "creative_reuse",
    creative_id: ARCHIVED.id,
  });
  assertEquals(reuse.status, 409);
  assertEquals(reuse.body.error, "creative_archived");

  const purged = lifecycleDb({ ...ARCHIVED, purged_at: "2026-10-19T00:00:00.000Z" });
  const gone = await callAdPlan(handleAdPlan, purged.db, "admin", {
    action: "creative_reuse",
    creative_id: ARCHIVED.id,
  });
  assertEquals(gone.status, 410);
  assertEquals(gone.body.error, "creative_purged");
});

Deno.test("#3697 a plan already frozen with an archived creative can freeze its next version", async () => {
  const base = {
    action: "create_version",
    plan_id: PLAN_ID,
    canonical_plan: {
      creative_library_id: ARCHIVED.id,
      media_rights: { rights_confirmed: true, rights_basis: "owned", ai_generated: false },
    },
    provider_allocations: [{
      platform: "meta",
      connection_id: "d0000000-0000-4000-8000-000000000001",
      host_budget_cents: 1000,
      host_delivery_budget_cents: 1000,
    }],
  };
  const plan = {
    id: PLAN_ID,
    owner_kind: "mingla",
    client_kind: "admin",
    brand_id: null,
    state: "draft",
    current_version_id: null as string | null,
  };
  // A new plan choosing the archived creative is refused.
  const fresh = lifecycleDb(ARCHIVED, [], { ad_plans: [{ ...plan }] });
  const refused = await callAdPlan(handleAdPlan, fresh.db, "admin", base);
  assertEquals(refused.status, 422);
  assertEquals(refused.body.detail, "creative_archived");

  // The plan whose current version already carries it passes the creative
  // check (it then continues to the allocation step, which this fake stops).
  const frozen = lifecycleDb(ARCHIVED, [], {
    ad_plans: [{ ...plan, current_version_id: VERSION_ID }],
    ad_plan_versions: [{
      id: VERSION_ID,
      plan_id: PLAN_ID,
      plan_hash: "e".repeat(64),
      canonical_plan: { creative_library_id: ARCHIVED.id },
    }],
  });
  const carried = await callAdPlan(handleAdPlan, frozen.db, "admin", base);
  assertEquals(carried.body.detail === "creative_archived", false);
  assertEquals(carried.body.detail === "creative_not_reusable", false);
});

function destroyer(result: { ok: true } | { ok: false; reason: string } = { ok: true }) {
  const destroyed: string[] = [];
  return {
    destroyed,
    reapDeps: {
      destroyCoverVideoAsset: (row: { source_asset_id?: unknown }) => {
        destroyed.push(String(row.source_asset_id));
        return Promise.resolve(result);
      },
    },
  };
}

Deno.test("#3697 a delete with any blocker never destroys the media", async () => {
  for (const blocker of ["platform_ref", "campaign", "live_surface", "duplicate_creative"]) {
    const { db, recorded } = lifecycleDb(ARCHIVED, [blocker]);
    const media = destroyer();
    const result = await callAdPlan(handleAdPlan, db, "admin", {
      action: "creative_purge",
      creative_id: ARCHIVED.id,
      confirm_phrase: "DELETE",
    }, { reapDeps: media.reapDeps });
    assertEquals(result.status, 409, blocker);
    assertEquals(result.body.error, "creative_in_use");
    assertEquals(result.body.blockers, [blocker]);
    assertEquals(media.destroyed, [], blocker);
    assertEquals(recorded, [], blocker);
  }
});

Deno.test("#3697 a race the database catches under the row lock never destroys the media", async () => {
  const { db } = lifecycleDb(ARCHIVED, []);
  db.rpcs.ad_creative_record_purge = () => ({
    error: { code: "55000", message: "ad_creative_purge_blocked:plan_version,campaign" },
  });
  const media = destroyer();
  const result = await callAdPlan(handleAdPlan, db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, { reapDeps: media.reapDeps });
  assertEquals(result.status, 409);
  assertEquals(result.body.blockers, ["plan_version", "campaign"]);
  assertEquals(media.destroyed, []);
});

Deno.test("#3697 a clear delete tombstones, then destroys through the guarded delete", async () => {
  const { db, recorded } = lifecycleDb(ARCHIVED, [], {
    event_cover_video_jobs: [{ id: ARCHIVED.source_job_id, reaped_at: null }],
  });
  db.rpcs.cover_video_guid_live_references = () => ({ data: [] });
  const media = destroyer();
  const result = await callAdPlan(handleAdPlan, db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, { reapDeps: media.reapDeps });
  assertEquals(result.status, 200);
  assertEquals(result.body.media_deleted, true);
  assertEquals(media.destroyed, ["guid-house-0001"]);
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0].p_admin_email, ADMIN.email);
  assertEquals(typeof recorded[0].p_blockers_checked_at, "string");
  assertEquals(db.rpcCalls.map((call) => call.name), [
    "ad_creative_purge_blockers",
    "ad_creative_record_purge",
    "cover_video_guid_live_references",
  ]);
  // The guard excludes the creative's own source job and stamps it reaped.
  assertEquals(db.rpcCalls[2].args, { p_guid: "guid-house-0001", p_exclude_job_id: ARCHIVED.source_job_id });
  assertEquals(db.updates.map((update) => update.table), ["event_cover_video_jobs"]);
});

Deno.test("#3697 the guard refuses a file something still serves; a retry on the tombstone only retries the delete", async () => {
  const { db, recorded } = lifecycleDb(ARCHIVED, []);
  db.rpcs.cover_video_guid_live_references = () => ({ data: ["brand_cover"] });
  const media = destroyer();
  const refused = await callAdPlan(handleAdPlan, db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, { reapDeps: media.reapDeps });
  assertEquals(refused.status, 502);
  assertEquals(refused.body.error, "media_delete_failed");
  assertEquals(refused.body.removed_from_library, true);
  assertEquals(media.destroyed, []);

  const tombstone = lifecycleDb({ ...ARCHIVED, purged_at: "2026-10-19T00:00:00.000Z" }, ["already_purged"]);
  tombstone.db.rpcs.cover_video_guid_live_references = () => ({ data: [] });
  const retried = await callAdPlan(handleAdPlan, tombstone.db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, { reapDeps: media.reapDeps });
  assertEquals(retried.status, 200);
  assertEquals(media.destroyed, ["guid-house-0001"]);
  assertEquals(tombstone.recorded, []);
  assertEquals(recorded.length, 1);
});

Deno.test("#3697 a provider failure is reported; phrase and Admin role are required", async () => {
  const failed = lifecycleDb(ARCHIVED, []);
  failed.db.rpcs.cover_video_guid_live_references = () => ({ data: [] });
  const result = await callAdPlan(handleAdPlan, failed.db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, { reapDeps: destroyer({ ok: false, reason: "bunny_delete_http_500" }).reapDeps });
  assertEquals(result.status, 502);
  assertEquals(result.body.detail, "bunny_delete_http_500");

  const noPhrase = lifecycleDb(ARCHIVED, []);
  const unphrased = await callAdPlan(handleAdPlan, noPhrase.db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
  }, { reapDeps: destroyer().reapDeps });
  assertEquals(unphrased.status, 400);
  assertEquals(noPhrase.recorded, []);

  const notAdmin = lifecycleDb(ARCHIVED, []);
  const host = await callAdPlan(handleAdPlan, notAdmin.db, "host", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, { reapDeps: destroyer().reapDeps });
  assertEquals(host.status, 403);
  assertEquals(notAdmin.recorded, []);
});

Deno.test("#3697 archive: house media by an Admin, brand media only by its planners", async () => {
  const house = lifecycleDb(videoCreative());
  const archived = await callAdPlan(handleAdPlan, house.db, "admin", {
    action: "creative_archive",
    creative_id: videoCreative().id,
  });
  assertEquals(archived.status, 200);
  assertEquals((archived.body.creative as Record<string, unknown>).status, "archived");
  assertEquals(house.db.rpcCalls.at(-1)?.args.p_actor, ADMIN.id);

  const brandOwned = lifecycleDb(videoCreative({
    brand_id: "e0000000-0000-4000-8000-000000000001",
    source: "host_upload",
    source_brand_id: "e0000000-0000-4000-8000-000000000001",
  }));
  const refused = await callAdPlan(handleAdPlan, brandOwned.db, "admin", {
    action: "creative_archive",
    creative_id: videoCreative().id,
  });
  assertEquals(refused.status, 403);
  assertEquals(
    brandOwned.db.rpcCalls.some((call) => call.name === "ad_creative_set_archived"),
    false,
  );
});
