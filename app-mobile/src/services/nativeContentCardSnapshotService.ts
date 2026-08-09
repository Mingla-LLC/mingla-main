import { supabase } from './supabase';
import type { LegacyCardPayload } from './messagingService';
import { createNativeContentCardSessionCache } from '@mingla/sharing';

type SnapshotRow = { message_id: string; snapshot: LegacyCardPayload & { contract: 'native_content_card_snapshot_v1' }; snapshot_fingerprint: string };
const cache = createNativeContentCardSessionCache<LegacyCardPayload>();
supabase.auth.onAuthStateChange((_event, session) => {
  // A native process can outlive an account. Never let one profile inherit
  // another profile's private chat snapshots.
  cache.clear();
  void session;
});

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user.id) throw error ?? new Error('authentication_required');
  return data.session.user.id;
}

function validSnapshot(value: unknown): value is SnapshotRow['snapshot'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.contract === 'native_content_card_snapshot_v1'
    && (row.kind === 'place' || row.kind === 'curated')
    && typeof row.title === 'string' && row.title.trim().length > 0;
}

export const nativeContentCardSnapshotService = {
  async cached(messageId: string, expectedFingerprint: string): Promise<LegacyCardPayload | null> {
    return cache.get(await currentUserId(), messageId, expectedFingerprint);
  },
  async resolve(messageIds: string[], expectedFingerprints: Record<string, string> = {}): Promise<Map<string, LegacyCardPayload>> {
    const userId = await currentUserId();
    const unique = [...new Set(messageIds)].slice(0, 50);
    if (unique.length === 0) return new Map();
    const { data, error } = await supabase.rpc('resolve_native_content_card_snapshots', { p_message_ids: unique });
    if (error) throw error;
    const resolved = new Map<string, LegacyCardPayload>();
    for (const raw of (data ?? []) as SnapshotRow[]) {
      if (typeof raw.message_id !== 'string' || !validSnapshot(raw.snapshot) || !/^[0-9a-f]{64}$/.test(raw.snapshot_fingerprint)) throw new Error('malformed_native_card_snapshot');
      if (expectedFingerprints[raw.message_id] && expectedFingerprints[raw.message_id] !== raw.snapshot_fingerprint) throw new Error('native_snapshot_fingerprint_mismatch');
      const { contract: _contract, kind: _kind, version: _version, ...card } = raw.snapshot as any;
      cache.set(userId, raw.message_id, raw.snapshot_fingerprint, card as LegacyCardPayload);
      resolved.set(raw.message_id, card as LegacyCardPayload);
    }
    return resolved;
  },
};
