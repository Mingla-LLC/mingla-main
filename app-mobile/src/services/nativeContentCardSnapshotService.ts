import { supabase } from './supabase';
import type { LegacyCardPayload } from './messagingService';

type SnapshotRow = { message_id: string; snapshot: LegacyCardPayload & { contract: 'native_content_card_snapshot_v1' } };
const cache = new Map<string, LegacyCardPayload>();

function validSnapshot(value: unknown): value is SnapshotRow['snapshot'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.contract === 'native_content_card_snapshot_v1'
    && (row.kind === 'place' || row.kind === 'curated')
    && typeof row.title === 'string' && row.title.trim().length > 0;
}

export const nativeContentCardSnapshotService = {
  cached(messageId: string): LegacyCardPayload | null { return cache.get(messageId) ?? null; },
  async resolve(messageIds: string[]): Promise<Map<string, LegacyCardPayload>> {
    const unique = [...new Set(messageIds)].slice(0, 50);
    if (unique.length === 0) return new Map();
    const { data, error } = await supabase.rpc('resolve_native_content_card_snapshots', { p_message_ids: unique });
    if (error) throw error;
    for (const raw of (data ?? []) as SnapshotRow[]) {
      if (typeof raw.message_id !== 'string' || !validSnapshot(raw.snapshot)) throw new Error('malformed_native_card_snapshot');
      const { contract: _contract, kind: _kind, version: _version, ...card } = raw.snapshot as any;
      cache.set(raw.message_id, card as LegacyCardPayload);
    }
    return new Map(unique.flatMap((id) => cache.has(id) ? [[id, cache.get(id)!]] : []));
  },
};
