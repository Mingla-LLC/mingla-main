// #4435: who takes over a session when its creator's account is deleted.
// The database owns the rule (issue_4435_hand_over_creator: the
// longest-standing admin, else the longest-standing member); this module
// only asks it, once per session the leaving user created.

export interface HandoverRpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface HandoverClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<HandoverRpcResult>;
  updateCreator(sessionId: string, newOwner: string): PromiseLike<{ error: { message?: string } | null }>;
}

// The database function is missing until migration 20280710004435 is applied.
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883";
}

/**
 * Hands each session to its heir. `legacyHeirs` is the old in-function pick
 * (the oldest accepted participant), used only while the database function
 * is missing.
 * [TRANSITIONAL] legacy fallback — remove once 20280710004435 is applied in production.
 */
export async function handOverOwnedSessions(
  client: HandoverClient,
  leavingUserId: string,
  ownedSessionIds: readonly string[],
  legacyHeirs: ReadonlyMap<string, string>,
  warn: (message: string) => void,
): Promise<number> {
  let handed = 0;
  for (const sessionId of ownedSessionIds) {
    const { data, error } = await client.rpc("issue_4435_hand_over_creator", {
      p_session_id: sessionId,
      p_leaving: leavingUserId,
    });
    if (!error) {
      if (typeof data === "string" && data.length > 0) handed += 1;
      continue;
    }
    if (!isMissingFunction(error)) {
      warn(`[delete-user] Session ${sessionId} handover failed: ${error.message ?? "unknown"}`);
      continue;
    }
    const heir = legacyHeirs.get(sessionId);
    if (!heir) continue;
    const { error: updateError } = await client.updateCreator(sessionId, heir);
    if (updateError) {
      warn(`[delete-user] Session ${sessionId} transfer failed: ${updateError.message ?? "unknown"}`);
    } else {
      handed += 1;
    }
  }
  return handed;
}
