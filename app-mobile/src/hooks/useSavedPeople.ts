import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as savedPeopleService from "../services/savedPeopleService";

export const savedPeopleKeys = {
  all: ["saved-people"] as const,
  list: (userId: string) => [...savedPeopleKeys.all, "list", userId] as const,
  experiences: (personId: string) => [...savedPeopleKeys.all, "experiences", personId] as const,
};

export function useSavedPeople(userId: string | undefined) {
  return useQuery({
    queryKey: savedPeopleKeys.list(userId ?? ""),
    queryFn: () => savedPeopleService.getSavedPeople(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreatePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savedPeopleService.createSavedPerson,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: savedPeopleKeys.list(variables.user_id) });
    },
    onError: (error: Error) => {
      console.error('[CreatePerson] Error:', error.message);
    },
  });
}

export function useUpdatePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ personId, updates }: { personId: string; updates: Parameters<typeof savedPeopleService.updateSavedPerson>[1] }) =>
      savedPeopleService.updateSavedPerson(personId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
    },
    onError: (error: Error) => {
      console.error('[UpdatePerson] Error:', error.message);
    },
  });
}

export function useDeletePerson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      personId,
    }: {
      personId: string;
    }) => {
      await savedPeopleService.deleteSavedPerson(personId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
    },
    onError: (error: Error) => {
      console.error('[DeletePerson] Error:', error.message);
    },
  });
}

export function usePersonExperiences(personId: string | undefined) {
  return useQuery({
    queryKey: savedPeopleKeys.experiences(personId ?? ""),
    queryFn: () => savedPeopleService.getPersonExperiences(personId!),
    enabled: !!personId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useGeneratePersonExperiences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: savedPeopleService.generatePersonExperiences,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: savedPeopleKeys.experiences(variables.personId),
      });
    },
    onError: (error: Error) => {
      console.error('[GeneratePersonExperiences] Error:', error.message);
    },
  });
}
