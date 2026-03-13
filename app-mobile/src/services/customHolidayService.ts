import { supabase } from "./supabase";

export interface CustomHoliday {
  id: string;
  user_id: string;
  person_id: string;
  name: string;
  month: number;
  day: number;
  year: number;
  description: string | null;
  categories: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface ArchivedHoliday {
  id: string;
  user_id: string;
  person_id: string;
  holiday_key: string;
  archived_at: string;
}

export async function getCustomHolidays(userId: string, personId: string): Promise<CustomHoliday[]> {
  const { data, error } = await supabase
    .from("custom_holidays")
    .select("*")
    .eq("user_id", userId)
    .eq("person_id", personId)
    .order("month", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCustomHoliday(
  holiday: Omit<CustomHoliday, "id" | "created_at" | "updated_at">
): Promise<CustomHoliday> {
  const { data, error } = await supabase
    .from("custom_holidays")
    .insert(holiday)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCustomHoliday(id: string): Promise<void> {
  const { error } = await supabase.from("custom_holidays").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getArchivedHolidays(userId: string, personId: string): Promise<ArchivedHoliday[]> {
  const { data, error } = await supabase
    .from("archived_holidays")
    .select("*")
    .eq("user_id", userId)
    .eq("person_id", personId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function archiveHoliday(
  userId: string, personId: string, holidayKey: string
): Promise<ArchivedHoliday> {
  const { data, error } = await supabase
    .from("archived_holidays")
    .insert({ user_id: userId, person_id: personId, holiday_key: holidayKey })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function unarchiveHoliday(id: string): Promise<void> {
  const { error } = await supabase.from("archived_holidays").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
