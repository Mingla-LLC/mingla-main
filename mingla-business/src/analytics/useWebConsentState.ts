export type WebConsentState =
  | "unknown"
  | "unresolved"
  | "granted"
  | "denied"
  | "not_applicable";

/** Native exclusion: browser consent state does not exist on either native app. */
export function useWebConsentState(): WebConsentState {
  return "not_applicable";
}
