/**
 * Issue #4275 — recovery for the realtime channels of an open chat.
 *
 * What the installed library does (driven over a fake WebSocket and pinned by
 * issue_4275_realtime_library_semantics.implementor.test.ts):
 *   - socket drop / no join reply: CHANNEL_ERROR or TIMED_OUT, then SUBSCRIBED
 *     on the same instance, by itself. Re-creating would fight that rejoin.
 *   - server close: CLOSED and removed from the client. Terminal, no rejoin.
 *   - `system` status:error: no status callback at all, state stays joined.
 *
 * What was missing is the read of whatever arrived during the gap, plus a way
 * back from the two terminal cases. This is the one owner of both.
 *
 * Pure: no React Native imports (Deno unit lane), timers injected.
 *
 * invariant: I-CHAT-RECOVERY-CATCHUP — every return to SUBSCRIBED on an open chat
 * runs a merge-only catch-up, and a library-recoverable error never re-creates a
 * channel. Enforced by issue_4275_chat_recovery.implementor.test.ts.
 */

export type ChatChannelSource = 'changes' | 'broadcast';

export const CATCH_UP_BACKOFF_MS: readonly number[] = [5000, 10000, 20000, 40000, 60000];
export const MAX_POLLS_PER_EPISODE = 8;
export const REBUILD_BACKOFF_MS: readonly number[] = [1000, 2000, 5000, 10000, 30000, 60000];
export const MAX_REBUILDS_PER_EPISODE = 6;
export const CATCH_UP_MIN_INTERVAL_MS = 3000;
export const STABLE_AFTER_MS = 30000;
const JITTER = 0.2;

export interface ChatRecoveryDeps {
  catchUp(): Promise<void>;
  rebuild(source: ChatChannelSource): void;
  channelState(source: ChatChannelSource): string | null;
  isActive(): boolean;
  isOnline(): boolean;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
  random(): number;
}

export interface ChatRecovery {
  onStatus(source: ChatChannelSource, status: string): void;
  onSystemError(source: ChatChannelSource): void;
  onResume(): void;
  dispose(): void;
}

type SourceState = {
  rebuildAttempts: number;
  rebuildTimer: unknown;
  rebuildWanted: boolean;
  stableTimer: unknown;
};

