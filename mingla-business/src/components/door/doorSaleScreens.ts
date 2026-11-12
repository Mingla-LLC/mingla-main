/**
 * #4271 — the door card-sale screens, loaded as ONE on-intent chunk: Door mode
 * (#4389, the full-screen door sale opened from "Sell at door"), Tap to Pay setup, the Tap to Pay
 * sale and the "Scan to pay" pay code screen (which shares the status pill, door
 * tones and sale draft with the Tap to Pay sale). They share the Terminal flow,
 * the door tap edge client, the tap availability hook and the pay-code sale hooks, so loading them through a single
 * dynamic import keeps that shared code out of the eager web __common chunk.
 * Import these screens through LazyDoorSaleScreens.tsx, never directly from a
 * route.
 */
export { DoorPayCodeScreen } from "./DoorPayCodeScreen";
export { DoorModeScreen } from "./DoorModeScreen";
export { TapToPaySaleScreen } from "./tap/TapToPaySaleScreen";
export { TapToPaySetupScreen } from "./tap/TapToPaySetupScreen";
export { F4TapToPayCard } from "./tap/F4TapToPayCard";
