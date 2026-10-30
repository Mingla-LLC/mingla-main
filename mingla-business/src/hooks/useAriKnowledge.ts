/** Issue #3355 — React Query ownership for Ari memories and durable jobs. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  controlAriJob,
  forgetAriMemory,
  listAriJobs,
  listAriMemory,
  saveAriMemory,
  updateAriMemory,
  type AriMemoryKind,
} from "../services/ariKnowledgeService";
import { useAuth } from "../context/AuthContext";

const memoryKey = (brandId: string | null) =>
  ["ari", "memory", brandId ?? "all"] as const;
const jobsKey = ["ari", "jobs"] as const;
const disabledMemoryKey = ["ari", "memory", "disabled"] as const;
const disabledJobsKey = ["ari", "jobs", "disabled"] as const;

export function useAriKnowledge(brandId: string | null) {
  const queryClient = useQueryClient();
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady;
  const memory = useQuery({
    queryKey: enabled ? memoryKey(brandId) : disabledMemoryKey,
    queryFn: () => listAriMemory(brandId),
    enabled,
    staleTime: 15_000,
  });
  const jobs = useQuery({
    queryKey: enabled ? jobsKey : disabledJobsKey,
    queryFn: listAriJobs,
    enabled,
    staleTime: 10_000,
  });
  const refreshMemory = () =>
    queryClient.invalidateQueries({ queryKey: memoryKey(brandId) });
  const refreshJobs = () =>
    queryClient.invalidateQueries({ queryKey: jobsKey });
  const save = useMutation({
    mutationFn: (input: { kind: AriMemoryKind; content: string }) =>
      saveAriMemory({ ...input, brandId }),
    onSuccess: refreshMemory,
  });
  const update = useMutation({
    mutationFn: (input: {
      noteId: string;
      kind: AriMemoryKind;
      content: string;
    }) => updateAriMemory({ ...input, brandId }),
    onSuccess: refreshMemory,
  });
  const forget = useMutation({
    mutationFn: forgetAriMemory,
    onSuccess: refreshMemory,
  });
  const control = useMutation({
    mutationFn: controlAriJob,
    onSuccess: refreshJobs,
  });

  return {
    memory: memory.data ?? [],
    jobs: jobs.data ?? [],
    isLoading: memory.isLoading || jobs.isLoading,
    refresh: async () => {
      await Promise.all([memory.refetch(), jobs.refetch()]);
    },
    saveMemory: save.mutateAsync,
    updateMemory: update.mutateAsync,
    forgetMemory: forget.mutateAsync,
    controlJob: control.mutateAsync,
    isSaving: save.isPending || update.isPending || forget.isPending,
    isControllingJob: control.isPending,
  };
}
