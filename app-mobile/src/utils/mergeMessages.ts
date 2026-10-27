/**
 * Issue #4114 Wave 1 — the single owner of every write to a chat's message list.
 *
 * A message used to reach the sender's screen twice: once from the insert's own
 * response and once from the realtime INSERT echo, paired by a guess (same
 * sender + same text + under 5 seconds apart) that failed on slow networks, on
 * photos and when the phone clock was off. Refreshes also replaced the whole
 * list and dropped sends still in flight.
 *
 * Every write now goes through `mergeMessages`:
 *   - the key is `clientId || id`. The phone mints `clientId` before sending and
 *     the server stores it (`messages.client_id`), so the optimistic bubble, the
 *     insert response, the realtime echo and every refresh collapse into one row
 *     with no guessing. Rows are also matched by `id`, so an older cached copy
 *     without a client id still dedupes against the same server row.
 *   - a confirmed server row always beats a local (unsent) copy, and a late
 *     "send failed" for a message the server already confirmed is ignored.
 *   - a server snapshot (refresh) is authoritative only for the time window it
 *     covers: confirmed rows inside that window that the snapshot no longer has
 *     are dropped (deleted on the server); pending and failed local sends, older
 *     loaded pages and anything newer than the snapshot are kept.
 *   - the result is sorted by timestamp with a stable tie-break.
 *
 * Pure and dependency-free (no React Native imports) so it runs under Deno.
 */

/** The fields the merge reads. `Message` in connectionsService satisfies this. */
export interface MergeableMessage {
  id: string;
  clientId?: string;
  timestamp: string;
  failed?: boolean;
}

export interface MergeMessagesOptions {
  /**
   * Set when `incoming` is a server read of the newest messages (open, background
   * refresh, reconnect). `complete` is true when the read returned fewer rows than
   * a page, i.e. it reaches the start of the conversation.
   */
  snapshot?: { complete: boolean };
}

/** Optimistic (not yet confirmed) messages carry an id with this prefix. */
export const LOCAL_MESSAGE_ID_PREFIX = 'temp-';

export function isLocalMessage(message: Pick<MergeableMessage, 'id'>): boolean {
  return message.id.startsWith(LOCAL_MESSAGE_ID_PREFIX);
}

/** A local copy that has not reached the server yet and has not failed. */
export function isPendingMessage(message: MergeableMessage): boolean {
  return isLocalMessage(message) && message.failed !== true;
}

interface Entry<T> {
  message: T;
  alive: boolean;
  order: number;
}

function timeOf(message: MergeableMessage): number {
  return Date.parse(message.timestamp);
}

/** Copies only the fields `next` actually defines, so a sparse update never erases data. */
function overlay<T extends MergeableMessage>(base: T, next: T): T {
  const merged: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(next as unknown as Record<string, unknown>)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as T;
}

/** Decides which copy of one message survives. */
function resolve<T extends MergeableMessage>(existing: T, next: T): T {
  const existingLocal = isLocalMessage(existing);
  const nextLocal = isLocalMessage(next);
  if (!existingLocal && nextLocal) {
    // The server already confirmed this message; a late local state (for example
    // "failed" from a send whose response was lost after the echo arrived) loses.
    return existing;
  }
  if (existingLocal && !nextLocal) {
    // Confirmation: the server row replaces the optimistic copy, server time included.
    // Keep the client id if the server row came back without one.
    return next.clientId || !existing.clientId ? next : { ...next, clientId: existing.clientId };
  }
  return overlay(existing, next);
}

