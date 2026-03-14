import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCustomHolidays,
  createCustomHoliday,
  deleteCustomHoliday,
  getArchivedHolidays,
  archiveHoliday,
  unarchiveHoliday,
  getCustomHolidaysByPairing,
  createCustomHolidayForPairing,
  getArchivedHolidaysByPairing,
  archiveHolidayForPairing,
  unarchiveHolidayForPairing,
} from "../services/customHolidayService";
import type { CustomHoliday, ArchivedHoliday } from "../services/customHolidayService";

// ── Query Keys ──────────────────────────────────────────────────────────────

export const customHolidayKeys = {
  all: ["custom-holidays"] as const,
  list: (userId: string, personId: string) =>
    [...customHolidayKeys.all, "list", userId, personId] as const,
  listByPairing: (userId: string, pairingId: string) =>
    [...customHolidayKeys.all, "pairing-list", userId, pairingId] as const,
  archived: (userId: string, personId: string) =>
    [...customHolidayKeys.all, "archived", userId, personId] as const,
  archivedByPairing: (userId: string, pairingId: string) =>
    [...customHolidayKeys.all, "pairing-archived", userId, pairingId] as const,
};

// ── Person-based Hooks (backward compat) ────────────────────────────────────

export function useCustomHolidays(
  userId: string | undefined,
  personId: string | undefined
) {
  return useQuery<CustomHoliday[]>({
    queryKey: customHolidayKeys.list(userId ?? "", personId ?? ""),
    queryFn: () => getCustomHolidays(userId!, personId!),
    enabled: !!userId && !!personId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useArchivedHolidays(
  userId: string | undefined,
  personId: string | undefined
) {
  return useQuery<ArchivedHoliday[]>({
    queryKey: customHolidayKeys.archived(userId ?? "", personId ?? ""),
    queryFn: () => getArchivedHolidays(userId!, personId!),
    enabled: !!userId && !!personId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCustomHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCustomHoliday,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.list(variables.user_id, variables.person_id),
      });
    },
  });
}

export function useDeleteCustomHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCustomHoliday,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customHolidayKeys.all });
    },
  });
}

export function useArchiveHoliday(userId: string, personId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (holidayKey: string) => archiveHoliday(userId, personId, holidayKey),
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
    mutationFn: (holidayKey: string) => unarchiveHoliday(userId, personId, holidayKey),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.archived(userId, personId),
      });
    },
  });
}

// ── Pairing-based Hooks (new) ───────────────────────────────────────────────

export function useCustomHolidaysByPairing(
  userId: string | undefined,
  pairingId: string | undefined
) {
  return useQuery<CustomHoliday[]>({
    queryKey: customHolidayKeys.listByPairing(userId ?? "", pairingId ?? ""),
    queryFn: () => getCustomHolidaysByPairing(userId!, pairingId!),
    enabled: !!userId && !!pairingId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useArchivedHolidaysByPairing(
  userId: string | undefined,
  pairingId: string | undefined
) {
  return useQuery<ArchivedHoliday[]>({
    queryKey: customHolidayKeys.archivedByPairing(userId ?? "", pairingId ?? ""),
    queryFn: () => getArchivedHolidaysByPairing(userId!, pairingId!),
    enabled: !!userId && !!pairingId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCustomHolidayForPairing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCustomHolidayForPairing,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.listByPairing(
          variables.user_id,
          variables.pairing_id
        ),
      });
    },
  });
}

export function useArchiveHolidayForPairing(userId: string, pairingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (holidayKey: string) =>
      archiveHolidayForPairing(userId, pairingId, holidayKey),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.archivedByPairing(userId, pairingId),
      });
    },
  });
}

export function useUnarchiveHolidayForPairing(userId: string, pairingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (holidayKey: string) =>
      unarchiveHolidayForPairing(userId, pairingId, holidayKey),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customHolidayKeys.archivedByPairing(userId, pairingId),
      });
    },
  });
}
