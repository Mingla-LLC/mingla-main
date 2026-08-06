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

/**
 * #1618 — THE OPERATION-LEVEL BOUND.
 *
 * `services/supabase.ts` already wraps the client's fetch in a 20-second
 * `Promise.race` cap, and that cap DID NOT FIRE on the 75-second hang. It is a
 * PER-REQUEST cap, and the wait was upstream of the request:
 *
 *     supabase.functions.invoke(...)
 *       -> SupabaseClient.fetch = fetchWithAuth(key, _getAccessToken, fetchWithTimeout)
 *       -> await getAccessToken()          <-- the entire auth preamble runs HERE,
 *            -> auth.getSession()              outside every timer below it
 *            -> _callRefreshToken -> _refreshAccessToken, which retries with
 *               exponential backoff while
 *               `Date.now() + nextBackOff - startedAt < AUTO_REFRESH_TICK_DURATION_MS`
 *               (30s), and each attempt gets its OWN fresh 20-second fetch cap
 *       -> fetchWithTimeout(...)           <-- only now does the 20s cap start
 *
 * So a stalled network produces ~20s (first refresh attempt) + backoff + ~20s
 * (second refresh attempt) + ~20s (the real request), and no single timer is
 * ever exceeded. Capping the fetch harder would not fix it and would break the
 * legitimately slow deck functions (discover-cards routinely takes 11-13s).
 *
 * The bound therefore belongs at the OPERATION, which is here. It is deliberately
 * NOT applied to the read paths: `hasVisited` is a query whose failure is
 * invisible and retried by React Query, whereas a WRITE that never resolves is
 * what leaves the control looking untouched.
 *
 * #1642 — THIS BOUND IS ONLY REACHABLE BECAUSE THE MUTATIONS THAT CALL IT
 * DECLARE `networkMode: 'always'` (hooks/useVisits.ts). React Query's default
 * `networkMode` is `'online'`, and with `onlineManager` wired to NetInfo a
 * device with no signal makes query-core pause the mutation BEFORE it ever
 * calls `mutationFn` — so none of the code below runs and the timer here is
 * never even created. That is why the 15s cap did not fire in airplane mode
 * on a physical Samsung: not because 15s was too long, but because nothing
 * here executed. If you ever remove `networkMode` from those mutations, every
 * line below becomes dead code again under exactly the failure it exists for.
 */
export const VISIT_WRITE_TIMEOUT_MS = 15000;

class VisitWriteTimeoutError extends Error {
  constructor() {
    super('Visit write timed out');
    this.name = 'VisitWriteTimeoutError';
  }
}

async function boundVisitWrite<T>(op: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new VisitWriteTimeoutError()), VISIT_WRITE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    // Without this the timer leaks until it fires and rejects into a race no
    // one is listening to any more.
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export async function recordVisit(params: RecordVisitParams): Promise<{ visitId: string; isNew: boolean }> {
  // #1618 — bounded at the OPERATION, not at the request. See boundVisitWrite.
  const { data, error } = await boundVisitWrite(
    supabase.functions.invoke('record-visit', {
      body: { ...params, timeOfDay: getTimeOfDay() },
    }),
  );

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
  // #1618 — the whole operation is bounded, INCLUDING the `auth.getUser()`
  // preamble. That call is itself a network round-trip through the same
  // fetchWithAuth -> getAccessToken path, so it can stall for exactly the same
  // reason the write can, and it runs before any query timer exists.
  await boundVisitWrite(
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('user_visits')
        .delete()
        .eq('user_id', user.id)
        .eq('experience_id', experienceId);

      if (error) throw error;
    })(),
  );
}
