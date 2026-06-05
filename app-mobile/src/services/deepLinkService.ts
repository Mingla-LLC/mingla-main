/**
 * Deep Link Service — Unified deep link parser and executor.
 *
 * ORCH-1030 [Consumer app notification deep-linking]:
 * ONE canonical pipeline for in-app sheet taps, OneSignal push taps, OS Linking,
 * and the deferred onboarding-gated replay. The server's `data.deepLink`
 * (`mingla://…`) is the single source of truth:
 *
 *   data.deepLink  →  parseDeepLink(url): Destination | null
 *                  →  executeDeepLink(Destination | null, handlers)
 *
 * When `data.deepLink` is absent or `parseDeepLink` returns null, the caller
 * falls back to `typeFallbackDestination(type, data)`, which returns the SAME
 * typed `Destination` shape so it can never disagree with the parser
 * (invariant I-NOTIF-FALLBACK-AGREES).
 */

// ── Typed destination union (ORCH-1030) ───────────────────────────────────────

/**
 * The single typed contract every navigation target speaks. Each screen
 * consumes its own slice; the discriminated union makes "you forgot to carry
 * entryId/experienceId" a compile error rather than a silent drop (kills the
 * F-02/F-11 param-dropped-at-screen class).
 */
export type Destination =
  // ORCH-1077: a session Destination lands in the session's GROUP CHAT (Messages),
  // not Home. `card` (from `mingla://session/{id}?card={cardId}`) is carried through
  // so it survives into ConnectionsPage's deepLinkParams (board_card_message). The
  // deck stays one tap away via the in-chat CTA (META-ORCH-0929 immutable).
  | { kind: 'session'; sessionId: string; card?: string }
  | {
      kind: 'conversation';
      conversationId?: string;
      eventId?: string;
      orderId?: string;
      claimToken?: string;
      chatType?: 'direct' | 'group';
    }
  | { kind: 'profile'; userId: string }
  | { kind: 'calendarEntry'; entryId: string }
  | { kind: 'review'; experienceId: string }
  | { kind: 'pairedDeck' } // mingla://discover?paired=true
  | {
      kind: 'page';
      page: 'home' | 'discover' | 'connections' | 'likes' | 'saved' | 'profile' | 'onboarding' | 'board-invite';
      params?: Record<string, string>;
    }
  | { kind: 'paywall' };

