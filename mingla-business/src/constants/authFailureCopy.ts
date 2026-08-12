export type AuthFailureCopyKey =
  | "auth:welcome.sign_in_failed_title"
  | "auth:welcome.sign_in_failed_body"
  | "auth:welcome.sign_in_failed_ok"
  | "auth:welcome.sign_in_offline_title"
  | "auth:welcome.sign_in_offline_body"
  | "auth:welcome.sign_in_retry_exhausted_title"
  | "auth:welcome.sign_in_retry_exhausted_body"
  | "auth:welcome.sign_in_permanent_body";

const AUTH_FAILURE_COPY: Readonly<Record<AuthFailureCopyKey, string>> =
  Object.freeze({
    "auth:welcome.sign_in_failed_title": "Couldn't sign you in",
    "auth:welcome.sign_in_failed_body":
      "Something didn't connect. Give it another tap.",
    "auth:welcome.sign_in_failed_ok": "Got it",
    "auth:welcome.sign_in_offline_title": "You're offline",
    "auth:welcome.sign_in_offline_body":
      "We couldn't reach Mingla. Check your connection and give it another tap.",
    "auth:welcome.sign_in_retry_exhausted_title":
      "Still couldn't sign you in",
    "auth:welcome.sign_in_retry_exhausted_body":
      "We tried again and couldn't get through. Check your connection, then give it another tap in a moment.",
    "auth:welcome.sign_in_permanent_body":
      "That didn't work this time. Give it another tap — if it keeps happening, reach us at support@usemingla.com.",
  });

export const resolveAuthFailureCopy = (key: AuthFailureCopyKey): string =>
  AUTH_FAILURE_COPY[key];
