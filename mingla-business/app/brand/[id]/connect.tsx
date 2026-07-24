/**
 * Native compatibility route for /brand/[id]/connect.
 *
 * Wave 2 changes only the web one-hop surface. Native keeps the established
 * BrandOnboardView/openAuthSessionAsync flow byte-for-byte via the existing
 * payments/onboard route until the founder-gated Wave 4 device build.
 */

export { default } from "./payments/onboard";
