import { supabase } from "./supabase";

export interface BoardSessionData {
  id: string;
  name: string;
  type:
    | "date-night"
    | "group-hangout"
    | "adventure"
    | "wellness"
    | "food-tour"
    | "cultural";
  description: string;
  participants: Array<{
    id: string;
    name: string;
    status: string;
    lastActive?: string;
  }>;
  status: "active" | "voting" | "locked" | "completed";
  voteDeadline?: string;
  finalizedDate?: string;
  cardsCount: number;
  createdAt: string;
  unreadMessages: number;
  lastActivity: string;
  icon: any;
  gradient: string;
  creatorId: string;
  admins: string[];
  currentUserId: string;
  sessionId?: string;
  session_id?: string;
}

class BoardSessionService {
  /**
   * Fetch all board sessions where the user is a participant
   */
  static async fetchUserBoardSessions(
    userId: string
  ): Promise<BoardSessionData[]> {
    try {
      // 1. Get all session IDs where user is a participant AND has accepted the invite
      // Only show boards where the user has explicitly accepted participation
      const { data: participations, error: participationError } = await supabase
        .from("session_participants")
        .select("session_id, joined_at, has_accepted")
        .eq("user_id", userId)
        .eq("has_accepted", true);

      if (participationError) {
        console.error("❌ Error fetching participations:", participationError);
        return [];
      }

      if (!participations || participations.length === 0) {
        console.log("⚠️ No participations found for user");
        return [];
      }

      const sessionIds = participations.map((p) => p.session_id);

      // 2. First, get all collaboration sessions (without filtering by session_type) to see what we have
      const { data: allSessions, error: allSessionsError } = await supabase
        .from("collaboration_sessions")
        .select("*")
        .in("id", sessionIds);

      if (allSessionsError) {
        console.error("❌ Error fetching all sessions:", allSessionsError);
      }

      // 3. Filter for active board sessions only
      // A session becomes "active" when at least one user accepts the invite
      // Only show sessions that are not archived AND have status 'active'
      const sessions = (allSessions || []).filter((s) => {
        const notArchived = s.archived_at === null;
        const isActive = s.status === "active";

        return notArchived && isActive;
      });

      if (!sessions || sessions.length === 0) {
        console.log(
          "⚠️ No board sessions found. Session types found:",
          allSessions?.map((s) => ({
            id: s.id,
            name: s.name,
            session_type: s.session_type,
            archived_at: s.archived_at,
          }))
        );
        return [];
      }

      // 4. For each session, get participants and card count

      const boardSessionsData: BoardSessionData[] = await Promise.all(
        sessions.map(async (session) => {
          // Get participants with admin status
          const { data: participantsData, error: participantsError } =
            await supabase
              .from("session_participants")
              .select(
                `
              user_id,
              joined_at,
              has_accepted,
              is_admin,
              profiles (
                id,
                username,
                display_name,
                first_name,
                last_name,
                avatar_url
              )
            `
              )
              .eq("session_id", session.id)
              .eq("has_accepted", true);

          const participants = (participantsData || []).map((p: any) => {
            const profile = p.profiles;
            const displayName =
              profile?.display_name ||
              `${profile?.first_name || ""} ${
                profile?.last_name || ""
              }`.trim() ||
              profile?.username ||
              "Unknown";

            return {
              id: p.user_id,
              name: displayName,
              status: "online", // TODO: Implement actual online status
              lastActive: p.joined_at
                ? new Date(p.joined_at).toISOString()
                : undefined,
            };
          });

          // Get card count - count board_saved_cards linked to this session
          let cardsCount = 0;

          const { count: boardCardsCount, error: boardCardsError } =
            await supabase
              .from("board_saved_cards")
              .select("*", { count: "exact", head: true })
              .eq("session_id", session.id);

          if (!boardCardsError && boardCardsCount !== null) {
            cardsCount = boardCardsCount;
          }

          // Determine status based on session status
          // Map database status to board status - show all statuses
          let boardStatus: "active" | "voting" | "locked" | "completed" =
            "active";

          // Map database status to board status
          if (session.status === "completed" || session.status === "archived") {
            boardStatus = "completed";
          } else if (session.status === "locked") {
            boardStatus = "locked";
          } else if (session.status === "voting") {
            boardStatus = "voting";
          } else if (session.status === "active") {
            boardStatus = "active";
          } else if (
            session.status === "pending" ||
            session.status === "dormant"
          ) {
            // Map pending/dormant sessions to 'active' so they show up
            boardStatus = "active";
          } else {
            // Default to active for any other status
            boardStatus = "active";
          }

          // Map session_type to board type
          const typeMap: {
            [key: string]:
              | "date-night"
              | "group-hangout"
              | "adventure"
              | "wellness"
              | "food-tour"
              | "cultural";
          } = {
            "date-night": "date-night",
            "group-hangout": "group-hangout",
            adventure: "adventure",
            wellness: "wellness",
            "food-tour": "food-tour",
            cultural: "cultural",
          };

          const boardType = typeMap[session.session_type] || "group-hangout";

          // Get admins: creator is always admin, plus any participants with is_admin = true
          const admins: string[] = [session.created_by];
          (participantsData || []).forEach((p: any) => {
            if (p.is_admin && !admins.includes(p.user_id)) {
              admins.push(p.user_id);
            }
          });

          // Format dates
          const createdAt = session.created_at
            ? this.formatRelativeTime(new Date(session.created_at))
            : "Unknown";

          const lastActivity = session.last_activity_at
            ? this.formatRelativeTime(new Date(session.last_activity_at))
            : createdAt;

          return {
            id: session.id,
            name: session.name,
            type: boardType,
            description: `Collaboration board: ${session.name}`,
            participants,
            status: boardStatus,
            cardsCount,
            createdAt,
            unreadMessages: 0, // TODO: Implement unread messages count
            lastActivity,
            icon: this.getIconForType(boardType),
            gradient: this.getGradientForType(boardType),
            creatorId: session.created_by,
            admins,
            currentUserId: userId,
            sessionId: session.id,
            session_id: session.id,
          } as BoardSessionData;
        })
      );

      return boardSessionsData;
    } catch (error) {
      console.error("❌ Error in fetchUserBoardSessions:", error);
      return [];
    }
  }

  /**
   * Format date to relative time string
   */
  private static formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  }

  /**
   * Get icon name for board type
   */
  private static getIconForType(type: string): string {
    const iconMap: { [key: string]: string } = {
      "date-night": "heart",
      "group-hangout": "people",
      adventure: "compass",
      wellness: "leaf",
      "food-tour": "restaurant",
      cultural: "library",
    };
    return iconMap[type] || "calendar";
  }

  /**
   * Get gradient for board type
   */
  private static getGradientForType(type: string): string {
    const gradientMap: { [key: string]: string } = {
      "date-night": "from-pink-500 to-rose-500",
      "group-hangout": "from-blue-500 to-cyan-500",
      adventure: "from-green-500 to-emerald-500",
      wellness: "from-purple-500 to-pink-500",
      "food-tour": "from-orange-500 to-red-500",
      cultural: "from-indigo-500 to-purple-500",
    };
    return gradientMap[type] || "from-gray-500 to-gray-600";
  }
}

export { BoardSessionService };
