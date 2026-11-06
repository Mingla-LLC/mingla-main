/**
 * Issue #4261 — the plan RPCs (spec 4.4), one function each, plus the
 * comments read. Every function throws on failure (a `ChatPlanError` whose
 * `code` is the RPC's `error.message`); nothing returns a fallback.
 */
import { supabase } from './supabase';
import { normalizeChatPlansPayload } from '../components/chat/planModel';
import type {
  ChatPlanRpcErrorCode,
  ChatPlansPayload,
  PlanAddOptionResult,
  PlanAddPlaceInput,
  PlanAddPlaceResult,
  PlanCreateInput,
  PlanCreateResult,
  PlanIdResult,
  PlanLockResult,
  PlanQuoteSnapshot,
  PlanReaction,
  PlanRsvp,
  PlanSetReactionResult,
  PlanSetRsvpResult,
  PlanSetVoteResult,
} from '../types/chatPlans';

const KNOWN_CODES: ReadonlySet<string> = new Set<ChatPlanRpcErrorCode>([
  'not_authenticated',
  'not_allowed',
  'invalid_input',
  'not_found',
  'unavailable',
  'conflict_plan_not_deciding',
  'conflict_rate_limited',
  'conflict_too_many_times',
  'conflict_too_many_places',
  'conflict_plan_cancelled',
  'conflict_group_full',
  'conflict_already_decided',
  'conflict_friend_accept',
]);

export class ChatPlanError extends Error {
  readonly code: ChatPlanRpcErrorCode | 'unknown';

  constructor(code: ChatPlanRpcErrorCode | 'unknown', message: string) {
    super(message);
    this.name = 'ChatPlanError';
    this.code = code;
  }
}

export function parseChatPlanErrorCode(message: string | null | undefined): ChatPlanRpcErrorCode | 'unknown' {
  const text = (message ?? '').trim();
  if (KNOWN_CODES.has(text)) return text as ChatPlanRpcErrorCode;
  const first = text.split(/[\s:]/)[0] ?? '';
  return KNOWN_CODES.has(first) ? (first as ChatPlanRpcErrorCode) : 'unknown';
}

async function call<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new ChatPlanError(parseChatPlanErrorCode(error.message), error.message);
  if (data === null || data === undefined) throw new ChatPlanError('unknown', `${name} returned nothing`);
  return data as T;
}

export async function fetchChatPlans(conversationId: string): Promise<ChatPlansPayload> {
  const payload = await call<ChatPlansPayload>('chat_plans_for_conversation', { p_conversation_id: conversationId });
  return normalizeChatPlansPayload(payload);
}

export function createPlan(input: PlanCreateInput): Promise<PlanCreateResult> {
  return call<PlanCreateResult>('plan_create', {
    p_conversation_id: input.conversationId,
    p_client_id: input.clientId,
    p_title: input.title,
    p_where_kind: input.whereKind,
    p_place: input.place,
    p_link_url: input.linkUrl,
    p_when_mode: input.whenMode,
    p_scheduled_at: input.scheduledAt,
    p_options: input.options,
    p_open_times: input.openTimes,
    p_note: input.note,
  });
}

export function addPlanOption(planId: string, startsAt: string): Promise<PlanAddOptionResult> {
  return call<PlanAddOptionResult>('plan_add_option', { p_plan_id: planId, p_starts_at: startsAt });
}

export function setPlanVote(optionId: string, on: boolean): Promise<PlanSetVoteResult> {
  return call<PlanSetVoteResult>('plan_set_vote', { p_option_id: optionId, p_on: on });
}

export function setPlanRsvp(planId: string, status: PlanRsvp | null): Promise<PlanSetRsvpResult> {
  return call<PlanSetRsvpResult>('plan_set_rsvp', { p_plan_id: planId, p_status: status });
}

export function setPlanReaction(planId: string, kind: PlanReaction | null): Promise<PlanSetReactionResult> {
  return call<PlanSetReactionResult>('plan_set_reaction', { p_plan_id: planId, p_kind: kind });
}

/** Amendment 1 (5.3): suggest a place; a double tap returns `existed`. */
export function addPlanPlace(input: PlanAddPlaceInput): Promise<PlanAddPlaceResult> {
  return call<PlanAddPlaceResult>('plan_add_place', {
    p_plan_id: input.planId,
    p_where_kind: input.whereKind,
    p_place: input.place,
    p_link_url: input.linkUrl,
  });
}

/** Amendment 1 (5.4): a place vote on or off (never a chat line). */
export function setPlanPlaceVote(optionId: string, on: boolean): Promise<PlanSetVoteResult> {
  return call<PlanSetVoteResult>('plan_set_place_vote', { p_option_id: optionId, p_on: on });
}

