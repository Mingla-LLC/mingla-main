/**
 * #4453 (contract section I) — the shape of what the root HostDesktopShell
 * (mounted on every platform, around the whole Stack) hands to the screens
 * below it for the brand switcher: the route the host is on, the route's
 * brand, and the switcher itself.
 *
 * Types only. The context is `WorkspaceRouteContext` in
 * components/ui/hostShellContext.ts, the one small file about the shell that
 * is in the shared boot chunk. Everything the shell puts in it (reading the
 * brand from the route, looking it up, the switcher component, the held
 * switch) is the shell's own code and loads with the root layout; top bars
 * and screens reach it through the context, never by importing it. A bare
 * `<BrandChip>` (one outside the switcher) is handed `brand` by its screen.
 *
 * Outside the provider (isolated renders) there is no route: the chip shows
 * the current brand and a pick only changes the current brand.
 */
import type { ComponentType } from "react";

import type { WorkspaceRouteParams } from "../../config/workspaceBrandRoute";
import type { PendingBrandSwitchHolder } from "../../hooks/pendingBrandSwitch";
import type { Brand } from "../../types/brand";

/** What a screen passes to the brand switcher. */
export interface WorkspaceBrandSwitcherProps {
  /** The brand this screen edits. Omit on screens that follow the route or the current brand. */
  brandId?: string;
  /** A tight header: smaller mark, and the name shortens to the space it has. */
  compact?: boolean;
  /** The app top bar's own full switcher sheet. */
  onOpenSheet?: () => void;
  /**
   * Opens the full brands sheet (create, continue setup) from inside the
   * menu, as "Manage brands". Unlike `onOpenSheet` it never replaces the
   * menu. Default: the shell's (`WorkspaceRoute.manageBrands`).
   */
  onManageBrands?: () => void;
  /** The host knows the current brand is still being resolved (issue #3345). */
  brandLoading?: boolean;
  testID?: string;
}

/** The brand a chip shows when the screen names one; `pending` while it is being read. */
export interface WorkspaceChipBrand {
  brand: Brand | null;
  pending: boolean;
}

export interface WorkspaceRoute {
  pathname: string | null;
  params: WorkspaceRouteParams;
  /** The brand the route names (`/brand/<id>/…`, `?brandId=`), or null. */
  routeBrandId: string | null;
  /**
   * The route's brand while it is not the current brand (absent: follow the current brand).
   * Also `{ brand: null, pending: true }` while one item's brand (a trip, an event, a listing)
   * is still being read: the chips show their placeholder, not the brand last worked on.
   */
  brand?: WorkspaceChipBrand;
  /** The workspace brand switcher (WorkspaceBrandSwitcher). */
  Switcher?: ComponentType<WorkspaceBrandSwitcherProps>;
  /** A brand switch held until its route change lands; the shell settles it. */
  pendingSwitch?: PendingBrandSwitchHolder;
  /**
   * Opens the shell's full brands sheet. A switcher that was handed no sheet
   * of its host's (the phone strip, the Website workspace's bar) offers it in
   * its menu as "Manage brands".
   */
  manageBrands?: () => void;
  /** A screen whose own bar shows the switcher on phones calls this; the result releases it. */
  ownPhoneSwitcher?: () => () => void;
}
