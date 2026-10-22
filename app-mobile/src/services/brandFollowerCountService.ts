// Issue #3682 — public aggregate follower-count reads.
//
// These RPCs return counts only. They never expose brand_follows rows or user
// identifiers, and they are deliberately usable before auth settles.
import { supabase } from './supabase';

const MAX_BATCH_SIZE = 100;

function asCount(value: unknown, label: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label}_malformed`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join('|') === keys.slice().sort().join('|');
}

export const brandFollowerCountService = {
  async getCount(brandId: string): Promise<number | null> {
    const { data, error } = await supabase.rpc('get_brand_follower_count', {
      p_brand_id: brandId,
    });
    if (error) throw error;
    return data === null ? null : asCount(data, 'follower_count');
  },

  async getCounts(brandIds: readonly string[]): Promise<Record<string, number>> {
    const uniqueBrandIds = [...new Set(brandIds.filter((id) => id.length > 0))].sort();
    if (uniqueBrandIds.length === 0) return {};

    const counts: Record<string, number> = {};
    for (let offset = 0; offset < uniqueBrandIds.length; offset += MAX_BATCH_SIZE) {
      const chunk = uniqueBrandIds.slice(offset, offset + MAX_BATCH_SIZE);
      const chunkIds = new Set(chunk);
      const { data, error } = await supabase.rpc('get_brand_follower_counts', {
        p_brand_ids: chunk,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('brand_follower_counts_malformed');

      for (const row of data) {
        if (
          !isRecord(row) ||
          !exactKeys(row, ['brand_id', 'follower_count']) ||
          typeof row.brand_id !== 'string' ||
          !chunkIds.has(row.brand_id) ||
          Object.prototype.hasOwnProperty.call(counts, row.brand_id)
        ) {
          throw new Error('brand_follower_counts_malformed');
        }
        counts[row.brand_id] = asCount(
          row.follower_count,
          'brand_follower_counts',
        );
      }
    }
    return counts;
  },
};
