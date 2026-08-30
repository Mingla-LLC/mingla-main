export type BrandPersonContactChannel = "email" | "phone";
export interface BrandPersonContact { id: string; channel: BrandPersonContactChannel; value: string; isPrimary: boolean }
export interface BrandPersonSuppression { channel: "email" | "sms"; scope: "marketing" | "all" }
export interface BrandPersonSummary {
  personId: string; displayName: string; avatarUrl: string | null; updatedAt: string;
  contacts: BrandPersonContact[]; suppressions: BrandPersonSuppression[];
}
export interface BrandPersonCapabilities {
  canMerge: boolean;
  canPromotePrimary: boolean;
  canViewMergeHistory: boolean;
  canSplit: boolean;
}
export interface BrandPersonIdentitySummary {
  personId: string;
  displayName: string;
  avatarUrl: string | null;
  updatedAt: string;
  alternateNames: string[];
  contacts: BrandPersonContact[];
  linked: boolean;
  identityVersion: string;
}
export interface BrandPersonDetail extends BrandPersonSummary {
  alternateNames: string[];
  linked: boolean;
  identityVersion: string;
  capabilities: BrandPersonCapabilities;
}
export interface BrandPersonMergeCandidateCursor { updatedAt: string; personId: string }
export interface BrandPersonMergeCandidatePage {
  rows: BrandPersonIdentitySummary[];
  nextCursor: BrandPersonMergeCandidateCursor | null;
}
export type BrandPersonMergePreviewState = "ready" | "open_conflict" | "distinct_linked_users";
export interface BrandPersonMergePreview {
  state: BrandPersonMergePreviewState;
  left: BrandPersonIdentitySummary;
  right: BrandPersonIdentitySummary;
  leftVersion: string;
  rightVersion: string;
  hadOpenConflict: boolean;
  hadPriorSeparation: boolean;
}
export interface BrandPersonMergeResult {
  operationId: string;
  mergeEventId: string;
  survivorPersonId: string;
  absorbedPersonId: string;
  identityVersion: string;
  replayed: boolean;
}
export interface BrandPersonPromoteResult {
  operationId: string;
  outcome: "completed" | "unchanged";
  personId: string;
  contactMethodId: string;
  channel: BrandPersonContactChannel;
  identityVersion: string;
  replayed: boolean;
}
export interface BrandPersonMergeHistoryCursor { createdAt: string; mergeEventId: string }
export interface BrandPersonMergeHistoryRow {
  mergeEventId: string;
  status: "active" | "reversed";
  createdAt: string;
  reversedAt: string | null;
  survivorPersonId: string;
  survivorLabel: string;
  counterpartPersonId: string;
  counterpartLabel: string;
  canSplit: boolean;
  eventVersion: string;
}
export interface BrandPersonMergeHistoryPage {
  rows: BrandPersonMergeHistoryRow[];
  nextCursor: BrandPersonMergeHistoryCursor | null;
}
export type BrandPersonSplitPreview =
  | {
    state: "safe";
    mergeEventId: string;
    splitVersion: string;
    left: BrandPersonIdentitySummary;
    right: BrandPersonIdentitySummary;
  }
  | { state: "unsafe"; supportReference: string };
export type BrandPersonSplitResult =
  | {
    operationId: string;
    outcome: "reversed";
    restoredPersonId: string;
    replayed: boolean;
  }
  | {
    operationId: string;
    outcome: "escalated";
    supportReference: string;
    replayed: boolean;
  };
export type BrandPersonMaintenanceOperation =
  | BrandPersonMergeResult
  | BrandPersonPromoteResult
  | BrandPersonSplitResult;
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
  | "people_merge_pair_invalid" | "people_merge_stale" | "people_merge_open_conflict"
  | "people_merge_distinct_users" | "people_split_not_found" | "people_split_stale"
  | "people_split_unsafe" | "people_primary_invalid" | "people_primary_stale"
  | "people_erased_contact_suppressed"
  | PeopleConflictErrorCode;

/* #2305 — the identity-conflict review queue.
 * A conflict row is one SOURCE, but a card is one HUMAN: the list RPC groups
 * every conflict sharing an incoming name, matched address set and candidate
 * set into a single entry carrying `conflictIds`, and the resolve RPC takes
 * that whole array so one decision closes all of a buyer's sources at once.
 * Resolving per source would let an operator answer the same identity question
 * five times inconsistently. */
/* #2305 — `dismiss` is the third outcome. A conflict whose SUBJECT cannot be
 * produced -- the source row is gone, or the manual-add ledger only ever kept a
 * sha256 of what was typed -- has no other exit, and with no exit it wedges the
 * badge, which is this feature's entire notification mechanism. Dismissal links
 * nothing because there is nothing to link, and the RPC proves the absence
 * rather than inferring it from a failed lookup. */
export type ConflictResolution = "merge" | "separate" | "dismiss";
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
  /** Set when the RPC has PROVEN the subject cannot be produced, so the card may
   *  offer Dismiss. `source_row_absent` — the row genuinely no longer exists.
   *  `manual_payload_not_retained` — the ledger holds no payload to recover.
   *  Null means the subject is producible (or we could not prove otherwise), and
   *  dismissing would discard a real buyer. */
  dismissibleReason: "source_row_absent" | "manual_payload_not_retained" | null;
  /** Caller holds rank >= 50 AND the subject is provably unproducible. */
  canDismiss: boolean;
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
  dismissedReason?: string | null;
}
export type PeopleConflictErrorCode =
  | "people_conflict_not_found" | "people_conflict_already_resolved"
  | "people_resolution_invalid" | "people_conflict_candidate_invalid"
  | "people_conflict_source_missing" | "people_conflict_user_collision"
  | "people_conflict_subject_unavailable" | "people_conflict_not_dismissable";
