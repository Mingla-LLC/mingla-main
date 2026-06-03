import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CollabDeadEndPayload,
  CollabDeadEndReason,
} from './deckService';
import { supabase } from './supabase';
import { toastManager } from '../components/ui/Toast';
import {
  resolveParticipantLocationLabel,
  type ParticipantLocationKind,
} from '../utils/formatLocationLabel';
import type { CollabSystemAction } from '../components/chat/MessageBubble';

/**
 * ORCH-1058B — structured payload for a collab dead-end ("notify the group")
 * banner. Written into `messages.card_payload` by rpc_post_collab_dead_end_banner
 * so the chat renderer draws participant·City/ST chips + a tappable prefs button
 * FROM DATA (never by parsing prose). `prose` is the token-stripped degrade text
 * mirrored into `messages.content` for old builds + notification previews.
 */
export type CollabDeadEndBannerPayload = {
  kind: 'collab_dead_end';
  reason: CollabDeadEndReason;
  version: 1;
  participants: {
    id: string;
    name: string;
    label: string;
    locationKind: ParticipantLocationKind;
    a11yLabel: string;
  }[];
  action: CollabSystemAction;
  prose: string;
};

const DEBOUNCE_MS = 5 * 60 * 1000;

// ORCH-1058: same-metro copy-routing heuristic. Two centers are "same metro"
// if within 60 km (comfortably contains a metro + suburbs). DC↔Raleigh at
// 374 km is unambiguously different-city. This NEVER gates the deck — it only
// routes which empty-state copy renders. Spec §3.
export const SAME_CITY_THRESHOLD_M = 60000;

export type IntersectionCase = 'different_cities' | 'same_city_tight' | 'waiting';

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

/**
 * ORCH-1059 — returns a SUCCESS boolean so the caller can decide whether to
 * navigate the user back to the group chat. `true` is returned ONLY when a real
 * banner row actually landed (the RPC returned a message id). Debounce hits and
 * any error path return `false`, leaving the user where they are so they can
 * retry. Toasts are still surfaced internally (global `toastManager`), so the
 * success toast remains visible after the caller navigates back to chat.
 */
export async function postCollabDeadEndBanner(input: CollabDeadEndBannerInput): Promise<boolean> {
  const key = `orch_0945_banner_debounce:${input.sessionId}:${input.currentUserId}:${input.reason}`;
  const now = Date.now();

  try {
    const previous = await AsyncStorage.getItem(key);
    const previousTimestamp = previous ? Number(previous) : 0;
    if (Number.isFinite(previousTimestamp) && now - previousTimestamp < DEBOUNCE_MS) {
      toastManager.warning('Already flagged just now.', 2000);
      return false;
    }

    // ORCH-1058B: post via the SECURITY DEFINER RPC. The RPC resolves the
    // session conversation, re-checks participant authorization, and inserts a
    // TRUE SYSTEM ROW (sender_id=NULL, message_type='system') with the
    // structured payload in card_payload + the token-stripped degrade prose in
    // content. This replaces the prior direct user-attributed `messages` INSERT
    // of a prose string.
    //
    // ORCH-1058B send-UX hardening (the silent-failure fix): `supabase.rpc`
    // does NOT throw on a Postgres error — it RESOLVES with `{ data, error }`.
    // The RPC RAISEs (auth required / conversation not found / not a participant
    // / unknown reason / invalid payload), each of which comes back as a
    // non-null `error`, NOT a thrown exception. The prior try/catch alone could
    // therefore NEVER see a RAISE → the failure was swallowed and the tap
    // no-op'd silently (exactly the reported "no row lands, no feedback"
    // symptom). We now explicitly inspect `error` AND a null `data` (the RPC
    // RETURNS the inserted message uuid on success), route either to the failure
    // toast, and only show the success toast + arm the debounce when a real row
    // landed.
    const p_payload = buildCollabDeadEndBannerPayload(input);
    const { data, error } = await supabase.rpc('rpc_post_collab_dead_end_banner', {
      p_session_id: input.sessionId,
      p_reason: input.reason,
      p_payload,
    });
    if (error) {
      throw new Error(error.message ?? String(error));
    }
    if (!data) {
      // Defensive: no error but no message id returned means nothing was
      // inserted — treat as a failure rather than reporting false success.
      throw new Error('rpc_post_collab_dead_end_banner returned no message id');
    }

    await AsyncStorage.setItem(key, String(now));
    toastManager.success('Group notified', 2000);
    return true;
  } catch (error) {
    console.warn('[collabDeadEndBannerService] post failed', error);
    toastManager.error("Couldn't notify the group. Tap to retry.", 3000);
    return false;
  }
}