export function mergeMessages<T extends MergeableMessage>(
  prev: readonly T[],
  incoming: readonly T[],
  options: MergeMessagesOptions = {},
): T[] {
  const entries: Entry<T>[] = [];
  const byId = new Map<string, Entry<T>>();
  const byClientId = new Map<string, Entry<T>>();
  let order = 0;

  const index = (entry: Entry<T>): void => {
    byId.set(entry.message.id, entry);
    if (entry.message.clientId) byClientId.set(entry.message.clientId, entry);
  };
  const unindex = (entry: Entry<T>): void => {
    if (byId.get(entry.message.id) === entry) byId.delete(entry.message.id);
    const clientId = entry.message.clientId;
    if (clientId && byClientId.get(clientId) === entry) byClientId.delete(clientId);
  };

  const upsert = (message: T): void => {
    const byClient = message.clientId ? byClientId.get(message.clientId) : undefined;
    const byServerId = byId.get(message.id);
    let target = byClient ?? byServerId;
    if (byClient && byServerId && byClient !== byServerId) {
      // One message, two stale copies (e.g. a cached row without a client id and
      // the optimistic bubble): fold them together before applying the update.
      unindex(byServerId);
      byServerId.alive = false;
      unindex(byClient);
      byClient.message = resolve(byClient.message, byServerId.message);
      index(byClient);
      target = byClient;
    }
    if (!target) {
      const entry: Entry<T> = { message, alive: true, order: order++ };
      entries.push(entry);
      index(entry);
      return;
    }
    unindex(target);
    target.message = resolve(target.message, message);
    index(target);
  };

  for (const message of prev) upsert(message);

  if (options.snapshot && incoming.length > 0) {
    const times = incoming.map(timeOf).filter((value) => !Number.isNaN(value));
    const newest = times.length > 0 ? Math.max(...times) : Number.NaN;
    const oldest = options.snapshot.complete
      ? Number.NEGATIVE_INFINITY
      : times.length > 0 ? Math.min(...times) : Number.NaN;
    const snapshotIds = new Set(incoming.map((message) => message.id));
    const snapshotClientIds = new Set(
      incoming.map((message) => message.clientId).filter((value): value is string => !!value),
    );
    for (const entry of entries) {
      if (!entry.alive || isLocalMessage(entry.message)) continue;
      const time = timeOf(entry.message);
      if (Number.isNaN(time) || Number.isNaN(newest) || Number.isNaN(oldest)) continue;
      // An incomplete page (limit reached) is cut at its oldest instant. The
      // server orders by created_at only, so rows sharing that instant may
      // have been cut off; they sit on the boundary and are never judged
      // missing (tester T-W1-1). A complete snapshot has no lower edge.
      if (time > newest) continue;
      if (options.snapshot.complete ? time < oldest : time <= oldest) continue;
      const inSnapshot = snapshotIds.has(entry.message.id) ||
        (!!entry.message.clientId && snapshotClientIds.has(entry.message.clientId));
      if (!inSnapshot) {
        unindex(entry);
        entry.alive = false;
      }
    }
  }

  for (const message of incoming) upsert(message);

  return entries
    .filter((entry) => entry.alive)
    .sort((left, right) => {
      const leftTime = timeOf(left.message);
      const rightTime = timeOf(right.message);
      const leftValid = !Number.isNaN(leftTime);
      const rightValid = !Number.isNaN(rightTime);
      if (leftValid && rightValid && leftTime !== rightTime) return leftTime - rightTime;
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      // Same instant: confirmed rows before local ones, then first-seen order.
      const leftLocal = isLocalMessage(left.message) ? 1 : 0;
      const rightLocal = isLocalMessage(right.message) ? 1 : 0;
      if (leftLocal !== rightLocal) return leftLocal - rightLocal;
      return left.order - right.order;
    })
    .map((entry) => entry.message);
}

/** The oldest confirmed message's timestamp: the cursor for loading older history. */
export function oldestConfirmedTimestamp(messages: readonly MergeableMessage[]): string | null {
  let oldest: MergeableMessage | null = null;
  for (const message of messages) {
    if (isLocalMessage(message)) continue;
    if (!oldest || timeOf(message) < timeOf(oldest)) oldest = message;
  }
  return oldest ? oldest.timestamp : null;
}

/**
 * A v4 uuid for `messages.client_id`. Uses the platform's secure random source
 * when present; otherwise falls back to Math.random, which is fine here because
 * the id only has to be unique within one conversation's sends from one phone.
 */
export function createClientMessageId(): string {
  const cryptoValue = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (bytes: Uint8Array) => Uint8Array } }).crypto;
  if (typeof cryptoValue?.randomUUID === 'function') return cryptoValue.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoValue?.getRandomValues === 'function') {
    cryptoValue.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
