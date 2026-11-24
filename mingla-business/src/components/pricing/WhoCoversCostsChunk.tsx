/**
 * #4522 — the one lazy chunk for the host-only pricing surfaces: the "Who covers
 * costs" section and the trip builder's "What you earn" card. They share the fee
 * preview (`pricingPreview.ts`); loading both through this module keeps that
 * module in one chunk instead of hoisting it into `__common` (ORCH-1083).
 */
export { WhoCoversCostsSection } from "./WhoCoversCostsSection";
export { TripEarningsCardBody } from "../trip/TripEarningsCardBody";
