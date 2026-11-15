import { supabase } from './supabase';

export interface BoardInvite {
  id: string;
  session_id: string;
  inviter_id: string;
  invited_user_id: string;
  invite_method: 'friends_list' | 'link' | 'qr_code' | 'invite_code';
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  expires_at?: string;
  accepted_at?: string;
  created_at: string;
}

export interface InviteLinkData {
  sessionId: string;
  inviteCode: string;
  inviteLink: string;
}

export class BoardInviteService {
  /**
   * Generate invite link for a session
   */
  static async generateInviteLink(sessionId: string): Promise<InviteLinkData | null> {
    try {
      const { data: session, error } = await supabase
        .from('collaboration_sessions')
        .select('id, invite_code, invite_link')
        .eq('id', sessionId)
        .single();

      if (error) throw error;

      // Generate invite link if not present
      let inviteLink = session.invite_link;
      if (!inviteLink && session.invite_code) {
        // Use deep linking format for the app
        inviteLink = `mingla://board/${session.invite_code}`;
        // Also support web format if needed
        // inviteLink = `https://mingla.app/board/${session.invite_code}`;
      }

      return {
        sessionId: session.id,
        inviteCode: session.invite_code || '',
        inviteLink: inviteLink || '',
      };
    } catch (error) {
      console.error('Error generating invite link:', error);
      return null;
    }
  }

  /**
   * Get invite code for a session
   */
  static async getInviteCode(sessionId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('collaboration_sessions')
        .select('invite_code')
        .eq('id', sessionId)
        .single();

      if (error) throw error;

      return data?.invite_code || null;
    } catch (error) {
      console.error('Error getting invite code:', error);
      return null;
    }
  }

  // #4436: joinByInviteCode / joinByInviteLink deleted. They had no caller and
  // inserted an uninvited pending member row; the group link
  // (join_group_by_link) is the one join path.

  // ORCH-0666: sendFriendInvites zombie DELETED (CF-1).
  // The canonical flow is now `sessionMembershipService.addFriendsToSessions`,
  // which routes through the atomic `add_friend_to_session` SECURITY DEFINER RPC.
  // Direct INSERTs into collaboration_invites from mobile code are forbidden
  // going forward (I-INVITE-CREATION-IS-RPC-ONLY, CI grep gate enforced).

  /**
   * Get pending invites for a user
   */
  static async getPendingInvites(userId: string): Promise<BoardInvite[]> {
    try {
      const { data, error } = await supabase
        .from('collaboration_invites')
        .select(`
          *,
          collaboration_sessions (
            id,
            name,
            session_type,
            created_by
          ),
          profiles!collaboration_invites_inviter_id_fkey (
            id,
            display_name,
            username,
            avatar_url
          )
        `)
        .eq('invited_user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error getting pending invites:', error);
      return [];
    }
  }

  // ORCH-0443: acceptInvite deleted. Use collaborationInviteService.acceptCollaborationInvite instead.

  /**
   * Decline an invite
   */
  static async declineInvite(inviteId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('collaboration_invites')
        .update({ status: 'declined' })
        .eq('id', inviteId)
        .eq('invited_user_id', userId);

      if (error) throw error;

      return { success: true };
    } catch (error: any) {
      console.error('Error declining invite:', error);
      return { success: false, error: error.message || 'Failed to decline invite' };
    }
  }
}

