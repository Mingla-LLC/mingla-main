// Issue #4255 (W4) — the one source of Messages numbers and notifications.
//
// One poll (every 30 s while the tab is visible, and on focus) plus realtime
// on the team chat tables feeds the Messages button's badge, the panel and
// the full page: however many of them are mounted, there is one timer and one
// channel. Each tick is one count call: team_badge (unread chats) and
// team_inbox (notifications For you), together. It never polls anything
// useReviewCount already polls (Work counts).
//
// The store belongs to one signed-in person: a different user (or signing
// out) clears it before anything is shown (Constitution rule 6).
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { canOpenPage } from "../lib/access";
import { getInbox } from "../services/dashboardService";
import { fetchBadge, setMyTimeZone } from "../services/teamChatService";
import { SUPPORT_ALERT_TYPES } from "../lib/emailAlerts";
import { createTimeZoneSync, deviceTimeZone, messagesBadge } from "../lib/messagesModel";

export const MESSAGES_POLL_MS = 30_000;
export const MESSAGES_CHANGED = "mingla:messages-changed";

const EMPTY = Object.freeze({ owner: null, badge: null, inbox: null, inboxError: null, badgeError: null, loading: true });

let state = EMPTY;
const listeners = new Set();
let consumers = 0;
let timer = null;
let channel = null;
let debounce = null;
let seq = 0;
let owner = null;

function emit(next) {
  state = next;
  for (const l of listeners) l();
}

/** One count call: the team badge and the inbox, side by side. */
export async function refreshMessages() {
  if (!owner) return;
  const mine = ++seq;
  const forUser = owner;
  const [badge, inbox] = await Promise.allSettled([fetchBadge(), getInbox(SUPPORT_ALERT_TYPES)]);
  if (mine !== seq || forUser !== owner) return;
  emit({
    owner: forUser,
    badge: badge.status === "fulfilled" ? badge.value : state.badge,
    badgeError: badge.status === "rejected" ? badge.reason : null,
    inbox: inbox.status === "fulfilled" ? inbox.value : state.inbox,
    inboxError: inbox.status === "rejected" ? inbox.reason : null,
    loading: false,
  });
}

function soon() {
  clearTimeout(debounce);
  debounce = setTimeout(() => { void refreshMessages(); }, 600);
}

function onVisible() {
  if (typeof document === "undefined" || document.visibilityState === "visible") void refreshMessages();
}

function start() {
  void refreshMessages();
  timer = setInterval(onVisible, MESSAGES_POLL_MS);
  window.addEventListener("focus", onVisible);
  window.addEventListener("online", onVisible);
  window.addEventListener(MESSAGES_CHANGED, soon);
  document.addEventListener("visibilitychange", onVisible);
  // Rows reach this browser only for chats this person may read (RLS).
  try {
    channel = supabase
      .channel(`admin-messages-${owner}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_messages" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_threads" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_thread_members" }, soon)
      .subscribe();
  } catch (error) {
    // The poll still runs; say why live updates are off.
    console.warn("[Messages] live updates are off:", error?.message || error);
    channel = null;
  }
}

function stop() {
  clearInterval(timer);
  clearTimeout(debounce);
  timer = null;
  window.removeEventListener("focus", onVisible);
  window.removeEventListener("online", onVisible);
  window.removeEventListener(MESSAGES_CHANGED, soon);
  document.removeEventListener("visibilitychange", onVisible);
  if (channel) void supabase.removeChannel(channel);
  channel = null;
}

function setOwner(next) {
  if (next === owner) return;
  if (consumers > 0 && owner) stop();
  owner = next;
  seq += 1;
  emit({ ...EMPTY, owner: next });
  if (consumers > 0 && owner) start();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tell every Messages view to read again (after a mark read, a post, a setting). */
export function announceMessagesChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MESSAGES_CHANGED));
}

export function useMessages() {
  const { access, session } = useAuth();
  const enabled = canOpenPage(access, "messages");
  const uid = enabled ? session?.user?.id || null : null;

  useEffect(() => {
    setOwner(uid);
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    consumers += 1;
    if (consumers === 1 && owner) start();
    return () => {
      consumers -= 1;
      if (consumers === 0) stop();
    };
  }, [uid]);

  const snap = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  const current = snap.owner === uid ? snap : EMPTY;
  const refetch = useCallback(() => refreshMessages(), []);
  return {
    enabled,
    userId: uid,
    badge: current.badge,
    inbox: current.inbox,
    inboxError: current.inboxError,
    badgeError: current.badgeError,
    loading: current.loading && !current.inbox,
    count: messagesBadge({ badge: current.badge, inbox: current.inbox }),
    refetch,
  };
}

// #4255 rework 2 (P1): save this browser's time zone on the teammate's profile
// when Admin loads for them and whenever the tab comes back, so quiet hours
// and the 09:00 due notice follow their own clock. One save per zone per
// person in this tab; the server writes only when empty or different.
export const syncTeamTimeZone = createTimeZoneSync((zone) => setMyTimeZone(zone));

export function useTeamTimeZoneSync(userId) {
  useEffect(() => {
    if (!userId) return undefined;
    const run = () => {
      syncTeamTimeZone(userId, deviceTimeZone()).catch((err) => {
        // Nothing for the person to do; quiet hours keep the last saved zone.
        console.warn("[#4255] could not save this browser's time zone:", err?.message || err);
      });
    };
    run();
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId]);
}
