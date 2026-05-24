import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CollabDeadEndPayload,
  CollabDeadEndReason,
} from './deckService';
import { messagingService } from './messagingService';
import { supabase } from './supabase';
import { toastManager } from '../components/ui/Toast';

const DEBOUNCE_MS = 5 * 60 * 1000;

type ParticipantProfile = {
  first_name?: string | null;
  display_name?: string | null;
};

export type CollabDeadEndParticipant = {
  user_id?: string | null;
  id?: string | null;
  has_accepted?: boolean | null;
  profiles?: ParticipantProfile | null;
  profile?: ParticipantProfile | null;
  name?: string | null;
};

export type CollabParticipantPrefs = Record<string, any>;
export type NormalizedCollabParticipant = {
  id: string;
  name: string;
  hasAccepted?: boolean | null;
};

export type CollabDeadEndBannerInput = {
  sessionId: string;
  reason: CollabDeadEndReason;
  payload?: CollabDeadEndPayload;
  participants: CollabDeadEndParticipant[];
  participantPrefs: CollabParticipantPrefs | null | undefined;
  currentUserId: string;
};

export async function postCollabDeadEndBanner(input: CollabDeadEndBannerInput): Promise<void> {
  const key = `orch_0945_banner_debounce:${input.sessionId}:${input.currentUserId}:${input.reason}`;
  const now = Date.now();

  try {
    const previous = await AsyncStorage.getItem(key);
    const previousTimestamp = previous ? Number(previous) : 0;
    if (Number.isFinite(previousTimestamp) && now - previousTimestamp < DEBOUNCE_MS) {
      toastManager.warning('Already flagged just now.', 2000);
      return;
    }

    const { conversation, error: conversationError } =
      await messagingService.getOrCreateGroupConversationForSession(input.sessionId);
    if (conversationError || !conversation?.id) {
      throw new Error(conversationError ?? 'Group conversation not found');
    }

    const content = buildCollabDeadEndBannerContent(input);
    const { error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        sender_id: input.currentUserId,
        content,
        message_type: 'text',
      });
    if (error) throw new Error(error.message ?? String(error));

    await AsyncStorage.setItem(key, String(now));
  } catch (error) {
    console.warn('[collabDeadEndBannerService] post failed', error);
    toastManager.warning("Couldn't post to the chat. Tap to retry.", 3000);
  }
}

export function buildCollabDeadEndBannerContent(input: CollabDeadEndBannerInput): string {
  const participants = normalizeParticipants(input.participants);
  const prefs = input.participantPrefs ?? {};
  const namesById = new Map(participants.map((p) => [p.id, p.name]));
  const pendingGpsIds = input.payload?.pendingGpsUserIds ?? findPendingGpsIds(participants, prefs);
  const pendingAcceptIds = participants
    .filter((p) => p.hasAccepted === false)
    .map((p) => p.id);

  switch (input.reason) {
    case 'intersection_empty': {
      const outlier = detectIntersectionOutlier(participants, prefs);
      const diagnostic = formatTravelDiagnostic(participants, prefs);
      if (outlier.mode === 'single') {
        const name = namesById.get(outlier.userId) ?? 'A participant';
        return `${name} is too far from the group.\n${diagnostic}\n[[open-prefs:travel:${outlier.userId}]]`;
      }
      const linkedLocations = participants
        .map((p) => `[[open-prefs:location:${p.id}]] ${formatLocationLabel(prefs[p.id])}`)
        .join(' · ');
      return `No location overlap yet.\n${linkedLocations}\nSomeone needs to widen travel or change location.`;
    }
    case 'no_matching_candidates': {
      const noGpsDetail = /no gps/i.test(input.payload?.detail ?? '');
      if (noGpsDetail || pendingGpsIds.length > 0) {
        const waitingNames = pendingGpsIds.map((id) => namesById.get(id) ?? 'A participant');
        const tokenLine = pendingGpsIds.map((id) => `[[open-prefs:location:${id}]]`).join(' ');
        return `Waiting for ${formatNameList(waitingNames)} to share location.\n${tokenLine}`;
      }
      return 'Nobody has picked categories yet. [[open-prefs:self:categories]]';
    }
    case 'no_unswiped_candidates':
      return "You've all seen everything for now. [[open-dismissed]]";
    case 'quorum_not_met': {
      const pending = pendingAcceptIds.length > 0 ? pendingAcceptIds : input.payload?.pendingGpsUserIds ?? [];
      const count = Math.max(1, participants.length - (input.payload?.acceptedCount ?? 0));
      const names = pending.map((id) => namesById.get(id) ?? 'A participant');
      const tokens = pending
        .map((id) => `[[compose-mention:${id}:can_you_tap_accept]]`)
        .join(' ');
      return `Waiting for ${count} more to accept. Pending: ${formatNameList(names)}. ${tokens}`.trim();
    }
    case 'all_pools_exhausted':
      return "You've exhausted today's options. Try next weekend? [[open-prefs:self:dates]]";
  }
}

