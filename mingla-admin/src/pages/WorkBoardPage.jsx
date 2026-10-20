// Issue #3980 (R7, R8) — Work: what needs doing, who's on it, and what's
// slipping. Three tabs, never shown stacked: the Board (columns side by
// side, with the red chips of what needs attention above them), Needs
// attention (each group's list with a one-click fix) and Agent activity
// (what was the Agent log). A card opens in the drawer over the board;
// Add card opens the add form in the same drawer.
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Drawer } from "../components/ui/Drawer";
import { Skeleton } from "../components/ui/Skeleton";
import { Segmented } from "../components/crm/fields";
import { SprintStrip } from "../components/ops/SprintStrip";
import { WorkColumns } from "../components/ops/WorkColumns";
import { WorkCardDrawer } from "../components/ops/WorkCardDrawer";
import { WorkAddForm } from "../components/ops/WorkAddForm";
import { AttentionChips, NeedsAttention } from "../components/ops/NeedsAttention";
import { AgentActivity } from "../components/ops/AgentActivity";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { useOpsAttention, useOpsWork } from "../hooks/useOpsWork";
import { useOpsConfig } from "../hooks/useOpsConfig";
import { usePeopleDirectory } from "../hooks/usePeopleDirectory";
import { useToast } from "../context/ToastContext";
import * as ops from "../services/opsService";
import { addDays, attentionCounts, buildWorkSearch, mondayOf, opsErrorWords, parseWorkSearch, parseWorkTab, todayIso } from "../lib/opsModel";

const WHO_OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "mine", label: "Mine" },
  { value: "watching", label: "Watching" },
];

export function WorkBoardPage() {
  const [search, setSearch] = useHashQuery("work-board");
  const query = useMemo(() => parseWorkSearch(search), [search]);
  const view = useMemo(() => parseWorkTab(search), [search]);
  const online = useOnline();
  const { addToast } = useToast();
  const config = useOpsConfig();
  const people = usePeopleDirectory();
  const list = useOpsWork({ who: query.who, week: query.week });
  const attention = useOpsAttention();
  const thisWeek = mondayOf(todayIso());

  // The tab and the attention group live beside the board's own address.
  const go = (patch, opts) => {
    const next = { ...query, ...patch };
    const p = new URLSearchParams(buildWorkSearch(next));
    const tab = Object.hasOwn(patch, "tab") ? patch.tab : view.tab;
    const att = Object.hasOwn(patch, "att") ? patch.att : view.att;
    if (tab && tab !== "board") p.set("tab", tab);
    if (att && tab === "attention") p.set("att", att);
    setSearch(p.toString(), opts);
  };
  const openCard = (id) => go({ card: id, add: false });
  const closeCard = () => {
    const id = query.card;
    go({ card: null, add: false });
    requestAnimationFrame(() => document.querySelector(`[data-card-id="${id}"]`)?.focus?.());
  };

  const cards = list.data?.cards || [];
  const counts = list.data?.counts || {};
  const sprint = list.data?.sprint || config.data?.sprint?.current || { starts_on: query.week || thisWeek };
  const overdue = cards.filter((c) => c.overdue).length;
  const me = config.data?.me || {};
  const total = Object.values(attentionCounts(attention.data)).reduce((n, x) => n + x, 0);
  const tabs = [
    { value: "board", label: "Board" },
    { value: "attention", label: `Needs attention ${attention.data ? total : ""}`.trim() },
    { value: "activity", label: "Agent activity" },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Work"
        description="What needs doing, who’s on it, and what’s slipping. Steps appear here by themselves from every host’s events."
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented label="Work tabs" options={tabs} value={view.tab} onChange={(tab) => go({ tab, att: null })} />
            <Button className="min-h-11" icon={Plus} disabled={!online} onClick={() => go({ add: true, card: null })}>Add card</Button>
          </div>
        }
      />
      {!online && <AlertCard variant="warning" title="You’re offline">You’re offline. You can read Work; adding and changes need a connection.</AlertCard>}

      {view.tab === "attention" ? (
        <NeedsAttention read={attention} group={view.att} onGroup={(att) => go({ tab: "attention", att }, { replace: true })} me={people.me} online={online} onOpenCard={openCard} />
      ) : view.tab === "activity" ? (
        <AgentActivity />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {attention.data && total > 0 && <AttentionChips data={attention.data} onlyHot onPick={(att) => go({ tab: "attention", att })} />}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented label="Whose cards" options={WHO_OPTIONS} value={query.who} onChange={(who) => go({ who }, { replace: true })} />
          </div>
          <SprintStrip
            sprint={sprint}
            counts={counts}
            overdue={overdue}
            online={online}
            canEditGoal={!!me.can_override}
            isThisWeek={!query.week || query.week === thisWeek}
            onWeek={(d) => go({ week: addDays(query.week || thisWeek, d) === thisWeek ? null : addDays(query.week || thisWeek, d) }, { replace: true })}
            onThisWeek={() => go({ week: null }, { replace: true })}
            onGoal={async (goal) => {
              try { await ops.setSprintGoal(query.week || thisWeek, goal); await list.refetch({ quiet: true }); addToast({ variant: "success", title: "Sprint goal saved" }); }
              catch (error) { addToast({ variant: "error", title: "Goal not saved", description: opsErrorWords(error) }); }
            }}
          />
          {list.stale && <AlertCard variant="warning" title="The board may be out of date" action={<Button variant="secondary" className="min-h-11" onClick={() => list.refetch()}>Try again</Button>} />}
          {list.loading ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading the board"><Skeleton height={160} /><Skeleton height={160} /><Skeleton height={160} /><Skeleton height={160} /></div>
          ) : list.error ? (
            <AlertCard variant="error" title="Couldn’t load the board" action={<Button variant="secondary" className="min-h-11" onClick={() => list.refetch()}>Try again</Button>}>{opsErrorWords(list.error)}</AlertCard>
          ) : cards.length === 0 && query.who === "all" && !query.week ? (
            <SectionCard><p className="text-[13px] text-[var(--color-text-secondary)]">No cards yet. Add one, or set a host’s next event on their card: its steps appear here by themselves.</p></SectionCard>
          ) : (
            <WorkColumns cards={cards} selectedId={query.card} onSelect={(card) => openCard(card.id)} />
          )}
        </div>
      )}

      {query.cardInvalid && (
        <Drawer open onClose={closeCard} title="That card isn’t here">
          <Button variant="secondary" className="min-h-11" onClick={closeCard}>Back to Work</Button>
        </Drawer>
      )}
      {query.add ? (
        <Drawer open onClose={() => go({ add: false })} title="Add card">
          <WorkAddForm
            key="add"
            config={config.data}
            online={online}
            onCancel={() => go({ add: false })}
            onAdded={(card) => { list.refetch({ quiet: true }); attention.refetch({ quiet: true }); go({ add: false, card: card.id }); }}
            onOpenCard={(id) => id && go({ add: false, card: id })}
          />
        </Drawer>
      ) : (
        <WorkCardDrawer cardId={query.card} config={config.data} online={online} onClose={closeCard} onChanged={() => { list.refetch({ quiet: true }); attention.refetch({ quiet: true }); }} />
      )}
    </div>
  );
}
