// Issue #3802 (Wave 4) — the two lines for adding the key by hand, for
// Claude Code or Codex, on macOS / Linux or Windows.
//
// No line here contains a key. Line 1 asks for the key in the terminal and
// hides what is pasted; line 2 names the variable only. Under every line the
// page says where the key ends up and how to take it out again. Lines that
// were not run on that kind of computer say so.
import { useRef } from "react";
import { AlertCard } from "../ui/Card";
import { Segmented } from "../crm/fields";
import { CopyBlock } from "./CopyBlock";
import { AGENTS, OS_OPTIONS, advancedLines } from "../../lib/agentConnect";

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

export function AgentConnectSteps({ agentId, onAgent, os, onOs, endpoint }) {
  const lines = advancedLines({ agent: agentId, os, endpoint });

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
                the setup message in step 1 and tell an admin what happened.
              </AlertCard>
            )}
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Paste these into the Terminal app on your own computer, one at a time. Wait for line 1 to finish before
              line 2, then restart your agent.
            </p>
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
          </>
        )}
      </div>
    </div>
  );
}
