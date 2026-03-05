import { supabase } from "./supabase";
import { FriendLink } from "../types/friendLink";

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
  linked_user_id: string | null;
  link_id: string | null;
  is_linked: boolean;
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
  person: Omit<SavedPerson, "id" | "created_at" | "updated_at" | "description_processed_at" | "linked_user_id" | "link_id" | "is_linked"> & {
    linked_user_id?: string | null;
    link_id?: string | null;
    is_linked?: boolean;
  }
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
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/generate-person-experiences`,
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

// ── Linking Support ─────────────────────────────────────────────────────────

function mapFriendLink(row: any): FriendLink {
  return {
    id: row.id,
    requesterId: row.requester_id,
    targetId: row.target_id,
    status: row.status,
    requesterPersonId: row.requester_person_id ?? null,
    targetPersonId: row.target_person_id ?? null,
    acceptedAt: row.accepted_at ?? null,
    unlinkedAt: row.unlinked_at ?? null,
    unlinkedBy: row.unlinked_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLinkForPerson(
  personId: string
): Promise<FriendLink | null> {
  const { data, error } = await supabase
    .from("friend_links")
    .select("*")
    .or(`requester_person_id.eq.${personId},target_person_id.eq.${personId}`)
    .eq("status", "accepted")
    .single();

  if (error) {
    // PGRST116 = no rows found — not an error, just no link
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }

  return data ? mapFriendLink(data) : null;
}

export async function refreshLinkedPersonProfile(
  personId: string
): Promise<void> {
  // 1. Get the saved_people row to find linked_user_id
  const { data: person, error: personError } = await supabase
    .from("saved_people")
    .select("linked_user_id")
    .eq("id", personId)
    .single();

  if (personError) throw new Error(personError.message);
  if (!person?.linked_user_id) {
    throw new Error("Person is not linked to a user");
  }

  // 2. Fetch linked user's profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, birthday, gender, avatar_url")
    .eq("id", person.linked_user_id)
    .single();

  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error("Linked user profile not found");

  // 3. Compute initials from display_name
  const displayName = profile.display_name || "";
  const nameParts = displayName.trim().split(/\s+/);
  const initials =
    nameParts.length >= 2
      ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
      : displayName.substring(0, 2).toUpperCase();

  // 4. Update saved_people
  const { error: updateError } = await supabase
    .from("saved_people")
    .update({
      name: displayName,
      birthday: profile.birthday ?? null,
      gender: profile.gender ?? null,
      initials,
      updated_at: new Date().toISOString(),
    })
    .eq("id", personId);

  if (updateError) throw new Error(updateError.message);
}
