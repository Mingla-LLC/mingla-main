// Issue #3802 (Wave 4) — one agent's key: its status, the key itself for the
// one moment it exists, and Create, Replace and Disconnect.
//
// Replace and Disconnect ask first, in place. Neither can be undone (a key
// that was turned off is never turned back on), and the question says so; a
// new key is always one press away.
import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { CopyBlock } from "./CopyBlock";
import { NOT_WORKING_CHECKS, agentStatus, stoppedWords, zoneWords } from "../../lib/agentConnect";
import { DISCLOSURE_CLASS } from "./AgentConnectSteps";

export function AgentKeyCard({
  agent,
  activeKey,
  stoppedKey,
  freshKey,
  idleDays,
  busy,
  offline,
  problem,
  notice,
  replaceAgain,
  onCreate,
  onRevoke,
  onDone,
}) {
  const [asking, setAsking] = useState(null); // "replace" | "disconnect" | null
  const keepRef = useRef(null);
  const mainRef = useRef(null);
  const status = agentStatus(activeKey, agent.id);
  const headingId = `agent-key-${agent.id}`;

  // The question opens with the safe answer focused; Escape is "Keep". When
  // it closes, focus goes back to the button that opened it (or the one that
  // took its place), so a keyboard is never left nowhere.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (asking) {
      keepRef.current?.focus();
    } else if (returnFocus.current && !busy) {
      returnFocus.current = false;
      mainRef.current?.focus();
    }
  }, [asking, busy, activeKey, freshKey]);
  const keep = () => {
    returnFocus.current = true;
    setAsking(null);
  };
  const onKeyDown = (event) => {
    if (asking && event.key === "Escape") {
      event.stopPropagation();
      keep();
    }
  };

  const confirm = async () => {
    const what = asking;
    returnFocus.current = true;
    setAsking(null);
    if (what === "replace") await onCreate(agent.id);
    if (what === "disconnect" && activeKey) await onRevoke(activeKey.key_id, agent.id);
  };

  const offlineTitle = offline ? "You're offline. This works again once you're back." : undefined;

  return (
    <section
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)] sm:p-5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-50)]">
          <KeyRound className="h-[18px] w-[18px] text-[var(--color-brand-500)]" aria-hidden="true" />
        </span>
        <h3 id={headingId} className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          {activeKey ? `Your ${agent.label} key` : `Connect ${agent.label}`}
        </h3>
        <Badge variant={status.variant} dot className="max-w-full !whitespace-normal">
          {status.text}
        </Badge>
      </div>

      {freshKey ? (
        <div className="flex min-w-0 flex-col gap-2">
          <CopyBlock
            id={`agent-fresh-key-${agent.id}`}
            text={freshKey}
            copyLabel="Copy key"
            note="Shown once. Copy it now: you will not see this key again."
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                returnFocus.current = true;
                onDone(agent.id);
              }}
              className="max-sm:h-11"
            >
              Done
            </Button>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Done hides the key. The lines in step 2 are filled in with it until then.
            </p>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">{zoneWords(activeKey)}</p>
        </div>
      ) : activeKey ? (
        <>
          <p className="break-words text-[13px] text-[var(--color-text-secondary)]">
            Key <span className="font-mono text-[var(--color-text-primary)]">{activeKey.key_prefix}…</span>{" "}
            The rest was shown once and is not kept anywhere. Lost it? Replace the key.
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">{zoneWords(activeKey)}</p>
        </>
      ) : (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          One key for {agent.label}. It carries your role and nothing more.
          {stoppedKey ? ` ${stoppedWords(stoppedKey, idleDays)}` : ""}
        </p>
      )}

      {notice && (
        <p role="status" className="rounded-lg bg-[var(--color-warning-50)] p-3 text-[13px] text-[var(--color-warning-700)]">
          {notice}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-[13px] text-[var(--color-error-700)]">
          {problem}
        </p>
      )}

      {asking ? (
        <div role="group" aria-label={asking === "replace" ? `Replace your ${agent.label} key?` : `Disconnect ${agent.label}?`} className="flex min-w-0 flex-col gap-2 rounded-lg bg-[var(--color-warning-50)] p-3">
          <p className="text-[13px] text-[var(--color-warning-700)]">
            {asking === "replace"
              ? "The old key stops working at once, and your agent needs the new one. This can't be undone."
              : `Disconnect ${agent.label}? Its key stops working at once. This can't be undone, but a new key is one press away.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" onClick={confirm} disabled={offline} title={offlineTitle} className="max-sm:h-11">
              {asking === "replace" ? "Replace" : "Disconnect"}
            </Button>
            <Button ref={keepRef} type="button" variant="secondary" onClick={keep} className="max-sm:h-11">
              Keep
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {activeKey ? (
            <>
              <Button ref={mainRef} type="button" variant="secondary" loading={busy} disabled={offline} title={offlineTitle} onClick={() => setAsking("replace")} className="max-sm:h-11">
                {replaceAgain ? "Replace again" : "Replace key"}
              </Button>
              <Button type="button" variant="ghost" disabled={busy || offline} title={offlineTitle} onClick={() => setAsking("disconnect")} className="max-sm:h-11">
                Disconnect
              </Button>
            </>
          ) : (
            <Button ref={mainRef} type="button" loading={busy} disabled={offline} title={offlineTitle} onClick={() => onCreate(agent.id)} className="max-sm:h-11">
              {stoppedKey ? "Create a new key" : "Create my key"}
            </Button>
          )}
        </div>
      )}

      {activeKey && !freshKey && status.state === "unused" && (
        <details className="text-[13px] text-[var(--color-text-secondary)]">
          <summary className={DISCLOSURE_CLASS}>Not working?</summary>
          <ul className="list-disc space-y-1 pl-5">
            {NOT_WORKING_CHECKS.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>Still nothing? Replace the key and paste the lines again.</li>
          </ul>
        </details>
      )}
    </section>
  );
}
