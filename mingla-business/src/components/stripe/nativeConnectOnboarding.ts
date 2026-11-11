/**
 * #4389 (decision S-11) — which surface the Host app uses for the payment
 * partner's secure setup on a phone: the NATIVE in-app screen or today's
 * pop-up browser sheet.
 *
 * MINGLA-INVARIANT: I-4389-NATIVE-CONNECT-KILL-SWITCH | issue #4389 | The native secure setup screen opens only when the server switch biz_native_connect_onboarding is on for the phone's platform (or a local, non-EAS dev override), the native module is linked, and the screen has not reported a load error. Every other case (web, flag off, flag unread, module missing, load error) uses the browser sheet. Enforced by issue_4389_native_connect_onboarding.implementor.test.ts.
 *
 * Pure: no React, no native imports, so every fallback branch is unit-tested.
 */

export type ConnectOnboardingSurface = "native" | "browser";

export interface NativeConnectReleaseAnswer {
  iphone: boolean;
  android: boolean;
}

/** The terms, privacy and collection settings shared with the web page. */
export const CONNECT_ONBOARDING_TERMS_URL =
  "https://www.usemingla.com/terms-of-service/" as const;
export const CONNECT_ONBOARDING_PRIVACY_URL =
  "https://www.usemingla.com/privacy-policy/" as const;
export const CONNECT_ONBOARDING_COLLECTION_OPTIONS = {
  fields: "eventually_due",
  futureRequirements: "include",
} as const;

/** Server switch, read per platform. Unknown platforms and no answer are off. */
export const nativeConnectFlagLive = (
  os: string,
  answer: NativeConnectReleaseAnswer | null | undefined,
): boolean => {
  if (os === "ios") return answer?.iphone === true;
  if (os === "android") return answer?.android === true;
  return false;
};

export interface ConnectOnboardingSurfaceInput {
  os: string;
  /** The server switch for this platform (already resolved). */
  flagLive: boolean;
  /** Local, non-EAS dev override baked in by app.config.js. */
  devForce: boolean;
  /** The native module and view are linked into this binary. */
  moduleAvailable: boolean;
  /** The native screen already failed to load once in this attempt. */
  loadFailed: boolean;
}

export const decideConnectOnboardingSurface = (
  input: ConnectOnboardingSurfaceInput,
): ConnectOnboardingSurface => {
  if (input.os !== "ios" && input.os !== "android") return "browser";
  if (!input.moduleAvailable) return "browser";
  if (input.loadFailed) return "browser";
  if (!input.flagLive && !input.devForce) return "browser";
  return "native";
};

/**
 * What leaving the secure setup (native screen or browser sheet) from brand
 * setup means. "finished" goes on to "You're all set" (F4, which reads the
 * account live); "closed-early" returns to Get paid with K1 "Only free events
 * for now?".
 *
 * #4389 P2 — "needs information" used to count as finished, so closing the
 * secure setup early never showed K1. Only details that are submitted (or
 * pending verification) finish the visit now.
 */
export type NativeConnectExit = "finished" | "closed-early";

export const classifyNativeConnectExit = (
  outcome:
    | "complete-active"
    | "complete-verifying"
    | "needs-information"
    | "failed-stripe"
    | "session-expired",
): NativeConnectExit =>
  outcome === "complete-active" || outcome === "complete-verifying" || outcome === "failed-stripe"
    ? "finished"
    : "closed-early";

/**
 * The live account read after the secure setup closes (`refresh_status`,
 * the same read F4 makes). Submitted — nothing due, or pending verification —
 * finishes; anything still due, or nothing started, is an early close.
 */
export const setupExitFromRefreshState = (
  state: "submitted" | "action_needed" | "not_started",
): NativeConnectExit => (state === "submitted" ? "finished" : "closed-early");

/** Extracts a readable message from the SDK's onLoadError payload. */
export const nativeConnectLoadErrorMessage = (event: unknown): string => {
  if (typeof event === "object" && event !== null && "error" in event) {
    const error = (event as { error?: { message?: unknown; type?: unknown } }).error;
    const message = typeof error?.message === "string" ? error.message : "";
    if (message.length > 0) return message;
    if (typeof error?.type === "string" && error.type.length > 0) return error.type;
  }
  return "load_error";
};
