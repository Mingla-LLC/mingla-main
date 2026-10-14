/**
 * MY AGENT PAGE (#/agent) — connect your own Claude or Codex to Mingla
 * (issue #3802, Wave 4).
 *
 * A person copies one setup message per agent here and pastes it into that
 * agent; the agent connects itself. The message holds a one-time code and
 * never a key. It lives in this tab's memory only: it is never written to
 * browser storage, an address or a cookie, and it is gone on Done, once it
 * is used, when it runs out, on reload and on leaving the page.
 *
 * The hand-typed way stays under Advanced: a key is created and shown once,
 * in memory only, and hidden by itself after 10 minutes.
 *
 * A connected agent reads and writes. The page says what it can do, what it
 * cannot, and what arrives next; it never offers something the connector
 * cannot do yet.
 *
 * This file never talks to the database itself: it reads through
 * hooks/useAgentKeys.js and writes through services/teamAgentService.js.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { useOnline } from "../hooks/useCrmPipeline";
import { useAgentKeys } from "../hooks/useAgentKeys";
import { createKey, createSetupCode, revokeKey } from "../services/teamAgentService";
import { AgentSetupCard } from "../components/agent/AgentSetupCard";
import { AgentAdvanced } from "../components/agent/AgentAdvanced";
import { DISCLOSURE_CLASS } from "../components/agent/AgentConnectSteps";
import { Segmented } from "../components/crm/fields";
import { AgentTeamList } from "../components/agent/AgentTeamList";
import {
  AGENTS,
  AGENT_GUARDRAILS,
  AGENT_NOT_YET,
  AGENT_OFFLINE_WORDS,
  COPY_WAIT_MS,
  KEY_HIDDEN_AFTER_WORDS,
  NOT_WORKING_CHECKS,
  OS_OPTIONS,
  SETUP_FIRST_USE_WATCH_MS,
  SETUP_GRACE_MS,
  SHOWN_KEY_MAX_MS,
  abilitiesFor,
  activeKey,
  agentEndpoint,
  agentErrorWords,
  agentLabel,
  agentLoadErrorWords,
  agentStatus,
  REPLACED_ELSEWHERE_WORDS,
  browserTimeZone,
  createOutcome,
  lastStoppedKey,
  overviewRows,
  createWatch,
  keysToHide,
  pendingSetup,
  setupCardView,
  setupMessage,
  setupVerdict,
  shownKeyVerdict,
} from "../lib/agentConnect";

/** While a key or a setup message is on screen the page checks this often. */
const WATCH_EVERY_MS = 5_000;
/** How long a create waits for its answer before the page stops waiting. */
const CREATE_WAIT_MS = 20_000;

/**
 * Repeats a check while something is on screen: every `everyMs`, only while
 * this tab is visible and the browser is online, until the clock reads
 * `until`, then `onEnd` once. A hidden tab makes no request; when it is shown
 * again the page's own refresh reads once and this starts ticking again.
 * `until` is a time on the clock, so drawing the page again never starts the
 * count again; only a different `until` does.
 */
function useWatch(active, onTick, { everyMs = WATCH_EVERY_MS, until, onEnd } = {}) {
  const tick = useRef(onTick);
  const end = useRef(onEnd);
  useEffect(() => {
    tick.current = onTick;
    end.current = onEnd;
  });
  useEffect(() => {
    if (!active) return undefined;
    const watch = createWatch({
      onTick: () => tick.current?.(),
      onEnd: () => end.current?.(),
      everyMs,
      until,
      isVisible: () => document.visibilityState === "visible",
      isOnline: () => navigator.onLine !== false,
    });
    const onVisibility = () => {
      // Shown again: hooks/useAgentKeys.js makes the one read of that moment;
      // this only starts the timer again.
      if (document.visibilityState === "visible") watch.visible(false);
      else watch.hidden();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      watch.stop();
    };
  }, [active, everyMs, until]);
}

/** The first of these that answers; `ms` later, `otherwise`. Never waits for ever. */
function within(promise, ms, otherwise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(otherwise), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Copy text when the browser's own way is missing or refused: select what is
 * on screen and ask the older way. True only if the browser says it copied.
 */
function copySelected(node) {
  try {
    if (!node || typeof window.getSelection !== "function") return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return typeof document.execCommand === "function" && document.execCommand("copy") === true;
  } catch {
    return false;
  }
}

const ENDPOINT = agentEndpoint(import.meta.env.VITE_SUPABASE_URL);

function StepHeading({ n, children }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-brand-500)]">Step {n}</span>
      <span>{children}</span>
    </span>
  );
}

