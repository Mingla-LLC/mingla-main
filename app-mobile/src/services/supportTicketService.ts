/**
 * #4382 Wave 5 — Help & Support for every Explorer user. Replaces the beta
 * feedback service (`beta-feedback` bucket, `beta_feedback` table and the
 * `submit-feedback` function, all retired).
 *
 *   voice notes   SupportVoiceRecorder is the beta tool's FeedbackRecorder,
 *                 kept as it was (expo-av, m4a, the iOS audio-session clean-up
 *                 that fixed the recording freeze).
 *   screenshots   resized to 1920px and re-encoded as JPEG
 *                 (expo-image-manipulator), as the beta tool did.
 *   uploads       issue_4382_register_support_attachment, then the private
 *                 `support-attachments` bucket at exactly the returned path.
 *   create        issue_4382_create_customer_ticket with p_app 'explorer'.
 *   read          own tickets (requester = me), the thread with attachments,
 *                 one-hour signed links.
 *   reply         the `support-send` edge function (a reply reopens a waiting
 *                 or resolved request; a closed one answers 409).
 *
 * expo-av, expo-image-manipulator and expo-file-system already ship in the
 * Explorer binary, so this adds no native module. Every read or write throws
 * on failure; screens surface it.
 */
import { Audio } from 'expo-av';
import { AppState } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';
import { extractFunctionErrorFields } from '../utils/edgeFunctionError';
import {
  MAX_SUPPORT_AUDIO_BYTES,
  MAX_SUPPORT_IMAGE_BYTES,
  SUPPORT_ATTACHMENTS_BUCKET,
  SUPPORT_SIGNED_URL_SECONDS,
  VOICE_NOTE_MIME,
  buildExplorerCreateTicketArgs,
  keepOwnTickets,
  parseSupportProductStage,
  type ExplorerCreateTicketInput,
  type SupportProductStage,
  type SupportScreenshot,
} from '../utils/supportRequestModel';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SupportTicketRow {
  id: string;
  ticket_number: number | null;
  subject: string;
  topic: string | null;
  status: string;
  conversation_id: string;
  requester_user_id: string | null;
  visibility: string | null;
  imported_from: string | null;
  last_sender_kind: string | null;
  last_message_at: string;
  created_at: string;
  next_update_at: string | null;
}

export interface SupportAttachmentRow {
  id: string;
  message_id: string | null;
  storage_path: string;
  kind: 'image' | 'audio';
  mime: string;
  duration_ms: number | null;
}

export interface SupportThreadMessage {
  id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
  sender_display_name_snapshot: string | null;
  sender_role_snapshot: string | null;
  attachments: SupportAttachmentRow[];
}

export interface SupportThreadData {
  ticket: SupportTicketRow | null;
  messages: SupportThreadMessage[];
  /** One-hour signed links keyed by storage path. */
  signed: Record<string, string>;
  /** The customer-safe Product stage, or null (no banner). */
  productStage: SupportProductStage | null;
}

const TICKET_FIELDS =
  'id, ticket_number, subject, topic, status, conversation_id, requester_user_id, visibility, imported_from, last_sender_kind, last_message_at, created_at, next_update_at';

/** React Native FormData takes { uri, type, name } in place of a Blob. */
interface RNFormDataBlob {
  uri: string;
  type: string;
  name: string;
}

const SCREENSHOT_MAX_DIMENSION = 1920;
const SCREENSHOT_JPEG_QUALITY = 0.7;

// ── Voice notes (the beta tool's recorder, unchanged in behaviour) ─────────

class SupportVoiceRecorder {
  private recording: Audio.Recording | null = null;
  private startTime = 0;

  async initialize(): Promise<boolean> {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[Support] Microphone permission denied');
        return false;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      return true;
    } catch (error) {
      console.error('[Support] Error initializing recorder:', error);
      return false;
    }
  }

  async startRecording(): Promise<boolean> {
    if (this.recording) return false;
    // The mic permission dialog can briefly make the app 'inactive', which
    // makes prepareToRecordAsync throw.
    if (AppState.currentState !== 'active') return false;
    // Re-check every time: access may have been revoked in Settings.
    const granted = await this.initialize();
    if (!granted) return false;

    const newRecording = new Audio.Recording();
    try {
      await newRecording.prepareToRecordAsync({
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
        },
        web: {},
      });
      await newRecording.startAsync();
      this.recording = newRecording;
      this.startTime = Date.now();
      return true;
    } catch (error) {
      console.error('[Support] Error starting recording:', error);
      // Unload the half-prepared recording, or the iOS audio session stays in
      // recording mode (the beta tool's recording-freeze fix).
      try {
        await newRecording.stopAndUnloadAsync();
      } catch (unloadError) {
        console.warn('[Support] Unloading a failed recording threw:', unloadError);
      }
      await this.resetAudioMode();
      this.recording = null;
      return false;
    }
  }

  async stopRecording(): Promise<{ uri: string; durationMs: number } | null> {
    if (!this.recording) return null;
    try {
      const status = await this.recording.getStatusAsync();
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      await this.resetAudioMode();
      this.recording = null;
      if (!uri) return null;
      return { uri, durationMs: status.durationMillis || 0 };
    } catch (error) {
      console.error('[Support] Error stopping recording:', error);
      this.recording = null;
      return null;
    }
  }

  async cancelRecording(): Promise<void> {
    if (!this.recording) return;
    try {
      await this.recording.stopAndUnloadAsync();
      await this.resetAudioMode();
    } catch (error) {
      console.error('[Support] Error cancelling recording:', error);
    } finally {
      this.recording = null;
      this.startTime = 0;
    }
  }

  async resetAudioMode(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    } catch (error) {
      console.warn('[Support] Failed to reset audio mode:', error);
    }
  }

  getElapsedMs(): number {
    if (!this.recording || this.startTime === 0) return 0;
    return Date.now() - this.startTime;
  }

  isRecording(): boolean {
    return this.recording !== null;
  }
}