/**
 * ORCH-1058B — strip every `[[…]]` system token from a prose string so old
 * builds + notification previews show clean readable text, never raw codes.
 * Exact rule from SPEC §6.
 */
export function stripCollabSystemTokens(content: string): string {
  return content
    .replace(/\s*\[\[[^\]]*\]\]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/**
 * ORCH-1058B — derive the single-source-of-truth button action for a banner.
 * Mirrors the `[[…]]` token the prose carries, so the rendered button targets
 * exactly the same prefs section/participant the legacy inline token would have.
 * SPEC §3.2 action table.
 */
export function buildCollabDeadEndBannerAction(input: CollabDeadEndBannerInput): CollabSystemAction {
  const participants = normalizeParticipants(input.participants);
  const prefs = input.participantPrefs ?? {};
  const selfId = input.currentUserId;
  const pendingGpsIds = input.payload?.pendingGpsUserIds ?? findPendingGpsIds(participants, prefs);

  switch (input.reason) {
    case 'intersection_empty': {
      const outlier = detectIntersectionOutlier(participants, prefs);
      if (outlier.mode === 'single') {
        return { type: 'open-prefs', section: 'travel', userId: outlier.userId };
      }
      const { kind, pendingIds } = classifyIntersectionCase(participants, prefs, pendingGpsIds);
      if (kind === 'waiting') {
        return { type: 'open-prefs', section: 'location', userId: pendingIds[0] ?? selfId };
      }
      if (kind === 'different_cities') {
        return { type: 'open-prefs', section: 'location', userId: selfId };
      }
      // same_city_tight
      return { type: 'open-prefs', section: 'travel', userId: selfId };
    }
    case 'no_matching_candidates': {
      const noGpsDetail = /no gps/i.test(input.payload?.detail ?? '');
      if (noGpsDetail || pendingGpsIds.length > 0) {
        // Multi-token degrade prose lists every pending id; the button targets
        // the first pending, matching deck behavior.
        return { type: 'open-prefs', section: 'location', userId: pendingGpsIds[0] ?? selfId };
      }
      return { type: 'open-prefs-self', section: 'categories' };
    }
    case 'no_unswiped_candidates':
      return { type: 'open-dismissed' };
    case 'quorum_not_met': {
      const pendingAcceptIds = participants
        .filter((p) => p.hasAccepted === false)
        .map((p) => p.id);
      const pending = pendingAcceptIds.length > 0
        ? pendingAcceptIds
        : input.payload?.pendingGpsUserIds ?? [];
      return { type: 'compose-mention', userId: pending[0] ?? selfId, text: 'can you tap accept' };
    }
    case 'all_pools_exhausted':
      return { type: 'open-prefs-self', section: 'dates' };
  }
}

/**
 * ORCH-1058B — build the structured `collab_dead_end` payload the renderer
 * consumes. Reuses `buildCollabDeadEndBannerContent` for the prose (one matrix
 * owner) then strips the inline token; builds the participant chip array exactly
 * like the deck side (`resolveParticipantLocationLabel`, SwipeableCards parity);
 * derives the action from the reason. SPEC §3.2.
 */
export function buildCollabDeadEndBannerPayload(
  input: CollabDeadEndBannerInput,
): CollabDeadEndBannerPayload {
  const participants = normalizeParticipants(input.participants);
  const prefs = input.participantPrefs ?? {};

  const chipParticipants = participants.map((participant) => {
    const resolved = resolveParticipantLocationLabel({
      prefs: prefs[participant.id],
      isSelf: participant.id === input.currentUserId,
    });
    return {
      id: participant.id,
      name: participant.name,
      label: resolved.label,
      locationKind: resolved.kind,
      a11yLabel: `${participant.name}: ${resolved.a11yLabel}`,
    };
  });

  const prose = stripCollabSystemTokens(buildCollabDeadEndBannerContent(input));

  return {
    kind: 'collab_dead_end',
    reason: input.reason,
    version: 1,
    participants: chipParticipants,
    action: buildCollabDeadEndBannerAction(input),
    prose,
  };
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
      // 3+ single-outlier branch keeps its existing string + token unchanged.
      if (outlier.mode === 'single') {
        const name = namesById.get(outlier.userId) ?? 'A participant';
        return `${name} is too far from the group.\n${diagnostic}\n[[open-prefs:travel:${outlier.userId}]]`;
      }

      // ORCH-1058 §3: the multi / 2-person path now routes to one of three
      // honest banner strings. Locations use the shared resolver, so a GPS
      // participant reads their resolved "City, ST" (transparency), and a
      // GPS user with no fix yet reads the pending "Getting a fix…" state.
      const labelFor = (id: string): string =>
        resolveParticipantLocationLabel({
          prefs: prefs[id],
          isSelf: id === input.currentUserId,
        }).label;
      const { kind, pendingIds } = classifyIntersectionCase(participants, prefs, pendingGpsIds);
      const selfId = input.currentUserId;

      if (kind === 'waiting') {
        const pendingId = pendingIds[0] ?? selfId;
        const pendingName = namesById.get(pendingId) ?? 'a friend';
        return `Waiting on ${pendingName}'s location to land — the deck fills in automatically. [[open-prefs:location:${pendingId}]]`;
      }

      const labels = participants.map((p) => labelFor(p.id));
      const [labelA, labelB] = labels;
      if (kind === 'different_cities') {
        const pair = labelB ? `${labelA} and ${labelB}` : labelA;
        return `You're in different cities — ${pair}. Pick one spot you'll all head to. [[open-prefs:location:${selfId}]]`;
      }
      // same_city_tight
      return `So close — you're in the same area but your travel ranges don't touch. Bump travel time or distance? [[open-prefs:travel:${selfId}]]`;
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

// ORCH-1058 (corrected 2026-06-02): a live-GPS participant now yields their
// RESOLVED "City, ST" (transparency), identical to an explicit-location
// participant; a GPS user with no resolved fix yet yields the pending state.
// Delegates to the shared resolver in utils/formatLocationLabel (the §1
// precedence + §2 "City, ST" formatting).
export function formatLocationLabel(prefs: any, isSelf: boolean = false): string {
  return resolveParticipantLocationLabel({ prefs, isSelf }).label;
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

/**
 * ORCH-1058 §3: route the `intersection_empty` empty-state copy into one of
 * three honest cases. Geometry uses the RAW coords (privacy only governs the
 * display string, never the math). Returns `pendingIds` so the caller can
 * compose the "waiting on {Name}" chips/copy.
 *
 *  WAITING          — someone's location hasn't arrived yet AND we have < 2
 *                     known centers (we literally cannot test overlap).
 *  DIFFERENT_CITIES — the known centers span > SAME_CITY_THRESHOLD_M.
 *  SAME_CITY_TIGHT  — everyone's in one metro but circles still don't touch
 *                     (a travel-range problem, not a "nowhere near" problem).
 */
export function classifyIntersectionCase(
  participants: NormalizedCollabParticipant[],
  participantPrefs: CollabParticipantPrefs,
  pendingGpsUserIds: string[] = [],
): { kind: IntersectionCase; pendingIds: string[] } {
  const known: { id: string; lat: number; lng: number }[] = [];
  const noCoords: string[] = [];

  for (const participant of participants) {
    const prefs = participantPrefs[participant.id] ?? {};
    const lat = Number(prefs.custom_lat);
    const lng = Number(prefs.custom_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      known.push({ id: participant.id, lat, lng });
    } else {
      noCoords.push(participant.id);
    }
  }

  // pending = explicit pending-GPS ids ∪ participants with no coords at all.
  const pendingIds = Array.from(new Set([...pendingGpsUserIds, ...noCoords]));

  // CASE (c) WAITING — can't test overlap because < 2 known centers.
  if (pendingIds.length > 0 && known.length < 2) {
    return { kind: 'waiting', pendingIds };
  }

  // CASE (a) DIFFERENT CITIES — max pairwise distance across known centers > threshold.
  let maxPairwise = 0;
  for (let i = 0; i < known.length; i += 1) {
    for (let j = i + 1; j < known.length; j += 1) {
      const d = haversineMeters(known[i].lat, known[i].lng, known[j].lat, known[j].lng);
      if (d > maxPairwise) maxPairwise = d;
    }
  }
  if (maxPairwise > SAME_CITY_THRESHOLD_M) {
    return { kind: 'different_cities', pendingIds };
  }

  // CASE (b) SAME CITY, TIGHT — one metro, ranges don't quite touch.
  return { kind: 'same_city_tight', pendingIds };
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
