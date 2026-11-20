/**
 * #4453 (contract section I) — a brand switch the switcher is holding until
 * its route change lands. The root shell owns the holder, hands it down in
 * the workspace route context, and settles it on every pathname change
 * (useWorkspaceBrandRouteSync); the switcher (useWorkspaceBrandSwitch, loaded
 * with the brand menu) fills it.
 */
import { workspaceRoutePath } from "../config/workspaceBrandRoute";

export interface PendingBrandSwitch {
  /** The address being opened, as `workspaceRoutePath` reads it. */
  targetPath: string;
  apply: () => void;
}

export interface PendingBrandSwitchHolder {
  current: PendingBrandSwitch | null;
}

/**
 * Called by the root shell whenever the pathname changes. The held brand is
 * applied only when the route really became the screen we asked for; any
 * other move (the host went somewhere else) drops it.
 */
export function settlePendingBrandSwitch(
  holder: PendingBrandSwitchHolder,
  pathname: string | null | undefined,
): void {
  const pending = holder.current;
  if (pending === null) return;
  holder.current = null;
  const path = workspaceRoutePath(pathname);
  // A target that forwards to its own child (a tab root) still counts.
  if (path === pending.targetPath || path.startsWith(`${pending.targetPath}/`)) {
    pending.apply();
  }
}