export function normalizeParticipants(participants: CollabDeadEndParticipant[]): NormalizedCollabParticipant[] {
  return participants.reduce<NormalizedCollabParticipant[]>((acc, participant) => {
    const id = participant.user_id ?? participant.id ?? null;
    if (!id) return acc;
    const profile = participant.profiles ?? participant.profile ?? null;
    acc.push({
      id,
      name: formatParticipantName(participant, profile),
      hasAccepted: participant.has_accepted,
    });
    return acc;
  }, []);
}

export function formatParticipantName(
  participant: CollabDeadEndParticipant,
  profile?: ParticipantProfile | null,
): string {
  return (
    profile?.first_name?.trim() ||
    profile?.display_name?.trim() ||
    participant.name?.trim() ||
    'A participant'
  );
}

export function formatTravelDiagnostic(
  participants: NormalizedCollabParticipant[],
  participantPrefs: CollabParticipantPrefs,
): string {
  return participants
    .map((participant) => {
      const prefs = participantPrefs[participant.id] ?? {};
      const mode = formatTravelMode(prefs.travel_mode);
      const minutes = Number(prefs.travel_constraint_value ?? 30);
      return `${participant.name}: ${mode} ${Number.isFinite(minutes) ? minutes : 30}min from ${formatLocationLabel(prefs)}`;
    })
    .join(' · ');
}

export function formatTravelMode(mode: unknown): 'walking' | 'driving' | 'transit' {
  return mode === 'driving' || mode === 'transit' || mode === 'walking'
    ? mode
    : 'walking';
}

export function formatLocationLabel(prefs: any): string {
  return typeof prefs?.custom_location === 'string' && prefs.custom_location.trim()
    ? prefs.custom_location.trim()
    : 'their location';
}

function findPendingGpsIds(
  participants: NormalizedCollabParticipant[],
  participantPrefs: CollabParticipantPrefs,
): string[] {
  return participants
    .filter((participant) => {
      const prefs = participantPrefs[participant.id] ?? {};
      return prefs.use_gps_location !== true && (prefs.custom_lat == null || prefs.custom_lng == null);
    })
    .map((participant) => participant.id);
}

export function detectIntersectionOutlier(
  participants: NormalizedCollabParticipant[],
  participantPrefs: CollabParticipantPrefs,
): { mode: 'single'; userId: string } | { mode: 'multi' } {
  if (participants.length < 3) return { mode: 'multi' };
  const circles = participants
    .map((participant) => {
      const prefs = participantPrefs[participant.id] ?? {};
      const lat = Number(prefs.custom_lat);
      const lng = Number(prefs.custom_lng);
      const minutes = Number(prefs.travel_constraint_value ?? 30);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(minutes)) return null;
      return {
        userId: participant.id,
        lat,
        lng,
        radiusMeters: Math.max(5, minutes) * metersPerMinute(formatTravelMode(prefs.travel_mode)),
      };
    })
    .filter((circle): circle is { userId: string; lat: number; lng: number; radiusMeters: number } => circle !== null);
  if (circles.length !== participants.length) return { mode: 'multi' };

  const overlapCounts = circles.map((circle) => ({
    userId: circle.userId,
    count: circles.filter((other) => other.userId !== circle.userId && circlesOverlap(circle, other)).length,
  }));
  const isolated = overlapCounts.filter((entry) => entry.count === 0);
  const majorityOverlapCount = participants.length - 2;
  const majorityConnected = overlapCounts
    .filter((entry) => entry.count !== 0)
    .every((entry) => entry.count === majorityOverlapCount);

  return isolated.length === 1 && majorityConnected
    ? { mode: 'single', userId: isolated[0].userId }
    : { mode: 'multi' };
}

function metersPerMinute(mode: 'walking' | 'driving' | 'transit'): number {
  if (mode === 'driving') return 800;
  if (mode === 'transit') return 500;
  return 80;
}

function circlesOverlap(
  a: { lat: number; lng: number; radiusMeters: number },
  b: { lat: number; lng: number; radiusMeters: number },
): boolean {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng) <= a.radiusMeters + b.radiusMeters;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatNameList(names: string[]): string {
  if (names.length === 0) return 'someone';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}
