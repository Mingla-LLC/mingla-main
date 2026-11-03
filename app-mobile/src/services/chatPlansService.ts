/**
 * Issue #4261 — the plan RPCs (spec 4.4), one function each, plus the
 * comments read. Every function throws on failure (a `ChatPlanError` whose
 * `code` is the RPC's `error.message`); nothing returns a fallback.
 */
import { supabase } from './supabase';
import type {
  ChatPlanRpcErrorCode,
  ChatPlansPayload,
  PlanAddOptionResult,
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

export function fetchChatPlans(conversationId: string): Promise<ChatPlansPayload> {
  return call<ChatPlansPayload>('chat_plans_for_conversation', { p_conversation_id: conversationId });
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

export function lockPlan(input: {
  planId: string;
  optionId?: string | null;
  scheduledAt?: string | null;
  durationMinutes?: number;
}): Promise<PlanLockResult> {
  return call<PlanLockResult>('plan_lock', {
    p_plan_id: input.planId,
    p_option_id: input.optionId ?? null,
    p_scheduled_at: input.scheduledAt ?? null,
    p_duration_minutes: input.durationMinutes ?? 120,
  });
}

export function updatePlan(planId: string, title: string, note: string | null): Promise<PlanIdResult> {
  return call<PlanIdResult>('plan_update', { p_plan_id: planId, p_title: title, p_note: note });
}

export function cancelPlan(planId: string): Promise<PlanIdResult> {
  return call<PlanIdResult>('plan_cancel', { p_plan_id: planId });
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
