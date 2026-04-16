/**
 * SINGLE SOURCE OF TRUTH for seeding collab preferences from solo.
 * INV-NEW-1: This and useBoardSession.updatePreferences are the ONLY
 * two paths that write to board_session_preferences.
 * DO NOT add seeding logic anywhere else. See ORCH-0443.
 */
import { supabase } from './supabase';
import { normalizePreferencesForSave } from '../utils/preferencesConverter';

/**
 * Copies solo preferences into board_session_preferences for a single user.
 * Idempotent — uses upsert ON CONFLICT (session_id, user_id).
 * THROWS on failure — caller decides whether to block or continue.
 */
export async function seedCollabPrefsFromSolo(
  userId: string,
  sessionId: string
): Promise<void> {
  // 1. Read solo prefs
  const { data: solo, error: readError } = await supabase
    .from('preferences')
    .select('*')
    .eq('profile_id', userId)
    .maybeSingle();

  if (readError) {
    throw new Error(`[seedCollabPrefs] Failed to read solo prefs: ${readError.message}`);
  }

  // 2. Build payload with defaults for missing fields
  const payload = {
    session_id: sessionId,
    user_id: userId,
    categories: solo?.categories?.length ? solo.categories : ['nature', 'drinks_and_music', 'icebreakers'],
    intents: solo?.intents ?? [],
    travel_mode: solo?.travel_mode ?? 'walking',
    travel_constraint_type: 'time' as const,
    travel_constraint_value: solo?.travel_constraint_value ?? 30,
    date_option: solo?.date_option ?? null,
    datetime_pref: solo?.datetime_pref ?? null,
    use_gps_location: solo?.use_gps_location ?? true,
    custom_location: solo?.custom_location ?? null,
    custom_lat: solo?.custom_lat ?? null,
    custom_lng: solo?.custom_lng ?? null,
    intent_toggle: solo?.intent_toggle ?? true,
    category_toggle: solo?.category_toggle ?? true,
    selected_dates: solo?.selected_dates ?? null,
    location: null, // legacy column, always null
  };

  // 3. Normalize date/location to eliminate conflicting combos
  const normalized = normalizePreferencesForSave({
    date_option: payload.date_option,
    datetime_pref: payload.datetime_pref,
    use_gps_location: payload.use_gps_location,
    custom_location: payload.custom_location,
  });

  const finalPayload = {
    ...payload,
    date_option: normalized.date_option,
    datetime_pref: normalized.datetime_pref,
    use_gps_location: normalized.use_gps_location,
    custom_location: normalized.custom_location,
  };

  // 4. Upsert — idempotent
  const { error: writeError } = await supabase
    .from('board_session_preferences')
    .upsert(finalPayload, { onConflict: 'session_id,user_id' });

  if (writeError) {
    throw new Error(`[seedCollabPrefs] Failed to write collab prefs: ${writeError.message}`);
  }
}
