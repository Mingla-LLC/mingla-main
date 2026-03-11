import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────

export interface SavedExperience {
  id: string;
  user_id: string;
  card_id: string;
  title: string;
  subtitle?: string;
  category: string;
  price_level: number;
  estimated_cost_per_person: number;
  start_time?: string;
  duration_minutes?: number;
  image_url?: string;
  address?: string;
  location_lat?: number;
  location_lng?: number;
  route_mode?: string;
  eta_minutes?: number;
  distance_text?: string;
  maps_deep_link?: string;
  source_provider?: string;
  place_id?: string;
  event_id?: string;
  one_liner?: string;
  tip?: string;
  rating?: number;
  review_count?: number;
  status: string;
  scheduled_date?: string;
  save_type: 'experience' | 'recommendation';
  created_at: string;
  updated_at: string;
}

// ─── Queries ─────────────────────────────────────────────────────

/** Fetch all saved experiences for a user. */
export async function fetchSaves(userId: string): Promise<SavedExperience[]> {
  const { data, error } = await supabase
    .from('saved_experiences')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ─── Mutations ───────────────────────────────────────────────────

/** Save an experience. Fetches experience details to populate snapshot fields. */
export async function addSave(
  userId: string,
  experienceId: string,
  status: string = 'saved',
  scheduledAt?: string,
): Promise<SavedExperience> {
  // Get experience details for snapshot
  const { data: experience } = await supabase
    .from('experiences')
    .select('*')
    .eq('id', experienceId)
    .single();

  if (!experience) throw new Error('Experience not found');

  const { data, error } = await supabase
    .from('saved_experiences')
    .insert({
      user_id: userId,
      card_id: experienceId,
      title: experience.title,
      category: experience.category,
      price_level: 1,
      estimated_cost_per_person: experience.price_min || 0,
      duration_minutes: experience.duration_min || 60,
      image_url: experience.image_url,
      location_lat: experience.lat,
      location_lng: experience.lng,
      place_id: experience.place_id,
      status,
      scheduled_date: scheduledAt,
      save_type: 'experience',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Update a saved experience by card ID. */
export async function updateSave(
  userId: string,
  cardId: string,
  updates: Partial<SavedExperience>,
): Promise<SavedExperience> {
  const { data, error } = await supabase
    .from('saved_experiences')
    .update(updates)
    .eq('user_id', userId)
    .eq('card_id', cardId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Remove a saved experience by card ID. */
export async function removeSave(
  userId: string,
  cardId: string,
): Promise<void> {
  const { error } = await supabase
    .from('saved_experiences')
    .delete()
    .eq('user_id', userId)
    .eq('card_id', cardId);

  if (error) throw error;
}
