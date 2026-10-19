// Issue #3697 — the server fit gate. FG-1 (ad-plan mark_ready / fund) and
// FG-2 (admin-ad-creative-prepare start / retry) refuse a video that does not
// fit an allocated platform, judged by the one channel matrix.
// MINGLA-INVARIANT: I-ADS-FIT-BEFORE-FUNDING | issue #3697 | no plan reaches funding and no provider prepare starts for a video that fails an allocated platform's fit check
// Invariant I-ADS-FIT-ONE-MATRIX (declared in supabase/functions/_shared/__tests__/adCreativeFit.issue3040.test.ts)
//
// FAILS ON REVERT: delete the `fundingFitGate` call before mark_ready / fund in
// ad-plan/index.ts (the misfit plans reach ad_plan_mark_ready), or delete the
// FG-2 block in admin-ad-creative-prepare/index.ts (its source assertion).
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleAdPlan } from "../index.ts";
import { creativeFitGateFailure } from "../../_shared/adCreativeLifecycle.ts";
import {
  ADMIN,
  adminTables,
  callAdPlan,
  FakeAdPlanDb,
  videoCreative,
} from "./fakeAdPlanDb.ts";

const PLAN_ID = "b0000000-0000-4000-8000-000000000001";
const VERSION_ID = "b0000000-0000-4000-8000-000000000002";
const HASH = "f".repeat(64);

function planDb(creative: Record<string, unknown>, platforms: string[]) {
  const marked: string[] = [];
  const db = new FakeAdPlanDb(
    adminTables({
      ad_creatives: [creative],
      ad_plans: [{
        id: PLAN_ID,
        owner_kind: "mingla",
        client_kind: "admin",
        brand_id: null,
        state: "validating",
        current_version_id: VERSION_ID,
      }],
      ad_plan_versions: [{
        id: VERSION_ID,
        plan_id: PLAN_ID,
        plan_hash: HASH,
        canonical_plan: { creative_library_id: creative.id },
      }],
      ad_plan_provider_allocations: platforms.map((platform) => ({
        plan_version_id: VERSION_ID,
        platform,
      })),
    }),
    {
      ad_plan_mark_ready: () => {
        marked.push("mark_ready");
        return { data: { id: PLAN_ID, state: "ready_for_funding" } };
      },
      ad_plan_mark_admin_funded: () => {
        marked.push("fund");
        return { data: { ok: true } };
      },
    },
    { admin: ADMIN },
  );
  return { db, marked };
}

Deno.test("#3697 FG-1: a 720×1280 video cannot reach funding on Snapchat", async () => {
  const { db, marked } = planDb(
    videoCreative({ width: 720, height: 1280, rendition_height: 720 }),
    ["meta", "snapchat"],
  );
  const result = await callAdPlan(handleAdPlan, db, "admin", {
    action: "mark_ready",
    plan_version_id: VERSION_ID,
    plan_hash: HASH,
  });
  assertEquals(result.status, 422);
  assertEquals(result.body.error, "creative_does_not_fit");
  assertEquals(result.body.platform, "snapchat");
  assert((result.body.reasons as string[]).includes("1080×1920"));
  assertEquals(marked, []);
});

Deno.test("#3697 FG-1: a legacy 4 s video is refused for Meta, at mark_ready and at fund", async () => {
  for (const action of ["mark_ready", "fund"]) {
    const { db, marked } = planDb(videoCreative({ duration_seconds: 4 }), ["meta"]);
    const result = await callAdPlan(handleAdPlan, db, "admin", {
      action,
      plan_version_id: VERSION_ID,
      plan_hash: HASH,
    });
    assertEquals(result.status, 422, action);
    assertEquals(result.body.platform, "meta");
    assertEquals(marked, [], action);
  }
});

Deno.test("#3697 FG-1: a video that fits every allocated platform proceeds", async () => {
  const { db, marked } = planDb(videoCreative(), ["meta", "tiktok", "snapchat"]);
  const result = await callAdPlan(handleAdPlan, db, "admin", {
    action: "mark_ready",
    plan_version_id: VERSION_ID,
    plan_hash: HASH,
  });
  assertEquals(result.status, 200);
  assertEquals(marked, ["mark_ready"]);
});

Deno.test("#3697 FG-1: a purged creative never reaches funding", async () => {
  const { db, marked } = planDb(
    videoCreative({ status: "archived", archived_at: "2026-10-18T11:00:00Z", purged_at: "2026-10-18T12:00:00Z" }),
    ["meta"],
  );
  const result = await callAdPlan(handleAdPlan, db, "admin", {
    action: "mark_ready",
    plan_version_id: VERSION_ID,
    plan_hash: HASH,
  });
  assertEquals(result.status, 409);
  assertEquals(result.body.error, "creative_purged");
  assertEquals(marked, []);
});

Deno.test("#3697 FG-1 judges videos only; images keep proceed-with-passing", () => {
  assertEquals(
    creativeFitGateFailure({ kind: "image", width: 100, height: 100 }, ["snapchat"]),
    null,
  );
  const failure = creativeFitGateFailure(
    videoCreative({ width: 1280, height: 720, aspect_ratio: 16 / 9 }),
    ["meta", "snapchat"],
  );
  assertEquals(failure?.platform, "snapchat");
});

Deno.test("#3697 FG-2: provider prepare refuses a misfit before it begins, and accepts archived", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  const gate = source.indexOf("creativeFitGateFailure(");
  const begin = source.indexOf('"ad_creative_prepare_begin"');
  assert(gate > 0 && begin > gate, "the fit gate must run before prepare begins");
  assertStringIncludes(source, 'error: "creative_does_not_fit"');
  assertStringIncludes(source, '["active", "archived"].includes(String(creative.status))');
  assertStringIncludes(source, 'error: "creative_purged"');
});
