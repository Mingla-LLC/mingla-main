import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeContentShareNote } from '@mingla/sharing';
import { supabase } from './supabase';

export type ContentShareRecipient = {
  key: string;
  targetKind: 'direct' | 'group' | 'friend';
  targetId: string;
  personUserId: string | null;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
  participantCount: number | null;
};

type RecipientRow = {
  key: string; target_kind: ContentShareRecipient['targetKind']; target_id: string;
  person_user_id: string | null; display_name: string; username: string | null;
  avatar_url: string | null; conversation_id: string | null; participant_count: number | null;
};

type DeliveryResult = { deliveryId: string; conversationId: string; messageId: string; inserted: boolean };
export type ContentShareDeliveryState = 'pending' | 'sent' | 'failed';
export type PersistedContentShareOperation = {
  schemaVersion: 1;
  operationId: string;
  shortCode: string;
  shareVersion: number;
  senderNote: string | null;
  senderNoteGraphemeCount: number;
  targets: Array<{ key: string; targetKind: ContentShareRecipient['targetKind']; targetId: string; state: ContentShareDeliveryState }>;
};

const operationStorageKey = (shareCode: string, version: number): string =>
  `content-share-operation:${shareCode}:v${version}`;

const createUuid = (): string => {
  const cryptoValue = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof cryptoValue?.randomUUID === 'function') return cryptoValue.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoValue?.getRandomValues === 'function') cryptoValue.getRandomValues(bytes);
  else throw new Error('secure_random_unavailable');
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export async function loadContentShareOperation(shareCode: string, version: number): Promise<PersistedContentShareOperation | null> {
  const key = operationStorageKey(shareCode, version);
  const stored = await AsyncStorage.getItem(key);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as PersistedContentShareOperation;
    return parsed.schemaVersion === 1 && parsed.shortCode === shareCode && parsed.shareVersion === version && Array.isArray(parsed.targets) ? parsed : null;
  } catch { return null; }
}

export async function reconcileContentShareOperation(
  operation: PersistedContentShareOperation,
  recipients: ContentShareRecipient[],
): Promise<PersistedContentShareOperation> {
  const available = new Map(recipients.map((recipient) => [recipient.key, recipient]));
  const targets = operation.targets.filter((target) => {
    const recipient = available.get(target.key);
    return recipient?.targetKind === target.targetKind && recipient.targetId === target.targetId;
  });
  if (targets.length === operation.targets.length) return operation;
  const reconciled = { ...operation, targets };
  await AsyncStorage.setItem(
    operationStorageKey(operation.shortCode, operation.shareVersion),
    JSON.stringify(reconciled),
  ).catch((error: unknown) => {
    console.warn('[content-share] operation reconciliation persistence failed', error instanceof Error ? error.name : 'unknown');
  });
  return reconciled;
}

async function beginContentShareOperation(input: {
  shareCode: string; version: number; recipients: ContentShareRecipient[]; senderNote: string;
}): Promise<PersistedContentShareOperation> {
  const normalized = normalizeContentShareNote(input.senderNote);
  const existing = await loadContentShareOperation(input.shareCode, input.version);
  if (existing) {
    if ((existing.senderNote ?? '') !== (normalized.note ?? '') || existing.senderNoteGraphemeCount !== normalized.graphemeCount) {
      throw new Error('operation_identity_mismatch');
    }
    const byKey = new Map(existing.targets.map((target) => [target.key, target]));
    for (const recipient of input.recipients) if (!byKey.has(recipient.key)) existing.targets.push({ key: recipient.key, targetKind: recipient.targetKind, targetId: recipient.targetId, state: 'pending' });
    await AsyncStorage.setItem(operationStorageKey(input.shareCode, input.version), JSON.stringify(existing));
    return existing;
  }
  const created: PersistedContentShareOperation = {
    schemaVersion: 1, operationId: createUuid(), shortCode: input.shareCode,
    shareVersion: input.version, senderNote: normalized.note,
    senderNoteGraphemeCount: normalized.graphemeCount,
    targets: input.recipients.map((recipient) => ({ key: recipient.key, targetKind: recipient.targetKind, targetId: recipient.targetId, state: 'pending' })),
  };
  await AsyncStorage.setItem(operationStorageKey(input.shareCode, input.version), JSON.stringify(created));
  return created;
}

