import { describe, expect, test } from "@jest/globals";

import {
  BusinessAuthNotReadyError,
  deriveBusinessAuthStatus,
  hasUsableBusinessSession,
  isBusinessAuthNotReadyError,
  requireBusinessAuthReady,
  toBusinessAuthNotReadyError,
} from "../authReadiness";

describe("auth readiness guards", () => {
  test("requires a non-empty access token before treating auth as usable", () => {
    expect(hasUsableBusinessSession(null)).toBe(false);
    expect(hasUsableBusinessSession({ access_token: "" })).toBe(false);
    expect(hasUsableBusinessSession({ access_token: "token_123" })).toBe(true);
  });

  test("distinguishes bootstrap, ready, signed out, refreshing, and error", () => {
    expect(
      deriveBusinessAuthStatus({
        authError: null,
        loading: true,
        session: null,
        user: null,
      }),
    ).toBe("bootstrapping");
    expect(
      deriveBusinessAuthStatus({
        authError: null,
        loading: true,
        session: { access_token: "token" },
        user: { id: "user_1" },
      }),
    ).toBe("refreshing");
    expect(
      deriveBusinessAuthStatus({
        authError: null,
        loading: false,
        session: { access_token: "token" },
        user: { id: "user_1" },
      }),
    ).toBe("signed_in_ready");
    expect(
      deriveBusinessAuthStatus({
        authError: null,
        loading: false,
        session: null,
        user: null,
      }),
    ).toBe("signed_out");
    expect(
      deriveBusinessAuthStatus({
        authError: new Error("boom"),
        loading: false,
        session: null,
        user: null,
      }),
    ).toBe("error");
  });

  test("throws typed auth-not-ready errors for blocked mutations", () => {
    expect(() => requireBusinessAuthReady("bootstrapping", null)).toThrow(
      BusinessAuthNotReadyError,
    );
    expect(() =>
      requireBusinessAuthReady("signed_in_ready", { access_token: "token" }),
    ).not.toThrow();
  });

  test("maps Supabase AuthSessionMissingError into local typed auth state", () => {
    const error = Object.assign(new Error("Auth session missing!"), {
      name: "AuthSessionMissingError",
    });
    const mapped = toBusinessAuthNotReadyError(error);

    expect(mapped?.code).toBe("auth_not_ready");
    expect(isBusinessAuthNotReadyError(mapped)).toBe(true);
  });
});