export interface NavigationHandlers {
  setCurrentPage: (page: string) => void;
  setShowPreferences?: (show: boolean) => void;
  setShowPaywall?: (show: boolean) => void;
  setViewingFriendProfileId?: (id: string) => void;
  /** Forward deep link params to the target page (tab, conversationId, etc.) */
  setDeepLinkParams?: (params: Record<string, string>) => void;
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a `mingla://…` (or https) deep link into a typed Destination.
 * Returns `null` on unknown/garbled input — the caller then falls back to
 * `typeFallbackDestination`. Never throws.
 */
export function parseDeepLink(url: string): Destination | null {
  try {
    const normalized = (() => {
      if (/^https?:\/\//i.test(url)) {
        const parsed = new URL(url);
        return `${parsed.pathname.replace(/^\/+/, '')}${parsed.search}`;
      }
      return url.replace(/^mingla:\/\//, '');
    })();
    const [pathPart, queryPart] = normalized.split('?');
    const pathSegments = pathPart.split('/').filter(Boolean);
    const params: Record<string, string> = {};

    if (queryPart) {
      queryPart.split('&').forEach((pair) => {
        const [key, value] = pair.split('=');
        if (key && value) {
          params[decodeURIComponent(key)] = decodeURIComponent(value);
        }
      });
    }

    const path = pathSegments[0];

    switch (path) {
      case 'home':
        return { kind: 'page', page: 'home', params };

      case 'discover':
        // mingla://discover?paired=true → the paired/collab deck container.
        if (params.paired === 'true') {
          return { kind: 'pairedDeck' };
        }
        return { kind: 'page', page: 'discover', params };

      case 'connections':
        return { kind: 'page', page: 'connections', params };

      case 'session': {
        // ORCH-1077: collab/session notifications land in the session's GROUP CHAT
        // (deck is one tap away via the in-chat CTA). META-ORCH-0929: there is no
        // home-mounted session deck anymore. Accept BOTH shapes:
        //   mingla://session/{id}        (collab lifecycle: invite/accept/match/lock/card-msg)
        //   mingla://session?id={id}     (tag_along_accepted / tag_along_match)
        const sessionId = pathSegments[1] ?? params.id;
        if (!sessionId) {
          // Malformed link with no id → land Home (never a dead tap), but no
          // session/group-chat routing happens. ConnectionsPage short-circuits.
          return { kind: 'page', page: 'home' };
        }
        // Carry the `card` param (board_card_message) through to the group chat.
        return params.card
          ? { kind: 'session', sessionId, card: params.card }
          : { kind: 'session', sessionId };
      }

      case 'messages':
        return {
          kind: 'conversation',
          conversationId: pathSegments[1],
          ...(params.eventId ? { eventId: params.eventId } : {}),
        };

      case 'chat':
        return {
          kind: 'conversation',
          conversationId: pathSegments[1],
          ...(params.eventId ? { eventId: params.eventId } : {}),
          chatType: (params.type as 'direct' | 'group') ?? 'group',
        };

      case 'orders':
        if (pathSegments[1] && pathSegments[2] === 'chat') {
          return {
            kind: 'conversation',
            orderId: pathSegments[1],
            ...(params.token ? { claimToken: params.token } : {}),
          };
        }
        // orders/{id} without /chat — out of consumer scope (Ruling 2); latent.
        return null;

      case 'calendar': {
        const entryId = pathSegments[1];
        if (!entryId) {
          return { kind: 'page', page: 'likes' };
        }
        return { kind: 'calendarEntry', entryId };
      }

      case 'review': {
        // Executor MUST carry experienceId (no silent drop — F-11).
        const experienceId = pathSegments[1];
        if (!experienceId) {
          return { kind: 'page', page: 'likes' };
        }
        return { kind: 'review', experienceId };
      }

      case 'profile': {
        // mingla://profile/{userId} → open that person's profile (Ruling 1).
        // Bare mingla://profile → the user's own Profile tab.
        const userId = pathSegments[1] ?? params.userId;
        if (userId) {
          return { kind: 'profile', userId };
        }
        return { kind: 'page', page: 'profile', params };
      }

      case 'subscription':
        return { kind: 'paywall' };

      case 'onboarding':
        return { kind: 'page', page: 'onboarding', params };

      case 'board':
        // Legacy: mingla://board/{code}
        return { kind: 'page', page: 'board-invite', params: { code: pathSegments[1] } };

      case 'likes':
        return { kind: 'page', page: 'likes', params };

      case 'saved':
        return { kind: 'page', page: 'saved', params };

      default:
        console.warn('[deepLinkService] Unknown deep link path:', path);
        return null;
    }
  } catch (err) {
    console.warn('[deepLinkService] Failed to parse deep link:', url, err);
    return null;
  }
}

// ── Type-based fallback ────────────────────────────────────────────────────────

/**
 * Compute a Destination from a notification `type` + its `data` payload, used
 * ONLY when `data.deepLink` is absent or `parseDeepLink` returned null. This
 * REPLACES the legacy `NAV_TARGETS` string map and the five hand-coded in-app
 * special-cases. It MUST return the SAME `Destination` kinds the parser can
 * produce so it can never disagree (I-NOTIF-FALLBACK-AGREES).
 */
export function typeFallbackDestination(
  type: string,
  data?: Record<string, unknown>
): Destination {
  const str = (key: string): string | undefined => {
    const v = data?.[key];
    return typeof v === 'string' && v ? v : undefined;
  };

  // Collaboration / sessions → Home + the session (collab/board UI mounts from Home).
  if (type.startsWith('collaboration_') || type.startsWith('session_') || type.startsWith('board_card_')) {
    const sessionId = str('sessionId') ?? str('relatedId') ?? str('related_id');
    return sessionId ? { kind: 'session', sessionId } : { kind: 'page', page: 'home' };
  }

  // Board / group messages → the conversation thread (Connections opens it).
  if (type.startsWith('board_message_')) {
    const conversationId = str('conversationId') ?? str('relatedId') ?? str('related_id');
    return conversationId
      ? { kind: 'conversation', conversationId, chatType: 'group' }
      : { kind: 'page', page: 'home' };
  }

  // Direct messages → the DM thread (preserve the working no-deepLink DM behavior).
  if (type.startsWith('direct_message_')) {
    const conversationId = str('conversationId') ?? str('relatedId') ?? str('related_id');
    return conversationId
      ? { kind: 'conversation', conversationId, chatType: 'direct' }
      : { kind: 'page', page: 'connections' };
  }

  // Paired-user activity → that friend's profile if we know who, else the paired deck.
  if (type.startsWith('paired_user_')) {
    const userId = str('actor_id') ?? str('actorId');
    return userId ? { kind: 'profile', userId } : { kind: 'pairedDeck' };
  }

  // Birthday / holiday reminders → the person's profile if a Mingla user id is present.
  if (type === 'birthday_reminder' || type === 'holiday_reminder') {
    const userId = str('partnerId') ?? str('actor_id') ?? str('actorId');
    return userId ? { kind: 'profile', userId } : { kind: 'page', page: 'connections' };
  }

  // Friend / pair requests → Connections.
  if (type.startsWith('friend_') || type.startsWith('pair_') || type.startsWith('link_')) {
    return { kind: 'page', page: 'connections' };
  }

  // Calendar / visit feedback → Likes.
  if (type.startsWith('calendar_') || type === 'visit_feedback_prompt') {
    return { kind: 'page', page: 'likes' };
  }

  // Lifecycle / engagement.
  if (type === 'trial_ending') {
    return { kind: 'paywall' };
  }
  if (type.startsWith('re_engagement') || type === 'weekly_digest' || type === 'referral_credited') {
    return { kind: 'page', page: 'home' };
  }

  // Unknown type → Home (never a dead tap — I-NO-SILENT-FAILURE).
  return { kind: 'page', page: 'home' };
}

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Apply a typed Destination via the supplied handlers. `null` is a no-op — the
 * caller is responsible for substituting `typeFallbackDestination` before
 * calling, so a null here means "intentionally do nothing".
 */
export function executeDeepLink(
  dest: Destination | null,
  handlers: NavigationHandlers
): void {
  if (!dest) return;

  switch (dest.kind) {
    case 'session': {
      // ORCH-1077: route to the session's GROUP CHAT (Messages tab), NOT Home.
      // ConnectionsPage resolves sessionId → getOrCreateGroupConversationForSession
      // and opens that conversation; the in-chat CTA surfaces the deck
      // (META-ORCH-0929: the deck sheet is reached from inside the group chat).
      const params: Record<string, string> = { tab: 'messages', sessionId: dest.sessionId };
      if (dest.card) params.card = dest.card;
      handlers.setDeepLinkParams?.(params);
      handlers.setCurrentPage('connections');
      break;
    }

    case 'conversation': {
      const params: Record<string, string> = { tab: 'messages' };
      if (dest.conversationId) params.conversationId = dest.conversationId;
      if (dest.eventId) params.eventId = dest.eventId;
      if (dest.orderId) {
        params.orderId = dest.orderId;
        params.claimPendingTripChats = 'true';
      }
      if (dest.claimToken) params.claimToken = dest.claimToken;
      if (dest.chatType) params.chatType = dest.chatType;
      handlers.setDeepLinkParams?.(params);
      handlers.setCurrentPage('connections');
      break;
    }

    case 'profile':
      // Overlay mounts over whatever page is current — no page change needed.
      handlers.setViewingFriendProfileId?.(dest.userId);
      break;

    case 'calendarEntry':
      handlers.setDeepLinkParams?.({ tab: 'calendar', entryId: dest.entryId });
      handlers.setCurrentPage('likes');
      break;

    case 'review':
      // v1 coarse: land Likes → Calendar (the entry the review is for). Opening
      // the review modal by id is a documented v2 follow-up. MUST carry the id
      // forward (no silent drop).
      handlers.setDeepLinkParams?.({ tab: 'calendar', experienceId: dest.experienceId });
      handlers.setCurrentPage('likes');
      break;

    case 'pairedDeck':
      handlers.setDeepLinkParams?.({ paired: 'true' });
      handlers.setCurrentPage('discover');
      break;

    case 'page':
      if (dest.params && Object.keys(dest.params).length > 0) {
        handlers.setDeepLinkParams?.(dest.params);
      }
      handlers.setCurrentPage(dest.page);
      break;

    case 'paywall':
      handlers.setShowPaywall?.(true);
      break;

    default: {
      // Exhaustiveness guard — a new Destination kind without a branch is a
      // compile error here.
      const _exhaustive: never = dest;
      void _exhaustive;
      break;
    }
  }
}
