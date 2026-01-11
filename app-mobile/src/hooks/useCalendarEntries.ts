import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarService, CalendarEntryRecord } from "../services/calendarService";

const fetchCalendarEntries = async (
  userId: string | undefined
): Promise<CalendarEntryRecord[]> => {
  if (!userId) {
    return [];
  }

  try {
    const entries = await CalendarService.fetchUserCalendarEntries(userId);
    return entries;
  } catch (error) {
    console.error("Error fetching calendar entries:", error);
    return [];
  }
};

export const useCalendarEntries = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["calendarEntries", userId],
    queryFn: async () => await fetchCalendarEntries(userId),
    enabled: !!userId,
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't keep in memory cache
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};

