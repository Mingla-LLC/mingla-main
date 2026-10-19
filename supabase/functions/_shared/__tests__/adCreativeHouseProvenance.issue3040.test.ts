// Issue #3040 rework 1 (P1-3) — house media is recorded at creation and can
// never be acquired later. An admin attaching media to a Host brand records
// Host media; house reuse (library flag and every ownership gate) requires
// source 'admin_upload', no brand AND no owning-brand snapshot, and refuses a
// caller that did not read the snapshot.
// MINGLA-INVARIANT: I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE | issue #3697 | house reuse requires source='admin_upload', no brand and no brand snapshot
//
// FAILS ON REVERT: derive the upload source from the caller's role again
// (adminCaller ? 'admin_upload' : ...), or drop the source_brand_id clause from
// isHouseReusable or adCreativeOwnershipError, and a case below fails.
import { isHouseReusable } from "../adCreativeLibrary.ts";
import { adCreativeOwnershipError, creativeSourceForUpload } from "../adCreativeOwnership.ts";
import { assert } from "./issue3040_fakeSupabase.ts";

Deno.test("#3040 an admin upload for a Host brand is recorded as Host media", () => {
  assert(creativeSourceForUpload({ adminCaller: true, brandId: "host-brand" }) === "host_upload", "admin + brand");
  assert(creativeSourceForUpload({ adminCaller: true, brandId: null }) === "admin_upload", "admin house upload");
  assert(creativeSourceForUpload({ adminCaller: false, brandId: "host-brand" }) === "host_upload", "host upload");
  assert(creativeSourceForUpload({ adminCaller: false, brandId: null }) === "host_upload", "a non-admin never makes house media");
});

Deno.test("#3040 Host media whose brand was deleted is never house-reusable", () => {
  const orphan = { source: "admin_upload", brand_id: null, source_brand_id: "host-brand-1" };
  assert(!isHouseReusable(orphan), "library: orphaned host-brand media is house-reusable");
  assert(
    adCreativeOwnershipError({ ownerKind: "mingla", planBrandId: null, creativeBrandId: null, creativeSource: "admin_upload", creativeSourceBrandId: "host-brand-1" }) ===
      "host_media_reuse_not_approved",
    "ownership gate: orphaned host-brand media allowed into a house plan",
  );
});

Deno.test("#3040 a reader that did not fetch the brand snapshot is refused (fail closed)", () => {
  assert(!isHouseReusable({ source: "admin_upload", brand_id: null }), "library: missing snapshot treated as house");
  assert(
    adCreativeOwnershipError({ ownerKind: "mingla", planBrandId: null, creativeBrandId: null, creativeSource: "admin_upload" }) !== null,
    "ownership gate: missing snapshot treated as house",
  );
});

Deno.test("#3040 genuine house media is still reusable, and Host plans are unchanged", () => {
  const house = { source: "admin_upload", brand_id: null, source_brand_id: null };
  assert(isHouseReusable(house), "a real house upload lost house reuse");
  assert(
    adCreativeOwnershipError({ ownerKind: "mingla", planBrandId: null, creativeBrandId: null, creativeSource: "admin_upload", creativeSourceBrandId: null }) === null,
    "a real house upload was refused in a house plan",
  );
  assert(adCreativeOwnershipError({ ownerKind: "host", planBrandId: "b1", creativeBrandId: "b1", creativeSource: "host_upload", creativeSourceBrandId: "b1" }) === null, "host own media");
  assert(adCreativeOwnershipError({ ownerKind: "host", planBrandId: "b1", creativeBrandId: "b2", creativeSource: "host_upload", creativeSourceBrandId: "b2" }) === "creative_brand_mismatch", "cross-brand");
});
