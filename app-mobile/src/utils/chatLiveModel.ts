// Issue #4114 simulator QA: reactions and view-once opens arrive live inside
// the open chat (realtime on direct_message_reactions and message_media_views,
// migration 20271230074114) and are merged into the messages the chat already
// holds — the thread is never refetched for them.
//
// A reaction DELETE carries only the row id (RLS tables send the primary key
// only), so rows keep their id once known and a delete is matched by id.

export interface LiveReactionRow {
  id?: string;
  user_id: string;
  emoji: string;
}

export interface LiveMediaViewRow {
  user_id: string;
  viewed_at: string;
}

export type ChatLiveChange =
  | { kind: "reaction_insert"; messageId: string; row: Required<LiveReactionRow> }
  | { kind: "reaction_delete"; reactionId: string }
  | { kind: "media_view"; messageId: string; row: LiveMediaViewRow };

export interface LiveMessageLike {
  id: string;
  reactions?: LiveReactionRow[];
  mediaViews?: LiveMediaViewRow[];
}

/** Adds a reaction row, or gives an optimistic row (same person + emoji, no id yet) its id. */
export function applyReactionInsert(
  rows: readonly LiveReactionRow[] | undefined,
  row: Required<LiveReactionRow>,
): LiveReactionRow[] {
  const list = rows ?? [];
  if (list.some((existing) => existing.id === row.id)) return list as LiveReactionRow[];
  const optimistic = list.findIndex(
    (existing) => !existing.id && existing.user_id === row.user_id && existing.emoji === row.emoji,
  );
  if (optimistic >= 0) {
    return list.map((existing, index) => (index === optimistic ? { ...existing, id: row.id } : existing));
  }
  if (list.some((existing) => existing.user_id === row.user_id && existing.emoji === row.emoji)) {
    return list as LiveReactionRow[];
  }
  return [...list, { id: row.id, user_id: row.user_id, emoji: row.emoji }];
}

/** Removes the reaction row with this id (no change when it is not here). */
export function applyReactionDelete(
  rows: readonly LiveReactionRow[] | undefined,
  reactionId: string,
): LiveReactionRow[] | undefined {
  if (!rows || !rows.some((row) => row.id === reactionId)) return rows as LiveReactionRow[] | undefined;
  return rows.filter((row) => row.id !== reactionId);
}

/** Adds who opened a view-once item; the first-open time of a known person is kept. */
export function applyMediaView(
  views: readonly LiveMediaViewRow[] | undefined,
  row: LiveMediaViewRow,
): LiveMediaViewRow[] {
  const list = views ?? [];
  if (list.some((view) => view.user_id === row.user_id)) return list as LiveMediaViewRow[];
  return [...list, row];
}

/**
 * Applies one live change to a chat's messages. Returns the SAME array when
 * nothing in it changed, so callers can skip the state write.
 */
export function applyChatLiveChange<T extends LiveMessageLike>(messages: readonly T[], change: ChatLiveChange): readonly T[] {
  let changed = false;
  const next = messages.map((message) => {
    if (change.kind === "reaction_delete") {
      const reactions = applyReactionDelete(message.reactions, change.reactionId);
      if (reactions === message.reactions) return message;
      changed = true;
      return { ...message, reactions };
    }
    if (message.id !== change.messageId) return message;
    if (change.kind === "reaction_insert") {
      const reactions = applyReactionInsert(message.reactions, change.row);
      if (reactions === message.reactions) return message;
      changed = true;
      return { ...message, reactions };
    }
    const mediaViews = applyMediaView(message.mediaViews, change.row);
    if (mediaViews === message.mediaViews) return message;
    changed = true;
    return { ...message, mediaViews };
  });
  return changed ? next : messages;
}
