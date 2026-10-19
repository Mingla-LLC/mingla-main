// Issue #3980 — the Work board: everything the team is doing this week.
// Two columns: the cards on the left, the open card on the right.
import { useMemo, useRef } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { Segmented } from "../components/crm/fields";
import { TwoColumn } from "../components/ops/TwoColumn";
import { revealDetail } from "../components/ops/revealDetail";
import { SprintStrip } from "../components/ops/SprintStrip";
import { WorkList } from "../components/ops/WorkList";
import { WorkDetail } from "../components/ops/WorkDetail";
import { WorkAddForm } from "../components/ops/WorkAddForm";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import { useOpsWork } from "../hooks/useOpsWork";
import { useOpsConfig } from "../hooks/useOpsConfig";
import { useToast } from "../context/ToastContext";
import * as ops from "../services/opsService";
import { addDays, buildWorkSearch, mondayOf, opsErrorWords, parseWorkSearch, todayIso } from "../lib/opsModel";

const WHO_OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "mine", label: "Mine" },
  { value: "watching", label: "Watching" },
];
const GROUP_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "person", label: "Person" },
  { value: "event", label: "Event" },
];

export function WorkBoardPage() {
  const [search, setSearch] = useHashQuery("work-board");
  const query = useMemo(() => parseWorkSearch(search), [search]);
  const online = useOnline();
  const { addToast } = useToast();
  const config = useOpsConfig();
  const list = useOpsWork({ who: query.who, week: query.week });
  const detailRef = useRef(null);
  const headingRef = useRef(null);
  const thisWeek = mondayOf(todayIso());

  const go = (patch, opts) => setSearch(buildWorkSearch({ ...query, ...patch }), opts);
  const select = (card) => {
    go({ card: card.id, add: false });
    revealDetail(detailRef, headingRef);
  };
  const backToList = () => {
    const id = query.card;
    go({ card: null, add: false });
    requestAnimationFrame(() => document.querySelector(`[data-card-id="${id}"]`)?.focus?.());
  };

  const cards = list.data?.cards || [];
  const counts = list.data?.counts || {};
  const sprint = list.data?.sprint || config.data?.sprint?.current || { starts_on: query.week || thisWeek };
  const overdue = cards.filter((c) => c.overdue).length;
  const me = config.data?.me || {};

  const right = query.add ? (
    <WorkAddForm
      key="add"
      config={config.data}
      online={online}
      headingRef={headingRef}
      onCancel={() => go({ add: false })}
      onAdded={(card) => { list.refetch({ quiet: true }); go({ add: false, card: card.id }); revealDetail(detailRef, headingRef); }}
      onOpenCard={(id) => id && go({ add: false, card: id })}
    />
  ) : query.cardInvalid ? (
    <SectionCard>
      <h2 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-[var(--color-text-primary)]">That card isn’t here.</h2>
      <Button variant="secondary" className="mt-3 min-h-11" onClick={backToList}>Back to the board</Button>
    </SectionCard>
  ) : query.card ? (
    <WorkDetail key={query.card} cardId={query.card} config={config.data} online={online} headingRef={headingRef} onBack={backToList} onChanged={() => list.refetch({ quiet: true })} />
  ) : (
    <div className="rounded-xl border border-dashed border-[var(--gray-300)] p-4 text-[13px] text-[var(--color-text-tertiary)]">Pick a card to see it here, or press Add card.</div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Work board"
        description="Everything the team is doing this week. Agents add work straight here; the server checks every card first."
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented label="Whose cards" options={WHO_OPTIONS} value={query.who} onChange={(who) => go({ who }, { replace: true })} />
            <Button className="min-h-11" icon={Plus} disabled={!online} onClick={() => { go({ add: true, card: null }); revealDetail(detailRef, headingRef); }}>Add card</Button>
          </div>
        }
      />
      {!online && <AlertCard variant="warning" title="You’re offline">You’re offline. You can read the board; adding and changes need a connection.</AlertCard>}
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
      <Segmented label="Group cards by" options={GROUP_OPTIONS} value={query.group} onChange={(group) => go({ group }, { replace: true })} />
      {list.stale && <AlertCard variant="warning" title="The board may be out of date" action={<Button variant="secondary" className="min-h-11" onClick={() => list.refetch()}>Try again</Button>} />}
      <TwoColumn
        ref={detailRef}
        detailLabel="Card details"
        list={
          list.loading ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the board"><Skeleton height={72} /><Skeleton height={72} /><Skeleton height={72} /></div>
          ) : list.error ? (
            <AlertCard variant="error" title="Couldn’t load the board" action={<Button variant="secondary" className="min-h-11" onClick={() => list.refetch()}>Try again</Button>}>{opsErrorWords(list.error)}</AlertCard>
          ) : cards.length === 0 && query.who === "all" && !query.week ? (
            <SectionCard><p className="text-[13px] text-[var(--color-text-secondary)]">No cards yet. Add one, or ask your agent: Plan the launch of [event] with the launch kit.</p></SectionCard>
          ) : (
            <WorkList cards={cards} group={query.group} selectedId={query.card} onSelect={select} />
          )
        }
        detail={right}
      />
    </div>
  );
}