function LoadingSteps() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your agent settings">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-5">
          <Skeleton width="30%" height={16} />
          <div className="mt-3">
            <Skeleton width="100%" height={44} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentPage() {
  const { addToast } = useToast();
  const { access } = useAuth();
  const online = useOnline();
  const { keys, setup, idleDays, guide, overview, isOwner, loading, error, refetch, latest } = useAgentKeys();

  // The key just created, per agent. In memory only; never stored, never
  // logged, never sent to another tab. Leaving the page drops it.
  const [fresh, setFresh] = useState({});
  // Which key that is, per agent: { keyId, listed, shownAt }. An id is not a
  // secret; it lets the page notice when the key on screen has been ended
  // elsewhere, and `shownAt` is when THAT key was shown.
  const [shownIds, setShownIds] = useState({});
  const [busy, setBusy] = useState({});
  const [problem, setProblem] = useState({});
  // A plain sentence that stays on the card (a key hidden because it was
  // replaced elsewhere; a key that was made but could not be shown).
  const [notice, setNotice] = useState({});
  // The agents whose new key could not be shown: the button says "Replace again".
  const [unseen, setUnseen] = useState({});
  const keysRef = useRef(keys);
  const [busyKeyId, setBusyKeyId] = useState(null);
  const [tab, setTab] = useState("claude");
  const [os, setOs] = useState(() =>
    typeof navigator !== "undefined" && /win/i.test(navigator.platform || "") ? "windows" : "mac"
  );
  const busyRef = useRef({});
  // One-message setup, per agent. `setups` says where each card is
  // ({ phase, id, expiresAt, tries, keyId, usedAt, words }); `codes` holds the
  // one-time code while its message is on screen. Both are this tab's memory
  // only. The message is built from the code for the computer chosen above,
  // so the text on screen always matches the toggle.
  const [setups, setSetups] = useState({});
  const [codes, setCodes] = useState({});
  const [setupBusy, setSetupBusy] = useState({});
  const setupBusyRef = useRef({});
  const setupsRef = useRef({});
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mark = (agentId, on) => {
    busyRef.current = { ...busyRef.current, [agentId]: on };
    setBusy(busyRef.current);
  };

  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

  // A key shown here stays only while it is still this person's active key
  // for that agent. Replaced or disconnected anywhere (another tab, another
  // computer, the owner), it is hidden at the next read and the card says so.
  // The page reads again whenever its window or tab is looked at again, when
  // the browser comes back online, and every 30 seconds while it is visible.
  useEffect(() => {
    if (loading || error) return;
    for (const a of AGENTS) {
      const verdict = shownKeyVerdict(keys, shownIds[a.id]);
      if (verdict === "listed") {
        setShownIds((m) => (m[a.id] ? { ...m, [a.id]: { ...m[a.id], listed: true } } : m));
      } else if (verdict === "hide") {
        setFresh((f) => ({ ...f, [a.id]: null }));
        setShownIds((m) => ({ ...m, [a.id]: null }));
        setNotice((n) => ({ ...n, [a.id]: REPLACED_ELSEWHERE_WORDS }));
      }
    }
  }, [keys, shownIds, loading, error]);

  useEffect(() => {
    setupsRef.current = setups;
  }, [setups]);
  const shownRef = useRef({});
  useEffect(() => {
    shownRef.current = shownIds;
  }, [shownIds]);

  // While a key is on screen (Advanced), read again every few seconds so a
  // key ended in another tab or window does not stay here; and never leave a
  // key on screen with nothing checking it: each is hidden ten minutes after
  // IT was shown.
  const hideOldKeys = useCallback((at) => {
    const old = keysToHide(shownRef.current, at);
    if (old.length === 0) return;
    const cleared = Object.fromEntries(old.map((id) => [id, null]));
    shownRef.current = { ...shownRef.current, ...cleared };
    setFresh((f) => ({ ...f, ...cleared }));
    setShownIds((m) => ({ ...m, ...cleared }));
    setNotice((n) => ({ ...n, ...Object.fromEntries(old.map((id) => [id, KEY_HIDDEN_AFTER_WORDS])) }));
  }, []);
  const showingKey = AGENTS.some((a) => !!shownIds[a.id]);
  const lastShownAt = Math.max(0, ...AGENTS.map((a) => shownIds[a.id]?.shownAt || 0));
  useWatch(showingKey, () => {
    hideOldKeys(Date.now());
    refetch({ quiet: true });
  }, {
    until: lastShownAt + SHOWN_KEY_MAX_MS,
    onEnd: () => hideOldKeys(Date.now() + 1),
  });
  // A tab that was in the background reads when it is shown again: hide then too.
  useEffect(() => {
    hideOldKeys(Date.now());
  }, [keys, hideOldKeys]);

  // While a setup message waits for an agent, read again every few seconds
  // until it is used, ended or its time (plus a moment) has run out; and once
  // it is used, until the key it made is used for the first time.
  const settle = useCallback((list, keyList, at) => {
    for (const a of AGENTS) {
      const st = setupsRef.current[a.id];
      if (!st) continue;
      if (st.phase === "ready" || st.phase === "blocked") {
        const result = setupVerdict({ setup: list, id: st.id, agentId: a.id, expiresAt: st.expiresAt, now: at });
        if (result.verdict === "wait") continue;
        setCodes((m) => ({ ...m, [a.id]: null }));
        setSetups((m) => ({
          ...m,
          [a.id]: result.verdict === "used" ? { phase: "used", keyId: result.keyId, usedAt: result.usedAt || new Date(at).toISOString() } : { phase: result.verdict },
        }));
        if (result.verdict === "used") {
          addToast({ variant: "success", title: `A key was made for ${a.product}`, description: `Your agent should have printed "Mingla added to ${a.product}." Restart it, then ask: What is on my plate in Mingla?` });
        }
      } else if (st.phase === "used" && !st.connectedSaid) {
        const key = activeKey(keyList, a.id);
        if (key && key.key_id === st.keyId && key.last_used_at) {
          setSetups((m) => (m[a.id]?.phase === "used" ? { ...m, [a.id]: { ...m[a.id], connectedSaid: true } } : m));
          addToast({ variant: "success", title: `${a.product} is connected`, description: "It has used its key." });
        }
      }
    }
  }, [addToast]);
  useEffect(() => {
    if (!loading && !error) settle(setup, keys, Date.now());
  }, [keys, setup, loading, error, settle]);
  const watched = AGENTS.map((a) => {
    const st = setups[a.id];
    if (st?.phase === "ready" || st?.phase === "blocked") return (Date.parse(st.expiresAt) || 0) + SETUP_GRACE_MS;
    if (st?.phase === "used" && !st.connectedSaid) return (Date.parse(st.usedAt) || 0) + SETUP_FIRST_USE_WATCH_MS;
    // A message copied in another tab and still waiting: what becomes of it
    // shows here too, without waiting for the half-minute refresh.
    const elsewhere = st ? null : pendingSetup(setup, a.id, now);
    if (elsewhere) return (Date.parse(elsewhere.expires_at) || 0) + SETUP_GRACE_MS;
    return 0;
  });
  const watchUntil = Math.max(0, ...watched);
  useWatch(watchUntil > 0, () => {
    setNow(Date.now());
    refetch({ quiet: true });
  }, {
    until: watchUntil,
    onEnd: async () => {
      await refetch({ quiet: true });
      if (!mountedRef.current) return;
      setNow(Date.now());
      settle(latest.current.setup, latest.current.keys, Date.now() + 1);
    },
  });

  const markSetup = (agentId, on) => {
    setupBusyRef.current = { ...setupBusyRef.current, [agentId]: on };
    setSetupBusy(setupBusyRef.current);
  };

  // Copy setup message. The clipboard write belongs to this press: it is
  // handed a promise of the message, so the copy still counts as the
  // person's own action although the code is fetched first.
  const copySetup = useCallback(
    async (agentId) => {
      // A second press while the first is on its way sends nothing.
      if (setupBusyRef.current[agentId]) return;
      if (!online) {
        addToast({ variant: "warning", title: "You're offline", description: "No setup message was made. Try again once you're back." });
        return;
      }
      const current = activeKey(keysRef.current, agentId);
      const phase = setupsRef.current[agentId]?.phase;
      // Already connected: say what a new message does before making one.
      if (current && phase !== "confirm") {
        setSetups((m) => ({ ...m, [agentId]: { phase: "confirm" } }));
        return;
      }
      markSetup(agentId, true);
      setCodes((m) => ({ ...m, [agentId]: null }));
      setSetups((m) => ({ ...m, [agentId]: { phase: "asking" } }));
      let timer;
      const asked = Promise.race([
        createSetupCode(agentId, browserTimeZone()),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject({ token: "no_answer", message: "" }), CREATE_WAIT_MS);
        }),
      ]);
      const text = asked.then((answer) => {
        const built = setupMessage({ agent: agentId, os, endpoint: ENDPOINT, code: answer?.code });
        if (!built) throw new Error("no message could be built");
        return built;
      });
      text.catch(() => {});
      let copied = Promise.resolve(false);
      try {
        if (navigator.clipboard?.write && typeof ClipboardItem === "function") {
          copied = navigator.clipboard
            .write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })])
            .then(() => true, () => false);
        }
      } catch {
        copied = Promise.resolve(false);
      }
      try {
        const answer = await asked;
        await text;
        // The browser is given a moment to say whether it copied. One that
        // never answers counts as not copied: the card can never wait for ever.
        const ok = await within(copied, COPY_WAIT_MS, false);
        if (!mountedRef.current) return;
        setCodes((m) => ({ ...m, [agentId]: answer.code }));
        setSetups((m) => ({
          ...m,
          [agentId]: { phase: ok ? "ready" : "blocked", id: answer.id || null, expiresAt: answer.expires_at, tries: 0, copiedOs: ok ? os : null },
        }));
        setNow(Date.now());
      } catch (err) {
        if (!mountedRef.current) return;
        console.error("[agent] setup message failed:", err?.token || err?.name || "error");
        setSetups((m) => ({
          ...m,
          [agentId]: err?.token === "no_answer" ? { phase: "lost" } : { phase: "failed", words: agentErrorWords(err) },
        }));
        refetch({ quiet: true });
      } finally {
        clearTimeout(timer);
        if (mountedRef.current) markSetup(agentId, false);
      }
    },
    [addToast, online, os, refetch]
  );

  // The message on screen for an agent: built from its code for the computer
  // chosen now, so switching the toggle swaps the text and never the code.
  const messageFor = useCallback(
    (agentId) => (codes[agentId] ? setupMessage({ agent: agentId, os, endpoint: ENDPOINT, code: codes[agentId] }) : null),
    [codes, os]
  );

  // Copy again (or Copy message, when the browser blocked the first copy).
  // A press always shows something: "Copied", or a line that counts the try
  // with the message selected for Ctrl or Cmd + C.
  const [againBusy, setAgainBusy] = useState({});
  const againBusyRef = useRef({});
  const copySetupAgain = useCallback(
    async (agentId, node) => {
      const message = messageFor(agentId);
      if (!message) return;
      // A press while the browser is still being asked does nothing.
      if (againBusyRef.current[agentId]) return;
      againBusyRef.current = { ...againBusyRef.current, [agentId]: true };
      setAgainBusy(againBusyRef.current);
      let ok = false;
      try {
        if (navigator.clipboard?.writeText) ok = await within(navigator.clipboard.writeText(message).then(() => true, () => false), COPY_WAIT_MS, false);
      } catch (err) {
        console.error("[agent] copy was blocked:", err?.name || "error");
      }
      if (!ok) ok = copySelected(node);
      againBusyRef.current = { ...againBusyRef.current, [agentId]: false };
      if (!mountedRef.current) return;
      setAgainBusy(againBusyRef.current);
      setSetups((m) =>
        m[agentId]
          ? {
            ...m,
            [agentId]: {
              ...m[agentId],
              phase: ok ? "ready" : "blocked",
              tries: ok ? 0 : (m[agentId].tries || 0) + 1,
              copiedOs: ok ? os : m[agentId].copiedOs,
            },
          }
          : m
      );
      if (ok) addToast({ variant: "success", title: "Copied", description: "Paste it into your agent as your next message." });
    },
    [addToast, messageFor, os]
  );

  // Done returns the card to what a reload would show: the start, or a
  // message still waiting elsewhere if the server says one is. It is read
  // again at once, so a message used or ended in another tab is not shown.
  const doneSetup = useCallback(
    (agentId) => {
      setCodes((m) => ({ ...m, [agentId]: null }));
      setSetups((m) => ({ ...m, [agentId]: null }));
      refetch({ quiet: true });
    },
    [refetch]
  );

  const create = useCallback(
    async (agentId) => {
      // A second press while the first is on its way sends nothing.
      if (busyRef.current[agentId]) return;
      const label = agentLabel(agentId);
      if (!online) {
        addToast({ variant: "warning", title: "You're offline", description: "No key was created. Try again once you're back." });
        return;
      }
      // The key this person had for the agent before asking (or none).
      const before = activeKey(keysRef.current, agentId)?.key_id || null;
      mark(agentId, true);
      setProblem((p) => ({ ...p, [agentId]: "" }));
      setNotice((n) => ({ ...n, [agentId]: "" }));
      let timer;
      try {
        const made = await Promise.race([
          createKey(agentId, browserTimeZone()),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject({ token: "network", message: "" }), CREATE_WAIT_MS);
          }),
        ]);
        if (!mountedRef.current) return;
        if (typeof made?.key !== "string" || made.key === "") throw new Error("no key in the answer");
        setFresh((f) => ({ ...f, [agentId]: made.key }));
        setShownIds((m) => ({ ...m, [agentId]: { keyId: made.key_id, listed: false, shownAt: Date.now() } }));
        // A setup message that is still waiting stays as it is: what became of
        // it is read from the server by its own id, so a key made by hand is
        // never taken for the message having been used.
        setUnseen((u) => ({ ...u, [agentId]: false }));
        setTab(agentId);
        addToast({
          variant: "success",
          title: made.replaced ? `Your ${label} key was replaced` : `Your ${label} key is ready`,
          description: made.replaced
            ? "The old key has stopped working. Copy the new one now: it is shown once."
            : "Copy it now: it is shown once.",
        });
        await refetch({ quiet: true });
      } catch (err) {
        if (!mountedRef.current) return;
        console.error("[agent] create failed:", err?.token || err?.name || "error");
        const words = agentErrorWords(err);
        // No answer is not the same as "nothing happened": the server may
        // have made the key (ending the old one) before the answer was lost.
        // Read what it holds now, and say that.
        const now = await refetch({ quiet: true });
        if (!mountedRef.current) return;
        const after = Array.isArray(now) ? activeKey(now, agentId)?.key_id || null : undefined;
        const outcome = createOutcome({ before, after, label, words });
        setProblem((p) => ({ ...p, [agentId]: outcome.problem }));
        setNotice((n) => ({ ...n, [agentId]: outcome.notice }));
        setUnseen((u) => ({ ...u, [agentId]: outcome.replaceAgain }));
        addToast({ variant: outcome.toastVariant, title: outcome.toastTitle, description: outcome.toastWords });
      } finally {
        clearTimeout(timer);
        if (mountedRef.current) mark(agentId, false);
      }
    },
    [addToast, online, refetch]
  );

  const revoke = useCallback(
    async (keyId, agentId) => {
      if (busyRef.current[agentId]) return;
      const label = agentLabel(agentId);
      if (!online) {
        addToast({ variant: "warning", title: "You're offline", description: "Nothing was changed. Try again once you're back." });
        return;
      }
      mark(agentId, true);
      setProblem((p) => ({ ...p, [agentId]: "" }));
      try {
        await revokeKey(keyId);
        if (!mountedRef.current) return;
        setFresh((f) => ({ ...f, [agentId]: null }));
        setShownIds((m) => ({ ...m, [agentId]: null }));
        setNotice((n) => ({ ...n, [agentId]: "" }));
        setUnseen((u) => ({ ...u, [agentId]: false }));
        setCodes((m) => ({ ...m, [agentId]: null }));
        setSetups((m) => ({ ...m, [agentId]: null }));
        addToast({
          variant: "success",
          title: `${label} is disconnected`,
          description: "Its key stopped working. Copy a new setup message whenever you want it back.",
        });
        await refetch({ quiet: true });
      } catch (err) {
        if (!mountedRef.current) return;
        console.error("[agent] disconnect failed:", err?.token || err?.name || "error");
        const words = agentErrorWords(err);
        setProblem((p) => ({ ...p, [agentId]: `${label} is still connected. ${words}` }));
        addToast({ variant: "error", title: `Couldn't disconnect ${label}`, description: words });
        await refetch({ quiet: true });
      } finally {
        if (mountedRef.current) mark(agentId, false);
      }
    },
    [addToast, online, refetch]
  );

  const disconnectFor = useCallback(
    async (keyId, name, label) => {
      if (busyKeyId) return;
      if (!online) {
        addToast({ variant: "warning", title: "You're offline", description: "Nothing was changed. Try again once you're back." });
        return;
      }
      setBusyKeyId(keyId);
      try {
        await revokeKey(keyId);
        if (!mountedRef.current) return;
        addToast({ variant: "success", title: `${name}'s ${label} is disconnected`, description: "Its key stopped working. They can create a new one." });
      } catch (err) {
        if (!mountedRef.current) return;
        console.error("[agent] owner disconnect failed:", err?.token || err?.name || "error");
        addToast({ variant: "error", title: `Couldn't disconnect ${name}'s ${label}`, description: agentErrorWords(err) });
      } finally {
        if (mountedRef.current) {
          setBusyKeyId(null);
          refetch({ quiet: true });
        }
      }
    },
    [addToast, busyKeyId, online, refetch]
  );

  const done = useCallback((agentId) => {
    setFresh((f) => ({ ...f, [agentId]: null }));
  }, []);
  // Done also forgets which key was on screen: nothing is left to hide.
  const doneAndForget = useCallback(
    (agentId) => {
      done(agentId);
      setShownIds((m) => ({ ...m, [agentId]: null }));
    },
    [done]
  );

  const disconnectAgent = useCallback(
    (agentId) => {
      const key = activeKey(keysRef.current, agentId);
      if (key) revoke(key.key_id, agentId);
    },
    [revoke]
  );
  const keyCardProps = (a) => ({
    activeKey: activeKey(keys, a.id),
    stoppedKey: lastStoppedKey(keys, a.id),
    freshKey: fresh[a.id] || null,
    idleDays,
    busy: !!busy[a.id],
    offline: !online,
    problem: problem[a.id] || "",
    notice: notice[a.id] || "",
    replaceAgain: !!unseen[a.id],
    onCreate: create,
    onRevoke: revoke,
    onDone: doneAndForget,
  });

  const abilities = useMemo(() => abilitiesFor(access?.role), [access?.role]);
  const teamRows = useMemo(() => overviewRows(overview), [overview]);
  const connected = AGENTS.filter((a) => agentStatus(activeKey(keys, a.id), a.id).state === "connected");
  const statusLine = typeof guide?.guide?.status === "string" ? guide.guide.status : "";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold text-[var(--color-text-primary)]">My agent</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
            Connect your own Claude or Codex. It works under your name, with your role and nothing more. It can read and
            update your pipelines and log what happened; it never deletes, and a follow-up or an answer is always yours
            to send.
          </p>
        </div>
        {!loading && !error && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {connected.length === 0 ? (
              <Badge>No agent connected yet</Badge>
            ) : (
              connected.map((a) => (
                <Badge key={a.id} variant="success" dot>
                  Connected: {a.label}
                </Badge>
              ))
            )}
          </div>
        )}
      </div>

      {!online && <AlertCard variant="warning">{AGENT_OFFLINE_WORDS}</AlertCard>}

      {loading ? (
        <LoadingSteps />
      ) : error ? (
        <AlertCard
          variant="error"
          title="Couldn't load your agent settings"
          action={
            <Button type="button" variant="secondary" onClick={() => refetch()} className="max-sm:h-11">
              Try again
            </Button>
          }
        >
          {agentLoadErrorWords(error)}
        </AlertCard>
      ) : (
        <>
          <SectionCard
            title={<StepHeading n={1}>Copy your setup message</StepHeading>}
            subtitle="One per agent. Works once, for 10 minutes."
          >
            <div className="mb-4 min-w-0">
              <Segmented label="Your computer" options={OS_OPTIONS} value={os} onChange={setOs} />
              {os === "windows" && (
                <AlertCard variant="warning" title="Not tested on Windows" className="mt-3">
                  The Windows message was not run on Windows here. If your agent runs commands in Git Bash (Claude
                  Code&apos;s default on Windows), choose macOS or Linux instead: that message works there. If the Windows
                  one is refused, tell an admin what happened.
                </AlertCard>
              )}
              {!ENDPOINT && (
                <AlertCard variant="error" title="The connector's address isn't set up" className="mt-3">
                  This copy of Mingla Admin doesn&apos;t know its server address, so a setup message can&apos;t be built. Tell
                  an admin.
                </AlertCard>
              )}
            </div>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {AGENTS.map((a) => (
                <AgentSetupCard
                  key={a.id}
                  agent={a}
                  view={setupCardView({
                    agentId: a.id,
                    activeKey: activeKey(keys, a.id),
                    stoppedKey: lastStoppedKey(keys, a.id),
                    local: setups[a.id] || null,
                    pending: pendingSetup(setup, a.id, now),
                    offline: !online || !ENDPOINT,
                    idleDays,
                    now,
                    os,
                  })}
                  message={messageFor(a.id)}
                  busy={!!setupBusy[a.id] || !!busy[a.id]}
                  againBusy={!!againBusy[a.id]}
                  onCopy={copySetup}
                  onCopyAgain={copySetupAgain}
                  onDone={doneSetup}
                  onKeep={doneSetup}
                  onDisconnect={disconnectAgent}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard title={<StepHeading n={2}>Paste it into your agent</StepHeading>}>
            <p className="max-w-2xl text-sm text-[var(--color-text-secondary)]">
              Open Claude Code (or Codex) on your own computer, paste the message as your next message, and let it run the
              one command it contains. If it asks permission to run a command or to use the network, say yes: the message
              explains each part.
            </p>
          </SectionCard>

          <SectionCard title={<StepHeading n={3}>Restart your agent, then just ask</StepHeading>}>
            <p className="max-w-2xl text-sm text-[var(--color-text-secondary)]">
              Close and reopen your agent so it sees Mingla. Then ask:{" "}
              <span className="font-medium text-[var(--color-text-primary)]">What is on my plate in Mingla?</span>
            </p>
            {statusLine && <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">{statusLine}</p>}
            <details className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              <summary className={DISCLOSURE_CLASS}>Not working?</summary>
              <ul className="list-disc space-y-1 pl-5">
                {NOT_WORKING_CHECKS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          </SectionCard>

          <AgentAdvanced
            agents={AGENTS}
            cardProps={keyCardProps}
            tab={tab}
            onTab={setTab}
            os={os}
            onOs={setOs}
            endpoint={ENDPOINT}
            idleDays={idleDays}
          />

          <div className="grid min-w-0 gap-6 lg:grid-cols-2">
            <SectionCard title="What it can do now" noPadding>
              <ul className="divide-y divide-[var(--gray-200)]">
                {abilities.flatMap((g) =>
                  g.items.map((item) => (
                    <li key={item.tool} className="min-w-0 px-4 py-3 sm:px-5">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">{item.title}</p>
                      <p className="text-[13px] text-[var(--color-text-secondary)]">{item.detail}</p>
                    </li>
                  ))
                )}
              </ul>
            </SectionCard>
            <div className="flex min-w-0 flex-col gap-6">
              <SectionCard title="Not yet" subtitle="Arriving next">
                <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-[var(--color-text-secondary)]">
                  {AGENT_NOT_YET.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </SectionCard>
              <SectionCard title="Guardrails">
                <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-[var(--color-text-secondary)]">
                  {AGENT_GUARDRAILS.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </SectionCard>
            </div>
          </div>

          {isOwner && (
            <SectionCard title="Agents on the team" subtitle="Only you see this. A key is never shown.">
              {overview ? (
                <AgentTeamList rows={teamRows} busyKeyId={busyKeyId} offline={!online} onDisconnect={disconnectFor} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[13px] text-[var(--color-text-secondary)]">Couldn&apos;t load who has an agent connected.</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => refetch()} className="max-sm:h-11">
                    Try again
                  </Button>
                </div>
              )}
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
