/**
 * #4271 — the door card-sale screens, loaded as ONE on-intent chunk: the new door
 * sale sheet (opened from "Sell at door"), Tap to Pay setup and the Tap to Pay
 * sale. They share the Terminal flow, the door tap edge client, the tap
 * availability hook and the pay-code sale hooks, so loading them through a single
 * dynamic import keeps that shared code out of the eager web __common chunk.
 * Import these screens through LazyDoorSaleScreens.tsx, never directly from a
 * route.
 */
export { DoorSaleNewSheet } from "./DoorSaleNewSheet";
export { TapToPaySaleScreen } from "./tap/TapToPaySaleScreen";
export { TapToPaySetupScreen } from "./tap/TapToPaySetupScreen";
