/**
 * #4420 — tells DesktopCanvas that the root HostDesktopShell already reserves
 * the sidebar's width on this route, so the canvas pads only the bezel.
 */
import { createContext } from "react";

export const HostShellInsetContext = createContext<boolean>(false);
