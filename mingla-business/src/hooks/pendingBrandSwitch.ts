/**
 * #4453 (contract section I) — a brand switch the switcher is holding until
 * its route change lands. The app shell settles it on every pathname change
 * (useWorkspaceBrandRouteSync), so this small piece is on the boot path; the
 * switcher itself (useWorkspaceBrandSwitch) loads with the brand menu.
 */
import { workspaceRoutePath } from "../config/workspaceBrandRoute";

export interface PendingBrandSwitch {
  /** The address being opened, as `workspaceRoutePath` reads it. */
  targetPath: string;
  apply: () => void;
}

let pendingSwitch: PendingBrandSwitch | null = null;

/** Hold `apply` until the route becomes `targetPath` (replaces any switch already held). */
export function holdPendingBrandSwitch(next: PendingBrandSwitch | null): void {
  pendingSwitch = next;
}

/**
 * Called by the root shell whenever the pathname changes. The held brand is
 * applied only when the route really became the screen we asked for; any
 * other move (the host went somewhere else) drops it.
 */
export function settlePendingBrandSwitch(pathname: string | null | undefined): void {
  const pending = pendingSwitch;
  if (pending === null) return;
  pendingSwitch = null;
  const path = workspaceRoutePath(pathname);
  // A target that forwards to its own child (a tab root) still counts.
  if (path === pending.targetPath || path.startsWith(`${pending.targetPath}/`)) {
    pending.apply();
  }
}

/** Test seam. */
export function resetPendingBrandSwitchForTest(): void {
  pendingSwitch = null;
}
export const hasPendingBrandSwitchForTest = (): boolean => pendingSwitch !== null;
