/**
 * Issue #4261 — plans in chats, personal invite links and group links.
 *
 * These types mirror the jsonb the #4261 RPCs return (spec sections 4.2–4.4)
 * field for field. Services parse into them; nothing here is fabricated on
 * the client. Pure types only: no React Native imports.
 */

// ---------------------------------------------------------------------------
// RPC error codes (spec section 3 error convention). The client reads
// `error.message` as the code.
// ---------------------------------------------------------------------------

export type ChatPlanConflictCode =
  | "conflict_plan_not_deciding"
  | "conflict_rate_limited"
  | "conflict_too_many_times"
  | "conflict_too_many_places"
  | "conflict_plan_cancelled"
  | "conflict_group_full"
  | "conflict_already_decided"
  | "conflict_friend_accept";

export type ChatPlanRpcErrorCode =
  | "not_authenticated"
  | "not_allowed"
  | "invalid_input"
  | "not_found"
  | "unavailable"
  | ChatPlanConflictCode;

/** Refusals `claim_friend_share_link` returns (not raises). */
export type FriendShareClaimRefusal = "invalid_token" | "own_link" | "unavailable";

// ---------------------------------------------------------------------------
// Plans (section 4.4)
// ---------------------------------------------------------------------------

/** Which chats can hold plans (`chat_plan_chat_kind`). */
export type ChatPlanKind = "direct" | "session" | "plain";

export type PlanSource = "chat" | "deck";
export type PlanWhereKind = "place" | "address" | "link" | "none";
export type PlanWhenMode = "set" | "poll" | "none";
export type PlanStatus = "deciding" | "scheduled" | "cancelled";
export type PlanRsvp = "going" | "maybe" | "cant";
export type PlanReaction = "up" | "down";

export interface ChatPlanPlace {
  poolId: string | null;
  providerPlaceId: string | null;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
}

export interface ChatPlanLink {
  url: string;
  domain: string;
  /** Amendment 1 (5.7): the server-fetched page preview; null until it lands or when it failed. */
  title: string | null;
  imageUrl: string | null;
  siteName: string | null;
  /** When the server last tried the preview (any outcome); null when never tried. */
  fetchedAt: string | null;
}

/** Amendment 1 (5.7): one place on a plan's place vote. */
export interface ChatPlanPlaceOption {
  id: string;
  kind: "place" | "address" | "link";
  poolId: string | null;
  providerPlaceId: string | null;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  link: ChatPlanLink | null;
  addedBy: string | null;
  isOriginal: boolean;
  voterIds: string[];
}

export interface ChatPlanOption {
  id: string;
  startsAt: string;
  addedBy: string | null;
  voterIds: string[];
}

export interface ChatPlanRsvps {
  going: string[];
  maybe: string[];
  cant: string[];
}

export interface ChatPlanReactions {
  up: string[];
  down: string[];
}

export interface ChatPlan {
  id: string;
  source: PlanSource;
  sessionId: string | null;
  savedCardId: string | null;
  messageId: string | null;
  messageVisible: boolean;
  createdBy: string | null;
  createdByName: string | null;
  title: string;
  whereKind: PlanWhereKind;
  place: ChatPlanPlace | null;
  link: ChatPlanLink | null;
  /** Deck plans only: the saved card's `card_data`. */
  cardData?: Record<string, unknown> | null;
  whenMode: PlanWhenMode;
  openTimes: boolean;
  status: PlanStatus;
  scheduledAt: string | null;
  durationMinutes: number | null;
  lockedAt: string | null;
  lockedBy: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** Ordered by `startsAt`. */
  options: ChatPlanOption[];
  rsvps: ChatPlanRsvps;
  reactions: ChatPlanReactions;
  commentCount: number;
  canLock: boolean;
  canEdit: boolean;
  canCancel: boolean;
  canAddTime: boolean;
  /** Amendment 1: the place vote, ordered original first then oldest; [] when nobody suggested a place. */
  places: ChatPlanPlaceOption[];
  canAddPlace: boolean;
}

/** `chat_plans_for_conversation(p_conversation_id)` */
export interface ChatPlansPayload {
  viewerId: string;
  memberCount: number;
  historyVisibleFrom: string | null;
  plans: ChatPlan[];
}

/** Server snapshot on a plan comment (`messages.plan_quote`). */
export interface PlanQuoteSnapshot {
  title: string;
  votedStartsAt: string[];
  rsvp: PlanRsvp | null;
  /** Amendment 1 (5.6): the sender's voted places, in option order. */
  votedPlaces?: string[];
}

