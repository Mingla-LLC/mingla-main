/**
 * MY AGENT PAGE (#/agent) — connect your own Claude or Codex to Mingla
 * (issue #3802, Wave 4).
 *
 * A person creates one key per agent here. The key is shown once, in this
 * tab's memory only: it is never written to browser storage, never sent
 * anywhere by this page, and gone on Done, on reload or on leaving the page.
 * The server keeps only a digest of it, so nobody (this page included) can
 * show it again.
 *
 * This first part connects an agent that READS. The page says so in plain
 * words and lists what arrives next; it never offers something the connector
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
import { createKey, revokeKey } from "../services/teamAgentService";
import { AgentKeyCard } from "../components/agent/AgentKeyCard";
import { AgentConnectSteps } from "../components/agent/AgentConnectSteps";
import { AgentTeamList } from "../components/agent/AgentTeamList";
import {
  AGENTS,
  AGENT_GUARDRAILS,
  AGENT_NOT_YET,
  AGENT_OFFLINE_WORDS,
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
  shownKeyVerdict,
} from "../lib/agentConnect";

/** While a key is on screen the page checks this often that it still works. */
const SHOWN_KEY_REFRESH_MS = 5_000;
/** How long a create waits for its answer before the page stops waiting. */
const CREATE_WAIT_MS = 20_000;


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
  const { keys, idleDays, guide, overview, isOwner, loading, error, refetch } = useAgentKeys();

  // The key just created, per agent. In memory only; never stored, never
  // logged, never sent to another tab. Leaving the page drops it.
  const [fresh, setFresh] = useState({});
  // Which key that is, per agent: { keyId, listed }. An id is not a secret;
  // it lets the page notice when the key on screen has been ended elsewhere.
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

  // While a key is on screen, read again every few seconds, in the
  // background too, so a key ended in another tab or window is already gone
  // from this one when somebody next looks at it.
  const showingKey = AGENTS.some((a) => !!shownIds[a.id]);
  useEffect(() => {
    if (!showingKey) return undefined;
    const timer = setInterval(() => {
      if (navigator.onLine === false) return;
      refetch({ quiet: true });
    }, SHOWN_KEY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [showingKey, refetch]);

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
        setShownIds((m) => ({ ...m, [agentId]: { keyId: made.key_id, listed: false } }));
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
        addToast({
          variant: "success",
          title: `${label} is disconnected`,
          description: "Its key stopped working. Create a new key whenever you want it back.",
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
            Connect your own Claude or Codex. It works under your name, with your role and nothing more. Right now it can
            read your pipelines; it cannot change a card, send a message or delete.
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
          <SectionCard title={<StepHeading n={1}>Your key</StepHeading>} subtitle="One per agent. Shown once.">
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {AGENTS.map((a) => (
                <AgentKeyCard
                  key={a.id}
                  agent={a}
                  activeKey={activeKey(keys, a.id)}
                  stoppedKey={lastStoppedKey(keys, a.id)}
                  freshKey={fresh[a.id] || null}
                  idleDays={idleDays}
                  busy={!!busy[a.id]}
                  offline={!online}
                  problem={problem[a.id] || ""}
                  notice={notice[a.id] || ""}
                  replaceAgain={!!unseen[a.id]}
                  onCreate={create}
                  onRevoke={revoke}
                  onDone={doneAndForget}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
              A key that isn&apos;t used for {idleDays} days turns itself off. If you leave the team, your keys stop at once.
            </p>
          </SectionCard>

          <SectionCard title={<StepHeading n={2}>Add Mingla to your agent</StepHeading>} subtitle="Paste these on your own computer.">
            <AgentConnectSteps
              agentId={tab}
              onAgent={setTab}
              os={os}
              onOs={setOs}
              endpoint={ENDPOINT}
              freshKey={fresh[tab] || null}
              hasKey={!!activeKey(keys, tab)}
            />
          </SectionCard>

          <SectionCard title={<StepHeading n={3}>Just ask</StepHeading>} subtitle="The connector teaches your agent the stages and the rules.">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Start with: <span className="font-medium text-[var(--color-text-primary)]">What is on my plate in Mingla?</span>
            </p>
            {statusLine && <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">{statusLine}</p>}
          </SectionCard>

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
