/**
 * socialProofTypes — ORCH-1338 [guest-read-backend] (META-ORCH-1337).
 *
 * THE ONE shared TypeScript payload contract for the social-proof backend
 * reads. Dep-free (no imports, no fetch, no react — I-MOR-0827-PACKAGE-
 * ISOLATION; mirrors rsvpMomentum.ts): the package receives this data via
 * PROPS; every fetch lives in the per-surface host apps.
 *
 * FROZEN API — consumed by ORCH-1339 (momentum card, SPEC §4.1), ORCH-1340
 * (real avatars) and ORCH-1341 (guest-list sheet). The exported names and
 * shapes below are camelCase-identical to the two ORCH-1338 RPC payloads
 * (no client mapping layer):
 *   - `SocialProofSummary`  ← `pg_public_social_proof(p_event_id)`
 *   - `PeerGuestListPage`   ← `peer_list_event_guests(p_event_id, …)`
 * Do not rename, fork, or extend without a spec amendment across the legs.
 */

/**
 * Server-enforced maximum avatar-sample size of `pg_public_social_proof`
 * (`LIMIT 5` in the RPC). The card never receives more than this many entries.
 */
export const SOCIAL_PROOF_SAMPLE_MAX = 5;

/** `events.event_type`, mapped verbatim by both RPCs. */
export type SocialProofEntityType = "rsvp" | "event" | "trip" | "experience";

/**
 * One avatar-cluster sample element (Function A). HARD whitelist: the RPC
 * emits EXACTLY these two keys — no names, no ids, for anon AND authed alike
 * (D1). Entries always carry a non-empty `avatarUrl` (avatar-less guests feed
 * the glyph fill via `goingCount` client-side) and are always linked Mingla
 * users (`isMinglaUser: true`).
 */
export type SocialProofSampleEntry = {
  avatarUrl: string;
  isMinglaUser: true;
};

/**
 * `pg_public_social_proof` payload (json `null` from the RPC ⇒ the caller
 * holds no summary — event missing / not public).
 * - `capacity: null` = unlimited (RSVP no-cap, or ANY unlimited/uncapped
 *   ticket tier) — scarcity language is never fabricated from it.
 * - `privateGuestList: true` ⇒ `sample` is `[]` (server-enforced, D2) and the
 *   peer guest list RPC raises `guest_list_private`.
 */
export type SocialProofSummary = {
  eventId: string;
  entityType: SocialProofEntityType;
  goingCount: number;
  capacity: number | null;
  privateGuestList: boolean;
  hideRemainingCount: boolean;
  sample: SocialProofSampleEntry[];
};

/**
 * One guest row of `peer_list_event_guests` (Function B, authed-only). D1
 * mapping: named row (all identity fields set, `isAnonymous: false`) ONLY for
 * linked guests with visibility public/friends and no block either direction;
 * linked-private guests are `{ isMinglaUser: true, isAnonymous: true }` with
 * all-null identity; unlinked guests are `{ isMinglaUser: false,
 * isAnonymous: true }`. `profileId` is non-null ONLY on named rows (feeds
 * ORCH-1341 add-friend / message actions). `partySize` = 1 + plus-ones (RSVP)
 * or the order's live-ticket count (ticketed).
 */
export type PeerGuestRow = {
  profileId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  isMinglaUser: boolean;
  isAnonymous: boolean;
  partySize: number;
};

/**
 * `peer_list_event_guests` page payload. `returned` = `guests.length` (hard
 * row-cap ≤ 100 server-side); `hasMore` is true exactly when more rows exist
 * past this page (stable ordering: named rows first, then anonymous;
 * `created_at` / row-id tiebreak — offset pagination is deterministic).
 */
export type PeerGuestListPage = {
  eventId: string;
  entityType: SocialProofEntityType;
  returned: number;
  hasMore: boolean;
  guests: PeerGuestRow[];
};
