import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { blockService } from './blockService';
import { getDisplayName } from '../utils/getDisplayName';

/**
 * ORCH-0667 + ORCH-0685: snapshot payload for shared-card chat messages.
 *
 * Carries every ExpandedCardModal-render-relevant field so chat-shared cards
 * render with ~95% parity to deck-tap cards (per ORCH-0685 DEC-1).
 *
 * EXPLICITLY EXCLUDED — do NOT add `travelTime`, `travelTimeMin`, `distance`,
 * `distanceKm`, `distance_km` or any other recipient-relative field. Sender's
 * value would fabricate for the recipient (Constitution #9 violation).
 * Cross-ref: ORCH-0659/0660 distance/travel-time lesson.
 * Enforced by: invariant I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS +
 * CI gate in scripts/ci-check-invariants.sh.
 *
 * SIZE BUDGET: 5KB (preserved from ORCH-0667). Drop order under pressure
 * defined in trimCardPayload below: drop optional rich fields first,
 * essentials never dropped.
 */
export interface CardPayload {
  // ── REQUIRED ESSENTIALS (never dropped under size pressure) ─────────────
  id: string;                    // place_pool.id — analytics dedup; NOT for refetch
  title: string;                 // hero / bubble title
  category: string | null;       // canonical slug (e.g., 'casual_food'); rendered via getReadableCategoryName at consumer site
  image: string | null;          // primary image URL

  // ── ORCH-0685 DEC-1 ADDITIONS — modal-render-relevant ──────────────────
  /** lat/lng pair. Required by ExpandedCardModal weather + busyness + booking fetch gates. */
  location?: { lat: number; lng: number };
  /** Google Place ID. Required by ExpandedCardModal booking dedup. */
  placeId?: string;
  /** Optional explicit icon name; falls back to getCategoryIcon(category) at render. */
  categoryIcon?: string;
  /** Render in CardInfoSection tag chips row. */
  tags?: string[];
  /** Forward-positioned per ORCH-0685.D-5 — modal does not render today; persisted for future enablement. */
  matchFactors?: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  /** Forward-positioned per ORCH-0685.D-5 — modal does not render today. */
  socialStats?: {
    views: number;
    likes: number;
    saves: number;
    shares?: number;
  };
  /** Phone number for booking + PracticalDetailsSection phone row. */
  phone?: string;
  /** Website URL for booking + PracticalDetailsSection website row. */
  website?: string;
  /** Opening-hours data; multiple legacy shapes per ExpandedCardData. */
  openingHours?:
    | string
    | { open_now?: boolean; weekday_text?: string[] }
    | { openNow?: boolean; periods?: unknown[]; nextOpenTime?: string; nextCloseTime?: string; weekdayDescriptions?: string[] }
    | Record<string, string>
    | null;
  /** Date/time for weather + timeline. ISO string only (Date is not JSON-serializable). */
  selectedDateTime?: string;

  // ── ORCH-0667 ORIGINAL OPTIONAL FIELDS (preserved) ──────────────────────
  images?: string[];             // gallery — drop under pressure
  rating?: number;
  reviewCount?: number;
  priceRange?: string;
  address?: string;
  description?: string;          // capped 500 chars at trim
  highlights?: string[];         // cap 5 × 80 chars at trim
  matchScore?: number;

  // ── ORCH-0908: lock-in metadata (present iff card was shared via lock-and-schedule) ──
  /** Discriminator — when set, MessageBubble + ExpandedCardModal render the locked-in banner + Add-to-Calendar CTA. */
  lockInEvent?: 'card_locked_and_scheduled';
  /** ISO timestamp the card was locked-in for. Mirrors selectedDateTime for ExpandedCardModal time-of-day rendering. */
  scheduledAt?: string;
  /** Locked-in duration in minutes (15-1440). */
  durationMinutes?: number;
  /** Profile UUID of the user who locked the card. Resolved to display name at render time. */
  lockerUserId?: string;
  /** board_saved_cards.id — used to look up calendar_entries for per-viewer "Added ✓" state on the Add-to-Calendar CTA. */
  savedCardId?: string;
  /** collaboration_sessions.id — used for "View session" affordance on the locked card. */
  sessionId?: string;

  // ── ORCH-0910: intent (curated) card fields ───────────────────────────
  /** Card shape discriminator. Absent or 'single' = single-place card; 'curated' = multi-stop intent. */
  cardType?: 'curated' | 'single';
  /** Multi-stop itinerary. Only set when cardType === 'curated'. Trimmed per TrimmedCuratedStop shape. */
  stops?: TrimmedCuratedStop[];
  /** Intent tagline (e.g., "A leisurely museum-to-restaurant evening"). */
  tagline?: string;
  /** Intent total price range — min. */
  totalPriceMin?: number;
  /** Intent total price range — max. */
  totalPriceMax?: number;
  /** Intent total estimated duration (all stops + travel). */
  estimatedDurationMinutes?: number;
}

/**
 * ORCH-0910: minimum viable per-stop fields for an intent card in the 5KB chat payload budget.
 * Stricter subset of CuratedStop — drops imageUrls[1..N] and openingHours to fit.
 * Kept fields are the minimum needed by ExpandedCardModal's curated render branch.
 */
export interface TrimmedCuratedStop {
  stopNumber: number;
  placeName: string;
  placeId: string;
  imageUrl: string | null;
  lat: number;
  lng: number;
  priceLevelLabel: string;
  priceTier: string;
  rating: number;
  estimatedDurationMinutes: number;
  // Soft fields kept if size budget allows; dropped in order per trimCardPayload.
  stopLabel?: 'Start Here' | 'Then' | 'End With' | 'Explore' | 'Optional';
  placeType?: string;
  aiDescription?: string;
  travelModeFromPreviousStop?: string | null;
  address?: string;
  travelTimeFromPreviousStopMin?: number | null;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string;
  message_type: 'text' | 'image' | 'video' | 'file' | 'card';
  file_url?: string;
  file_name?: string;
  file_size?: number;
  card_payload?: CardPayload;  // ORCH-0667: present iff message_type = 'card'
  mentions?: Array<MentionEntry | string>;
  card_tags?: CardTagEntry[];
  reply_to_id?: string | null;
  marketing_campaign_id?: string | null;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  sender_name?: string;
  is_read?: boolean;
  isSystem?: boolean;
}

export interface MentionEntry {
  userId: string;
  displayName: string;
  startOffset: number;
  endOffset: number;
}

