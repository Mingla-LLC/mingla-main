import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  listBrandGroups,
  type BrandGroupSummary,
} from "../services/brandGroupsService";

export function useBrandGroups(): {
  groups: BrandGroupSummary[];
  loading: boolean;
  error: string | null;
  unreadCount: number;
  refresh: () => Promise<void>;
} {
  const { user } = useAuth();
  const [groups, setGroups] = useState<BrandGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!user?.id) {
      setGroups([]);
      setLoading(false);
      return;
    }
    try {
      const result = await listBrandGroups();
      if (result.error) throw new Error(result.error);
      setGroups(result.groups);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load Brand groups");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`brand-groups:list:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        void refresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "brand_group_reads" }, () => {
        void refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh, user?.id]);

  const unreadCount = useMemo(
    () => groups.reduce((total, group) => total + group.unread_count, 0),
    [groups],
  );

  return { groups, loading, error, unreadCount, refresh };
}
