import { supabase } from './supabase';

class CoachMarkService {
  /**
   * Fetch all completed coach mark IDs for a user.
   * Called once on app boot to hydrate the store.
   */
  async getCompletedIds(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('coach_mark_progress')
      .select('coach_mark_id')
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to fetch coach mark progress:', error);
      return [];
    }
    return (data || []).map(row => row.coach_mark_id);
  }

  /**
   * Mark a coach mark as completed. Fire-and-forget — errors are logged, not thrown.
   */
  async markCompleted(userId: string, coachMarkId: string): Promise<void> {
    const { error } = await supabase
      .from('coach_mark_progress')
      .insert({ user_id: userId, coach_mark_id: coachMarkId });

    // 23505 = unique_violation — expected for duplicate inserts, silently ignore
    if (error && error.code !== '23505') {
      console.error('Failed to persist coach mark completion:', error);
    }
  }

  /**
   * Batch mark multiple coach marks as completed (for skipGroup).
   */
  async batchMarkCompleted(userId: string, coachMarkIds: string[]): Promise<void> {
    if (coachMarkIds.length === 0) return;

    const rows = coachMarkIds.map(id => ({
      user_id: userId,
      coach_mark_id: id,
    }));

    const { error } = await supabase
      .from('coach_mark_progress')
      .upsert(rows, { onConflict: 'user_id,coach_mark_id', ignoreDuplicates: true });

    if (error) {
      console.error('Failed to batch persist coach mark completions:', error);
    }
  }
}

export const coachMarkService = new CoachMarkService();
