import { useState, useCallback, useEffect } from "react";
import { userActivityService, UserActivityRecord } from "../services/userActivityService";
import { supabase } from "../services/supabase";

const DEFAULT_LIMIT = 20;

export function useRecentActivity(limit: number = DEFAULT_LIMIT) {
  const [activities, setActivities] = useState<UserActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecentActivity = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setActivities([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const list = await userActivityService.fetchRecentActivity(user.id, limit);
      setActivities(list);
    } catch (e) {
      console.error("Error fetching recent activity:", e);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchRecentActivity();
  }, [fetchRecentActivity]);

  return { activities, loading, refetch: fetchRecentActivity };
}
