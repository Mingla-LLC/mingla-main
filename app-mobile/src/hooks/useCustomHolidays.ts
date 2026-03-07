import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as customHolidayService from "../services/customHolidayService";

export const customHolidayKeys = {
  all: ["custom-holidays"] as const,
  list: (userId: string, personId: string) =>
    [...customHolidayKeys.all, "list", userId, personId] as const,
  archived: (userId: string, personId: string) =>
    [...customHolidayKeys.all, "archived", userId, personId] as const,
};

export function useCustomHolidays(userId: string | undefined, personId: string | undefined) {
  return useQuery({
    queryKey: customHolidayKeys.list(userId ?? "", personId ?? ""),
    queryFn: () => customHolidayService.getCustomHolidays(userId!, personId!),
    enabled: !!userId && !!personId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useArchivedHolidays(userId: string | undefined, personId: string | undefined) {
  return useQuery({
    queryKey: customHolidayKeys.archived(userId ?? "", personId ?? ""),
    queryFn: () => customHolidayService.getArchivedHolidays(userId!, personId!),
    enabled: !!userId && !!personId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCustomHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: customHolidayService.createCustomHoliday,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.list(variables.user_id, variables.person_id),
      });
    },
  });
}

export function useDeleteCustomHoliday(userId: string, personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: customHolidayService.deleteCustomHoliday,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.list(userId, personId),
      });
    },
  });
}

export function useArchiveHoliday(userId: string, personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (holidayKey: string) =>
      customHolidayService.archiveHoliday(userId, personId, holidayKey),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.archived(userId, personId),
      });
    },
  });
}

export function useUnarchiveHoliday(userId: string, personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: customHolidayService.unarchiveHoliday,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.archived(userId, personId),
      });
    },
  });
}