export function createChatRecovery(deps: ChatRecoveryDeps): ChatRecovery {
  let disposed = false;
  // True from a failure until the next SUBSCRIBED: resume re-arms polling from this.
  let changesDown = false;
  // True from a failed read until a read succeeds. The channel can be back while the
  // database is still too slow for the read, and live messages then land above a hole.
  let gapUnread = false;
  let pollAttempts = 0;
  let pollTimer: unknown = null;
  let catchUpRunning = false;
  let catchUpQueued = false;
  let catchUpTimer: unknown = null;
  let lastCatchUpAt: number | null = null;
  const sources: Record<ChatChannelSource, SourceState> = {
    changes: { rebuildAttempts: 0, rebuildTimer: null, rebuildWanted: false, stableTimer: null },
    broadcast: { rebuildAttempts: 0, rebuildTimer: null, rebuildWanted: false, stableTimer: null },
  };

  const canWork = (): boolean => !disposed && deps.isActive() && deps.isOnline();
  const jittered = (ms: number): number => ms * (1 - JITTER + deps.random() * JITTER * 2);
  const clear = (handle: unknown): null => {
    if (handle !== null) deps.clearTimer(handle);
    return null;
  };

  // R6: one read at a time, at most one per interval; extra triggers share one trailing run.
  const requestCatchUp = (): void => {
    if (!canWork()) return;
    if (catchUpRunning || catchUpTimer !== null) {
      catchUpQueued = catchUpRunning;
      return;
    }
    const sinceLast = lastCatchUpAt === null ? Infinity : deps.now() - lastCatchUpAt;
    if (sinceLast < CATCH_UP_MIN_INTERVAL_MS) {
      catchUpTimer = deps.setTimer(() => {
        catchUpTimer = null;
        requestCatchUp();
      }, CATCH_UP_MIN_INTERVAL_MS - sinceLast);
      return;
    }
    catchUpRunning = true;
    lastCatchUpAt = deps.now();
    deps.catchUp()
      .then(() => {
        gapUnread = false;
        if (!changesDown) stopPolling();
      })
      .catch((error: unknown) => {
        console.warn('[chatChannelRecovery] catch-up failed', error);
        // Same backoff and the same per-episode cap as polling, so an overloaded
        // database gets at most MAX_POLLS_PER_EPISODE more reads from this chat.
        gapUnread = true;
        armPoll();
      })
      .finally(() => {
        catchUpRunning = false;
        if (catchUpQueued) {
          catchUpQueued = false;
          requestCatchUp();
        }
      });
  };

  const stopPolling = (): void => {
    pollTimer = clear(pollTimer);
  };

  // R2: never touches the channel, only reads what the gap may have missed.
  const armPoll = (): void => {
    if (disposed || pollTimer !== null || pollAttempts >= MAX_POLLS_PER_EPISODE) return;
    const delay = CATCH_UP_BACKOFF_MS[Math.min(pollAttempts, CATCH_UP_BACKOFF_MS.length - 1)];
    pollTimer = deps.setTimer(() => {
      pollTimer = null;
      // R7: parked; onResume or a new channel from the reconnect effect re-arms.
      if (!canWork()) return;
      pollAttempts += 1;
      requestCatchUp();
      if (changesDown || gapUnread) armPoll();
    }, jittered(delay));
  };

  // R3: the library will not bring this channel back.
  const armRebuild = (source: ChatChannelSource): void => {
    const state = sources[source];
    state.rebuildWanted = true;
    if (disposed || state.rebuildTimer !== null || state.rebuildAttempts >= MAX_REBUILDS_PER_EPISODE) return;
    const delay = REBUILD_BACKOFF_MS[Math.min(state.rebuildAttempts, REBUILD_BACKOFF_MS.length - 1)];
    state.rebuildTimer = deps.setTimer(() => {
      state.rebuildTimer = null;
      if (!canWork()) return;
      state.rebuildAttempts += 1;
      state.rebuildWanted = false;
      deps.rebuild(source);
    }, jittered(delay));
  };

  const clearStable = (source: ChatChannelSource): void => {
    sources[source].stableTimer = clear(sources[source].stableTimer);
  };

  const markDown = (source: ChatChannelSource): void => {
    clearStable(source);
    if (source === 'changes') {
      changesDown = true;
      armPoll();
    }
  };

  return {
    onStatus(source, status) {
      if (disposed) return;
      const state = sources[source];
      if (status === 'SUBSCRIBED') {
        state.rebuildTimer = clear(state.rebuildTimer);
        state.rebuildWanted = false;
        clearStable(source);
        state.stableTimer = deps.setTimer(() => {
          state.stableTimer = null;
          state.rebuildAttempts = 0;
          // Staying subscribed says nothing about a read that keeps failing.
          if (source === 'changes' && !gapUnread) pollAttempts = 0;
        }, STABLE_AFTER_MS);
        if (source === 'changes') {
          changesDown = false;
          stopPolling();
          // R1. Also closes the gap between the open read and the first join.
          requestCatchUp();
        }
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        markDown(source);
        return;
      }
      if (status === 'CLOSED') {
        markDown(source);
        armRebuild(source);
      }
    },

    onSystemError(source) {
      // R4: only postgres_changes reports this; the state stays `joined`.
      if (disposed || source !== 'changes') return;
      markDown(source);
      armRebuild(source);
    },

    onResume() {
      if (disposed) return;
      pollAttempts = 0;
      stopPolling();
      requestCatchUp();
      if (changesDown) armPoll();
      for (const source of ['changes', 'broadcast'] as const) {
        const state = sources[source];
        state.rebuildAttempts = 0;
        state.rebuildTimer = clear(state.rebuildTimer);
        const channelState = deps.channelState(source);
        if (state.rebuildWanted || channelState === 'closed' || channelState === null) {
          if (!canWork()) continue;
          state.rebuildWanted = false;
          state.rebuildAttempts = 1;
          deps.rebuild(source);
        }
      }
    },

    dispose() {
      disposed = true;
      catchUpQueued = false;
      stopPolling();
      catchUpTimer = clear(catchUpTimer);
      for (const source of ['changes', 'broadcast'] as const) {
        sources[source].rebuildTimer = clear(sources[source].rebuildTimer);
        clearStable(source);
      }
    },
  };
}

// ── Status bus ───────────────────────────────────────────────────────────
//
// The channels are created in places this controller's owner cannot reach
// without new props (the receiver lives inside MessageInterface). They publish
// here; the rebuild command for the receiver comes back the same way.

export type ChatChannelEvent =
  | { kind: 'status'; source: ChatChannelSource; conversationId: string; status: string }
  | { kind: 'system_error'; source: ChatChannelSource; conversationId: string }
  | { kind: 'rebuild'; source: ChatChannelSource; conversationId: string };

export type ChatChannelListener = (event: ChatChannelEvent) => void;

export function createChatChannelBus(): {
  emit(event: ChatChannelEvent): void;
  subscribe(listener: ChatChannelListener): () => void;
} {
  const listeners = new Set<ChatChannelListener>();
  return {
    emit(event) {
      for (const listener of Array.from(listeners)) {
        try {
          listener(event);
        } catch (error) {
          console.warn('[chatChannelRecovery] bus listener failed', error);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const chatChannelBus = createChatChannelBus();
