/**
 * #4238 W4a (6b + T-9): one ad per frozen creative (1–5) means every frozen
 * creative is prepared on every app before create, and only those. Photos
 * run on Meta and Snapchat; TikTok, Google and Reddit stay video-only.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type CreativePreparationBinding,
  creativePreparationBindingError,
} from "../adCreativePreparationPlan.ts";
import { hostImageRefusedPlatform } from "../../ad-plan/index.ts";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const FIRST = "33333333-3333-4333-8333-333333333333";
const SECOND = "33333333-3333-4333-8333-333333333334";
const OTHER = "33333333-3333-4333-8333-333333333399";
const BRAND_ID = "44444444-4444-4444-8444-444444444444";
const CONNECTION_ID = "55555555-5555-4555-8555-555555555555";

function binding(
  ownerKind: "host" | "mingla",
  requested: string,
): CreativePreparationBinding {
  return {
    plan: {
      id: PLAN_ID,
      owner_kind: ownerKind,
      brand_id: ownerKind === "host" ? BRAND_ID : null,
      current_version_id: VERSION_ID,
      state: "creating_paused_objects",
    },
    version: {
      id: VERSION_ID,
      plan_id: PLAN_ID,
      plan_hash: "a".repeat(64),
      canonical_plan: {
        creative_library_id: FIRST,
        creative_library_ids: [FIRST, SECOND],
      },
    },
    allocation: { platform: "snapchat", connection_id: CONNECTION_ID },
    connection: { id: CONNECTION_ID },
    confirmationPresent: true,
    requestedPlanVersionId: VERSION_ID,
    requestedPlanHash: "a".repeat(64),
    requestedCreativeId: requested,
    requestedPlatform: "snapchat",
    requestedLane: undefined,
    requestedBrandId: ownerKind === "host" ? BRAND_ID : "",
  } as CreativePreparationBinding;
}

Deno.test("prepare: every frozen Host creative may be prepared; nothing outside the list", () => {
  assertEquals(creativePreparationBindingError(binding("host", FIRST)), null);
  assertEquals(creativePreparationBindingError(binding("host", SECOND)), null);
  assertEquals(
    creativePreparationBindingError(binding("host", OTHER)),
    "plan_creative_mismatch",
  );
});

Deno.test("prepare: an Admin plan still prepares only its one creative", () => {
  assertEquals(
    creativePreparationBindingError(binding("mingla", SECOND)),
    "plan_creative_mismatch",
  );
});

Deno.test("SC-T9: a photo runs on Meta and Snapchat; TikTok, Google and Reddit say it needs a video", () => {
  assertEquals(hostImageRefusedPlatform("image", ["meta", "snapchat"]), null);
  for (const app of ["tiktok", "google", "reddit"]) {
    assertEquals(hostImageRefusedPlatform("image", ["meta", app]), app);
  }
});

Deno.test("the Host and Ari launches prepare every frozen creative on every app", async () => {
  const business = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/services/hostAdPlanService.ts",
      import.meta.url,
    ),
  );
  const ari = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  for (const source of [business, ari]) {
    assert(source.includes(".creative_library_ids"));
    assert(source.includes("for (const creativeId of creativeIds) {"));
  }
});
