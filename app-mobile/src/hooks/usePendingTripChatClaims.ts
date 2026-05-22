import { useCallback, useEffect, useState } from 'react';

import { messagingService } from '../services/messagingService';

export interface PendingTripChatClaim {
  event_id: string;
  event_name: string;
  cover_url?: string | null;
}

export function usePendingTripChatClaims(): {
  claims: PendingTripChatClaim[];
  loading: boolean;
  refresh: () => Promise<void>;
  claim: (claimToken?: string) => Promise<{
    claimed: number;
    conversations: Array<{ conversation_id: string; event_id: string; event_name: string }>;
  }>;
} {
  const [claims, setClaims] = useState<PendingTripChatClaim[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { claims: nextClaims, error } = await messagingService.fetchPendingChatClaims();
      if (error) throw new Error(error);
      setClaims(nextClaims);
    } catch (error) {
      console.warn('[usePendingTripChatClaims] failed to load pending claims', error);
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const claim = useCallback(async (claimToken?: string) => {
    const result = await messagingService.claimPendingTripChats(claimToken);
    if (result.error) throw new Error(result.error);
    await refresh();
    return { claimed: result.claimed, conversations: result.conversations };
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { claims, loading, refresh, claim };
}
