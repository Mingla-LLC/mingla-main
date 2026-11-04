/**
 * #4265 — the pure half of the share sheet's "Send in Mingla" list.
 *
 * Everything here runs once per FETCH (indexing) or once per deferred search
 * value (filtering), never per row per render. It has no React Native import so
 * the Deno suite can drive it directly.
 */
import type { ContentShareRecipient } from '../../services/contentShareDeliveryService';

/** A recipient with its search text, initials and second line worked out once. */
export type ShareRecipientRow = ContentShareRecipient & {
  readonly searchText: string;
  readonly initials: string;
  readonly metaLabel: string;
};

/** Fixed row height (design: 60pt rows, placeholders share the same layout). */
export const SHARE_RECIPIENT_ROW_HEIGHT = 60;
/** Placeholder rows shown only on a first-ever open (no cached list yet). */
export const SHARE_RECIPIENT_PLACEHOLDER_WIDTHS = ['46%', '30%', '52%', '38%', '44%', '34%', '50%'] as const;
/** Above this font scale rows may wrap taller than 60pt, so layout is measured. */
export const SHARE_RECIPIENT_FIXED_ROW_MAX_FONT_SCALE = 1.35;

const initialsOf = (name: string): string =>
  name.split(/\s+/u).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();

const metaLabelOf = (recipient: ContentShareRecipient): string =>
  recipient.targetKind === 'group' ? `Group chat · ${recipient.participantCount ?? 0}`
    : recipient.targetKind === 'friend' ? 'Friend · chat starts when sent'
    : recipient.conversationId ? 'Recent chat' : 'Direct chat';

/**
 * Used as the React Query `select`: a module-level function, so React Query
 * re-runs it only when the fetched array changes, never on a re-render.
 */
export function indexShareRecipients(recipients: readonly ContentShareRecipient[]): ShareRecipientRow[] {
  return recipients.map((recipient) => ({
    ...recipient,
    searchText: `${recipient.displayName} ${recipient.username ?? ''}`.toLocaleLowerCase(),
    initials: initialsOf(recipient.displayName),
    metaLabel: metaLabelOf(recipient),
  }));
}

export function normalizeShareSearch(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Returns the SAME array when there is no query, so the list keeps its data identity. */
export function filterShareRecipients(
  rows: readonly ShareRecipientRow[],
  normalizedQuery: string,
): readonly ShareRecipientRow[] {
  if (!normalizedQuery) return rows;
  return rows.filter((row) => row.searchText.includes(normalizedQuery));
}

export type ShareRecipientListPhase = 'placeholder' | 'empty' | 'no-results' | 'list' | 'error-only';

/**
 * What the list area shows. Cached rows always win: placeholders appear only
 * when there is no list at all yet AND one is being fetched.
 */
export function shareRecipientListPhase(input: {
  hasData: boolean;
  totalCount: number;
  visibleCount: number;
  fetching: boolean;
  failed: boolean;
}): ShareRecipientListPhase {
  if (!input.hasData) {
    if (input.failed && !input.fetching) return 'error-only';
    return 'placeholder';
  }
  if (input.totalCount === 0) return input.failed ? 'error-only' : 'empty';
  if (input.visibleCount === 0) return 'no-results';
  return 'list';
}

/**
 * Fixed-row layout. VirtualizedList offsets count from the top of the content,
 * so the measured list-header height (preview, share buttons, search) is added.
 */
export function shareRecipientItemLayout(
  index: number,
  headerHeight: number,
): { length: number; offset: number; index: number } {
  return { length: SHARE_RECIPIENT_ROW_HEIGHT, offset: headerHeight + SHARE_RECIPIENT_ROW_HEIGHT * index, index };
}

export const shareRecipientKeyExtractor = (row: ShareRecipientRow): string => row.key;
