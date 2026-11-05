import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  chatChannelBus,
  createChatRecovery,
  type ChatChannelSource,
  type ChatRecovery,
} from '../utils/chatChannelRecovery';

const RESUME_DEBOUNCE_MS = 600;

export interface UseOpenChatRecoveryOptions {
  /** The open chat's changes-channel key (brand channel: all its ids); null when no chat is open. */
  channelKey: string | null;
  /** The chat the broadcast receiver follows (brand channel: the selected event). */
  conversationId: string | null;
  isOffline: boolean;
  catchUp: () => Promise<void>;
  rebuildChanges: () => void;
  getChangesChannelState: () => string | null;
}

/**
 * Issue #4275 — wires the open chat to its recovery controller
 * (chatChannelRecovery.ts). One controller per open channel; leaving the chat
 * disposes it, so a deliberate leave never recovers.
 *
 * Every callback is held in a ref updated each render, so a timer that fires
 * minutes later never calls a closure from when the chat was opened.
 */
export function useOpenChatRecovery(options: UseOpenChatRecoveryOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const controllerRef = useRef<ChatRecovery | null>(null);
  // The receiver's channel is inside MessageInterface; its last status is all we know of it.
  const broadcastStateRef = useRef<string>('unknown');

  const { channelKey } = options;

  useEffect(() => {
    if (!channelKey) return undefined;
    broadcastStateRef.current = 'unknown';

    const controller = createChatRecovery({
      catchUp: () => latest.current.catchUp(),
      rebuild: (source: ChatChannelSource) => {
        if (source === 'changes') {
          latest.current.rebuildChanges();
          return;
        }
        const target = latest.current.conversationId;
        if (target) chatChannelBus.emit({ kind: 'rebuild', source: 'broadcast', conversationId: target });
      },
      channelState: (source: ChatChannelSource) =>
        source === 'changes' ? latest.current.getChangesChannelState() : broadcastStateRef.current,
      // Not `=== 'active'`: iOS passes through `inactive` for Control Center, and
      // inactive to active is not a resume, so work parked there would never re-arm.
      isActive: () => AppState.currentState !== 'background',
      isOnline: () => !latest.current.isOffline,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      random: () => Math.random(),
    });
    controllerRef.current = controller;

    const unsubscribe = chatChannelBus.subscribe((event) => {
      if (event.kind === 'rebuild') return;
      const expected = event.source === 'changes' ? channelKey : latest.current.conversationId;
      if (event.conversationId !== expected) return;
      if (event.kind === 'system_error') {
        controller.onSystemError(event.source);
        return;
      }
      if (event.source === 'broadcast') {
        broadcastStateRef.current = event.status === 'CLOSED' ? 'closed' : 'joined';
      }
      controller.onStatus(event.source, event.status);
    });

    return () => {
      unsubscribe();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [channelKey]);

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const subscription = AppState.addEventListener('change', (next) => {
      // Only background -> active is a resume. iOS inactive -> active (Control
      // Center, notification shade) changes nothing about the sockets.
      const resumed = previous === 'background' && next === 'active';
      previous = next;
      if (!resumed) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        controllerRef.current?.onResume();
      }, RESUME_DEBOUNCE_MS);
    });
    return () => {
      if (debounce) clearTimeout(debounce);
      subscription.remove();
    };
  }, []);
}
