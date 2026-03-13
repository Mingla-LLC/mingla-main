import { useQuery } from "@tanstack/react-query";
import { supabase, supabaseUrl } from "../services/supabase";

export const customDayAiKeys = {
  all: ["custom-day-ai"] as const,
  forDay: (personId: string, dayId: string) =>
    [...customDayAiKeys.all, personId, dayId] as const,
};

async function getCustomDayAiSummary(params: {
  personId: string;
  personName: string;
  gender: string | null;
  description: string | null;
  linkedUserId?: string;
  customDayName: string;
  customDayYear: number;
}): Promise<string | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(
    `${supabaseUrl}/functions/v1/generate-ai-summary`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) return null;
  const data = await response.json();
  return data.summary ?? null;
}

export function useCustomDayAiSummary(params: {
  personId: string;
  personName: string;
  gender: string | null;
  description: string | null;
  linkedUserId?: string;
  customDayName: string;
  customDayYear: number;
  dayId: string;
} | null) {
  return useQuery({
    queryKey: params
      ? customDayAiKeys.forDay(params.personId, params.dayId)
      : customDayAiKeys.all,
    queryFn: () => {
      if (!params) return null;
      const { dayId, ...rest } = params;
      return getCustomDayAiSummary(rest);
    },
    enabled: !!params,
    staleTime: 24 * 60 * 60 * 1000, // 24h — same as birthday AI summary
  });
}
