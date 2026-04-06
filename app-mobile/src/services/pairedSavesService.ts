import { supabase } from './supabase';

export interface PairedSave {
  id: string;
  experienceId: string;
  title: string;
  category: string;
  imageUrl: string;
  priceTier: string | null;
  rating: number;
  savedAt: string;
  cardData?: Record<string, unknown>;
}

export interface FetchPairedSavesParams {
  pairedUserId: string;
  limit?: number;
  offset?: number;
  category?: string;
}

export async function fetchPairedSaves(
  params: FetchPairedSavesParams
): Promise<{ saves: PairedSave[]; total: number; hasMore: boolean }> {
  const { data, error } = await supabase.functions.invoke('get-paired-saves', {
    body: {
      pairedUserId: params.pairedUserId,
      limit: params.limit || 20,
      offset: params.offset || 0,
      category: params.category || null,
    },
  });

  if (error) throw error;
  return data;
}
