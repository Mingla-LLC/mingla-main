export const CURRENT_BRAND_QUERY_ERROR =
  "We couldn't load your brand data. Try again before starting an event.";

export const hasCurrentBrandRecoveryQueryError = (
  brandsQueryIsError: boolean,
  creatorAccountIsError: boolean,
): boolean => brandsQueryIsError || creatorAccountIsError;
