/**
 * Issue #4275: what the background reads behind a 1:1 chat really say about the
 * other person. The chat hides its message box when the person is gone, so only
 * a real answer may do that. supabase-js resolves a failed read as
 * `{ data: null, error }` and does not reject, so a failure looks like "nobody
 * there" unless the error is read. A failed read answers nothing: 'unknown'
 * leaves the chat as it is.
 *
 * Pure on purpose (no expo, React or supabase imports) so a test can run it
 * without rendering. The `profiles` read is `.single()`, whose only way of
 * saying "no such row" is PGRST116.
 *
 * Why PGRST116 means gone: the SELECT policies on `profiles` are permissive, and
 * one of them lets a signed-in caller read every row unless that person blocked
 * the caller. So a signed-in reader only misses a row that is truly absent, or
 * one held by someone who blocked them. A block is its own banner and outranks
 * this one (MessageInterface), and it hides the message box as well. A signed-out
 * reader gets a permission error (issue #3969), never PGRST116.
 */

export interface ChatPeerReadError {
  code?: string | null;
}

export interface ChatPeerReadResult<T> {
  data: T | null;
  error: ChatPeerReadError | null;
}

export type ChatPeerAccountState = 'deleted' | 'active' | 'unknown';
export type ChatPeerFriendshipState = 'friends' | 'not_friends' | 'unknown';

const NO_ROW_CODE = 'PGRST116';

export function classifyPeerAccountRead(
  result: ChatPeerReadResult<{ active?: boolean | null }>,
): ChatPeerAccountState {
  if (result.error) {
    return result.error.code === NO_ROW_CODE ? 'deleted' : 'unknown';
  }
  if (!result.data) return 'unknown';
  return result.data.active === false ? 'deleted' : 'active';
}

export function classifyPeerFriendshipRead(
  result: ChatPeerReadResult<readonly unknown[]>,
): ChatPeerFriendshipState {
  if (result.error || !result.data) return 'unknown';
  return result.data.length > 0 ? 'friends' : 'not_friends';
}

/**
 * Real deletion removes the person's row from `conversation_participants`
 * (a cascade from auth.users), so their old 1:1 chat holds only the reader and
 * has no id left to read. That is a real answer, reached without any read.
 */
export function isPeerGoneFromDirectChat(input: {
  isGroupConversation: boolean;
  otherParticipantId: string | null | undefined;
}): boolean {
  return !input.isGroupConversation && !input.otherParticipantId;
}

export const CHAT_PEER_READ_RETRY_DELAY_MS = 800;

/**
 * Runs a read and retries once if it gave no answer. Returns null when the chat
 * has moved on (a result for a chat no longer open must be dropped), and
 * 'unknown' when both tries failed.
 */
export async function settleChatPeerRead<T, S extends string>(input: {
  label: string;
  read: () => PromiseLike<ChatPeerReadResult<T>>;
  classify: (result: ChatPeerReadResult<T>) => S | 'unknown';
  isCurrent: () => boolean;
  wait?: (ms: number) => Promise<void>;
}): Promise<S | 'unknown' | null> {
  const wait = input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attempt = async (): Promise<S | 'unknown'> => {
    try {
      const result = await input.read();
      const state = input.classify(result);
      if (state === 'unknown') {
        console.warn(`[chatPeerState] ${input.label} read gave no answer`, result.error?.code ?? 'no code');
      }
      return state;
    } catch (error) {
      console.warn(`[chatPeerState] ${input.label} read threw`, error);
      return 'unknown';
    }
  };

  const first = await attempt();
  if (!input.isCurrent()) return null;
  if (first !== 'unknown') return first;

  await wait(CHAT_PEER_READ_RETRY_DELAY_MS);
  if (!input.isCurrent()) return null;

  const second = await attempt();
  return input.isCurrent() ? second : null;
}