function rpcResult<T>(name: string, data: unknown, error: { message: string } | null): T {
  if (error) throw new ChatPlanError(parseChatPlanErrorCode(error.message), error.message);
  if (data === null || data === undefined) throw new ChatPlanError('unknown', `${name} returned nothing`);
  return data as T;
}

/**
 * Locks a plan. Literal `supabase.rpc('plan_lock', ...)` (gate #2305 reads the
 * advancer's call sites). `p_place_option_id` is the shown leading place
 * (amendment 1, 5.5); deck plans send null.
 */
export async function lockPlan(input: {
  planId: string;
  optionId?: string | null;
  scheduledAt?: string | null;
  durationMinutes?: number;
  placeOptionId?: string | null;
}): Promise<PlanLockResult> {
  const { data, error } = await supabase.rpc('plan_lock', {
    p_plan_id: input.planId,
    p_option_id: input.optionId ?? null,
    p_scheduled_at: input.scheduledAt ?? null,
    p_duration_minutes: input.durationMinutes ?? 120,
    p_place_option_id: input.placeOptionId ?? null,
  });
  return rpcResult<PlanLockResult>('plan_lock', data, error);
}

export function updatePlan(planId: string, title: string, note: string | null): Promise<PlanIdResult> {
  return call<PlanIdResult>('plan_update', { p_plan_id: planId, p_title: title, p_note: note });
}

/** Literal `supabase.rpc('plan_cancel', ...)` for gate #2305 (same error mapping as `call`). */
export async function cancelPlan(planId: string): Promise<PlanIdResult> {
  const { data, error } = await supabase.rpc('plan_cancel', { p_plan_id: planId });
  return rpcResult<PlanIdResult>('plan_cancel', data, error);
}

/**
 * Amendment 1 (5.9): ask the server to read the plan's link previews. The phone
 * never sends a URL (the server picks the plan's stale links). Background
 * enrichment nobody asked for: a failure is logged, never thrown or toasted;
 * the card keeps showing the domain.
 */
export function requestLinkPreview(planId: string): void {
  supabase.functions
    .invoke('plan-link-preview', { body: { planId } })
    .then(({ error }) => {
      if (error) console.warn('[chatPlansService] link preview failed:', error.message);
    })
    .catch((error: unknown) => {
      console.warn('[chatPlansService] link preview failed:', error);
    });
}

/** One comment on a plan: an ordinary chat message that carries `plan_id`. */
export interface PlanCommentRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string;
  message_type: string;
  plan_id: string;
  plan_quote: PlanQuoteSnapshot | null;
  reply_to_id: string | null;
  created_at: string;
}

export async function listPlanComments(planId: string): Promise<PlanCommentRow[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, content, message_type, plan_id, plan_quote, reply_to_id, created_at')
    .eq('plan_id', planId)
    .neq('message_type', 'plan')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new ChatPlanError(parseChatPlanErrorCode(error.message), error.message);
  return (data ?? []) as PlanCommentRow[];
}

/**
 * Plan posted / chat plan locked: the push goes through the existing
 * notify-message `message` fan-out (spec 4.6). The plan is already saved, so a
 * push failure is logged, never shown as a failed post.
 */
export function notifyPlanMessage(params: {
  senderId: string;
  conversationId: string;
  messageId?: string | null;
  preview: string;
}): void {
  supabase.functions
    .invoke('notify-message', {
      body: {
        type: 'message',
        senderId: params.senderId,
        conversationId: params.conversationId,
        ...(params.messageId ? { messageId: params.messageId } : {}),
        messagePreview: params.preview.slice(0, 100),
      },
    })
    .then(({ error }) => {
      if (error) console.warn('[chatPlansService] plan push failed:', error.message);
    })
    .catch((error: unknown) => {
      console.warn('[chatPlansService] plan push failed:', error);
    });
}

/** The deck path's lock push, as LockedCardSchedulingSheet sends it today. */
export function notifyDeckPlanLocked(params: { sessionId: string; savedCardId: string; scheduledAt: string }): void {
  supabase.functions
    .invoke('notify-session-lock', {
      body: {
        sessionId: params.sessionId,
        savedCardId: params.savedCardId,
        event: 'plan_scheduled',
        scheduledAtIso: params.scheduledAt,
      },
    })
    .then(({ error }) => {
      if (error) console.warn('[chatPlansService] deck lock push failed:', error.message);
    })
    .catch((error: unknown) => {
      console.warn('[chatPlansService] deck lock push failed:', error);
    });
}
