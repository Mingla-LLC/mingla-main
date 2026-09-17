import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  parseRsvpGuestSnapshot,
  rsvpGuestSnapshotStorageKey,
  rsvpGuestSnapshotVerification,
  serializeRsvpGuestSnapshot,
  type RsvpGuestSnapshot,
  type RsvpGuestSnapshotDetails,
} from "@mingla/offering-rendering/rsvpGuestSnapshot";
import * as RsvpPassRecovery from "../../services/rsvpPassRecoveryService";

const IDENTITY_KEY = "mingla.rsvp.identity.v1";
const SNAPSHOT_PREFIX = "mingla.rsvp.guest.v1:";
export const RSVP_RECOVERY_DENIED = "This saved pass is no longer available. Check your RSVP with the host.";
export const RSVP_RECOVERY_OFFLINE = "We couldn't confirm your pass — try again.";

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
// has wiped this page's memory. #3416 D5 — a reply with no owner field never
// restores for a signed-in guest (see the D2 gate in readSnapshot); for an
// anonymous guest it restores the reply label only, and its pass only after the
// service confirms that exact entity and this event (D1/D4).
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

const ANONYMOUS = JSON.stringify(null);

type VerifiedEntity = { entityType: "primary" | "guest"; entityId: string };
/**
 * #3416 D4 — what the pass service confirmed, bound to the entity it was asked
 * about AND the page's event. `mismatch` (it answered for something else) is a
 * denial; `unconfirmed` (it did not say enough to bind the answer, e.g. a
 * service without the event binding) shows no pass and offers a retry.
 */
