import { useQuery } from "@tanstack/react-query";
import { getAiSummary } from "../services/aiSummaryService";

export const aiSummaryKeys = {
  all: ["ai-summary"] as const,
  forPerson: (personId: string) =>
    [...aiSummaryKeys.all, personId] as const,
};

export function useAiSummary(params: {
  personId: string;
  personName: string;
  gender: string | null;
  description: string | null;
  linkedUserId?: string;
} | null) {
  return useQuery({
    queryKey: params ? aiSummaryKeys.forPerson(params.personId) : aiSummaryKeys.all,
    queryFn: () => getAiSummary(params!),
    enabled: !!params,
    staleTime: 24 * 60 * 60 * 1000,
  });
}
