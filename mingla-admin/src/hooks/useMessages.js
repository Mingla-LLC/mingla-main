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
//
// #4423 (W1.1): the poll counts from the last refresh and "the page came back"
// is the shared lib/pageReturn signal; both go through lib/pollGate key
// "messages". Realtime changes keep their 600 ms debounce: the badge may read
// on each one, the inbox (team_inbox, the heavy call) at most once every
// INBOX_MIN_GAP_MS, with one trailing read so the last change is never lost.
//
// #4423 rework 1 (P2-1): a read that fails or is held back while numbers are
// on screen keeps them and sets `stale` (MessagesBody shows "may be out of
// date" with Try again). Refused by the ceiling pause: `paused` too, and one
// read just after the pause ends.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { canOpenPage } from "../lib/access";
import { getInbox } from "../services/dashboardService";
import { fetchBadge, setMyTimeZone } from "../services/teamChatService";
import { SUPPORT_ALERT_TYPES } from "../lib/emailAlerts";
import { createTimeZoneSync, deviceTimeZone, messagesAfterRefresh, messagesBadge } from "../lib/messagesModel";
import * as pageReturn from "../lib/pageReturn";
import { ceilingPaused, createPoller, tabPollGate, whenCeilingLifts } from "../lib/pollGate";

export const MESSAGES_POLL_MS = 30_000;
export const MESSAGES_CHANGED = "mingla:messages-changed";
export const INBOX_MIN_GAP_MS = 5_000;
const GATE_KEY = "messages";
const BADGE_GATE_KEY = "messages-badge";

const EMPTY = Object.freeze({ owner: null, badge: null, inbox: null, inboxError: null, badgeError: null, loading: true, stale: false, paused: false });

let state = EMPTY;
const listeners = new Set();
let consumers = 0;
let poller = null;
let channel = null;
let debounce = null;
let trailing = null;
let badgeSeq = 0;
let inboxSeq = 0;
let lastInboxAt = -Infinity;
let owner = null;
let cancelResume = null;

function emit(next) {
  state = next;
  for (const l of listeners) l();
}

/**
 * One count call: the team badge and (unless `inbox` is false) the inbox,
 * side by side. Resolves to { skipped } for the poller.
 */
export async function refreshMessages({ inbox = true, quiet = false } = {}) {
  if (!owner) return { skipped: true };
  const key = inbox ? GATE_KEY : BADGE_GATE_KEY;
  if (quiet) {
    const why = tabPollGate.why(key);
    if (why) {
      tabPollGate.allow(key);
      if (why !== "in_flight" && state.owner === owner && (state.badge || state.inbox)) emit({ ...state, stale: true, paused: state.paused || ceilingPaused() });
      return { skipped: true };
    }
  }
  const forUser = owner;
  const mineBadge = ++badgeSeq;
  const mineInbox = inbox ? ++inboxSeq : 0;
  if (inbox) lastInboxAt = Date.now();
  tabPollGate.start(key, { background: quiet });
  const [badge, box] = await Promise.allSettled([fetchBadge(), inbox ? getInbox(SUPPORT_ALERT_TYPES) : Promise.resolve(null)]);
  const failed = [badge, inbox ? box : null].find((r) => r && r.status === "rejected");
  tabPollGate.settle(key, failed ? { ok: false, status: failed.reason?.status, code: failed.reason?.code, error: failed.reason } : { ok: true }, { background: quiet });
  if (forUser !== owner) return { skipped: false };
  emit(messagesAfterRefresh(state, {
    owner: forUser,
    badge: mineBadge === badgeSeq ? badge : null,
    inbox: inbox && mineInbox === inboxSeq ? box : null,
    paused: !!failed && ceilingPaused(),
  }));
  if (failed && state.paused && !cancelResume) {
    cancelResume = whenCeilingLifts(() => { cancelResume = null; void refreshMessages(); });
  }
  return { skipped: false };
}

/** A realtime or local change: badge now, the inbox at most every INBOX_MIN_GAP_MS. */
function liveRefresh() {
  const wait = lastInboxAt + INBOX_MIN_GAP_MS - Date.now();
  if (wait <= 0) {
    void refreshMessages({ quiet: true });
    return;
  }
  void refreshMessages({ inbox: false, quiet: true });
  if (!trailing) {
    trailing = setTimeout(() => { trailing = null; liveRefresh(); }, wait);
  }
}

function soon() {
  clearTimeout(debounce);
  debounce = setTimeout(liveRefresh, 600);
}

function start() {
  poller = createPoller({ refresh: (options) => refreshMessages(options), intervalMs: MESSAGES_POLL_MS, pageReturn });
  poller.start();
  window.addEventListener(MESSAGES_CHANGED, soon);
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
  poller?.stop();
  poller = null;
  cancelResume?.();
  cancelResume = null;
  clearTimeout(debounce);
  clearTimeout(trailing);
  trailing = null;
  window.removeEventListener(MESSAGES_CHANGED, soon);
  if (channel) void supabase.removeChannel(channel);
  channel = null;
}

function setOwner(next) {
  if (next === owner) return;
  if (consumers > 0 && owner) stop();
  owner = next;
  badgeSeq += 1;
  inboxSeq += 1;
  lastInboxAt = -Infinity;
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
    stale: !!current.stale,
    paused: !!current.paused,
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
    // #4423: the shared page-return signal (one save per zone per person anyway).
    return pageReturn.subscribePageReturn(run);
  }, [userId]);
}
