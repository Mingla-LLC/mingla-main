// Issue #4423 (W1.2): what AuthContext does with a Supabase auth event.
//
// auth-js turns every hidden -> visible change into a SIGNED_IN for the same
// person, and echoes it to every other tab over BroadcastChannel. Before #4423
// each one re-rendered the whole app (setSession) and re-checked access (two
// RPCs), hidden tabs included. Now an event for the person already accepted
// is ignored: access is re-checked only by the 30 s timer and the page-return
// signal, both through pollGate. A different person, no session, or a user
// update still goes through resolveSession, unchanged.
//
// Pure, so node:test can pin it.

/**
 * @param {{ event: string, sessionUserId: string|null|undefined, acceptedUserId: string|null|undefined, visible: boolean }} input
 * @returns {"ignore" | "resolve"}
 */
export function decideAuthEvent({ event, sessionUserId, acceptedUserId, visible } = {}) {
  // Signed out, or a session with no user: the full path clears everything.
  if (!sessionUserId) return "resolve";
  // Nobody accepted yet, or a different person: the full path decides.
  if (!acceptedUserId || sessionUserId !== acceptedUserId) return "resolve";
  // The same person changed their details: re-read through the full path.
  if (event === "USER_UPDATED") return "resolve";
  // The same person, hidden tab (a cross-tab echo) or a SIGNED_IN /
  // TOKEN_REFRESHED / INITIAL_SESSION for a session we already hold: the
  // supabase client keeps its own tokens, nothing on screen changes.
  void visible;
  return "ignore";
}

// #4423 (hidden flaw 2): two access answers are the same when email, role,
// status and the SET of areas match. Areas compare as sorted copies, so a
// server answer in a different order keeps the same `access` object (and no
// hook keyed on it recomputes).
export function sameAccess(a, b) {
  if (!a || !b) return false;
  if (a.email !== b.email || a.role !== b.role || a.status !== b.status) return false;
  if (!Array.isArray(a.areas) || !Array.isArray(b.areas) || a.areas.length !== b.areas.length) return false;
  const x = [...a.areas].sort();
  const y = [...b.areas].sort();
  return x.every((area, i) => area === y[i]);
}
