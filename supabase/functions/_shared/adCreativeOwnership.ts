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
// MINGLA-INVARIANT: I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE | issue #3697 | house reuse requires source='admin_upload' and no brand
export function adCreativeOwnershipError(input: {
  ownerKind: "mingla" | "host";
  planBrandId: string | null;
  creativeBrandId: string | null;
  creativeSource?: string | null;
}): string | null {
  if (input.ownerKind === "mingla") {
    return input.creativeBrandId === null &&
        input.creativeSource === "admin_upload"
      ? null
      : "host_media_reuse_not_approved";
  }
  return input.planBrandId !== null &&
      input.creativeBrandId === input.planBrandId
    ? null
    : "creative_brand_mismatch";
}
