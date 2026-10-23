export const DOOR_FULL_PRICE_NOTICE = "Door sales are always full price.";

export const doorFullPriceNotice = (
  inPersonPaymentsEnabled: boolean,
): string | null => (inPersonPaymentsEnabled ? DOOR_FULL_PRICE_NOTICE : null);
