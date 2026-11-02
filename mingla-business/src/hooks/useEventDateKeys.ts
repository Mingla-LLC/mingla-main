import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchEventDateKeys } from "../services/eventDateKeys";

export function useEventDateKeys(eventId: string | null, enabled = true) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: ["event-date-keys", eventId ?? ""],
    queryFn: () => fetchEventDateKeys(eventId!),
    enabled: isAuthReady && enabled && eventId !== null && eventId.length > 0,
    staleTime: 30_000,
  });
}
