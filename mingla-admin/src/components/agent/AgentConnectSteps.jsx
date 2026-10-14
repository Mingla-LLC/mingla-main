// Issue #3802 (Wave 4) — "Add Mingla to your agent": the exact lines to
// paste, for Claude Code or Codex, on macOS / Linux or Windows.
//
// The recommended lines keep the key in an environment variable, so the line
// that names the connector never holds the key. The simpler way is one paste.
// Under every line the page says where the key ends up and how to take it
// out again. Lines that were not run on that kind of computer say so.
import { useRef } from "react";
import { AlertCard } from "../ui/Card";
import { Segmented } from "../crm/fields";
import { CopyBlock } from "./CopyBlock";
import { AGENTS, OS_OPTIONS, connectLines } from "../../lib/agentConnect";

/** Summary of a disclosure: a full 44px target, at every width. */
export const DISCLOSURE_CLASS = [
  "flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-[var(--color-text-primary)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
].join(" ");

/** The two agent tabs: 44px tall, arrow keys move between them. */
function AgentTabs({ agentId, onAgent }) {
  const refs = useRef({});
  const onKeyDown = (event) => {
    const at = AGENTS.findIndex((a) => a.id === agentId);
    let next = -1;
    if (event.key === "ArrowRight") next = (at + 1) % AGENTS.length;
    else if (event.key === "ArrowLeft") next = (at - 1 + AGENTS.length) % AGENTS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = AGENTS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onAgent(AGENTS[next].id);
    refs.current[AGENTS[next].id]?.focus();
  };
  return (
    <div role="tablist" aria-label="Your agent" className="flex min-w-0 border-b border-[var(--gray-200)]">
      {AGENTS.map((a) => {
        const active = a.id === agentId;
        return (
          <button
            key={a.id}
            ref={(el) => {
              refs.current[a.id] = el;
            }}
            type="button"
            role="tab"
            id={`agent-tab-${a.id}`}
            aria-selected={active}
            aria-controls={`agent-tabpanel-${a.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onAgent(a.id)}
            onKeyDown={onKeyDown}
            className={[
              "-mb-px min-h-11 border-b-2 px-4 text-sm font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand-500)]",
              active
                ? "border-[var(--color-brand-500)] text-[var(--color-brand-500)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
          >
            {a.product}
          </button>
        );
      })}
    </div>
  );
}

export function AgentConnectSteps({ agentId, onAgent, os, onOs, endpoint, freshKey, hasKey }) {
  const lines = connectLines({ agent: agentId, os, endpoint, key: freshKey });
  const agent = AGENTS.find((a) => a.id === agentId) || AGENTS[0];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AgentTabs agentId={agentId} onAgent={onAgent} />
      <div role="tabpanel" id={`agent-tabpanel-${agentId}`} aria-labelledby={`agent-tab-${agentId}`} className="flex min-w-0 flex-col gap-4">
        <Segmented label="Your computer" options={OS_OPTIONS} value={os} onChange={onOs} />

        {!lines ? (
          <AlertCard variant="error" title="The connector's address isn't set up">
            This copy of Mingla Admin doesn&apos;t know its server address, so the lines can&apos;t be built. Tell an admin.
          </AlertCard>
        ) : (
          <>
            {lines.untested && (
              <AlertCard variant="warning" title="Not tested on Windows">
                We have not run these lines on a Windows computer. They follow the documented forms. If one is refused, use
                the simpler way at the bottom and tell an admin what happened.
              </AlertCard>
            )}
            {!hasKey && (
              <AlertCard variant="info">
                Create your {agent.label} key in step 1 first. The lines below are filled in with it while it is on screen.
              </AlertCard>
            )}
            {hasKey && !freshKey && (
              <AlertCard variant="info">
                Your key was shown once and isn&apos;t kept here, so the lines show {"<your key>"} where it goes. Lost it? Replace
                the key in step 1.
              </AlertCard>
            )}
            {lines.steps.map((line) => (
              <CopyBlock
                key={`${agentId}-${os}-${line.id}`}
                label={line.label}
                text={line.text}
                copyLabel={line.text.includes("\n") ? "Copy lines" : "Copy line"}
                note={line.where}
              />
            ))}
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--color-text-secondary)]">
              {lines.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <details className="min-w-0 rounded-lg border border-[var(--gray-200)] px-3">
              <summary className={DISCLOSURE_CLASS}>Simpler</summary>
              <div className="pb-3">
                <CopyBlock
                  key={`${agentId}-${os}-simple`}
                  label={lines.simpler.label}
                  text={lines.simpler.text}
                  copyLabel={lines.simpler.text.includes("\n") ? "Copy lines" : "Copy line"}
                  note={lines.simpler.where}
                />
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