export interface CardTagEntry {
  savedCardId: string;
  cardPayload: CardPayload;
}

const COLLAB_TOKEN_USER_ID = '[a-zA-Z0-9_-]+';
const COLLAB_DEAD_END_BANNER_PATTERNS = [
  new RegExp(`^.+ is too far from the group\\.[\\s\\S]*\\[\\[open-prefs:travel:${COLLAB_TOKEN_USER_ID}\\]\\]$`),
  new RegExp(`^No location overlap yet\\.[\\s\\S]*\\[\\[open-prefs:location:${COLLAB_TOKEN_USER_ID}\\]\\]`),
  new RegExp(`^Waiting for .+ to share location\\.[\\s\\S]*\\[\\[open-prefs:location:${COLLAB_TOKEN_USER_ID}\\]\\]`),
  /^Nobody has picked categories yet\. \[\[open-prefs:self:categories\]\]$/,
  /^You've all seen everything for now\. \[\[open-dismissed\]\]$/,
  new RegExp(`^Waiting for \\d+ more to accept\\. Pending: .+ \\[\\[compose-mention:${COLLAB_TOKEN_USER_ID}:can_you_tap_accept\\]\\]`),
  /^You've exhausted today's options\. Try next weekend\? \[\[open-prefs:self:dates\]\]$/,
];

