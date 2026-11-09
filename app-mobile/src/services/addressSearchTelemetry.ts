/**
 * #4334 — client Sentry report when address/place search is unavailable
 * (spec v2 §4.2). The proxy's error code travels as a tag; at most one event
 * per code per 60 s so a dead API does not flood Sentry. An honest empty
 * result ("No matches") is never reported.
 */
import { createThrottledReporter } from "@mingla/location-input";

import { reportNonFatal } from "../diagnostics/reportNonFatal";

export const reportAddressSearchUnavailable = createThrottledReporter((code: string) => {
  reportNonFatal(
    "address_search",
    new Error(`address_search_unavailable:${code}`),
    { code },
    ["address_search_unavailable", code],
  );
});
