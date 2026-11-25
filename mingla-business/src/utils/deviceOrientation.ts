/**
 * #4490 spec 08 O3 part B — tablet and orientation rules for the Host app
 * (pure; the hooks and the root column read the device and call these).
 *
 * - A device whose SHORTEST screen side is under 600 dp is a phone: it stays
 *   portrait (runtime lock on Android, and on iPhone as a backstop to the
 *   Info.plist, see plugins/withFloorOrientations.js). Measured on the screen,
 *   not the window, so an iPad in a narrow multitasking window is still a
 *   tablet and is never locked.
 * - On a native tablet the floor screens (Till, kitchen and bar) use the full
 *   window with useFloorLayout; every other Host screen keeps the phone layout
 *   in a centred column `suiteFormMaxWidth` wide. Web is untouched (its own
 *   desktop layouts take over at >= 1024).
 */
import { suiteFormMaxWidth } from "../constants/designSystem";

export const PHONE_SHORTEST_SIDE_LIMIT = 600;

export interface Size {
  width: number;
  height: number;
}

export function shortestSide(size: Size): number {
  return Math.min(size.width, size.height);
}

/** True for a phone-sized device (shortest screen side < 600 dp). */
export function shouldLockPortrait(screen: Size): boolean {
  return shortestSide(screen) < PHONE_SHORTEST_SIDE_LIMIT;
}

/** The floor screens that lay themselves out with useFloorLayout. */
export function isFloorRoute(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && /^\/venue\/[^/]+\/(till|station)(\/|$)/.test(pathname);
}

export interface TabletColumnInput {
  platform: string;
  /** The window (follows rotation and iPad multitasking). */
  window: Size;
  pathname: string | null | undefined;
}

/**
 * The max width of the root column on a native tablet, or null for full width
 * (web, phones, a window narrower than a tablet, floor screens, or a window
 * that is no wider than the column anyway).
 */
export function nativeTabletColumnWidth(input: TabletColumnInput): number | null {
  if (input.platform === "web") return null;
  if (input.window.width < PHONE_SHORTEST_SIDE_LIMIT) return null;
  if (isFloorRoute(input.pathname)) return null;
  return input.window.width > suiteFormMaxWidth ? suiteFormMaxWidth : null;
}
