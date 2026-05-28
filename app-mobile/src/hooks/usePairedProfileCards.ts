import { useQuery } from "@tanstack/react-query";
import { fetchPairedProfileCards, type PairedProfileCardsResponse } from "../services/personHeroCardsService";
import { personCardKeys } from "./queryKeys";
import type { PairedCardsMode } from "./usePairedCards";

type PairedProfileMode = Exclude<PairedCardsMode, "shuffle">;

export type PairedProfileSectionRequest = {
  holidayKey: string;
  isCustomHoliday: boolean;
  yearsElapsed?: number;
  categorySlugs: string[];
  curatedExperienceType: string | null;
};

export function usePairedProfileCards(params: {
  pairedUserId: string;
  sections: PairedProfileSectionRequest[];
  mode?: PairedProfileMode;
} | null) {
  const mode: PairedProfileMode = params?.mode ?? "default";

  const query = useQuery<PairedProfileCardsResponse>({
    queryKey: params
      ? personCardKeys.pairedProfile(params.pairedUserId, mode)
      : personCardKeys.all,
    queryFn: () =>
      fetchPairedProfileCards({
        pairedUserId: params!.pairedUserId,
        sections: params!.sections,
        mode,
      }),
    enabled: !!params?.pairedUserId && (params?.sections.length ?? 0) > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 2,
  });

  return {
    locationStatus: query.data?.locationStatus ?? "ok",
    sections: query.data?.sections ?? {},
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
