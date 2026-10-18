import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("ad-plan derives both Host and Admin currency on the server", () => {
  assertStringIncludes(source, "resolveAdBrandCurrency(db, plan.brand_id)");
  assertStringIncludes(source, '.from("ad_connections")');
  assertStringIncludes(source, "admin_currency_split_required");
  assert(!source.includes("body.currency"));
  assert(!source.includes('?? "USD"'));
  assert(!source.includes('|| "USD"'));
});

Deno.test("ad-plan freezes provider targeting and never creates provider objects", () => {
  assertStringIncludes(source, "compileTargetingPlan");
  assertStringIncludes(source, 'action === "freeze_targeting"');
  assertStringIncludes(source, 'from("ad_plan_targeting_snapshots")');
  assert(!source.includes("getAdapter("));
  assert(!source.includes("createFullCampaignAtomic"));
});

Deno.test("every money and launch mutation binds the version hash", () => {
  assertStringIncludes(source, "plan_version_hash_mismatch");
  for (
    const action of [
      "mark_ready",
      "fund",
      "review",
      "confirm_launch",
      "cancel_before_create",
      "assert_launchable",
      "request_stop",
    ]
  ) {
    assertStringIncludes(source, `action === "${action}"`);
  }
});

Deno.test("pre-create cancellation requires an exact phrase and audit reason", () => {
  assertStringIncludes(source, 'phrase !== "CANCEL PLAN"');
  assertStringIncludes(source, "confirm_phrase_must_be_CANCEL_PLAN");
  assertStringIncludes(source, 'detail: "reason_required"');
  assertStringIncludes(source, "p_reason: reason.slice(0, 1000)");
});
