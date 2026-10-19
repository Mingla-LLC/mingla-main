/**
 * Issue #3697 v1.4 — creative reuse follows the immutable plan owner.
 *
 * Host media remains brand-scoped. Mingla house campaigns may use only
 * house-owned media until the Terms disclosure explicitly authorizes reuse of
 * Host-owned media.
 */
//
// #3040/#3697 — "house-owned" is immutable provenance (`source`), never a
// missing brand: a deleted brand must not turn its Host media into house media.
// A caller that does not pass the creative's source is refused (fail closed).
// #3040 rework — house media is media recorded as a house upload AT
// CREATION: source 'admin_upload' and no owning-brand snapshot
// (source_brand_id). A brand that is deleted later clears brand_id but never
// the snapshot, so Host media can never be laundered into house media. A
// caller that does not pass the snapshot is refused (fail closed).
// Invariant I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE (declared in supabase/functions/_shared/__tests__/adCreativeHouseProvenance.issue3040.test.ts): house reuse requires source='admin_upload', no brand and no brand snapshot
export function adCreativeOwnershipError(input: {
  ownerKind: "mingla" | "host";
  planBrandId: string | null;
  creativeBrandId: string | null;
  creativeSource?: string | null;
  creativeSourceBrandId?: string | null;
}): string | null {
  if (input.ownerKind === "mingla") {
    return input.creativeBrandId === null &&
        input.creativeSource === "admin_upload" &&
        input.creativeSourceBrandId === null
      ? null
      : "host_media_reuse_not_approved";
  }
  return input.planBrandId !== null &&
      input.creativeBrandId === input.planBrandId
    ? null
    : "creative_brand_mismatch";
}

// #3040 rework — the provenance an upload records is decided by OWNERSHIP,
// not by the caller's role: an admin attaching media to a Host brand records
// Host media. Only an admin upload with no brand is a house upload.
export function creativeSourceForUpload(input: {
  adminCaller: boolean;
  brandId: string | null;
}): "admin_upload" | "host_upload" {
  return input.adminCaller && input.brandId === null
    ? "admin_upload"
    : "host_upload";
}
