// Issue #3980 — the Agent log: what every connected agent did and is doing,
// and what is claimed right now. Entries cannot be changed or removed.
import { useMemo, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { Segmented } from "../components/crm/fields";
import { TwoColumn } from "../components/ops/TwoColumn";
import { LogRow } from "../components/ops/LogRow";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { useOpsLog } from "../hooks/useOpsLog";
import { useOpsConfig } from "../hooks/useOpsConfig";
import { useToast } from "../context/ToastContext";
import * as ops from "../services/opsService";
import { AGENT_RULES, agentName, opsErrorWords, parseLogSearch, timeLabel } from "../lib/opsModel";

const WHO_OPTIONS = [
  { value: "all", label: "All agents" },
  { value: "mine", label: "Mine" },
];
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function AgentLogPage() {
  const [search, setSearch] = useHashQuery("agent-log");
  const query = useMemo(() => parseLogSearch(search), [search]);
  const online = useOnline();
  const { addToast } = useToast();
  const config = useOpsConfig();
  const log = useOpsLog({ who: query.who });
  const [confirm, setConfirm] = useState(null);
  const canRelease = !!config.data?.me?.can_override;
  const entries = [...(log.data?.entries || []), ...log.older];
  const claims = log.data?.claims || [];

  const release = async (claim) => {
    try {
      await ops.releaseClaims(null, [claim.id]);
      setConfirm(null);
      await log.refetch({ quiet: true });
      addToast({ variant: "success", title: "Claim released" });
    } catch (error) {
      addToast({ variant: "error", title: "Claim not released", description: opsErrorWords(error) });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Agent log"
        description="Every agent writes here as it works and reads it before it starts. A claim locks the records it names, so no two agents do or send the same thing."
        actions={<Segmented label="Whose agents" options={WHO_OPTIONS} value={query.who} onChange={(who) => setSearch(who === "all" ? "" : `who=${who}`, { replace: true })} />}
      />
      {!online && <AlertCard variant="warning" title="You’re offline">You can read the log; releasing a claim needs a connection.</AlertCard>}
      <TwoColumn
        detailLabel="Claims and rules"
        list={
          <SectionCard title="Feed" noPadding>
            {log.loading ? (
              <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading the agent log"><Skeleton height={48} /><Skeleton height={48} /><Skeleton height={48} /></div>
            ) : log.error ? (
              <div className="p-4"><AlertCard variant="error" title="Couldn’t load the agent log" action={<Button variant="secondary" className="min-h-11" onClick={() => log.refetch()}>Try again</Button>}>{opsErrorWords(log.error)}</AlertCard></div>
            ) : entries.length === 0 ? (
              <p className="p-4 text-[13px] text-[var(--color-text-tertiary)]">Nothing in the log yet.</p>
            ) : (
              <>
                <ol aria-live="polite" className="min-w-0">{entries.map((e) => <LogRow key={e.id} entry={e} />)}</ol>
                {log.nextBefore && (
                  <div className="flex flex-col items-start gap-1 p-3">
                    {log.moreError && <p role="alert" className="text-[13px] text-[var(--color-error-700)]">Couldn’t load more.</p>}
                    <Button variant="secondary" className="min-h-11" loading={log.loadingMore} onClick={log.loadMore}>Show more</Button>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        }
        detail={
          <div className="flex min-w-0 flex-col gap-4">
            <SectionCard title="Claimed right now" noPadding>
              {claims.length === 0 ? <p className="p-4 text-[13px] text-[var(--color-text-tertiary)]">Nothing is claimed.</p> : (
                <ul className="min-w-0">
                  {claims.map((c) => (
                    <li key={c.id} className="flex min-w-0 flex-col gap-1 border-b border-[var(--gray-200)] px-4 py-2.5 last:border-b-0">
                      <p className="break-words text-[13px]"><span className="font-semibold text-[var(--color-text-primary)]">{agentName(c.holder_name, c.holder_via)}</span> <span className="text-[var(--color-text-secondary)]">holds {c.target.label}</span></p>
                      {c.card && <a href={`#/work-board?card=${c.card.id}`} className={`self-start break-words rounded text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>Card {c.card.number}: {c.card.title}</a>}
                      <p className="text-[12px] text-[var(--color-text-tertiary)]">since {timeLabel(c.since)} · ends {timeLabel(c.ends_at)}</p>
                      {canRelease && (confirm === c.id ? (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="danger" size="sm" className="min-h-11" disabled={!online} onClick={() => release(c)}>Release this claim</Button>
                          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setConfirm(null)}>Keep it</Button>
                        </div>
                      ) : (
                        <Button variant="secondary" size="sm" className="min-h-11 self-start" disabled={!online} onClick={() => setConfirm(c.id)}>Release</Button>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <SectionCard title="The rules every agent follows">
              <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-[var(--color-text-secondary)]">
                {AGENT_RULES.map((r) => <li key={r} className="break-words">{r}</li>)}
              </ol>
            </SectionCard>
            <AlertCard variant="info" title="Enforced by the server">An agent that skips the log is still stopped: every change checks open claims and recent messages.</AlertCard>
          </div>
        }
      />
    </div>
  );
}
