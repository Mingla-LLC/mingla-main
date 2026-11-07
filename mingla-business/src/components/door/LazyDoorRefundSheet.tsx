/**
 * #4271 — the door refund sheet, loaded when a host first opens it. Two routes
 * render it (door sale detail and guest detail), so a static import hoisted the
 * whole sheet into the eager web __common chunk.
 */
import { createOnIntentLazySheet } from "../ui/OnIntentLazySheet";
import type { DoorRefundSheetProps } from "./DoorRefundSheet";

export const LazyDoorRefundSheet = createOnIntentLazySheet<DoorRefundSheetProps>(
  async () => (await import("./DoorRefundSheet")).DoorRefundSheet,
  { loadingLabel: "Loading refund" },
);
