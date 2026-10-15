// Issue #3802 (Wave 1) — the home page of the Sales and marketing and
// Founding partner roles (#/home): "My day" and "Company view".
//
// Every number on this page was counted by the server (crm_home_summary,
// through hooks/useCrmSummary.js). Nothing is typed into this file, and this
// file never talks to the database itself. Every tile and row goes somewhere;
// every empty section says what to do next.
import { AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useAuth } from "../context/AuthContext";
import { useCrmConfig } from "../hooks/useCrmConfig";
import { useCrmSummary } from "../hooks/useCrmSummary";
import { useOnline } from "../hooks/useCrmPipeline";
import { ROLE_HOME_TITLES } from "../lib/access";
import { displayName, dueTotals, errorWords, loadErrorWords, localToday, longDate } from "../lib/crmModel";
import { buildCrmHash } from "../lib/crmUrl";
import { StatTile, StatTileRow, StatTileSkeleton } from "../components/crm/home/StatTile";
import { DueList } from "../components/crm/home/DueList";
import { StageFunnel } from "../components/crm/home/StageFunnel";
import { TargetsCard } from "../components/crm/home/TargetsCard";
import { useDraftCountValue } from "../hooks/useDraftCounts";
import { AgentPromptStrip } from "../components/agent/AgentPromptStrip";

const OFFLINE_WORDS = "You're offline. You can look around, but the numbers won't update until you're back.";
const NOT_READY_WORDS = "Your home isn't switched on yet. Try again in a few minutes, or tell an admin.";

/** The empty state of a due list: why it is empty and what fills it. */
function nothingDue(singular) {
  return `Nothing due. Set a next action and a date on a ${singular} and it will show here.`;
}

/** "3 overdue" under a tile, or nothing. */
function overdueNote(totals) {
  return totals.overdue > 0 ? `${totals.overdue} overdue` : "";
}

export function RoleHomePage() {
  const { access } = useAuth();
  const online = useOnline();
  const cfg = useCrmConfig();
  const summary = useCrmSummary("home");
  const draftCounts = useDraftCountValue();
  const config = cfg.config;
  const data = summary.data;

  const partner = access?.role === "partner";
  const title = (access && ROLE_HOME_TITLES[access.role]) || "Home";
  const name = data?.me?.display_name || displayName(access?.email || "");
  const today = data?.today || localToday();
  const greeting = partner ? "Here is where outreach stands." : "Here is your day.";

  const error = summary.error || cfg.error || draftCounts.error;
  const loading = !error && (summary.loading || cfg.loading || draftCounts.loading);
  const retry = () => {
    if (cfg.error) cfg.retry();
    summary.refetch();
    draftCounts.refetch();
  };

  const scope = partner ? data?.due?.team : data?.due?.mine;
  const hostsDue = dueTotals(scope?.hosts);
  const creatorsDue = dueTotals(scope?.creators);
  const listState = partner ? { view: "list" } : { view: "list", mine: true };
  const hostsDef = config?.pipelines?.hosts || null;
  const creatorsDef = config?.pipelines?.creators || null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={name ? `Hi ${name}. ${greeting}` : greeting}
        description={partner ? title : longDate(today) || title}
      />

      {!online && <AlertCard variant="warning">{OFFLINE_WORDS}</AlertCard>}

      <AgentPromptStrip routine="my_plate" />

      {error ? (
        error.token === "forbidden" ? (
          <AlertCard
            variant="error"
            title="You can't open this any more"
            action={
              <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          >
            {errorWords(error)}
          </AlertCard>
        ) : (
          <AlertCard
            variant="error"
            title="Couldn't load your home"
            action={
              <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={retry}>
                Retry
              </Button>
            }
          >
            {error.token === "not_ready" ? NOT_READY_WORDS : loadErrorWords(error)}
          </AlertCard>
        )
      ) : loading ? (
        <>
          <StatTileRow label="Loading" columns={4}>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </StatTileRow>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {partner ? (
              <>
                <StageFunnel title="Hosts by stage" pipeline="hosts" loading />
                <StageFunnel title="Creators by stage" pipeline="creators" loading />
              </>
            ) : (
              <>
                <DueList title="Due today, hosts" pipeline="hosts" loading />
                <DueList title="Due today, creators" pipeline="creators" loading />
              </>
            )}
          </div>
          <TargetsCard loading />
        </>
      ) : (
        <>
          <StatTileRow label={partner ? "The team's numbers" : "Your numbers"} columns={4}>
            <StatTile
              href={buildCrmHash("hosts", listState)}
              value={hostsDue.total}
              label="Hosts due"
              note={overdueNote(hostsDue)}
            />
            <StatTile
              href={buildCrmHash("creators", listState)}
              value={creatorsDue.total}
              label="Creators due"
              note={overdueNote(creatorsDue)}
            />
            <StatTile href="#/drafts" value={Number(draftCounts.data?.waiting || 0)} label="Drafts waiting" />
            {data.beta_leads_new !== null && data.beta_leads_new !== undefined ? (
              <StatTile href="#/beta-leads?show=new" value={data.beta_leads_new} label="New beta leads" />
            ) : null}
          </StatTileRow>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {partner ? (
              <>
                <StageFunnel title="Hosts by stage" pipeline="hosts" stages={data.stages?.hosts} />
                <StageFunnel title="Creators by stage" pipeline="creators" stages={data.stages?.creators} />
              </>
            ) : (
              <>
                <DueList
                  title="Due today, hosts"
                  pipeline="hosts"
                  def={hostsDef}
                  rows={data.due?.mine?.hosts?.rows}
                  total={hostsDue.total}
                  regions={config.regions}
                  team={config.team}
                  today={today}
                  moreHref={buildCrmHash("hosts", listState)}
                  emptyText={nothingDue("host")}
                />
                <DueList
                  title="Due today, creators"
                  pipeline="creators"
                  def={creatorsDef}
                  rows={data.due?.mine?.creators?.rows}
                  total={creatorsDue.total}
                  regions={config.regions}
                  team={config.team}
                  today={today}
                  moreHref={buildCrmHash("creators", listState)}
                  emptyText={nothingDue("creator")}
                />
              </>
            )}
          </div>

          <TargetsCard
            targets={data.targets}
            subtitle="Hosts that reached Onboarded or Live this month, against the monthly number"
            emptyHint="An owner or admin sets them on the Team dashboard."
          />
        </>
      )}
    </div>
  );
}
