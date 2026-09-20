/**
 * rsvpGuestSnapshot — what an ANONYMOUS web guest's own RSVP looked like the
 * moment the server accepted it, kept in the browser tab so the page can show
 * it again after a full-page round trip (the chip-in Stripe / Paystack redirect).
 *
 * WHY: an anonymous guest has no session. Their reply, their pass QR and their
 * pass recovery token only ever existed in React state, so returning from a
 * hosted payment page (a full reload) put the page back to the default invite —
 * Going / Maybe / Can't go unselected, as if they had never replied.
 *
 * The HOST decides where the snapshot lives (the business web page uses
 * sessionStorage: the redirect returns in the same tab, and a later visitor on
 * a shared device does not inherit someone else's pass). This module only owns
 * the shape, the key and defensive parsing. Pure and dependency-free.
 */

export const RSVP_GUEST_SNAPSHOT_VERSION = 1;
/** A snapshot older than this is ignored (the guest can still recover by email). */
export const RSVP_GUEST_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RsvpGuestSnapshotStatus = "going" | "not_going" | "waitlisted" | "maybe";
export type RsvpGuestSnapshotApproval = "pending" | "approved";

export interface RsvpGuestSnapshotCredential {
  entityType: "primary" | "guest";
  entityId: string;
  displayName: string;
  qrCode: string | null;
  pdfFetchRef: string;
}

export interface RsvpGuestSnapshotRecovery {
  entityType: "primary" | "guest";
  entityId: string;
  recoveryToken: string | null;
  recoveryUrl: string | null;
}

/** Structurally identical to RsvpConfirmationDetails (the success popup input). */
export interface RsvpGuestSnapshotDetails {
  eventName: string;
  dateLine: string;
  venueLine: string;
  guestName: string;
  status: "going" | "waitlisted" | "pending";
  plusGuests: { name: string }[];
  confirmationToken: string | null;
  credentials: RsvpGuestSnapshotCredential[];
  anonymousRecovery: RsvpGuestSnapshotRecovery[];
}

export interface RsvpGuestSnapshot {
  version: typeof RSVP_GUEST_SNAPSHOT_VERSION;
  eventId: string;
  rsvpId: string;
  guestStatus: RsvpGuestSnapshotStatus;
  guestApproval: RsvpGuestSnapshotApproval;
  /** The success-popup details (Going replies only; null for Maybe / Can't go). */
  details: RsvpGuestSnapshotDetails | null;
  savedAtMs: number;
}

export const rsvpGuestSnapshotStorageKey = (eventId: string): string =>
  `mingla.rsvp.guest.v${RSVP_GUEST_SNAPSHOT_VERSION}:${eventId}`;

export const serializeRsvpGuestSnapshot = (snapshot: RsvpGuestSnapshot): string =>
  JSON.stringify(snapshot);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
const isEntityType = (value: unknown): value is "primary" | "guest" =>
  value === "primary" || value === "guest";

const parseCredential = (value: unknown): RsvpGuestSnapshotCredential | null => {
  if (!isRecord(value)) return null;
  if (
    !isEntityType(value.entityType) ||
    !isString(value.entityId) ||
    !isString(value.displayName) ||
    !isNullableString(value.qrCode) ||
    !isString(value.pdfFetchRef)
  ) {
    return null;
  }
  return {
    entityType: value.entityType,
    entityId: value.entityId,
    displayName: value.displayName,
    qrCode: value.qrCode,
    pdfFetchRef: value.pdfFetchRef,
  };
};

const parseRecovery = (value: unknown): RsvpGuestSnapshotRecovery | null => {
  if (!isRecord(value)) return null;
  if (
    !isEntityType(value.entityType) ||
    !isString(value.entityId) ||
    !isNullableString(value.recoveryToken) ||
    !isNullableString(value.recoveryUrl)
  ) {
    return null;
  }
  return {
    entityType: value.entityType,
    entityId: value.entityId,
    recoveryToken: value.recoveryToken,
    recoveryUrl: value.recoveryUrl,
  };
};

