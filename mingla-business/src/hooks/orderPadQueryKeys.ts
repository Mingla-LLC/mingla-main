/**
 * Issue #1792 query-key contract, split for issue #3563's bundle repair.
 *
 * This is the smallest bundle-safe owner: the atomic modifier mutation needs
 * only these cache identities, while importing them through useVenueOrderPad
 * pulls the full order-pad data layer into the eager web chunk. The data hook
 * re-exports this owner so its existing public API remains unchanged.
 */
export const orderPadKeys = {
  forBrand: (brandId: string): readonly ["orderPadMenu", string] =>
    ["orderPadMenu", brandId] as const,
  menu: (
    brandId: string,
    servingVenueId: string,
  ): readonly ["orderPadMenu", string, string] =>
    ["orderPadMenu", brandId, servingVenueId] as const,
  preview: (
    brandId: string,
    fingerprint: string,
  ): readonly ["orderPadPreview", string, string] =>
    ["orderPadPreview", brandId, fingerprint] as const,
};
