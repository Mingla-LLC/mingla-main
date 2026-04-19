/**
 * DeckStateRegistry — per-context deck state container.
 *
 * ORCH-0490 Phase 2.3. Closes ORCH-0491 (solo↔collab switch loses position) +
 * ORCH-0498 (mixed-deck progressive-delivery double-wipe) + ORCH-0493 RC#1
 * (collab mid-swipe wipe on incoming pref change).
 *
 * Before Phase 2.3 the provider held ONE piece of deck state (accumulated
 * cards, served IDs, batchSeed, current card index, rejected set) that got
 * wiped every time the mode toggled or prefs changed. This registry holds
 * ONE DeckState PER context — solo and each collab session get their own.
 * Mode toggle swaps the `activeContext` pointer; previous context's state is
 * preserved and instantly available on return.
 *
 * SCOPE: in-memory only. Cross-launch persistence to Zustand is Phase 2.5.
 * CONSTITUTIONAL #5: holds ONLY client state (position, rejected set,
 *   pagination cursor, accumulated cards). React Query remains the sole owner
 *   of deck server-fetched data.
 * CONSTITUTIONAL #6: `clearAll()` must be called on logout — wired from
 *   RecommendationsProvider via a user-change effect.
 *
 * Usage:
 *   const registry = useRef<DeckStateRegistry>(new DeckStateRegistry()).current;
 *   registry.setActiveContext({ kind: 'solo' });
 *   const state = registry.get(registry.activeContext); // always returns DeckState
 */
import type { Recommendation } from '../types/recommendation';

export type DeckContext =
  | { kind: 'solo' }
  | { kind: 'collab'; sessionId: string };

export interface DeckState {
  accumulatedCards: Recommendation[];
  servedIds: Set<string>;
  batchSeed: number;
  isExhausted: boolean;
  currentCardIndex: number;
  removedCards: Set<string>;
  lastQueryKey: readonly unknown[] | null;
}

/**
 * Stable string key for a DeckContext. `'solo'` for solo, `'collab:<sessionId>'`
 * for collab. Used as the internal map key. Never expose outside the registry —
 * callers should pass `DeckContext` objects.
 */
export function deckContextKey(ctx: DeckContext): string {
  return ctx.kind === 'solo' ? 'solo' : `collab:${ctx.sessionId}`;
}

/**
 * Factory for a fresh, empty DeckState. Called on first access of a context
 * that has no record yet. Each Set is a NEW instance — no cross-context
 * aliasing.
 */
function createEmptyDeckState(): DeckState {
  return {
    accumulatedCards: [],
    servedIds: new Set<string>(),
    batchSeed: 0,
    isExhausted: false,
    currentCardIndex: 0,
    removedCards: new Set<string>(),
    lastQueryKey: null,
  };
}

export class DeckStateRegistry {
  private readonly states: Map<string, DeckState> = new Map();
  private _activeContext: DeckContext = { kind: 'solo' };

  /**
   * Returns the DeckState for `ctx`. If no record exists yet, lazily creates
   * a fresh empty state, stores it, and returns it. Callers never receive
   * `undefined` — this is load-bearing for the registry-backed lookup in
   * RecommendationsContext.
   */
  get(ctx: DeckContext): DeckState {
    const key = deckContextKey(ctx);
    let state = this.states.get(key);
    if (!state) {
      state = createEmptyDeckState();
      this.states.set(key, state);
    }
    return state;
  }

  /**
   * Writes a DeckState for `ctx`, replacing any existing record. Generally
   * used via mutation of the returned state from `get()`, but provided for
   * callers that need to swap references (e.g. batched update).
   */
  set(ctx: DeckContext, state: DeckState): void {
    this.states.set(deckContextKey(ctx), state);
  }

  /**
   * Removes the DeckState for `ctx`. Subsequent `get(ctx)` calls return a
   * fresh empty state. Used when a session is explicitly terminated (leave
   * or end) and its state should not come back.
   */
  clear(ctx: DeckContext): void {
    this.states.delete(deckContextKey(ctx));
  }

  /**
   * Removes ALL DeckState records AND resets active context to solo. Called
   * on logout per Constitutional #6. After this call, every `get()` returns
   * a fresh empty state.
   */
  clearAll(): void {
    this.states.clear();
    this._activeContext = { kind: 'solo' };
  }

  /**
   * True if a record exists for `ctx`. Does NOT lazy-create. Use this to
   * decide whether a hook should be enabled (e.g. solo hook enabled only if
   * solo context has been touched OR is the active context).
   */
  has(ctx: DeckContext): boolean {
    return this.states.has(deckContextKey(ctx));
  }

  /**
   * The currently active context — the one whose DeckState should drive the
   * UI. Defaults to `{ kind: 'solo' }` on construction.
   */
  get activeContext(): DeckContext {
    return this._activeContext;
  }

  /**
   * Swaps the active context pointer. Does NOT wipe the previous context's
   * state — that's the whole point of Phase 2.3. The previous context's
   * DeckState stays in the registry and is instantly available when the user
   * toggles back.
   */
  setActiveContext(ctx: DeckContext): void {
    this._activeContext = ctx;
  }

  /**
   * DEV-only introspection. Returns the raw map size — used for memory-budget
   * audits (spec §2.3 acceptance input: both hooks alive → cache stays under
   * 1MB).
   */
  get size(): number {
    return this.states.size;
  }
}
