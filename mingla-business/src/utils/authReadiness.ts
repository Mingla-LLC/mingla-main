export type BusinessAuthStatus =
  | "bootstrapping"
  | "signed_out"
  | "signed_in_ready"
  | "refreshing"
  | "error";

export type BusinessAuthErrorCode =
  | "auth_not_ready"
  | "signed_out"
  | "unauthenticated";

export interface MinimalAuthSession {
  access_token?: string | null;
}

export interface MinimalAuthUser {
  id?: string | null;
}

export class BusinessAuthNotReadyError extends Error {
  code: BusinessAuthErrorCode;
  authStatus?: BusinessAuthStatus;

  constructor(
    code: BusinessAuthErrorCode,
    message: string,
    authStatus?: BusinessAuthStatus,
  ) {
    super(message);
    this.name = "BusinessAuthNotReadyError";
    this.code = code;
    this.authStatus = authStatus;
  }
}

export const hasUsableBusinessSession = (
  session: MinimalAuthSession | null,
): boolean =>
  typeof session?.access_token === "string" &&
  session.access_token.trim().length > 0;

export const deriveBusinessAuthStatus = ({
  authError,
  loading,
  session,
  user,
}: {
  authError: Error | null;
  loading: boolean;
  session: MinimalAuthSession | null;
  user: MinimalAuthUser | null;
}): BusinessAuthStatus => {
  if (loading) {
    return hasUsableBusinessSession(session) && user !== null
      ? "refreshing"
      : "bootstrapping";
  }
  if (authError !== null) return "error";
  if (hasUsableBusinessSession(session) && typeof user?.id === "string") {
    return "signed_in_ready";
  }
  return "signed_out";
};

export const isBusinessAuthReady = (
  authStatus: BusinessAuthStatus,
  session: MinimalAuthSession | null,
): boolean =>
  authStatus === "signed_in_ready" && hasUsableBusinessSession(session);

export const businessAuthErrorCodeForStatus = (
  authStatus: BusinessAuthStatus,
): BusinessAuthErrorCode =>
  authStatus === "signed_out" ? "signed_out" : "auth_not_ready";

export const requireBusinessAuthReady = (
  authStatus: BusinessAuthStatus,
  session: MinimalAuthSession | null,
): void => {
  if (isBusinessAuthReady(authStatus, session)) return;
  const code = businessAuthErrorCodeForStatus(authStatus);
  throw new BusinessAuthNotReadyError(
    code,
    code === "signed_out"
      ? "Sign in before continuing."
      : "Finishing sign-in. Try again in a moment.",
    authStatus,
  );
};

export const isSupabaseAuthSessionMissingError = (error: unknown): boolean => {
  if (error === null || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown; code?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  const code = typeof record.code === "string" ? record.code : "";
  return (
    name === "AuthSessionMissingError" ||
    code === "session_not_found" ||
    /auth session missing/i.test(message)
  );
};

export const isBusinessAuthNotReadyError = (
  error: unknown,
): error is BusinessAuthNotReadyError =>
  error instanceof BusinessAuthNotReadyError ||
  (error !== null &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "BusinessAuthNotReadyError" &&
    typeof (error as { code?: unknown }).code === "string");

export const toBusinessAuthNotReadyError = (
  error: unknown,
): BusinessAuthNotReadyError | null => {
  if (isBusinessAuthNotReadyError(error)) return error;
  if (isSupabaseAuthSessionMissingError(error)) {
    return new BusinessAuthNotReadyError(
      "auth_not_ready",
      "Finishing sign-in. Try again in a moment.",
    );
  }
  return null;
};
