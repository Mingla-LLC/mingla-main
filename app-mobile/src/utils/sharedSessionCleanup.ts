// ORCH-0987: extracted from ConnectionsPage so both the Connections screen and the
// shared friend-actions hook run the SAME pre-remove/pre-block cleanup (Constitution #2).
// When you remove or block a friend, a 1:1 collab you share (a session started inside
// your 1:1 chat, collaboration_sessions.conversation_id set) is deleted along with its
// invites. Issue #4435: group chats are never deleted here; a group only ends when its
// last member leaves.
import { supabase } from "../services/supabase";

export async function cleanupSharedSessions(
  currentUserId: string,
  otherUserId: string,
): Promise<void> {
  try {
    if (!currentUserId) return;
    const { data: otherUserSessions, error: fetchError } = await supabase
      .from("session_participants")
      .select("session_id")
      .eq("user_id", otherUserId);
    if (fetchError || !otherUserSessions?.length) return;

    const sessionIds = otherUserSessions.map((s: { session_id: string }) => s.session_id);
    const { data: mySharedSessions, error: myError } = await supabase
      .from("session_participants")
      .select("session_id")
      .eq("user_id", currentUserId)
      .in("session_id", sessionIds);
    if (myError || !mySharedSessions?.length) return;

    const sharedSessionIds = mySharedSessions.map((s: { session_id: string }) => s.session_id);
    const { data: oneToOneSessions, error: kindError } = await supabase
      .from("collaboration_sessions")
      .select("id")
      .in("id", sharedSessionIds)
      .not("conversation_id", "is", null);
    if (kindError || !oneToOneSessions?.length) return;
    for (const { id: sessionId } of oneToOneSessions as { id: string }[]) {
      const { count, error: countError } = await supabase
        .from("session_participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);
      if (countError) continue;
      if (count !== null && count <= 2) {
        await supabase.from("collaboration_invites").delete().eq("session_id", sessionId);
        await supabase.from("collaboration_sessions").delete().eq("id", sessionId);
      }
    }
  } catch (e) {
    console.error("[cleanupSharedSessions] error:", e);
  }
}
