// Issue #3697 — archive and the guarded permanent delete, through the real
// ad-plan handler.
// Invariant I-CREATIVE-ARCHIVE-NOT-DELETE (declared in supabase/migrations/__tests__/issue_3697_creative_library_lifecycle.implementor.pg17.test.sql)
//
// Proves: an archived creative is refused for a NEW selection (409) but a plan
// whose current version already carries it can freeze a new version; a purged
// creative is refused (410); a delete with any blocker never destroys media;
// a clear delete destroys, then records the tombstone with the checked time;
// a destroy failure changes nothing; only an Admin may delete; the typed
// DELETE phrase is required.
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

Deno.test("#3697 a delete with any blocker never destroys the media", async () => {
  for (const blocker of ["platform_ref", "campaign", "live_surface", "duplicate_creative"]) {
    const { db, recorded } = lifecycleDb(ARCHIVED, [blocker]);
    const destroyed: string[] = [];
    const result = await callAdPlan(handleAdPlan, db, "admin", {
      action: "creative_purge",
      creative_id: ARCHIVED.id,
      confirm_phrase: "DELETE",
    }, { destroyVideo: (guid: string) => { destroyed.push(guid); return Promise.resolve({ ok: true }); } });
    assertEquals(result.status, 409, blocker);
    assertEquals(result.body.error, "creative_in_use");
    assertEquals(result.body.blockers, [blocker]);
    assertEquals(destroyed, [], blocker);
    assertEquals(recorded, [], blocker);
  }
});

Deno.test("#3697 a clear delete destroys the media, then records the tombstone", async () => {
  const { db, recorded } = lifecycleDb(ARCHIVED, []);
  const order: string[] = [];
  const result = await callAdPlan(handleAdPlan, db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, {
    destroyVideo: (guid: string) => {
      order.push(`destroy:${guid}`);
      return Promise.resolve({ ok: true });
    },
  });
  assertEquals(result.status, 200);
  assertEquals(order, ["destroy:guid-house-0001"]);
  assertEquals(recorded.length, 1);
  assertEquals(recorded[0].p_creative_id, ARCHIVED.id);
  assertEquals(recorded[0].p_admin_email, ADMIN.email);
  assertEquals(typeof recorded[0].p_blockers_checked_at, "string");
  const rpcOrder = db.rpcCalls.map((call) => call.name);
  assertEquals(rpcOrder, ["ad_creative_purge_blockers", "ad_creative_record_purge"]);
});

Deno.test("#3697 a failed destroy changes nothing; phrase and Admin role are required", async () => {
  const failed = lifecycleDb(ARCHIVED, []);
  const result = await callAdPlan(handleAdPlan, failed.db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, { destroyVideo: () => Promise.resolve({ ok: false, reason: "bunny_delete_http_500" }) });
  assertEquals(result.status, 502);
  assertEquals(failed.recorded, []);

  const noPhrase = lifecycleDb(ARCHIVED, []);
  const unphrased = await callAdPlan(handleAdPlan, noPhrase.db, "admin", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
  }, { destroyVideo: () => Promise.resolve({ ok: true }) });
  assertEquals(unphrased.status, 400);
  assertEquals(noPhrase.recorded, []);

  const notAdmin = lifecycleDb(ARCHIVED, []);
  const host = await callAdPlan(handleAdPlan, notAdmin.db, "host", {
    action: "creative_purge",
    creative_id: ARCHIVED.id,
    confirm_phrase: "DELETE",
  }, { destroyVideo: () => Promise.resolve({ ok: true }) });
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
