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
  // ORCH-1080: a session Destination lands in the session's GROUP CHAT (Messages),
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
      // #2245 — EVERY value here MUST have a `case` in app/index.tsx's
      // `switch (currentPage)`. That switch ends in `default: return null`, so a
      // page with no case navigates to a blank screen under the bottom nav: the
      // app opens and shows nothing. Two values used to be in this union with no
      // case anywhere in any commit — `'board-invite'` (from
      // `mingla://board/{code}`) and `'onboarding'` (from the live
      // `notify-lifecycle` push, `data.deepLink: "mingla://onboarding"`). Both
      // are gone. Enforced by A5 in
      // `scripts/issue-2245/declared-app-links-resolve.deno.test.ts`, which
      // parses this union and that switch and compares them.
      page: 'home' | 'discover' | 'connections' | 'likes' | 'saved' | 'profile';
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
        // ORCH-1080: collab/session notifications land in the session's GROUP CHAT
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
        // #2245 — `orders/{id}` with no `/chat`. This shape USED to return null,
        // which made `executeDeepLink` a no-op: the app opened on Home and the
        // order was never mentioned. `/orders/*` is a claimed Universal Link
        // path (live apex AASA + Android autoVerify), so this shape IS claimed
        // and cannot be left landing nowhere.
        //
        // Where it goes: the Calendar tab inside Likes — the ONE surface in this
        // app that holds a bought experience and its ticket QR
        // (`LikesPage` reads `deepLinkParams.tab === 'calendar'`;
        // `onShowQRCode` is wired from there). It is deliberately coarse: no
        // consumer surface addresses a single order by id, and inventing one
        // that pretends to would be the dishonesty #2272's landing copy exists
        // to avoid. This matches what usemingla.com/orders/* now tells someone
        // without the app — "your ticket is in the Mingla app".
        return { kind: 'page', page: 'likes', params: { tab: 'calendar' } };

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
        // #2245 — `supabase/functions/notify-lifecycle` sends a LIVE push with
        // `data.deepLink: "mingla://onboarding"` to every profile with
        // `has_completed_onboarding = false`. It used to return
        // `page: 'onboarding'`, which has no `case` in app/index.tsx's switch,
        // so the tap painted a blank screen.
        //
        // Home is the correct destination and needs no new screen: app/index.tsx
        // renders `OnboardingLoader` from `if (showOnboardingFlow ||
        // needsOnboarding)` BEFORE the tab switch is reached, so exactly the
        // population this push targets still lands in onboarding. Anyone else
        // lands Home, which is true rather than blank.
        return { kind: 'page', page: 'home', params };

      case 'board':
        // #2245 — `mingla://board/{code}` (minted by the `auto_generate_invite_info`
        // trigger into `collaboration_sessions.invite_link`, and by
        // `boardInviteService.ts:40`) has NO destination in this app, and the
        // matching `/board/*` Universal Link claim has been WITHDRAWN from the
        // apex AASA and the Android intent filters.
        //
        // Why withdrawn rather than built — measured, not assumed:
        //   • It used to return `page: 'board-invite'`, which has never had a
        //     `case` in app/index.tsx in any commit. The tap painted a blank
        //     screen under the bottom nav.
        //   • The only implementation of "join by code",
        //     `BoardInviteService.joinByInviteCode`, CANNOT work for the people
        //     it exists for. Its first step selects `collaboration_sessions` by
        //     `invite_code`, and the live `cs_select` RLS policy is
        //     `auth.uid() = created_by OR is_session_participant(id, auth.uid())
        //     OR has_session_invite(id, auth.uid())` — verified against
        //     production 2026-08-18. Someone holding only a code is none of the
        //     three, so the select returns nothing and the service reports
        //     "Invalid invite code". Making this resolve needs a SECURITY DEFINER
        //     RPC and therefore a migration.
        //   • Nothing surfaces the link. `useBoardSession.getInviteLink` is
        //     exposed and called by no component.
        //
        // Returning null (not a page) is deliberate: `executeDeepLink(null)` is a
        // documented no-op, so a stale `mingla://board/{code}` in the database
        // leaves the user on Home instead of on a blank screen. Give this a real
        // destination and the claim can be re-added to both declaration files —
        // and `scripts/issue-2245/declared-app-links-resolve.deno.test.ts` will
        // make you prove it lands somewhere before it goes green.
        return null;

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
      // ORCH-1080: route to the session's GROUP CHAT (Messages tab), NOT Home.
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

// ── In-app open-DM sink (ORCH-1341 P1-2 REWORK, META-ORCH-1337) ──────────────
//
// Deeply-nested components (the guest-list sheet's Message default) must open
// a DM WITHOUT `Linking.openURL`: `mingla://` is NOT a registered URL scheme
// (app.json `scheme` is `com.mingla.app.v2`, so iOS rejects `mingla://…` with
// "Unable to open URL"), and `chat` has no expo-router file route (a raw
// scheme open lands on "Unmatched Route"). The PROVEN in-app idiom for
// "open a DM with user X" is the Discover-map Message rail
// (app/index.tsx handleOpenChatWithUserFromDiscover →
// setPendingOpenDmUserId + setCurrentPage('connections') → ConnectionsPage
// opens MessageInterface on the same frame and resolves the conversation
// with a cold-start DB fallback). NOT the conversation-id deep-link params:
// runtime-proven (this REWORK) that a just-ensured, message-less DM is not
// yet in ConnectionsPage's conversations state, so the ORCH-1080 effect
// falls back to the Messages LIST instead of the thread. The shell
// (app/index.tsx) registers a sink here at mount; callers hand it the peer
// USER id. Mirrors the ORCH-1318 OneLink sink registration pattern
// (appsFlyerService `_oneLinkSink`).
let _openDirectMessageSink: ((userId: string) => void) | null = null;

/**
 * Register the shell's open-DM sink. Called ONCE from app/index.tsx at mount
 * with a handler that pops any pushed expo-router file route and rides the
 * Discover-map Message rail (setPendingOpenDmUserId + page 'connections').
 */
export function registerOpenDirectMessageSink(
  sink: (userId: string) => void,
): void {
  _openDirectMessageSink = sink;
}

/**
 * True once the shell has registered its open-DM sink. Callers with their own
 * error surface (e.g. the guest-list sheet's row hint) check this BEFORE
 * tearing down that surface, so a detached mount never dead-ends silently.
 */
export function hasOpenDirectMessageSink(): boolean {
  return _openDirectMessageSink !== null;
}

/**
 * Open the DM thread with `userId` via the shell's registered rail. Returns
 * false when no sink is registered (Constitution #3 — the caller surfaces the
 * failure on its own error surface).
 */
export function openDirectMessageInApp(userId: string): boolean {
  if (_openDirectMessageSink === null) {
    console.warn(
      '[deepLinkService] openDirectMessageInApp dropped — no open-DM sink registered',
    );
    return false;
  }
  _openDirectMessageSink(userId);
  return true;
}
