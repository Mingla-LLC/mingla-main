/**
 * #4304 part 2 — the live layer of an open Brand group: reactions, seen-by
 * and typing.
 *
 * - Reactions: rows from direct_message_reactions for the loaded messages,
 *   kept current by realtime INSERT/DELETE (RLS limits deliveries to people
 *   who can read the group). Toggles are optimistic and roll back on error.
 * - Seen-by: the real read pointers (issue_4304_list_brand_group_read_state),
 *   refetched when a teammate announces a read on the conversation channel.
 * - Typing: realtime broadcast on the conversation channel. Nothing is stored.
 *
 * Every failure reaches `onError`, which the screen shows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "../services/supabase";
import {
  addBrandGroupReaction,
  listBrandGroupReactions,
  listBrandGroupReadState,
  removeBrandGroupReaction,
} from "../services/brandGroupLiveService";
import {
  brandGroupReactionToggle,
  summariseBrandGroupReactions,
  type BrandGroupReactionPill,
  type BrandGroupReactionRow,
  type BrandGroupReadState,
} from "../utils/brandGroupThreadModel";

const TYPING_TTL_MS = 6_000;
const TYPING_THROTTLE_MS = 2_500;

interface TypingPayload {
  user_id?: unknown;
  name?: unknown;
  stopped?: unknown;
}

export interface BrandGroupLive {
  reactionsByMessage: Map<string, BrandGroupReactionPill[]>;
  toggleReaction: (messageId: string, emoji: string) => void;
  reads: BrandGroupReadState[];
  typingNames: string[];
  notifyTyping: () => void;
  stopTyping: () => void;
  announceRead: () => void;
}

export function useBrandGroupLive(input: {
  conversationId: string | null;
  viewerId: string | null;
  viewerName: string;
  messageIds: readonly string[];
  onError: (message: string) => void;
}): BrandGroupLive {
  const { conversationId, viewerId, viewerName, messageIds, onError } = input;
  const [rows, setRows] = useState<BrandGroupReactionRow[]>([]);
  const [reads, setReads] = useState<BrandGroupReadState[]>([]);
  const [typing, setTyping] = useState<Map<string, { name: string; until: number }>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const idsKey = messageIds.join(",");
  const loadedIds = useRef<Set<string>>(new Set());
  loadedIds.current = useMemo(() => new Set(messageIds), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reactions for the loaded messages.
  useEffect(() => {
    if (!conversationId || messageIds.length === 0) {
      setRows([]);
      return;
    }
    let active = true;
    listBrandGroupReactions(messageIds)
      .then((next) => { if (active) setRows(next); })
      .catch((cause: unknown) => {
        if (active) onErrorRef.current(cause instanceof Error ? cause.message : "Couldn't load reactions");
      });
    return () => { active = false; };
  }, [conversationId, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshReads = useCallback(async (): Promise<void> => {
    if (!conversationId) return;
    try {
      setReads(await listBrandGroupReadState(conversationId));
    } catch (cause) {
      onErrorRef.current(cause instanceof Error ? cause.message : "Couldn't load who has seen this");
    }
  }, [conversationId]);

  // Read pointers move when messages arrive (the sender marks read) and when a
  // teammate announces a read.
  useEffect(() => {
    void refreshReads();
  }, [refreshReads, idsKey]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`brand-group-live:${conversationId}`)
      .on("broadcast", { event: "typing" }, (message: { payload?: TypingPayload }) => {
        const payload = message.payload ?? {};
        const userId = typeof payload.user_id === "string" ? payload.user_id : null;
        if (!userId || userId === viewerId) return;
        setTyping((current) => {
          const next = new Map(current);
          if (payload.stopped === true) next.delete(userId);
          else next.set(userId, {
            name: typeof payload.name === "string" && payload.name.trim() ? payload.name : "Someone",
            until: Date.now() + TYPING_TTL_MS,
          });
          return next;
        });
      })
      .on("broadcast", { event: "read" }, () => {
        void refreshReads();
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_message_reactions" },
        (change: { new?: Partial<BrandGroupReactionRow> }) => {
          const row = change.new;
          if (!row?.id || !row.message_id || !row.user_id || !row.emoji) return;
          if (!loadedIds.current.has(row.message_id)) return;
          const complete = row as BrandGroupReactionRow;
          setRows((current) => current.some((item) => item.id === complete.id) ? current : [...current, complete]);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "direct_message_reactions" },
        (change: { old?: { id?: string } }) => {
          const id = change.old?.id;
          if (id) setRows((current) => current.filter((item) => item.id !== id));
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, refreshReads, viewerId]);

  // Expire typing entries whose sender went quiet without a stop.
  useEffect(() => {
    if (typing.size === 0) return;
    const timer = setInterval(() => {
      setTyping((current) => {
        const now = Date.now();
        const next = new Map([...current].filter(([, entry]) => entry.until > now));
        return next.size === current.size ? current : next;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [typing.size]);

  const broadcast = useCallback((event: string, payload: Record<string, unknown>): void => {
    const channel = channelRef.current as { send?: (message: Record<string, unknown>) => unknown } | null;
    if (!channel || typeof channel.send !== "function") return;
    // Typing and read announcements are best-effort hints; the durable state
    // (messages, read pointers) is refetched on its own.
    void Promise.resolve(channel.send({ type: "broadcast", event, payload })).catch(() => undefined);
  }, []);

  const notifyTyping = useCallback((): void => {
    if (!viewerId) return;
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    broadcast("typing", { user_id: viewerId, name: viewerName });
  }, [broadcast, viewerId, viewerName]);

  const stopTyping = useCallback((): void => {
    if (!viewerId || lastTypingSent.current === 0) return;
    lastTypingSent.current = 0;
    broadcast("typing", { user_id: viewerId, stopped: true });
  }, [broadcast, viewerId]);

  const announceRead = useCallback((): void => {
    if (viewerId) broadcast("read", { user_id: viewerId });
  }, [broadcast, viewerId]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const toggleReaction = useCallback((messageId: string, emoji: string): void => {
    if (!viewerId) return;
    const decision = brandGroupReactionToggle(rowsRef.current, messageId, emoji, viewerId);
    if (decision.action === "remove") {
      const removed = rowsRef.current.find((row) => row.id === decision.rowId);
      setRows((current) => current.filter((row) => row.id !== decision.rowId));
      removeBrandGroupReaction(decision.rowId).catch((cause: unknown) => {
        if (removed) setRows((current) => current.some((row) => row.id === removed.id) ? current : [...current, removed]);
        onErrorRef.current(cause instanceof Error ? cause.message : "Couldn't remove the reaction");
      });
      return;
    }
    const tempId = `pending:${messageId}:${emoji}`;
    setRows((current) => [...current, { id: tempId, message_id: messageId, user_id: viewerId, emoji }]);
    addBrandGroupReaction({ messageId, userId: viewerId, emoji })
      .then((saved) => {
        setRows((current) => {
          const withoutTemp = current.filter((row) => row.id !== tempId);
          return withoutTemp.some((row) => row.id === saved.id) ? withoutTemp : [...withoutTemp, saved];
        });
      })
      .catch((cause: unknown) => {
        setRows((current) => current.filter((row) => row.id !== tempId));
        onErrorRef.current(cause instanceof Error ? cause.message : "Couldn't add the reaction");
      });
  }, [viewerId]);

  const reactionsByMessage = useMemo(() => summariseBrandGroupReactions(rows, viewerId), [rows, viewerId]);
  const typingNames = useMemo(() => [...typing.values()].map((entry) => entry.name), [typing]);

  return { reactionsByMessage, toggleReaction, reads, typingNames, notifyTyping, stopTyping, announceRead };
}
