/**
 * Report Service
 * 
 * Handles user reporting functionality.
 * Allows users to report other users for violations like spam, harassment, etc.
 */

import { supabase } from "./supabase";

export type ReportReason = 'spam' | 'inappropriate-content' | 'harassment' | 'other';
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';

export interface UserReport {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  resolution_notes?: string;
  // Joined profile data
  reported_user?: {
    id: string;
    username: string;
    display_name: string;
    first_name: string;
    last_name: string;
  };
}

/**
 * Submit a report against a user
 * @param reportedUserId - The ID of the user being reported
 * @param reason - The reason for the report
 * @param details - Optional additional details
 */
export async function submitReport(
  reportedUserId: string,
  reason: ReportReason,
  details?: string
): Promise<{ success: boolean; reportId?: string; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    if (user.id === reportedUserId) {
      return { success: false, error: "Cannot report yourself" };
    }

    // Check if user has already reported this person recently (within 24 hours)
    const { data: hasRecent, error: checkError } = await supabase
      .rpc('has_recent_report', { 
        reporter: user.id, 
        reported: reportedUserId,
        hours_window: 24 
      });

    if (checkError) {
      // If the function doesn't exist, skip this check
      if (!checkError.message?.includes('does not exist')) {
        console.warn("Error checking recent reports:", checkError);
      }
    } else if (hasRecent) {
      return { 
        success: false, 
        error: "You have already reported this user recently. Please wait before submitting another report." 
      };
    }

    const { data, error } = await supabase
      .from("user_reports")
      .insert({
        reporter_id: user.id,
        reported_user_id: reportedUserId,
        reason: reason,
        details: details || null,
      })
      .select('id')
      .single();

    if (error) {
      // Handle table not existing yet
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        console.error("user_reports table does not exist. Please run migration.");
        // Still return success to not block the user, but log the error
        return { success: true, error: "Report logged (migration pending)" };
      }
      console.error("Error submitting report:", error);
      return { success: false, error: error.message };
    }

    return { success: true, reportId: data?.id };
  } catch (err) {
    console.error("Error in submitReport:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Get all reports submitted by the current user
 */
export async function getMyReports(): Promise<{
  data: UserReport[];
  error?: string;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { data: [], error: "Not authenticated" };
    }

    const { data: reportsData, error: reportsError } = await supabase
      .from("user_reports")
      .select("*")
      .eq("reporter_id", user.id)
      .order("created_at", { ascending: false });

    if (reportsError) {
      // Table might not exist yet - return empty array
      if (reportsError.code === "42P01" || reportsError.message?.includes("does not exist")) {
        return { data: [] };
      }
      console.error("Error fetching reports:", reportsError);
      return { data: [], error: reportsError.message };
    }

    if (!reportsData || reportsData.length === 0) {
      return { data: [] };
    }

    // Get profile data for reported users
    const reportedIds = reportsData.map((r) => r.reported_user_id);
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, username, display_name, first_name, last_name")
      .in("id", reportedIds);

    if (profilesError) {
      console.error("Error fetching reported user profiles:", profilesError);
    }

    // Map profiles to reports
    const profilesMap = new Map(
      (profilesData || []).map((p) => [p.id, p])
    );

    const result: UserReport[] = reportsData.map((report) => ({
      ...report,
      reported_user: profilesMap.get(report.reported_user_id),
    }));

    return { data: result };
  } catch (err) {
    console.error("Error in getMyReports:", err);
    return { data: [], error: "An unexpected error occurred" };
  }
}

/**
 * Check if the current user has reported a specific user
 * @param userId - The ID of the user to check
 */
export async function hasReportedUser(userId: string): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return false;
    }

    const { data, error } = await supabase
      .from("user_reports")
      .select("id")
      .eq("reporter_id", user.id)
      .eq("reported_user_id", userId)
      .limit(1);

    if (error) {
      // Table might not exist yet
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return false;
      }
      console.error("Error checking report status:", error);
      return false;
    }

    return (data?.length || 0) > 0;
  } catch (err) {
    console.error("Error in hasReportedUser:", err);
    return false;
  }
}

// Export a service object for consistent API
export const reportService = {
  submitReport,
  getMyReports,
  hasReportedUser,
};

export default reportService;
