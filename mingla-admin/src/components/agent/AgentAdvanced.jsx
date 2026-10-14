// Issue #3802 (Wave 4) — "Advanced: add the key yourself". Closed by default.
//
// For people who would rather do it by hand: create a key, then paste two
// lines into the Terminal app. The lines never contain the key: the first
// asks for it and hides what is pasted.
import { AgentKeyCard } from "./AgentKeyCard";
import { AgentConnectSteps, DISCLOSURE_CLASS } from "./AgentConnectSteps";

export function AgentAdvanced({ agents, cardProps, tab, onTab, os, onOs, endpoint, idleDays }) {
  return (
    <details className="min-w-0 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-4 sm:px-5">
      <summary className={DISCLOSURE_CLASS}>Advanced: add the key yourself</summary>
      <div className="flex min-w-0 flex-col gap-4 pb-4">
        <p className="max-w-2xl text-[13px] text-[var(--color-text-secondary)]">
          For people who would rather do it by hand. You create a key, then paste two lines into the Terminal app on your
          computer (not into your agent). The lines never contain your key: line 1 asks for it and hides what you paste.
        </p>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {agents.map((a) => (
            <AgentKeyCard key={a.id} agent={a} {...cardProps(a)} />
          ))}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">
          A key that isn&apos;t used for {idleDays} days turns itself off. If you leave the team, your keys stop at once.
        </p>
        <AgentConnectSteps agentId={tab} onAgent={onTab} os={os} onOs={onOs} endpoint={endpoint} />
      </div>
    </details>
  );
}
