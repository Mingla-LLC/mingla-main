/**
 * #4445: a profile read that was already in flight when the person signed out comes back
 * "42501 permission denied for table profiles". That is the sign-out, not a failure.
 * Only that exact case is ignored: the code must be 42501 AND the live session must be
 * gone (or belong to someone else). Everything else stays a real error.
 */
export function isSignedOutProfileError(
  error: { code?: string | null } | null | undefined,
  expectedUserId: string,
  liveUserId: string | null | undefined,
): boolean {
  return error?.code === '42501' && liveUserId !== expectedUserId;
}