export const supportVoiceRecorder = new SupportVoiceRecorder();

// ── Uploads ─────────────────────────────────────────────────────────────────

export type SupportUploadErrorCode = 'too_large' | 'unreadable' | 'register_failed' | 'upload_failed';

export class SupportUploadError extends Error {
  constructor(public readonly code: SupportUploadErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SupportUploadError';
  }
}

async function fileBytes(uri: string): Promise<number | null> {
  const FileSystem = await import('expo-file-system/legacy');
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === 'number' && info.size > 0 ? info.size : null;
}

async function registerAndUpload(args: {
  ticketOrDraftId: string;
  kind: 'image' | 'audio';
  mime: string;
  uri: string;
  name: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('issue_4382_register_support_attachment', {
    p_ticket_id: args.ticketOrDraftId,
    p_kind: args.kind,
    p_mime: args.mime,
    p_bytes: args.bytes,
    p_width: args.width ?? null,
    p_height: args.height ?? null,
    p_duration_ms: args.durationMs ?? null,
    p_is_internal: false,
  });
  if (error) throw new SupportUploadError('register_failed', error.message);
  const registered = data as { attachment_id?: string; bucket?: string; storage_path?: string } | null;
  if (!registered?.attachment_id || !registered.storage_path) {
    throw new SupportUploadError('register_failed');
  }
  const form = new FormData();
  const blob: RNFormDataBlob = { uri: args.uri, type: args.mime, name: args.name };
  form.append('file', blob as unknown as Blob);
  const { error: uploadError } = await supabase.storage
    .from(registered.bucket || SUPPORT_ATTACHMENTS_BUCKET)
    .upload(registered.storage_path, form, { contentType: args.mime, upsert: false });
  if (uploadError) throw new SupportUploadError('upload_failed', uploadError.message);
  return registered.attachment_id;
}

/** Resize, re-encode as JPEG, register and upload one screenshot. */
export async function uploadSupportScreenshot(ticketOrDraftId: string, shot: SupportScreenshot): Promise<string> {
  const longest = Math.max(shot.width, shot.height);
  const actions: ImageManipulator.Action[] = [];
  if (longest > SCREENSHOT_MAX_DIMENSION) {
    const scale = SCREENSHOT_MAX_DIMENSION / longest;
    actions.push({ resize: { width: Math.round(shot.width * scale), height: Math.round(shot.height * scale) } });
  }
  const compressed = await ImageManipulator.manipulateAsync(shot.uri, actions, {
    compress: SCREENSHOT_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const bytes = await fileBytes(compressed.uri);
  if (bytes === null) throw new SupportUploadError('unreadable');
  if (bytes > MAX_SUPPORT_IMAGE_BYTES) throw new SupportUploadError('too_large');
  return registerAndUpload({
    ticketOrDraftId,
    kind: 'image',
    mime: 'image/jpeg',
    uri: compressed.uri,
    name: `screenshot_${Date.now()}.jpg`,
    bytes,
    width: compressed.width,
    height: compressed.height,
  });
}

/** Register and upload one voice note (m4a, kind 'audio'). */
export async function uploadSupportVoiceNote(
  ticketOrDraftId: string,
  note: { uri: string; durationMs: number },
): Promise<string> {
  const bytes = await fileBytes(note.uri);
  if (bytes === null) throw new SupportUploadError('unreadable');
  if (bytes > MAX_SUPPORT_AUDIO_BYTES) throw new SupportUploadError('too_large');
  return registerAndUpload({
    ticketOrDraftId,
    kind: 'audio',
    mime: VOICE_NOTE_MIME,
    uri: note.uri,
    name: `voice_${Date.now()}.m4a`,
    bytes,
    durationMs: Math.max(1, Math.round(note.durationMs)),
  });
}

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * Create the request. The client request id is the ticket id, so a retry
 * after a lost response returns the same request, never a second one.
 */
export async function createExplorerSupportTicket(input: ExplorerCreateTicketInput): Promise<string> {
  const args = buildExplorerCreateTicketArgs(input);
  const { data, error } = await supabase.rpc('issue_4382_create_customer_ticket', args);
  if (error) throw new Error(error.message);
  if (typeof data !== 'string' || data.length === 0) throw new Error('create_failed');
  return data;
}

// ── Read ────────────────────────────────────────────────────────────────────

/** This person's requests, newest activity first. */
export async function listMySupportTickets(userId: string): Promise<SupportTicketRow[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select(TICKET_FIELDS)
    .eq('requester_user_id', userId)
    .neq('visibility', 'internal')
    .order('last_message_at', { ascending: false });
  if (error) throw new Error(error.message);
  return keepOwnTickets((data ?? []) as SupportTicketRow[], userId);
}

async function signPaths(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(SUPPORT_ATTACHMENTS_BUCKET)
    .createSignedUrls(paths, SUPPORT_SIGNED_URL_SECONDS);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
  }
  return out;
}

/**
 * One request and its conversation. Returns `ticket: null` when the id is
 * unknown or belongs to someone else (RLS hides it), so a stray deep link
 * shows "not found", never a crash.
 */
export async function getSupportThread(userId: string, ticketId: string): Promise<SupportThreadData> {
  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .select(TICKET_FIELDS)
    .eq('id', ticketId)
    .eq('requester_user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ticket) return { ticket: null, messages: [], signed: {}, productStage: null };
  const row = ticket as SupportTicketRow;

  const [messagesResult, attachmentsResult] = await Promise.all([
    supabase
      .from('messages')
      .select('id, sender_id, content, created_at, sender_display_name_snapshot, sender_role_snapshot')
      .eq('conversation_id', row.conversation_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase
      .from('support_attachments')
      .select('id, message_id, storage_path, kind, mime, duration_ms')
      .eq('ticket_id', row.id)
      .not('message_id', 'is', null)
      .order('created_at', { ascending: true }),
  ]);
  if (messagesResult.error) throw new Error(messagesResult.error.message);
  if (attachmentsResult.error) throw new Error(attachmentsResult.error.message);

  const attachments = (attachmentsResult.data ?? []) as SupportAttachmentRow[];
  const byMessage = new Map<string, SupportAttachmentRow[]>();
  for (const attachment of attachments) {
    if (!attachment.message_id) continue;
    const list = byMessage.get(attachment.message_id) ?? [];
    list.push(attachment);
    byMessage.set(attachment.message_id, list);
  }
  let signed: Record<string, string> = {};
  try {
    signed = await signPaths(attachments.map((a) => a.storage_path));
  } catch (signError) {
    // The thread still reads; each file shows "unavailable" instead.
    console.warn('[Support] signing attachment links failed:', signError);
  }
  const messages = ((messagesResult.data ?? []) as Omit<SupportThreadMessage, 'attachments'>[]).map((m) => ({
    ...m,
    content: m.content ?? '',
    attachments: byMessage.get(m.id) ?? [],
  }));
  // The Product banner is extra context: a failed read hides it, never blocks the thread.
  let productStage: SupportProductStage | null = null;
  try {
    productStage = await getSupportProductStage(row.id);
  } catch (stageError) {
    console.warn('[Support] reading the Product stage failed:', stageError);
  }
  return { ticket: row, messages, signed, productStage };
}

/**
 * The request's customer-safe Product stage, or null when it has none (or the
 * caller cannot see it). Throws on a failed read.
 */
export async function getSupportProductStage(ticketId: string): Promise<SupportProductStage | null> {
  const { data, error } = await supabase.rpc('issue_4382_ticket_product_stage', { p_ticket_id: ticketId });
  if (error) throw new Error(error.message);
  return parseSupportProductStage(data);
}

// ── Reply ───────────────────────────────────────────────────────────────────

export class SupportReplyError extends Error {
  constructor(public readonly code: 'ticket_closed' | 'failed', message?: string) {
    super(message ?? code);
    this.name = 'SupportReplyError';
  }
}

/** A reply (text, screenshots or both) through support-send. */
export async function sendSupportReply(
  ticketId: string,
  content: string,
  attachmentIds: readonly string[] = [],
): Promise<{ status: string | null; reopened: boolean }> {
  const trimmed = content.trim();
  if (trimmed.length === 0 && attachmentIds.length === 0) throw new SupportReplyError('failed', 'content_required');
  const body: Record<string, unknown> = { ticketId, content: trimmed, actorMode: 'requester' };
  if (attachmentIds.length > 0) body.attachmentIds = [...attachmentIds];
  const { data, error } = await supabase.functions.invoke('support-send', { body });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    const fields = await extractFunctionErrorFields(error, 'send_failed');
    if (fields.token === 'ticket_closed' || status === 409) throw new SupportReplyError('ticket_closed');
    throw new SupportReplyError('failed', fields.token);
  }
  const result = (data ?? {}) as { status?: unknown; reopened?: unknown };
  return {
    status: typeof result.status === 'string' ? result.status : null,
    reopened: result.reopened === true,
  };
}
