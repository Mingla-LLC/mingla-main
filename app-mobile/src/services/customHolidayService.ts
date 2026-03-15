import { supabase } from "./supabase";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CustomHoliday {
  id: string;
  user_id: string;
  person_id: string;
  pairing_id?: string;
  paired_user_id?: string;
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
  pairing_id?: string;
  paired_user_id?: string;
  holiday_key: string;
  archived_at: string;
}

// ── Person-based Functions (backward compat) ────────────────────────────────

export async function getCustomHolidays(
  userId: string,
  personId: string
): Promise<CustomHoliday[]> {
  const { data, error } = await supabase
    .from("custom_holidays")
    .select("*")
    .eq("user_id", userId)
    .eq("person_id", personId)
    .order("month", { ascending: true })
    .order("day", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCustomHoliday(holiday: {
  user_id: string;
  person_id: string;
  name: string;
  month: number;
  day: number;
  year: number;
  description?: string | null;
  categories?: string[] | null;
}): Promise<CustomHoliday> {
  const { data, error } = await supabase
    .from("custom_holidays")
    .insert(holiday)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCustomHoliday(holidayId: string): Promise<void> {
  const { error } = await supabase
    .from("custom_holidays")
    .delete()
    .eq("id", holidayId);

  if (error) throw new Error(error.message);
}

export async function getArchivedHolidays(
  userId: string,
  personId: string
): Promise<ArchivedHoliday[]> {
  const { data, error } = await supabase
    .from("archived_holidays")
    .select("*")
    .eq("user_id", userId)
    .eq("person_id", personId);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function archiveHoliday(
  userId: string,
  personId: string,
  holidayKey: string
): Promise<ArchivedHoliday> {
  const { data, error } = await supabase
    .from("archived_holidays")
    .insert({
      user_id: userId,
      person_id: personId,
      holiday_key: holidayKey,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function unarchiveHoliday(
  userId: string,
  personId: string,
  holidayKey: string
): Promise<void> {
  const { error } = await supabase
    .from("archived_holidays")
    .delete()
    .eq("user_id", userId)
    .eq("person_id", personId)
    .eq("holiday_key", holidayKey);

  if (error) throw new Error(error.message);
}

// ── Pairing-based Functions (new) ───────────────────────────────────────────

export async function getCustomHolidaysByPairing(
  userId: string,
  pairingId: string
): Promise<CustomHoliday[]> {
  const { data, error } = await supabase
    .from("custom_holidays")
    .select("*")
    .eq("user_id", userId)
    .eq("pairing_id", pairingId)
    .order("month", { ascending: true })
    .order("day", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Fetch ALL custom holidays for a pairing — from BOTH users.
 * RLS policy allows paired users to read each other's rows.
 */
export async function getSharedCustomHolidaysByPairing(
  pairingId: string
): Promise<CustomHoliday[]> {
  const { data, error } = await supabase
    .from("custom_holidays")
    .select("*")
    .eq("pairing_id", pairingId)
    .order("month", { ascending: true })
    .order("day", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCustomHolidayForPairing(holiday: {
  user_id: string;
  pairing_id: string;
  paired_user_id: string;
  name: string;
  month: number;
  day: number;
  year: number;
  description?: string | null;
  categories?: string[] | null;
}): Promise<CustomHoliday> {
  const { data, error } = await supabase
    .from("custom_holidays")
    .insert(holiday)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getArchivedHolidaysByPairing(
  userId: string,
  pairingId: string
): Promise<ArchivedHoliday[]> {
  const { data, error } = await supabase
    .from("archived_holidays")
    .select("*")
    .eq("user_id", userId)
    .eq("pairing_id", pairingId);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function archiveHolidayForPairing(
  userId: string,
  pairingId: string,
  holidayKey: string
): Promise<ArchivedHoliday> {
  const { data, error } = await supabase
    .from("archived_holidays")
    .insert({
      user_id: userId,
      pairing_id: pairingId,
      holiday_key: holidayKey,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function unarchiveHolidayForPairing(
  userId: string,
  pairingId: string,
  holidayKey: string
): Promise<void> {
  const { error } = await supabase
    .from("archived_holidays")
    .delete()
    .eq("user_id", userId)
    .eq("pairing_id", pairingId)
    .eq("holiday_key", holidayKey);

  if (error) throw new Error(error.message);
}
