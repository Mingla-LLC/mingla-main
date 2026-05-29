// ORCH-0987: extracted from ConnectionsPage so both the Connections screen and the
// shared friend-actions hook run the SAME pre-remove/pre-block cleanup (Constitution #2).
// When you remove or block a friend, any collaboration session that would be left with
// <= 2 participants (i.e. just the two of you) is deleted along with its invites.
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
    for (const sessionId of sharedSessionIds) {
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
