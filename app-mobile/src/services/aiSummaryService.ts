import { supabase, supabaseUrl } from "./supabase";

export async function getAiSummary(params: {
  personId: string;
  personName: string;
  gender: string | null;
  description: string | null;
  linkedUserId?: string;
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

  if (!response.ok) return null; // Graceful degradation -- hero still renders without summary

  const data = await response.json();
  return data.summary ?? null;
}
