import { supabase } from '../services/supabase';

export interface RotationState {
  activeOwnerId: string | null;
  rotationOrder: string[];
}

/**
 * Initialize rotation order for a session.
 * Order: creator first, then by join date (earliest first).
 */
export async function initializeRotationOrder(
  sessionId: string,
  creatorId: string,
  participants: { user_id: string; joined_at?: string }[]
): Promise<string[]> {
  const sorted = [...participants]
    .filter((p) => p.user_id !== creatorId)
    .sort((a, b) => {
      const aDate = a.joined_at || '';
      const bDate = b.joined_at || '';
      return aDate.localeCompare(bDate);
    });

  const order = [creatorId, ...sorted.map((p) => p.user_id)];

  await supabase
    .from('collaboration_sessions')
    .update({ rotation_order: order, active_preference_owner_id: order[0] })
    .eq('id', sessionId);

  return order;
}

/**
 * Rotate to the next participant who has saved preferences.
 * Skips participants without preferences.
 */
export async function rotateToNext(
  sessionId: string,
  currentOwnerId: string | null,
  rotationOrder: string[],
  participantsWithPreferences: Set<string>
): Promise<string | null> {
  if (rotationOrder.length === 0) return null;

  const currentIndex = currentOwnerId
    ? rotationOrder.indexOf(currentOwnerId)
    : -1;

  // Find next participant WITH preferences
  for (let i = 1; i <= rotationOrder.length; i++) {
    const nextIndex = (currentIndex + i) % rotationOrder.length;
    const nextId = rotationOrder[nextIndex];
    if (participantsWithPreferences.has(nextId)) {
      await supabase
        .from('collaboration_sessions')
        .update({ active_preference_owner_id: nextId })
        .eq('id', sessionId);
      return nextId;
    }
  }

  return currentOwnerId; // No other participants with preferences
}

/**
 * Get the display name for the active preference owner.
 */
export function getRotationLabel(
  activeOwnerId: string | null,
  currentUserId: string | null,
  participants: { user_id: string; display_name?: string; first_name?: string }[]
): string {
  if (!activeOwnerId) return 'No one selected';
  if (activeOwnerId === currentUserId) return 'Your picks';
  const participant = participants.find((p) => p.user_id === activeOwnerId);
  return `${participant?.display_name || participant?.first_name || 'Unknown'}'s picks`;
}

/**
 * Get the position in the rotation queue for a given user.
 * Returns null if user is currently active, or 1-indexed position otherwise.
 */
export function getQueuePosition(
  userId: string,
  activeOwnerId: string | null,
  rotationOrder: string[]
): number | null {
  if (userId === activeOwnerId) return null;
  const activeIndex = activeOwnerId ? rotationOrder.indexOf(activeOwnerId) : 0;
  const userIndex = rotationOrder.indexOf(userId);
  if (userIndex === -1) return null;
  const distance = (userIndex - activeIndex + rotationOrder.length) % rotationOrder.length;
  return distance;
}
