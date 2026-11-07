/**
 * #4271 — the "Set up Tap to Pay" sequence, with injected dependencies.
 *
 * Order (binding):
 *   1. Stripe's device check (supportsReadersOfType tapToPay).
 *   2. door-tap-intent `location` {eventId} → the brand's Terminal Location.
 *   3. Connect the phone's reader at that Location. On iPhone this is where
 *      Apple shows its Tap to Pay terms (tosAcceptancePermitted), so they are
 *      accepted during setup, not in front of a guest at the first sale.
 *   4. iPhone: Apple's "How to Tap" education.
 *   5. Remember on this phone that this brand is worth warming up.
 *
 * Nothing here charges anyone. Each failure says what to do next.
 */
import { DoorTapError } from "./doorTapEdge";
import { tapReaderProblemCopy } from "../../constants/tapToPayCopy";
import { classifyTerminalError, isTapReaderProblem, type TerminalErrorLike } from "./tapToPayFlow";

export interface TapToPaySetupDeps {
  os: string;
  checkDeviceSupport(): Promise<{ supported: boolean; error?: TerminalErrorLike }>;
  fetchLocation(): Promise<string>;
  /** The setup screen decides who may accept Apple's terms and binds it here. */
  ensureReaderConnected(locationId: string): Promise<{ error?: TerminalErrorLike }>;
  showHowToTap(): Promise<unknown>;
  markComplete(): Promise<void>;
}

export type TapToPaySetupResult =
  | { kind: "done"; locationId: string }
  | { kind: "device_rejected" }
  | { kind: "ios_update_required" }
  | { kind: "terms_required" }
  | { kind: "not_available" }
  | { kind: "failed"; message: string };

const locationFailure = (error: unknown): TapToPaySetupResult => {
  if (error instanceof DoorTapError) {
    if (error.code === "tap_not_available") {
      return error.detail === "address_missing"
        ? {
            kind: "failed",
            message: "Add the brand's address in brand settings, then set up Tap to Pay again.",
          }
        : { kind: "not_available" };
    }
    if (error.code === "stripe_account_not_ready") {
      return {
        kind: "failed",
        message: "Card payments aren't set up for this brand yet. Finish payouts setup first.",
      };
    }
    if (error.code === "door_access_denied") {
      return {
        kind: "failed",
        message: "You don't have permission to take payments at this door. Ask the brand owner.",
      };
    }
    if (error.code === "network_error") {
      return { kind: "failed", message: "Couldn't reach Mingla. Check your connection and try again." };
    }
  }
  return { kind: "failed", message: "Setup didn't finish. Check your connection and try again." };
};

export const runTapToPaySetup = async (deps: TapToPaySetupDeps): Promise<TapToPaySetupResult> => {
  const support = await deps.checkDeviceSupport();
  if (!support.supported) {
    return support.error !== undefined && classifyTerminalError(support.error) === "ios_update_required"
      ? { kind: "ios_update_required" }
      : { kind: "device_rejected" };
  }

  let locationId: string;
  try {
    locationId = await deps.fetchLocation();
  } catch (error) {
    return locationFailure(error);
  }

  const connected = await deps.ensureReaderConnected(locationId);
  if (connected.error) {
    const kind = classifyTerminalError(connected.error);
    if (kind === "not_on_this_phone") return { kind: "device_rejected" };
    if (kind === "ios_update_required") return { kind: "ios_update_required" };
    if (kind === "terms_not_accepted") return { kind: "terms_required" };
    if (isTapReaderProblem(kind)) return { kind: "failed", message: tapReaderProblemCopy(kind, deps.os) };
    return {
      kind: "failed",
      message:
        deps.os === "ios"
          ? "Couldn't finish Apple's Tap to Pay setup. Accept Apple's terms when asked, then try again."
          : "Couldn't start Tap to Pay on this phone. Try again.",
    };
  }

  if (deps.os === "ios") {
    try {
      await deps.showHowToTap();
    } catch {
      return { kind: "failed", message: "Couldn't show Apple's How to Tap guide. Try again." };
    }
  }

  await deps.markComplete();
  return { kind: "done", locationId };
};
