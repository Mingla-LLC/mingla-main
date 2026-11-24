// #4490 Explorer W5: hosted venues lead each deck category (server only).
//
// A hosted venue is a place whose verified venue (of a live, non-internal brand)
// can be booked on Mingla (issue_4490_venue_is_bookable). With the flag
// VENUE_DECK_HOSTED_FIRST on, discover-cards asks the hosted wrapper RPCs beside
// the base servable RPCs (same arguments, no row cap inside) and puts each
// category's hosted venues first. The stored score never changes; a hosted venue
// still has to pass every filter the organic deck applies (mood floor, radius,
// travel time, date and open-at-time, exclusions, dedupe): no exemption.
//
// Pure helpers live here so the Deno suite can pin them; the handler wiring is in
// index.ts. With the flag off none of these run and the response is today's.
//
// Invariant I-DECK-HOSTED-VENUES-LEAD-EACH-CATEGORY (declared in __tests__/issue_4490_hosted_lead.test.ts): with VENUE_DECK_HOSTED_FIRST on, inside every solo deck category the hosted venues (at most 6, score DESC, review_count DESC NULLS LAST, place id ASC) come before that category's organic places, and organic places keep today's relative order; pinned by supabase/functions/discover-cards/__tests__/issue_4490_hosted_lead.test.ts.

export const HOSTED_PER_CATEGORY_CAP = 6;
/**
 * A hosted answer that arrives later than this after the organic (base) calls
 * have answered is ignored, so a slow hosted lookup never holds the deck for
 * more than this (fix round 1, W5-N1: was 1500 ms).
 */
export const HOSTED_GRACE_MS = 150;
export const VENUE_DECK_HOSTED_FIRST = 'VENUE_DECK_HOSTED_FIRST';

type FlagClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

// Module-scoped 60 s cache, like getSignalServingPct (spec 06 §2).
const FLAG_CACHE = new Map<string, { value: boolean; expiresAt: number }>();
const FLAG_CACHE_TTL_MS = 60_000;

/** Reads a #4490 switch through issue_4490_flag_on; any failure reads as off. */
export async function venueDeckFlagOn(
  client: FlagClient,
  flag: string,
  nowMs: () => number = Date.now,
): Promise<boolean> {
  const cached = FLAG_CACHE.get(flag);
  const now = nowMs();
  if (cached && now < cached.expiresAt) return cached.value;
  let value = false;
  try {
    const { data, error } = await client.rpc('issue_4490_flag_on', { p_flag: flag });
    if (error) {
      console.warn(`[discover-cards] venue flag read failed flag=${flag} (reading as off for 60 s)`);
    } else {
      value = data === true;
    }
  } catch {
    console.warn(`[discover-cards] venue flag read failed flag=${flag} (reading as off for 60 s)`);
  }
  // A failed read is cached as "off" too (fix round 1, W5-N7): an edge deployed
  // before its migration must not repeat the failing read on every request.
  FLAG_CACHE.set(flag, { value, expiresAt: now + FLAG_CACHE_TTL_MS });
  return value;
}

export function resetVenueDeckFlagCacheForTests(): void {
  FLAG_CACHE.clear();
}

