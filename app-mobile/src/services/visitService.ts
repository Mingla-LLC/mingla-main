import { supabase } from './supabase';

export interface VisitCardData {
  category: string;
  title: string;
  priceTier?: string;
  lat?: number;
  lng?: number;
  imageUrl?: string;
  distanceKm?: number;
}

export interface Visit {
  id: string;
  experienceId: string;
  cardData: VisitCardData;
  visitedAt: string;
  source: 'manual' | 'geofence' | 'calendar';
}

export interface RecordVisitParams {
  experienceId: string;
  cardData: {
    category: string;
    priceTier?: string;
    lat?: number;
    lng?: number;
    title: string;
    imageUrl?: string;
    distanceKm?: number;
  };
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export async function recordVisit(params: RecordVisitParams): Promise<{ visitId: string; isNew: boolean }> {
  const { data, error } = await supabase.functions.invoke('record-visit', {
    body: { ...params, timeOfDay: getTimeOfDay() },
  });

  if (error) throw error;
  return data;
}

export async function fetchMyVisits(): Promise<Visit[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('user_visits')
    .select('*')
    .eq('user_id', user.id)
    .order('visited_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    experienceId: row.experience_id,
    cardData: row.card_data,
    visitedAt: row.visited_at,
    source: row.source,
  }));
}

export async function fetchPairedUserVisits(pairedUserId: string): Promise<Visit[]> {
  const { data, error } = await supabase
    .from('user_visits')
    .select('*')
    .eq('user_id', pairedUserId)
    .order('visited_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    experienceId: row.experience_id,
    cardData: row.card_data,
    visitedAt: row.visited_at,
    source: row.source,
  }));
}

export async function hasVisited(experienceId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { count } = await supabase
    .from('user_visits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('experience_id', experienceId);

  return (count ?? 0) > 0;
}

export async function removeVisit(experienceId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('user_visits')
    .delete()
    .eq('user_id', user.id)
    .eq('experience_id', experienceId);

  if (error) throw error;
}
