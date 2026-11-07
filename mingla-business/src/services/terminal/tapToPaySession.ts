/**
 * #4271 — the one Stripe Terminal session, as an external store.
 *
 * The native SDK is a singleton, and TapToPayTerminalHost (a sibling of the root
 * <Stack>) owns it for the life of the app, so the reader can be warm before the
 * host ever opens a tap screen. Screens read this store through
 * useTapToPayTerminal(); they never touch the SDK.
 *
 * Scope says which brand the session is for. It defaults to the current brand;
 * a door route (or the settings screen) sets it while it is open, and clears it
 * when it closes. Everything here is in memory only.
 */
import { useSyncExternalStore } from "react";

import type { TapToPayTerminalClient, TerminalErrorLike } from "./tapToPayFlow";

/**
 * Has Apple's Tap to Pay terms been accepted for this brand, as far as we can
 * know? Stripe does not expose Apple's own check, so the answer is read by
 * connecting. In memory only and never persisted.
 */
export type TapToPayAcceptance = "unknown" | "accepted" | "not_accepted";

export type TapToPayTerminalStatus = "unavailable" | "initializing" | "ready" | "error";

export interface TapToPaySessionClient extends TapToPayTerminalClient {
  /** Stripe's own check: can this phone run a Tap to Pay reader? */
  checkDeviceSupport(): Promise<{ supported: boolean; error?: TerminalErrorLike }>;
}

export interface TapToPayScope {
  brandId: string | null;
  /** The door's event. Token and Location use it when set, otherwise the brand. */
  eventId: string | null;
  merchantDisplayName: string | null;
}

export interface TapToPaySessionState {
  status: TapToPayTerminalStatus;
  client: TapToPaySessionClient | null;
  /** Plain-English reason when status is "error". */
  errorMessage: string | null;
  retryInitialize: () => void;
  /** Set by a route while it is open; null means "the current brand". */
  scope: TapToPayScope | null;
  acceptance: TapToPayAcceptance;
  /** The brand `acceptance` is about. Another brand always reads as unknown. */
  acceptanceBrandId: string | null;
  /** A reader is connected, so the next sale starts warm. */
  readerReady: boolean;
  /** Reader software installing, with progress 0 to 1 when the SDK reports it. */
  config: { installing: boolean; progress: number | null };
}

const noop = (): void => undefined;

const INITIAL: TapToPaySessionState = {
  status: "unavailable",
  client: null,
  errorMessage: null,
  retryInitialize: noop,
  scope: null,
  acceptance: "unknown",
  acceptanceBrandId: null,
  readerReady: false,
  config: { installing: false, progress: null },
};

/** Beta.33 reports progress as a string. Anything not a number reads as unknown. */
export const parseTapProgress = (progress: unknown): number | null => {
  if (progress === null || progress === undefined || progress === "") return null;
  const value = Number(progress);
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
};

let state: TapToPaySessionState = INITIAL;
const listeners = new Set<() => void>();

export const getTapToPaySession = (): TapToPaySessionState => state;

export const subscribeTapToPaySession = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Host only: publish what the SDK is doing. */
export const updateTapToPaySession = (patch: Partial<TapToPaySessionState>): void => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

/** A route says which brand and event the session serves while it is open. */
export const setTapToPayScope = (scope: TapToPayScope | null): void => {
  updateTapToPaySession({ scope });
};

/** What this session knows about a brand's terms. */
export const tapToPayAcceptanceFor = (
  session: Pick<TapToPaySessionState, "acceptance" | "acceptanceBrandId">,
  brandId: string | null | undefined,
): TapToPayAcceptance =>
  brandId !== null && brandId !== undefined && session.acceptanceBrandId === brandId
    ? session.acceptance
    : "unknown";

/** Apple's "terms not accepted" (native 3930). */
export const TERMS_NOT_ACCEPTED_NATIVE_CODE = "3930";

/** Record what a connect attempt just told us about Apple's terms. */
export const noteTapToPayConnectResult = (
  brandId: string,
  error: TerminalErrorLike | undefined,
): void => {
  if (error === undefined) {
    updateTapToPaySession({ acceptance: "accepted", acceptanceBrandId: brandId });
  } else if (String(error.nativeErrorCode) === TERMS_NOT_ACCEPTED_NATIVE_CODE) {
    updateTapToPaySession({ acceptance: "not_accepted", acceptanceBrandId: brandId });
  }
};

/** Same API the screens have always had. */
export const useTapToPayTerminal = (): TapToPaySessionState =>
  useSyncExternalStore(subscribeTapToPaySession, getTapToPaySession, getTapToPaySession);

/** Test seam. */
export const resetTapToPaySessionForTests = (): void => {
  state = INITIAL;
  listeners.clear();
};