/** Hosted order: signal score DESC, review_count DESC NULLS LAST, place id ASC. */
export function compareHostedRows(a: any, b: any): number {
  const score = Number(b?.signal_score ?? 0) - Number(a?.signal_score ?? 0);
  if (score !== 0) return score;
  const ar = a?.review_count;
  const br = b?.review_count;
  const aNull = ar === null || ar === undefined;
  const bNull = br === null || br === undefined;
  if (aNull !== bNull) return aNull ? 1 : -1;
  if (!aNull && !bNull && Number(br) !== Number(ar)) return Number(br) - Number(ar);
  const ai = String(a?.place_id ?? '');
  const bi = String(b?.place_id ?? '');
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/**
 * Merges one RPC row into a chip bucket with today's max-score rule. The
 * existing rule keeps the first row on a tied score; the hosted tag must
 * survive that, so `__hosted` is the OR of both rows.
 */
export function mergeIntoBucket(
  bucket: Map<string, any>,
  row: any,
  stamp: Record<string, unknown>,
  hosted: boolean,
): void {
  const existing = bucket.get(row.place_id);
  if (!existing || Number(row.signal_score) > Number(existing.signal_score)) {
    bucket.set(row.place_id, {
      ...row,
      ...stamp,
      __hosted: Boolean(existing?.__hosted) || hosted,
    });
  } else if (hosted && !existing.__hosted) {
    existing.__hosted = true;
  }
}

/**
 * Step 7 with the flag on: a stable partition of one chip's rows, already in
 * today's order. Hosted rows first (compareHostedRows, at most `cap`; they are
 * marked `__hostedLead`), then every other row in exactly the order given.
 */
export function partitionHostedFirst(todaysOrder: any[], cap = HOSTED_PER_CATEGORY_CAP): any[] {
  const head = todaysOrder.filter((row) => row?.__hosted === true).sort(compareHostedRows).slice(0, cap);
  if (head.length === 0) return todaysOrder;
  const inHead = new Set(head);
  for (const row of head) row.__hostedLead = true;
  return [...head, ...todaysOrder.filter((row) => !inHead.has(row))];
}

/** Drops any later repeat of a place (a venue never appears twice). */
export function dedupeByPlace<T extends { place_id?: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = row?.place_id;
    if (typeof id === 'string') {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(row);
  }
  return out;
}

/**
 * Final safety pass before the slice: inside each display category
 * (`card.category`), that category's hosted lead cards (at most `cap`, in their
 * current order) take the earliest of the category's slots; every other card
 * keeps its relative order in the remaining slots of its category, and cards of
 * other categories keep their slots. Lead cards beyond the cap lose the lead.
 */
export function leadHostedWithinCategories(cards: any[], cap = HOSTED_PER_CATEGORY_CAP): any[] {
  const slotsByCategory = new Map<string, number[]>();
  cards.forEach((card, i) => {
    const key = String(card?.category ?? '');
    const slots = slotsByCategory.get(key);
    if (slots) slots.push(i);
    else slotsByCategory.set(key, [i]);
  });
  const out = cards.slice();
  for (const slots of slotsByCategory.values()) {
    const inCategory = slots.map((i) => cards[i]);
    const lead: any[] = [];
    const rest: any[] = [];
    for (const card of inCategory) {
      if (card?.deckLead === 'hosted_venue' && lead.length < cap) lead.push(card);
      else {
        if (card?.deckLead === 'hosted_venue') delete card.deckLead;
        rest.push(card);
      }
    }
    const ordered = [...lead, ...rest];
    slots.forEach((slot, k) => {
      out[slot] = ordered[k];
    });
  }
  return out;
}

/**
 * Collab: a position's candidates are the hosted head per chip (round-robin),
 * then the organic rows per chip (round-robin), deduped by place (the hosted
 * copy wins).
 */
export function collabCandidates<T extends { place_id?: string }>(
  hostedInterleaved: T[],
  organicInterleaved: T[],
): T[] {
  return dedupeByPlace([...hostedInterleaved, ...organicInterleaved]);
}

type HostedTask = { chip: string; signalId: string; filterMin: number };

/**
 * Fix round 1 (W5-N2): one hosted call per request answers every (signal, mood
 * floor) pair of that request. The pairs, deduped, in first-seen task order.
 */
export function hostedSignalPairs(tasks: HostedTask[]): Array<{ signal_id: string; filter_min: number }> {
  const seen = new Set<string>();
  const out: Array<{ signal_id: string; filter_min: number }> = [];
  for (const task of tasks) {
    const key = `${task.signalId}\u0000${task.filterMin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ signal_id: task.signalId, filter_min: task.filterMin });
  }
  return out;
}

/**
 * Splits the one hosted answer back into one result per task (rows whose
 * signal_id and filter_min match the task), in the wrapper's order, with the
 * two routing columns removed so a hosted row has the base row's shape. A
 * non-array answer or a row without a string place id is dropped (W5-N3), so a
 * malformed hosted answer can only ever fall back to today's deck.
 */
export function splitHostedRows<T extends HostedTask>(
  tasks: T[],
  data: unknown,
): Array<{ task: T; res: { data: any[]; error: null } }> {
  const rows = Array.isArray(data) ? data : [];
  return tasks.map((task) => ({
    task,
    res: {
      data: rows
        .filter((row: any) =>
          row !== null && typeof row === 'object' && typeof row.place_id === 'string' &&
          row.signal_id === task.signalId && Number(row.filter_min) === Number(task.filterMin)
        )
        .map((row: any) => {
          const { signal_id: _signal, filter_min: _floor, ...rest } = row;
          return rest;
        }),
      error: null,
    },
  }));
}

/**
 * Waits for the hosted call, but never longer than `graceMs` after the base
 * calls have finished. A late or failed hosted answer becomes `null` (logged by
 * the caller as hosted=late) and the organic deck is served as today. A late
 * answer that arrives afterwards is dropped: it is caught here (no unhandled
 * rejection) and touches no shared state.
 */
export async function settleHosted<T>(
  hosted: Promise<T>,
  baseDone: Promise<unknown>,
  graceMs = HOSTED_GRACE_MS,
): Promise<T | null> {
  const guarded = hosted.then((v) => v, () => null);
  await Promise.race([guarded, baseDone.then(() => undefined, () => undefined)]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), graceMs);
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
