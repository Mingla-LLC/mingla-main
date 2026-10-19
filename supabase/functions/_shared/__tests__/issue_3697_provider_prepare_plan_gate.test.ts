/** Issue #3697 v1.4 — provider-native media never precedes plan approval. */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type CreativePreparationBinding,
  creativePreparationBindingError,
} from "../adCreativePreparationPlan.ts";
import { adCreativeOwnershipError } from "../adCreativeOwnership.ts";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const CREATIVE_ID = "33333333-3333-4333-8333-333333333333";
const BRAND_ID = "44444444-4444-4444-8444-444444444444";
const CONNECTION_ID = "55555555-5555-4555-8555-555555555555";
const HASH = "a".repeat(64);

function binding(
  patch: Partial<CreativePreparationBinding> = {},
): CreativePreparationBinding {
  return {
    plan: {
      id: PLAN_ID,
      owner_kind: "host",
      brand_id: BRAND_ID,
      current_version_id: VERSION_ID,
      state: "creating_paused_objects",
    },
    version: {
      id: VERSION_ID,
      plan_id: PLAN_ID,
      plan_hash: HASH,
      canonical_plan: { creative_library_id: CREATIVE_ID },
    },
    allocation: { platform: "meta", connection_id: CONNECTION_ID },
    connection: { id: CONNECTION_ID },
    confirmationPresent: true,
    requestedPlanVersionId: VERSION_ID,
    requestedPlanHash: HASH,
    requestedCreativeId: CREATIVE_ID,
    requestedPlatform: "meta",
    requestedLane: "business",
    requestedBrandId: BRAND_ID,
    ...patch,
  };
}

Deno.test("#3697 provider preparation accepts only the exact confirmed binding", () => {
  assertEquals(creativePreparationBindingError(binding()), null);
  assertEquals(
    creativePreparationBindingError(binding({
      plan: { ...binding().plan!, state: "funded_held" },
    })),
    "plan_not_launch_confirmed",
  );
  assertEquals(
    creativePreparationBindingError(binding({ confirmationPresent: false })),
    "plan_confirmation_missing",
  );
  assertEquals(
    creativePreparationBindingError(binding({
      requestedCreativeId: "66666666-6666-4666-8666-666666666666",
    })),
    "plan_creative_mismatch",
  );
  assertEquals(
    creativePreparationBindingError(binding({ requestedPlatform: "google" })),
    "plan_platform_not_allocated",
  );
  assertEquals(
    creativePreparationBindingError(binding({
      connection: { id: "77777777-7777-4777-8777-777777777777" },
    })),
    "plan_connection_mismatch",
  );
  assertEquals(
    creativePreparationBindingError(
      binding({ requestedPlanHash: "b".repeat(64) }),
    ),
    "plan_version_hash_mismatch",
  );
  assertEquals(
    creativePreparationBindingError(binding({
      plan: {
        ...binding().plan!,
        current_version_id: "88888888-8888-4888-8888-888888888888",
      },
    })),
    "plan_version_stale",
  );
});

Deno.test("#3697 provider preparation enforces owner lane and brand", () => {
  assertEquals(
    creativePreparationBindingError(binding({ requestedLane: "consumer" })),
    "plan_lane_mismatch",
  );
  assertEquals(
    creativePreparationBindingError(binding({ requestedBrandId: PLAN_ID })),
    "plan_brand_mismatch",
  );
  assertEquals(
    creativePreparationBindingError(binding({
      plan: {
        ...binding().plan!,
        owner_kind: "mingla",
        brand_id: null,
      },
      requestedLane: "consumer",
      requestedBrandId: "",
    })),
    null,
  );
});

Deno.test("#3697 Host media cannot cross a brand or enter a house plan", () => {
  assertEquals(
    adCreativeOwnershipError({
      ownerKind: "host",
      planBrandId: BRAND_ID,
      creativeBrandId: BRAND_ID,
    }),
    null,
  );
  assertEquals(
    adCreativeOwnershipError({
      ownerKind: "host",
      planBrandId: BRAND_ID,
      creativeBrandId: PLAN_ID,
    }),
    "creative_brand_mismatch",
  );
  assertEquals(
    adCreativeOwnershipError({
      ownerKind: "mingla",
      planBrandId: null,
      creativeBrandId: BRAND_ID,
    }),
    "host_media_reuse_not_approved",
  );
  assertEquals(
    adCreativeOwnershipError({
      ownerKind: "mingla",
      planBrandId: null,
      creativeBrandId: null,
      // #3040/#3697 — house media is decided by provenance, not a null brand.
      creativeSource: "admin_upload",
    }),
    null,
  );
});

Deno.test("#3697 edge checks the plan before provider preparation begins", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  assertStringIncludes(source, 'p_action: "launch"');
  assertEquals(source.includes("biz_can_manage_payments_for_brand"), false);
  assertStringIncludes(
    source,
    "plan_version_and_hash_required_before_provider_prepare",
  );
  assertStringIncludes(source, '.eq("id", allocation.connection_id)');
  assertStringIncludes(source, '"ad_plan_assert_launchable"');
  const gate = source.indexOf("creativePreparationBindingError({");
  const launchable = source.indexOf('"ad_plan_assert_launchable"');
  const connection = source.indexOf('.from("ad_connections")');
  const begin = source.indexOf(
    'supabase.rpc(\n    "ad_creative_prepare_begin"',
  );
  const provider = source.indexOf("adapter.initiate(");
  assertEquals(gate >= 0, true);
  assertEquals(launchable > gate, true);
  assertEquals(connection > launchable, true);
  assertEquals(begin > connection, true);
  assertEquals(provider > begin, true);
});

Deno.test("#3697 host creative recording uses the ad-plan permission lattice", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-creative-upload/index.ts", import.meta.url),
  );
  assertStringIncludes(source, '"ad_can_host_action"');
  assertStringIncludes(source, 'p_action: "plan"');
  assertEquals(source.includes("biz_can_manage_payments_for_brand"), false);
});

Deno.test("#3697 ownership is enforced at plan freeze, reuse and provider preparation", async () => {
  const [ownership, plan, prepare, builder] = await Promise.all([
    Deno.readTextFile(new URL("../adCreativeOwnership.ts", import.meta.url)),
    Deno.readTextFile(new URL("../../ad-plan/index.ts", import.meta.url)),
    Deno.readTextFile(
      new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
    ),
    Deno.readTextFile(
      new URL(
        "../../../../mingla-admin/src/components/campaign-builder/StepCreative.jsx",
        import.meta.url,
      ),
    ),
  ]);
  assertStringIncludes(plan, "adCreativeOwnershipError({");
  assertStringIncludes(ownership, "host_media_reuse_not_approved");
  assertStringIncludes(prepare, "adCreativeOwnershipError({");
  assertStringIncludes(builder, "row.house_reuse_allowed === true");
});