export async function clearContentShareOperationId(shareCode: string, version: number): Promise<void> {
  await AsyncStorage.removeItem(operationStorageKey(shareCode, version));
}

export async function listContentShareRecipients(): Promise<ContentShareRecipient[]> {
  const { data, error } = await supabase.rpc('list_content_share_recipients');
  if (error) throw error;
  return ((data ?? []) as RecipientRow[]).map((row) => ({
    key: row.key, targetKind: row.target_kind, targetId: row.target_id,
    personUserId: row.person_user_id, displayName: row.display_name,
    username: row.username, avatarUrl: row.avatar_url,
    conversationId: row.conversation_id, participantCount: row.participant_count,
  }));
}

async function notifyInsertedDelivery(result: DeliveryResult, title: string): Promise<void> {
  if (!result.inserted) return;
  const { data: auth } = await supabase.auth.getUser();
  const senderId = auth.user?.id;
  if (!senderId) return;
  const { data: participants } = await supabase.from('conversation_participants')
    .select('user_id').eq('conversation_id', result.conversationId).neq('user_id', senderId);
  const settled = await Promise.allSettled((participants ?? []).map(async (participant) => {
    const { error } = await supabase.functions.invoke('notify-message', { body: {
      type: 'direct_card_message', senderId, conversationId: result.conversationId,
      recipientId: participant.user_id, messageId: result.messageId,
      cardTitle: title, cardId: result.messageId, cardImageUrl: null,
    } });
    if (error) throw error;
  }));
  if (settled.some((entry) => entry.status === 'rejected')) throw new Error('notification_fanout_failed');
}

export async function sendContentShareToRecipients(input: {
  recipients: ContentShareRecipient[]; shortCode: string;
  shareVersion: number; senderNote: string; title: string;
  onSettled?: (key: string, state: 'sent' | 'failed') => void;
}): Promise<{ sent: number; failed: number; sentKeys: string[]; failedKeys: string[] }> {
  if (input.recipients.length === 0) throw new Error('no_available_recipients');
  const note = normalizeContentShareNote(input.senderNote);
  const operation = await beginContentShareOperation({ shareCode: input.shortCode, version: input.shareVersion, recipients: input.recipients, senderNote: input.senderNote });
  let persistQueue = Promise.resolve();
  const persistState = (key: string, state: ContentShareDeliveryState): Promise<void> => {
    const target = operation.targets.find((candidate) => candidate.key === key);
    if (target) target.state = state;
    persistQueue = persistQueue.then(() => AsyncStorage.setItem(operationStorageKey(input.shortCode, input.shareVersion), JSON.stringify(operation)));
    return persistQueue;
  };
  let cursor = 0;
  let sent = 0;
  let failed = 0;
  const sentKeys: string[] = [];
  const failedKeys: string[] = [];
  const worker = async (): Promise<void> => {
    while (cursor < input.recipients.length) {
      const recipient = input.recipients[cursor++];
      try {
        const { data, error } = await supabase.rpc('send_content_share_message', {
          p_operation_id: operation.operationId, p_target_kind: recipient.targetKind,
          p_target_id: recipient.targetId, p_short_code: input.shortCode,
          p_share_version: input.shareVersion, p_sender_note: note.note,
          p_sender_note_grapheme_count: note.graphemeCount,
        });
        if (error) throw error;
        const result = data as DeliveryResult;
        await notifyInsertedDelivery(result, input.title).catch((error: unknown) => {
          console.warn('[content-share] notification fanout failed', error instanceof Error ? error.name : 'unknown');
        });
        sent += 1;
        sentKeys.push(recipient.key);
        await persistState(recipient.key, 'sent');
        input.onSettled?.(recipient.key, 'sent');
      } catch (error) {
        failed += 1;
        failedKeys.push(recipient.key);
        await persistState(recipient.key, 'failed');
        console.warn('[content-share] delivery failed', error instanceof Error ? error.name : 'unknown');
        input.onSettled?.(recipient.key, 'failed');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, input.recipients.length) }, worker));
  return { sent, failed, sentKeys, failedKeys };
}
