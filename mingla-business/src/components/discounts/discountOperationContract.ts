export const DISCOUNTS_OPERATION_COPY = Object.freeze({
  label: "Discounts",
  sub: "Codes, automatic discounts and sale prices",
});

export const canShowDiscountsOperation = (
  rank: number,
  accessEnabled: boolean,
  onDiscounts: ((brandId: string) => void) | undefined,
): boolean => rank >= 20 && accessEnabled && onDiscounts !== undefined;