/** `p_place` argument of `plan_create`. Pool rows: only `poolId` is trusted. */
export interface PlanPlaceInput {
  poolId?: string;
  providerPlaceId?: string;
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface PlanCreateInput {
  conversationId: string;
  clientId: string;
  title: string;
  whereKind: PlanWhereKind;
  place: PlanPlaceInput | null;
  linkUrl: string | null;
  whenMode: PlanWhenMode;
  scheduledAt: string | null;
  options: string[];
  openTimes: boolean;
  note: string | null;
}

export interface PlanCreateResult {
  planId: string;
  messageId: string;
  created: boolean;
}

/** Amendment 1 (5.3): `plan_add_place`. A suggestion is a place; it may carry its own link. */
export interface PlanAddPlaceInput {
  planId: string;
  whereKind: "place" | "address";
  place: PlanPlaceInput;
  linkUrl: string | null;
}

export interface PlanAddPlaceResult {
  optionId: string;
  existed: boolean;
}

export interface PlanAddOptionResult {
  optionId: string;
  existed: boolean;
}

export interface PlanSetVoteResult {
  optionId: string;
  on: boolean;
}

export interface PlanSetRsvpResult {
  status: PlanRsvp | null;
}

export interface PlanSetReactionResult {
  kind: PlanReaction | null;
}

export interface PlanLockResult {
  planId: string;
  scheduledAt: string;
}

export interface PlanIdResult {
  planId: string;
}

/** One row of `search_plan_places`. */
export interface PlanPlaceSearchRow {
  id: string;
  name: string;
  area: string | null;
  lat: number | null;
  lng: number | null;
  photo_url: string | null;
}

/** `card_payload` of a `message_type='plan'` row. */
export interface PlanMessagePayload {
  kind: "plan";
  planId: string;
}

export type PlanEventKind = "time_added" | "place_added" | "locked" | "cancelled";

/** `card_payload` of a plan system row (`chat_plan_post_event`). */
export interface PlanEventPayload {
  kind: "plan_event";
  event: PlanEventKind;
  planId: string;
  actorId: string;
  startsAt?: string;
  scheduledAt?: string;
  /** `place_added` and a vote-decided `locked` (amendment 1, 5.3 / 5.5). */
  placeName?: string;
  optionId?: string;
  placeVoted?: boolean;
}

// ---------------------------------------------------------------------------
// Group links (section 4.3)
// ---------------------------------------------------------------------------

/** `get_or_create_group_link(p_conversation_id)` */
export interface GroupLinkInfo {
  token: string;
  requireApproval: boolean;
  canManage: boolean;
  memberCount: number;
}

/** `group_link_preview(p_token)` */
export interface GroupLinkPreview {
  conversationId: string;
  name: string | null;
  memberCount: number;
  requireApproval: boolean;
  isMember: boolean;
}

export type JoinByLinkStatus = "joined" | "invited" | "requested" | "already_member";

/** `join_group_by_link(p_token, p_share_token)` */
export interface JoinByLinkResult {
  status: JoinByLinkStatus;
  conversationId?: string | null;
  sessionId?: string | null;
  inviteId?: string | null;
  requestId?: string | null;
}

export type GroupJoinRequestStatus = "pending" | "approved" | "declined";

/** A `group_join_requests` row (direct select, RLS-gated). */
export interface GroupJoinRequest {
  id: string;
  conversation_id: string;
  user_id: string;
  sharer_id: string | null;
  status: GroupJoinRequestStatus;
  decided_by: string | null;
  decided_at: string | null;
  message_id: string | null;
  created_at: string;
}

/** `decide_group_join_request(p_request_id, p_approve)` */
export interface DecideJoinRequestResult {
  status: GroupJoinRequestStatus | "invited" | "joined";
  inviteId?: string | null;
}

/** `add_group_members(p_conversation_id, p_user_ids)` */
export interface AddGroupMembersResult {
  added: string[];
  skipped: string[];
}

export type GroupEventKind = "join_request" | "joined_by_link" | "members_added";

/** `card_payload` of a group system row (`chat_group_post_event`). */
export interface GroupEventPayload {
  kind: "group_event";
  event: GroupEventKind;
  requestId?: string;
  userId?: string;
  sharerId?: string | null;
  actorId?: string;
  userIds?: string[];
}

// ---------------------------------------------------------------------------
// Personal invite link (section 4.2)
// ---------------------------------------------------------------------------

/** `get_or_create_friend_share_link()` */
export interface FriendShareLinkInfo {
  token: string;
  referralCode: string | null;
  joinedCount: number;
}

/** `reset_friend_share_link()` */
export interface FriendShareLinkReset {
  token: string;
}

export type FriendShareClaimOutcome = "connected" | "already_friends";

/** `claim_friend_share_link(p_token)` success shape. */
export interface FriendShareClaimSuccess {
  success: true;
  ownerId: string;
  outcome: FriendShareClaimOutcome;
  alreadyClaimed: boolean;
  /** Absent for an already-claimed or already-friends claim. */
  friendRequestId?: string | null;
}

/** `claim_friend_share_link(p_token)` refusal shape. */
export interface FriendShareClaimFailure {
  success: false;
  error: FriendShareClaimRefusal;
}

export type FriendShareClaimResult = FriendShareClaimSuccess | FriendShareClaimFailure;
