/**
 * #4271 — web build of TapToPayTerminalHost. Tap to Pay never runs on the web
 * (useTapToPayAvailability answers "web"), so the root layout mounts nothing
 * here and the Terminal session, flow and edge client stay out of the eager
 * web bundle.
 */
import type React from "react";

export { tapToPayConnectParams } from "../../../services/terminal/tapToPayConnectParams";

export const TapToPayTerminalHost = (): React.ReactElement | null => null;
