/**
 * #4382 Wave 5 — the Explorer app's Help & Support rules, kept free of React
 * Native and Supabase so the Deno suites can drive them directly.
 *
 *   - the six Explorer topics and the attachment limits the backend enforces
 *     (issue_4382_register_support_attachment: 10 images of up to 10 MB,
 *     one voice note of up to 5 minutes and 15 MB, m4a);
 *   - client_meta: app version, OS, OS version, device model and source
 *     screen only. The beta tool saved a location; Help & Support never does;
 *   - the exact issue_4382_create_customer_ticket arguments (p_app 'explorer');
 *   - "Your requests" keeps only tickets this person asked for;
 *   - the status banner, and the composer that a closed request replaces.
 */

export const EXPLORER_SUPPORT_TOPICS = [
  'broken',
  'bookings_payments',
  'idea',
  'confusing',
  'account',
  'other',
] as const;
export type ExplorerSupportTopic = (typeof EXPLORER_SUPPORT_TOPICS)[number];

export const SUPPORT_ATTACHMENTS_BUCKET = 'support-attachments';
export const SUPPORT_SIGNED_URL_SECONDS = 3600;
export const MAX_SUPPORT_SCREENSHOTS = 10;
export const MAX_SUPPORT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SUPPORT_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_VOICE_NOTE_MS = 300_000;
export const MIN_VOICE_NOTE_MS = 3_000;
export const SUPPORT_MESSAGE_MAX = 8000;
export const VOICE_NOTE_MIME = 'audio/mp4';

export type SupportImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/heic';

export function isExplorerSupportTopic(value: unknown): value is ExplorerSupportTopic {
  return typeof value === 'string' && (EXPLORER_SUPPORT_TOPICS as readonly string[]).includes(value);
}

/** The MIME the backend accepts for a picked image, or null when refused. */
export function supportImageMime(mimeType: string | null | undefined, fileName?: string | null): SupportImageMime | null {
  const mime = (mimeType ?? '').trim().toLowerCase();
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/heic') return mime;
  if (mime === 'image/jpg') return 'image/jpeg';
  if (mime === 'image/heif') return 'image/heic';
  if (mime !== '' && !mime.startsWith('image/')) return null;
  const ext = (fileName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return null;
}

export interface SupportScreenshot {
  uri: string;
  width: number;
  height: number;
  /** Known after compression; checked again at upload. */
  bytes?: number | null;
}

/** Add picked screenshots without passing the 10-image limit. */
export function addScreenshots<T extends SupportScreenshot>(
  existing: readonly T[],
  incoming: readonly T[],
): { screenshots: T[]; dropped: number } {
  const room = Math.max(0, MAX_SUPPORT_SCREENSHOTS - existing.length);
  return {
    screenshots: [...existing, ...incoming.slice(0, room)],
    dropped: Math.max(0, incoming.length - room),
  };
}

export type VoiceNoteRefusal = 'too_short' | 'too_long' | 'too_large';

/** Whether a recorded voice note can be sent; null when it can. */
export function voiceNoteRefusal(durationMs: number, bytes: number | null): VoiceNoteRefusal | null {
  if (!Number.isFinite(durationMs) || durationMs < MIN_VOICE_NOTE_MS) return 'too_short';
  if (durationMs > MAX_VOICE_NOTE_MS) return 'too_long';
  if (bytes !== null && bytes > MAX_SUPPORT_AUDIO_BYTES) return 'too_large';
  return null;
}

export const CLIENT_META_KEYS = ['app_version', 'os', 'os_version', 'device_model', 'source_screen'] as const;
export type ClientMetaKey = (typeof CLIENT_META_KEYS)[number];
export type SupportClientMeta = Partial<Record<ClientMetaKey, string>>;

/**
 * App and device facts for the ticket. Only the five allowed keys survive;
 * anything else (latitude, longitude, a place) is dropped on the phone.
 */
export function buildSupportClientMeta(input: Record<string, unknown>): SupportClientMeta {
  const meta: SupportClientMeta = {};
  for (const key of CLIENT_META_KEYS) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      meta[key] = String(value).slice(0, 120);
    } else if (typeof value === 'string' && value.trim().length > 0 && value.trim() !== 'unknown') {
      meta[key] = value.trim().slice(0, 120);
    }
  }
  return meta;
}

export interface ExplorerCreateTicketInput {
  clientRequestId: string;
  topic: ExplorerSupportTopic;
  message: string;
  attachmentIds: readonly string[];
  clientMeta: Record<string, unknown>;
}

export interface CreateCustomerTicketArgs {
  p_client_request_id: string;
  p_app: 'explorer';
  p_topic: ExplorerSupportTopic;
  p_subject: string;
  p_message: string;
  p_attachment_ids: string[];
  p_client_meta: SupportClientMeta;
  p_brand_id: null;
  p_visibility: 'person';
}

/**
 * The create call. The subject is left to the server (first line of the
 * message, else the topic's name). Either typed words or a voice note /
 * screenshot is enough.
 */
export function buildExplorerCreateTicketArgs(input: ExplorerCreateTicketInput): CreateCustomerTicketArgs {
  if (!isExplorerSupportTopic(input.topic)) throw new Error('invalid_topic');
  const message = input.message.trim().slice(0, SUPPORT_MESSAGE_MAX);
  if (message.length === 0 && input.attachmentIds.length === 0) throw new Error('message_required');
  return {
    p_client_request_id: input.clientRequestId,
    p_app: 'explorer',
    p_topic: input.topic,
    p_subject: '',
    p_message: message,
    p_attachment_ids: [...input.attachmentIds],
    p_client_meta: buildSupportClientMeta(input.clientMeta),
    p_brand_id: null,
    p_visibility: 'person',
  };
}

/** "Your requests": only this person's tickets, never an internal one. */
export function keepOwnTickets<T extends { requester_user_id: string | null; visibility?: string | null }>(
  rows: readonly T[],
  userId: string,
): T[] {
  return rows.filter((row) => row.requester_user_id === userId && row.visibility !== 'internal');
}

export function formatTicketNumber(ticketNumber: number | null | undefined): string {
  return typeof ticketNumber === 'number' && Number.isFinite(ticketNumber) ? `S-${ticketNumber}` : '';
}

export type SupportStatusKind = 'waiting_mingla' | 'waiting_you' | 'resolved' | 'closed';

export function supportStatusKind(status: string | null | undefined): SupportStatusKind {
  switch (status) {
    case 'closed':
      return 'closed';
    case 'resolved':
      return 'resolved';
    case 'pending':
      return 'waiting_you';
    default:
      return 'waiting_mingla';
  }
}

/** The promised next update, only while it is still ahead. */
export function upcomingNextUpdate(nextUpdateAt: string | null | undefined, nowMs: number = Date.now()): string | null {
  return typeof nextUpdateAt === 'string' && Date.parse(nextUpdateAt) > nowMs ? nextUpdateAt : null;
}

/** A closed request replaces the reply box with "Start a new request". */
export function supportComposerMode(status: string | null | undefined): 'composer' | 'start_new' {
  return status === 'closed' ? 'start_new' : 'composer';
}

const SUPPORT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSupportTicketId(value: unknown): value is string {
  return typeof value === 'string' && SUPPORT_UUID.test(value);
}

/**
 * The in-app route for a support thread. Deep links and pushes resolve the
 * same route through deepLinkService.supportRoutePath (kept import-free
 * there); the routing suite pins that both agree.
 */
export function supportRoutePath(ticketId?: string | null): string {
  return isSupportTicketId(ticketId) ? `/support/${ticketId.toLowerCase()}` : '/support';
}

export function formatVoiceDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