const bindServiceCredential = (
  answer: unknown,
  asked: VerifiedEntity,
  eventId: string,
): "mismatch" | "unconfirmed" | { displayName: string; qrCode: string; pdfFetchRef: string } => {
  if (typeof answer !== "object" || answer === null) return "unconfirmed";
  const c = answer as Record<string, unknown>;
  if (
    (c.entityType !== undefined && c.entityType !== asked.entityType) ||
    (c.entityId !== undefined && c.entityId !== asked.entityId) ||
    (c.eventId !== undefined && c.eventId !== eventId)
  ) return "mismatch";
  if (
    c.entityType === undefined || c.entityId === undefined || c.eventId === undefined ||
    typeof c.qrCode !== "string" || c.qrCode.length === 0
  ) return "unconfirmed";
  return {
    displayName: typeof c.displayName === "string" ? c.displayName : "Guest",
    qrCode: c.qrCode,
    pdfFetchRef: typeof c.pdfFetchRef === "string" ? c.pdfFetchRef : asked.entityId,
  };
};
/** The pass as the service returned it; stored credentials are never rendered. */
const confirmedDetails = (
  stored: RsvpGuestSnapshotDetails,
  asked: VerifiedEntity,
  served: { displayName: string; qrCode: string; pdfFetchRef: string },
): RsvpGuestSnapshotDetails => ({
  ...stored,
  guestName: served.displayName,
  credentials: [{ entityType: asked.entityType, entityId: asked.entityId, ...served }],
  anonymousRecovery: stored.anonymousRecovery.filter(
    (entry) => entry.entityType === asked.entityType && entry.entityId === asked.entityId,
  ),
});

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
    // #3416 D2 — tab recovery is for anonymous, token-verified guests only. A
    // signed-in guest's reply never comes back from tab storage (the service
    // issues them no recovery token to check it with).
    if (identity !== ANONYMOUS) return null;
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
  // Bumped only by a newer accepted reply, never by unmount or navigation.
  const accepted = useRef(0);
  const fresh = () => ({
    context,
    snapshot: enabled ? readSnapshot(eventId, identity) : null,
    // #3416 D1 — the pass the service confirmed; null until it has.
    confirmed: null as RsvpGuestSnapshotDetails | null,
    notice: null as string | null,
    attempt: 0,
  });
  const [state, setState] = useState(fresh);
  if (state.context !== context) {
    revision.current += 1;
    setState(fresh());
  }
  const current = useCallback(() => mounted.current && contextRef.current === context, [context]);
  const snapshot = state.context === context ? state.snapshot : null;
  const confirmed = state.context === context ? state.confirmed : null;
  // #3416 D1 — while unconfirmed, only the reply itself ("You're going") is
  // restored; the pass, its QR and the recovery token stay out of the page.
  const restoredRsvp = useMemo(
    () => (snapshot === null ? null : { ...snapshot, details: confirmed }),
    [snapshot, confirmed],
  );
  const onResolved = useCallback((reply: RsvpGuestSnapshot): void => {
    if (!current() || reply.eventId !== eventId) return;
    // Increment even with blocked storage, identical timestamps or reused RSVP IDs.
    revision.current += 1;
    accepted.current += 1;
    setState((value) => ({ ...value, notice: null }));
    const storage = readStorage();
    if (storage === null) return;
    const key = rsvpGuestSnapshotStorageKey(eventId);
    const tab = tabRecovery();
    try {
      if (tab.identity === identity) {
        storage.setItem(key, serializeOwned(reply, identity));
        // The newest accepted reply is now what storage holds.
        tab.stale.delete(key);
      }
    } catch {
      // #3440 F2 — the server-accepted reply stays authoritative in memory, and
      // whatever the key still holds is older than it: never restore it here.
      markStale(tab, key, ANY_BYTES);
    }
  }, [current, eventId, identity]);
  const offline = state.context === context && state.notice === RSVP_RECOVERY_OFFLINE;
  const retryRecovery = useCallback((): void => {
    if (current()) setState((value) => ({ ...value, notice: null, attempt: value.attempt + 1 }));
  }, [current]);

  useEffect(() => {
    if (snapshot === null) return undefined;
    const verification = rsvpGuestSnapshotVerification(snapshot);
    const fetchMetadata = RsvpPassRecovery.fetchPublicRsvpPassMetadata;
    if (verification === null || snapshot.details === null || typeof fetchMetadata !== "function") return undefined;
    const stored = snapshot.details;
    const asked: VerifiedEntity = { entityType: verification.entityType, entityId: verification.entityId };
    const expectedRevision = revision.current;
    const expectedAccepted = accepted.current;
    const storage = readStorage();
    const key = rsvpGuestSnapshotStorageKey(eventId);
    let expectedRaw: string | null | typeof ANY_BYTES = ANY_BYTES;
    try { expectedRaw = storage?.getItem(key) ?? null; } catch { /* Optional persistence. */ }
    let cancelled = false;
    const ownsReply = () => !cancelled && current() && revision.current === expectedRevision;
    const deny = (): void => {
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
      setState((value) => ({ ...value, context, snapshot: null, confirmed: null, notice: RSVP_RECOVERY_DENIED }));
    };
    void fetchMetadata(verification.entityType, verification.entityId, verification.recoveryToken)
      .then((answer: unknown) => {
        if (!ownsReply()) return;
        const bound = bindServiceCredential(answer, asked, eventId);
        if (bound === "mismatch") { deny(); return; }
        if (bound === "unconfirmed") {
          setState((value) => ({ ...value, confirmed: null, notice: RSVP_RECOVERY_OFFLINE }));
          return;
        }
        setState((value) => ({ ...value, confirmed: confirmedDetails(stored, asked, bound), notice: null }));
      }).catch((error: unknown) => {
        const status = (error as { context?: { status?: number } } | null)?.context?.status;
        const definitive = status === 403 || status === 404 || status === 409;
        if (!ownsReply()) {
          // #3416 D3 — the guest left (or switched event) before the answer
          // arrived. A denial still counts for this page: those exact bytes never
          // restore again here. Page memory only; storage is left untouched.
          if (definitive && accepted.current === expectedAccepted && storage !== null) {
            markStale(tabRecovery(), key, expectedRaw);
          }
          return;
        }
        if (!definitive) {
          // #3416 D1 — never fall back to the stored QR; keep "going", offer a retry.
          setState((value) => ({ ...value, confirmed: null, notice: RSVP_RECOVERY_OFFLINE }));
          return;
        }
        deny();
      });
    return () => { cancelled = true; };
  }, [snapshot, context, current, eventId, state.attempt]);
  return {
    restoredRsvp,
    recoveryNotice: state.context === context ? state.notice : null,
    onResolved,
    retryRecovery: offline ? retryRecovery : null,
  };
};
