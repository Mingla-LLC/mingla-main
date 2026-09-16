import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  parseRsvpGuestSnapshot,
  rsvpGuestSnapshotStorageKey,
  rsvpGuestSnapshotVerification,
  serializeRsvpGuestSnapshot,
  type RsvpGuestSnapshot,
} from "@mingla/offering-rendering/rsvpGuestSnapshot";
import * as RsvpPassRecovery from "../../services/rsvpPassRecoveryService";

const IDENTITY_KEY = "mingla.rsvp.identity.v1";
const SNAPSHOT_PREFIX = "mingla.rsvp.guest.v1:";
export const RSVP_RECOVERY_DENIED = "This saved pass is no longer available. Check your RSVP with the host.";
export const RSVP_RECOVERY_OFFLINE = "We couldn't check your RSVP right now. Your saved reply is still here. Refresh to try again.";

const readStorage = (): Storage | null => {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try { return window.sessionStorage ?? null; } catch { return null; }
};

// A failed storage write must not resurrect credentials later in this same page.
// The weak key also avoids sharing any visitor state between server requests.
const tabOwners = new WeakMap<object, { identity: string; keys: Set<string> }>();
const readSnapshot = (eventId: string, identity: string): RsvpGuestSnapshot | null => {
  const storage = readStorage();
  if (storage === null) return null;
  const key = rsvpGuestSnapshotStorageKey(eventId);
  const previous = tabOwners.get(window);
  const keys = previous?.keys ?? new Set<string>();
  keys.add(key);
  try {
    const storedIdentity = storage.getItem(IDENTITY_KEY);
    const changed = (previous !== undefined && previous.identity !== identity) ||
      (storedIdentity !== null && storedIdentity !== identity);
    if (changed) {
      // Only our RSVP namespace; never clear unrelated tab/auth/cart storage.
      for (let index = 0; index < storage.length; index += 1) {
        const candidate = storage.key(index);
        if (candidate?.startsWith(SNAPSHOT_PREFIX)) keys.add(candidate);
      }
      for (const candidate of keys) storage.removeItem(candidate);
    }
    tabOwners.set(window, { identity, keys });
    storage.setItem(IDENTITY_KEY, identity);
    return changed ? null : parseRsvpGuestSnapshot(storage.getItem(key), eventId, Date.now());
  } catch {
    tabOwners.set(window, { identity, keys });
    return null;
  }
};

/** Web recovery is scoped by actual identity + event + accepted reply revision. */
export const useRsvpGuestRecovery = (eventId: string, userId: string | null, enabled: boolean) => {
  const identity = JSON.stringify(userId);
  const contextKey = JSON.stringify([eventId, identity, enabled]);
  const contextRef = useRef({ key: contextKey });
  if (contextRef.current.key !== contextKey) contextRef.current = { key: contextKey };
  const context = contextRef.current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const revision = useRef(0);
  const [state, setState] = useState(() => ({
    context,
    snapshot: enabled ? readSnapshot(eventId, identity) : null,
    notice: null as string | null,
  }));
  if (state.context !== context) {
    revision.current += 1;
    setState({ context, snapshot: enabled ? readSnapshot(eventId, identity) : null, notice: null });
  }
  const current = useCallback(() => mounted.current && contextRef.current === context, [context]);
  const snapshot = state.context === context ? state.snapshot : null;
  const onResolved = useCallback((accepted: RsvpGuestSnapshot): void => {
    if (!current() || accepted.eventId !== eventId) return;
    // Increment even with blocked storage, identical timestamps or reused RSVP IDs.
    revision.current += 1;
    setState((value) => ({ ...value, notice: null }));
    try {
      const storage = readStorage();
      if (storage !== null && tabOwners.get(window)?.identity === identity) {
        storage.setItem(rsvpGuestSnapshotStorageKey(eventId), serializeRsvpGuestSnapshot(accepted));
      }
    } catch { /* The server-accepted reply remains authoritative in memory. */ }
  }, [current, eventId, identity]);

  useEffect(() => {
    if (snapshot === null) return undefined;
    const verification = rsvpGuestSnapshotVerification(snapshot);
    const fetchMetadata = RsvpPassRecovery.fetchPublicRsvpPassMetadata;
    if (verification === null || typeof fetchMetadata !== "function") return undefined;
    const expectedRevision = revision.current;
    const storage = readStorage();
    const key = rsvpGuestSnapshotStorageKey(eventId);
    let expectedRaw: string | null = null;
    try { expectedRaw = storage?.getItem(key) ?? null; } catch { /* Optional persistence. */ }
    let cancelled = false;
    const ownsReply = () => !cancelled && current() && revision.current === expectedRevision;
    void fetchMetadata(verification.entityType, verification.entityId, verification.recoveryToken)
      .then(() => {
        if (ownsReply()) setState((value) => ({ ...value, notice: null }));
      }).catch((error: unknown) => {
        if (!ownsReply()) return;
        const status = (error as { context?: { status?: number } } | null)?.context?.status;
        if (status !== 403 && status !== 404 && status !== 409) {
          setState((value) => ({ ...value, notice: RSVP_RECOVERY_OFFLINE }));
          return;
        }
        try {
          // Another live owner may have accepted a replacement, even with the same ID.
          if (storage !== null && storage.getItem(key) !== expectedRaw) return;
          storage?.removeItem(key);
        } catch { /* Still remove the denied in-memory private view. */ }
        setState({ context, snapshot: null, notice: RSVP_RECOVERY_DENIED });
      });
    return () => { cancelled = true; };
  }, [snapshot, context, current, eventId]);
  return { restoredRsvp: snapshot, recoveryNotice: state.context === context ? state.notice : null, onResolved };
};
