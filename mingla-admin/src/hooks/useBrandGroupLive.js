// Issue #4270 (Wave 7) — the live layer of an open Brand group in Admin: a
// port of #4304's useBrandGroupLive (mingla-business), on the same channel,
// tables and RPC, so staff and hosts see each other.
//
//   * Reactions: rows from direct_message_reactions for the loaded messages,
//     kept current by realtime INSERT/DELETE (the #4304 policies limit them
//     to people who can read the group). Toggles are optimistic and roll back
//     on error, which reaches onError (the panel's toast).
//   * Seen by: issue_4304_list_brand_group_read_state, refetched when the
//     loaded messages change and when a teammate announces a read.
//   * Typing: realtime broadcast `typing` on brand-group-live:<conversation>,
//     payload { user_id, name, stopped? }; nothing is stored. Each entry
//     expires 6 s after its last ping.
//   * announceRead: broadcast `read` after this person marked the group read.
//
// The data calls come in as `api` (the panel passes communityService's), so
// the tab's capability contract lists them where the panel reaches them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { reactionToggle, summariseReactions } from "../lib/brandGroupInbox";

export const TYPING_TTL_MS = 6_000;
export const TYPING_THROTTLE_MS = 2_500;

/** A typing payload as something safe to show, or null (spoofed or empty). */
export function typingEntry(payload, viewerId, now = Date.now()) {
  const p = payload && typeof payload === "object" ? payload : {};
  const userId = typeof p.user_id === "string" && p.user_id.length <= 64 ? p.user_id : null;
  if (!userId || userId === viewerId) return null;
  if (p.stopped === true) return { userId, stopped: true };
  const raw = typeof p.name === "string" ? p.name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return { userId, stopped: false, name: raw || "Someone", until: now + TYPING_TTL_MS };
}

