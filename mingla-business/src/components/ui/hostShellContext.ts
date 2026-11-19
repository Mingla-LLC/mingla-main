/**
 * #4420 — tells DesktopCanvas that the root HostDesktopShell already reserves
 * the sidebar's width on this route, so the canvas pads only the bezel.
 */
import { createContext } from "react";

import type { WorkspaceRoute } from "../brand/workspaceBrandContext";

export const HostShellInsetContext = createContext<boolean>(false);

/**
 * #4453 — the route the host is on, its brand and the brand switcher, from
 * the same shell (types and the full story: brand/workspaceBrandContext.ts).
 * Read it with `useContext(WorkspaceRouteContext)`.
 */
export const WorkspaceRouteContext = createContext<WorkspaceRoute>({ pathname: null, params: {}, routeBrandId: null });
