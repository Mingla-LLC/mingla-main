import React from 'react';
import { useBoardRealtimeSync } from '../hooks/useBoardQueries';
import { useSavesRealtimeSync } from '../hooks/useSaveQueries';
import { useSocialRealtime } from '../hooks/useSocialRealtime';

/**
 * Hosts the three global Realtime subscription hooks.
 *
 * Wrapped with `key={realtimeEpoch}` in the parent — when the epoch
 * increments after a long-background resume, React unmounts this component
 * (cleanup removes old channels via supabase.removeChannel), then remounts
 * it (hooks create fresh channels with fresh .on() bindings).
 *
 * This is the ONLY place these three hooks should be called.
 * Do not duplicate them in AppStateManager, index.tsx, or elsewhere.
 * See ORCH-0336 / ORCH-0337 for the Realtime binding-loss investigation.
 */
interface Props {
  userId: string;
}

const RealtimeSubscriptions: React.FC<Props> = ({ userId }) => {
  useBoardRealtimeSync();
  useSavesRealtimeSync();
  useSocialRealtime(userId);

  return null;
};

export default RealtimeSubscriptions;
