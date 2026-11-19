/**
 * #4453 (contract section I) — the route the host is on, for the brand
 * switcher. The root HostDesktopShell (mounted on every platform, around the
 * whole Stack) provides it from expo-router; the brand chip and the switch
 * hook read it from context, so they need no router hook of their own and
 * resolve the route's brand in the SAME render as the route change (no frame
 * showing the previous brand).
 *
 * Outside the provider (isolated renders) there is no route: the chip shows
 * the current brand and a pick only changes the current brand.
 */
import { createContext, useContext } from "react";

import type { WorkspaceRouteParams } from "../../config/workspaceBrandRoute";

export interface WorkspaceRoute {
  pathname: string | null;
  params: WorkspaceRouteParams;
  /** The brand the route names (`/brand/<id>/…`, `?brandId=`), or null. */
  routeBrandId: string | null;
}

const NO_PARAMS: WorkspaceRouteParams = Object.freeze({});

export const NO_WORKSPACE_ROUTE: WorkspaceRoute = Object.freeze({
  pathname: null,
  params: NO_PARAMS,
  routeBrandId: null,
});

export const WorkspaceRouteContext = createContext<WorkspaceRoute>(NO_WORKSPACE_ROUTE);

export const useWorkspaceRoute = (): WorkspaceRoute => useContext(WorkspaceRouteContext);
