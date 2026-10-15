/**
 * #3720 Slice G — React Query hooks for Host Community surface.
 *
 * Server state in React Query (Const #5). Key factory only; mutations
 * invalidate the matching lists / counts.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  countUnreadAnnouncements,
  fetchSupportIsOnline,
  getCommunityEmailPrefEnabled,
  listPublishedAnnouncements,
  listPublicRoadmap,
  markAnnouncementRead,
  setCommunityEmailPref,
  type CommunityAnnouncement,
  type CommunityRoadmapCard,
} from "../services/communityService";

const STALE_MS = 30 * 1000;

export const communityKeys = {
  all: ["community"] as const,
  announcements: (userId: string) =>
    ["community", "announcements", userId] as const,
  unread: (userId: string) => ["community", "unread", userId] as const,
  roadmap: (userId: string) => ["community", "roadmap", userId] as const,
  emailPref: (userId: string) => ["community", "emailPref", userId] as const,
  supportOnline: ["community", "supportOnline"] as const,
};

const DISABLED = ["community", "disabled"] as const;

export function useCommunityAnnouncements(): {
  data: CommunityAnnouncement[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
} {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = isAuthReady && userId !== null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: enabled ? communityKeys.announcements(userId) : DISABLED,
    enabled,
    staleTime: STALE_MS,
    queryFn: listPublishedAnnouncements,
  });

  return { data: data ?? [], isLoading, isError, refetch };
}

export function useCommunityUnreadCount(): {
  count: number;
  isLoading: boolean;
} {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = isAuthReady && userId !== null;

  const { data, isLoading } = useQuery({
    queryKey: enabled ? communityKeys.unread(userId) : DISABLED,
    enabled,
    staleTime: STALE_MS,
    queryFn: countUnreadAnnouncements,
  });

  return { count: data ?? 0, isLoading };
}

export function useCommunityRoadmap(): {
  data: CommunityRoadmapCard[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
} {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = isAuthReady && userId !== null;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: enabled ? communityKeys.roadmap(userId) : DISABLED,
    enabled,
    staleTime: STALE_MS,
    queryFn: listPublicRoadmap,
  });

  return { data: data ?? [], isLoading, isError, refetch };
}

export function useCommunityEmailPref(): {
  enabled: boolean;
  isLoading: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  isSaving: boolean;
} {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const queryEnabled = isAuthReady && userId !== null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryEnabled ? communityKeys.emailPref(userId) : DISABLED,
    enabled: queryEnabled,
    staleTime: STALE_MS,
    queryFn: getCommunityEmailPrefEnabled,
  });

  const mutation = useMutation({
    mutationFn: setCommunityEmailPref,
    onSuccess: (_void, next) => {
      if (userId !== null) {
        queryClient.setQueryData(communityKeys.emailPref(userId), next);
      }
    },
  });

  return {
    enabled: data ?? true,
    isLoading,
    setEnabled: async (next: boolean): Promise<void> => {
      await mutation.mutateAsync(next);
    },
    isSaving: mutation.isPending,
  };
}

export function useSupportIsOnline(): {
  online: boolean;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
} {
  const { isAuthReady, user } = useAuth();
  const enabled = isAuthReady && user !== null;

  const { data, isLoading, refetch } = useQuery({
    queryKey: communityKeys.supportOnline,
    enabled,
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
    queryFn: fetchSupportIsOnline,
  });

  return { online: data === true, isLoading, refetch };
}

export function useMarkAnnouncementRead(): {
  markRead: (announcementId: string) => Promise<void>;
} {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: markAnnouncementRead,
    onSuccess: (_void, announcementId) => {
      if (user === null) return;
      const uid = user.id;
      queryClient.setQueryData<CommunityAnnouncement[]>(
        communityKeys.announcements(uid),
        (prev) =>
          (prev ?? []).map((a) =>
            a.id === announcementId
              ? { ...a, read_at: a.read_at ?? new Date().toISOString() }
              : a,
          ),
      );
      void queryClient.invalidateQueries({
        queryKey: communityKeys.unread(uid),
      });
    },
  });

  return {
    markRead: async (announcementId: string): Promise<void> => {
      await mutation.mutateAsync(announcementId);
    },
  };
}
