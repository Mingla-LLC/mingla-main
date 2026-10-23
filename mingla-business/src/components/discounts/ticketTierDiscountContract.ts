export const canShowTicketTierDiscountControls = (input: {
  hasPersistedTier: boolean;
  privateLinksEnabled: boolean;
  hasEventId: boolean;
  hasBrandId: boolean;
  canEditPrice: boolean;
  isFree: boolean;
}): boolean =>
  input.hasPersistedTier &&
  input.privateLinksEnabled &&
  input.hasEventId &&
  input.hasBrandId &&
  input.canEditPrice &&
  !input.isFree;
