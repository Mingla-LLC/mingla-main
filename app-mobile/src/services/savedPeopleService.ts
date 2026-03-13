import { supabase, supabaseUrl } from "./supabase";

export interface SavedPerson {
  id: string;
  user_id: string;
  name: string;
  initials: string;
  birthday: string | null;
  gender:
    | "man"
    | "woman"
    | "non-binary"
    | "transgender"
    | "genderqueer"
    | "genderfluid"
    | "agender"
    | "prefer-not-to-say"
    | null;
  description: string | null;
  description_processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonExperience {
  id: string;
  person_id: string;
  occasion: string;
  occasion_date: string | null;
  experience_data: Record<string, any>;
  generated_from_description: string | null;
  created_at: string;
}

export async function getSavedPeople(userId: string): Promise<SavedPerson[]> {
  const { data, error } = await supabase
    .from("saved_people")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createSavedPerson(
  person: Omit<SavedPerson, "id" | "created_at" | "updated_at" | "description_processed_at">
): Promise<SavedPerson> {
  const { data, error } = await supabase
    .from("saved_people")
    .insert(person)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateSavedPerson(
  personId: string,
  updates: Partial<Pick<SavedPerson, "name" | "initials" | "birthday" | "gender" | "description">>
): Promise<SavedPerson> {
  const { data, error } = await supabase
    .from("saved_people")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", personId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteSavedPerson(personId: string): Promise<void> {
  const { error } = await supabase
    .from("saved_people")
    .delete()
    .eq("id", personId);
  if (error) throw new Error(error.message);
}

export async function getPersonExperiences(personId: string): Promise<PersonExperience[]> {
  const { data, error } = await supabase
    .from("person_experiences")
    .select("*")
    .eq("person_id", personId)
    .order("occasion_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function generatePersonExperiences(params: {
  personId: string;
  description: string;
  location: { lat: number; lng: number };
  occasions: Array<{ name: string; date: string }>;
}): Promise<{
  experiencesByOccasion: Record<string, any[]>;
  parsedInterests: string[];
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(
    `${supabaseUrl}/functions/v1/generate-person-experiences`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to generate experiences");
  }

  return response.json();
}

