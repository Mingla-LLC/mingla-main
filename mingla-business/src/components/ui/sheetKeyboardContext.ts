/**
 * #4420 (device round 2) — what a docked bottom sheet tells the scroll view in
 * its body about the keyboard. The native Sheet provides it from inside its own
 * Modal window's KeyboardProvider; outside a sheet (and on web) it is null and
 * the scroll view keeps the library default.
 *
 * - keyboardOpen: the sheet body is lifted above the keyboard + Done bar.
 * - bottomPad: the body's CURRENT bottom padding (resting, or keyboard + Done
 *   bar + clearance while open), so a scroll view can measure the pinned footer
 *   below it: window bottom minus this padding minus its own bottom edge.
 * - topShift: how far a short sheet's top rose for the keyboard (0 when the
 *   panel kept its snap height).
 */
import { createContext } from "react";

export interface SheetKeyboardLayout {
  keyboardOpen: boolean;
  bottomPad: number;
  topShift: number;
}

export const SheetKeyboardContext = createContext<SheetKeyboardLayout | null>(null);
