import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { discoverCityWatchService, type DiscoverCityWatchStatus } from "../services/discoverCityWatchService";
import type { DiscoverAnchorV2 } from "../types/discoverFeed";
import { discoverKeys } from "./discoverQueryKeys";

interface Args {
  cityKey: string | null;
  userId: string | null;
  anchor: DiscoverAnchorV2 | null;
  label: string | null;
}

export function useDiscoverCityWatch({ cityKey, userId, anchor, label }: Args) {
  const client = useQueryClient();
  const key = discoverKeys.cityWatch(cityKey ?? "", userId ?? "");
  const query = useQuery({
    queryKey: key,
    queryFn: () => discoverCityWatchService.status(cityKey as string),
    enabled: Boolean(cityKey && userId),
    // #4265: the watch only changes through subscribe/unsubscribe below (which
    // invalidate this key) or when the city launches, so a Discover revisit
    // inside five minutes reuses it instead of refetching on every tab tap.
    staleTime: 5 * 60_000,
  });
  const subscribe = useMutation({
    mutationFn: async () => {
      if (!anchor || !label) throw new Error("city_watch_anchor_required");
      return discoverCityWatchService.subscribe(anchor, label);
    },
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<DiscoverCityWatchStatus | null>(key);
      if (cityKey && anchor && label) {
        client.setQueryData<DiscoverCityWatchStatus>(key, {
          id: "optimistic", cityKey, cityName: anchor.name, cityLabel: label,
          stateCode: anchor.stateCode, countryCode: anchor.countryCode,
          lat: anchor.lat, lng: anchor.lng, notifiedAt: null,
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => client.setQueryData(key, context?.previous ?? null),
    onSettled: () => void client.invalidateQueries({ queryKey: key }),
  });
  const unsubscribe = useMutation({
    mutationFn: async () => {
      if (!cityKey) throw new Error("city_watch_key_required");
      await discoverCityWatchService.unsubscribe(cityKey);
    },
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<DiscoverCityWatchStatus | null>(key);
      client.setQueryData(key, null);
      return { previous };
    },
    onError: (_error, _vars, context) => client.setQueryData(key, context?.previous ?? null),
    onSettled: () => void client.invalidateQueries({ queryKey: key }),
  });
  return {
    ...query,
    subscribed: Boolean(query.data && query.data.notifiedAt === null),
    pending: subscribe.isPending || unsubscribe.isPending,
    subscribe: subscribe.mutateAsync,
    unsubscribe: unsubscribe.mutateAsync,
    error: query.error ?? subscribe.error ?? unsubscribe.error,
  };
}
