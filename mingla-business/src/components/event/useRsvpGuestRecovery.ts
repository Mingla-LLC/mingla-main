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

/** #3440 F2 — "every value this key held when we learned it was stale". */
const ANY_BYTES = Symbol("any stored bytes");
type StaleBytes = Set<string | typeof ANY_BYTES>;

// What this page (one JS runtime per tab) knows that storage may not reflect,
// because a storage write or removal failed. A failed storage write must not
// resurrect credentials later in this same page. The weak key also avoids
// sharing any visitor state between server requests.
interface TabRecovery {
  identity: string | undefined;
  keys: Set<string>;
  // #3440 F2 — bytes the pass service denied, a newer accepted reply
  // superseded, or an identity purge failed to remove. They never restore in
  // this page, whatever storage still holds, until a newer accepted reply for
  // the same key is actually written.
  stale: Map<string, StaleBytes>;
}
const tabs = new WeakMap<object, TabRecovery>();
const tabRecovery = (): TabRecovery => {
  let tab = tabs.get(window);
  if (tab === undefined) {
    tab = { identity: undefined, keys: new Set<string>(), stale: new Map() };
    tabs.set(window, tab);
  }
  return tab;
};
const markStale = (tab: TabRecovery, key: string, raw: string | null | typeof ANY_BYTES): void => {
  if (raw === null) return;
  const bytes = tab.stale.get(key) ?? new Set();
  bytes.add(raw);
  tab.stale.set(key, bytes);
};
const isStale = (tab: TabRecovery, key: string, raw: string): boolean => {
  const bytes = tab.stale.get(key);
  return bytes !== undefined && (bytes.has(ANY_BYTES) || bytes.has(raw));
};

// #3440 F1 — a stored reply names the identity that wrote it. A reply written
// for account A never restores for anyone else, even when the identity marker
// could not be written and the logout purge failed, and even after a reload
// has wiped this page's memory. Only a reply with no owner field at all (the
// shape before this field existed) keeps the older marker-based rules.
const ownerMismatch = (raw: string, identity: string): boolean => {
  try {
    const record = JSON.parse(raw) as unknown;
    if (typeof record !== "object" || record === null || !("owner" in record)) return false;
    return (record as { owner: unknown }).owner !== identity;
  } catch {
    return false; // Unparseable bytes are rejected by the snapshot parser.
  }
};
const serializeOwned = (snapshot: RsvpGuestSnapshot, identity: string): string =>
  JSON.stringify({ ...(JSON.parse(serializeRsvpGuestSnapshot(snapshot)) as object), owner: identity });

const readSnapshot = (eventId: string, identity: string): RsvpGuestSnapshot | null => {
  const storage = readStorage();
  if (storage === null) return null;
  const key = rsvpGuestSnapshotStorageKey(eventId);
  const tab = tabRecovery();
  tab.keys.add(key);
  try {
    const storedIdentity = storage.getItem(IDENTITY_KEY);
    const changed = (tab.identity !== undefined && tab.identity !== identity) ||
      (storedIdentity !== null && storedIdentity !== identity);
    let purgeFailed = false;
    if (changed) {
      // Only our RSVP namespace; never clear unrelated tab/auth/cart storage.
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const candidate = storage.key(index);
          if (candidate?.startsWith(SNAPSHOT_PREFIX)) tab.keys.add(candidate);
        }
      } catch { /* Keys already seen in this page are still purged below. */ }
      for (const candidate of tab.keys) {
        let raw: string | null | typeof ANY_BYTES = ANY_BYTES;
        try { raw = storage.getItem(candidate); } catch { /* Unknown bytes: block them all. */ }
        try {
          storage.removeItem(candidate);
        } catch {
          // #3440 F1 — the purge failed, so the previous identity's bytes are
          // still on disk. Fail closed for them in this page.
          markStale(tab, candidate, raw);
          purgeFailed = true;
        }
      }
    }
    tab.identity = identity;
    // Never vouch for the new identity over bytes a failed purge left behind.
    if (purgeFailed) return null;
    storage.setItem(IDENTITY_KEY, identity);
    if (changed) return null;
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (isStale(tab, key, raw)) {
      try { storage.removeItem(key); } catch { /* Still never restored here. */ }
      return null;
    }
    if (ownerMismatch(raw, identity)) return null;
    return parseRsvpGuestSnapshot(raw, eventId, Date.now());
  } catch {
    // Includes a failed identity-marker write: restore nothing.
    tab.identity = identity;
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
    const storage = readStorage();
    if (storage === null) return;
    const key = rsvpGuestSnapshotStorageKey(eventId);
    const tab = tabRecovery();
    try {
      if (tab.identity === identity) {
        storage.setItem(key, serializeOwned(accepted, identity));
        // The newest accepted reply is now what storage holds.
        tab.stale.delete(key);
      }
    } catch {
      // #3440 F2 — the server-accepted reply stays authoritative in memory, and
      // whatever the key still holds is older than it: never restore it here.
      markStale(tab, key, ANY_BYTES);
    }
  }, [current, eventId, identity]);

  useEffect(() => {
    if (snapshot === null) return undefined;
    const verification = rsvpGuestSnapshotVerification(snapshot);
    const fetchMetadata = RsvpPassRecovery.fetchPublicRsvpPassMetadata;
    if (verification === null || typeof fetchMetadata !== "function") return undefined;
    const expectedRevision = revision.current;
    const storage = readStorage();
    const key = rsvpGuestSnapshotStorageKey(eventId);
    let expectedRaw: string | null | typeof ANY_BYTES = ANY_BYTES;
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
        if (storage !== null) {
          let storedRaw: string | null | typeof ANY_BYTES = ANY_BYTES;
          try { storedRaw = storage.getItem(key); } catch { /* Treated as still ours. */ }
          // Another live owner may have accepted a replacement, even with the same ID.
          if (storedRaw !== ANY_BYTES && storedRaw !== expectedRaw) return;
          // #3440 F2 — the service denied exactly these bytes. Remember that
          // before touching storage, so a failed removal cannot bring them back.
          markStale(tabRecovery(), key, expectedRaw);
          try { storage.removeItem(key); } catch { /* Still remove the denied in-memory private view. */ }
        }
        setState({ context, snapshot: null, notice: RSVP_RECOVERY_DENIED });
      });
    return () => { cancelled = true; };
  }, [snapshot, context, current, eventId]);
  return { restoredRsvp: snapshot, recoveryNotice: state.context === context ? state.notice : null, onResolved };
};
