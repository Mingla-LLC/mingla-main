/**
 * Deep Link Service — Unified deep link parser and executor.
 *
 * Replaces ad-hoc navigation in processNotification (index.tsx).
 * Parses `mingla://` URLs and maps them to navigation actions.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface NavigationAction {
  page: string;
  params?: Record<string, string>;
}

export interface NavigationHandlers {
  setCurrentPage: (page: string) => void;
  setBoardViewSessionId?: (id: string) => void;
  setShowPreferences?: (show: boolean) => void;
  setShowPaywall?: (show: boolean) => void;
  setViewingFriendProfileId?: (id: string) => void;
  /** Forward deep link params to the target page (tab, conversationId, etc.) */
  setDeepLinkParams?: (params: Record<string, string>) => void;
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseDeepLink(url: string): NavigationAction | null {
  try {
    // Parse mingla:// URLs
    const withoutScheme = url.replace(/^mingla:\/\//, '');
    const [pathPart, queryPart] = withoutScheme.split('?');
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
        return { page: 'home', params };
      case 'discover':
        return { page: 'discover', params };
      case 'connections':
        return { page: 'connections', params };
      case 'session':
        return {
          page: 'board-view',
          params: { sessionId: pathSegments[1], ...params },
        };
      case 'messages':
        return {
          page: 'connections',
          params: { tab: 'messages', conversationId: pathSegments[1], ...params },
        };
      case 'calendar':
        return {
          page: 'likes',
          params: { tab: 'calendar', entryId: pathSegments[1], ...params },
        };
      case 'review':
        return {
          page: 'review',
          params: { experienceId: pathSegments[1], ...params },
        };
      case 'profile':
        return { page: 'profile', params };
      case 'subscription':
        return { page: 'subscription', params };
      case 'onboarding':
        return { page: 'onboarding', params };
      case 'board':
        // Legacy: mingla://board/{code}
        return { page: 'board-invite', params: { code: pathSegments[1] } };
      case 'likes':
        return { page: 'likes', params };
      case 'saved':
        return { page: 'saved', params };
      default:
        console.warn('[deepLinkService] Unknown deep link path:', path);
        return null;
    }
  } catch (err) {
    console.warn('[deepLinkService] Failed to parse deep link:', url, err);
    return null;
  }
}

// ── Executor ─────────────────────────────────────────────────────────────────

export function executeDeepLink(
  action: NavigationAction | null,
  handlers: NavigationHandlers
): void {
  if (!action) return;

  const { page, params } = action;

  // Forward params so target pages can react (e.g., open specific tab,
  // scroll to message, open conversation). Without this, params parsed
  // from deep links like mingla://connections?tab=messages were discarded.
  if (params && Object.keys(params).length > 0 && handlers.setDeepLinkParams) {
    handlers.setDeepLinkParams(params);
  }

  switch (page) {
    case 'home':
    case 'discover':
    case 'connections':
    case 'likes':
    case 'saved':
    case 'profile':
      handlers.setCurrentPage(page);
      break;

    case 'board-view':
      if (params?.sessionId && handlers.setBoardViewSessionId) {
        handlers.setBoardViewSessionId(params.sessionId);
      }
      handlers.setCurrentPage('board-view');
      break;

    case 'subscription':
      handlers.setShowPaywall?.(true);
      break;

    case 'review':
      // Navigate to likes for now; review modal is triggered by usePostExperienceCheck
      handlers.setCurrentPage('likes');
      break;

    default:
      // Fallback — try navigating directly
      handlers.setCurrentPage(page);
      break;
  }
}
