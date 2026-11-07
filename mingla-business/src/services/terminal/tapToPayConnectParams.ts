/**
 * #4271 — the Stripe Terminal connect parameters for Tap to Pay. Shared by the
 * native TapToPayTerminalHost and its web build (which re-exports it for export
 * parity; the web never connects).
 */
import { isTerminalSimulated } from "./terminalConfig";

/** The only place Apple's terms can be allowed; every caller but the setup button passes false. */
export const tapToPayConnectParams = (
  locationId: string,
  merchantDisplayName: string,
  mayAcceptTerms: boolean,
) =>
  ({
    discoveryMethod: "tapToPay",
    simulated: isTerminalSimulated(),
    locationId,
    merchantDisplayName,
    autoReconnectOnUnexpectedDisconnect: true,
    tosAcceptancePermitted: mayAcceptTerms,
  }) as const;
