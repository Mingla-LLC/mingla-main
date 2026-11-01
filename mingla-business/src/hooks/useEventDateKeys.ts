import { useQuery } from "@tanstack/react-query";

import { fetchEventDateKeys } from "../services/eventDateKeys";

export function useEventDateKeys(eventId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["event-date-keys", eventId ?? ""],
    queryFn: () => fetchEventDateKeys(eventId!),
    enabled: enabled && eventId !== null && eventId.length > 0,
    staleTime: 30_000,
  });
}
