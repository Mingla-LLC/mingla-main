import { supabase, supabaseUrl, getSupabaseFunctionHeaders } from './supabase';

export type SharedCardKind = 'place' | 'curated';
export interface SharedCardCreateInput {
  kind: SharedCardKind;
  sourceIds: { placePoolId?: string; googlePlaceId?: string; savedCardId?: string };
  attribution?: { channel?: string; referralCode?: string };
}
export interface SharedCardCreateResult {
  snapshot: Record<string, unknown>; canonicalUrl: string; appUrl: string; s4Url: string | null; s5Url: string | null;
}
export interface SharedCardReadResult {
  snapshot: Record<string, any>;
  appUrl: string;
}
export async function createSharedCard(input: SharedCardCreateInput): Promise<SharedCardCreateResult> {
  const { data, error } = await supabase.functions.invoke<SharedCardCreateResult>('shared-card', { body: input });
  if (error || !data?.canonicalUrl) throw new Error(error?.message ?? 'share_create_failed');
  return data;
}
export async function readSharedCard(shareId: string): Promise<SharedCardReadResult> {
  const response = await fetch(`${supabaseUrl}/functions/v1/shared-card?shareId=${encodeURIComponent(shareId)}`, { headers: getSupabaseFunctionHeaders() });
  if (!response.ok) throw new Error(response.status === 410 ? 'share_gone' : 'share_not_found');
  const body = await response.json();
  if (!body?.snapshot || typeof body.appUrl !== 'string') throw new Error('share_invalid');
  return { snapshot: body.snapshot, appUrl: body.appUrl };
}
