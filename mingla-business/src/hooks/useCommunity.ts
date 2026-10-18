/**
 * #3720 Slice G — React Query hooks for Host Community surface.
 *
 * Server state in React Query (Const #5). Key factory only; mutations
 * invalidate the matching lists / counts.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  acceptCommunityAnswer,
  addCommunityComment,
  appealCommunityModeration,
  blockCommunityAuthor,
  type CommunityAnnouncement,
  type CommunityComment,
  type CommunityPost,
  type CommunityPostKind,
  type CommunityRoadmapCard,
  countUnreadAnnouncements,
  fetchSupportIsOnline,
  getCommunityEmailPrefEnabled,
  listCommunityComments,
  listCommunityPosts,
  listPublicRoadmap,
  listPublishedAnnouncements,
  markAnnouncementRead,
  reportCommunityContent,
  setCommunityEmailPref,
  submitCommunityPost,
  toggleCommunityVote,
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
  posts: (userId: string, kind: CommunityPostKind) =>
    ["community", "posts", userId, kind] as const,
  comments: (userId: string, postId: string) =>
    ["community", "comments", userId, postId] as const,
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
              : a
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

export function useCommunityPosts(kind: CommunityPostKind): {
  data: CommunityPost[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
  submit: (title: string, body: string) => Promise<string>;
  toggleVote: (postId: string) => Promise<void>;
  isSaving: boolean;
} {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = isAuthReady && userId !== null;
  const queryClient = useQueryClient();
  const key = enabled ? communityKeys.posts(userId, kind) : DISABLED;
  const query = useQuery({
    queryKey: key,
    enabled,
    staleTime: STALE_MS,
    queryFn: () => listCommunityPosts(kind),
  });
  const submitMutation = useMutation({
    mutationFn: ({ title, body }: { title: string; body: string }) =>
      submitCommunityPost({ kind, title, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const voteMutation = useMutation({
    mutationFn: toggleCommunityVote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    submit: async (title, body) =>
      (await submitMutation.mutateAsync({ title, body })).review_state,
    toggleVote: async (postId) => {
      await voteMutation.mutateAsync(postId);
    },
    isSaving: submitMutation.isPending || voteMutation.isPending,
  };
}

export function useCommunityComments(postId: string | null): {
  data: CommunityComment[];
  isLoading: boolean;
  add: (body: string) => Promise<void>;
  accept: (commentId: string) => Promise<void>;
  report: (
    targetType: "post" | "comment",
    targetId: string,
    reason: string,
  ) => Promise<void>;
  block: (targetType: "post" | "comment", targetId: string) => Promise<void>;
  appeal: (
    targetType: "post" | "comment",
    targetId: string,
    reason: string,
  ) => Promise<void>;
  isSaving: boolean;
} {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const enabled = isAuthReady && userId !== null && postId !== null;
  const key = enabled ? communityKeys.comments(userId, postId) : DISABLED;
  const query = useQuery({
    queryKey: key,
    enabled,
    staleTime: STALE_MS,
    queryFn: () => listCommunityComments(postId!),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["community", "posts"] });
    await queryClient.invalidateQueries({ queryKey: key });
  };
  const addMutation = useMutation({
    mutationFn: (body: string) => addCommunityComment(postId!, body),
    onSuccess: refresh,
  });
  const acceptMutation = useMutation({
    mutationFn: (commentId: string) =>
      acceptCommunityAnswer(postId!, commentId),
    onSuccess: refresh,
  });
  const reportMutation = useMutation({
    mutationFn: (
      input: {
        targetType: "post" | "comment";
        targetId: string;
        reason: string;
      },
    ) => reportCommunityContent(input.targetType, input.targetId, input.reason),
  });
  const blockMutation = useMutation({
    mutationFn: (input: { targetType: "post" | "comment"; targetId: string }) =>
      blockCommunityAuthor(input.targetType, input.targetId),
    onSuccess: refresh,
  });
  const appealMutation = useMutation({
    mutationFn: (
      input: {
        targetType: "post" | "comment";
        targetId: string;
        reason: string;
      },
    ) =>
      appealCommunityModeration(input.targetType, input.targetId, input.reason),
    onSuccess: refresh,
  });
  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    add: async (body) => {
      await addMutation.mutateAsync(body);
    },
    accept: async (commentId) => {
      await acceptMutation.mutateAsync(commentId);
    },
    report: async (targetType, targetId, reason) => {
      await reportMutation.mutateAsync({ targetType, targetId, reason });
    },
    block: async (targetType, targetId) => {
      await blockMutation.mutateAsync({ targetType, targetId });
    },
    appeal: async (targetType, targetId, reason) => {
      await appealMutation.mutateAsync({ targetType, targetId, reason });
    },
    isSaving: addMutation.isPending || acceptMutation.isPending ||
      reportMutation.isPending || blockMutation.isPending ||
      appealMutation.isPending,
  };
}
