// Issue #3802 (Wave 4) — the readable handbook for the pipeline and the
// signed-in person's agent. Every stage, ICP, routine, rule and limit comes
// from team_agent_guide(); this page invents no second copy authority.
import { useEffect, useMemo } from "react";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Skeleton } from "../components/ui/Skeleton";
import { Tabs } from "../components/ui/Tabs";
import { AgentRoutineList } from "../components/agent/AgentRoutineList";
import { useAgentGuide } from "../hooks/useAgentGuide";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { AGENT_LIMIT_LABELS, GUIDE_TABS } from "../lib/agentPrompts";

const PAGE_ID = "guide";
const OFFLINE_WORDS = "You're offline. A guide already loaded here stays readable, but it can't refresh until you're back.";
const LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-[var(--color-brand-700)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

function GuideLoading() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2" aria-busy="true" aria-label="Loading guide">
      {[0, 1].map((n) => (
        <div key={n} className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 sm:p-5">
          <Skeleton width="35%" height={20} />
          <div className="mt-4 flex flex-col gap-3">
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StagePanel({ pipelines }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
      {["hosts", "creators"].map((id) => {
        const pipeline = pipelines[id];
        return (
          <SectionCard
            key={id}
            title={pipeline.label}
            action={<a href={`#/${id}`} className={LINK_CLASS}>Open board</a>}
            noPadding
          >
            <ol className="divide-y divide-[var(--gray-200)]">
              {pipeline.stages.map((stage) => (
                <li key={stage.id} className="flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{stage.label}</p>
                    {stage.hint ? <p className="text-[13px] text-[var(--color-text-secondary)]">{stage.hint}</p> : null}
                  </div>
                  <Badge variant={stage.auto === true ? "brand" : "outline"}>{stage.auto === true ? "Automatic" : "Manual"}</Badge>
                </li>
              ))}
            </ol>
          </SectionCard>
        );
      })}
    </div>
  );
}

function IcpPanel({ pipelines }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
      {["hosts", "creators"].map((id) => {
        const pipeline = pipelines[id];
        return (
          <SectionCard key={id} title={pipeline.label} noPadding>
            <ul className="divide-y divide-[var(--gray-200)]">
              {pipeline.icps.map((icp) => (
                <li key={icp.id} className="px-4 py-3 sm:px-5">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{icp.label}</p>
                  {typeof icp.description === "string" && icp.description ? (
                    <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">{icp.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </SectionCard>
        );
      })}
    </div>
  );
}

function AgentPanel({ routines }) {
  return (
    <SectionCard
      title="Routines to try"
      action={<a href="#/agent" className={LINK_CLASS}>My agent</a>}
    >
      <p className="mb-4 text-[13px] text-[var(--color-text-secondary)]">
        Copy one exactly, then paste it into your connected agent.
      </p>
      <AgentRoutineList routines={routines} />
    </SectionCard>
  );
}

function RulesPanel({ rules, limits }) {
  const knownLimits = Object.entries(AGENT_LIMIT_LABELS)
    .map(([key, label]) => ({ key, label, value: limits[key] }))
    .filter((row) => Number.isFinite(row.value) && row.value >= 0);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[2fr_minmax(280px,1fr)]">
      <SectionCard title="House rules">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--color-text-secondary)]">
          {rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ol>
      </SectionCard>
      <SectionCard title="Limits" noPadding>
        <dl className="divide-y divide-[var(--gray-200)]">
          {knownLimits.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5">
              <dt className="text-[13px] text-[var(--color-text-secondary)]">{row.label}</dt>
              <dd className="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>
    </div>
  );
}

export function GuidePage() {
  const online = useOnline();
  const guide = useAgentGuide();
  const [search, setSearch] = useHashQuery(PAGE_ID);
  const requested = useMemo(() => new URLSearchParams(search).get("tab"), [search]);
  const tab = GUIDE_TABS.some((item) => item.id === requested) ? requested : "stages";

  useEffect(() => {
    if (requested && requested !== tab) setSearch("tab=stages", { replace: true });
  }, [requested, tab, setSearch]);

  const changeTab = (next) => setSearch(`tab=${next}`);
  const tabs = <Tabs tabs={GUIDE_TABS} activeTab={tab} onChange={changeTab} variant="highContrast" mobileGrid />;
  const data = guide.data;
  let panel = null;
  if (data) {
    if (tab === "stages") panel = <StagePanel pipelines={data.config.pipelines} />;
    else if (tab === "icp") panel = <IcpPanel pipelines={data.config.pipelines} />;
    else if (tab === "agent") panel = <AgentPanel routines={data.guide.routines} />;
    else panel = <RulesPanel rules={data.guide.rules} limits={data.limits} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Guide"
        description="How Mingla's pipelines and your agent work together."
        tabs={tabs}
      />
      {!online && <AlertCard variant="warning">{OFFLINE_WORDS}</AlertCard>}
      {guide.loading ? (
        <GuideLoading />
      ) : guide.error ? (
        guide.error.token === "forbidden" ? (
          <AlertCard
            variant="error"
            title="You can't open this any more"
            action={<Button variant="secondary" size="sm" highContrastFocus onClick={() => window.location.reload()} className="min-h-11 max-sm:h-11">Reload</Button>}
          >
            Ask the owner to check your team access.
          </AlertCard>
        ) : (
          <AlertCard
            variant="error"
            title="Couldn't load the guide"
            action={<Button variant="secondary" size="sm" highContrastFocus disabled={!online} onClick={guide.retry} className="min-h-11 max-sm:h-11">Try again</Button>}
          >
            Check your connection and try again. No pipeline changes were made.
          </AlertCard>
        )
      ) : (
        <section
          id={`tabpanel-${tab}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
          className="min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2"
        >
          {panel}
        </section>
      )}
    </div>
  );
}
