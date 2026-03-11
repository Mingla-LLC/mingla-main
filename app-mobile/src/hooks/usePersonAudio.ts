import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as personAudioService from "../services/personAudioService";

export const personAudioKeys = {
  all: ["person-audio"] as const,
  clips: (personId: string) =>
    [...personAudioKeys.all, personId] as const,
};

export function usePersonAudioClips(personId: string) {
  return useQuery({
    queryKey: personAudioKeys.clips(personId),
    queryFn: () => personAudioService.getAudioClips(personId),
    enabled: !!personId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUploadAudioClip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      personId,
      localUri,
      fileName,
      durationSeconds,
      sortOrder,
    }: {
      userId: string;
      personId: string;
      localUri: string;
      fileName: string;
      durationSeconds: number;
      sortOrder: number;
    }) =>
      personAudioService.uploadAudioClip(
        userId,
        personId,
        localUri,
        fileName,
        durationSeconds,
        sortOrder
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: personAudioKeys.clips(variables.personId),
      });
    },
    onError: (error: Error) => {
      console.error('[UploadAudioClip] Error:', error.message);
    },
  });
}

export function useDeleteAudioClip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clipId,
      storagePath,
    }: {
      clipId: string;
      storagePath: string;
      personId: string;
    }) => personAudioService.deleteAudioClip(clipId, storagePath),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: personAudioKeys.clips(variables.personId),
      });
    },
    onError: (error: Error) => {
      console.error('[DeleteAudioClip] Error:', error.message);
    },
  });
}