export function useBrandGroupLive({ conversationId, viewerId, viewerName, messageIds, onError, api }) {
  const [rows, setRows] = useState([]);
  const [reads, setReads] = useState([]);
  const [typing, setTyping] = useState(() => new Map());
  const channelRef = useRef(null);
  const lastTypingSent = useRef(0);
  const onErrorRef = useRef(onError);
  const apiRef = useRef(api);
  useEffect(() => {
    onErrorRef.current = onError;
    apiRef.current = api;
  });
  const ids = Array.isArray(messageIds) ? messageIds : [];
  const idsKey = ids.join(",");
  const loadedIds = useRef(new Set());
  useEffect(() => {
    loadedIds.current = new Set(idsKey ? idsKey.split(",") : []);
  }, [idsKey]);

  // Reactions for the loaded messages.
  useEffect(() => {
    if (!conversationId || !idsKey) {
      setRows([]);
      return undefined;
    }
    let active = true;
    apiRef.current.listReactions(idsKey.split(","))
      .then((next) => { if (active) setRows(next); })
      .catch((cause) => { if (active) onErrorRef.current?.(cause?.message || "Couldn't load reactions"); });
    return () => { active = false; };
  }, [conversationId, idsKey]);

  const refreshReads = useCallback(async () => {
    if (!conversationId) return;
    try {
      const next = await apiRef.current.listReadState(conversationId);
      setReads(Array.isArray(next) ? next : []);
    } catch (cause) {
      onErrorRef.current?.(cause?.message || "Couldn't load who has seen this");
    }
  }, [conversationId]);

  useEffect(() => {
    setReads([]);
    setTyping(new Map());
  }, [conversationId]);

  useEffect(() => { void refreshReads(); }, [refreshReads, idsKey]);

  useEffect(() => {
    if (!conversationId) return undefined;
    const channel = supabase
      .channel(`brand-group-live:${conversationId}`)
      .on("broadcast", { event: "typing" }, (message) => {
        const entry = typingEntry(message?.payload, viewerId);
        if (!entry) return;
        setTyping((current) => {
          const next = new Map(current);
          if (entry.stopped) next.delete(entry.userId);
          else next.set(entry.userId, { name: entry.name, until: entry.until });
          return next;
        });
      })
      .on("broadcast", { event: "read" }, () => { void refreshReads(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_message_reactions" }, (change) => {
        const row = change?.new;
        if (!row?.id || !row.message_id || !row.user_id || !row.emoji) return;
        if (!loadedIds.current.has(row.message_id)) return;
        setRows((current) => (current.some((item) => item.id === row.id) ? current : [...current, row]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "direct_message_reactions" }, (change) => {
        const id = change?.old?.id;
        if (id) setRows((current) => current.filter((item) => item.id !== id));
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, refreshReads, viewerId]);

  // Expire typing entries whose sender went quiet without a stop.
  useEffect(() => {
    if (typing.size === 0) return undefined;
    const timer = setInterval(() => {
      setTyping((current) => {
        const now = Date.now();
        const next = new Map([...current].filter(([, entry]) => entry.until > now));
        return next.size === current.size ? current : next;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [typing.size]);

  const broadcast = useCallback((event, payload) => {
    const channel = channelRef.current;
    if (!channel || typeof channel.send !== "function") return;
    // Typing and read announcements are hints; the durable state (messages,
    // read pointers) is read again on its own, so a dropped hint is harmless.
    void Promise.resolve(channel.send({ type: "broadcast", event, payload })).catch(() => undefined);
  }, []);

  const notifyTyping = useCallback(() => {
    if (!viewerId) return;
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    broadcast("typing", { user_id: viewerId, name: viewerName });
  }, [broadcast, viewerId, viewerName]);

  const stopTyping = useCallback(() => {
    if (!viewerId || lastTypingSent.current === 0) return;
    lastTypingSent.current = 0;
    broadcast("typing", { user_id: viewerId, stopped: true });
  }, [broadcast, viewerId]);

  const announceRead = useCallback(() => {
    if (viewerId) broadcast("read", { user_id: viewerId });
  }, [broadcast, viewerId]);

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const toggleReaction = useCallback((messageId, emoji) => {
    if (!viewerId) return;
    const decision = reactionToggle(rowsRef.current, messageId, emoji, viewerId);
    if (decision.action === "remove") {
      const removed = rowsRef.current.find((row) => row.id === decision.rowId);
      setRows((current) => current.filter((row) => row.id !== decision.rowId));
      apiRef.current.removeReaction(decision.rowId).catch((cause) => {
        if (removed) setRows((current) => (current.some((row) => row.id === removed.id) ? current : [...current, removed]));
        onErrorRef.current?.(cause?.message || "Couldn't remove the reaction");
      });
      return;
    }
    const tempId = `pending:${messageId}:${emoji}`;
    setRows((current) => [...current, { id: tempId, message_id: messageId, user_id: viewerId, emoji }]);
    apiRef.current.addReaction({ messageId, userId: viewerId, emoji })
      .then((saved) => {
        setRows((current) => {
          const withoutTemp = current.filter((row) => row.id !== tempId);
          return withoutTemp.some((row) => row.id === saved.id) ? withoutTemp : [...withoutTemp, saved];
        });
      })
      .catch((cause) => {
        setRows((current) => current.filter((row) => row.id !== tempId));
        // A staff account with no Mingla profile row cannot react (the
        // reaction's person must be a profile).
        onErrorRef.current?.(/foreign key/i.test(String(cause?.message || ""))
          ? "Your staff account has no Mingla profile yet, so it can't react."
          : cause?.message || "Couldn't add the reaction");
      });
  }, [viewerId]);

  const reactionsByMessage = useMemo(() => summariseReactions(rows, viewerId), [rows, viewerId]);
  const typingNames = useMemo(() => [...typing.values()].map((entry) => entry.name), [typing]);
  return { reactionsByMessage, toggleReaction, reads, refreshReads, typingNames, notifyTyping, stopTyping, announceRead };
}
