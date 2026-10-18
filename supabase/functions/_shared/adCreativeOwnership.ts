/**
 * Issue #3697 v1.4 — creative reuse follows the immutable plan owner.
 *
 * Host media remains brand-scoped. Mingla house campaigns may use only
 * house-owned media until the Terms disclosure explicitly authorizes reuse of
 * Host-owned media.
 */
export function adCreativeOwnershipError(input: {
  ownerKind: "mingla" | "host";
  planBrandId: string | null;
  creativeBrandId: string | null;
}): string | null {
  if (input.ownerKind === "mingla") {
    return input.creativeBrandId === null
      ? null
      : "host_media_reuse_not_approved";
  }
  return input.planBrandId !== null &&
      input.creativeBrandId === input.planBrandId
    ? null
    : "creative_brand_mismatch";
}
