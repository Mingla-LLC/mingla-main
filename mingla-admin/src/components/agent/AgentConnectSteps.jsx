// Issue #3802 (Wave 4) — "Add Mingla to your agent": the exact lines to
// paste, for Claude Code or Codex, on macOS / Linux or Windows.
//
// The recommended lines keep the key in an environment variable, so the line
// that names the connector never holds the key. The simpler way is one paste
// and says plainly where the key ends up.
import { Tabs } from "../ui/Tabs";
import { AlertCard } from "../ui/Card";
import { Segmented } from "../crm/fields";
import { CopyBlock } from "./CopyBlock";
import { AGENTS, OS_OPTIONS, connectLines } from "../../lib/agentConnect";

export function AgentConnectSteps({ agentId, onAgent, os, onOs, endpoint, freshKey, hasKey }) {
  const lines = connectLines({ agent: agentId, os, endpoint, key: freshKey });
  const agent = AGENTS.find((a) => a.id === agentId) || AGENTS[0];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Tabs
        tabs={AGENTS.map((a) => ({ id: a.id, label: a.product }))}
        activeTab={agentId}
        onChange={onAgent}
      />
      <div role="tabpanel" id={`tabpanel-${agentId}`} aria-labelledby={`tab-${agentId}`} className="flex min-w-0 flex-col gap-4">
        <Segmented label="Your computer" options={OS_OPTIONS} value={os} onChange={onOs} />

        {!lines ? (
          <AlertCard variant="error" title="The connector's address isn't set up">
            This copy of Mingla Admin doesn't know its server address, so the lines can't be built. Tell an admin.
          </AlertCard>
        ) : (
          <>
            {!hasKey && (
              <AlertCard variant="info">
                Create your {agent.label} key in step 1 first. The lines below are filled in with it while it is on screen.
              </AlertCard>
            )}
            {hasKey && !freshKey && (
              <AlertCard variant="info">
                Your key was shown once and isn't kept here, so the lines show {"<your key>"} where it goes. Lost it? Replace
                the key in step 1.
              </AlertCard>
            )}
            {lines.steps.map((line) => (
              <CopyBlock
                key={`${agentId}-${os}-${line.id}`}
                label={line.label}
                text={line.text}
                copyLabel={line.id === "add" && agentId === "codex" ? "Copy lines" : "Copy line"}
                note={line.hasKey ? "This line holds your key. Paste it in your own terminal only." : "This line holds no key."}
              />
            ))}
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--color-text-secondary)]">
              {lines.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <details className="min-w-0 rounded-lg border border-[var(--gray-200)] p-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]">
                Simpler
              </summary>
              <div className="mt-3">
                <CopyBlock
                  key={`${agentId}-${os}-simple`}
                  label={lines.simpler.label}
                  text={lines.simpler.text}
                  copyLabel={agentId === "codex" ? "Copy lines" : "Copy line"}
                  note="This holds your key. Anything that can read that file can read the key."
                />
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
