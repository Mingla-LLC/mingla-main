export type BrandPersonContactChannel = "email" | "phone";
export interface BrandPersonContact { id: string; channel: BrandPersonContactChannel; value: string; isPrimary: boolean }
export interface BrandPersonSuppression { channel: "email" | "sms"; scope: "marketing" | "all" }
export interface BrandPersonSummary {
  personId: string; displayName: string; avatarUrl: string | null; updatedAt: string;
  contacts: BrandPersonContact[]; suppressions: BrandPersonSuppression[];
}
export interface BookCursor { updatedAt: string; personId: string }
export interface BrandPeopleBookPage { rows: BrandPersonSummary[]; nextCursor: BookCursor | null; bookTotal: number; filteredTotal: number }
export interface AddBrandPersonInput {
  brandId: string; displayName: string; email: string | null; phoneE164: string | null;
  phoneCountryIso: string | null; clientRequestId: string;
}
export interface AddBrandPersonResult { outcome: "created" | "updated" | "unchanged" | "review"; person: BrandPersonSummary | null; conflictId: string | null }
export type PeopleErrorCode =
  | "people_forbidden" | "people_not_found" | "people_limit_invalid" | "people_search_invalid"
  | "people_cursor_invalid" | "people_name_invalid" | "people_email_invalid" | "people_phone_invalid"
  | "people_contact_required" | "people_idempotency_conflict" | "people_temporarily_unavailable" | "people_unknown"
  | PeopleConflictErrorCode;

/* #2305 — the identity-conflict review queue.
 * A conflict row is one SOURCE, but a card is one HUMAN: the list RPC groups
 * every conflict sharing an incoming name, matched address set and candidate
 * set into a single entry carrying `conflictIds`, and the resolve RPC takes
 * that whole array so one decision closes all of a buyer's sources at once.
 * Resolving per source would let an operator answer the same identity question
 * five times inconsistently. */
export type ConflictResolution = "merge" | "separate";
export type BrandPersonConflictSourceKind =
  | "event_rsvp" | "rsvp_plus_one" | "order" | "ticket_holder"
  | "reservation" | "stay_reservation" | "manual" | "import";
export type BrandPersonConflictReason =
  | "different_nonempty_names" | "multi_person_address_chain" | "manual_review";
export interface BrandPersonConflictIncoming {
  displayName: string | null; email: string | null; phone: string | null;
}
export interface BrandPersonConflictCandidate {
  personId: string; displayName: string; avatarUrl: string | null;
  contacts: { channel: BrandPersonContactChannel; value: string; isPrimary: boolean }[];
}
export interface BrandPersonConflict {
  conflictIds: string[];
  sourceKinds: BrandPersonConflictSourceKind[];
  reason: BrandPersonConflictReason;
  createdAt: string;
  /** Caller holds rank >= 50 AND the incoming identity is recoverable. */
  canResolve: boolean;
  /** False for a hand-typed add: `brand_person_manual_add_requests` stores only
   *  a sha256 of the payload, so the incoming identity cannot be shown and must
   *  never be invented. The row is still listed — it is not hidden. */
  detailsRetained: boolean;
  incoming: BrandPersonConflictIncoming;
  candidates: BrandPersonConflictCandidate[];
  matchedOn: BrandPersonContactChannel[];
}
export interface BrandPersonConflictPage { openCount: number; rows: BrandPersonConflict[] }
export interface ResolveBrandPersonConflictInput {
  brandId: string; conflictIds: string[]; resolution: ConflictResolution;
  winnerPersonId: string | null; clientRequestId: string;
}
export interface ResolveBrandPersonConflictResult {
  conflictIds: string[]; resolution: ConflictResolution; personId: string | null;
  links: { conflictId: string; sourceLinkId: string }[];
  mergedPersonIds: string[]; replayed: boolean;
}
export type PeopleConflictErrorCode =
  | "people_conflict_not_found" | "people_conflict_already_resolved"
  | "people_resolution_invalid" | "people_conflict_candidate_invalid"
  | "people_conflict_source_missing" | "people_conflict_user_collision"
  | "people_conflict_subject_unavailable";
