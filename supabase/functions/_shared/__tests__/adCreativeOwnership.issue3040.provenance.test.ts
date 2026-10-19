// Issue #3040 (T-C12) — house reuse follows immutable provenance.
// Invariant I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE (declared in supabase/functions/_shared/__tests__/adCreativeHouseProvenance.issue3040.test.ts): house reuse requires source='admin_upload'; provenance is immutable
//
// FAILS ON REVERT: restore `house_reuse_allowed: !creative.brand_id` or the
// brand-only ownership check and the brandless Host row below becomes reusable.
import { adCreativeOwnershipError } from "../adCreativeOwnership.ts";
import { buildCreativeLibrary, isHouseReusable } from "../adCreativeLibrary.ts";
import { assert } from "./issue3040_fakeSupabase.ts";

const library = (creative: Record<string, unknown>) =>
  buildCreativeLibrary({
    creatives: [{ id: "c-1", name: "n", kind: "video", status: "active", created_at: "2026-10-19T00:00:00Z", ...creative }],
    versions: [], plans: [], campaigns: [], adSets: [], ads: [], providerRefs: [],
  })[0];

Deno.test("#3040 a brandless Host row (deleted brand) is never house media", () => {
  assert(isHouseReusable({ brand_id: null, source: "host_upload" }) === false, "host row reusable");
  assert(isHouseReusable({ brand_id: null, source: "ari_upload" }) === false, "ari row reusable");
  assert(isHouseReusable({ brand_id: null }) === false, "row without provenance reusable");
  // [TEST-MOD-APPROVED #3040] P1-3 ruling: house media also has no owning-brand snapshot.
  assert(isHouseReusable({ brand_id: null, source: "admin_upload", source_brand_id: null }) === true, "admin house row not reusable");
  assert(isHouseReusable({ brand_id: "b", source: "admin_upload" }) === false, "brand-tagged row reusable");
  const row = library({ brand_id: null, source: "host_upload", source_job_id: "job-1", rendition_height: 1080 });
  assert(row.house_reuse_allowed === false && row.source === "host_upload", JSON.stringify(row));
  assert(row.source_job_id === "job-1" && row.rendition_height === 1080, "projection lacks provenance");
  assert(row.source_summary === "Host brand library", `summary ${row.source_summary}`);
});

Deno.test("#3040 the ownership gate refuses house plans without admin provenance", () => {
  const mingla = (creativeSource: string | null | undefined) =>
    // [TEST-MOD-APPROVED #3040] P1-3 ruling: the gate reads the brand snapshot too.
    adCreativeOwnershipError({ ownerKind: "mingla", planBrandId: null, creativeBrandId: null, creativeSource, creativeSourceBrandId: null });
  assert(mingla("host_upload") === "host_media_reuse_not_approved", "host media entered a house plan");
  assert(mingla(undefined) === "host_media_reuse_not_approved", "unknown provenance must fail closed");
  assert(mingla("admin_upload") === null, "admin media refused");
  assert(
    adCreativeOwnershipError({ ownerKind: "host", planBrandId: "b", creativeBrandId: "b", creativeSource: "host_upload" }) === null,
    "host plan refused its own media",
  );
});