export function isCollabDeadEndBannerMessage(content: unknown): boolean {
  return typeof content === 'string' && COLLAB_DEAD_END_BANNER_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * ORCH-0667 + ORCH-0685: trim a SavedCardModel to a CardPayload, enforcing
 * the <5KB budget.
 *
 * Drop order under pressure (v3 — extended for ORCH-0685 + ORCH-0910):
 *   matchFactors → socialStats → tags → openingHours → highlights →
 *   description → images → address → tagline → stops[].aiDescription →
 *   stops[].placeType → stops[].travelModeFromPreviousStop →
 *   stops[].stopLabel → stops[].address → stops[].travelTimeFromPreviousStopMin →
 *   tail-end stops
 * Required fields {id, title, category, image} are NEVER dropped.
 * NEW fields with hard render dependencies (location, placeId, categoryIcon)
 * are also never dropped — without them, ExpandedCardModal sections silently
 * skip (defeats the entire ORCH-0685 fix).
 * ORCH-0910: curated cards synthesize top-level image from stops[].imageUrl,
 * preserve cardType + minimum stop shape, and still honor the 5KB budget.
 *
 * FORBIDDEN FIELDS — do NOT extract under any circumstance:
 *   - travelTime, travelTimeMin, distance, distanceKm, distance_km
 *   - These are recipient-relative; sender's value fabricates (Constitution #9).
 *   - Cross-ref: ORCH-0659/0660. Enforced by:
 *     I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS (CI-gated).
 */
export function trimCardPayload(card: any): CardPayload {
  // [ORCH-0685 RC-2 FIX] Required essentials — never dropped, never absent.
  const trimmed: CardPayload = {
    id: card.id,
    title: card.title || 'Saved experience',
    category: card.category ?? null,
    image: card.image ?? null,
  };

  // [ORCH-0685 DEC-1] Hard-render-dependent additions (never dropped under pressure).
  if (card.location && typeof card.location.lat === 'number' && typeof card.location.lng === 'number') {
    trimmed.location = { lat: card.location.lat, lng: card.location.lng };
  }
  if (typeof card.placeId === 'string' && card.placeId.length > 0) {
    trimmed.placeId = card.placeId;
  }
  if (typeof card.categoryIcon === 'string' && card.categoryIcon.length > 0) {
    trimmed.categoryIcon = card.categoryIcon;
  }

  // [ORCH-0910] Curated card detection + intent-specific fields.
  const isCurated = card.cardType === 'curated' || Array.isArray(card.stops);
  if (isCurated) {
    trimmed.cardType = 'curated';
    if (!trimmed.image) {
      const firstStopImage = card.stops?.find?.((s: any) => typeof s?.imageUrl === 'string' && s.imageUrl.length > 0)?.imageUrl;
      if (firstStopImage) trimmed.image = firstStopImage;
    }
    if (typeof card.tagline === 'string' && card.tagline.length > 0) trimmed.tagline = card.tagline;
    if (typeof card.totalPriceMin === 'number') trimmed.totalPriceMin = card.totalPriceMin;
    if (typeof card.totalPriceMax === 'number') trimmed.totalPriceMax = card.totalPriceMax;
    if (typeof card.estimatedDurationMinutes === 'number') trimmed.estimatedDurationMinutes = card.estimatedDurationMinutes;
    if (Array.isArray(card.stops) && card.stops.length > 0) {
      trimmed.stops = card.stops.map((s: any, idx: number): TrimmedCuratedStop => ({
        stopNumber: typeof s.stopNumber === 'number' ? s.stopNumber : idx + 1,
        placeName: String(s.placeName ?? '').slice(0, 100),
        placeId: String(s.placeId ?? ''),
        imageUrl: typeof s.imageUrl === 'string' && s.imageUrl.length > 0 ? s.imageUrl : null,
        lat: Number(s.lat) || 0,
        lng: Number(s.lng) || 0,
        priceLevelLabel: String(s.priceLevelLabel ?? '').slice(0, 32),
        priceTier: String(s.priceTier ?? ''),
        rating: Number(s.rating) || 0,
        estimatedDurationMinutes: Number(s.estimatedDurationMinutes) || 45,
        stopLabel: typeof s.stopLabel === 'string' ? s.stopLabel : undefined,
        placeType: typeof s.placeType === 'string' ? s.placeType.slice(0, 80) : undefined,
        aiDescription: typeof s.aiDescription === 'string' ? s.aiDescription.slice(0, 300) : undefined,
        travelModeFromPreviousStop: typeof s.travelModeFromPreviousStop === 'string' ? s.travelModeFromPreviousStop : null,
        address: typeof s.address === 'string' ? s.address.slice(0, 200) : undefined,
        travelTimeFromPreviousStopMin: typeof s.travelTimeFromPreviousStopMin === 'number' ? s.travelTimeFromPreviousStopMin : null,
      }));
    }
  }

  // [ORCH-0685 DEC-1] Soft-render fields (drop in size-guard order if budget exceeded).
  if (Array.isArray(card.tags) && card.tags.length) {
    trimmed.tags = card.tags
      .slice(0, 10)
      .map((t: any) => String(t).slice(0, 32));
  }
  if (card.matchFactors && typeof card.matchFactors === 'object') {
    const mf = card.matchFactors;
    trimmed.matchFactors = {
      location: Number(mf.location) || 0,
      budget: Number(mf.budget) || 0,
      category: Number(mf.category) || 0,
      time: Number(mf.time) || 0,
      popularity: Number(mf.popularity) || 0,
    };
  }
  if (card.socialStats && typeof card.socialStats === 'object') {
    const ss = card.socialStats;
    trimmed.socialStats = {
      views: Number(ss.views) || 0,
      likes: Number(ss.likes) || 0,
      saves: Number(ss.saves) || 0,
      shares: Number(ss.shares) || 0,
    };
  }
  if (typeof card.phone === 'string' && card.phone.length > 0) trimmed.phone = card.phone;
  if (typeof card.website === 'string' && card.website.length > 0) trimmed.website = card.website;
  if (card.openingHours !== undefined && card.openingHours !== null) {
    trimmed.openingHours = card.openingHours;
  }
  if (card.selectedDateTime instanceof Date) {
    trimmed.selectedDateTime = card.selectedDateTime.toISOString();
  } else if (typeof card.selectedDateTime === 'string' && card.selectedDateTime.length > 0) {
    trimmed.selectedDateTime = card.selectedDateTime;
  }

  // [ORCH-0667 v1 fields — preserved]
  if (Array.isArray(card.images) && card.images.length) {
    trimmed.images = card.images.slice(0, 6);
  }
  if (typeof card.rating === 'number') trimmed.rating = card.rating;
  if (typeof card.reviewCount === 'number') trimmed.reviewCount = card.reviewCount;
  if (card.priceRange) trimmed.priceRange = card.priceRange;
  if (card.address) trimmed.address = card.address;
  if (card.description) {
    trimmed.description = String(card.description).slice(0, 500);
  }
  if (Array.isArray(card.highlights) && card.highlights.length) {
    trimmed.highlights = card.highlights
      .slice(0, 5)
      .map((h: any) => String(h).slice(0, 80));
  }
  if (typeof card.matchScore === 'number') trimmed.matchScore = card.matchScore;

  // ORCH-0685 §6.3 + ORCH-0910 — drop optional fields in reverse priority if over budget.
  // 'location', 'placeId', 'categoryIcon', 'image', 'cardType' are NOT in dropOrder.
  // For curated cards: drop stop-soft-fields BEFORE dropping whole stops.
  const dropOrder: (keyof CardPayload)[] = [
    'matchFactors',
    'socialStats',
    'tags',
    'openingHours',
    'highlights',
    'description',
    'images',
    'address',
    'tagline',
  ];
  let size = JSON.stringify(trimmed).length;
  for (const key of dropOrder) {
    if (size <= 5120) break;
    delete trimmed[key];
    size = JSON.stringify(trimmed).length;
  }

  // ORCH-0910 — curated-specific drop order on stops[] subfields.
  if (Array.isArray(trimmed.stops) && size > 5120) {
    trimmed.stops = trimmed.stops.map(s => ({ ...s, aiDescription: undefined }));
    size = JSON.stringify(trimmed).length;
  }
  if (Array.isArray(trimmed.stops) && size > 5120) {
    trimmed.stops = trimmed.stops.map(s => ({ ...s, placeType: undefined }));
    size = JSON.stringify(trimmed).length;
  }
  if (Array.isArray(trimmed.stops) && size > 5120) {
    trimmed.stops = trimmed.stops.map(s => ({ ...s, travelModeFromPreviousStop: undefined }));
    size = JSON.stringify(trimmed).length;
  }
  if (Array.isArray(trimmed.stops) && size > 5120) {
    trimmed.stops = trimmed.stops.map(s => ({ ...s, stopLabel: undefined }));
    size = JSON.stringify(trimmed).length;
  }
  if (Array.isArray(trimmed.stops) && size > 5120) {
    trimmed.stops = trimmed.stops.map(s => ({ ...s, address: undefined }));
    size = JSON.stringify(trimmed).length;
  }
  if (Array.isArray(trimmed.stops) && size > 5120) {
    trimmed.stops = trimmed.stops.map(s => ({ ...s, travelTimeFromPreviousStopMin: undefined }));
    size = JSON.stringify(trimmed).length;
  }
  while (Array.isArray(trimmed.stops) && trimmed.stops.length > 1 && size > 5120) {
    trimmed.stops = trimmed.stops.slice(0, -1);
    size = JSON.stringify(trimmed).length;
  }

  return trimmed;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name?: string | null;
  session_id?: string | null;
  event_id?: string | null;
  linked_entity_type?: 'direct' | 'session' | 'trip' | 'event';
  is_broadcast_only?: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_message_at?: string;
  participants: {
    id: string;
    user_id: string;
    joined_at: string;
    last_read_at?: string;
  }[];
  last_message?: DirectMessage;
  unread_count?: number;
}

export class MessagingService {
  private channels: Map<string, RealtimeChannel> = new Map();
  private senderProfileCache: Map<string, { name: string; cachedAt: number }> = new Map();
  private static PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Find an existing direct conversation between two users (no friendship gate, no creation).
   * Used for notification deep-links where the conversation is known to exist.
   */
  async findExistingDirectConversation(userId1: string, userId2: string): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      const { data: user1Convs, error: u1Err } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId1);
      if (u1Err) throw u1Err;
      if (!user1Convs || user1Convs.length === 0) {
        return { conversation: null, error: null };
      }

      const { data: user2Convs, error: u2Err } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .in('conversation_id', user1Convs.map(c => c.conversation_id))
        .eq('user_id', userId2);
      if (u2Err) throw u2Err;

      if (user2Convs && user2Convs.length > 0) {
        for (const participant of user2Convs) {
          const { data: conv } = await supabase
            .from('conversations')
            .select('id, type')
            .eq('id', participant.conversation_id)
            .eq('type', 'direct')
            .single();
          if (conv) {
            return await this.getConversation(conv.id, userId1);
          }
        }
      }

      return { conversation: null, error: null };
    } catch (error: any) {
      console.error('Error finding existing conversation:', error);
      return { conversation: null, error: error.message };
    }
  }

  /**
   * @deprecated Use ensureConversation() + sendFirstMessage() instead (ORCH-0436).
   * This method creates conversations eagerly (on chat open), causing ghost conversations.
   * Kept for backward compatibility — callers should migrate to the new pattern.
   */
  async getOrCreateDirectConversation(userId1: string, userId2: string): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      // Check if there's a block between users before creating/returning conversation
      const hasBlock = await blockService.hasBlockBetween(userId2);
      if (hasBlock) {
        return { conversation: null, error: 'Cannot message this user' };
      }

      // Check friendship or pairing before allowing conversation.
      // DM is gated to friends and paired users only (ORCH-0356).
      const { data: friendship } = await supabase
        .from('friends')
        .select('id')
        .or(`and(user_id.eq.${userId1},friend_user_id.eq.${userId2}),and(user_id.eq.${userId2},friend_user_id.eq.${userId1})`)
        .eq('status', 'accepted')
        .limit(1);

      const sortedIds = [userId1, userId2].sort();
      const { data: pairing } = await supabase
        .from('pairings')
        .select('id')
        .eq('user_a_id', sortedIds[0])
        .eq('user_b_id', sortedIds[1])
        .limit(1);

      const isFriendOrPaired = (friendship && friendship.length > 0) || (pairing && pairing.length > 0);
      if (!isFriendOrPaired) {
        return { conversation: null, error: 'You must be friends to message this person' };
      }

      // Get all conversations where user1 is a participant
      const { data: user1Conversations, error: user1Error } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userId1);

      if (user1Error) throw user1Error;

      if (!user1Conversations || user1Conversations.length === 0) {
        // No conversations for user1, create new one
        return await this.createNewConversation(userId1, userId2);
      }

      const conversationIds = user1Conversations.map(c => c.conversation_id);

      // Check if any of these conversations also has userId2 and is a direct conversation
      const { data: user2Conversations, error: user2Error } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .in('conversation_id', conversationIds)
        .eq('user_id', userId2);

      if (user2Error) throw user2Error;

      // Find conversation that both users participate in and is direct type
      if (user2Conversations && user2Conversations.length > 0) {
        for (const participant of user2Conversations) {
          const { data: conv } = await supabase
            .from('conversations')
            .select('id, type')
            .eq('id', participant.conversation_id)
            .eq('type', 'direct')
            .single();

          if (conv) {
            const conversation = await this.getConversation(conv.id, userId1);
            return conversation;
          }
        }
      }

      // No existing direct conversation found, create new one
      return await this.createNewConversation(userId1, userId2);
    } catch (error: any) {
      console.error('Error getting or creating conversation:', error);
      return { conversation: null, error: error.message };
    }
  }

  /**
   * Create a new conversation between two users
   */
  private async createNewConversation(userId1: string, userId2: string): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      const { data: newConversation, error: createError } = await supabase
        .from('conversations')
        .insert({
          type: 'direct',
          created_by: userId1,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Add both participants
      const { error: participantError } = await supabase
        .from('conversation_participants')
        .insert([
          { conversation_id: newConversation.id, user_id: userId1 },
          { conversation_id: newConversation.id, user_id: userId2 },
        ]);

      if (participantError) throw participantError;

      const conversation = await this.getConversation(newConversation.id, userId1);
      return conversation;
    } catch (error: any) {
      console.error('Error creating conversation:', error);
      return { conversation: null, error: error.message };
    }
  }

  /**
   * ORCH-0436: Atomic find-or-create via database RPC.
   * Does NOT create ghost conversations — only called when a message is about to be sent.
   */
  async ensureConversation(userId1: string, userId2: string): Promise<{
    conversationId: string | null;
    error: string | null;
  }> {
    try {
      // Block check first
      const isBlocked = await blockService.hasBlockBetween(userId2);
      if (isBlocked) return { conversationId: null, error: 'Cannot message this user' };

      // Atomic find-or-create via RPC (single transaction, no race condition)
      const { data, error } = await supabase.rpc('get_or_create_direct_conversation', {
        p_user1_id: userId1,
        p_user2_id: userId2,
      });

      if (error) return { conversationId: null, error: error.message };
      return { conversationId: data as string, error: null };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to ensure conversation';
      console.error('[messagingService] ensureConversation failed:', error);
      return { conversationId: null, error: msg };
    }
  }

  /**
   * ORCH-0436: Create conversation AND send first message in one flow.
   * Used when currentConversationId is null (new chat, no prior conversation).
   */
  async sendFirstMessage(
    senderId: string,
    recipientId: string,
    content: string,
    messageType: 'text' | 'image' | 'video' | 'file' = 'text',
    fileUrl?: string,
    fileName?: string,
    fileSize?: number,
    replyToId?: string
  ): Promise<{
    conversationId: string | null;
    message: DirectMessage | null;
    error: string | null;
  }> {
    const { conversationId, error: convError } = await this.ensureConversation(senderId, recipientId);
    if (convError || !conversationId) {
      return { conversationId: null, message: null, error: convError || 'Failed to create conversation' };
    }

    const { message, error: sendError } = await this.sendMessage(
      conversationId, senderId, content, messageType, fileUrl, fileName, fileSize, replyToId
    );

    return { conversationId, message, error: sendError };
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId: string, userId: string): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          participants:conversation_participants(*),
          messages:messages(*)
        `)
        .eq('id', conversationId)
        .single();

      if (error) throw error;

      if (!data) {
        return { conversation: null, error: 'Conversation not found' };
      }

      // Get last message
      const { data: lastMessageData } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Get unread count - messages not sent by user and not read by user
      const { data: unreadMessages } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .is('deleted_at', null);

      let unreadCount = 0;
      if (unreadMessages && unreadMessages.length > 0) {
        const messageIds = unreadMessages.map(m => m.id);
        const { data: readMessages } = await supabase
          .from('message_reads')
          .select('message_id')
          .in('message_id', messageIds)
          .eq('user_id', userId);

        const readMessageIds = new Set(readMessages?.map(r => r.message_id) || []);
        unreadCount = messageIds.filter(id => !readMessageIds.has(id)).length;
      }

      const conversation: Conversation = {
        ...data,
        last_message: lastMessageData ? await this.enrichMessage(lastMessageData, userId) : undefined,
        unread_count: unreadCount,
      };

      return { conversation, error: null };
    } catch (error: any) {
      console.error('Error getting conversation:', error);
      return { conversation: null, error: error.message };
    }
  }

  /**
   * Get all conversations for a user
   */
  async getConversations(userId: string): Promise<{ conversations: Conversation[]; error: string | null }> {
    try {
      // ORCH-0901: Two-level RLS-filtered fetch. Do NOT re-introduce per-conversation
      // loops with await supabase.from(...) here — verified by orch-0901-regression-check.mjs
      // and locked by SPEC_ORCH-0901 §3.1. Re-introducing the legacy 2+5N pattern will
      // fail CI.
      //
      // Level 1 (parallel via Promise.all):
      //   Q1: conversations + participants + last-message (with embedded read_status).
      //   Q2: unread-count helper across all the user's non-self / NULL-sender messages.
      //       Uses .or() to defeat the .neq() nullable-column footgun (see
      //       feedback_supabase_neq_null.md) so post-ORCH-0898 NULL-sender system
      //       messages correctly count as unread.
      // Level 2:
      //   Q3: batch profile fetch for unique last-message senders (warms cache).
      //
      // Total: ≤2 sequential Supabase round-trips on cold-load.

      const conversationsPromise = supabase
        .from('conversations')
        .select(`
          *,
          participants:conversation_participants(id, conversation_id, user_id, joined_at, last_read_at),
          last_message:messages(
            id, conversation_id, sender_id, content, message_type,
            file_url, file_name, file_size, card_payload, reply_to_id,
            marketing_campaign_id, created_at, updated_at, deleted_at,
            read_status:message_reads(user_id)
          )
        `)
        .is('last_message.deleted_at', null)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { referencedTable: 'last_message', ascending: false })
        .limit(1, { referencedTable: 'last_message' });

      const unreadPromise = supabase
        .from('messages')
        .select('id, conversation_id, message_reads(user_id)')
        .or(`sender_id.neq.${userId},sender_id.is.null`)
        .is('deleted_at', null);

      const [conversationsResult, unreadResult] = await Promise.all([
        conversationsPromise,
        unreadPromise,
      ]);

      if (conversationsResult.error) throw conversationsResult.error;
      if (unreadResult.error) throw unreadResult.error;

      const unreadByConv = new Map<string, number>();
      for (const msg of unreadResult.data || []) {
        const reads = ((msg as any).message_reads || []) as Array<{ user_id: string }>;
        const isReadByMe = reads.some((r) => r.user_id === userId);
        if (!isReadByMe) {
          unreadByConv.set(
            msg.conversation_id,
            (unreadByConv.get(msg.conversation_id) || 0) + 1
          );
        }
      }

      const senderIds = new Set<string>();
      for (const conv of conversationsResult.data || []) {
        const raw = Array.isArray((conv as any).last_message)
          ? (conv as any).last_message[0]
          : (conv as any).last_message;
        if (raw?.sender_id) senderIds.add(raw.sender_id);
      }
      if (senderIds.size > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, username, first_name, last_name')
          .in('id', Array.from(senderIds));
        for (const p of profiles || []) {
          const name = getDisplayName(p, 'Unknown');
          this.senderProfileCache.set(p.id, { name, cachedAt: Date.now() });
        }
      }

      const conversations: Conversation[] = [];
      for (const conv of conversationsResult.data || []) {
        const lastMessageRaw = Array.isArray((conv as any).last_message)
          ? (conv as any).last_message[0]
          : (conv as any).last_message;
        let lastMessage: DirectMessage | undefined;
        if (lastMessageRaw) {
          const reads = (lastMessageRaw.read_status || []) as Array<{ user_id: string }>;
          const cachedSender = lastMessageRaw.sender_id
            ? this.senderProfileCache.get(lastMessageRaw.sender_id)
            : null;
          const senderName = cachedSender?.name
            ?? (lastMessageRaw.sender_id ? 'Unknown' : 'Deleted User');
          const { read_status, ...messageFields } = lastMessageRaw as any;
          lastMessage = {
            ...messageFields,
            sender_name: senderName,
            is_read: reads.some((r) => r.user_id === userId),
          };
        }

        conversations.push({
          id: conv.id,
          type: (conv as any).type,
          name: (conv as any).name ?? null,
          session_id: (conv as any).session_id ?? null,
          event_id: (conv as any).event_id ?? null,
          linked_entity_type: (conv as any).linked_entity_type ?? undefined,
          is_broadcast_only: Boolean((conv as any).is_broadcast_only),
          created_by: (conv as any).created_by,
          created_at: conv.created_at,
          updated_at: (conv as any).updated_at,
          last_message_at: (conv as any).last_message_at,
          participants: (conv as any).participants || [],
          last_message: lastMessage,
          unread_count: unreadByConv.get(conv.id) || 0,
        });
      }

      return { conversations, error: null };
    } catch (error: any) {
      console.error('Error getting conversations:', error);
      return { conversations: [], error: error.message };
    }
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string, userId: string, limit: number = 50): Promise<{ messages: DirectMessage[]; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Enrich messages with sender names and read status
      const enrichedMessages = await Promise.all(
        (data || []).map(msg => this.enrichMessage(msg, userId))
      );

      return { messages: enrichedMessages.reverse(), error: null };
    } catch (error: any) {
      console.error('Error getting messages:', error);
      return { messages: [], error: error.message };
    }
  }

  /**
   * Fetch a single message by ID (for resolving reply-to references outside the loaded window)
   */
  async getMessageById(messageId: string, userId: string): Promise<{ message: DirectMessage | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('id', messageId)
        .is('deleted_at', null)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found or deleted
          return { message: null, error: null };
        }
        throw error;
      }

      const enriched = await this.enrichMessage(data, userId);
      return { message: enriched, error: null };
    } catch (error: any) {
      console.error('Error getting message by ID:', error);
      return { message: null, error: error.message };
    }
  }

  /**
   * Send a message
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
    messageType: 'text' | 'image' | 'video' | 'file' | 'card' = 'text',
    fileUrl?: string,
    fileName?: string,
    fileSize?: number,
    replyToId?: string,
    mentions: MentionEntry[] = [],
    cardTags: CardTagEntry[] = []
  ): Promise<{ message: DirectMessage | null; error: string | null }> {
    try {
      const validatedMentions = this.validateMentionEntries(mentions);
      const validatedCardTags = this.validateCardTagEntries(cardTags);

      // Note: Server-side RLS will also enforce block check, but this provides faster feedback
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content,
          message_type: messageType,
          file_url: fileUrl,
          file_name: fileName,
          file_size: fileSize,
          mentions: validatedMentions,
          card_tags: validatedCardTags,
          ...(replyToId ? { reply_to_id: replyToId } : {}),
        })
        .select()
        .single();

      if (error) {
        // RLS violation (42501): either a block (DM context) OR broadcast-only enforcement
        // (Tr6 trip context — ORCH-0898 messages_broadcast_only_enforcement RESTRICTIVE policy).
        // Disambiguate via a follow-up read of the conversation row to surface the right toast.
        if (error.code === '42501' || error.message?.includes('policy')) {
          const broadcastErrorText = await this.translateInsertRlsError(conversationId);
          return { message: null, error: broadcastErrorText };
        }
        throw error;
      }

      const enrichedMessage = await this.enrichMessage(data, senderId);

      // Send notifications to recipients (non-blocking). Mentioned recipients get the
      // higher-priority mention notification only; everyone else receives the normal
      // message notification. This prevents duplicate push rows for one message.
      this.sendPartitionedMessageNotifications(
        conversationId,
        senderId,
        enrichedMessage,
        validatedMentions,
      ).catch(err => console.error('Error sending notifications:', err));

      return { message: enrichedMessage, error: null };
    } catch (error: any) {
      console.error('Error sending message:', error);
      return { message: null, error: error.message };
    }
  }

  /**
   * ORCH-0898: translates a 42501 RLS violation on messages INSERT into a user-friendly
   * error. Reads the conversation row to determine whether the rejection is due to
   * broadcast-only enforcement (Tr6 trip context) or block-based RLS (DM context).
   *
   * Falls back to the generic DM error if the lookup fails — RLS-correct behavior
   * (read returns 0 rows for a non-participant, so we can't always determine the cause).
   */
  private async translateInsertRlsError(conversationId: string): Promise<string> {
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('linked_entity_type, is_broadcast_only')
        .eq('id', conversationId)
        .maybeSingle();

      if (
        (conv?.linked_entity_type === 'trip' || conv?.linked_entity_type === 'event') &&
        conv?.is_broadcast_only === true
      ) {
        return "Only the planner can post in this chat";
      }
    } catch {
      // Fall through to default — RLS may block the read too; either way we surface a sensible toast.
    }
    return 'Cannot send message to this user';
  }

  private validateMentionEntries(mentions: MentionEntry[]): MentionEntry[] {
    if (mentions.length > 10) {
      throw new Error('Messages can include at most 10 mentions');
    }

    return mentions.map((mention) => {
      if (!mention.userId || !mention.displayName) {
        throw new Error('Mention entries require userId and displayName');
      }
      if (
        !Number.isInteger(mention.startOffset) ||
        !Number.isInteger(mention.endOffset) ||
        mention.startOffset < 0 ||
        mention.endOffset <= mention.startOffset
      ) {
        throw new Error('Mention entries require valid non-negative offsets');
      }
      return mention;
    });
  }

  private validateCardTagEntries(cardTags: CardTagEntry[]): CardTagEntry[] {
    if (cardTags.length > 5) {
      throw new Error('Messages can include at most 5 card tags');
    }

    return cardTags.map((cardTag) => {
      if (!cardTag.savedCardId) {
        throw new Error('Card tag entries require savedCardId');
      }
      if (!cardTag.cardPayload?.id || !cardTag.cardPayload?.title) {
        throw new Error('Card tag payloads require id and title');
      }
      return {
        savedCardId: cardTag.savedCardId,
        cardPayload: trimCardPayload(cardTag.cardPayload),
      };
    });
  }

  /**
   * ORCH-0898: returns the group conversation linked to a collaboration session. The conversation
   * is eagerly created by the `ensure_group_conversation_on_session_create` DB trigger at session
   * INSERT time, so this method is typically just a lookup. Returns null + error if the trigger
   * hasn't fired (e.g., pre-migration session without backfilled conversation — should not happen
   * post-ORCH-0898 migration).
   */
  async getOrCreateGroupConversationForSession(
    sessionId: string,
  ): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      const { data: conv, error } = await supabase
        .from('conversations')
        .select(`
          id, type, name, session_id, linked_entity_type, created_by, created_at, updated_at, last_message_at,
          participants:conversation_participants(id, conversation_id, user_id, joined_at, last_read_at)
        `)
        .eq('session_id', sessionId)
        .eq('linked_entity_type', 'session')
        .maybeSingle();

      if (error) throw error;
      if (!conv) {
        return { conversation: null, error: 'Group conversation not found for this session' };
      }

      return {
        conversation: {
          id: conv.id,
          type: conv.type as 'direct' | 'group',
          name: conv.name ?? null,
          session_id: conv.session_id ?? null,
          linked_entity_type: conv.linked_entity_type as 'direct' | 'session' | 'trip' | 'event' | undefined,
          created_by: conv.created_by,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          last_message_at: conv.last_message_at ?? undefined,
          participants: (conv.participants as any[]) || [],
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Error getting group conversation for session:', error);
      return { conversation: null, error: error.message };
    }
  }

  /**
   * ORCH-0897: returns the group conversation linked to a trip/event. The
   * database owns creation; this method is lookup-only.
   */
  async getOrCreateGroupConversationForEvent(
    eventId: string,
  ): Promise<{ conversation: Conversation | null; error: string | null }> {
    try {
      const { data: conv, error } = await supabase
        .from('conversations')
        .select(`
          id, type, name, event_id, linked_entity_type, created_by, created_at, updated_at, last_message_at,
          is_broadcast_only,
          participants:conversation_participants(id, conversation_id, user_id, joined_at, last_read_at)
        `)
        .eq('event_id', eventId)
        .in('linked_entity_type', ['trip', 'event'])
        .maybeSingle();

      if (error) throw error;
      if (!conv) {
        return { conversation: null, error: 'Group conversation not found for this event' };
      }

      return {
        conversation: {
          id: conv.id,
          type: conv.type as 'direct' | 'group',
          name: conv.name ?? null,
          event_id: conv.event_id ?? null,
          linked_entity_type: conv.linked_entity_type as 'direct' | 'session' | 'trip' | 'event' | undefined,
          is_broadcast_only: Boolean((conv as any).is_broadcast_only),
          created_by: conv.created_by,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          last_message_at: conv.last_message_at ?? undefined,
          participants: (conv.participants as any[]) || [],
        },
        error: null,
      };
    } catch (error: any) {
      console.error('Error getting group conversation for event:', error);
      return { conversation: null, error: error.message };
    }
  }

  async fetchPendingChatClaims(): Promise<{
    claims: Array<{ event_id: string; event_name: string; cover_url?: string | null }>;
    error: string | null;
  }> {
    try {
      const { data, error } = await supabase.functions.invoke('claim-pending-trip-chat-participation', {
        body: { preview: true },
      });
      if (error) throw error;
      const claims = Array.isArray((data as any)?.claims) ? (data as any).claims : [];
      return { claims, error: null };
    } catch (error: any) {
      console.error('Error fetching pending trip chat claims:', error);
      return { claims: [], error: error.message ?? 'Failed to load pending chat claims' };
    }
  }

  async claimPendingTripChats(claimToken?: string): Promise<{
    claimed: number;
    conversations: Array<{ conversation_id: string; event_id: string; event_name: string }>;
    error: string | null;
  }> {
    try {
      const { data, error } = await supabase.functions.invoke('claim-pending-trip-chat-participation', {
        body: claimToken ? { claim_token: claimToken } : {},
      });
      if (error) throw error;
      const conversations = Array.isArray((data as any)?.claimed) ? (data as any).claimed : [];
      return {
        claimed: Number((data as any)?.count ?? conversations.length),
        conversations,
        error: null,
      };
    } catch (error: any) {
      console.error('Error claiming pending trip chats:', error);
      return {
        claimed: 0,
        conversations: [],
        error: error.message ?? 'Failed to join trip chats',
      };
    }
  }

  /**
   * ORCH-0898: removes the current user from a group conversation. Used by the Friends-tab
   * group-chat swipe-leave action. RLS-gated to own row only (user_id = auth.uid()).
   */
  async leaveGroupConversation(
    conversationId: string,
    userId: string,
  ): Promise<{ error: string | null }> {
    try {
      const { error } = await supabase
        .from('conversation_participants')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);

      if (error) throw error;
      return { error: null };
    } catch (error: any) {
      console.error('Error leaving group conversation:', error);
      return { error: error.message };
    }
  }

  /**
   * ORCH-0667: Send a card-type message containing a snapshot of the saved card.
   * Mirrors sendMessage but with message_type='card' and card_payload populated.
   * The `content` field carries forward-safe text so old-build clients (pre-fix)
   * see "Shared an experience: {title}" instead of a blank bubble.
   */
  async sendCardMessage(
    conversationId: string,
    senderId: string,
    card: any,
  ): Promise<{ message: DirectMessage | null; error: string | null }> {
    try {
      const cardPayload = trimCardPayload(card);
      const content = `Shared an experience: ${cardPayload.title}`;

      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content,
          message_type: 'card',
          card_payload: cardPayload,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '42501' || error.message?.includes('policy')) {
          return { message: null, error: 'Cannot send card to this user' };
        }
        throw error;
      }

      const enrichedMessage = await this.enrichMessage(data, senderId);

      // Fan out push + in-app notification (non-blocking)
      this.sendCardMessageNotifications(conversationId, senderId, enrichedMessage, cardPayload).catch((err) =>
        console.error('Error sending card-share notifications:', err),
      );

      return { message: enrichedMessage, error: null };
    } catch (error: any) {
      console.error('Error sending card message:', error);
      return { message: null, error: error.message || 'Failed to send card' };
    }
  }

  /**
   * ORCH-0667: Fan out card-share notifications via the notify-message pipeline.
   * Mirrors sendMessageNotifications but with type='direct_card_message'.
   */
  private async sendCardMessageNotifications(
    conversationId: string,
    senderId: string,
    message: DirectMessage,
    cardPayload: CardPayload,
  ): Promise<void> {
    try {
      const { data: participants, error: participantsError } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', senderId);

      if (participantsError || !participants || participants.length === 0) {
        return;
      }

      for (const participant of participants) {
        supabase.functions
          .invoke('notify-message', {
            body: {
              type: 'direct_card_message',
              senderId,
              conversationId,
              recipientId: participant.user_id,
              messageId: message.id,
              cardTitle: cardPayload.title,
              cardId: cardPayload.id,
              cardImageUrl: cardPayload.image,
            },
          })
          .catch((err) => console.log('Card-share notification error (non-critical):', err));
      }
    } catch (error) {
      console.error('Error sending card-share notifications:', error);
    }
  }

  /**
   * Mark messages as read
   */
  async markAsRead(messageIds: string[], userId: string): Promise<{ error: string | null }> {
    try {
      const reads = messageIds.map(messageId => ({
        message_id: messageId,
        user_id: userId,
      }));

      const { error } = await supabase
        .from('message_reads')
        .upsert(reads, { onConflict: 'message_id,user_id' });

      if (error) throw error;

      // Update last_read_at in conversation_participants
      if (messageIds.length > 0) {
        const { data: messages } = await supabase
          .from('messages')
          .select('conversation_id')
          .in('id', messageIds)
          .limit(1)
          .single();

        if (messages) {
          await supabase
            .from('conversation_participants')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', messages.conversation_id)
            .eq('user_id', userId);
        }
      }

      return { error: null };
    } catch (error: any) {
      console.error('Error marking as read:', error);
      return { error: error.message };
    }
  }

  /**
   * Subscribe to real-time messages for a conversation
   */
  subscribeToConversation(
    conversationId: string,
    userId: string,
    callbacks: {
      onMessage?: (message: DirectMessage) => void;
      onMessageUpdated?: (message: DirectMessage) => void;
      onMessageDeleted?: (messageId: string) => void;
    }
  ): RealtimeChannel {
    const channelName = `conversation:${conversationId}`;

    // Unsubscribe if already subscribed
    if (this.channels.has(channelName)) {
      this.unsubscribeFromConversation(conversationId);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const enrichedMessage = await this.enrichMessageRealtime(payload.new as any);
          callbacks.onMessage?.(enrichedMessage);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const enrichedMessage = await this.enrichMessageRealtime(payload.new as any);
          callbacks.onMessageUpdated?.(enrichedMessage);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          callbacks.onMessageDeleted?.(payload.old.id);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to conversation: ${conversationId}`);
        }
      });

    this.channels.set(channelName, channel);
    return channel;
  }

  /**
   * Unsubscribe from conversation updates
   */
  unsubscribeFromConversation(conversationId: string): void {
    const channelName = `conversation:${conversationId}`;
    const channel = this.channels.get(channelName);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(channelName);
    }
  }

  /**
   * Get sender name with caching to avoid N+1 queries
   */
  private async getSenderName(senderId: string | null): Promise<string> {
    if (!senderId) return 'Deleted User';

    const cached = this.senderProfileCache.get(senderId);
    if (cached && Date.now() - cached.cachedAt < MessagingService.PROFILE_CACHE_TTL) {
      return cached.name;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username, first_name, last_name')
      .eq('id', senderId)
      .single();

    const senderName = getDisplayName(profile, 'Unknown');

    this.senderProfileCache.set(senderId, { name: senderName, cachedAt: Date.now() });
    return senderName;
  }

  /**
   * Enrich message with sender name and read status.
   * ORCH-0908: sender_id === null marks the row as a system message
   * (generated by rpc_admin_lock_card / rpc_admin_schedule_locked_card and
   * any future ORCH that writes lifecycle announcements into the chat).
   * ORCH-0945 live-fire rework: collab dead-end banners are user-attributed
   * to satisfy live messages RLS, but render through the same system row when
   * their content matches the narrow ORCH-0945 banner contract.
   * MessageBubble.tsx:156 renders isSystem rows centered + muted with no chrome.
   */
  private async enrichMessage(message: any, userId: string): Promise<DirectMessage> {
    const senderName = await this.getSenderName(message.sender_id);

    // Check if message is read by current user
    const { data: readData } = await supabase
      .from('message_reads')
      .select('id')
      .eq('message_id', message.id)
      .eq('user_id', userId)
      .single();

    return {
      ...message,
      sender_name: senderName,
      is_read: !!readData,
      isSystem: message.sender_id === null || isCollabDeadEndBannerMessage(message.content),
    };
  }

  /**
   * Lightweight enrichment for real-time messages — skips read-status query
   * (a message that just arrived is unread by definition).
   * ORCH-0908: same isSystem rule as enrichMessage.
   */
  private async enrichMessageRealtime(message: any): Promise<DirectMessage> {
    const senderName = await this.getSenderName(message.sender_id);

    return {
      ...message,
      sender_name: senderName,
      is_read: false,
      isSystem: message.sender_id === null || isCollabDeadEndBannerMessage(message.content),
    };
  }

  /**
   * Send notifications to message recipients via the notify-message → notify-dispatch
   * pipeline. This inserts a row into the `notifications` table (powering the in-app
   * notification center via Realtime) AND sends a push notification via OneSignal.
   *
   * Previously this called `send-message-email` which only sent a push — no DB row,
   * no in-app notification, no preference/quiet-hours checks.
   */
  private async fetchConversationParticipantsExcluding(
    conversationId: string,
    senderId: string,
  ): Promise<string[]> {
    const { data: participants, error } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .neq('user_id', senderId);

    if (error || !participants) {
      return [];
    }

    return participants.map((participant: { user_id: string }) => participant.user_id);
  }

  private async sendPartitionedMessageNotifications(
    conversationId: string,
    senderId: string,
    message: DirectMessage,
    mentions: MentionEntry[],
  ): Promise<void> {
    const allRecipients = await this.fetchConversationParticipantsExcluding(conversationId, senderId);
    if (allRecipients.length === 0) return;

    const mentionedSet = new Set(mentions.map((mention) => mention.userId));
    const mentionedRecipients = allRecipients.filter((userId) => mentionedSet.has(userId));
    const regularRecipients = allRecipients.filter((userId) => !mentionedSet.has(userId));

    if (mentionedRecipients.length > 0) {
      supabase.functions.invoke('notify-message', {
        body: {
          type: 'message_mention',
          senderId,
          conversationId,
          messageId: message.id,
          mentionedUserIds: mentionedRecipients,
          messagePreview: message.content.slice(0, 100),
        },
      }).catch((err) =>
        console.warn('[messagingService] message_mention fan-out failed', err)
      );
    }

    if (regularRecipients.length > 0) {
      await this.sendMessageNotifications(conversationId, senderId, message, regularRecipients);
    }
  }

  private async sendMessageNotifications(
    conversationId: string,
    senderId: string,
    message: DirectMessage,
    restrictToUserIds?: string[]
  ): Promise<void> {
    try {
      const recipientIds = restrictToUserIds ?? await this.fetchConversationParticipantsExcluding(conversationId, senderId);
      if (recipientIds.length === 0) {
        return;
      }

      // Prepare message preview
      let messagePreview = message.content;
      if (message.message_type === 'image') {
        messagePreview = '📷 Photo';
      } else if (message.message_type === 'video') {
        messagePreview = '🎥 Video';
      } else if (message.message_type === 'file') {
        messagePreview = `📄 ${message.file_name || 'Document'}`;
      } else if (message.message_type === 'card') {
        messagePreview = `🔖 ${message.card_payload?.title || 'Shared experience'}`;
      } else if (messagePreview.length > 50) {
        messagePreview = messagePreview.substring(0, 50) + '...';
      }

      // Send notification to each recipient via the full pipeline.
      // notify-message → notify-dispatch handles:
      //   1. Insert into `notifications` table (in-app notification via Realtime)
      //   2. Push notification via OneSignal (with deepLink for tap-to-navigate)
      //   3. Notification preference checks + quiet hours
      //   4. Idempotency (2-min bucket prevents duplicate notifications)
      for (const recipientId of recipientIds) {
        supabase.functions.invoke('notify-message', {
          body: {
            type: 'direct_message',
            senderId,
            conversationId,
            recipientId,
            messagePreview,
          },
        }).catch((err) =>
          console.log('DM notification error (non-critical):', err)
        );
      }
    } catch (error) {
      console.error('Error sending message notifications:', error);
    }
  }

  /**
   * Toggle a reaction on a direct message (add if not exists, remove if exists).
   */
  async toggleDirectMessageReaction(
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<{ added: boolean; error: any }> {
    try {
      const { data: existing } = await supabase
        .from('direct_message_reactions')
        .select('id')
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('emoji', emoji)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('direct_message_reactions')
          .delete()
          .eq('id', existing.id);
        if (error) throw error;
        return { added: false, error: null };
      } else {
        const { error } = await supabase
          .from('direct_message_reactions')
          .insert({ message_id: messageId, user_id: userId, emoji });
        if (error) throw error;
        return { added: true, error: null };
      }
    } catch (err: any) {
      console.error('Error toggling DM reaction:', err);
      return { added: false, error: err };
    }
  }
}

export const messagingService = new MessagingService();
