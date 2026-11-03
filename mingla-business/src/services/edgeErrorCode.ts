/**
 * #4238 — the error code in a 2xx edge-function body, only when it is a
 * non-empty string (`error: null` and error objects are not failures).
 * The one definition lives in hostAdCampaignService, which is already in the
 * boot chunk; this re-export keeps the import path for the Host Ads chunk.
 */
export { edgeErrorCode } from "./hostAdCampaignService";