const parseDetails = (value: unknown): RsvpGuestSnapshotDetails | null => {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (
    !isString(value.eventName) ||
    !isString(value.dateLine) ||
    !isString(value.venueLine) ||
    !isString(value.guestName) ||
    (status !== "going" && status !== "waitlisted" && status !== "pending") ||
    !Array.isArray(value.plusGuests) ||
    !isNullableString(value.confirmationToken) ||
    !Array.isArray(value.credentials) ||
    !Array.isArray(value.anonymousRecovery)
  ) {
    return null;
  }
  const credentials = value.credentials.map(parseCredential);
  const anonymousRecovery = value.anonymousRecovery.map(parseRecovery);
  if (credentials.some((c) => c === null) || anonymousRecovery.some((r) => r === null)) {
    return null;
  }
  const plusGuests = value.plusGuests
    .filter(isRecord)
    .map((g) => ({ name: isString(g.name) ? g.name : "" }));
  return {
    eventName: value.eventName,
    dateLine: value.dateLine,
    venueLine: value.venueLine,
    guestName: value.guestName,
    status,
    plusGuests,
    confirmationToken: value.confirmationToken,
    credentials: credentials as RsvpGuestSnapshotCredential[],
    anonymousRecovery: anonymousRecovery as RsvpGuestSnapshotRecovery[],
  };
};

/**
 * Parse a stored snapshot for THIS event. Returns null for anything malformed,
 * for another event's snapshot, for an unknown version, or for one older than
 * `RSVP_GUEST_SNAPSHOT_MAX_AGE_MS` — never a half-trusted object.
 */
export const parseRsvpGuestSnapshot = (
  raw: string | null | undefined,
  eventId: string,
  nowMs: number,
): RsvpGuestSnapshot | null => {
  if (!isString(raw) || raw.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const status = value.guestStatus;
  const approval = value.guestApproval;
  if (
    value.version !== RSVP_GUEST_SNAPSHOT_VERSION ||
    value.eventId !== eventId ||
    !isString(value.rsvpId) ||
    (status !== "going" &&
      status !== "not_going" &&
      status !== "waitlisted" &&
      status !== "maybe") ||
    (approval !== "pending" && approval !== "approved") ||
    typeof value.savedAtMs !== "number" ||
    !Number.isFinite(value.savedAtMs)
  ) {
    return null;
  }
  const age = nowMs - value.savedAtMs;
  if (age < 0 || age > RSVP_GUEST_SNAPSHOT_MAX_AGE_MS) return null;
  const details = value.details === null ? null : parseDetails(value.details);
  if (value.details !== null && details === null) return null;
  return {
    version: RSVP_GUEST_SNAPSHOT_VERSION,
    eventId,
    rsvpId: value.rsvpId,
    guestStatus: status,
    guestApproval: approval,
    details,
    savedAtMs: value.savedAtMs,
  };
};

/**
 * The credential + recovery token the host can use to ask the server whether
 * this reply still stands (the pass endpoint answers going/approved only).
 * Null when the snapshot carries nothing verifiable.
 */
export const rsvpGuestSnapshotVerification = (
  snapshot: RsvpGuestSnapshot,
): { entityType: "primary" | "guest"; entityId: string; recoveryToken: string } | null => {
  if (snapshot.guestStatus !== "going" || snapshot.guestApproval !== "approved") {
    return null;
  }
  const recovery = snapshot.details?.anonymousRecovery.find(
    (r) => r.entityType === "primary" && r.recoveryToken !== null,
  );
  if (recovery === undefined || recovery.recoveryToken === null) return null;
  return {
    entityType: recovery.entityType,
    entityId: recovery.entityId,
    recoveryToken: recovery.recoveryToken,
  };
};
